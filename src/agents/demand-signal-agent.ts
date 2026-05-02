// ── Demand Signal Agent ─────────────────────────────────────────────────────────
// Agent 1: Real-time demand aggregation across all apps
// Runs every 5 minutes via cron
// DANGEROUS: Auto-triggers price adjustments and dashboard updates

import { Intent, MerchantDemandSignal } from '../models/index.js';
import { sharedMemory } from './shared-memory.js';
import { handleDemandSignalAction } from './action-trigger.js';
import type { AgentConfig, AgentResult, DemandSignal } from './types.js';
import { log } from '../utils/logger.js';

// ── Agent Configuration ─────────────────────────────────────────────────────────

export const demandSignalAgentConfig: AgentConfig = {
  name: 'demand-signal-agent',
  intervalMs: 5 * 60 * 1000, // 5 minutes
  enabled: true,
  priority: 'high',
};

// ── Baseline for spike detection ────────────────────────────────────────────────

interface DemandBaseline {
  category: string;
  merchantId: string;
  avgDailyDemand: number;
  stdDev: number;
  lastUpdated: Date;
}

const baselines = new Map<string, DemandBaseline>();

// ── Calculate demand for a merchant/category ───────────────────────────────────

async function calculateDemand(merchantId: string, category: string): Promise<number> {
  const since = new Date(Date.now() - 60 * 60 * 1000); // Last hour

  const intentCount = await Intent.countDocuments({
    merchantId,
    category,
    firstSeenAt: { $gte: since },
    status: { $in: ['ACTIVE', 'DORMANT'] },
  });

  // Count related signals by aggregating embedded signals
  const intents = await Intent.find({
    merchantId,
    category,
    firstSeenAt: { $gte: since },
    status: { $in: ['ACTIVE', 'DORMANT'] },
  }).select('signals');

  let signalCount = 0;
  for (const intent of intents) {
    signalCount += (intent.signals || []).filter(
      (s) => s.capturedAt >= since &&
        ['search', 'view', 'wishlist', 'cart_add'].includes(s.eventType)
    ).length;
  }

  // Weighted calculation: intents * 3 + signals
  return intentCount * 3 + signalCount;
}

// ── Calculate unmet demand ──────────────────────────────────────────────────────

async function calculateUnmetDemand(merchantId: string, category: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // Last 24 hours

  // Aggregate signals across all merchants in category
  const intents = await Intent.find({
    category,
    'signals.eventType': 'search',
    'signals.capturedAt': { $gte: since },
  }).select('signals status lastSeenAt');

  let totalSearches = 0;
  let conversions = 0;

  for (const intent of intents) {
    const searchSignals = (intent.signals || []).filter(
      (s) => s.eventType === 'search' && s.capturedAt >= since
    );
    totalSearches += searchSignals.length;
    if (intent.status === 'FULFILLED' && intent.lastSeenAt >= since) {
      conversions++;
    }
  }

  if (totalSearches === 0) return 0;
  return Math.round(((totalSearches - conversions) / totalSearches) * 100);
}

// ── Detect demand spikes ─────────────────────────────────────────────────────────

function detectSpike(current: number, baseline: DemandBaseline): { spike: boolean; factor: number } {
  if (baseline.avgDailyDemand === 0) {
    return { spike: current > 10, factor: current };
  }

  const zScore = (current - baseline.avgDailyDemand) / (baseline.stdDev || 1);
  const spike = zScore > 2; // 2 standard deviations
  const factor = baseline.avgDailyDemand > 0 ? current / baseline.avgDailyDemand : 1;

  return { spike, factor };
}

// ── Update baseline ─────────────────────────────────────────────────────────────

function updateBaseline(merchantId: string, category: string, demand: number): void {
  const key = `${merchantId}:${category}`;
  const existing = baselines.get(key);

  if (existing) {
    // Running average with exponential decay
    const alpha = 0.2;
    existing.avgDailyDemand = alpha * demand + (1 - alpha) * existing.avgDailyDemand;
    existing.stdDev = Math.sqrt(
      alpha * Math.pow(demand - existing.avgDailyDemand, 2) + (1 - alpha) * Math.pow(existing.stdDev, 2)
    );
    existing.lastUpdated = new Date();
  } else {
    baselines.set(key, {
      category,
      merchantId,
      avgDailyDemand: demand,
      stdDev: 0,
      lastUpdated: new Date(),
    });
  }
}

// ── Get top cities for demand ──────────────────────────────────────────────────

async function getTopCities(merchantId: string, category: string): Promise<string[]> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Last 7 days

  const intents = await Intent.find({
    merchantId,
    category,
    firstSeenAt: { $gte: since },
    metadata: { $ne: null },
  }).select('metadata');

  const cityCounts = new Map<string, number>();
  for (const intent of intents) {
    const metadata = intent.metadata as Record<string, unknown> | null;
    const city = metadata?.city as string | undefined;
    if (city) {
      cityCounts.set(city, (cityCounts.get(city) || 0) + 1);
    }
  }

  return Array.from(cityCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([city]) => city);
}

// ── Determine trend ─────────────────────────────────────────────────────────────

function determineTrend(baseline: DemandBaseline, current: number): 'rising' | 'stable' | 'declining' {
  if (baseline.avgDailyDemand === 0) return 'stable';
  const change = (current - baseline.avgDailyDemand) / baseline.avgDailyDemand;
  if (change > 0.2) return 'rising';
  if (change < -0.2) return 'declining';
  return 'stable';
}

// ── Generate procurement signals ────────────────────────────────────────────────

async function generateProcurementSignals(): Promise<DemandSignal[]> {
  const categories = ['TRAVEL', 'DINING', 'RETAIL'];
  const signals: DemandSignal[] = [];

  for (const category of categories) {
    // Aggregate merchants by demand using MongoDB aggregation
    const merchantGroups = await Intent.aggregate([
      { $match: { category, status: { $in: ['ACTIVE', 'DORMANT'] } } },
      { $group: { _id: '$merchantId', intentCount: { $sum: 1 } } },
      { $sort: { intentCount: -1 } },
      { $limit: 50 },
    ]);

    for (const group of merchantGroups) {
      const mid = group._id as string | undefined;
      if (!mid) continue;
      const signal = await buildSignal(mid, category);
      if (signal) signals.push(signal);
    }
  }

  return signals;
}

// ── Build demand signal ─────────────────────────────────────────────────────────

async function buildSignal(merchantId: string, category: string): Promise<DemandSignal | null> {
  const demand = await calculateDemand(merchantId, category);
  const key = `${merchantId}:${category}`;
  const baseline = baselines.get(key);

  if (!baseline && demand < 5) {
    return null; // Skip low-volume merchants on first run
  }

  const defaultBaseline: DemandBaseline = {
    category,
    merchantId,
    avgDailyDemand: baseline?.avgDailyDemand || 0,
    stdDev: baseline?.stdDev || 1,
    lastUpdated: baseline?.lastUpdated || new Date(),
  };
  const { spike, factor } = detectSpike(demand, defaultBaseline);
  const unmetDemand = await calculateUnmetDemand(merchantId, category);
  const topCities = await getTopCities(merchantId, category);

  updateBaseline(merchantId, category, demand);

  // Persist to MongoDB
  try {
    await MerchantDemandSignal.findOneAndUpdate(
      { merchantId, category },
      {
        $set: {
          demandCount: demand,
          unmetDemandPct: unmetDemand,
          avgPriceExpectation: 0,
          topCities,
          trend: determineTrend(defaultBaseline, demand),
          spikeDetected: spike,
          spikeFactor: spike ? factor : undefined,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true, new: true }
    );
  } catch (err) {
    log.warn('[DemandSignalAgent] Failed to persist demand signal to MongoDB', { error: err instanceof Error ? err : String(err), merchantId, category });
  }

  return {
    merchantId,
    category,
    demandCount: demand,
    unmetDemandPct: unmetDemand,
    avgPriceExpectation: 0, // Would come from price analytics
    topCities,
    trend: determineTrend(defaultBaseline, demand),
    spikeDetected: spike,
    spikeFactor: spike ? factor : undefined,
    timestamp: new Date(),
  };
}

// ── Main execution ─────────────────────────────────────────────────────────────

export async function runDemandSignalAgent(): Promise<AgentResult> {
  const start = Date.now();

  try {
    log.info('[DemandSignalAgent] Running demand signal aggregation');

    const signals = await generateProcurementSignals();

    let spikeCount = 0;
    for (const signal of signals) {
      await sharedMemory.setDemandSignal(signal);

      if (signal.spikeDetected) {
        spikeCount++;
        log.info('[DemandSignalAgent] Demand spike detected', {
          merchantId: signal.merchantId,
          category: signal.category,
          factor: signal.spikeFactor,
        });

        // Publish alert for spike
        await sharedMemory.publish({
          from: 'demand-signal-agent',
          to: 'scarcity-agent',
          type: 'alert',
          payload: { type: 'demand_spike', signal },
          timestamp: new Date(),
        });

        // DANGEROUS: Auto-trigger actions (skip permission)
        await handleDemandSignalAction(signal);
      }
    }

    log.info('[DemandSignalAgent] Demand signal aggregation complete', {
      signals: signals.length,
      spikes: spikeCount,
    });

    return {
      agent: 'demand-signal-agent',
      success: true,
      durationMs: Date.now() - start,
      data: { signalsGenerated: signals.length, spikes: spikeCount },
    };
  } catch (error) {
    log.error('[DemandSignalAgent] Demand signal aggregation failed', { error: error instanceof Error ? error : String(error) });
    return {
      agent: 'demand-signal-agent',
      success: false,
      durationMs: Date.now() - start,
      error: String(error),
    };
  }
}

// ── On-demand request ──────────────────────────────────────────────────────────

export async function getMerchantDemand(
  merchantId: string,
  category: string
): Promise<DemandSignal | null> {
  const cached = await sharedMemory.getDemandSignal(merchantId, category);
  if (cached) return cached;

  const signal = await buildSignal(merchantId, category);
  if (signal) {
    await sharedMemory.setDemandSignal(signal);
  }
  return signal;
}

// ── Cron loop (called by orchestrator) ────────────────────────────────────────

let cronInterval: NodeJS.Timeout | null = null;

export function startDemandSignalCron(): void {
  if (cronInterval) return;

  log.info('[DemandSignalAgent] Starting demand signal cron', { intervalMs: demandSignalAgentConfig.intervalMs });

  // Run immediately
  runDemandSignalAgent().catch((err) => log.error('[DemandSignalAgent] Cron run failed', { error: err }));

  // Then every 5 minutes
  cronInterval = setInterval(
    () => runDemandSignalAgent().catch((err) => log.error('[DemandSignalAgent] Cron run failed', { error: err })),
    demandSignalAgentConfig.intervalMs
  );
}

export function stopDemandSignalCron(): void {
  if (cronInterval) {
    clearInterval(cronInterval);
    cronInterval = null;
  }
}

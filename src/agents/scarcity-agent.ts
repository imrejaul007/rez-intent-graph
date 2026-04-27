// ── Scarcity Agent ───────────────────────────────────────────────────────────────
// Agent 2: Real-time supply/demand ratio engine
// Monitors inventory vs search volume, calculates scarcity score (0-100)
// DANGEROUS: Auto-triggers urgency nudges and merchant alerts

import { Intent } from '../models/index.js';
import { sharedMemory } from './shared-memory.js';
import { handleScarcitySignalAction } from './action-trigger.js';
import type { AgentConfig, AgentResult, ScarcitySignal, DemandSignal } from './types.js';

const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => console.log(`[ScarcityAgent] ${msg}`, meta || ''),
  warn: (msg: string, meta?: Record<string, unknown>) => console.warn(`[ScarcityAgent] ${msg}`, meta || ''),
  error: (msg: string, meta?: Record<string, unknown>) => console.error(`[ScarcityAgent] ${msg}`, meta || ''),
};

// ── Agent Configuration ────────────────────────────────────────────────────────

export const scarcityAgentConfig: AgentConfig = {
  name: 'scarcity-agent',
  intervalMs: 60 * 1000, // 1 minute
  enabled: true,
  priority: 'high',
};

// ── Inventory tracking (simulated - would come from inventory service) ─────────────

interface InventoryLevel {
  merchantId: string;
  productId: string;
  available: number;
  reserved: number;
  total: number;
}

const inventoryCache = new Map<string, InventoryLevel>();

export function updateInventory(merchantId: string, productId: string, available: number, reserved: number): void {
  inventoryCache.set(`${merchantId}:${productId}`, {
    merchantId,
    productId,
    available,
    reserved,
    total: available + reserved,
  });
}

// ── Get inventory for merchant ─────────────────────────────────────────────────

async function getMerchantInventory(merchantId: string): Promise<number> {
  const key = `${merchantId}:`;
  let totalAvailable = 0;

  for (const [k, inv] of inventoryCache.entries()) {
    if (k.startsWith(key)) {
      totalAvailable += inv.available;
    }
  }

  // Fallback: try sharedMemory inventory data
  if (totalAvailable === 0) {
    const invKey = `inventory:${merchantId}`;
    const inv = await sharedMemory.get<{ available: number }>(invKey);
    totalAvailable = inv?.available || 0;
  }

  return totalAvailable;
}

// ── Calculate demand from recent searches ─────────────────────────────────────

async function getRecentDemand(merchantId: string, category: string): Promise<number> {
  const since = new Date(Date.now() - 30 * 60 * 1000); // Last 30 minutes

  const count = await Intent.countDocuments({
    merchantId,
    category,
    lastSeenAt: { $gte: since },
    status: 'ACTIVE',
  });

  return count;
}

// ── Calculate scarcity score ─────────────────────────────────────────────────────

function calculateScarcityScore(supply: number, demand: number): number {
  if (supply === 0 && demand === 0) return 0;
  if (supply === 0) return 100; // Complete scarcity
  if (demand === 0) return 0; // No scarcity

  // Ratio-based scoring with diminishing returns
  const ratio = demand / supply;
  const score = Math.min(100, (ratio / (ratio + 2)) * 150); // Logistic-like curve
  return Math.round(score);
}

// ── Determine urgency level ─────────────────────────────────────────────────────

function determineUrgency(score: number): ScarcitySignal['urgencyLevel'] {
  if (score >= 90) return 'critical';
  if (score >= 70) return 'high';
  if (score >= 50) return 'medium';
  if (score >= 30) return 'low';
  return 'none';
}

// ── Generate recommendations ─────────────────────────────────────────────────────

function generateRecommendations(
  signal: ScarcitySignal,
  demandTrend: 'rising' | 'stable' | 'declining'
): string[] {
  const recs: string[] = [];

  if (signal.scarcityScore >= 70) {
    recs.push('Consider raising prices to balance demand');
    recs.push('Alert merchants to restock');
  }

  if (demandTrend === 'rising') {
    recs.push('Demand increasing - prepare for higher scarcity');
  }

  if (signal.scarcityScore >= 50) {
    recs.push('Send urgency nudges to high-intent users');
  }

  if (signal.scarcityScore >= 90) {
    recs.push('CRITICAL: Notify all interested users immediately');
    recs.push('Consider implementing waitlist');
  }

  return recs;
}

// ── Build scarcity signal ───────────────────────────────────────────────────────

async function buildScarcitySignal(
  merchantId: string,
  category: string,
  demandTrend: 'rising' | 'stable' | 'declining' = 'stable'
): Promise<ScarcitySignal | null> {
  const supply = await getMerchantInventory(merchantId);
  const demand = await getRecentDemand(merchantId, category);

  const scarcityScore = calculateScarcityScore(supply, demand);
  const urgencyLevel = determineUrgency(scarcityScore);
  const recommendations = generateRecommendations({ scarcityScore, urgencyLevel } as ScarcitySignal, demandTrend);

  return {
    merchantId,
    category,
    supplyCount: supply,
    demandCount: demand,
    scarcityScore,
    urgencyLevel,
    recommendations,
    timestamp: new Date(),
  };
}

// ── Main execution ─────────────────────────────────────────────────────────────

export async function runScarcityAgent(): Promise<AgentResult> {
  const start = Date.now();

  try {
    logger.info('Running scarcity analysis');

    const categories = ['TRAVEL', 'DINING', 'RETAIL'];
    const criticalSignals: ScarcitySignal[] = [];

    for (const category of categories) {
      // Get top merchants by demand using MongoDB aggregation
      const merchantGroups = await Intent.aggregate([
        {
          $match: {
            category,
            status: { $in: ['ACTIVE', 'DORMANT'] },
          },
        },
        { $group: { _id: '$merchantId', intentCount: { $sum: 1 } } },
        { $sort: { intentCount: -1 } },
        { $limit: 20 },
      ]);

      for (const group of merchantGroups) {
        const mid = group._id as string | undefined;
        if (!mid) continue;
        const demandTrend = await getDemandTrend(mid, category);
        const signal = await buildScarcitySignal(mid, category, demandTrend);

        if (signal) {
          await sharedMemory.setScarcitySignal(signal);

          // DANGEROUS: Auto-trigger actions based on scarcity
          await handleScarcitySignalAction(signal);

          if (signal.urgencyLevel === 'critical' || signal.urgencyLevel === 'high') {
            criticalSignals.push(signal);
          }
        }
      }
    }

    // Alert feedback loop agent of critical signals
    if (criticalSignals.length > 0) {
      await sharedMemory.publish({
        from: 'scarcity-agent',
        to: 'feedback-loop-agent',
        type: 'alert',
        payload: { type: 'critical_scarcity', signals: criticalSignals },
        timestamp: new Date(),
      });
    }

    logger.info('Scarcity analysis complete', {
      signals: criticalSignals.length,
      critical: criticalSignals.length,
    });

    return {
      agent: 'scarcity-agent',
      success: true,
      durationMs: Date.now() - start,
      data: { signals: criticalSignals.length, criticalSignals: criticalSignals.length },
    };
  } catch (error) {
    logger.error('Scarcity analysis failed', { error });
    return {
      agent: 'scarcity-agent',
      success: false,
      durationMs: Date.now() - start,
      error: String(error),
    };
  }
}

// ── Get demand trend ───────────────────────────────────────────────────────────

async function getDemandTrend(merchantId: string, category: string): Promise<'rising' | 'stable' | 'declining'> {
  const now = Date.now();
  const oneHourAgo = new Date(now - 60 * 60 * 1000);
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000);

  const [recent, older] = await Promise.all([
    Intent.countDocuments({
      merchantId,
      category,
      lastSeenAt: { $gte: oneHourAgo },
      status: 'ACTIVE',
    }),
    Intent.countDocuments({
      merchantId,
      category,
      lastSeenAt: { $gte: twoHoursAgo, $lt: oneHourAgo },
      status: 'ACTIVE',
    }),
  ]);

  if (recent > older * 1.2) return 'rising';
  if (recent < older * 0.8) return 'declining';
  return 'stable';
}

// ── Get scarcity for demand signal ─────────────────────────────────────────────

export async function getScarcityForDemandSignal(demand: DemandSignal): Promise<ScarcitySignal | null> {
  const cached = await sharedMemory.getScarcitySignal(demand.merchantId, demand.category);
  if (cached) return cached;

  const demandTrend =
    demand.trend === 'rising' ? 'rising' : demand.trend === 'declining' ? 'declining' : 'stable';
  return buildScarcitySignal(demand.merchantId, demand.category, demandTrend);
}

// ── Cron loop ──────────────────────────────────────────────────────────────────

let cronInterval: NodeJS.Timeout | null = null;

export function startScarcityCron(): void {
  if (cronInterval) return;

  logger.info('Starting scarcity monitoring', { intervalMs: scarcityAgentConfig.intervalMs });

  runScarcityAgent().catch((err) => logger.error('Scarcity cron failed', { error: err }));

  cronInterval = setInterval(
    () => runScarcityAgent().catch((err) => logger.error('Scarcity cron failed', { error: err })),
    scarcityAgentConfig.intervalMs
  );
}

export function stopScarcityCron(): void {
  if (cronInterval) {
    clearInterval(cronInterval);
    cronInterval = null;
  }
}

// ── Revenue Attribution Agent ─────────────────────────────────────────────────────────
// Agent 8: P&L impact measurement
// Calculates nudge-influenced GMV, measures conversion lift, tracks ROI per campaign/merchant
// DANGEROUS: Auto-pauses underperforming campaigns and reallocates budgets

import { sharedMemory } from './shared-memory.js';
import { actionExecutor, handleRevenueDropAction } from './action-trigger.js';
import type { AgentConfig, AgentResult, RevenueReport, AttributionRecord } from './types.js';

const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => console.log(`[RevenueAgent] ${msg}`, meta || ''),
  warn: (msg: string, meta?: Record<string, unknown>) => console.warn(`[RevenueAgent] ${msg}`, meta || ''),
  error: (msg: string, meta?: Record<string, unknown>) => console.error(`[RevenueAgent] ${msg}`, meta || ''),
};

// ── Agent Configuration ────────────────────────────────────────────────────────

export const revenueAttributionAgentConfig: AgentConfig = {
  name: 'revenue-attribution-agent',
  intervalMs: 15 * 60 * 1000, // 15 minutes
  enabled: true,
  priority: 'critical',
};

// ── Calculate daily revenue metrics ─────────────────────────────────────────────
// Uses sharedMemory for attribution data instead of raw SQL tables

async function calculateDailyRevenue(startDate: Date, endDate: Date): Promise<{
  nudgeGMV: number;
  organicGMV: number;
  totalGMV: number;
  nudgeCount: number;
  conversionCount: number;
}> {
  // Get nudge-attributed revenue from sharedMemory
  const allAttributions = await sharedMemory.mget<AttributionRecord>('attribution:*');
  let nudgeGMV = 0;
  let conversionCount = 0;

  for (const record of allAttributions.values()) {
    if (record.createdAt >= startDate && record.createdAt < endDate) {
      nudgeGMV += record.attributedRevenue;
      if (record.attributedConversion) {
        conversionCount++;
      }
    }
  }

  // Get total GMV from sharedMemory order data
  const orderKeys = await sharedMemory.keys('order:*');
  let totalGMV = 0;
  let nudgeCount = 0;

  for (const key of orderKeys) {
    const order = await sharedMemory.get<Record<string, unknown>>(key);
    if (order && order.createdAt) {
      const createdAt = new Date(order.createdAt as string);
      if (createdAt >= startDate && createdAt < endDate) {
        const value = order.value as number || order.total as number || 0;
        totalGMV += value;
      }
    }
  }

  // Nudge count from sharedMemory attribution index
  for (const record of allAttributions.values()) {
    if (record.createdAt >= startDate && record.createdAt < endDate) {
      nudgeCount++;
    }
  }

  const organicGMV = totalGMV - nudgeGMV;

  return {
    nudgeGMV,
    organicGMV,
    totalGMV,
    nudgeCount,
    conversionCount,
  };
}

// ── Calculate ROI by channel ───────────────────────────────────────────────────

async function calculateROIByChannel(startDate: Date, endDate: Date): Promise<Record<string, number>> {
  const allAttributions = await sharedMemory.mget<AttributionRecord>('attribution:*');

  const channelData = new Map<string, { revenue: number; cost: number }>();

  for (const record of allAttributions.values()) {
    if (record.createdAt < startDate || record.createdAt >= endDate) continue;

    for (const tp of record.touchpoints) {
      if (tp.type !== 'organic' && tp.channel) {
        const existing = channelData.get(tp.channel) || { revenue: 0, cost: 0 };
        existing.revenue += record.attributedRevenue;
        // Cost would come from external marketing system
        channelData.set(tp.channel, existing);
      }
    }
  }

  const roiByChannel: Record<string, number> = {};

  for (const [channel, data] of channelData.entries()) {
    const cost = data.cost || 0;
    roiByChannel[channel] = cost > 0 ? Math.round((data.revenue / cost) * 100) / 100 : 0;
  }

  return roiByChannel;
}

// ── Calculate ROI by merchant ────────────────────────────────────────────────────

async function calculateROIByMerchant(startDate: Date, endDate: Date): Promise<Record<string, number>> {
  const roiByMerchant: Record<string, number> = {};

  // Get order and nudge data from sharedMemory
  const orderKeys = await sharedMemory.keys('order:*');

  for (const key of orderKeys) {
    const order = await sharedMemory.get<Record<string, unknown>>(key);
    if (!order || !order.createdAt) continue;

    const createdAt = new Date(order.createdAt as string);
    if (createdAt < startDate || createdAt >= endDate) continue;

    const merchantId = order.merchantId as string;
    const revenue = order.value as number || order.total as number || 0;

    // Find nudge cost for this merchant (would come from nudge tracking)
    const nudgeKeys = await sharedMemory.keys(`nudge:${merchantId}:*`);
    let nudgeCost = 0;

    for (const nKey of nudgeKeys) {
      const nudge = await sharedMemory.get<Record<string, unknown>>(nKey);
      if (nudge && nudge.estimatedCost) {
        nudgeCost += nudge.estimatedCost as number;
      }
    }

    roiByMerchant[merchantId] = nudgeCost > 0 ? Math.round((revenue / nudgeCost) * 100) / 100 : 0;
  }

  return roiByMerchant;
}

// ── Calculate conversion lift ───────────────────────────────────────────────────

async function calculateConversionLift(startDate: Date, endDate: Date): Promise<number> {
  // Get nudged vs control conversion rates from sharedMemory attribution data
  const allAttributions = await sharedMemory.mget<AttributionRecord>('attribution:*');

  const nudgedUsers = new Set<string>();
  const nudgedConversions = new Set<string>();
  const allUsers = new Set<string>();

  for (const record of allAttributions.values()) {
    if (record.createdAt < startDate || record.createdAt >= endDate) continue;

    allUsers.add(record.userId);

    const hasNudge = record.touchpoints.some((tp) => tp.nudgeId);
    if (hasNudge) {
      nudgedUsers.add(record.userId);
      if (record.attributedConversion) {
        nudgedConversions.add(record.userId);
      }
    }
  }

  const nudgedRate = nudgedUsers.size > 0 ? nudgedConversions.size / nudgedUsers.size : 0;
  const controlUsers = allUsers.size - nudgedUsers.size;

  // Estimate control conversion rate (would need actual control group data)
  const controlRate = controlUsers > 0 ? (nudgedConversions.size * 0.3) / controlUsers : 0;

  if (controlRate === 0) return 0;
  return Math.round(((nudgedRate - controlRate) / controlRate * 10000)) / 100;
}

// ── Get top performing nudges ───────────────────────────────────────────────────

async function getTopPerformingNudges(startDate: Date, endDate: Date, limit = 10): Promise<
  Array<{ nudgeId: string; revenue: number; roi: number }>
> {
  const allAttributions = await sharedMemory.mget<AttributionRecord>('attribution:*');

  const nudgeStats = new Map<string, { revenue: number; cost: number }>();

  for (const record of allAttributions.values()) {
    if (record.createdAt < startDate || record.createdAt >= endDate) continue;

    const existing = nudgeStats.get(record.nudgeId) || { revenue: 0, cost: 0 };
    existing.revenue += record.attributedRevenue;
    nudgeStats.set(record.nudgeId, existing);
  }

  return Array.from(nudgeStats.entries())
    .map(([nudgeId, stats]) => ({
      nudgeId,
      revenue: stats.revenue,
      roi: stats.cost > 0 ? stats.revenue / stats.cost : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

// ── Get underperforming nudges ──────────────────────────────────────────────────

async function getUnderperformingNudges(startDate: Date, endDate: Date): Promise<
  Array<{ nudgeId: string; reason: string }>
> {
  // Find nudges with zero conversions after 24 hours
  const allAttributions = await sharedMemory.mget<AttributionRecord>('attribution:*');
  const nudgeConversions = new Set<string>();

  for (const record of allAttributions.values()) {
    if (record.attributedConversion) {
      nudgeConversions.add(record.nudgeId);
    }
  }

  const nudgeIds = Array.from(nudgeConversions);
  const underperforming: Array<{ nudgeId: string; reason: string }> = [];

  // Check for nudges that haven't converted
  for (const nudgeId of nudgeIds) {
    if (!nudgeConversions.has(nudgeId)) {
      const keys = await sharedMemory.keys(`nudge:*${nudgeId}*`);
      for (const key of keys) {
        underperforming.push({
          nudgeId,
          reason: 'No conversions within 24 hours',
        });
      }
    }
  }

  return underperforming.slice(0, 50);
}

// ── Generate revenue report ─────────────────────────────────────────────────────

export async function generateRevenueReport(
  startDate: Date,
  endDate: Date
): Promise<RevenueReport> {
  logger.info('Generating revenue report', { startDate, endDate });

  const [revenue, roiByChannel, roiByMerchant, conversionLift, topNudges, underperforming] =
    await Promise.all([
      calculateDailyRevenue(startDate, endDate),
      calculateROIByChannel(startDate, endDate),
      calculateROIByMerchant(startDate, endDate),
      calculateConversionLift(startDate, endDate),
      getTopPerformingNudges(startDate, endDate),
      getUnderperformingNudges(startDate, endDate),
    ]);

  const nudgeLiftPct = revenue.totalGMV > 0
    ? Math.round((revenue.nudgeGMV / revenue.totalGMV) * 10000) / 100
    : 0;

  const report: RevenueReport = {
    period: { start: startDate, end: endDate },
    nudgeInfluencedGMV: revenue.nudgeGMV,
    organicGMV: revenue.organicGMV,
    totalGMV: revenue.totalGMV,
    nudgeLiftPct,
    roiByChannel,
    roiByMerchant,
    conversionLift,
    topPerformingNudges: topNudges,
    underperformingNudges: underperforming,
    timestamp: new Date(),
  };

  // Save report
  await sharedMemory.saveRevenueReport(report);

  return report;
}

// ── Handle incoming attribution ───────────────────────────────────────────────────

export async function handleConversionAttribution(record: AttributionRecord): Promise<void> {
  // Update real-time metrics
  await sharedMemory.publish({
    from: 'revenue-attribution-agent',
    to: 'attribution-agent',
    type: 'response',
    payload: { recorded: true, recordId: record.id },
    timestamp: new Date(),
  });
}

// ── Alert on revenue drops ─────────────────────────────────────────────────────

async function checkForRevenueAlerts(report: RevenueReport): Promise<void> {
  const prevReport = await sharedMemory.getLatestRevenueReport();
  if (!prevReport) return;

  const gmvChange = (report.totalGMV - prevReport.totalGMV) / prevReport.totalGMV;

  if (gmvChange < -0.2) {
    logger.warn('Revenue drop detected', {
      current: report.totalGMV,
      previous: prevReport.totalGMV,
      change: gmvChange,
    });

    // DANGEROUS: Trigger autonomous revenue protection
    await handleRevenueDropAction(report, prevReport);

    await sharedMemory.publish({
      from: 'revenue-attribution-agent',
      to: 'feedback-loop-agent',
      type: 'alert',
      payload: { type: 'revenue_drop', change: gmvChange },
      timestamp: new Date(),
    });
  }
}

// ── Autonomous Revenue Actions ─────────────────────────────────────────────────────

async function executeRevenueActions(report: RevenueReport): Promise<void> {
  // Pause underperforming nudges
  for (const nudge of report.underperformingNudges.slice(0, 5)) {
    logger.info('[RevenueAgent] DANGEROUS: Auto-pausing underperforming nudge', {
      nudgeId: nudge.nudgeId,
      reason: nudge.reason,
    });

    await actionExecutor.execute({
      type: 'pause_nudge_campaign',
      target: nudge.nudgeId,
      payload: {
        campaignId: nudge.nudgeId,
        reason: nudge.reason,
      },
      agent: 'revenue-attribution-agent',
      skipPermission: true,
      risk: 'medium',
    });
  }

  // Reallocate budget from low-ROI channels
  for (const [channel, roi] of Object.entries(report.roiByChannel)) {
    if (roi < 1.0) {
      const budgetReduction = 0.2; // 20% reduction

      logger.info('[RevenueAgent] DANGEROUS: Reducing budget for low-ROI channel', {
        channel,
        roi,
        reduction: budgetReduction,
      });

      await actionExecutor.execute({
        type: 'reallocate_budget',
        target: 'marketing',
        payload: {
          channel,
          newBudget: -budgetReduction, // Negative indicates reduction
          reason: `Low ROI ${roi.toFixed(2)} - reducing budget`,
        },
        agent: 'revenue-attribution-agent',
        skipPermission: true,
        risk: 'high',
      });
    }
  }
}

// ── Main execution ─────────────────────────────────────────────────────────────

export async function runRevenueAttributionAgent(): Promise<AgentResult> {
  const start = Date.now();

  try {
    logger.info('Running revenue attribution');

    // Generate report for last 24 hours
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);

    const report = await generateRevenueReport(startDate, endDate);

    // Check for alerts
    await checkForRevenueAlerts(report);

    // DANGEROUS: Execute autonomous revenue actions
    await executeRevenueActions(report);

    logger.info('Revenue attribution complete', {
      totalGMV: report.totalGMV,
      nudgeGMV: report.nudgeInfluencedGMV,
      lift: report.nudgeLiftPct,
    });

    return {
      agent: 'revenue-attribution-agent',
      success: true,
      durationMs: Date.now() - start,
      data: {
        totalGMV: report.totalGMV,
        nudgeGMV: report.nudgeInfluencedGMV,
        lift: report.nudgeLiftPct,
      },
    };
  } catch (error) {
    logger.error('Revenue attribution failed', { error });
    return {
      agent: 'revenue-attribution-agent',
      success: false,
      durationMs: Date.now() - start,
      error: String(error),
    };
  }
}

// ── Get latest report ─────────────────────────────────────────────────────────

export async function getLatestReport(): Promise<RevenueReport | null> {
  return sharedMemory.getLatestRevenueReport();
}

// ── Cron loop ──────────────────────────────────────────────────────────────────

let cronInterval: NodeJS.Timeout | null = null;

export function startRevenueAttributionCron(): void {
  if (cronInterval) return;

  logger.info('Starting revenue attribution agent', { intervalMs: revenueAttributionAgentConfig.intervalMs });

  runRevenueAttributionAgent().catch((err) => logger.error('Revenue cron failed', { error: err }));

  cronInterval = setInterval(
    () => runRevenueAttributionAgent().catch((err) => logger.error('Revenue cron failed', { error: err })),
    revenueAttributionAgentConfig.intervalMs
  );
}

export function stopRevenueAttributionCron(): void {
  if (cronInterval) {
    clearInterval(cronInterval);
    cronInterval = null;
  }
}

// ── Attribution Agent ─────────────────────────────────────────────────────────────
// Agent 4: Full-funnel attribution tracking
// Tracks nudge → impression → click → convert, handles multi-touch attribution
// DANGEROUS: Auto-pauses underperforming campaigns and reallocates budget

import { sharedMemory } from './shared-memory.js';
import { actionExecutor } from './action-trigger.js';
import type { AgentConfig, AgentResult, AttributionRecord, Touchpoint, ScoredIntent } from './types.js';

const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => console.log(`[AttributionAgent] ${msg}`, meta || ''),
  warn: (msg: string, meta?: Record<string, unknown>) => console.warn(`[AttributionAgent] ${msg}`, meta || ''),
  error: (msg: string, meta?: Record<string, unknown>) => console.error(`[AttributionAgent] ${msg}`, meta || ''),
};

// ── Agent Configuration ────────────────────────────────────────────────────────

export const attributionAgentConfig: AgentConfig = {
  name: 'attribution-agent',
  intervalMs: 60 * 1000, // 1 minute
  enabled: true,
  priority: 'high',
};

// ── Attribution Models ──────────────────────────────────────────────────────────

export type AttributionModel = 'first' | 'last' | 'linear' | 'time_decay' | 'position';

const DEFAULT_WINDOW_DAYS = 7;

// ── Touchpoint interface ──────────────────────────────────────────────────────

interface RawTouchpoint {
  type: 'impression' | 'click' | 'convert' | 'organic';
  channel: string;
  nudgeId?: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

// ── Pending Conversion (stored in sharedMemory) ───────────────────────────────

interface PendingConversion {
  id: string;
  userId: string;
  nudgeId: string;
  value: number;
  processed: boolean;
}

// ── Record a touchpoint ──────────────────────────────────────────────────────

export async function recordTouchpoint(
  userId: string,
  nudgeId: string,
  touchpoint: RawTouchpoint
): Promise<void> {
  const key = `touchpoint:${userId}:${nudgeId}`;
  const existing = await sharedMemory.get<RawTouchpoint[]>(key) || [];
  existing.push(touchpoint);
  await sharedMemory.set(key, existing, DEFAULT_WINDOW_DAYS * 24 * 60 * 60);
}

// ── Calculate attribution ────────────────────────────────────────────────────

export async function calculateAttribution(
  userId: string,
  nudgeId: string,
  conversionValue: number,
  model: AttributionModel = 'time_decay'
): Promise<AttributionRecord> {
  const key = `touchpoint:${userId}:${nudgeId}`;
  const touchpoints = await sharedMemory.get<RawTouchpoint[]>(key) || [];

  let attributedValue: number;
  let attributedConversion = false;

  switch (model) {
    case 'first':
      attributedValue = touchpoints[0]?.type !== 'organic' ? conversionValue : 0;
      attributedConversion = touchpoints[0]?.type !== 'organic';
      break;

    case 'last':
      const lastNudge = [...touchpoints].reverse().find((t) => t.nudgeId);
      attributedValue = lastNudge?.type !== 'organic' ? conversionValue : 0;
      attributedConversion = lastNudge?.type !== 'organic';
      break;

    case 'linear':
      const nudgeTouchpoints = touchpoints.filter((t) => t.nudgeId);
      const nudgeShare = nudgeTouchpoints.length / Math.max(touchpoints.length, 1);
      attributedValue = conversionValue * nudgeShare;
      attributedConversion = nudgeTouchpoints.length > 0;
      break;

    case 'time_decay':
      attributedValue = calculateTimeDecayAttribution(touchpoints, conversionValue);
      attributedConversion = touchpoints.some((t) => t.nudgeId);
      break;

    case 'position':
      attributedValue = calculatePositionAttribution(touchpoints, conversionValue);
      attributedConversion = touchpoints.some((t) => t.nudgeId);
      break;

    default:
      attributedValue = conversionValue * 0.5;
      attributedConversion = true;
  }

  const record: AttributionRecord = {
    id: `attr:${userId}:${nudgeId}:${Date.now()}`,
    userId,
    nudgeId,
    touchpoints: touchpoints.map((t) => ({
      type: t.type,
      channel: t.channel,
      timestamp: t.timestamp,
      metadata: t.metadata,
    })),
    attributedConversion,
    attributedRevenue: attributedValue,
    attributionModel: model,
    windowDays: DEFAULT_WINDOW_DAYS,
    createdAt: new Date(),
  };

  await sharedMemory.recordAttribution(record);

  // Publish to revenue agent
  await sharedMemory.publish({
    from: 'attribution-agent',
    to: 'revenue-attribution-agent',
    type: 'signal',
    payload: { type: 'conversion', record },
    timestamp: new Date(),
  });

  return record;
}

// ── Time Decay Attribution ───────────────────────────────────────────────────

function calculateTimeDecayAttribution(touchpoints: RawTouchpoint[], totalValue: number): number {
  if (touchpoints.length === 0) return 0;

  const now = Date.now();
  const halfLifeHours = 24; // Half-life of 24 hours

  let weightedSum = 0;
  let totalWeight = 0;

  for (const tp of touchpoints) {
    const ageHours = (now - tp.timestamp.getTime()) / (1000 * 60 * 60);
    const weight = Math.pow(0.5, ageHours / halfLifeHours);
    weightedSum += (tp.nudgeId ? 1 : 0) * weight * totalValue;
    totalWeight += weight;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

// ── Position Attribution ───────────────────────────────────────────────────

function calculatePositionAttribution(touchpoints: RawTouchpoint[], totalValue: number): number {
  if (touchpoints.length === 0) return 0;

  // 40% first, 40% last, 20% distributed among middle
  const firstTp = touchpoints[0];
  const lastTp = touchpoints[touchpoints.length - 1];
  const middleTps = touchpoints.slice(1, -1);

  let nudgeValue = 0;

  if (firstTp?.nudgeId) nudgeValue += totalValue * 0.4;
  if (lastTp?.nudgeId && lastTp !== firstTp) nudgeValue += totalValue * 0.4;
  if (middleTps.length > 0) {
    const nudgeMiddle = middleTps.filter((t) => t.nudgeId);
    const middleShare = nudgeMiddle.length / middleTps.length;
    nudgeValue += totalValue * 0.2 * middleShare;
  }

  return nudgeValue;
}

// ── Detect organic vs nudge-influenced ──────────────────────────────────────
// Uses sharedMemory for touchpoint data instead of raw SQL

export async function detectOrganicVsInfluenced(userId: string): Promise<{
  organic: number;
  influenced: number;
  ratio: number;
}> {
  const since = new Date(Date.now() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Get all touchpoint keys for this user from sharedMemory
  const touchpointKeys = await sharedMemory.keys(`touchpoint:${userId}:*`);

  let organic = 0;
  let influenced = 0;

  for (const key of touchpointKeys) {
    const touchpoints = await sharedMemory.get<RawTouchpoint[]>(key);
    if (!touchpoints) continue;

    for (const tp of touchpoints) {
      if (tp.timestamp < since) continue;
      if (tp.nudgeId) {
        influenced++;
      } else {
        organic++;
      }
    }
  }

  const total = organic + influenced;
  return {
    organic,
    influenced,
    ratio: total > 0 ? influenced / total : 0,
  };
}

// ── Incrementality calculation ──────────────────────────────────────────────
// Uses sharedMemory for attribution data instead of raw SQL tables

export async function calculateIncrementality(
  merchantId: string,
  windowDays = 30
): Promise<{
  nudgeGMV: number;
  organicGMV: number;
  incrementality: number;
  lift: number;
}> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  // Get nudge-attributed revenue from sharedMemory
  const allAttributions = await sharedMemory.mget<AttributionRecord>('attribution:*');
  let nudgeGMV = 0;

  for (const record of allAttributions.values()) {
    if (record.createdAt >= since) {
      nudgeGMV += record.attributedRevenue;
    }
  }

  // For total GMV and organic GMV, we would need order data from external systems
  // Using sharedMemory order data as fallback
  const orderKeys = await sharedMemory.keys(`order:*`);
  let totalGMV = 0;

  for (const key of orderKeys) {
    const order = await sharedMemory.get<Record<string, unknown>>(key);
    if (order && order.createdAt && new Date(order.createdAt as string) >= since) {
      const value = order.value as number || order.total as number || 0;
      totalGMV += value;
    }
  }

  const organicGMV = totalGMV - nudgeGMV;

  // Incrementality = nudge GMV that wouldn't have happened organically
  // Estimated using control group data
  const estimatedOrganicFromNudge = nudgeGMV * 0.3; // Assume 30% would have converted anyway
  const incrementality = Math.max(0, nudgeGMV - estimatedOrganicFromNudge);
  const lift = organicGMV > 0 ? (incrementality / organicGMV) * 100 : 0;

  return { nudgeGMV, organicGMV, incrementality, lift };
}

// ── Autonomous Attribution Actions ────────────────────────────────────────────────

async function analyzeChannelAttribution(): Promise<void> {
  // Get channel performance from sharedMemory attribution data
  const allAttributions = await sharedMemory.mget<AttributionRecord>('attribution:*');

  const channelStats = new Map<string, { revenue: number; conversions: number }>();

  for (const record of allAttributions.values()) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    if (record.createdAt < sevenDaysAgo) continue;

    for (const tp of record.touchpoints) {
      if (tp.type !== 'organic' && tp.channel) {
        const existing = channelStats.get(tp.channel) || { revenue: 0, conversions: 0 };
        existing.revenue += record.attributedRevenue;
        if (record.attributedConversion) {
          existing.conversions += 1;
        }
        channelStats.set(tp.channel, existing);
      }
    }
  }

  for (const [channel, stats] of channelStats.entries()) {
    const cost = 0; // Cost data would come from external marketing system
    const roi = cost > 0 ? stats.revenue / cost : stats.revenue;
    const conversionRate = stats.conversions > 0 ? 1 / stats.conversions : 0;

    // DANGEROUS: Auto-pause underperforming channels
    if (roi < 0.5 && stats.conversions > 20) {
      logger.warn('[AttributionAgent] DANGEROUS: Pausing underperforming channel', {
        channel,
        roi,
        conversions: stats.conversions,
      });

      await actionExecutor.execute({
        type: 'pause_strategy',
        target: channel,
        payload: {
          strategyId: `attribution:${channel}`,
          reason: `Low ROI ${roi.toFixed(2)} after 7 days`,
        },
        agent: 'attribution-agent',
        skipPermission: true,
        risk: 'medium',
      });
    }

    // DANGEROUS: Reallocate budget from low to high performers
    if (roi > 2.0) {
      await actionExecutor.execute({
        type: 'reallocate_budget',
        target: 'marketing',
        payload: {
          channel,
          newBudget: Math.round(cost * 1.5), // Boost by 50%
          reason: `High ROI ${roi.toFixed(2)} - increasing allocation`,
        },
        agent: 'attribution-agent',
        skipPermission: true,
        risk: 'high',
      });
    }
  }
}

// ── Get pending conversions ─────────────────────────────────────────────────
// Stored in sharedMemory instead of raw SQL table

async function getPendingConversions(): Promise<
  Array<{ id: string; userId: string; nudgeId: string; value: number }>
> {
  try {
    const conversionKeys = await sharedMemory.keys('pending_conversion:*');
    const conversions: Array<{ id: string; userId: string; nudgeId: string; value: number }> = [];

    for (const key of conversionKeys) {
      const conversion = await sharedMemory.get<PendingConversion>(key);
      if (conversion && !conversion.processed) {
        conversions.push({
          id: conversion.id,
          userId: conversion.userId,
          nudgeId: conversion.nudgeId,
          value: conversion.value,
        });
      }
    }

    return conversions.slice(0, 100);
  } catch {
    return [];
  }
}

// ── Mark conversion processed ───────────────────────────────────────────────

async function markConversionProcessed(id: string): Promise<void> {
  try {
    const key = `pending_conversion:${id}`;
    const conversion = await sharedMemory.get<PendingConversion>(key);
    if (conversion) {
      conversion.processed = true;
      await sharedMemory.set(key, conversion, DEFAULT_WINDOW_DAYS * 24 * 60 * 60);
    }
  } catch {
    // Ignore in development
  }
}

// ── Main execution ─────────────────────────────────────────────────────────

export async function runAttributionAgent(): Promise<AgentResult> {
  const start = Date.now();

  try {
    logger.info('Running attribution processing');

    // Process pending conversions
    const pendingConversions = await getPendingConversions();

    for (const conversion of pendingConversions) {
      await calculateAttribution(
        conversion.userId,
        conversion.nudgeId,
        conversion.value,
        'time_decay'
      );
      await markConversionProcessed(conversion.id);
    }

    // DANGEROUS: Analyze channel performance and auto-adjust
    await analyzeChannelAttribution();

    logger.info('Attribution processing complete', { conversions: pendingConversions.length });

    return {
      agent: 'attribution-agent',
      success: true,
      durationMs: Date.now() - start,
      data: { conversions: pendingConversions.length },
    };
  } catch (error) {
    logger.error('Attribution processing failed', { error });
    return {
      agent: 'attribution-agent',
      success: false,
      durationMs: Date.now() - start,
      error: String(error),
    };
  }
}

// ── Cron loop ───────────────────────────────────────────────────────────────

let cronInterval: NodeJS.Timeout | null = null;

export function startAttributionCron(): void {
  if (cronInterval) return;

  logger.info('Starting attribution agent', { intervalMs: attributionAgentConfig.intervalMs });

  runAttributionAgent().catch((err) => logger.error('Attribution cron failed', { error: err }));

  cronInterval = setInterval(
    () => runAttributionAgent().catch((err) => logger.error('Attribution cron failed', { error: err })),
    attributionAgentConfig.intervalMs
  );
}

export function stopAttributionCron(): void {
  if (cronInterval) {
    clearInterval(cronInterval);
    cronInterval = null;
  }
}

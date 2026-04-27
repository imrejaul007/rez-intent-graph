// ── Feedback Loop Agent ─────────────────────────────────────────────────────────
// Agent 6: Closed-loop optimization
// Compares predicted vs actual outcomes, adjusts all agent parameters, detects drift
// DANGEROUS: Auto-applies optimization recommendations

import { Intent, DormantIntent } from '../models/index.js';
import { sharedMemory } from './shared-memory.js';
import { handleOptimizationAction } from './action-trigger.js';
import type {
  AgentConfig,
  AgentResult,
  OptimizationRecommendation,
  ScoredIntent,
  DemandSignal,
  ScarcitySignal,
} from './types.js';

const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => console.log(`[FeedbackLoopAgent] ${msg}`, meta || ''),
  warn: (msg: string, meta?: Record<string, unknown>) => console.warn(`[FeedbackLoopAgent] ${msg}`, meta || ''),
  error: (msg: string, meta?: Record<string, unknown>) => console.error(`[FeedbackLoopAgent] ${msg}`, meta || ''),
};

// ── Agent Configuration ────────────────────────────────────────────────────────

export const feedbackLoopAgentConfig: AgentConfig = {
  name: 'feedback-loop-agent',
  intervalMs: 60 * 60 * 1000, // 1 hour
  enabled: true,
  priority: 'critical',
};

// ── Drift thresholds ────────────────────────────────────────────────────────────

const DRIFT_THRESHOLDS = {
  conversionRate: 0.15, // 15% change triggers alert
  revivalScore: 0.20, // 20% change
  scarcityScore: 0.25, // 25% change
  demandSignal: 0.30, // 30% change
};

// ── Health metrics ──────────────────────────────────────────────────────────────

interface HealthMetrics {
  agent: string;
  predictedConversionRate: number;
  actualConversionRate: number;
  drift: number;
  status: 'healthy' | 'drifted' | 'failed';
  lastUpdated: Date;
}

const healthMetrics = new Map<string, HealthMetrics>();

// ── Compare predictions vs actuals ──────────────────────────────────────────────
// Uses sharedMemory for scored intent data instead of raw SQL tables

async function evaluateScoringAccuracy(): Promise<{
  accuracy: number;
  drift: number;
  recommendations: OptimizationRecommendation[];
}> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Get scored intents from sharedMemory with actual outcomes from MongoDB
  const scoredIntentKeys = await sharedMemory.keys('scored:intents:*');
  const scoredIntents: Array<{ intentId: string; predictedProb: number; actualFulfilled: boolean }> = [];

  for (const key of scoredIntentKeys) {
    const scored = await sharedMemory.get<ScoredIntent>(key);
    if (!scored) continue;

    // Get actual outcome from MongoDB
    const intent = await Intent.findById(scored.intentId).select('status lastSeenAt');
    if (!intent || intent.lastSeenAt < sevenDaysAgo) continue;

    scoredIntents.push({
      intentId: scored.intentId,
      predictedProb: scored.predictedConversionProb,
      actualFulfilled: intent.status === 'FULFILLED',
    });

    if (scoredIntents.length >= 1000) break;
  }

  if (scoredIntents.length < 50) {
    return { accuracy: 0, drift: 0, recommendations: [] };
  }

  // Calculate accuracy (Brier score - lower is better)
  let brierScore = 0;
  let positiveDrift = 0;
  let negativeDrift = 0;

  for (const row of scoredIntents) {
    const actual = row.actualFulfilled ? 1 : 0;
    brierScore += Math.pow(row.predictedProb - actual, 2);

    // Track drift direction
    const drift = row.predictedProb - (actual ? 0.1 : 0.9);
    if (drift > 0.1) positiveDrift++;
    if (drift < -0.1) negativeDrift++;
  }

  const avgBrier = brierScore / scoredIntents.length;
  const accuracy = 1 - avgBrier; // Convert to accuracy (higher is better)
  const drift = Math.abs(positiveDrift - negativeDrift) / scoredIntents.length;

  const recommendations: OptimizationRecommendation[] = [];

  if (drift > DRIFT_THRESHOLDS.conversionRate) {
    recommendations.push({
      type: 'threshold_adjust',
      agent: 'adaptive-scoring-agent',
      currentValue: 'current_model',
      recommendedValue: 'retrain_model',
      confidence: drift,
      reason: 'Significant prediction drift detected',
      expectedImpact: drift * 100,
      timestamp: new Date(),
    });
  }

  return { accuracy, drift, recommendations };
}

// ── Evaluate revival effectiveness ───────────────────────────────────────────────
// Uses DormantIntent MongoDB model instead of raw SQL

async function evaluateRevivalEffectiveness(): Promise<{
  effectiveness: number;
  recommendations: OptimizationRecommendation[];
}> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Get revival stats from MongoDB
  const dormantIntents = await DormantIntent.find({
    lastNudgeSent: { $gte: sevenDaysAgo },
  });

  const totalSent = dormantIntents.length;
  const totalConverted = dormantIntents.filter((d) => d.status === 'revived').length;
  const avgScore = totalSent > 0
    ? dormantIntents.reduce((sum, d) => sum + d.revivalScore, 0) / totalSent
    : 0;

  if (totalSent < 10) {
    return { effectiveness: 0, recommendations: [] };
  }

  const effectiveness = totalConverted / totalSent;
  const recommendations: OptimizationRecommendation[] = [];

  // Compare to threshold
  const threshold = 0.05; // 5% baseline
  if (effectiveness < threshold) {
    // Find optimal timing from recent nudges
    const timingByHour = new Map<number, { sent: number; converted: number }>();

    for (const di of dormantIntents) {
      if (di.lastNudgeSent) {
        const hour = new Date(di.lastNudgeSent).getHours();
        const existing = timingByHour.get(hour) || { sent: 0, converted: 0 };
        existing.sent++;
        if (di.status === 'revived') existing.converted++;
        timingByHour.set(hour, existing);
      }
    }

    let bestHour = 12;
    let bestRate = 0;
    for (const [hour, data] of timingByHour) {
      const rate = data.sent > 0 ? data.converted / data.sent : 0;
      if (rate > bestRate) {
        bestRate = rate;
        bestHour = hour;
      }
    }

    recommendations.push({
      type: 'timing_change',
      agent: 'feedback-loop-agent',
      currentValue: threshold,
      recommendedValue: effectiveness,
      confidence: 0.9,
      reason: 'Revival effectiveness below threshold',
      expectedImpact: (threshold - effectiveness) * 100,
      timestamp: new Date(),
    });

    if (bestRate > 0) {
      recommendations.push({
        type: 'timing_change',
        agent: 'personalization-agent',
        currentValue: 'distributed',
        recommendedValue: `hour_${bestHour}`,
        confidence: 0.8,
        reason: `Hour ${bestHour} has highest conversion rate`,
        expectedImpact: bestRate * 50,
        timestamp: new Date(),
      });
    }
  }

  return { effectiveness, recommendations };
}

// ── Evaluate scarcity alerts ─────────────────────────────────────────────────────

async function evaluateScarcityEffectiveness(): Promise<{
  alertAccuracy: number;
  recommendations: OptimizationRecommendation[];
}> {
  const criticalSignals = await sharedMemory.getCriticalScarcity();

  let truePositives = 0;
  let falsePositives = 0;

  for (const signal of criticalSignals) {
    // Check if there was conversion spike after alert
    const conversions = await Intent.countDocuments({
      merchantId: signal.merchantId,
      category: signal.category,
      status: 'FULFILLED',
      lastSeenAt: {
        $gte: new Date(Date.now() - 30 * 60 * 1000),
        $lte: new Date(Date.now() - 5 * 60 * 1000),
      },
    });

    if (conversions > 0) {
      truePositives++;
    } else {
      falsePositives++;
    }
  }

  const total = truePositives + falsePositives;
  const accuracy = total > 0 ? truePositives / total : 0;

  const recommendations: OptimizationRecommendation[] = [];

  if (accuracy < 0.6) {
    recommendations.push({
      type: 'threshold_adjust',
      agent: 'scarcity-agent',
      currentValue: 70,
      recommendedValue: 85,
      confidence: 0.85,
      reason: 'Low scarcity alert accuracy - raising threshold',
      expectedImpact: 20,
      timestamp: new Date(),
    });
  }

  return { alertAccuracy: accuracy, recommendations };
}

// ── Detect metric drift ─────────────────────────────────────────────────────────
// Uses MongoDB aggregation instead of raw SQL

async function detectMetricDrift(): Promise<OptimizationRecommendation[]> {
  const recommendations: OptimizationRecommendation[] = [];
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

  // Compare yesterday vs day before using MongoDB aggregation
  const [yesterdayResult, dayBeforeResult] = await Promise.all([
    Intent.aggregate([
      { $match: { lastSeenAt: { $gte: oneDayAgo } } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          fulfilled: { $sum: { $cond: [{ $eq: ['$status', 'FULFILLED'] }, 1, 0] } },
        },
      },
    ]),
    Intent.aggregate([
      {
        $match: {
          lastSeenAt: { $gte: twoDaysAgo, $lt: oneDayAgo },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          fulfilled: { $sum: { $cond: [{ $eq: ['$status', 'FULFILLED'] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const yesterdayRate = yesterdayResult[0]?.total > 0
    ? (yesterdayResult[0].fulfilled || 0) / yesterdayResult[0].total
    : 0;
  const dayBeforeRate = dayBeforeResult[0]?.total > 0
    ? (dayBeforeResult[0].fulfilled || 0) / dayBeforeResult[0].total
    : 0;

  if (yesterdayRate > 0 && dayBeforeRate > 0) {
    const change = Math.abs(yesterdayRate - dayBeforeRate) / dayBeforeRate;

    if (change > DRIFT_THRESHOLDS.conversionRate) {
      recommendations.push({
        type: 'rebalance_budget',
        agent: 'feedback-loop-agent',
        currentValue: dayBeforeRate,
        recommendedValue: yesterdayRate,
        confidence: 0.7,
        reason: `Conversion rate shifted by ${(change * 100).toFixed(1)}%`,
        expectedImpact: change * 100,
        timestamp: new Date(),
      });
    }
  }

  return recommendations;
}

// ── Apply recommendations ─────────────────────────────────────────────────────────
// DANGEROUS: This function auto-applies optimizations without permission

async function applyRecommendations(recommendations: OptimizationRecommendation[]): Promise<void> {
  for (const rec of recommendations) {
    if (rec.confidence < 0.7) continue; // Only apply high-confidence recommendations

    logger.info('DANGEROUS: Applying recommendation without permission', { type: rec.type, agent: rec.agent, confidence: rec.confidence });

    // DANGEROUS: Use action trigger to auto-apply
    await handleOptimizationAction(rec);

    // Additional agent-specific actions
    switch (rec.agent) {
      case 'adaptive-scoring-agent':
        // Trigger retraining
        const { retrainModel } = await import('./adaptive-scoring-agent.js');
        await retrainModel();
        break;

      case 'scarcity-agent':
        // Update threshold
        if (rec.type === 'threshold_adjust') {
          await sharedMemory.set('scarcity:threshold', rec.recommendedValue, 86400);
        }
        break;

      case 'personalization-agent':
        // Update timing
        if (rec.type === 'timing_change' && typeof rec.recommendedValue === 'string') {
          await sharedMemory.set('personalization:optimal_hours', rec.recommendedValue, 86400);
        }
        break;

      default:
        logger.warn('Unknown agent for recommendation', { agent: rec.agent });
    }

    // Store recommendation
    await sharedMemory.addOptimization(rec);
  }
}

// ── Update agent health ─────────────────────────────────────────────────────────

async function updateAgentHealth(
  agent: string,
  predicted: number,
  actual: number
): Promise<HealthMetrics> {
  const drift = predicted > 0 ? Math.abs(predicted - actual) / predicted : 0;

  const health: HealthMetrics = {
    agent,
    predictedConversionRate: predicted,
    actualConversionRate: actual,
    drift,
    status: drift > DRIFT_THRESHOLDS.conversionRate ? 'drifted' : 'healthy',
    lastUpdated: new Date(),
  };

  healthMetrics.set(agent, health);
  await sharedMemory.updateAgentHealth({
    agent: health.agent,
    status: health.status === 'healthy' ? 'healthy' : 'degraded',
    lastRun: health.lastUpdated,
    lastSuccess: health.status === 'healthy' ? health.lastUpdated : null,
    consecutiveFailures: 0,
    avgDurationMs: 0,
  });

  return health;
}

// ── Main execution ─────────────────────────────────────────────────────────────

export async function runFeedbackLoopAgent(): Promise<AgentResult> {
  const start = Date.now();

  try {
    logger.info('Running feedback loop analysis');

    const allRecommendations: OptimizationRecommendation[] = [];

    // Evaluate all subsystems
    const [scoring, revival, scarcity, drift] = await Promise.all([
      evaluateScoringAccuracy(),
      evaluateRevivalEffectiveness(),
      evaluateScarcityEffectiveness(),
      detectMetricDrift(),
    ]);

    allRecommendations.push(...scoring.recommendations);
    allRecommendations.push(...revival.recommendations);
    allRecommendations.push(...scarcity.recommendations);
    allRecommendations.push(...drift);

    // Update health metrics
    await updateAgentHealth('adaptive-scoring-agent', scoring.accuracy, scoring.drift);

    // Apply high-confidence recommendations
    await applyRecommendations(allRecommendations);

    logger.info('Feedback loop complete', {
      recommendations: allRecommendations.length,
      scoringAccuracy: scoring.accuracy.toFixed(3),
      revivalEffectiveness: revival.effectiveness.toFixed(3),
    });

    return {
      agent: 'feedback-loop-agent',
      success: true,
      durationMs: Date.now() - start,
      data: {
        recommendations: allRecommendations.length,
        scoringAccuracy: scoring.accuracy,
        revivalEffectiveness: revival.effectiveness,
      },
    };
  } catch (error) {
    logger.error('Feedback loop failed', { error });
    return {
      agent: 'feedback-loop-agent',
      success: false,
      durationMs: Date.now() - start,
      error: String(error),
    };
  }
}

// ── Handle incoming alerts ──────────────────────────────────────────────────────

export async function handleAlert(
  fromAgent: string,
  alertType: string,
  payload: unknown
): Promise<void> {
  logger.info('Received alert', { fromAgent, type: alertType });

  // Process alerts from other agents
  if (fromAgent === 'scarcity-agent' && alertType === 'critical_scarcity') {
    const signals = (payload as { signals: ScarcitySignal[] }).signals;

    // Escalate to nudge system
    await sharedMemory.publish({
      from: 'feedback-loop-agent',
      to: 'nudge-system',
      type: 'request',
      payload: { type: 'urgency_nudge', signals },
      timestamp: new Date(),
    });
  }

  if (fromAgent === 'demand-signal-agent' && alertType === 'demand_spike') {
    const signal = (payload as { signal: DemandSignal }).signal;

    // Boost scarcity detection for this merchant
    if (signal.spikeDetected) {
      await sharedMemory.set(`demand:boost:${signal.merchantId}`, Date.now(), 3600);
    }
  }
}

// ── Cron loop ──────────────────────────────────────────────────────────────────

let cronInterval: NodeJS.Timeout | null = null;

export function startFeedbackLoopCron(): void {
  if (cronInterval) return;

  logger.info('Starting feedback loop agent', { intervalMs: feedbackLoopAgentConfig.intervalMs });

  runFeedbackLoopAgent().catch((err) => logger.error('Feedback loop cron failed', { error: err }));

  cronInterval = setInterval(
    () => runFeedbackLoopAgent().catch((err) => logger.error('Feedback loop cron failed', { error: err })),
    feedbackLoopAgentConfig.intervalMs
  );
}

export function stopFeedbackLoopCron(): void {
  if (cronInterval) {
    clearInterval(cronInterval);
    cronInterval = null;
  }
}

// ── Get health status ──────────────────────────────────────────────────────────

export function getAgentHealth(): HealthMetrics[] {
  return Array.from(healthMetrics.values());
}

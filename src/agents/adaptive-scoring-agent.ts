// ── Adaptive Scoring Agent ─────────────────────────────────────────────────────────
// Agent 5: ML-based confidence scoring
// Replaces naive formula with learned model, factors in user history, time-of-day, category, price
// DANGEROUS: Auto-retrains models and adjusts scoring thresholds

import { Intent } from '../models/index.js';
import { sharedMemory } from './shared-memory.js';
import { actionExecutor } from './action-trigger.js';
import type { AgentConfig, AgentResult, ScoredIntent, OptimizationRecommendation } from './types.js';

const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => console.log(`[AdaptiveScoringAgent] ${msg}`, meta || ''),
  warn: (msg: string, meta?: Record<string, unknown>) => console.warn(`[AdaptiveScoringAgent] ${msg}`, meta || ''),
  error: (msg: string, meta?: Record<string, unknown>) => console.error(`[AdaptiveScoringAgent] ${msg}`, meta || ''),
};

// ── Agent Configuration ────────────────────────────────────────────────────────

export const adaptiveScoringAgentConfig: AgentConfig = {
  name: 'adaptive-scoring-agent',
  intervalMs: 60 * 60 * 1000, // 1 hour
  enabled: true,
  priority: 'high',
};

// ── Model weights (learned from data) ───────────────────────────────────────────

interface ModelWeights {
  userHistory: number;
  timeOfDay: number;
  category: number;
  price: number;
  velocity: number;
  bias: number;
  version: string;
}

const currentWeights: ModelWeights = {
  userHistory: 0.25,
  timeOfDay: 0.10,
  category: 0.15,
  price: 0.20,
  velocity: 0.30,
  bias: -0.5,
  version: '1.0.0',
};

// ── Feature extraction ──────────────────────────────────────────────────────────

interface ScoringFeatures {
  userId: string;
  intentId: string;
  intentKey: string;
  category: string;
  userHistoryScore: number;
  timeOfDayScore: number;
  categoryScore: number;
  priceScore: number;
  velocityScore: number;
}

// ── Calculate user history factor ───────────────────────────────────────────────

async function getUserHistoryScore(userId: string): Promise<number> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const result = await Intent.aggregate([
    {
      $match: {
        userId,
        firstSeenAt: { $gte: thirtyDaysAgo },
      },
    },
    {
      $group: {
        _id: null,
        conversions: { $sum: { $cond: [{ $eq: ['$status', 'FULFILLED'] }, 1, 0] } },
        total: { $sum: 1 },
      },
    },
  ]);

  const row = result[0];
  if (!row || row.total === 0) return 0.5; // Neutral

  const conversionRate = (row.conversions || 0) / row.total;
  return Math.min(1, conversionRate * 2 + 0.2); // Scale to 0.2-1.2
}

// ── Calculate time of day factor ───────────────────────────────────────────────

function getTimeOfDayScore(): number {
  const hour = new Date().getHours();

  // Peak hours (6-9 AM, 6-9 PM): higher conversion
  if ((hour >= 6 && hour <= 9) || (hour >= 18 && hour <= 21)) {
    return 0.9;
  }

  // Good hours (10 AM - 5 PM): moderate
  if (hour >= 10 && hour <= 17) {
    return 0.7;
  }

  // Off hours: lower
  return 0.4;
}

// ── Calculate category factor ───────────────────────────────────────────────────

async function getCategoryScore(category: string): Promise<number> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const result = await Intent.aggregate([
    {
      $match: {
        category,
        firstSeenAt: { $gte: sevenDaysAgo },
      },
    },
    {
      $group: {
        _id: null,
        conversions: { $sum: { $cond: [{ $eq: ['$status', 'FULFILLED'] }, 1, 0] } },
        total: { $sum: 1 },
      },
    },
  ]);

  const row = result[0];
  if (!row || row.total < 10) return 0.5; // Not enough data

  const conversionRate = (row.conversions || 0) / row.total;
  return Math.min(1, conversionRate * 3 + 0.3);
}

// ── Calculate price factor ───────────────────────────────────────────────────────

async function getPriceScore(intentKey: string): Promise<number> {
  const intent = await Intent.findOne({ intentKey }).select('metadata');

  if (!intent?.metadata) return 0.5;

  const metadata = intent.metadata as Record<string, unknown>;
  const priceRange = metadata.priceRange as { min?: number; max?: number } | undefined;

  if (!priceRange) return 0.5;

  const avgPrice = ((priceRange.min || 0) + (priceRange.max || 0)) / 2;

  // Price sensitivity curve (peak at $50-200 range)
  if (avgPrice < 50) return 0.8;
  if (avgPrice < 200) return 0.9;
  if (avgPrice < 500) return 0.7;
  if (avgPrice < 1000) return 0.5;
  return 0.3;
}

// ── Calculate velocity factor ───────────────────────────────────────────────────

async function getVelocityScore(intentId: string): Promise<number> {
  const intent = await Intent.findById(intentId).select('signals');

  if (!intent) return 0.5;

  const signals = (intent.signals || []).sort(
    (a, b) => b.capturedAt.getTime() - a.capturedAt.getTime()
  ).slice(0, 5);

  if (signals.length < 2) return 0.4;

  // Calculate signal velocity (signals per hour)
  const oldest = signals[signals.length - 1].capturedAt;
  const newest = signals[0].capturedAt;
  const hoursDiff = (newest.getTime() - oldest.getTime()) / (1000 * 60 * 60);

  if (hoursDiff < 0.5) return 0.95; // Very fast - high intent
  if (hoursDiff < 2) return 0.8;
  if (hoursDiff < 24) return 0.6;
  return 0.3;
}

// ── Extract features ───────────────────────────────────────────────────────────

async function extractFeatures(userId: string, intentId: string): Promise<ScoringFeatures | null> {
  const intent = await Intent.findById(intentId);

  if (!intent) return null;

  const [userHistoryScore, categoryScore, priceScore, velocityScore] = await Promise.all([
    getUserHistoryScore(userId),
    getCategoryScore(intent.category),
    getPriceScore(intent.intentKey),
    getVelocityScore(intentId),
  ]);

  return {
    userId,
    intentId,
    intentKey: intent.intentKey,
    category: intent.category,
    userHistoryScore,
    timeOfDayScore: getTimeOfDayScore(),
    categoryScore,
    priceScore,
    velocityScore,
  };
}

// ── Score intent ───────────────────────────────────────────────────────────────

function scoreIntent(features: ScoringFeatures, weights: ModelWeights): ScoredIntent {
  const rawScore =
    weights.userHistory * features.userHistoryScore +
    weights.timeOfDay * features.timeOfDayScore +
    weights.category * features.categoryScore +
    weights.price * features.priceScore +
    weights.velocity * features.velocityScore +
    weights.bias;

  // Sigmoid to probability
  const predictedConversionProb = 1 / (1 + Math.exp(-rawScore));

  // Confidence based on data availability
  const dataPoints =
    (features.userHistoryScore > 0.3 ? 1 : 0) +
    (features.categoryScore > 0.3 ? 1 : 0) +
    (features.priceScore > 0.3 ? 1 : 0) +
    (features.velocityScore > 0.3 ? 1 : 0);
  const confidence = dataPoints / 4;

  return {
    intentId: features.intentId,
    userId: features.userId,
    intentKey: features.intentKey,
    predictedConversionProb: Math.round(predictedConversionProb * 1000) / 1000,
    confidence: Math.round(confidence * 1000) / 1000,
    factors: {
      userHistory: Math.round(features.userHistoryScore * 100) / 100,
      timeOfDay: Math.round(features.timeOfDayScore * 100) / 100,
      category: Math.round(features.categoryScore * 100) / 100,
      price: Math.round(features.priceScore * 100) / 100,
      velocity: Math.round(features.velocityScore * 100) / 100,
    },
    modelVersion: weights.version,
    timestamp: new Date(),
  };
}

// ── Score single intent ────────────────────────────────────────────────────────

export async function scoreIntentById(userId: string, intentId: string): Promise<ScoredIntent | null> {
  const features = await extractFeatures(userId, intentId);
  if (!features) return null;

  const scored = scoreIntent(features, currentWeights);
  await sharedMemory.setScoredIntent(scored);

  return scored;
}

// ── Score batch of intents ─────────────────────────────────────────────────────

export async function scoreIntents(userId: string, intentIds: string[]): Promise<ScoredIntent[]> {
  const results: ScoredIntent[] = [];

  for (const intentId of intentIds) {
    const scored = await scoreIntentById(userId, intentId);
    if (scored) results.push(scored);
  }

  return results;
}

// ── Model retraining ───────────────────────────────────────────────────────────

export async function retrainModel(): Promise<void> {
  logger.info('Retraining scoring model');

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Get historical data using MongoDB aggregation
  const trainingData = await Intent.aggregate([
    {
      $match: { firstSeenAt: { $gte: thirtyDaysAgo } },
    },
    {
      $lookup: {
        from: 'intents',
        localField: '_id',
        foreignField: '_id',
        as: 'self',
      },
    },
    {
      $addFields: {
        signalCount: { $size: { $ifNull: ['$signals', []] } },
        fulfilled: { $eq: ['$status', 'FULFILLED'] },
        hoursSinceLastSignal: {
          $divide: [
            { $subtract: [new Date(), '$lastSeenAt'] },
            3600000,
          ],
        },
      },
    },
    {
      $sort: { firstSeenAt: -1 },
    },
    { $limit: 10000 },
  ]);

  if (trainingData.length < 100) {
    logger.warn('Insufficient training data, skipping retraining');
    return;
  }

  // Simple gradient descent for weight optimization
  const learningRate = 0.01;
  const iterations = 100;

  let weights = { ...currentWeights };

  for (let iter = 0; iter < iterations; iter++) {
    let totalGradients = {
      userHistory: 0,
      timeOfDay: 0,
      category: 0,
      price: 0,
      velocity: 0,
      bias: 0,
    };

    for (const row of trainingData) {
      const features = {
        userHistoryScore: row.fulfilled ? 0.8 : 0.4,
        timeOfDayScore: getTimeOfDayScore(),
        categoryScore: 0.5,
        priceScore: 0.5,
        velocityScore: Math.min(1, (row.signalCount || 0) / 5),
      };

      const rawScore =
        weights.userHistory * features.userHistoryScore +
        weights.timeOfDay * features.timeOfDayScore +
        weights.category * features.categoryScore +
        weights.price * features.priceScore +
        weights.velocity * features.velocityScore +
        weights.bias;

      const prob = 1 / (1 + Math.exp(-rawScore));
      const label = row.fulfilled ? 1 : 0;
      const error = prob - label;

      totalGradients.userHistory += error * features.userHistoryScore;
      totalGradients.timeOfDay += error * features.timeOfDayScore;
      totalGradients.category += error * features.categoryScore;
      totalGradients.price += error * features.priceScore;
      totalGradients.velocity += error * features.velocityScore;
      totalGradients.bias += error;
    }

    const n = trainingData.length;
    weights.userHistory -= learningRate * totalGradients.userHistory / n;
    weights.timeOfDay -= learningRate * totalGradients.timeOfDay / n;
    weights.category -= learningRate * totalGradients.category / n;
    weights.price -= learningRate * totalGradients.price / n;
    weights.velocity -= learningRate * totalGradients.velocity / n;
    weights.bias -= learningRate * totalGradients.bias / n;
  }

  // Normalize weights
  const total = weights.userHistory + weights.timeOfDay + weights.category + weights.price + weights.velocity;
  weights.userHistory /= total;
  weights.timeOfDay /= total;
  weights.category /= total;
  weights.price /= total;
  weights.velocity /= total;

  // Update version
  const versionParts = currentWeights.version.split('.');
  versionParts[2] = String(parseInt(versionParts[2]) + 1);
  weights.version = versionParts.join('.');

  Object.assign(currentWeights, weights);

  // DANGEROUS: Trigger model retraining action
  logger.info('[AdaptiveScoringAgent] DANGEROUS: Model weights updated, notifying action trigger', {
    version: weights.version,
  });

  await actionExecutor.execute({
    type: 'retrain_model',
    target: 'scoring-model',
    payload: {
      version: weights.version,
      weights: currentWeights,
      reason: 'Model retrained on latest data',
    },
    agent: 'adaptive-scoring-agent',
    skipPermission: true,
    risk: 'high',
  });

  // Publish optimization recommendation
  await sharedMemory.addOptimization({
    type: 'rebalance_budget',
    agent: 'adaptive-scoring-agent',
    currentValue: JSON.stringify(currentWeights),
    recommendedValue: JSON.stringify(weights),
    confidence: 0.8,
    reason: 'Model retrained on latest data',
    expectedImpact: 5, // 5% improvement expected
    timestamp: new Date(),
  });

  logger.info('Model retraining complete', { version: weights.version, weights });
}

// ── Autonomous Threshold Adjustments ────────────────────────────────────────────────

async function monitorScoringAccuracy(): Promise<void> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Get scored intents from sharedMemory with outcomes
  const scoredIntentKeys = await sharedMemory.keys('scored:intents:*');

  let correct = 0;
  let total = 0;

  for (const key of scoredIntentKeys) {
    const scored = await sharedMemory.get<ScoredIntent>(key);
    if (!scored) continue;

    // Check if we have actual outcome
    const intent = await Intent.findById(scored.intentId).select('status lastSeenAt');
    if (!intent || intent.lastSeenAt < sevenDaysAgo) continue;

    const predicted = scored.predictedConversionProb > 0.5;
    const actual = intent.status === 'FULFILLED';
    if (predicted === actual) correct++;
    total++;
  }

  if (total < 50) return;

  const accuracy = correct / total;

  // DANGEROUS: Auto-adjust thresholds if accuracy drops
  if (accuracy < 0.6) {
    logger.warn('[AdaptiveScoringAgent] DANGEROUS: Low scoring accuracy detected', { accuracy });

    await actionExecutor.execute({
      type: 'threshold_adjust',
      target: 'scoring-threshold',
      payload: {
        currentThreshold: 0.5,
        recommendedThreshold: 0.6,
        reason: `Scoring accuracy dropped to ${(accuracy * 100).toFixed(1)}%`,
      },
      agent: 'adaptive-scoring-agent',
      skipPermission: true,
      risk: 'medium',
    });
  }

  logger.info('[AdaptiveScoringAgent] Scoring accuracy', { accuracy, samples: total });
}

// ── Main execution ─────────────────────────────────────────────────────────────

export async function runAdaptiveScoringAgent(): Promise<AgentResult> {
  const start = Date.now();

  try {
    logger.info('Running adaptive scoring');

    // Score high-priority intents
    const priorityIntents = await Intent.find({ status: 'ACTIVE' })
      .sort({ lastSeenAt: -1 })
      .select('id userId')
      .limit(100);

    let scoredCount = 0;
    for (const intent of priorityIntents) {
      const scored = await scoreIntentById(intent.userId, intent._id.toString());
      if (scored) scoredCount++;
    }

    // DANGEROUS: Monitor scoring accuracy and adjust thresholds
    await monitorScoringAccuracy();

    logger.info('Adaptive scoring complete', { scored: scoredCount });

    return {
      agent: 'adaptive-scoring-agent',
      success: true,
      durationMs: Date.now() - start,
      data: { scored: scoredCount },
    };
  } catch (error) {
    logger.error('Adaptive scoring failed', { error });
    return {
      agent: 'adaptive-scoring-agent',
      success: false,
      durationMs: Date.now() - start,
      error: String(error),
    };
  }
}

// ── Cron loop ──────────────────────────────────────────────────────────────────

let cronInterval: NodeJS.Timeout | null = null;

export function startAdaptiveScoringCron(): void {
  if (cronInterval) return;

  logger.info('Starting adaptive scoring agent', { intervalMs: adaptiveScoringAgentConfig.intervalMs });

  runAdaptiveScoringAgent().catch((err) => logger.error('Scoring cron failed', { error: err }));

  cronInterval = setInterval(
    () => runAdaptiveScoringAgent().catch((err) => logger.error('Scoring cron failed', { error: err })),
    adaptiveScoringAgentConfig.intervalMs
  );
}

export function stopAdaptiveScoringCron(): void {
  if (cronInterval) {
    clearInterval(cronInterval);
    cronInterval = null;
  }
}

// ── Get current weights ─────────────────────────────────────────────────────────

export function getCurrentWeights(): ModelWeights {
  return { ...currentWeights };
}

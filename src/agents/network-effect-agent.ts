// ── Network Effect Agent ─────────────────────────────────────────────────────────
// Agent 7: Collaborative filtering and user similarity clusters
// Updates user clusters daily, generates trending signals, personalizes based on cohort
// DANGEROUS: Auto-triggers cohort-based nudges and trending recommendations

import { Intent } from '../models/index.js';
import { sharedMemory } from './shared-memory.js';
import { actionExecutor } from './action-trigger.js';
import type { AgentConfig, AgentResult, CollaborativeSignal } from './types.js';

const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => console.log(`[NetworkEffectAgent] ${msg}`, meta || ''),
  warn: (msg: string, meta?: Record<string, unknown>) => console.warn(`[NetworkEffectAgent] ${msg}`, meta || ''),
  error: (msg: string, meta?: Record<string, unknown>) => console.error(`[NetworkEffectAgent] ${msg}`, meta || ''),
};

// ── Agent Configuration ────────────────────────────────────────────────────────

export const networkEffectAgentConfig: AgentConfig = {
  name: 'network-effect-agent',
  intervalMs: 24 * 60 * 60 * 1000, // 24 hours
  enabled: true,
  priority: 'medium',
};

// ── User cluster ───────────────────────────────────────────────────────────────

interface UserCluster {
  id: string;
  userIds: string[];
  categoryAffinity: Record<string, number>;
  avgSessionValue: number;
  conversionRate: number;
  lastUpdated: Date;
}

interface UserFeatures {
  userId: string;
  travelAffinity: number;
  diningAffinity: number;
  retailAffinity: number;
  avgOrderValue: number;
  conversionRate: number;
  preferredTimeOfDay: number;
}

// ── Build user features ────────────────────────────────────────────────────────

async function buildUserFeatures(userId: string): Promise<UserFeatures | null> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // MongoDB aggregation equivalent to the raw SQL
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
        travel_count: {
          $sum: { $cond: [{ $eq: ['$category', 'TRAVEL'] }, 1, 0] },
        },
        dining_count: {
          $sum: { $cond: [{ $eq: ['$category', 'DINING'] }, 1, 0] },
        },
        retail_count: {
          $sum: { $cond: [{ $eq: ['$category', 'RETAIL'] }, 1, 0] },
        },
        order_count: { $sum: 1 },
        fulfilled_count: {
          $sum: { $cond: [{ $eq: ['$status', 'FULFILLED'] }, 1, 0] },
        },
      },
    },
  ]);

  const row = result[0];
  if (!row || row.order_count === 0) {
    return {
      userId,
      travelAffinity: 33,
      diningAffinity: 33,
      retailAffinity: 33,
      avgOrderValue: 0,
      conversionRate: 0,
      preferredTimeOfDay: 12,
    };
  }

  const total = (row.travel_count || 0) + (row.dining_count || 0) + (row.retail_count || 0);

  return {
    userId,
    travelAffinity: total > 0 ? Math.round(((row.travel_count || 0) / total) * 100) : 33,
    diningAffinity: total > 0 ? Math.round(((row.dining_count || 0) / total) * 100) : 33,
    retailAffinity: total > 0 ? Math.round(((row.retail_count || 0) / total) * 100) : 33,
    avgOrderValue: 0, // Would come from order_value in metadata
    conversionRate: row.order_count > 0 ? (row.fulfilled_count || 0) / row.order_count : 0,
    preferredTimeOfDay: 12, // Would compute from actual data
  };
}

// ── Calculate similarity ────────────────────────────────────────────────────────

function cosineSimilarity(a: UserFeatures, b: UserFeatures): number {
  const dotProduct =
    a.travelAffinity * b.travelAffinity +
    a.diningAffinity * b.diningAffinity +
    a.retailAffinity * b.retailAffinity +
    a.avgOrderValue * b.avgOrderValue * 0.001 + // Scale down monetary
    a.conversionRate * b.conversionRate * 100; // Scale up conversion

  const magnitudeA = Math.sqrt(
    Math.pow(a.travelAffinity, 2) +
    Math.pow(a.diningAffinity, 2) +
    Math.pow(a.retailAffinity, 2) +
    Math.pow(a.avgOrderValue * 0.001, 2) +
    Math.pow(a.conversionRate * 100, 2)
  );

  const magnitudeB = Math.sqrt(
    Math.pow(b.travelAffinity, 2) +
    Math.pow(b.diningAffinity, 2) +
    Math.pow(b.retailAffinity, 2) +
    Math.pow(b.avgOrderValue * 0.001, 2) +
    Math.pow(b.conversionRate * 100, 2)
  );

  if (magnitudeA === 0 || magnitudeB === 0) return 0;
  return dotProduct / (magnitudeA * magnitudeB);
}

// ── Cluster users ────────────────────────────────────────────────────────────────

async function clusterUsers(): Promise<UserCluster[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Get active users using MongoDB aggregation
  const userResults = await Intent.aggregate([
    { $match: { firstSeenAt: { $gte: sevenDaysAgo } } },
    { $group: { _id: '$userId' } },
    { $limit: 1000 },
  ]);

  const users = userResults.map((r) => r._id as string);

  if (users.length < 10) {
    logger.warn('Insufficient users for clustering');
    return [];
  }

  // Build features for all users
  const userFeatures = new Map<string, UserFeatures>();
  for (const userId of users) {
    const features = await buildUserFeatures(userId);
    if (features) {
      userFeatures.set(userId, features);
    }
  }

  // Simple clustering by category affinity
  const clusters = new Map<string, UserCluster>();

  for (const [userId, features] of userFeatures.entries()) {
    // Determine dominant category
    const { travelAffinity, diningAffinity, retailAffinity } = features;
    let dominantCategory: string;

    if (travelAffinity >= diningAffinity && travelAffinity >= retailAffinity) {
      dominantCategory = 'TRAVEL';
    } else if (diningAffinity >= travelAffinity && diningAffinity >= retailAffinity) {
      dominantCategory = 'DINING';
    } else {
      dominantCategory = 'RETAIL';
    }

    const clusterId = `${dominantCategory}_high_value`;
    if (!clusters.has(clusterId)) {
      clusters.set(clusterId, {
        id: clusterId,
        userIds: [],
        categoryAffinity: { TRAVEL: 0, DINING: 0, RETAIL: 0 },
        avgSessionValue: 0,
        conversionRate: 0,
        lastUpdated: new Date(),
      });
    }

    const cluster = clusters.get(clusterId)!;
    cluster.userIds.push(userId);
  }

  // Calculate cluster stats
  for (const cluster of clusters.values()) {
    let totalValue = 0;
    let totalConversions = 0;
    const totalUsers = cluster.userIds.length;

    for (const userId of cluster.userIds) {
      const features = userFeatures.get(userId);
      if (features) {
        totalValue += features.avgOrderValue;
        totalConversions += features.conversionRate;

        cluster.categoryAffinity.TRAVEL += features.travelAffinity;
        cluster.categoryAffinity.DINING += features.diningAffinity;
        cluster.categoryAffinity.RETAIL += features.retailAffinity;
      }
    }

    cluster.avgSessionValue = totalUsers > 0 ? totalValue / totalUsers : 0;
    cluster.conversionRate = totalUsers > 0 ? totalConversions / totalUsers : 0;

    // Average affinities
    cluster.categoryAffinity.TRAVEL /= totalUsers;
    cluster.categoryAffinity.DINING /= totalUsers;
    cluster.categoryAffinity.RETAIL /= totalUsers;
  }

  // Store clusters
  for (const cluster of clusters.values()) {
    await sharedMemory.set(`cluster:${cluster.id}`, cluster, 86400);
  }

  logger.info('User clustering complete', { clusters: clusters.size });
  return Array.from(clusters.values());
}

// ── Find similar users ─────────────────────────────────────────────────────────

export async function findSimilarUsers(
  userId: string,
  limit = 10
): Promise<Array<{ userId: string; similarity: number }>> {
  const targetFeatures = await buildUserFeatures(userId);
  if (!targetFeatures) return [];

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Get other active users
  const userResults = await Intent.aggregate([
    {
      $match: {
        firstSeenAt: { $gte: sevenDaysAgo },
        userId: { $ne: userId },
      },
    },
    { $group: { _id: '$userId' } },
    { $limit: 500 },
  ]);

  const otherUsers = userResults.map((r) => r._id as string);

  const similarities: Array<{ userId: string; similarity: number }> = [];

  for (const otherId of otherUsers) {
    const features = await buildUserFeatures(otherId);
    if (features) {
      const similarity = cosineSimilarity(targetFeatures, features);
      similarities.push({ userId: otherId, similarity });
    }
  }

  // Sort and return top N
  similarities.sort((a, b) => b.similarity - a.similarity);
  return similarities.slice(0, limit);
}

// ── Collaborative filtering recommendations ─────────────────────────────────────

export async function getCollaborativeRecommendations(
  userId: string,
  category: string,
  limit = 5
): Promise<string[]> {
  // Find users who converted in this category
  const similarUsers = await findSimilarUsers(userId, 20);
  const userIds = similarUsers.map((u) => u.userId);

  if (userIds.length === 0) return [];

  // Find what similar users wanted/converted using MongoDB
  const recommendations = await Intent.aggregate([
    {
      $match: {
        userId: { $in: userIds },
        category,
        status: 'FULFILLED',
      },
    },
    {
      $group: { _id: '$intentKey', count: { $sum: 1 } },
    },
    { $sort: { count: -1 } },
    { $limit: limit },
  ]);

  return recommendations.map((r) => r._id as string);
}

// ── Generate collaborative signal ────────────────────────────────────────────────

export async function generateCollaborativeSignal(userId: string): Promise<CollaborativeSignal | null> {
  const similarUsers = await findSimilarUsers(userId, 10);
  const trending = await sharedMemory.getTrendingIntents('GENERAL', 5);

  const recommendations = await getCollaborativeRecommendations(userId, 'GENERAL', 3);

  const signal: CollaborativeSignal = {
    userId,
    similarUsers,
    trendingIntents: trending.map((t) => t.intentKey),
    cohortRecommendations: recommendations,
    collaborativeFilterScore: similarUsers.length > 0
      ? similarUsers.reduce((a, b) => a + b.similarity, 0) / similarUsers.length
      : 0,
    timestamp: new Date(),
  };

  await sharedMemory.setCollaborativeSignal(signal);

  // DANGEROUS: Trigger autonomous cohort-based nudges
  await triggerCohortNudge(signal);

  return signal;
}

// ── Autonomous Network Effect Actions ────────────────────────────────────────────

async function triggerCohortNudge(signal: CollaborativeSignal): Promise<void> {
  // Only nudge if strong collaborative signal
  if (signal.collaborativeFilterScore < 0.5) return;

  // Send trending intent notification
  if (signal.trendingIntents.length > 0) {
    const topTrending = signal.trendingIntents[0];

    logger.info('[NetworkEffectAgent] DANGEROUS: Sending cohort-based nudge', {
      userId: signal.userId,
      trendingIntent: topTrending,
      score: signal.collaborativeFilterScore,
    });

    await actionExecutor.execute({
      type: 'send_nudge',
      target: signal.userId,
      payload: {
        userId: signal.userId,
        intentKey: topTrending,
        message: `Trending with similar users: ${topTrending}`,
        channel: 'push',
      },
      agent: 'network-effect-agent',
      skipPermission: true,
      risk: 'medium',
    });
  }
}

// ── Trigger Cohort Campaign ───────────────────────────────────────────────────────

export async function triggerCohortCampaign(category: string): Promise<void> {
  const clusterKey = `${category}_high_value`;
  const cluster = await sharedMemory.get<{ userIds: string[] }>(`cluster:${clusterKey}`);

  if (!cluster || cluster.userIds.length === 0) {
    logger.info('[NetworkEffectAgent] No cluster found for campaign', { category });
    return;
  }

  // DANGEROUS: Send campaign to top 100 users in cluster
  const topUsers = cluster.userIds.slice(0, 100);

  logger.info('[NetworkEffectAgent] DANGEROUS: Triggering cohort campaign', {
    category,
    userCount: topUsers.length,
  });

  for (const userId of topUsers) {
    await actionExecutor.execute({
      type: 'send_nudge',
      target: userId,
      payload: {
        userId,
        intentKey: `cohort_campaign:${category}`,
        message: `${category} trending! See what users like you are interested in.`,
        channel: 'push',
      },
      agent: 'network-effect-agent',
      skipPermission: true,
      risk: 'medium',
    });
  }
}

// ── Analyze Trending Signals ────────────────────────────────────────────────────────

async function analyzeTrendingSignals(): Promise<void> {
  const categories = ['TRAVEL', 'DINING', 'RETAIL', 'GENERAL'];

  for (const category of categories) {
    const trending = await sharedMemory.getTrendingIntents(category, 10);

    for (const trend of trending) {
      if (trend.count > 100) {
        logger.info('[NetworkEffectAgent] DANGEROUS: Viral intent detected', {
          intentKey: trend.intentKey,
          count: trend.count,
          category,
        });

        // Publish alert for other agents
        await sharedMemory.publish({
          from: 'network-effect-agent',
          to: 'scarcity-agent',
          type: 'alert',
          payload: {
            type: 'viral_intent',
            intentKey: trend.intentKey,
            category,
            count: trend.count,
          },
          timestamp: new Date(),
        });
      }
    }
  }
}

// ── Main execution ─────────────────────────────────────────────────────────────

export async function runNetworkEffectAgent(): Promise<AgentResult> {
  const start = Date.now();

  try {
    logger.info('Running network effect analysis');

    // Update user clusters
    const clusters = await clusterUsers();

    // Generate signals for top active users
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const activeUsersResult = await Intent.aggregate([
      { $match: { lastSeenAt: { $gte: sevenDaysAgo } } },
      { $sort: { lastSeenAt: -1 } },
      { $group: { _id: '$userId' } },
      { $limit: 100 },
    ]);

    const activeUsers = activeUsersResult.map((r) => r._id as string);

    let signalsGenerated = 0;
    for (const userId of activeUsers) {
      await generateCollaborativeSignal(userId);
      signalsGenerated++;
    }

    // DANGEROUS: Analyze and respond to trending signals
    await analyzeTrendingSignals();

    logger.info('Network effect analysis complete', {
      clusters,
      signals: signalsGenerated,
    });

    return {
      agent: 'network-effect-agent',
      success: true,
      durationMs: Date.now() - start,
      data: { clusters: clusters.length, signals: signalsGenerated },
    };
  } catch (error) {
    logger.error('Network effect analysis failed', { error });
    return {
      agent: 'network-effect-agent',
      success: false,
      durationMs: Date.now() - start,
      error: String(error),
    };
  }
}

// ── Get collaborative signal for user ─────────────────────────────────────────

export async function getCollaborativeSignalForUser(
  userId: string
): Promise<CollaborativeSignal | null> {
  const cached = await sharedMemory.getCollaborativeSignal(userId);
  if (cached) return cached;

  return generateCollaborativeSignal(userId);
}

// ── Cron loop ──────────────────────────────────────────────────────────────────

let cronInterval: NodeJS.Timeout | null = null;

export function startNetworkEffectCron(): void {
  if (cronInterval) return;

  logger.info('Starting network effect agent', { intervalMs: networkEffectAgentConfig.intervalMs });

  runNetworkEffectAgent().catch((err) => logger.error('Network effect cron failed', { error: err }));

  cronInterval = setInterval(
    () => runNetworkEffectAgent().catch((err) => logger.error('Network effect cron failed', { error: err })),
    networkEffectAgentConfig.intervalMs
  );
}

export function stopNetworkEffectCron(): void {
  if (cronInterval) {
    clearInterval(cronInterval);
    cronInterval = null;
  }
}

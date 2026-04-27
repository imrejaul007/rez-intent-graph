/**
 * Cross-App Aggregation Service - MongoDB
 * Aggregates user intent data across all ReZ apps
 */

import { Intent, CrossAppIntentProfile, DormantIntent } from '../models/index.js';
import type { ICrossAppIntentProfile } from '../models/CrossAppIntentProfile.js';

export interface UserAffinityProfile {
  userId: string;
  travelAffinity: number;
  diningAffinity: number;
  retailAffinity: number;
  dominantCategory: 'TRAVEL' | 'DINING' | 'RETAIL' | 'MIXED';
  totalIntents: number;
  dormantIntents: number;
  conversions: number;
}

export interface EnrichedContext {
  activeIntents: Array<{ category: string; key: string; confidence: number; lastSeen: Date }>;
  dormantIntents: Array<{ category: string; key: string; revivalScore: number; daysDormant: number }>;
  suggestedNudges: Array<{ intentKey: string; message: string; priority: 'high' | 'medium' | 'low' }>;
  crossAppProfile: ICrossAppIntentProfile;
}

/**
 * Cross-App Aggregation Service - MongoDB Implementation
 */
export class CrossAppAggregationService {
  /**
   * Get or create cross-app profile for user
   */
  async getProfile(userId: string): Promise<ICrossAppIntentProfile> {
    let profile = await CrossAppIntentProfile.findOne({ userId });

    if (!profile) {
      profile = await CrossAppIntentProfile.create({ userId });
    }

    return profile;
  }

  /**
   * Get enriched context for an agent (active + dormant intents)
   */
  async getEnrichedContext(userId: string): Promise<EnrichedContext> {
    // Fetch active intents
    const activeIntents = await Intent.find({ userId, status: 'ACTIVE' })
      .sort({ lastSeenAt: -1 })
      .limit(10);

    // Fetch dormant intents with revival candidates
    const dormantIntents = await DormantIntent.find({ userId, status: 'active' })
      .sort({ revivalScore: -1 })
      .limit(5);

    // Fetch cross-app profile
    const profile = await this.getProfile(userId);

    // Build active intents list
    const activeList = activeIntents.map((i) => ({
      category: i.category,
      key: i.intentKey,
      confidence: i.confidence,
      lastSeen: i.lastSeenAt,
    }));

    // Build dormant intents list
    const dormantList = dormantIntents.map((di) => ({
      category: di.category,
      key: di.intentKey,
      revivalScore: di.revivalScore,
      daysDormant: di.daysDormant,
    }));

    // Generate nudge suggestions
    const suggestedNudges = this.generateNudgeSuggestions(dormantIntents, profile);

    return {
      activeIntents: activeList,
      dormantIntents: dormantList,
      suggestedNudges,
      crossAppProfile: profile,
    };
  }

  /**
   * Generate nudge suggestions based on dormant intents and profile
   */
  private generateNudgeSuggestions(
    dormantIntents: Array<{ intentKey: string; category: string; revivalScore: number }>,
    _profile: ICrossAppIntentProfile
  ): Array<{ intentKey: string; message: string; priority: 'high' | 'medium' | 'low' }> {
    return dormantIntents
      .filter((di) => di.revivalScore >= 0.3)
      .map((di) => {
        let priority: 'high' | 'medium' | 'low';
        const score = di.revivalScore;

        if (score >= 0.7) priority = 'high';
        else if (score >= 0.5) priority = 'medium';
        else priority = 'low';

        const message = this.generateNudgeMessage(di.intentKey, di.category, score);

        return { intentKey: di.intentKey, message, priority };
      });
  }

  /**
   * Generate context-aware nudge message
   */
  private generateNudgeMessage(
    intentKey: string,
    category: string,
    score: number
  ): string {
    const formattedIntent = intentKey
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

    const highScoreMessages: Record<string, string[]> = {
      TRAVEL: [
        `Perfect timing for ${formattedIntent}! Your weekend plans?`,
        `${formattedIntent} - trending searches show great deals!`,
        `Ready to book ${formattedIntent}? Exclusive offer ending soon!`,
      ],
      DINING: [
        `${formattedIntent} cravings? New restaurants added nearby!`,
        `Your saved ${formattedIntent} preferences are ready!`,
        `${formattedIntent} - top-rated spots near you with availability!`,
      ],
      RETAIL: [
        `${formattedIntent} - back in stock with special pricing!`,
        `Your ${formattedIntent} wish is about to come true!`,
        `Complete your ${formattedIntent} order - limited stock!`,
      ],
    };

    const templates = highScoreMessages[category] || highScoreMessages.RETAIL;
    return templates[Math.floor(Math.random() * templates.length)];
  }

  /**
   * Sync cross-app profile with current intents
   */
  async syncCrossAppProfile(userId: string): Promise<ICrossAppIntentProfile> {
    // Count intents by category and status
    const intents = await Intent.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: { category: '$category', status: '$status' },
          count: { $sum: 1 },
        },
      },
    ]);

    // Build count maps
    const categoryCounts: Record<string, number> = { TRAVEL: 0, DINING: 0, RETAIL: 0 };
    const dormantCounts: Record<string, number> = { TRAVEL: 0, DINING: 0, RETAIL: 0 };
    const conversionCounts: Record<string, number> = { TRAVEL: 0, DINING: 0, RETAIL: 0 };

    for (const item of intents) {
      const cat = item._id.category as string;
      if (item._id.status === 'DORMANT') {
        dormantCounts[cat] = item.count;
      } else if (item._id.status === 'FULFILLED') {
        conversionCounts[cat] = item.count;
      } else {
        categoryCounts[cat] += item.count;
      }
    }

    const total = categoryCounts.TRAVEL + categoryCounts.DINING + categoryCounts.RETAIL || 1;
    const totalConversions = conversionCounts.TRAVEL + conversionCounts.DINING + conversionCounts.RETAIL;

    // Calculate affinities (0-100)
    const travelAffinity = Math.round(((categoryCounts.TRAVEL + dormantCounts.TRAVEL) / (total * 2)) * 100);
    const diningAffinity = Math.round(((categoryCounts.DINING + dormantCounts.DINING) / (total * 2)) * 100);
    const retailAffinity = Math.round(((categoryCounts.RETAIL + dormantCounts.RETAIL) / (total * 2)) * 100);

    // Update profile
    const profile = await CrossAppIntentProfile.findOneAndUpdate(
      { userId },
      {
        $set: {
          travelIntentCount: categoryCounts.TRAVEL,
          diningIntentCount: categoryCounts.DINING,
          retailIntentCount: categoryCounts.RETAIL,
          dormantTravelCount: dormantCounts.TRAVEL,
          dormantDiningCount: dormantCounts.DINING,
          dormantRetailCount: dormantCounts.RETAIL,
          totalConversions,
          travelAffinity,
          diningAffinity,
          retailAffinity,
          updatedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );

    return profile;
  }

  /**
   * Get user affinity profile
   */
  async getUserAffinityProfile(userId: string): Promise<UserAffinityProfile> {
    const profile = await this.getProfile(userId);

    const dominantCategory = this.getDominantCategory(profile);

    return {
      userId,
      travelAffinity: profile.travelAffinity,
      diningAffinity: profile.diningAffinity,
      retailAffinity: profile.retailAffinity,
      dominantCategory,
      totalIntents:
        profile.travelIntentCount +
        profile.diningIntentCount +
        profile.retailIntentCount,
      dormantIntents:
        profile.dormantTravelCount +
        profile.dormantDiningCount +
        profile.dormantRetailCount,
      conversions: profile.totalConversions,
    };
  }

  /**
   * Determine dominant category
   */
  private getDominantCategory(profile: ICrossAppIntentProfile): 'TRAVEL' | 'DINING' | 'RETAIL' | 'MIXED' {
    const { travelAffinity, diningAffinity, retailAffinity } = profile;

    const max = Math.max(travelAffinity, diningAffinity, retailAffinity);
    const threshold = 20;

    const scores = [
      { cat: 'TRAVEL' as const, score: travelAffinity },
      { cat: 'DINING' as const, score: diningAffinity },
      { cat: 'RETAIL' as const, score: retailAffinity },
    ];

    const sorted = scores.sort((a, b) => b.score - a.score);

    if (sorted[0].score - sorted[1].score >= threshold) {
      return sorted[0].cat;
    }

    return 'MIXED';
  }

  /**
   * Aggregate demand signals for merchants
   */
  async aggregateMerchantDemand(
    merchantId: string,
    category: string,
    timeRangeDays = 30
  ): Promise<{
    demandCount: number;
    unmetDemandPct: number;
    avgConfidence: number;
    topIntentKeys: string[];
  }> {
    const since = new Date(Date.now() - timeRangeDays * 24 * 60 * 60 * 1000);

    const intents = await Intent.find({
      merchantId,
      category,
      firstSeenAt: { $gte: since },
      status: { $in: ['ACTIVE', 'DORMANT'] },
    }).select('intentKey confidence status');

    const fulfilledCount = await Intent.countDocuments({
      merchantId,
      category,
      status: 'FULFILLED',
      lastSeenAt: { $gte: since },
    });

    const totalCount = intents.length;
    const unmetDemandPct = totalCount > 0
      ? ((totalCount - fulfilledCount) / totalCount) * 100
      : 0;

    const avgConfidence = totalCount > 0
      ? intents.reduce((sum, i) => sum + i.confidence, 0) / totalCount
      : 0;

    // Group by intent key
    const intentCounts: Record<string, number> = {};
    for (const i of intents) {
      intentCounts[i.intentKey] = (intentCounts[i.intentKey] || 0) + 1;
    }

    const topIntentKeys = Object.entries(intentCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([key]) => key);

    return {
      demandCount: totalCount,
      unmetDemandPct,
      avgConfidence,
      topIntentKeys,
    };
  }

  /**
   * Get user affinity scores across categories
   */
  async getUserAffinities(userId: string): Promise<{
    travel: number;
    dining: number;
    retail: number;
    dominantCategory: 'TRAVEL' | 'DINING' | 'RETAIL' | 'MIXED';
  }> {
    const profile = await this.getProfile(userId);

    const dominant = this.getDominantCategory(profile);

    return {
      travel: profile.travelAffinity,
      dining: profile.diningAffinity,
      retail: profile.retailAffinity,
      dominantCategory: dominant,
    };
  }

  /**
   * Get users by affinity (for segmentation)
   */
  async getUsersByAffinity(
    category: 'TRAVEL' | 'DINING' | 'RETAIL',
    minAffinity: number = 70
  ): Promise<string[]> {
    const affinityField = `${category.toLowerCase()}Affinity`;

    const profiles = await CrossAppIntentProfile.find({
      [affinityField]: { $gte: minAffinity },
    }).select('userId');

    return profiles.map((p) => p.userId);
  }

  /**
   * Batch sync profiles (for cron job)
   */
  async batchSyncProfiles(userIds: string[]): Promise<number> {
    let synced = 0;

    for (const userId of userIds) {
      try {
        await this.syncCrossAppProfile(userId);
        synced++;
      } catch (error) {
        console.error(`Failed to sync profile for ${userId}:`, error);
      }
    }

    return synced;
  }

  /**
   * Get cross-app summary for dashboard
   */
  async getCrossAppSummary(): Promise<{
    totalUsers: number;
    avgAffinity: { travel: number; dining: number; retail: number };
    topCategories: Array<{ category: string; count: number }>;
  }> {
    const [userCount, avgAffinities, categoryStats] = await Promise.all([
      CrossAppIntentProfile.countDocuments(),
      CrossAppIntentProfile.aggregate([
        {
          $group: {
            _id: null,
            avgTravel: { $avg: '$travelAffinity' },
            avgDining: { $avg: '$diningAffinity' },
            avgRetail: { $avg: '$retailAffinity' },
          },
        },
      ]),
      Intent.aggregate([
        { $match: { status: 'ACTIVE' } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]),
    ]);

    return {
      totalUsers: userCount,
      avgAffinity: {
        travel: Math.round(avgAffinities[0]?.avgTravel || 50),
        dining: Math.round(avgAffinities[0]?.avgDining || 50),
        retail: Math.round(avgAffinities[0]?.avgRetail || 50),
      },
      topCategories: categoryStats.map((c) => ({ category: c._id, count: c.count })),
    };
  }
}

export const crossAppAggregationService = new CrossAppAggregationService();

/**
 * Insight Service - ReZ Mind
 * Generates insights from intent data and emits events for downstream services
 */

import { Intent, CrossAppIntentProfile } from '../models/index.js';
import { emitInsightGenerated } from '../eventBus.js';

const INSIGHTS_SERVICE_URL = process.env.INSIGHTS_SERVICE_URL || 'http://localhost:4014';

export interface Insight {
  id: string;
  userId: string;
  type: 'upsell' | 'cross_sell' | 'reactivation' | 'loyalty' | 'personalization' | 'dormant_recovery';
  title: string;
  recommendation: string;
  confidence: number;
  priority: 'high' | 'medium' | 'low';
  metadata: Record<string, unknown>;
  createdAt: Date;
}

interface InsightResult {
  insight: Insight;
  stored: boolean;
}

// Insight generation thresholds
const THRESHOLDS = {
  HIGH_CONFIDENCE: 0.75,
  MEDIUM_CONFIDENCE: 0.5,
  LOW_CONFIDENCE: 0.3,
  RECENT_DORMANT_DAYS: 30,
  CROSS_APP_AFFINITY: 40,
};

/**
 * Generate insights for a user based on their intent profile
 */
export async function generateInsights(userId: string): Promise<InsightResult[]> {
  const results: InsightResult[] = [];

  try {
    // Get user's intents
    const intents = await Intent.find({ userId, status: { $ne: 'EXPIRED' } })
      .sort({ lastSeenAt: -1 })
      .limit(50);

    // Get cross-app profile
    const profile = await CrossAppIntentProfile.findOne({ userId });

    if (!intents.length) {
      return results;
    }

    // Analyze and generate insights
    const insights = await analyzeIntents(intents, profile);

    for (const insight of insights) {
      // Emit event for real-time processing
      await emitInsightGenerated({
        userId: insight.userId,
        insightType: insight.type,
        title: insight.title,
        recommendation: insight.recommendation,
        confidence: insight.confidence,
        priority: insight.priority,
      });

      // Store in insights service
      const stored = await storeInsight(insight);

      results.push({ insight, stored });
    }

    return results;
  } catch (error) {
    console.error('[InsightService] Failed to generate insights:', error);
    throw error;
  }
}

/**
 * Analyze intents and generate appropriate insights
 */
async function analyzeIntents(
  intents: InstanceType<typeof Intent>[],
  profile: InstanceType<typeof CrossAppIntentProfile> | null
): Promise<Insight[]> {
  const insights: Insight[] = [];

  // Check for high-confidence intents (potential upsells)
  const highConfidenceIntents = intents.filter((i) => i.confidence >= THRESHOLDS.HIGH_CONFIDENCE);
  for (const intent of highConfidenceIntents) {
    insights.push({
      id: `upsell_${intent._id.toString()}_${Date.now()}`,
      userId: intent.userId,
      type: 'upsell',
      title: `High-interest: ${intent.intentKey}`,
      recommendation: `User shows strong intent for ${intent.intentKey}. Consider exclusive offer.`,
      confidence: intent.confidence,
      priority: intent.confidence >= 0.9 ? 'high' : 'medium',
      metadata: {
        intentKey: intent.intentKey,
        category: intent.category,
        appType: intent.appType,
        signalCount: intent.signals?.length || 0,
      },
      createdAt: new Date(),
    });
  }

  // Check for cross-sell opportunities based on affinity
  if (profile) {
    const affinities = [
      { name: 'Travel', value: profile.travelAffinity || 0, appType: 'hotel_ota' },
      { name: 'Dining', value: profile.diningAffinity || 0, appType: 'restaurant' },
      { name: 'Retail', value: profile.retailAffinity || 0, appType: 'retail' },
    ].sort((a, b) => b.value - a.value);

    // Cross-sell from dominant to secondary affinity
    if (affinities[0] && affinities[0].value >= THRESHOLDS.CROSS_APP_AFFINITY) {
      const secondary = affinities.find(
        (a, i) => i > 0 && a.value > 0 && a.value < affinities[0].value
      );
      if (secondary) {
        insights.push({
          id: `cross_sell_${profile._id.toString()}_${Date.now()}`,
          userId: profile.userId,
          type: 'cross_sell',
          title: `Cross-sell: ${secondary.name} for ${affinities[0].name} users`,
          recommendation: `Users with strong ${affinities[0].name} affinity also engage with ${secondary.name}.`,
          confidence: Math.min(0.8, affinities[0].value / 100),
          priority: 'medium',
          metadata: {
            primaryAffinity: affinities[0].name,
            secondaryAffinity: secondary.name,
            primaryValue: affinities[0].value,
            secondaryValue: secondary.value,
          },
          createdAt: new Date(),
        });
      }
    }
  }

  // Check for dormant intent recovery
  const now = Date.now();
  const dormantIntents = intents.filter((i) => {
    if (i.status !== 'DORMANT') return false;
    const daysSinceLastSeen =
      (now - (i.lastSeenAt?.getTime() || now)) / (1000 * 60 * 60 * 24);
    return daysSinceLastSeen <= THRESHOLDS.RECENT_DORMANT_DAYS;
  });

  for (const intent of dormantIntents) {
    insights.push({
      id: `dormant_recovery_${intent._id.toString()}_${Date.now()}`,
      userId: intent.userId,
      type: 'dormant_recovery',
      title: `Re-engage: ${intent.intentKey}`,
      recommendation: `User showed interest in ${intent.intentKey} recently. Offer incentives to reactivate.`,
      confidence: Math.max(0.3, intent.confidence - 0.2),
      priority: intent.confidence >= THRESHOLDS.MEDIUM_CONFIDENCE ? 'high' : 'medium',
      metadata: {
        intentKey: intent.intentKey,
        lastSeenAt: intent.lastSeenAt,
        daysSinceLastSeen: Math.round(
          (now - (intent.lastSeenAt?.getTime() || now)) / (1000 * 60 * 60 * 24)
        ),
      },
      createdAt: new Date(),
    });
  }

  // Check for loyalty signals
  const totalSignals = intents.reduce((sum, i) => sum + (i.signals?.length || 0), 0);
  const fulfilledCount = intents.filter((i) => i.status === 'FULFILLED').length;
  if (fulfilledCount >= 3 && totalSignals >= 10) {
    insights.push({
      id: `loyalty_${userId}_${Date.now()}`,
      userId: intents[0].userId,
      type: 'loyalty',
      title: 'Loyalty opportunity',
      recommendation: 'High-engagement user. Consider VIP treatment or loyalty rewards.',
      confidence: Math.min(0.9, 0.5 + fulfilledCount * 0.1),
      priority: 'high',
      metadata: {
        fulfilledCount,
        totalSignals,
        appsUsed: [...new Set(intents.map((i) => i.appType))].length,
      },
      createdAt: new Date(),
    });
  }

  return insights;
}

/**
 * Store insight in rez-insights-service
 */
async function storeInsight(insight: Insight): Promise<boolean> {
  try {
    const response = await fetch(`${INSIGHTS_SERVICE_URL}/api/insights`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': process.env.INTERNAL_TOKEN || '',
      },
      body: JSON.stringify(insight),
    });

    if (!response.ok) {
      console.warn('[InsightService] Failed to store insight:', response.status);
      return false;
    }

    return true;
  } catch (error) {
    console.warn('[InsightService] Error storing insight:', error);
    return false;
  }
}

/**
 * Get existing insights for a user
 */
export async function getInsights(userId: string): Promise<Insight[]> {
  try {
    const response = await fetch(
      `${INSIGHTS_SERVICE_URL}/api/insights/user/${userId}`,
      {
        headers: {
          'X-Internal-Token': process.env.INTERNAL_TOKEN || '',
        },
      }
    );

    if (!response.ok) {
      return [];
    }

    return response.json();
  } catch (error) {
    console.error('[InsightService] Error fetching insights:', error);
    return [];
  }
}

// Singleton instance
export const insightService = {
  generateInsights,
  getInsights,
};

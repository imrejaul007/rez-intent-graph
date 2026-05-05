// ── Intent Scoring Service ────────────────────────────────────────────────────
// Calculates confidence scores, dormancy detection, and revival scoring
// MongoDB implementation
// Includes weather-based scoring for context-aware recommendations

import { Intent, DormantIntent } from '../models/index.js';
import type { IIntent } from '../models/Intent.js';
import { weatherService } from './WeatherService.js';
import type { WeatherSignal, WeatherEnrichedIntent } from '../types/weather.js';

export interface ScoringContext {
  intentId: string;
  baseConfidence: number;
  signalCount: number;
  lastSignalAt: Date;
  avgVelocity: number;
  metadata: {
    appType: string;
    category: string;
    status: string;
    daysActive: number;
  };
}

export interface DormancyDetection {
  intentId: string;
  daysSinceLastActivity: number;
  currentConfidence: number;
  shouldMarkDormant: boolean;
}

export interface RevivalCandidate {
  dormantIntent: any;
  intent: any;
  revivalScore: number;
  suggestedNudge: string;
  idealTiming: Date;
}

const DORMANCY_THRESHOLD_DAYS = 7;
const CONFIDENCE_DORMANT_THRESHOLD = 0.3;

export class IntentScoringService {
  /**
   * Calculate detailed scoring context for an intent
   */
  async getScoringContext(intentId: string): Promise<ScoringContext | null> {
    const intent = await Intent.findById(intentId);

    if (!intent) return null;

    const signals = intent.signals || [];
    const signalCount = signals.length;
    const lastSignalAt = signals[0]?.capturedAt || intent.lastSeenAt;
    const avgVelocity = this.calculateAvgVelocity(signals);

    return {
      intentId,
      baseConfidence: intent.confidence,
      signalCount,
      lastSignalAt,
      avgVelocity,
      metadata: {
        appType: intent.appType,
        category: intent.category,
        status: intent.status,
        daysActive: Math.floor(
          (Date.now() - intent.firstSeenAt.getTime()) / (1000 * 60 * 60 * 24)
        ),
      },
    };
  }

  /**
   * Detect intents that should be marked as dormant
   */
  async detectDormantIntents(daysThreshold = DORMANCY_THRESHOLD_DAYS): Promise<DormancyDetection[]> {
    const thresholdDate = new Date(Date.now() - daysThreshold * 24 * 60 * 60 * 1000);

    const activeIntents = await Intent.find({
      status: 'ACTIVE',
      lastSeenAt: { $lt: thresholdDate },
    }).select('_id lastSeenAt confidence');

    return activeIntents.map((intent: any) => ({
      intentId: intent._id.toString(),
      daysSinceLastActivity: Math.floor(
        (Date.now() - intent.lastSeenAt.getTime()) / (1000 * 60 * 60 * 24)
      ),
      currentConfidence: intent.confidence,
      shouldMarkDormant:
        intent.confidence < CONFIDENCE_DORMANT_THRESHOLD ||
        (Date.now() - intent.lastSeenAt.getTime()) / (1000 * 60 * 60 * 24) >= daysThreshold,
    }));
  }

  /**
   * Calculate revival score for a dormant intent
   */
  async calculateRevivalScore(dormantIntentId: string): Promise<number> {
    const dormant = await DormantIntent.findById(dormantIntentId);

    if (!dormant) return 0;

    return this.computeRevivalScore(dormant);
  }

  /**
   * Compute revival score based on multiple factors
   */
  private computeRevivalScore(dormant: any): number {
    // Base score from intent strength
    const intentStrength = dormant.intent ? dormant.intent.confidence : 0.5;

    // Dormancy sweet spot bonus (7-14 days is optimal)
    const daysDormant = dormant.daysDormant;
    let dormancyBonus = 0;
    if (daysDormant >= 7 && daysDormant <= 14) {
      dormancyBonus = 0.15;
    } else if (daysDormant > 14 && daysDormant <= 30) {
      dormancyBonus = 0.1;
    } else if (daysDormant > 30) {
      dormancyBonus = 0.05;
    }

    // Timing factor (weekends for travel, meal times for dining)
    const timingBonus = this.calculateTimingBonus(dormant.category);

    // Recency of nudge (if nudged recently, lower score)
    let nudgePenalty = 0;
    if (dormant.lastNudgeSent) {
      const daysSinceNudge =
        (Date.now() - dormant.lastNudgeSent.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceNudge < 3) nudgePenalty = 0.3;
      else if (daysSinceNudge < 7) nudgePenalty = 0.15;
    }

    // Previous nudge resistance
    const nudgeResistance = Math.min(dormant.nudgeCount * 0.1, 0.3);

    const rawScore =
      intentStrength * 0.4 +
      dormancyBonus +
      timingBonus * 0.15 +
      (1 - dormant.dormancyScore) * 0.15 -
      nudgePenalty -
      nudgeResistance;

    return Math.min(1.0, Math.max(0.0, rawScore));
  }

  /**
   * Calculate timing bonus based on category
   */
  private calculateTimingBonus(category: string): number {
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeek = now.getDay();

    if (category === 'TRAVEL') {
      return dayOfWeek === 0 || dayOfWeek === 6 ? 0.2 : 0.05;
    }

    if (category === 'DINING') {
      if ((hour >= 11 && hour <= 14) || (hour >= 18 && hour <= 21)) {
        return 0.15;
      }
      return 0.05;
    }

    return 0.05;
  }

  /**
   * Calculate ideal revival timing
   */
  calculateIdealRevivalTime(category: string, daysDormant: number): Date {
    const baseDelay = 3;
    const now = new Date();

    switch (category) {
      case 'TRAVEL':
        const daysUntilWeekend = (7 - now.getDay() + 6) % 7 || 7;
        return new Date(now.getTime() + (baseDelay + daysUntilWeekend) * 24 * 60 * 60 * 1000);

      case 'DINING':
        const hour = now.getHours();
        let delayHours = hour < 11 ? 11 - hour : hour < 18 ? 18 - hour : 24 - hour + 11;
        return new Date(now.getTime() + delayHours * 60 * 60 * 1000);

      default:
        return new Date(now.getTime() + baseDelay * 24 * 60 * 60 * 1000);
    }
  }

  /**
   * Generate nudge message based on intent and trigger
   */
  generateNudgeMessage(
    intentKey: string,
    category: string,
    triggerType: string,
    _triggerData?: Record<string, unknown>
  ): string {
    const templates: Record<string, string[]> = {
      TRAVEL: [
        "You were looking at {intent}. Prices might be changing soon!",
        "Still thinking about {intent}? Perfect weather this weekend!",
        "Great deals on {intent} right now!",
      ],
      DINING: [
        "Your {intent} craving - restaurants near you have new options!",
        "Time for {intent}? Your favorite spots are open!",
        "{intent} is trending this week!",
      ],
      RETAIL: [
        "{intent} you've been eyeing - sale happening now!",
        "Good news! {intent} is available at a great price.",
        "Complete your {intent} order?",
      ],
    };

    const categoryTemplates = templates[category] || templates.RETAIL;
    const template = categoryTemplates[Math.floor(Math.random() * categoryTemplates.length)];

    return template.replace('{intent}', this.formatIntentKey(intentKey));
  }

  private formatIntentKey(key: string): string {
    return key
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Get revival candidates sorted by score
   */
  async getRevivalCandidates(
    limit = 100,
    minScore = 0.3
  ): Promise<RevivalCandidate[]> {
    const dormantIntents = await DormantIntent.find({
      status: 'active',
      revivalScore: { $gte: minScore },
    })
      .sort({ revivalScore: -1 })
      .limit(limit);

    const results: RevivalCandidate[] = [];

    for (const di of dormantIntents) {
      const intent = await Intent.findById(di.intentId);
      results.push({
        dormantIntent: di,
        intent,
        revivalScore: di.revivalScore,
        suggestedNudge: this.generateNudgeMessage(di.intentKey, di.category, 'scheduled'),
        idealTiming: di.idealRevivalAt || new Date(),
      });
    }

    return results;
  }

  /**
   * Calculate average velocity between signals
   */
  private calculateAvgVelocity(signals: any[]): number {
    if (signals.length < 2) return 0;

    let totalMs = 0;
    for (let i = 0; i < signals.length - 1; i++) {
      totalMs +=
        new Date(signals[i + 1].capturedAt).getTime() -
        new Date(signals[i].capturedAt).getTime();
    }

    return totalMs / (signals.length - 1);
  }

  /**
   * Get weather signal for a user location
   */
  async getWeatherSignal(
    userId: string,
    lat: number,
    lon: number
  ): Promise<WeatherSignal | null> {
    return weatherService.getWeatherSignal(userId, lat, lon);
  }

  /**
   * Apply weather modifiers to intents for ranking
   * Returns intents with adjusted confidence scores based on current weather
   */
  async applyWeatherModifiers(
    userId: string,
    intents: IIntent[],
    weatherSignal: WeatherSignal
  ): Promise<WeatherEnrichedIntent[]> {
    const enrichedIntents: WeatherEnrichedIntent[] = [];

    for (const intent of intents) {
      const weatherBoost = weatherService.getCategoryModifier(
        weatherSignal.modifiers,
        intent.category
      );

      // Apply weather boost to base confidence
      const cappedBoost = Math.min(Math.max(weatherBoost, -0.3), 0.3);
      const finalConfidence = Math.min(
        1.0,
        Math.max(0.0, intent.confidence + cappedBoost)
      );

      let boostReason = '';
      if (cappedBoost > 0.1) {
        boostReason = `${weatherSignal.weather.condition} weather increases ${intent.category} intent`;
      } else if (cappedBoost < -0.1) {
        boostReason = `${weatherSignal.weather.condition} weather decreases ${intent.category} intent`;
      }

      enrichedIntents.push({
        intentId: intent._id.toString(),
        userId: intent.userId,
        intentKey: intent.intentKey,
        category: intent.category,
        baseConfidence: intent.confidence,
        weatherModifier: cappedBoost,
        finalConfidence,
        weatherBoostReason: boostReason,
      });
    }

    // Sort by final confidence (weather-adjusted)
    enrichedIntents.sort((a, b) => b.finalConfidence - a.finalConfidence);

    return enrichedIntents;
  }

  /**
   * Get weather-aware recommendations for a user
   * Enriches active intents with current weather context
   */
  async getWeatherAwareRecommendations(
    userId: string,
    lat: number,
    lon: number,
    limit: number = 10
  ): Promise<WeatherEnrichedIntent[]> {
    // Get active intents
    const intents = await Intent.find({
      userId,
      status: 'ACTIVE',
    })
      .sort({ confidence: -1 })
      .limit(50);

    if (intents.length === 0) {
      return [];
    }

    // Get weather signal
    const weatherSignal = await this.getWeatherSignal(userId, lat, lon);

    if (!weatherSignal) {
      // Return intents without weather enrichment
      return intents.slice(0, limit).map((intent) => ({
        intentId: intent._id.toString(),
        userId: intent.userId,
        intentKey: intent.intentKey,
        category: intent.category,
        baseConfidence: intent.confidence,
        weatherModifier: 0,
        finalConfidence: intent.confidence,
        weatherBoostReason: 'Weather data unavailable',
      }));
    }

    // Apply weather modifiers
    const enriched = await this.applyWeatherModifiers(userId, intents, weatherSignal);

    return enriched.slice(0, limit);
  }

  /**
   * Calculate weather-adjusted revival score for dormant intents
   */
  async calculateWeatherAdjustedRevivalScore(
    dormantIntentId: string,
    weatherSignal: WeatherSignal
  ): Promise<number> {
    const dormant = await DormantIntent.findById(dormantIntentId);
    if (!dormant) return 0;

    // Get base revival score
    const baseScore = this.computeRevivalScore(dormant);

    // Apply weather boost if category matches
    const weatherBoost = weatherService.getCategoryModifier(
      weatherSignal.modifiers,
      dormant.category
    );

    // Weather can boost revival potential
    const adjustedScore = baseScore + (weatherBoost * 0.2);

    return Math.min(1.0, Math.max(0.0, adjustedScore));
  }
}

export const intentScoringService = new IntentScoringService();

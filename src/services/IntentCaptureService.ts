/**
 * Intent Capture Service - MongoDB
 * Captures user intent signals from various app events
 * Includes Redis caching for hot data
 * Integrates weather-based signals for context-aware intent capture
 */

import mongoose from 'mongoose';
import {
  Intent,
  IntentSequence,
  CrossAppIntentProfile,
} from '../models/index.js';
import type { IIntent, IIntentSignal } from '../models/Intent.js';
import { intentCacheService } from './IntentCacheService.js';
import { vectorSimilarityService } from './VectorSimilarityService.js';
import { weatherService, WeatherService } from './WeatherService.js';
import type { WeatherSignal, WeatherIntentModifiers } from '../types/weather.js';

// Event weights for confidence calculation
const SIGNAL_WEIGHTS: Record<string, number> = {
  search: 0.15,
  view: 0.10,
  wishlist: 0.25,
  cart_add: 0.30,
  hold: 0.35,
  checkout_start: 0.40,
  booking_start: 0.40,
  booking_confirmed: 1.0,
  fulfilled: 1.0,
  abandoned: 0.0,
};

const BASE_CONFIDENCE = 0.3;

export interface CaptureIntentParams {
  userId: string;
  appType: string;
  eventType: string;
  category: string;
  intentKey: string;
  intentQuery?: string;
  metadata?: Record<string, unknown>;
  merchantId?: string;
  // Weather context
  weather?: {
    lat?: number;
    lon?: number;
    city?: string;
    countryCode?: string;
    condition?: string;
    temperature?: number;
  };
}

export interface CaptureResult {
  intent: IIntent;
  signal: IIntentSignal;
  isNew: boolean;
  weatherSignal?: WeatherSignal | null;
  weatherBoostApplied?: number;
}

/**
 * Intent Capture Service - MongoDB Implementation
 */
export class IntentCaptureService {
  private weatherSvc: WeatherService;

  constructor() {
    this.weatherSvc = weatherService;
  }

  /**
   * Capture an intent event from user action
   * Includes optional weather context for weather-based intent enrichment
   */
  async capture(params: CaptureIntentParams): Promise<CaptureResult> {
    const {
      userId,
      appType,
      eventType,
      category,
      intentKey,
      intentQuery,
      metadata,
      merchantId,
      weather,
    } = params;

    // Calculate signal weight
    const signalWeight = SIGNAL_WEIGHTS[eventType] || 0.1;

    // Fetch weather signal if location provided
    let weatherSignal: WeatherSignal | null = null;
    let weatherBoost = 0;

    if (weather) {
      try {
        if (weather.lat !== undefined && weather.lon !== undefined) {
          weatherSignal = await this.weatherSvc.getWeatherSignal(
            userId,
            weather.lat,
            weather.lon
          );
        } else if (weather.city) {
          weatherSignal = await this.weatherSvc.getWeatherSignalByCity(
            userId,
            weather.city,
            weather.countryCode
          );
        }

        if (weatherSignal) {
          // Calculate weather boost for this category
          weatherBoost = this.weatherSvc.getCategoryModifier(
            weatherSignal.modifiers,
            category
          );
        }
      } catch (error) {
        console.warn('[IntentCapture] Weather fetch failed:', error);
      }
    }

    // Find or create intent
    const existingIntent = await Intent.findOne({ userId, appType, intentKey });

    let intent: IIntent;
    let signal: IIntentSignal;
    let isNew = false;

    // Merge weather context into metadata
    const enrichedMetadata = {
      ...metadata,
      ...(weatherSignal && {
        weatherCondition: weatherSignal.weather.condition,
        weatherTemperature: weatherSignal.weather.temperature.current,
        weatherBoost: weatherBoost,
      }),
    };

    if (existingIntent) {
      // Update existing intent
      const newConfidence = this.calculateNewConfidence(
        existingIntent,
        signalWeight,
        weatherBoost
      );
      const newStatus = this.determineStatus(eventType, newConfidence);

      existingIntent.confidence = newConfidence;
      existingIntent.status = newStatus as IIntent['status'];
      existingIntent.intentQuery = intentQuery || existingIntent.intentQuery;
      existingIntent.lastSeenAt = new Date();
      existingIntent.metadata = enrichedMetadata;

      await existingIntent.save();

      intent = existingIntent;

      // Add signal to array
      signal = {
        eventType,
        weight: signalWeight,
        data: enrichedMetadata,
        capturedAt: new Date(),
      };

      // Add signal to intent
      await Intent.updateOne(
        { _id: intent._id },
        { $push: { signals: { $each: [signal], $slice: -50 } } }
      );

      // Add to sequence
      await this.addToSequence(intent._id as mongoose.Types.ObjectId, userId, eventType);

    } else {
      // Create new intent
      isNew = true;
      const initialConfidence = Math.min(1.0, BASE_CONFIDENCE + signalWeight + weatherBoost);

      intent = await Intent.create({
        userId,
        appType,
        category,
        intentKey,
        intentQuery,
        confidence: initialConfidence,
        status: this.determineStatus(eventType, initialConfidence) as IIntent['status'],
        merchantId,
        metadata: enrichedMetadata,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        signals: [{
          eventType,
          weight: signalWeight,
          data: enrichedMetadata,
          capturedAt: new Date(),
        }],
      });

      signal = intent.signals[0];

      // Create sequence entry
      await IntentSequence.create({
        intentId: intent._id as mongoose.Types.ObjectId,
        userId,
        eventType,
        sequenceOrder: 1,
        occurredAt: new Date(),
      });

      // Update cross-app profile
      await this.updateCrossAppProfile(userId, appType, category);
    }

    return { intent, signal, isNew, weatherSignal, weatherBoostApplied: weatherBoost };
  }

  /**
   * Calculate new confidence based on existing signals, new event, and weather boost
   */
  private calculateNewConfidence(
    existingIntent: IIntent,
    newSignalWeight: number,
    weatherBoost: number = 0
  ): number {
    const recencyMultiplier = this.calculateRecencyMultiplier(existingIntent.lastSeenAt);
    const velocityBonus = this.calculateVelocityBonus(existingIntent.signals);
    const baseConfidence = existingIntent.confidence;

    // Apply weather boost (capped to prevent extreme boosts)
    const cappedWeatherBoost = Math.min(Math.max(weatherBoost, -0.3), 0.3);

    const newConfidence = baseConfidence +
      (newSignalWeight * recencyMultiplier) +
      velocityBonus +
      cappedWeatherBoost;

    return Math.min(1.0, Math.max(0.0, newConfidence));
  }

  /**
   * Calculate recency multiplier using exponential decay
   */
  private calculateRecencyMultiplier(lastSeenAt: Date): number {
    const daysSince = (Date.now() - lastSeenAt.getTime()) / (1000 * 60 * 60 * 24);
    return Math.exp(-daysSince / 30);
  }

  /**
   * Calculate velocity bonus for rapid signals
   */
  private calculateVelocityBonus(signals: IIntentSignal[]): number {
    if (signals.length < 2) return 0;

    const recentSignals = signals.slice(-5);
    const avgTimeBetweenSignals = this.calculateAvgTimeBetweenSignals(recentSignals);

    if (avgTimeBetweenSignals < 60000) return 0.2; // Less than 1 minute
    if (avgTimeBetweenSignals < 300000) return 0.1; // Less than 5 minutes
    if (avgTimeBetweenSignals < 3600000) return 0.05; // Less than 1 hour
    return 0;
  }

  private calculateAvgTimeBetweenSignals(signals: IIntentSignal[]): number {
    if (signals.length < 2) return Infinity;

    let totalMs = 0;
    for (let i = 0; i < signals.length - 1; i++) {
      totalMs += signals[i].capturedAt.getTime() - signals[i + 1].capturedAt.getTime();
    }
    return totalMs / (signals.length - 1);
  }

  /**
   * Determine intent status based on event type
   */
  private determineStatus(eventType: string, confidence: number): string {
    if (eventType === 'fulfilled') return 'FULFILLED';
    if (eventType === 'abandoned') return 'DORMANT';
    if (confidence < 0.3) return 'DORMANT';
    return 'ACTIVE';
  }

  /**
   * Add event to sequence tracking
   */
  private async addToSequence(
    intentId: mongoose.Types.ObjectId,
    userId: string,
    eventType: string
  ): Promise<void> {
    const lastSequence = await IntentSequence.findOne({ intentId })
      .sort({ sequenceOrder: -1 });

    const durationMs = lastSequence
      ? Date.now() - lastSequence.occurredAt.getTime()
      : undefined;

    await IntentSequence.create({
      intentId,
      userId,
      eventType,
      sequenceOrder: (lastSequence?.sequenceOrder || 0) + 1,
      durationMs,
      occurredAt: new Date(),
    });
  }

  /**
   * Update cross-app intent profile
   */
  private async updateCrossAppProfile(
    userId: string,
    appType: string,
    category: string
  ): Promise<void> {
    const incrementField = this.getCategoryIncrementField(appType);

    if (incrementField) {
      await CrossAppIntentProfile.findOneAndUpdate(
        { userId },
        { $inc: { [incrementField]: 1 } },
        { upsert: true }
      );
    }

    // Recalculate affinities
    await this.recalculateAffinities(userId);
  }

  private getCategoryIncrementField(appType: string): string | null {
    switch (appType) {
      case 'hotel_ota':
      case 'hotel_guest':
        return 'travelIntentCount';
      case 'restaurant':
      case 'rez_now':
        return 'diningIntentCount';
      case 'retail':
        return 'retailIntentCount';
      default:
        return null;
    }
  }

  private async recalculateAffinities(userId: string): Promise<void> {
    const intents = await Intent.find({
      userId,
      status: { $in: ['ACTIVE', 'FULFILLED'] },
    }).select('appType');

    const counts: Record<string, number> = { hotel_ota: 0, restaurant: 0, retail: 0, hotel_guest: 0, rez_now: 0 };

    intents.forEach((i) => {
      if (counts[i.appType] !== undefined) {
        counts[i.appType]++;
      }
    });

    // Group by category
    const travelCount = counts.hotel_ota + counts.hotel_guest;
    const diningCount = counts.restaurant + counts.rez_now;
    const retailCount = counts.retail;
    const total = Math.max(1, travelCount + diningCount + retailCount);

    await CrossAppIntentProfile.findOneAndUpdate(
      { userId },
      {
        $set: {
          travelAffinity: Math.round((travelCount / total) * 100),
          diningAffinity: Math.round((diningCount / total) * 100),
          retailAffinity: Math.round((retailCount / total) * 100),
          updatedAt: new Date(),
        },
      }
    );
  }

  /**
   * Get active intents for a user (with Redis cache)
   */
  async getActiveIntents(userId: string): Promise<IIntent[]> {
    // Try cache first
    const cached = await intentCacheService.getActiveIntents(userId);
    if (cached) {
      return cached as unknown as IIntent[];
    }

    // Fall back to MongoDB
    const intents = await Intent.find({ userId, status: 'ACTIVE' })
      .sort({ lastSeenAt: -1 })
      .limit(50);

    // Cache for next request
    if (intents.length > 0) {
      await intentCacheService.setActiveIntents(userId, intents.map(i => ({
        id: i._id.toString(),
        userId: i.userId,
        appType: i.appType,
        intentKey: i.intentKey,
        category: i.category,
        confidence: i.confidence,
        status: i.status,
        lastSeenAt: i.lastSeenAt.toISOString(),
        signalCount: i.signals?.length || 0,
      })));
    }

    return intents;
  }

  /**
   * Get all intents for a user across apps
   */
  async getUserIntents(userId: string): Promise<IIntent[]> {
    return Intent.find({ userId })
      .sort({ lastSeenAt: -1 })
      .limit(100);
  }

  /**
   * Get intents by app type
   */
  async getIntentsByApp(userId: string, appType: string): Promise<IIntent[]> {
    return Intent.find({ userId, appType })
      .sort({ lastSeenAt: -1 });
  }

  /**
   * Find similar intents for recommendations
   */
  async findSimilarIntents(
    userId: string,
    intentKey: string,
    category?: string,
    limit: number = 10
  ): Promise<{ intentKey: string; category: string; similarity: number }[]> {
    const results = await vectorSimilarityService.findSimilarIntents(
      userId,
      intentKey,
      category,
      limit
    );
    return results.map(r => ({
      intentKey: r.intentKey,
      category: r.category,
      similarity: r.similarity,
    }));
  }

  /**
   * Get recommendations for a user based on similar users
   */
  async getRecommendations(
    userId: string,
    category?: string,
    limit: number = 10
  ): Promise<string[]> {
    return vectorSimilarityService.getSimilarUserRecommendations(userId, category, limit);
  }
}

export const intentCaptureService = new IntentCaptureService();

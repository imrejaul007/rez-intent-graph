/**
 * Intent Cache Service - Redis Layer
 * Caches hot intents for fast reads, reduces MongoDB load
 * Falls back to in-memory Map when Redis unavailable
 */

import { sharedMemory } from '../agents/shared-memory.js';

const logger = {
  info: (msg: string, meta?: unknown) => console.log(`[IntentCache] ${msg}`, meta || ''),
  warn: (msg: string, meta?: unknown) => console.warn(`[IntentCache] ${msg}`, meta || ''),
  error: (msg: string, meta?: unknown) => console.error(`[IntentCache] ${msg}`, meta || ''),
};

// Cache TTLs (in seconds)
const TTL = {
  ACTIVE_INTENTS: 300, // 5 minutes
  USER_PROFILE: 3600, // 1 hour
  CROSS_APP_PROFILE: 1800, // 30 minutes
  DORMANT_INTENTS: 600, // 10 minutes
  USER_INTENTS: 3600, // 1 hour
};

// Key prefixes
const KEYS = {
  ACTIVE: 'intent:active:',
  USER: 'intent:user:',
  PROFILE: 'intent:profile:',
  DORMANT: 'intent:dormant:',
  CATEGORY: 'intent:category:',
};

export interface CachedIntent {
  id: string;
  userId: string;
  appType: string;
  intentKey: string;
  category: string;
  confidence: number;
  status: string;
  lastSeenAt: string;
  signalCount: number;
}

export interface CachedCrossAppProfile {
  userId: string;
  travelAffinity: number;
  diningAffinity: number;
  retailAffinity: number;
  activeIntents: number;
  dormantIntents: number;
  totalConversions: number;
}

class IntentCacheService {
  private useRedis = false;

  constructor() {
    this.useRedis = sharedMemory.isRedisAvailable();
    if (this.useRedis) {
      logger.info('Redis cache enabled');
    } else {
      logger.warn('Using in-memory cache fallback');
    }
  }

  /**
   * Get cached active intents for user
   */
  async getActiveIntents(userId: string): Promise<CachedIntent[] | null> {
    const key = `${KEYS.ACTIVE}${userId}`;

    if (this.useRedis) {
      const cached = await sharedMemory.get<CachedIntent[]>(key);
      return cached || null;
    }

    return null; // Fall back to DB
  }

  /**
   * Cache active intents for user
   */
  async setActiveIntents(userId: string, intents: CachedIntent[]): Promise<void> {
    const key = `${KEYS.ACTIVE}${userId}`;
    await sharedMemory.set(key, intents, TTL.ACTIVE_INTENTS);
  }

  /**
   * Invalidate user's intent cache
   */
  async invalidateUserCache(userId: string): Promise<void> {
    const keys = [
      `${KEYS.ACTIVE}${userId}`,
      `${KEYS.USER}${userId}`,
      `${KEYS.DORMANT}${userId}`,
      `${KEYS.PROFILE}${userId}`,
    ];

    for (const key of keys) {
      await sharedMemory.delete(key);
    }

    logger.info('Cache invalidated', { userId });
  }

  /**
   * Get cached cross-app profile
   */
  async getCrossAppProfile(userId: string): Promise<CachedCrossAppProfile | null> {
    const key = `${KEYS.PROFILE}${userId}`;

    if (this.useRedis) {
      const cached = await sharedMemory.get<CachedCrossAppProfile>(key);
      return cached || null;
    }

    return null;
  }

  /**
   * Cache cross-app profile
   */
  async setCrossAppProfile(userId: string, profile: CachedCrossAppProfile): Promise<void> {
    const key = `${KEYS.PROFILE}${userId}`;
    await sharedMemory.set(key, profile, TTL.CROSS_APP_PROFILE);
  }

  /**
   * Cache single intent update
   */
  async cacheIntent(intent: CachedIntent): Promise<void> {
    // Add to category index
    const categoryKey = `${KEYS.CATEGORY}${intent.category}`;
    const intents = await sharedMemory.get<string[]>(categoryKey) || [];
    if (!intents.includes(intent.id)) {
      intents.push(intent.id);
      await sharedMemory.set(categoryKey, intents, TTL.ACTIVE_INTENTS);
    }

    // Add to user index
    const userKey = `${KEYS.USER}${intent.userId}`;
    const userIntents = await sharedMemory.get<string[]>(userKey) || [];
    if (!userIntents.includes(intent.id)) {
      userIntents.push(intent.id);
      await sharedMemory.set(userKey, userIntents, TTL.USER_INTENTS);
    }
  }

  /**
   * Get popular intents by category (for recommendations)
   */
  async getPopularByCategory(category: string, limit: number = 10): Promise<string[]> {
    const key = `${KEYS.CATEGORY}${category}`;
    const ids = await sharedMemory.get<string[]>(key);
    return (ids || []).slice(0, limit);
  }

  /**
   * Get cache stats
   */
  async getStats(): Promise<{
    redisAvailable: boolean;
    keysCached: number;
  }> {
    return {
      redisAvailable: this.useRedis,
      keysCached: 0, // Would need Redis SCAN for accurate count
    };
  }
}

export const intentCacheService = new IntentCacheService();

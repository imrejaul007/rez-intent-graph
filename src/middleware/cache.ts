// ── Redis Cache Middleware ─────────────────────────────────────────────────────────
// 5-minute TTL cache for expensive API responses
// Reduces MongoDB load and improves response times

import { Request, Response, NextFunction } from 'express';
import { redis } from '../config/redis.js';

const DEFAULT_TTL = 300; // 5 minutes in seconds

interface CacheOptions {
  ttl?: number;
  keyPrefix?: string;
  skipOnQuery?: string[]; // Query params that should be excluded from cache key
}

/**
 * Generate cache key from request
 */
function getCacheKey(req: Request, prefix: string): string {
  const params = Object.entries(req.query)
    .filter(([_, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}:${v}`)
    .sort()
    .join('|');
  return params
    ? `cache:${prefix}:${req.params.userId || req.params.id || 'all'}:${params}`
    : `cache:${prefix}:${req.params.userId || req.params.id || 'all'}`;
}

/**
 * Redis cache middleware factory
 * Caches GET responses with configurable TTL
 */
export function withCache(options: CacheOptions = {}) {
  const { ttl = DEFAULT_TTL, keyPrefix = 'api', skipOnQuery = [] } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Skip if cache-control header is set to no-cache
    if (req.headers['cache-control']?.includes('no-cache')) {
      return next();
    }

    const cacheKey = getCacheKey(req, keyPrefix);

    try {
      // Try to get from cache
      const cached = await redis.get(cacheKey);

      if (cached) {
        const data = JSON.parse(cached);
        res.set({
          'X-Cache': 'HIT',
          'X-Cache-Key': cacheKey,
          'X-Cache-TTL': String(ttl),
          'Cache-Control': `public, max-age=${ttl}`,
        });
        res.setHeader('Content-Type', 'application/json');
        return res.send(data);
      }

      // Cache miss - intercept response
      const originalSend = res.send;
      res.send = function (body) {
        // Only cache successful responses
        if (res.statusCode >= 200 && res.statusCode < 300) {
          redis.setex(cacheKey, ttl, typeof body === 'string' ? body : JSON.stringify(body))
            .catch(err => console.error('[Cache] Failed to set cache:', err));
        }
        res.set('X-Cache', 'MISS');
        return originalSend.call(this, body);
      };

      next();
    } catch (error) {
      console.error('[Cache] Redis error:', error);
      // On Redis failure, continue without caching
      next();
    }
  };
}

/**
 * Invalidate cache for a specific pattern
 * Call this after mutations to ensure consistency
 */
export async function invalidateCache(pattern: string): Promise<void> {
  try {
    const keys = await redis.keys(`cache:${pattern}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
      console.log(`[Cache] Invalidated ${keys.length} keys matching: ${pattern}`);
    }
  } catch (error) {
    console.error('[Cache] Invalidation error:', error);
  }
}

/**
 * Invalidate all caches for a user
 */
export async function invalidateUserCache(userId: string): Promise<void> {
  return invalidateCache(`api:*:${userId}`);
}

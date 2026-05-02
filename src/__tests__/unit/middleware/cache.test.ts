/**
 * Cache Middleware Unit Tests
 * Tests for Redis caching functionality
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// Mock Redis
const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  setex: jest.fn(),
  del: jest.fn(),
  keys: jest.fn(),
};

// ── Testable Cache Functions (extracted from cache.ts) ───────────────────────────

const DEFAULT_TTL = 300;

interface CacheOptions {
  ttl?: number;
  keyPrefix?: string;
  skipOnQuery?: string[];
}

function getCacheKey(req: {
  params: { userId?: string; id?: string };
  query: Record<string, string | undefined>;
}, prefix: string): string {
  const params = Object.entries(req.query)
    .filter(([_, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}:${v}`)
    .sort()
    .join('|');
  return params
    ? `cache:${prefix}:${req.params.userId || req.params.id || 'all'}:${params}`
    : `cache:${prefix}:${req.params.userId || req.params.id || 'all'}`;
}

async function invalidateCache(pattern: string): Promise<void> {
  try {
    const keys = await mockRedis.keys(`cache:${pattern}*`);
    if (keys.length > 0) {
      await mockRedis.del(...keys);
    }
  } catch (error) {
    console.error('[Cache] Invalidation error:', error);
  }
}

// Mock next function type
type NextFunction = () => void | Promise<void>;

// Simulates the cache middleware behavior
async function simulateCacheMiddleware(
  req: { method: string; headers: Record<string, string | undefined>; params: { userId?: string; id?: string }; query: Record<string, string | undefined> },
  res: { statusCode: number; set: jest.Mock; setHeader: jest.Mock; send: jest.Mock; json: jest.Mock },
  options: CacheOptions,
  next: NextFunction
): Promise<void> {
  const { ttl = DEFAULT_TTL, keyPrefix = 'api' } = options;

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
    const cached = await mockRedis.get(cacheKey);

    if (cached) {
      const data = JSON.parse(cached);
      res.set('X-Cache', 'HIT');
      res.set('X-Cache-Key', cacheKey);
      res.set('X-Cache-TTL', String(ttl));
      res.set('Cache-Control', `public, max-age=${ttl}`);
      res.setHeader('Content-Type', 'application/json');
      return res.send(data);
    }

    // Cache miss - intercept response
    const originalSend = res.send;
    res.send = function (body: string | object) {
      // Only cache successful responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        mockRedis.setex(cacheKey, ttl, typeof body === 'string' ? body : JSON.stringify(body));
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
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('Cache Middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.get.mockReset();
    mockRedis.setex.mockReset();
    mockRedis.keys.mockReset();
    mockRedis.del.mockReset();
  });

  describe('getCacheKey', () => {
    it('should generate correct cache key with userId', () => {
      const req = {
        params: { userId: 'user123' },
        query: {},
      };
      const key = getCacheKey(req, 'api');
      expect(key).toBe('cache:api:user123');
    });

    it('should generate correct cache key with id', () => {
      const req = {
        params: { id: 'entity456' },
        query: {},
      };
      const key = getCacheKey(req, 'api');
      expect(key).toBe('cache:api:entity456');
    });

    it('should generate correct cache key with query params', () => {
      const req = {
        params: { userId: 'user123' },
        query: { category: 'food', limit: '10' },
      };
      const key = getCacheKey(req, 'api');
      expect(key).toBe('cache:api:user123:category:food|limit:10');
    });

    it('should handle empty params with default "all"', () => {
      const req = {
        params: {},
        query: {},
      };
      const key = getCacheKey(req, 'api');
      expect(key).toBe('cache:api:all');
    });

    it('should sort query params alphabetically', () => {
      const req = {
        params: { userId: 'user123' },
        query: { z: '3', a: '1', m: '2' },
      };
      const key = getCacheKey(req, 'api');
      expect(key).toBe('cache:api:user123:a:1|m:2|z:3');
    });

    it('should filter out empty query values', () => {
      const req = {
        params: { userId: 'user123' },
        query: { category: 'food', empty: '', undefined: undefined },
      };
      const key = getCacheKey(req, 'api');
      expect(key).toBe('cache:api:user123:category:food');
    });

    it('should use custom prefix', () => {
      const req = {
        params: { id: 'entity123' },
        query: {},
      };
      const key = getCacheKey(req, 'custom');
      expect(key).toBe('cache:custom:entity123');
    });
  });

  describe('middleware behavior', () => {
    let req: ReturnType<typeof createMockRequest>;
    let res: ReturnType<typeof createMockResponse>;
    let next: jest.Mock;

    function createMockRequest(overrides?: Partial<{
      method: string;
      headers: Record<string, string | undefined>;
      params: { userId?: string; id?: string };
      query: Record<string, string | undefined>;
    }>) {
      return {
        method: 'GET',
        headers: {},
        params: {},
        query: {},
        ...overrides,
      };
    }

    function createMockResponse() {
      const res = {
        statusCode: 200,
        headers: {} as Record<string, string>,
        data: null as string | object | null,
        set: jest.fn().mockImplementation(function(key: string, value: string) {
          this.headers[key] = value;
          return this;
        }),
        setHeader: jest.fn().mockImplementation(function(key: string, value: string) {
          this.headers[key] = value;
          return this;
        }),
        send: jest.fn().mockImplementation(function(body: string | object) {
          this.data = typeof body === 'string' ? JSON.parse(body) : body;
          return this;
        }),
        json: jest.fn().mockImplementation(function(body: object) {
          this.data = body;
          return this;
        }),
      };
      return res;
    }

    beforeEach(() => {
      req = createMockRequest({
        params: { userId: 'user123' },
      });
      res = createMockResponse();
      next = jest.fn();
    });

    it('should skip non-GET requests', async () => {
      req.method = 'POST';

      await simulateCacheMiddleware(req as any, res as any, {}, next);

      expect(next).toHaveBeenCalled();
      expect(mockRedis.get).not.toHaveBeenCalled();
    });

    it('should skip requests with no-cache header', async () => {
      req.headers['cache-control'] = 'no-cache';

      await simulateCacheMiddleware(req as any, res as any, {}, next);

      expect(next).toHaveBeenCalled();
      expect(mockRedis.get).not.toHaveBeenCalled();
    });

    it('should return cached data on cache hit', async () => {
      const cachedData = { message: 'cached response' };
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedData));

      await simulateCacheMiddleware(req as any, res as any, {}, next);

      expect(mockRedis.get).toHaveBeenCalledWith('cache:api:user123');
      expect(res.set).toHaveBeenCalledWith('X-Cache', 'HIT');
      expect(res.send).toHaveBeenCalledWith(cachedData);
      expect(next).not.toHaveBeenCalled();
    });

    it('should call next on cache miss', async () => {
      mockRedis.get.mockResolvedValue(null);

      await simulateCacheMiddleware(req as any, res as any, {}, next);

      expect(next).toHaveBeenCalled();
      // Note: X-Cache header is set after calling next, in the send interceptor
      expect(res.headers['X-Cache']).toBeUndefined(); // Not set until send is called
    });

    it('should cache successful responses on miss', async () => {
      mockRedis.get.mockResolvedValue(null);

      await simulateCacheMiddleware(req as any, res as any, {}, next);

      // Simulate response being sent
      res.statusCode = 200;
      const sendFn = res.send;
      sendFn.call(res, { data: 'response' });

      expect(mockRedis.setex).toHaveBeenCalled();
    });

    it('should not cache error responses', async () => {
      mockRedis.get.mockResolvedValue(null);
      res.statusCode = 500;

      await simulateCacheMiddleware(req as any, res as any, {}, next);

      // Simulate error response being sent
      const sendFn = res.send;
      sendFn.call(res, { error: 'server error' });

      expect(mockRedis.setex).not.toHaveBeenCalled();
    });

    it('should continue on Redis error', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis connection failed'));

      await simulateCacheMiddleware(req as any, res as any, {}, next);

      expect(next).toHaveBeenCalled();
    });

    it('should use custom TTL', async () => {
      mockRedis.get.mockResolvedValue(null);

      await simulateCacheMiddleware(req as any, res as any, { ttl: 600 }, next);

      res.statusCode = 200;
      const sendFn = res.send;
      sendFn.call(res, { data: 'response' });

      expect(mockRedis.setex).toHaveBeenCalledWith(
        'cache:api:user123',
        600,
        expect.any(String)
      );
    });
  });

  describe('invalidateCache', () => {
    it('should delete matching cache keys', async () => {
      mockRedis.keys.mockResolvedValue(['cache:api:user1', 'cache:api:user2']);
      mockRedis.del.mockResolvedValue(2);

      await invalidateCache('api:*');

      // The invalidateCache function prepends 'cache:' and appends '*' to the pattern
      expect(mockRedis.keys).toHaveBeenCalledWith('cache:api:**');
      expect(mockRedis.del).toHaveBeenCalledWith('cache:api:user1', 'cache:api:user2');
    });

    it('should not call del when no keys match', async () => {
      mockRedis.keys.mockResolvedValue([]);

      await invalidateCache('nonexistent:*');

      expect(mockRedis.keys).toHaveBeenCalled();
      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('should handle Redis error gracefully', async () => {
      mockRedis.keys.mockRejectedValue(new Error('Redis error'));

      // Should not throw
      await expect(invalidateCache('api:*')).resolves.not.toThrow();
    });
  });

  describe('cache key edge cases', () => {
    it('should handle unicode characters in params', () => {
      const req = {
        params: { userId: '用户123' },
        query: {},
      };
      const key = getCacheKey(req, 'api');
      expect(key).toBe('cache:api:用户123');
    });

    it('should handle special characters in query values', () => {
      const req = {
        params: { userId: 'user123' },
        query: { search: 'pizza & pasta' },
      };
      const key = getCacheKey(req, 'api');
      expect(key).toBe('cache:api:user123:search:pizza & pasta');
    });

    it('should handle numeric string query values', () => {
      const req = {
        params: { id: '123' },
        query: { page: '1', limit: '20' },
      };
      const key = getCacheKey(req, 'api');
      expect(key).toBe('cache:api:123:limit:20|page:1');
    });
  });
});

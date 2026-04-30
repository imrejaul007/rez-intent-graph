// ── Redis Configuration ──────────────────────────────────────────────────────────────
// Redis connection for caching and pub/sub
// Uses ioredis for TypeScript support and performance

import { Redis as IORedis } from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Main Redis client for general operations
export const redis = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null, // Required for Socket.io
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  reconnectOnError: (err: Error) => {
    const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
    if (targetErrors.some(e => err.message.includes(e))) {
      return true;
    }
    return false;
  },
});

// Publisher client for pub/sub (separate connection)
export const publisher = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

// Subscriber client for pub/sub (separate connection)
export const subscriber = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

// Connection events
redis.on('connect', () => {
  console.log('[Redis] Connected');
});

redis.on('error', (err: Error) => {
  console.error('[Redis] Error:', err.message);
});

redis.on('close', () => {
  console.warn('[Redis] Connection closed');
});

// Health check
export async function checkRedisHealth(): Promise<boolean> {
  try {
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

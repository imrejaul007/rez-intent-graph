// ── Redis Configuration ──────────────────────────────────────────────────────────────
// Redis connection for caching and pub/sub
// Supports both REDIS_URL (ioredis format) and REDIS_HOST/PORT/PASSWORD

import { Redis as IORedis } from 'ioredis';

// Support both formats
function getRedisConfig() {
  // Check for REDIS_URL first
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    return redisUrl;
  }

  // Fall back to REDIS_HOST/PORT/PASSWORD
  const host = process.env.REDIS_HOST || 'localhost';
  const port = process.env.REDIS_PORT || '6379';
  const password = process.env.REDIS_PASSWORD;

  if (password) {
    return `redis://:${password}@${host}:${port}`;
  }
  return `redis://${host}:${port}`;
}

const REDIS_URL = getRedisConfig();

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

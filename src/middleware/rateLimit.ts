/**
 * Rate Limiting Middleware
 * Protects API endpoints from abuse
 */

import rateLimit from 'express-rate-limit';

/**
 * Standard rate limit — 100 requests per minute per IP
 * For most public/read endpoints
 */
export const standardLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => {
    return (req.headers['x-user-id'] as string) || req.ip || 'unknown';
  },
});

/**
 * Strict rate limit — 20 requests per minute per IP
 * For write operations and expensive queries
 */
export const strictLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded. Please slow down.' },
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => {
    return (req.headers['x-user-id'] as string) || req.ip || 'unknown';
  },
});

/**
 * Auth rate limit — 10 attempts per minute per IP
 * For login/authentication endpoints
 */
export const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts.' },
});

/**
 * Nudge rate limit — 10 nudges per minute per merchant/user
 * Prevents notification bombing
 */
export const nudgeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Nudge rate limit exceeded. Max 10 nudges per minute.' },
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => {
    const userId = req.body?.userId || req.ip || 'unknown';
    return `nudge:${userId}`;
  },
});

/**
 * Capture rate limit — 200 events per minute per user
 * Higher limit since intent capture is the main traffic source
 */
export const captureLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Intent capture rate limit exceeded.' },
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => {
    return (req.headers['x-user-id'] as string) || req.ip || 'unknown';
  },
});

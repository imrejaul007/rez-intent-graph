/**
 * Authentication Middleware
 * Shared auth functions for protecting API endpoints
 */

import type { Request, Response, NextFunction } from 'express';

/**
 * Verify internal service token (server-to-server auth)
 */
export function verifyInternalToken(req: Request, res: Response, next: NextFunction): void {
  const internalToken = req.headers['x-internal-token'] as string;
  if (internalToken && internalToken === process.env.INTERNAL_SERVICE_TOKEN) {
    next();
    return;
  }
  res.status(401).json({ error: 'Unauthorized: invalid or missing x-internal-token' });
}

/**
 * Verify API key
 */
export function verifyApiKey(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'] as string;
  if (apiKey && apiKey === process.env.MERCHANT_API_KEY) {
    next();
    return;
  }
  res.status(401).json({ error: 'Unauthorized: invalid or missing x-api-key' });
}

/**
 * Verify cron secret
 */
export function verifyCronSecret(req: Request, res: Response, next: NextFunction): void {
  const cronSecret = process.env.INTENT_CRON_SECRET;
  if (!cronSecret) {
    if (process.env.NODE_ENV === 'production') {
      res.status(503).json({ error: 'Cron secret not configured in production' });
      return;
    }
    next();
    return;
  }
  if (req.headers['x-cron-secret'] === cronSecret) {
    next();
    return;
  }
  res.status(401).json({ error: 'Unauthorized: invalid or missing x-cron-secret' });
}

/**
 * Verify webhook secret
 */
export function verifyWebhookSecret(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.INTENT_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      res.status(401).json({ error: 'Webhook secret not configured in production' });
      return;
    }
    next();
    return;
  }
  const webhookSecret = req.headers['x-webhook-secret'] as string;
  if (webhookSecret && webhookSecret === secret) {
    next();
    return;
  }
  res.status(401).json({ error: 'Unauthorized: invalid or missing x-webhook-secret' });
}

/**
 * Require any authentication method: internal token, API key, or cron secret
 */
export function requireAnyAuth(req: Request, res: Response, next: NextFunction): void {
  const internalToken = req.headers['x-internal-token'] as string;
  const apiKey = req.headers['x-api-key'] as string;
  const cronSecret = req.headers['x-cron-secret'] as string;

  if (internalToken && internalToken === process.env.INTERNAL_SERVICE_TOKEN) { next(); return; }
  if (apiKey && apiKey === process.env.MERCHANT_API_KEY) { next(); return; }
  if (cronSecret && cronSecret === process.env.INTENT_CRON_SECRET) { next(); return; }

  res.status(401).json({
    error: 'Unauthorized: provide x-internal-token, x-api-key, or x-cron-secret header',
  });
}

/**
 * Require user context — either a valid x-user-id header OR any auth method
 * Used for user-scoped read endpoints where a userId header is sufficient
 */
export function requireUserOrAuth(req: Request, res: Response, next: NextFunction): void {
  const userId = req.headers['x-user-id'] as string;
  if (userId && userId.trim() !== '') {
    next();
    return;
  }
  // Fall back to any auth method
  requireAnyAuth(req, res, next);
}

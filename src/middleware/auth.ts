/**
 * Authentication Middleware
 * Shared auth functions for protecting API endpoints
 */

import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

/**
 * Verify internal service token (server-to-server auth)
 * Uses timing-safe comparison to prevent timing attacks
 */
export function verifyInternalToken(req: Request, res: Response, next: NextFunction): void {
  const internalToken = req.headers['x-internal-token'] as string;
  const token = process.env.INTERNAL_SERVICE_TOKEN;

  // Fail fast on length mismatch (prevents timing oracle)
  if (!internalToken || !token || internalToken.length !== token.length) {
    res.status(401).json({ error: 'Unauthorized: invalid or missing x-internal-token' });
    return;
  }

  // Timing-safe comparison to prevent timing attacks
  const valid = crypto.timingSafeEqual(Buffer.from(internalToken), Buffer.from(token));
  if (valid) {
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

  const internalTokenEnv = process.env.INTERNAL_SERVICE_TOKEN;
  const apiKeyEnv = process.env.MERCHANT_API_KEY;
  const cronSecretEnv = process.env.INTENT_CRON_SECRET;

  if (internalToken && internalTokenEnv && internalToken === internalTokenEnv) { next(); return; }
  if (apiKey && apiKeyEnv && apiKey === apiKeyEnv) { next(); return; }
  if (cronSecret && cronSecretEnv && cronSecret === cronSecretEnv) { next(); return; }

  res.status(401).json({
    error: 'Unauthorized: provide x-internal-token, x-api-key, or x-cron-secret header',
  });
}

/**
 * Require user context — either a valid x-user-id header OR any auth method
 * Used for user-scoped read endpoints where a userId header is sufficient
 *
 * SECURITY NOTE: This middleware trusts the x-user-id header. It should ONLY be used
 * when this service is behind a reverse proxy/gateway that authenticates the user
 * and sets this header. Direct exposure to the internet would allow user spoofing.
 *
 * For production deployments without a trusted gateway, use requireAuthenticatedUser
 * which verifies the JWT token.
 */
export function requireUserOrAuth(req: Request, res: Response, next: NextFunction): void {
  const userId = req.headers['x-user-id'] as string;

  // SECURITY: Validate userId format (MongoDB ObjectId)
  if (userId) {
    // ObjectId is 24 hex characters
    const isValidObjectId = /^[a-fA-F0-9]{24}$/.test(userId.trim());
    if (!isValidObjectId) {
      res.status(400).json({ error: 'Invalid x-user-id format' });
      return;
    }
    // Only accept if from trusted proxy (check X-Forwarded-For or specific header)
    const forwardedBy = req.headers['x-trusted-proxy'];
    if (!forwardedBy && process.env.NODE_ENV === 'production') {
      // In production, require either auth token or trusted proxy header
      requireAnyAuth(req, res, next);
      return;
    }
  }

  if (userId && userId.trim() !== '') {
    next();
    return;
  }
  // Fall back to any auth method
  requireAnyAuth(req, res, next);
}

/**
 * Verify JWT token for user authentication
 * Use this for endpoints that need proper user verification
 */
export async function verifyUserJWT(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.substring(7);

  // Validate token structure (JWT has 3 parts)
  const parts = token.split('.');
  if (parts.length !== 3) {
    res.status(401).json({ error: 'Invalid token format' });
    return;
  }

  // In production, verify token with auth service
  if (process.env.NODE_ENV === 'production') {
    try {
      const authServiceUrl = process.env.AUTH_SERVICE_URL;
      if (!authServiceUrl) {
        res.status(503).json({ error: 'Auth service not configured' });
        return;
      }

      const response = await fetch(`${authServiceUrl}/internal/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-token': process.env.INTERNAL_SERVICE_TOKEN || '',
        },
        body: JSON.stringify({ token }),
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
      }

      const data = await response.json() as { userId?: string; role?: string };
      if (data.userId) {
        (req.headers as Record<string, string>)['x-user-id'] = data.userId;
      }
    } catch (error) {
      res.status(503).json({ error: 'Auth service unavailable' });
      return;
    }
  }

  next();
}

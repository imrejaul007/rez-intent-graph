// ── Sentry Error Tracking ─────────────────────────────────────────────────────────
// Enterprise-grade error tracking with Express integration, user context, and
// distributed tracing support

import type { Request, Response, NextFunction } from 'express';

// ── Sentry Types (conditional import to avoid errors when not installed) ────────────

interface SentryScope {
  setUser(user: { id?: string; email?: string; username?: string; ip_address?: string } | null): void;
  setTag(key: string, value: string): void;
  setExtra(key: string, value: unknown): void;
  setContext(name: string, context: Record<string, unknown>): void;
  captureException(error: Error): string;
  captureMessage(message: string, level?: string): string;
  startTransaction(options: { name: string; op: string; tags?: Record<string, string> }): { setTag: (key: string, value: string) => void; finish: () => void };
}

interface SentryHub {
  getScope(): SentryScope;
}

interface Sentry {
  init(options: {
    dsn?: string;
    environment?: string;
    release?: string;
    serverName?: string;
    sampleRate?: number;
    maxBreadcrumbs?: number;
    attachStacktrace?: boolean;
    autoSessionTracking?: boolean;
    sendClientReports?: boolean;
    integrations?: unknown[];
  }): void;
  getScope(): SentryScope;
  getHub(): SentryHub;
  getCurrentHub(): SentryHub;
}

// ── Lazy Sentry Import ───────────────────────────────────────────────────────────

let sentryInitialized = false;
let sentry: Sentry | null = null;

async function getSentry(): Promise<Sentry | null> {
  const SENTRY_DSN = process.env.SENTRY_DSN;

  if (!SENTRY_DSN) {
    console.warn('[Sentry] SENTRY_DSN not configured - error tracking disabled');
    return null;
  }

  if (sentry) {
    return sentry;
  }

  try {
    // Dynamic import to avoid errors when not installed
    const sentryModule = await import('@sentry/node');
    sentry = sentryModule as unknown as Sentry;
    return sentry;
  } catch (error) {
    console.warn('[Sentry] @sentry/node not installed - error tracking disabled');
    console.warn('[Sentry] Install with: npm install @sentry/node');
    return null;
  }
}

// ── Sentry Configuration ──────────────────────────────────────────────────────────

const NODE_ENV = process.env.NODE_ENV || 'development';
const SERVICE_NAME = process.env.SERVICE_NAME || 'intent-graph';

/**
 * Initialize Sentry error tracking
 */
export async function initSentry(): Promise<boolean> {
  const SENTRY_DSN = process.env.SENTRY_DSN;

  if (!SENTRY_DSN) {
    console.log('[Sentry] Skipping initialization - SENTRY_DSN not set');
    return false;
  }

  const sentryInstance = await getSentry();
  if (!sentryInstance) {
    return false;
  }

  try {
    sentryInstance.init({
      dsn: SENTRY_DSN,
      environment: NODE_ENV,
      release: process.env.npm_package_version || '0.0.0',
      serverName: `${SERVICE_NAME}-${process.env.INSTANCE_ID || 'single'}`,
      sampleRate: NODE_ENV === 'production' ? 1.0 : 0.5,
      maxBreadcrumbs: 50,
      attachStacktrace: true,
      autoSessionTracking: true,
      sendClientReports: true,
    });

    sentryInitialized = true;

    console.log(`[Sentry] Initialized for ${SERVICE_NAME} in ${NODE_ENV} mode`);

    // Set up unhandled rejection tracking
    setupUnhandledRejectionTracking();

    // Set up uncaught exception tracking
    setupUncaughtExceptionTracking();

    return true;
  } catch (error) {
    console.error('[Sentry] Failed to initialize:', error);
    return false;
  }
}

/**
 * Check if Sentry is initialized
 */
export function isSentryInitialized(): boolean {
  return sentryInitialized;
}

// ── User Context ────────────────────────────────────────────────────────────────

interface UserContext {
  id?: string;
  email?: string;
  username?: string;
  ipAddress?: string;
}

/**
 * Set user context for current scope
 */
export async function setUserContext(user: UserContext): Promise<void> {
  const sentryInstance = await getSentry();
  if (!sentryInstance || !sentryInitialized) return;

  try {
    const scope = sentryInstance.getScope();
    scope.setUser({
      id: user.id,
      email: user.email,
      username: user.username,
      ip_address: user.ipAddress,
    });
  } catch {
    // Ignore errors
  }
}

/**
 * Clear user context
 */
export async function clearUserContext(): Promise<void> {
  const sentryInstance = await getSentry();
  if (!sentryInstance || !sentryInitialized) return;

  try {
    const scope = sentryInstance.getScope();
    scope.setUser(null);
  } catch {
    // Ignore errors
  }
}

/**
 * Set extra context
 */
export async function setExtraContext(context: Record<string, unknown>): Promise<void> {
  const sentryInstance = await getSentry();
  if (!sentryInstance || !sentryInitialized) return;

  try {
    const scope = sentryInstance.getScope();
    Object.entries(context).forEach(([key, value]) => {
      scope.setExtra(key, value);
    });
  } catch {
    // Ignore errors
  }
}

/**
 * Set tag
 */
export async function setTag(key: string, value: string): Promise<void> {
  const sentryInstance = await getSentry();
  if (!sentryInstance || !sentryInitialized) return;

  try {
    const scope = sentryInstance.getScope();
    scope.setTag(key, value);
  } catch {
    // Ignore errors
  }
}

// ── Error Capture ────────────────────────────────────────────────────────────────

/**
 * Capture an exception
 */
export async function captureException(
  error: Error,
  context?: {
    user?: UserContext;
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
    correlationId?: string;
    traceId?: string;
    requestId?: string;
  }
): Promise<string | null> {
  const sentryInstance = await getSentry();
  if (!sentryInstance || !sentryInitialized) {
    console.error('[Sentry] Not initialized - logging error locally:', error.message);
    return null;
  }

  try {
    const scope = sentryInstance.getScope();

    // Add correlation IDs
    if (context?.correlationId) {
      scope.setTag('correlation_id', context.correlationId);
    }
    if (context?.traceId) {
      scope.setTag('trace_id', context.traceId);
    }
    if (context?.requestId) {
      scope.setTag('request_id', context.requestId);
    }

    // Add tags
    if (context?.tags) {
      Object.entries(context.tags).forEach(([key, value]) => {
        scope.setTag(key, value);
      });
    }

    // Add extra context
    if (context?.extra) {
      Object.entries(context.extra).forEach(([key, value]) => {
        scope.setExtra(key, value);
      });
    }

    // Add user context
    if (context?.user) {
      scope.setUser({
        id: context.user.id,
        email: context.user.email,
        username: context.user.username,
        ip_address: context.user.ipAddress,
      });
    }

    const eventId = scope.captureException(error);

    // Log locally as backup
    console.error(`[Sentry] Exception captured: ${eventId}`, {
      message: error.message,
      stack: error.stack,
      correlationId: context?.correlationId,
    });

    return eventId;
  } catch (e) {
    console.error('[Sentry] Error capturing exception:', e);
    return null;
  }
}

/**
 * Capture a message
 */
export async function captureMessage(
  message: string,
  level: 'fatal' | 'error' | 'warning' | 'info' | 'debug' = 'info',
  context?: {
    user?: UserContext;
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
  }
): Promise<string | null> {
  const sentryInstance = await getSentry();
  if (!sentryInstance || !sentryInitialized) {
    console.log(`[Sentry] Message (not tracked): ${message}`);
    return null;
  }

  try {
    const scope = sentryInstance.getScope();

    if (context?.tags) {
      Object.entries(context.tags).forEach(([key, value]) => {
        scope.setTag(key, value);
      });
    }

    if (context?.extra) {
      Object.entries(context.extra).forEach(([key, value]) => {
        scope.setExtra(key, value);
      });
    }

    if (context?.user) {
      scope.setUser({
        id: context.user.id,
        email: context.user.email,
        username: context.user.username,
      });
    }

    const eventId = scope.captureMessage(message, level);

    return eventId;
  } catch (e) {
    console.error('[Sentry] Error capturing message:', e);
    return null;
  }
}

/**
 * Add breadcrumb
 */
export async function addBreadcrumb(
  message: string,
  category: string,
  data?: Record<string, unknown>,
  level: 'fatal' | 'error' | 'warning' | 'info' | 'debug' = 'info'
): Promise<void> {
  const sentryInstance = await getSentry();
  if (!sentryInstance || !sentryInitialized) return;

  // Breadcrumbs are handled via extra context
  try {
    const scope = sentryInstance.getScope();
    scope.setExtra(`breadcrumb_${category}`, { message, data, level });
  } catch {
    // Ignore errors
  }
}

// ── Express Error Middleware ────────────────────────────────────────────────────

/**
 * Create Express error handling middleware
 */
export async function createErrorMiddleware(): Promise<(
  err: Error & { statusCode?: number; status?: number; code?: string },
  req: Request,
  res: Response,
  next: NextFunction
) => void> {
  return (
    err: Error & { statusCode?: number; status?: number; code?: string },
    req: Request,
    res: Response,
    _next: NextFunction
  ): void => {
    // Extract status code
    const statusCode = err.statusCode || err.status || 500;
    const isClientError = statusCode >= 400 && statusCode < 500;
    const isServerError = statusCode >= 500;

    // Get correlation IDs from headers
    const correlationId = (req.headers['x-correlation-id'] as string) || undefined;
    const traceId = (req.headers['x-trace-id'] as string) || undefined;
    const requestId = (req.headers['x-request-id'] as string) || undefined;

    // Get user context from request (if authenticated)
    const user = extractUserFromRequest(req);

    // Build extra context
    const extra: Record<string, unknown> = {
      statusCode,
      status: statusCode < 500 ? 'ok' : 'error',
      method: req.method,
      path: req.path,
      query: req.query,
      body: sanitizeBody(req.body),
      userAgent: req.headers['user-agent'],
      referer: req.headers['referer'],
    };

    // Add error code if present
    if (err.code) {
      extra.errorCode = err.code;
    }

    // Capture to Sentry
    if (sentryInitialized) {
      const sentryInstance = sentry;
      if (sentryInstance) {
        try {
          const scope = sentryInstance.getScope();
          scope.setTag('http_status_code', String(statusCode));

          if (correlationId) {
            scope.setTag('correlation_id', correlationId);
          }
          if (traceId) {
            scope.setTag('trace_id', traceId);
          }
          if (requestId) {
            scope.setTag('request_id', requestId);
          }

          Object.entries(extra).forEach(([key, value]) => {
            scope.setExtra(key, value);
          });

          if (user) {
            scope.setUser({
              id: user.id,
              email: user.email,
              username: user.username,
              ip_address: req.ip,
            });
          }

          scope.captureException(err);
        } catch {
          // Ignore Sentry errors
        }
      }
    }

    // Log to console
    const logMessage = `[${req.method}] ${req.path} ${statusCode} - ${err.message}`;
    if (isServerError) {
      console.error(logMessage, {
        correlationId,
        traceId,
        requestId,
        stack: err.stack,
        userId: user?.id,
      });
    } else if (isClientError) {
      console.warn(logMessage, { correlationId, requestId });
    }

    // Send response (don't leak internal error details in production)
    const response = {
      error: statusCode < 500 ? 'Request failed' : 'Internal server error',
      message: NODE_ENV === 'production' && isServerError ? undefined : err.message,
      statusCode,
      ...(correlationId && { correlationId }),
      ...(requestId && { requestId }),
    };

    res.status(statusCode).json(response);
  };
}

/**
 * Extract user info from request
 */
function extractUserFromRequest(req: Request): UserContext | null {
  // Try different locations where user might be attached
  const user = (req as unknown as { user?: UserContext; session?: { user?: UserContext } }).user;
  const sessionUser = (req as unknown as { session?: { user?: UserContext } }).session?.user;

  if (user) {
    return user;
  }

  if (sessionUser) {
    return sessionUser;
  }

  // Try headers for user ID
  const userId = req.headers['x-user-id'] as string;
  const userEmail = req.headers['x-user-email'] as string;

  if (userId) {
    return { id: userId, email: userEmail };
  }

  return null;
}

/**
 * Sanitize body for logging
 */
function sanitizeBody(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const sensitiveFields = [
    'password',
    'token',
    'secret',
    'apiKey',
    'api_key',
    'authorization',
    'creditCard',
    'credit_card',
    'ssn',
  ];

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (sensitiveFields.some((field) => key.toLowerCase().includes(field))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeBody(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

// ── Unhandled Rejection Tracking ────────────────────────────────────────────────

function setupUnhandledRejectionTracking(): void {
  process.on('unhandledRejection', async (reason: unknown, promise: Promise<unknown>) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));

    await captureException(error, {
      tags: {
        type: 'unhandled_rejection',
        promise: String(promise),
      },
      extra: {
        promise: String(promise),
        reason: String(reason),
      },
    });

    console.error('[Sentry] Unhandled Promise Rejection:', error);
  });
}

// ── Uncaught Exception Tracking ─────────────────────────────────────────────────

function setupUncaughtExceptionTracking(): void {
  process.on('uncaughtException', async (error: Error) => {
    await captureException(error, {
      tags: {
        type: 'uncaught_exception',
      },
    });

    console.error('[Sentry] Uncaught Exception:', error);

    // Exit with non-zero code
    process.exit(1);
  });
}

// ── Request Handler Middleware ───────────────────────────────────────────────────

/**
 * Create Sentry request handler for Express
 */
export async function createRequestHandler(): Promise<(
  req: Request,
  res: Response,
  next: NextFunction
) => void> {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!sentryInitialized || !sentry) {
      next();
      return;
    }

    // Extract correlation IDs
    const correlationId = (req.headers['x-correlation-id'] as string) || undefined;
    const traceId = (req.headers['x-trace-id'] as string) || undefined;

    try {
      const scope = sentry.getScope();
      scope.setTag('http.method', req.method);
      scope.setTag('http.url', req.path);
      scope.setTag('http.user_agent', req.headers['user-agent'] || '');

      if (correlationId) {
        scope.setTag('correlation_id', correlationId);
      }
      if (traceId) {
        scope.setTag('trace_id', traceId);
      }

      // Add request info
      scope.setContext('Request', {
        method: req.method,
        url: `${req.protocol}://${req.hostname}${req.originalUrl}`,
        headers: {
          'Content-Type': req.headers['content-type'] || '',
          'User-Agent': req.headers['user-agent'] || '',
          'X-Forwarded-For': req.headers['x-forwarded-for'] as string || '',
        },
      });

      // Add user if authenticated
      const user = extractUserFromRequest(req);
      if (user) {
        scope.setUser({
          id: user.id,
          email: user.email,
          username: user.username,
          ip_address: req.ip,
        });
      }
    } catch {
      // Ignore errors
    }

    next();
  };
}

// ── Express Middleware Setup ────────────────────────────────────────────────────

// Define Express app type
type ExpressApp = {
  use: (handler: unknown) => void;
};

/**
 * Setup all Sentry middleware for Express app
 */
export async function setupSentryMiddleware(app: ExpressApp): Promise<void> {
  // Initialize Sentry first
  await initSentry();

  if (!sentryInitialized) {
    console.log('[Sentry] Middleware not configured - Sentry not initialized');
    return;
  }

  // Request handler (must be first)
  const requestHandler = await createRequestHandler();
  app.use(requestHandler);

  // Error handler (must be last)
  const errorHandler = await createErrorMiddleware();
  app.use(errorHandler);

  console.log('[Sentry] Middleware configured');
}

// ── Performance Monitoring ──────────────────────────────────────────────────────

/**
 * Start a transaction for performance monitoring
 */
export async function startTransaction(
  name: string,
  op: string,
  context?: {
    correlationId?: string;
    traceId?: string;
    tags?: Record<string, string>;
  }
): Promise<{ span: unknown; finish: (endContext?: Record<string, unknown>) => void } | null> {
  const sentryInstance = await getSentry();
  if (!sentryInstance || !sentryInitialized) {
    return null;
  }

  try {
    const scope = sentryInstance.getScope();
    const span = scope.startTransaction({
      name,
      op,
      tags: context?.tags,
    });

    if (context?.correlationId) {
      span.setTag('correlation_id', context.correlationId);
    }
    if (context?.traceId) {
      span.setTag('trace_id', context.traceId);
    }

    return {
      span,
      finish: (endContext?: Record<string, unknown>) => {
        if (endContext) {
          Object.entries(endContext).forEach(([key, value]) => {
            span.setTag(key, String(value));
          });
        }
        span.finish();
      },
    };
  } catch {
    return null;
  }
}

// ── Export Default ─────────────────────────────────────────────────────────────

export default {
  init: initSentry,
  isInitialized: isSentryInitialized,
  setUserContext,
  clearUserContext,
  setExtraContext,
  setTag,
  captureException,
  captureMessage,
  addBreadcrumb,
  createErrorMiddleware,
  createRequestHandler,
  setupSentryMiddleware,
  startTransaction,
};

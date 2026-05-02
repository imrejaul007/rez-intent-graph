// ── Enterprise Logging Solution ───────────────────────────────────────────────────
// Winston-based structured logging with JSON output, log rotation, and correlation
// Designed for enterprise observability and log aggregation

import winston from 'winston';
import path from 'path';

// ── Types ────────────────────────────────────────────────────────────────────────

export interface LogContext {
  service?: string;
  traceId?: string;
  correlationId?: string;
  userId?: string;
  requestId?: string;
  intentId?: string;
  intentType?: string;
  agentName?: string;
  agentAction?: string;
  serviceName?: string;
  serviceMethod?: string;
  method?: string;
  path?: string;
  success?: boolean;
  duration?: number;
  statusCode?: number;
  context?: string;
  error?: unknown;
  [key: string]: string | number | boolean | unknown | undefined;
}

// ── Environment Configuration ────────────────────────────────────────────────────

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const NODE_ENV = process.env.NODE_ENV || 'development';
const LOG_DIR = process.env.LOG_DIR || 'logs';
const SERVICE_NAME = process.env.SERVICE_NAME || 'intent-graph';

// ── JSON Formatter ─────────────────────────────────────────────────────────────

const jsonFormatter = winston.format.combine(
  winston.format.timestamp({ format: 'ISO' }),
  winston.format.errors({ stack: true }),
  winston.format.printf((info) => {
    const timestamp = info.timestamp;
    const level = info.level;
    const message = info.message;

    // Extract standard properties
    const { timestamp: _t, level: _l, message: _m, service: _s, stack: _st, ...rest } = info as Record<string, unknown>;

    const logEntry: Record<string, unknown> = {
      timestamp,
      level,
      service: SERVICE_NAME,
      message,
    };

    // Add trace/correlation IDs if present
    if (rest.traceId) logEntry.traceId = rest.traceId;
    if (rest.correlationId) logEntry.correlationId = rest.correlationId;
    if (rest.userId) logEntry.userId = rest.userId;
    if (rest.requestId) logEntry.requestId = rest.requestId;
    if (rest.duration) logEntry.duration = rest.duration;
    if (rest.statusCode) logEntry.statusCode = rest.statusCode;
    if (rest.method) logEntry.method = rest.method;
    if (rest.path) logEntry.path = rest.path;
    if (rest.context) logEntry.context = rest.context;

    // Add error info if present
    if (rest.error instanceof Error) {
      logEntry.error = {
        name: rest.error.name,
        message: rest.error.message,
        stack: rest.error.stack,
      };
    } else if (_st) {
      logEntry.error = { name: 'Error', message: String(_st) };
    }

    // Merge additional context
    const excludedKeys = ['timestamp', 'level', 'service', 'message', 'stack', 'traceId', 'correlationId', 'userId', 'requestId', 'duration', 'statusCode', 'method', 'path', 'context', 'error'];
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined && !excludedKeys.includes(key)) {
        logEntry[key] = value;
      }
    }

    return JSON.stringify(logEntry);
  })
);

// ── Console Formatter (Development) ───────────────────────────────────────────

const consoleFormatter = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.printf((info) => {
    const timestamp = info.timestamp as string;
    const level = info.level;
    const message = info.message;
    const traceId = info.traceId as string | undefined;
    const correlationId = info.correlationId as string | undefined;
    const context = info.context as string | undefined;

    const extras: string[] = [];
    if (traceId) extras.push(`[trace:${traceId.slice(0, 8)}]`);
    if (correlationId) extras.push(`[corr:${correlationId.slice(0, 8)}]`);
    if (context) extras.push(`[${context}]`);
    if (info.duration) extras.push(`${info.duration}ms`);

    const { timestamp: _t, level: _l, message: _m, ...rest } = info as Record<string, unknown>;
    const others = Object.entries(rest)
      .filter(([k, v]) => !['traceId', 'correlationId', 'context', 'service', 'error', 'stack', 'timestamp', 'level', 'message'].includes(k) && v !== undefined)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    if (others) extras.push(others);

    const extra = extras.length > 0 ? ` ${extras.join(' ')}` : '';
    return `${timestamp} ${level}: ${message}${extra}`;
  })
);

// ── Transport Configuration ─────────────────────────────────────────────────────

const transports: winston.transport[] = [
  // Console transport
  new winston.transports.Console({
    level: LOG_LEVEL,
    format: NODE_ENV === 'production' ? jsonFormatter : consoleFormatter,
  }),
];

// File transports for production
if (NODE_ENV === 'production' || process.env.LOG_TO_FILE === 'true') {
  // Error log - only errors
  transports.push(
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      format: jsonFormatter,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 14, // Keep 14 days of error logs
      tailable: true,
    })
  );

  // Combined log - all levels
  transports.push(
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'combined.log'),
      format: jsonFormatter,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 14, // Keep 14 days of logs
      tailable: true,
    })
  );
}

// ── Logger Instance ──────────────────────────────────────────────────────────────

const logger = winston.createLogger({
  level: LOG_LEVEL,
  defaultMeta: {
    service: SERVICE_NAME,
    environment: NODE_ENV,
  },
  transports,
  exitOnError: false,
});

// ── Correlation ID Management ───────────────────────────────────────────────────

const correlationStorage = new Map<string, string>();

/**
 * Generate a new correlation ID
 */
export function generateCorrelationId(): string {
  return crypto.randomUUID();
}

/**
 * Set correlation ID for current context
 */
export function setCorrelationId(id: string): void {
  correlationStorage.set('current', id);
}

/**
 * Get current correlation ID
 */
export function getCorrelationId(): string | undefined {
  return correlationStorage.get('current');
}

/**
 * Clear current correlation ID
 */
export function clearCorrelationId(): void {
  correlationStorage.delete('current');
}

/**
 * Generate trace ID for distributed tracing
 */
export function generateTraceId(): string {
  return crypto.randomUUID();
}

// ── Structured Logging Methods ─────────────────────────────────────────────────

/**
 * Log with correlation context
 */
function logWithContext(
  level: 'error' | 'warn' | 'info' | 'debug',
  message: string,
  context?: LogContext
): void {
  const logData: Record<string, unknown> = {};

  if (context?.correlationId) {
    logData.correlationId = context.correlationId;
  } else if (correlationStorage.has('current')) {
    logData.correlationId = correlationStorage.get('current');
  }

  if (context?.traceId) {
    logData.traceId = context.traceId;
  }

  if (context?.userId) {
    logData.userId = context.userId;
  }

  if (context?.requestId) {
    logData.requestId = context.requestId;
  }

  if (context?.duration) {
    logData.duration = context.duration;
  }

  if (context?.statusCode) {
    logData.statusCode = context.statusCode;
  }

  if (context?.method) {
    logData.method = context.method;
  }

  if (context?.path) {
    logData.path = context.path;
  }

  if (context?.context) {
    logData.context = context.context;
  }

  if (context?.intentId) {
    logData.intentId = context.intentId;
  }

  if (context?.intentType) {
    logData.intentType = context.intentType;
  }

  if (context?.agentName) {
    logData.agentName = context.agentName;
  }

  if (context?.agentAction) {
    logData.agentAction = context.agentAction;
  }

  if (context?.serviceName) {
    logData.serviceName = context.serviceName;
  }

  if (context?.serviceMethod) {
    logData.serviceMethod = context.serviceMethod;
  }

  if (context?.success !== undefined) {
    logData.success = context.success;
  }

  if (context?.error) {
    // Handle unknown errors - convert to proper Error object
    if (context.error instanceof Error) {
      logData.error = context.error;
    } else {
      logData.error = { name: 'Error', message: String(context.error) };
    }
  }

  // Add any other custom context
  const excludedKeys = ['correlationId', 'traceId', 'userId', 'requestId', 'duration', 'statusCode', 'method', 'path', 'context', 'error', 'intentId', 'intentType', 'agentName', 'agentAction', 'serviceName', 'serviceMethod', 'success'];
  for (const [key, value] of Object.entries(context || {})) {
    if (value !== undefined && !excludedKeys.includes(key)) {
      logData[key] = value;
    }
  }

  logger.log(level, message, logData);
}

// ── Public API ─────────────────────────────────────────────────────────────────

export const log = {
  error(message: string, context?: LogContext): void {
    logWithContext('error', message, context);
  },

  warn(message: string, context?: LogContext): void {
    logWithContext('warn', message, context);
  },

  info(message: string, context?: LogContext): void {
    logWithContext('info', message, context);
  },

  debug(message: string, context?: LogContext): void {
    logWithContext('debug', message, context);
  },

  /**
   * Log HTTP request with timing
   */
  httpRequest(req: {
    method: string;
    path: string;
    statusCode?: number;
    duration?: number;
    correlationId?: string;
    traceId?: string;
    userId?: string;
    requestId?: string;
  }): void {
    const level = req.statusCode && req.statusCode >= 400 ? 'warn' : 'info';
    logWithContext(level, `${req.method} ${req.path}`, {
      method: req.method,
      path: req.path,
      statusCode: req.statusCode,
      duration: req.duration,
      correlationId: req.correlationId,
      traceId: req.traceId,
      userId: req.userId,
      requestId: req.requestId,
    });
  },

  /**
   * Log intent capture event
   */
  intentCapture(intent: {
    intentId: string;
    userId: string;
    type: string;
    correlationId?: string;
    traceId?: string;
    duration?: number;
  }): void {
    logWithContext('info', `Intent captured: ${intent.type}`, {
      intentId: intent.intentId,
      userId: intent.userId,
      intentType: intent.type,
      duration: intent.duration,
      correlationId: intent.correlationId,
      traceId: intent.traceId,
    });
  },

  /**
   * Log agent execution
   */
  agentExecution(agent: {
    name: string;
    action: string;
    success: boolean;
    duration?: number;
    correlationId?: string;
    traceId?: string;
    error?: unknown;
  }): void {
    const level = agent.success ? 'info' : 'error';
    const message = `${agent.name} ${agent.action} ${agent.success ? 'succeeded' : 'failed'}`;
    logWithContext(level, message, {
      agentName: agent.name,
      agentAction: agent.action,
      success: agent.success,
      duration: agent.duration,
      correlationId: agent.correlationId,
      traceId: agent.traceId,
      error: agent.error,
    });
  },

  /**
   * Log service call
   */
  serviceCall(service: {
    name: string;
    method: string;
    success: boolean;
    statusCode?: number;
    duration?: number;
    correlationId?: string;
    traceId?: string;
    error?: unknown;
  }): void {
    const level = service.success ? 'info' : 'warn';
    const message = `${service.name}.${service.method} ${service.success ? 'success' : 'failed'}`;
    logWithContext(level, message, {
      serviceName: service.name,
      serviceMethod: service.method,
      statusCode: service.statusCode,
      duration: service.duration,
      correlationId: service.correlationId,
      traceId: service.traceId,
      error: service.error,
    });
  },
};

// ── Express Request Middleware ──────────────────────────────────────────────────

export function requestLoggingMiddleware(
  req: { method: string; path: string; headers: Record<string, string | string[] | undefined> },
  res: { on: (event: string, cb: () => void) => void; statusCode: number },
  next: () => void
): void {
  const startTime = Date.now();
  const correlationId = (req.headers['x-correlation-id'] as string) || generateCorrelationId();
  const traceId = (req.headers['x-trace-id'] as string) || generateTraceId();
  const requestId = (req.headers['x-request-id'] as string) || generateCorrelationId();

  // Set correlation ID for this request
  setCorrelationId(correlationId);

  // Add headers for downstream services
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    log.httpRequest({
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      correlationId,
      traceId,
      requestId,
    });
    clearCorrelationId();
  });

  next();
}

// ── Export raw logger for advanced usage ───────────────────────────────────────

export { logger };

// Default export for compatibility
export default logger;

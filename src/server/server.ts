// ── Intent Graph Server ───────────────────────────────────────────────────────────
// Standalone Express server for RTMN Commerce Memory Intent Graph
// Uses MongoDB for data storage
import 'dotenv/config';


import express, { Request, Response, NextFunction } from 'express';
import { connectDB, getConnectionStatus } from '../database/mongodb.js';
import intentRouter from '../api/intent.routes.js';
import commerceMemoryRouter from '../api/commerce-memory.routes.js';
import metricsRouter from '../api/metrics.routes.js';
import {
  standardLimiter,
  strictLimiter,
  captureLimiter,
  nudgeLimiter,
} from '../middleware/rateLimit.js';
import { dormantIntentCronJob } from '../jobs/dormantIntentCron.js';
import { getSwarmCoordinator, getSwarmStatus } from '../agents/index.js';
import { metricsStore, METRICS } from '../monitoring/metrics.js';

// ── Observability Imports ───────────────────────────────────────────────────────
import { log, requestLoggingMiddleware } from '../utils/logger.js';
import { setupSentryMiddleware } from '../utils/sentry.js';
import { metricsMiddleware, registry } from '../utils/metrics.js';
import healthRouter from '../health/index.js';

const app = express();
const PORT = process.env.PORT || 3007;

// ── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json());

// CORS - restrict origins in production
// SECURITY: Explicitly validate origins to prevent misconfiguration
const allowedOrigins = (() => {
  const env = process.env.ALLOWED_ORIGINS;
  if (env) {
    const origins = env.split(',').map(s => s.trim());
    // SECURITY: Reject localhost in production even if accidentally configured
    if (process.env.NODE_ENV === 'production') {
      const hasLocalhost = origins.some(o => o.includes('localhost'));
      if (hasLocalhost) {
        console.error('[CORS] CRITICAL: localhost origins are not allowed in production!');
        // Filter out localhost origins in production
        return origins.filter(o => !o.includes('localhost'));
      }
    }
    return origins;
  }
  // Default: localhost only for dev safety - NO localhost in production
  if (process.env.NODE_ENV === 'production') {
    console.log('[CORS] Production mode: no CORS origins configured (secure default)');
    return [];
  }
  return ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:3001'];
})();

// Validate on startup
if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
  console.log('[CORS] Production: CORS disabled (no origins allowed)');
}

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-cron-secret, x-user-id, x-internal-token, x-merchant-token, x-api-key');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Rate limiting - global standard limit
app.use(standardLimiter);

// Request logging (structured JSON logging with correlation IDs)
app.use(requestLoggingMiddleware);

// Prometheus metrics middleware
app.use(metricsMiddleware);

// ── Health Check Routes ─────────────────────────────────────────────────────

app.use('/health', healthRouter);

// ── API Routes ─────────────────────────────────────────────────────────────

app.use('/api/intent', intentRouter);
app.use('/api/commerce-memory', commerceMemoryRouter);
app.use('/metrics', metricsRouter); // Prometheus metrics

// ── Latency Tracking Middleware ──────────────────────────────────────────────

app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path.startsWith('/api/intent/capture')) {
      metricsStore.record(METRICS.CAPTURE_LATENCY, duration, 'histogram');
    } else if (req.path.startsWith('/api/intent/')) {
      metricsStore.record(METRICS.QUERY_LATENCY, duration, 'histogram');
    }
  });
  next();
});

// ── Error Handler ─────────────────────────────────────────────────────────

// Sentry error middleware is set up during startup

// ── Database Connection & Server Start ─────────────────────────────────────

let server: ReturnType<typeof app.listen> | null = null;
let isShuttingDown = false;

async function startServer() {
  try {
    // Initialize Sentry error tracking
    await setupSentryMiddleware(app);

    // Connect to MongoDB
    log.info('Connecting to ReZ ecosystem database', { context: 'MongoDB' });
    await connectDB();
    log.info('MongoDB connected successfully', { context: 'MongoDB' });

    // Start Dormant Intent Cron Job (Phase 2)
    const ENABLE_DORMANT_CRON = process.env.ENABLE_DORMANT_CRON !== 'false';
    if (ENABLE_DORMANT_CRON) {
      log.info('Starting Dormant Intent Cron Job', { context: 'IntentGraph' });
      dormantIntentCronJob.start();
      log.info('Dormant Intent Cron Job started (runs daily)', { context: 'IntentGraph' });
    }

    // Start Agent Swarm (Phase 3)
    const ENABLE_AGENTS = process.env.ENABLE_AGENTS === 'true';
    if (ENABLE_AGENTS) {
      log.info('Starting Agent Swarm', { context: 'IntentGraph' });
      const swarm = getSwarmCoordinator();
      await swarm.start();
      log.info('Agent Swarm started', { context: 'IntentGraph' });
    }

    // Start Express server
    server = app.listen(PORT, () => {
      log.info(`Server running on port ${PORT}`, { context: 'IntentGraph' });
      log.info(`Health check: http://localhost:${PORT}/health`, { context: 'IntentGraph' });
      log.info(`Intent API: http://localhost:${PORT}/api/intent`, { context: 'IntentGraph' });
      log.info(`Commerce Memory API: http://localhost:${PORT}/api/commerce-memory`, { context: 'IntentGraph' });
      log.info(`Metrics: http://localhost:${PORT}/metrics`, { context: 'IntentGraph' });
      log.info(`Available features:`, { context: 'IntentGraph' });
      log.info(`  - Dormant Intent Cron: ${ENABLE_DORMANT_CRON ? 'enabled' : 'disabled'}`, { context: 'IntentGraph' });
      log.info(`  - Agent Swarm: ${ENABLE_AGENTS ? 'enabled' : 'disabled'}`, { context: 'IntentGraph' });
    });
  } catch (error) {
    log.error('Failed to start server', { context: 'IntentGraph', error: error as Error });
    process.exit(1);
  }
}

// L17 FIX: Graceful shutdown — stop accepting new connections and drain existing ones
async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  log.info(`${signal} received — graceful shutdown starting`, { context: 'IntentGraph' });

  // Stop accepting new connections
  if (server) {
    server.close(() => {
      log.info('HTTP server closed', { context: 'IntentGraph' });
    });
  }

  // Give existing connections 10 seconds to finish
  await new Promise((resolve) => setTimeout(resolve, 10000));

  // Stop metrics collection
  registry.stop();

  log.info('Graceful shutdown complete', { context: 'IntentGraph' });
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

startServer();

export default app;

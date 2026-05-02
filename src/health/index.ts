// ── Health Check Router ───────────────────────────────────────────────────────────
// Enterprise health check endpoint with dependency monitoring
// Checks MongoDB and Redis connectivity with latency metrics

import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { redis } from '../config/redis.js';
import { checkRedisHealth } from '../config/redis.js';
import { getConnectionStatus } from '../database/mongodb.js';

const router = Router();

// ── Types ──────────────────────────────────────────────────────────────────────

export interface HealthCheckResult {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs: number;
  message?: string;
  details?: Record<string, unknown>;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  service: string;
  version: string;
  uptime: number;
  checks: {
    mongodb: HealthCheckResult;
    redis: HealthCheckResult;
    memory: HealthCheckResult;
  };
  latencyMs: number;
}

export interface DetailedHealthStatus extends HealthStatus {
  environment: string;
  hostname: string;
  checks: HealthStatus['checks'] & {
    dependencies: DependencyHealth[];
    system: SystemHealth;
  };
}

interface DependencyHealth {
  name: string;
  type: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs: number;
  url?: string;
  version?: string;
  message?: string;
}

interface SystemHealth {
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  cpu: {
    loadAverage: number[];
  };
  process: {
    uptime: number;
    pid: number;
  };
}

// ── Configuration ────────────────────────────────────────────────────────────────

const HEALTH_CHECK_SECRET = process.env.HEALTH_CHECK_SECRET || '';
const SERVICE_NAME = process.env.SERVICE_NAME || 'intent-graph';
const SERVICE_VERSION = process.env.npm_package_version || process.env.VERSION || '0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';

// ── Health Check Functions ─────────────────────────────────────────────────────

/**
 * Check MongoDB health
 */
async function checkMongoDB(): Promise<HealthCheckResult> {
  const start = performance.now();

  try {
    const isConnected = getConnectionStatus();

    if (!isConnected) {
      return {
        name: 'mongodb',
        status: 'unhealthy',
        latencyMs: Math.round(performance.now() - start),
        message: 'Not connected',
      };
    }

    // Ping the database
    const startPing = performance.now();
    await mongoose.connection.db?.admin().ping();
    const pingLatency = Math.round(performance.now() - startPing);

    // Get server status for details
    let serverInfo: Record<string, unknown> = {};
    try {
      serverInfo = await mongoose.connection.db?.admin().serverInfo() || {};
    } catch {
      // Ignore - ping already confirmed connectivity
    }

    return {
      name: 'mongodb',
      status: 'healthy',
      latencyMs: Math.round(performance.now() - start),
      message: 'Connected',
      details: {
        host: mongoose.connection.host,
        name: mongoose.connection.name,
        version: serverInfo.version as string,
        pingLatencyMs: pingLatency,
      },
    };
  } catch (error) {
    return {
      name: 'mongodb',
      status: 'unhealthy',
      latencyMs: Math.round(performance.now() - start),
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check Redis health
 */
async function checkRedis(): Promise<HealthCheckResult> {
  const start = performance.now();

  try {
    const isHealthy = await checkRedisHealth();

    if (!isHealthy) {
      return {
        name: 'redis',
        status: 'unhealthy',
        latencyMs: Math.round(performance.now() - start),
        message: 'Health check failed',
      };
    }

    // Get Redis info
    let redisInfo: Record<string, string> = {};
    try {
      const info = await redis.info('server');
      redisInfo = parseRedisInfo(info);
    } catch {
      // Ignore - health check passed
    }

    return {
      name: 'redis',
      status: 'healthy',
      latencyMs: Math.round(performance.now() - start),
      message: 'Connected',
      details: {
        version: redisInfo.redis_version,
        mode: redisInfo.redis_mode,
        connectedClients: redisInfo.connected_clients,
      },
    };
  } catch (error) {
    return {
      name: 'redis',
      status: 'unhealthy',
      latencyMs: Math.round(performance.now() - start),
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check memory health
 */
function checkMemory(): HealthCheckResult {
  const memUsage = process.memoryUsage();
  const totalMemory = memUsage.heapTotal;
  const usedMemory = memUsage.heapUsed;
  const usagePercentage = (usedMemory / totalMemory) * 100;

  // Memory thresholds
  const WARNING_THRESHOLD = 80;
  const CRITICAL_THRESHOLD = 95;

  let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
  if (usagePercentage >= CRITICAL_THRESHOLD) {
    status = 'unhealthy';
  } else if (usagePercentage >= WARNING_THRESHOLD) {
    status = 'degraded';
  }

  return {
    name: 'memory',
    status,
    latencyMs: 0, // Synchronous check
    message: `${Math.round(usagePercentage)}% heap used`,
    details: {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      heapFree: memUsage.heapTotal - memUsage.heapUsed,
      rss: memUsage.rss,
      external: memUsage.external,
      usagePercentage: Math.round(usagePercentage * 100) / 100,
    },
  };
}

/**
 * Parse Redis INFO output
 */
function parseRedisInfo(info: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = info.split('\n');

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();
      result[key] = value;
    }
  }

  return result;
}

/**
 * Determine overall health status
 */
function determineOverallStatus(checks: HealthStatus['checks']): 'healthy' | 'degraded' | 'unhealthy' {
  const statuses = [
    checks.mongodb.status,
    checks.redis.status,
    checks.memory.status,
  ];

  if (statuses.includes('unhealthy')) {
    return 'unhealthy';
  }
  if (statuses.includes('degraded')) {
    return 'degraded';
  }
  return 'healthy';
}

// ── Route Handlers ─────────────────────────────────────────────────────────────

/**
 * GET /health
 * Basic health check - always returns 200 if the service is running
 */
router.get('/', async (_req: Request, res: Response) => {
  const start = performance.now();

  try {
    // Run all health checks in parallel
    const [mongodb, redis, memory] = await Promise.all([
      checkMongoDB(),
      checkRedis(),
      Promise.resolve(checkMemory()),
    ]);

    const overallStatus = determineOverallStatus({ mongodb, redis, memory });

    const health: HealthStatus = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      uptime: process.uptime(),
      checks: { mongodb, redis, memory },
      latencyMs: Math.round(performance.now() - start),
    };

    // Return appropriate status code
    const statusCode = overallStatus === 'unhealthy' ? 503 : 200;
    res.status(statusCode).json(health);
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      uptime: process.uptime(),
      checks: {
        mongodb: { name: 'mongodb', status: 'unknown', latencyMs: 0 },
        redis: { name: 'redis', status: 'unknown', latencyMs: 0 },
        memory: { name: 'memory', status: 'unknown', latencyMs: 0 },
      },
      latencyMs: Math.round(performance.now() - start),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /health/live
 * Liveness probe - returns 200 if the service is alive
 */
router.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

/**
 * GET /health/ready
 * Readiness probe - returns 200 if the service is ready to accept traffic
 */
router.get('/ready', async (_req: Request, res: Response) => {
  const [mongodb, redis] = await Promise.all([
    checkMongoDB(),
    checkRedis(),
  ]);

  const isReady = mongodb.status !== 'unhealthy' && redis.status !== 'unhealthy';

  if (isReady) {
    res.status(200).json({
      status: 'ready',
      timestamp: new Date().toISOString(),
      checks: { mongodb, redis },
    });
  } else {
    res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      checks: { mongodb, redis },
    });
  }
});

/**
 * GET /health/detailed
 * Detailed health check with system metrics (requires secret)
 */
router.get('/detailed', async (req: Request, res: Response) => {
  // Verify secret if configured
  const providedSecret = req.headers['x-health-secret'] as string || req.query.secret as string;
  if (HEALTH_CHECK_SECRET && providedSecret !== HEALTH_CHECK_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const start = performance.now();

  // Get additional system info
  const memUsage = process.memoryUsage();
  const totalMemory = memUsage.heapTotal;
  const usedMemory = memUsage.heapUsed;
  const usagePercentage = (usedMemory / totalMemory) * 100;

  const health: DetailedHealthStatus = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    uptime: process.uptime(),
    environment: NODE_ENV,
    hostname: process.env.HOSTNAME || 'unknown',
    latencyMs: Math.round(performance.now() - start),
    checks: {
      mongodb: await checkMongoDB(),
      redis: await checkRedis(),
      memory: checkMemory(),
      dependencies: await getDependenciesHealth(),
      system: {
        memory: {
          used: usedMemory,
          total: totalMemory,
          percentage: Math.round(usagePercentage * 100) / 100,
        },
        cpu: {
          loadAverage: process.platform === 'win32' ? [0, 0, 0] : require('os').loadavg(),
        },
        process: {
          uptime: process.uptime(),
          pid: process.pid,
        },
      },
    } as DetailedHealthStatus['checks'],
  };

  // Update overall status
  const statuses = [
    health.checks.mongodb.status,
    health.checks.redis.status,
    health.checks.memory.status,
    ...health.checks.dependencies.map((d) => d.status),
  ];

  if (statuses.includes('unhealthy')) {
    health.status = 'unhealthy';
  } else if (statuses.includes('degraded')) {
    health.status = 'degraded';
  }

  const statusCode = health.status === 'unhealthy' ? 503 : 200;
  res.status(statusCode).json(health);
});

/**
 * Get health of external dependencies
 */
async function getDependenciesHealth(): Promise<DependencyHealth[]> {
  const dependencies: DependencyHealth[] = [];

  // Check external services based on configured URLs
  const services = [
    { name: 'wallet-service', url: process.env.WALLET_SERVICE_URL, type: 'api' },
    { name: 'monolith', url: process.env.MONOLITH_URL, type: 'api' },
    { name: 'order-service', url: process.env.ORDER_SERVICE_URL, type: 'api' },
    { name: 'notification-service', url: process.env.NOTIFICATION_SERVICE_URL, type: 'api' },
  ].filter((s) => s.url);

  // Only check if URLs are configured and not in dev mode
  if (NODE_ENV === 'production' && services.length > 0) {
    for (const service of services) {
      const start = performance.now();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);

        const response = await fetch(`${service.url}/health`, {
          signal: controller.signal,
          method: 'GET',
        });

        clearTimeout(timeout);

        dependencies.push({
          name: service.name,
          type: service.type,
          status: response.ok ? 'healthy' : 'degraded',
          latencyMs: Math.round(performance.now() - start),
          url: service.url,
        });
      } catch {
        dependencies.push({
          name: service.name,
          type: service.type,
          status: 'unhealthy',
          latencyMs: Math.round(performance.now() - start),
          url: service.url,
          message: 'Connection failed',
        });
      }
    }
  }

  return dependencies;
}

export default router;

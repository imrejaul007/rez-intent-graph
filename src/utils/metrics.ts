// ── Prometheus Metrics ───────────────────────────────────────────────────────────
// Enterprise-grade Prometheus metrics with default system metrics and custom business metrics
// Exposes metrics for scraping and integration with Prometheus/Grafana

import { Router, Request, Response } from 'express';
import * as os from 'os';
import { redis } from '../config/redis.js';
import { checkRedisHealth } from '../config/redis.js';
import { getConnectionStatus } from '../database/mongodb.js';
import mongoose from 'mongoose';

const router = Router();

// ── Configuration ────────────────────────────────────────────────────────────────

const METRICS_ENABLED = process.env.METRICS_ENABLED !== 'false';
const SERVICE_NAME = process.env.SERVICE_NAME || 'intent-graph';
const NODE_ENV = process.env.NODE_ENV || 'development';

// ── Metric Registry Types ────────────────────────────────────────────────────────

interface MetricDefinition {
  name: string;
  help: string;
  type: 'counter' | 'gauge' | 'histogram' | 'summary';
  labels?: string[];
}

interface MetricValue {
  value: number;
  labels: Record<string, string>;
  timestamp?: number;
}

interface HistogramBucket {
  le: number;
  count: number;
}

// ── Metric Registry ─────────────────────────────────────────────────────────────

class MetricRegistry {
  private metrics: Map<string, MetricDefinition> = new Map();
  private values: Map<string, MetricValue[]> = new Map();
  private histograms: Map<string, Map<number, number>> = new Map();
  private histogramCounters: Map<string, number> = new Map();
  private histogramSums: Map<string, number> = new Map();
  private collectionIntervals: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Register a metric
   */
  register(definition: MetricDefinition): void {
    this.metrics.set(definition.name, definition);
    if (!this.values.has(definition.name)) {
      this.values.set(definition.name, []);
    }
    if (definition.type === 'histogram') {
      if (!this.histograms.has(definition.name)) {
        this.histograms.set(definition.name, new Map());
      }
    }
  }

  /**
   * Increment a counter
   */
  inc(name: string, labels: Record<string, string> = {}, value = 1): void {
    if (!METRICS_ENABLED) return;

    const existing = this.values.get(name);
    if (!existing) {
      console.warn(`[Metrics] Counter ${name} not registered`);
      return;
    }

    const key = this.labelKey(labels);
    const existingValue = existing.find((v) => this.labelKey(v.labels) === key);

    if (existingValue) {
      existingValue.value += value;
      existingValue.timestamp = Date.now();
    } else {
      existing.push({ value, labels, timestamp: Date.now() });
    }
  }

  /**
   * Set a gauge value
   */
  set(name: string, value: number, labels: Record<string, string> = {}): void {
    if (!METRICS_ENABLED) return;

    const existing = this.values.get(name);
    if (!existing) {
      console.warn(`[Metrics] Gauge ${name} not registered`);
      return;
    }

    const key = this.labelKey(labels);
    const existingValue = existing.find((v) => this.labelKey(v.labels) === key);

    if (existingValue) {
      existingValue.value = value;
      existingValue.timestamp = Date.now();
    } else {
      existing.push({ value, labels, timestamp: Date.now() });
    }
  }

  /**
   * Observe a value (for histograms)
   */
  observe(name: string, value: number, labels: Record<string, string> = {}): void {
    if (!METRICS_ENABLED) return;

    const buckets = this.histograms.get(name);
    if (!buckets) {
      console.warn(`[Metrics] Histogram ${name} not registered`);
      return;
    }

    // Update sum
    const currentSum = this.histogramSums.get(name) || 0;
    this.histogramSums.set(name, currentSum + value);

    // Update count
    const currentCount = this.histogramCounters.get(name) || 0;
    this.histogramCounters.set(name, currentCount + 1);

    // Update buckets
    for (const [le] of Array.from(buckets.entries())) {
      if (value <= le) {
        buckets.set(le, (buckets.get(le) || 0) + 1);
      }
    }
  }

  /**
   * Set a collector function that runs periodically
   */
  collect(name: string, intervalMs: number, collector: () => number): void {
    // Run immediately
    this.set(name, collector());

    // Schedule periodic collection
    const interval = setInterval(() => {
      this.set(name, collector());
    }, intervalMs);

    this.collectionIntervals.set(name, interval);
  }

  /**
   * Get all metrics in Prometheus format
   */
  toPrometheusFormat(): string {
    const lines: string[] = [];

    for (const [name, def] of Array.from(this.metrics.entries())) {
      // Add HELP and TYPE
      lines.push(`# HELP ${name} ${def.help}`);
      lines.push(`# TYPE ${name} ${def.type}`);

      const values = this.values.get(name) || [];

      if (def.type === 'histogram') {
        // Histogram format
        const buckets = this.histograms.get(name) || new Map();
        const sortedBuckets = Array.from(buckets.entries())
          .sort((a, b) => Number(a[0]) - Number(b[0]));
        const count = this.histogramCounters.get(name) || 0;
        const sum = this.histogramSums.get(name) || 0;

        for (const [le, bucketCount] of sortedBuckets) {
          const labels = { le: String(le) };
          const labelStr = Object.entries(labels)
            .map(([k, v]) => `${k}="${v}"`)
            .join(',');
          lines.push(`${name}_bucket{${labelStr}} ${bucketCount}`);
        }

        lines.push(`${name}_sum ${sum}`);
        lines.push(`${name}_count ${count}`);
      } else {
        // Counter, gauge, summary format
        for (const metricValue of values) {
          const labelStr = Object.entries(metricValue.labels)
            .map(([k, v]) => `${k}="${v}"`)
            .join(',');
          const prefix = labelStr ? `{${labelStr}}` : '';
          lines.push(`${name}${prefix} ${metricValue.value}`);
        }
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Get all metrics as JSON
   */
  toJSON(): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [name, def] of Array.from(this.metrics.entries())) {
      const values = this.values.get(name) || [];

      if (def.type === 'histogram') {
        const buckets = this.histograms.get(name) || new Map();
        result[name] = {
          type: 'histogram',
          count: this.histogramCounters.get(name) || 0,
          sum: this.histogramSums.get(name) || 0,
          buckets: Object.fromEntries(buckets),
        };
      } else {
        result[name] = {
          type: def.type,
          values: values,
        };
      }
    }

    return result;
  }

  /**
   * Stop all collectors
   */
  stop(): void {
    for (const interval of Array.from(this.collectionIntervals.values())) {
      clearInterval(interval);
    }
    this.collectionIntervals.clear();
  }

  private labelKey(labels: Record<string, string>): string {
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
  }
}

// ── Global Registry ────────────────────────────────────────────────────────────

export const registry = new MetricRegistry();

// ── Register Default Metrics ───────────────────────────────────────────────────

// Process metrics
registry.register({
  name: 'process_cpu_seconds_total',
  help: 'Total user and system CPU time spent in seconds',
  type: 'counter',
});

registry.register({
  name: 'process_virtual_memory_bytes',
  help: 'Virtual memory size in bytes',
  type: 'gauge',
});

registry.register({
  name: 'process_resident_memory_bytes',
  help: 'Resident memory size in bytes',
  type: 'gauge',
});

registry.register({
  name: 'process_heap_bytes',
  help: 'Process heap memory in bytes',
  type: 'gauge',
});

registry.register({
  name: 'process_heap_total_bytes',
  help: 'Total process heap memory in bytes',
  type: 'gauge',
});

registry.register({
  name: 'process_external_bytes',
  help: 'Process external memory in bytes',
  type: 'gauge',
});

registry.register({
  name: 'process_start_time_seconds',
  help: 'Start time of the process since unix epoch in seconds',
  type: 'gauge',
});

registry.register({
  name: 'process_open_fds',
  help: 'Number of open file descriptors',
  type: 'gauge',
});

registry.register({
  name: 'process_uptime_seconds',
  help: 'Process uptime in seconds',
  type: 'gauge',
});

// Node.js event loop lag
registry.register({
  name: 'nodejs_eventloop_lag_seconds',
  help: 'Event loop lag in seconds',
  type: 'gauge',
});

registry.register({
  name: 'nodejs_active_handles',
  help: 'Number of active handles',
  type: 'gauge',
});

registry.register({
  name: 'nodejs_active_requests',
  help: 'Number of active requests',
  type: 'gauge',
});

// System metrics
registry.register({
  name: 'system_cpu_usage_percentage',
  help: 'System CPU usage percentage',
  type: 'gauge',
});

registry.register({
  name: 'system_memory_total_bytes',
  help: 'Total system memory in bytes',
  type: 'gauge',
});

registry.register({
  name: 'system_memory_free_bytes',
  help: 'Free system memory in bytes',
  type: 'gauge',
});

registry.register({
  name: 'system_memory_used_bytes',
  help: 'Used system memory in bytes',
  type: 'gauge',
});

registry.register({
  name: 'system_load_average_1m',
  help: 'System load average for 1 minute',
  type: 'gauge',
});

registry.register({
  name: 'system_load_average_5m',
  help: 'System load average for 5 minutes',
  type: 'gauge',
});

registry.register({
  name: 'system_load_average_15m',
  help: 'System load average for 15 minutes',
  type: 'gauge',
});

// ── Custom Business Metrics ─────────────────────────────────────────────────────

// HTTP metrics
registry.register({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  type: 'counter',
  labels: ['method', 'path', 'status_code'],
});

registry.register({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  type: 'histogram',
  labels: ['method', 'path'],
});

registry.register({
  name: 'http_requests_in_progress',
  help: 'Number of HTTP requests currently in progress',
  type: 'gauge',
  labels: ['method', 'path'],
});

// Intent metrics
registry.register({
  name: 'intent_capture_total',
  help: 'Total number of intents captured',
  type: 'counter',
  labels: ['intent_type', 'user_type'],
});

registry.register({
  name: 'intent_capture_duration_seconds',
  help: 'Intent capture duration in seconds',
  type: 'histogram',
  labels: ['intent_type'],
});

registry.register({
  name: 'intent_query_total',
  help: 'Total number of intent queries',
  type: 'counter',
  labels: ['query_type', 'status'],
});

registry.register({
  name: 'intent_query_duration_seconds',
  help: 'Intent query duration in seconds',
  type: 'histogram',
  labels: ['query_type'],
});

registry.register({
  name: 'intent_active_count',
  help: 'Number of active intents',
  type: 'gauge',
  labels: ['state'],
});

registry.register({
  name: 'intent_dormant_count',
  help: 'Number of dormant intents',
  type: 'gauge',
});

registry.register({
  name: 'intent_fulfilled_count',
  help: 'Number of fulfilled intents',
  type: 'counter',
  labels: ['fulfillment_type'],
});

// WebSocket metrics
registry.register({
  name: 'websocket_connections_active',
  help: 'Number of active WebSocket connections',
  type: 'gauge',
});

registry.register({
  name: 'websocket_connections_total',
  help: 'Total number of WebSocket connections',
  type: 'counter',
});

registry.register({
  name: 'websocket_messages_total',
  help: 'Total number of WebSocket messages',
  type: 'counter',
  labels: ['direction', 'type'],
});

registry.register({
  name: 'websocket_message_duration_seconds',
  help: 'WebSocket message processing duration in seconds',
  type: 'histogram',
  labels: ['type'],
});

// Circuit breaker metrics
registry.register({
  name: 'circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=half-open, 2=open)',
  type: 'gauge',
  labels: ['service', 'name'],
});

registry.register({
  name: 'circuit_breaker_calls_total',
  help: 'Total circuit breaker calls',
  type: 'counter',
  labels: ['service', 'name', 'result'],
});

registry.register({
  name: 'circuit_breaker_duration_seconds',
  help: 'Circuit breaker call duration in seconds',
  type: 'histogram',
  labels: ['service', 'name'],
});

// Cache metrics
registry.register({
  name: 'cache_hit_total',
  help: 'Total cache hits',
  type: 'counter',
  labels: ['cache_type'],
});

registry.register({
  name: 'cache_miss_total',
  help: 'Total cache misses',
  type: 'counter',
  labels: ['cache_type'],
});

registry.register({
  name: 'cache_hit_ratio',
  help: 'Cache hit ratio',
  type: 'gauge',
  labels: ['cache_type'],
});

registry.register({
  name: 'cache_operations_total',
  help: 'Total cache operations',
  type: 'counter',
  labels: ['cache_type', 'operation'],
});

// Agent metrics
registry.register({
  name: 'agent_runs_total',
  help: 'Total number of agent runs',
  type: 'counter',
  labels: ['agent_name', 'result'],
});

registry.register({
  name: 'agent_run_duration_seconds',
  help: 'Agent run duration in seconds',
  type: 'histogram',
  labels: ['agent_name'],
});

registry.register({
  name: 'agent_active_count',
  help: 'Number of active agents',
  type: 'gauge',
  labels: ['agent_name'],
});

registry.register({
  name: 'agent_queue_size',
  help: 'Agent queue size',
  type: 'gauge',
  labels: ['agent_name'],
});

// Nudge metrics
registry.register({
  name: 'nudge_sent_total',
  help: 'Total nudges sent',
  type: 'counter',
  labels: ['nudge_type', 'channel'],
});

registry.register({
  name: 'nudge_delivered_total',
  help: 'Total nudges delivered',
  type: 'counter',
  labels: ['nudge_type', 'channel'],
});

registry.register({
  name: 'nudge_clicked_total',
  help: 'Total nudges clicked',
  type: 'counter',
  labels: ['nudge_type', 'channel'],
});

registry.register({
  name: 'nudge_converted_total',
  help: 'Total nudges converted',
  type: 'counter',
  labels: ['nudge_type', 'channel'],
});

registry.register({
  name: 'nudge_failed_total',
  help: 'Total nudge failures',
  type: 'counter',
  labels: ['nudge_type', 'channel', 'reason'],
});

// Error metrics
registry.register({
  name: 'errors_total',
  help: 'Total number of errors',
  type: 'counter',
  labels: ['type', 'code'],
});

// Service metrics
registry.register({
  name: 'service_calls_total',
  help: 'Total service calls',
  type: 'counter',
  labels: ['service_name', 'method', 'status'],
});

registry.register({
  name: 'service_call_duration_seconds',
  help: 'Service call duration in seconds',
  type: 'histogram',
  labels: ['service_name', 'method'],
});

registry.register({
  name: 'service_call_in_progress',
  help: 'Number of service calls in progress',
  type: 'gauge',
  labels: ['service_name', 'method'],
});

// Database metrics
registry.register({
  name: 'mongodb_connection_status',
  help: 'MongoDB connection status (1=connected, 0=disconnected)',
  type: 'gauge',
});

registry.register({
  name: 'mongodb_query_duration_seconds',
  help: 'MongoDB query duration in seconds',
  type: 'histogram',
  labels: ['collection', 'operation'],
});

registry.register({
  name: 'redis_connection_status',
  help: 'Redis connection status (1=connected, 0=disconnected)',
  type: 'gauge',
});

registry.register({
  name: 'redis_command_duration_seconds',
  help: 'Redis command duration in seconds',
  type: 'histogram',
  labels: ['command'],
});

// ── System Metrics Collection ──────────────────────────────────────────────────

const processStartTime = Date.now() / 1000;

function collectSystemMetrics(): void {
  const memUsage = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  // Process metrics - use arrayBuffer allocator as proxy for virtual memory
  registry.set('process_virtual_memory_bytes', memUsage.arrayBuffers);
  registry.set('process_resident_memory_bytes', memUsage.rss);
  registry.set('process_heap_bytes', memUsage.heapUsed);
  registry.set('process_heap_total_bytes', memUsage.heapTotal);
  registry.set('process_external_bytes', memUsage.external);
  registry.set('process_start_time_seconds', processStartTime);
  registry.set('process_uptime_seconds', process.uptime());

  // Try to get open fd count (Unix only)
  try {
    const fds = (process as NodeJS.Process & { getActiveResourcesInfo?: () => string[] }).getActiveResourcesInfo?.() || [];
    registry.set('process_open_fds', fds.length);
  } catch {
    // Ignore on platforms that don't support this
  }

  // Event loop metrics
  const eventLoopLag = (process as NodeJS.Process & { eventLoopLag?: number }).eventLoopLag || 0;
  registry.set('nodejs_eventloop_lag_seconds', eventLoopLag / 1000);
  registry.set('nodejs_active_handles', (process as NodeJS.Process & { _getActiveHandles?: () => unknown[] })._getActiveHandles?.()?.length || 0);
  registry.set('nodejs_active_requests', (process as NodeJS.Process & { _getActiveRequests?: () => unknown[] })._getActiveRequests?.()?.length || 0);

  // System metrics
  registry.set('system_memory_total_bytes', totalMem);
  registry.set('system_memory_free_bytes', freeMem);
  registry.set('system_memory_used_bytes', usedMem);

  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;
  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type as keyof typeof cpu.times];
    }
    totalIdle += cpu.times.idle;
  }
  const cpuUsage = 100 - (100 * totalIdle / totalTick);
  registry.set('system_cpu_usage_percentage', cpuUsage);

  const loadAvg = os.loadavg();
  registry.set('system_load_average_1m', loadAvg[0]);
  registry.set('system_load_average_5m', loadAvg[1]);
  registry.set('system_load_average_15m', loadAvg[2]);

  // Connection status
  registry.set('mongodb_connection_status', getConnectionStatus() ? 1 : 0);
  registry.set('redis_connection_status', 1); // Updated async
}

async function collectRedisMetrics(): Promise<void> {
  try {
    const isHealthy = await checkRedisHealth();
    registry.set('redis_connection_status', isHealthy ? 1 : 0);
  } catch {
    registry.set('redis_connection_status', 0);
  }
}

// Start system metrics collection
setInterval(collectSystemMetrics, 10000);
collectSystemMetrics();

// Start Redis metrics collection
setInterval(collectRedisMetrics, 30000);
collectRedisMetrics();

// ── HTTP Request Instrumentation ───────────────────────────────────────────────

export function instrumentHTTPRequest(
  method: string,
  path: string,
  statusCode: number,
  durationMs: number
): void {
  // Normalize path to prevent high cardinality
  const normalizedPath = normalizePath(path);

  // Increment request counter
  registry.inc('http_requests_total', {
    method,
    path: normalizedPath,
    status_code: String(statusCode),
  });

  // Record duration
  registry.observe('http_request_duration_seconds', durationMs / 1000, {
    method,
    path: normalizedPath,
  });
}

function normalizePath(path: string): string {
  // Replace dynamic segments with placeholders
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/[0-9a-f]{24}/gi, '/:id')
    .replace(/\/\d+/g, '/:id');
}

// ── Express Middleware ─────────────────────────────────────────────────────────

export function metricsMiddleware(
  req: { method: string; path: string },
  res: { on: (event: string, cb: () => void) => void; statusCode: number },
  next: () => void
): void {
  const start = Date.now();

  // Increment in-progress counter
  const normalizedPath = normalizePath(req.path);
  registry.inc('http_requests_in_progress', { method: req.method, path: normalizedPath });

  res.on('finish', () => {
    const duration = Date.now() - start;
    instrumentHTTPRequest(req.method, req.path, res.statusCode, duration);
    registry.inc('http_requests_in_progress', { method: req.method, path: normalizedPath }, -1);
  });

  next();
}

// ── Histogram Buckets ───────────────────────────────────────────────────────────

export const HTTP_DURATION_BUCKETS = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
export const DEFAULT_DURATION_BUCKETS = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

// ── Metrics Endpoint ───────────────────────────────────────────────────────────

/**
 * GET /metrics
 * Prometheus metrics endpoint
 */
router.get('/', (_req: Request, res: Response) => {
  try {
    const metrics = registry.toPrometheusFormat();

    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(metrics);
  } catch (error) {
    console.error('[Metrics] Export failed:', error);
    res.status(500).send('# Error exporting metrics\n');
  }
});

/**
 * GET /metrics/json
 * JSON metrics format
 */
router.get('/json', (_req: Request, res: Response) => {
  try {
    const metrics = registry.toJSON();
    res.json({
      service: SERVICE_NAME,
      environment: NODE_ENV,
      timestamp: new Date().toISOString(),
      metrics,
    });
  } catch (error) {
    console.error('[Metrics] JSON export failed:', error);
    res.status(500).json({ error: 'Failed to export metrics' });
  }
});

export default router;

// ── Export Registry ────────────────────────────────────────────────────────────

export { MetricRegistry };

// ── Monitoring API Routes ──────────────────────────────────────────────────────────
// Phase 6: Metrics, health checks, and alerting

import { Router, Request, Response } from 'express';
import { wsServer } from '../websocket/server.js';
import {
  metricsStore,
  metricsCollector,
  alertManager,
  healthChecker,
  getDashboardMetrics,
  METRICS,
  type DashboardMetrics,
} from '../monitoring/metrics.js';
import { getCircuitBreakerStatus, getAllServiceHealth } from '../integrations/external-services.js';

const router = Router();

// ── Health Check ────────────────────────────────────────────────────────────────

/**
 * GET /api/monitoring/health
 * Overall system health
 */
router.get('/health', async (_req: Request, res: Response) => {
  try {
    const healthStatus = await healthChecker.check();

    // Add service health
    const serviceHealth = await getAllServiceHealth();
    const servicesHealthy = Object.values(serviceHealth).filter((h) => h).length;
    const servicesTotal = Object.values(serviceHealth).length;

    res.json({
      success: true,
      data: {
        ...healthStatus,
        services: {
          healthy: servicesHealthy,
          total: servicesTotal,
          status: serviceHealth,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: String(error) });
  }
});

/**
 * GET /api/monitoring/health/detailed
 * Detailed health with all checks
 */
router.get('/health/detailed', async (_req: Request, res: Response) => {
  try {
    const healthStatus = await healthChecker.check();
    const circuitBreaker = getCircuitBreakerStatus();
    const serviceHealth = await getAllServiceHealth();

    res.json({
      success: true,
      data: {
        health: healthStatus,
        circuitBreakers: circuitBreaker,
        services: serviceHealth,
        webSocket: wsServer.getStats(),
        memory: process.memoryUsage(),
        uptime: process.uptime(),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: String(error) });
  }
});

// ── Metrics ────────────────────────────────────────────────────────────────────

/**
 * GET /api/monitoring/metrics
 * All current metrics summary
 */
router.get('/metrics', (_req: Request, res: Response) => {
  const summaries = metricsStore.getAllSummaries();
  res.json({
    success: true,
    data: {
      timestamp: Date.now(),
      metrics: summaries,
      count: summaries.length,
    },
  });
});

/**
 * GET /api/monitoring/metrics/:name
 * Get specific metric
 */
router.get('/metrics/:name', (req: Request, res: Response) => {
  const { name } = req.params;
  const { labels, limit } = req.query;

  let parsedLabels: Record<string, string> = {};
  if (labels) {
    try {
      parsedLabels = JSON.parse(labels as string);
    } catch {
      res.status(400).json({ success: false, message: 'Invalid labels JSON' });
      return;
    }
  }

  const history = metricsStore.getHistory(name, parsedLabels, limit ? parseInt(limit as string) : 100);
  const summary = metricsStore.getSummary(name, parsedLabels);

  res.json({
    success: true,
    data: {
      name,
      labels: parsedLabels,
      history,
      summary,
    },
  });
});

/**
 * POST /api/monitoring/metrics/record
 * Record a custom metric
 */
router.post('/metrics/record', (req: Request, res: Response) => {
  const { name, value, type = 'counter', labels } = req.body;

  if (!name || value === undefined) {
    res.status(400).json({ success: false, message: 'name and value are required' });
    return;
  }

  metricsStore.record(name, value, type, labels || {});
  res.json({ success: true });
});

/**
 * GET /api/monitoring/metrics/export
 * Export metrics in Prometheus format
 */
router.get('/metrics/export', (_req: Request, res: Response) => {
  const summaries = metricsStore.getAllSummaries();

  let output = '';
  summaries.forEach((s) => {
    const labels = Object.entries(s.labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    const labelStr = labels ? `{${labels}}` : '';

    switch (s.type) {
      case 'counter':
      case 'gauge':
        output += `# TYPE ${s.name} ${s.type}\n${s.name}${labelStr} ${s.avg}\n`;
        break;
      case 'timer':
        output += `# TYPE ${s.name}_seconds gauge\n${s.name}_seconds${labelStr} ${s.avg / 1000}\n`;
        output += `# TYPE ${s.name}_seconds_count counter\n${s.name}_seconds_count${labelStr} ${s.count}\n`;
        break;
    }
  });

  res.setHeader('Content-Type', 'text/plain');
  res.send(output);
});

// ── Alerts ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/monitoring/alerts
 * Get active alerts
 */
router.get('/alerts', (_req: Request, res: Response) => {
  const alerts = alertManager.getActiveAlerts();
  res.json({ success: true, data: { alerts, count: alerts.length } });
});

/**
 * GET /api/monitoring/alerts/history
 * Get alert history
 */
router.get('/alerts/history', (req: Request, res: Response) => {
  const { limit } = req.query;
  const history = alertManager.getAlertHistory(limit ? parseInt(limit as string) : 100);
  res.json({ success: true, data: { history, count: history.length } });
});

/**
 * POST /api/monitoring/alerts/:id/acknowledge
 * Acknowledge an alert
 */
router.post('/alerts/:id/acknowledge', (req: Request, res: Response) => {
  const { id } = req.params;
  const success = alertManager.acknowledge(id);
  res.json({ success });
});

/**
 * POST /api/monitoring/alerts/:id/clear
 * Clear an alert
 */
router.post('/alerts/:id/clear', (req: Request, res: Response) => {
  const { id } = req.params;
  const success = alertManager.clear(id);
  res.json({ success });
});

/**
 * POST /api/monitoring/alerts/trigger
 * Manually trigger an alert
 */
router.post('/alerts/trigger', (req: Request, res: Response) => {
  const { metric, severity, message, value, threshold } = req.body;

  if (!metric || !severity || !message) {
    res.status(400).json({ success: false, message: 'metric, severity, and message are required' });
    return;
  }

  const alert = alertManager.trigger(metric, severity, message, value || 0, threshold || 0);
  res.json({ success: true, data: { alert } });
});

// ── Dashboard ────────────────────────────────────────────────────────────────────

/**
 * GET /api/monitoring/dashboard
 * Get dashboard metrics
 */
router.get('/dashboard', async (_req: Request, res: Response) => {
  try {
    const dashboard = await getDashboardMetrics();
    res.json({ success: true, data: dashboard });
  } catch (error) {
    res.status(500).json({ success: false, message: String(error) });
  }
});

// ── Thresholds ────────────────────────────────────────────────────────────────

/**
 * POST /api/monitoring/thresholds
 * Set alert threshold
 */
router.post('/thresholds', (req: Request, res: Response) => {
  const { metric, threshold } = req.body;

  if (!metric || threshold === undefined) {
    res.status(400).json({ success: false, message: 'metric and threshold are required' });
    return;
  }

  metricsCollector.setAlertThreshold(metric, threshold);
  res.json({ success: true, data: { metric, threshold } });
});

/**
 * GET /api/monitoring/thresholds/check
 * Check all thresholds
 */
router.get('/thresholds/check', (_req: Request, res: Response) => {
  const results: Array<{ metric: string; exceeded: boolean; value: number; threshold: number }> = [];

  metricsStore.getAllSummaries().forEach((summary) => {
    const result = metricsCollector.checkThreshold(summary.name);
    if (result) {
      results.push({
        metric: summary.name,
        ...result,
      });
    }
  });

  res.json({ success: true, data: { results } });
});

// ── WebSocket Stats ────────────────────────────────────────────────────────────

/**
 * GET /api/monitoring/websocket
 * Get WebSocket server stats
 */
router.get('/websocket', (_req: Request, res: Response) => {
  const stats = wsServer.getStats();
  res.json({ success: true, data: stats });
});

export default router;

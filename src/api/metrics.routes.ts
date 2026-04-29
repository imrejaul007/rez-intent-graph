// ── Prometheus Metrics Endpoint ──────────────────────────────────────────────────
// Exposes metrics in Prometheus format for scraping
// Integrates with metricsStore from monitoring/metrics.ts

import { Router, Request, Response } from 'express';
import { metricsStore, METRICS } from '../monitoring/metrics.js';
import { getDashboardMetrics } from '../monitoring/metrics.js';

const router = Router();

/**
 * GET /metrics
 * Prometheus metrics endpoint
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const lines: string[] = [];

    // Helper to add metric line
    const addLine = (name: string, value: number, labels: Record<string, string> = {}) => {
      const labelStr = Object.entries(labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',');
      lines.push(`${name}${labelStr ? `{${labelStr}}` : ''} ${value}`);
    };

    // Intent metrics
    const intentCaptured = metricsStore.getSummary(METRICS.INTENT_CAPTURED);
    const intentDormant = metricsStore.getSummary(METRICS.INTENT_DORMANT);
    const intentFulfilled = metricsStore.getSummary(METRICS.INTENT_FULFILLED);

    addLine('intent_graph_intents_captured_total', intentCaptured?.sum || 0);
    addLine('intent_graph_intents_dormant_total', intentDormant?.sum || 0);
    addLine('intent_graph_intents_fulfilled_total', intentFulfilled?.sum || 0);

    // Nudge metrics
    const nudgeSent = metricsStore.getSummary(METRICS.NUDGE_SENT);
    const nudgeDelivered = metricsStore.getSummary(METRICS.NUDGE_DELIVERED);
    const nudgeClicked = metricsStore.getSummary(METRICS.NUDGE_CLICKED);
    const nudgeConverted = metricsStore.getSummary(METRICS.NUDGE_CONVERTED);

    addLine('intent_graph_nudges_sent_total', nudgeSent?.sum || 0);
    addLine('intent_graph_nudges_delivered_total', nudgeDelivered?.sum || 0);
    addLine('intent_graph_nudges_clicked_total', nudgeClicked?.sum || 0);
    addLine('intent_graph_nudges_converted_total', nudgeConverted?.sum || 0);

    // Agent metrics
    const agentSuccess = metricsStore.getSummary(METRICS.AGENT_RUN_SUCCESS);
    const agentFailed = metricsStore.getSummary(METRICS.AGENT_RUN_FAILED);
    const agentDuration = metricsStore.getSummary(METRICS.AGENT_RUN_DURATION);

    addLine('intent_graph_agents_runs_total', (agentSuccess?.count || 0) + (agentFailed?.count || 0));
    addLine('intent_graph_agents_success_total', agentSuccess?.count || 0);
    addLine('intent_graph_agents_failed_total', agentFailed?.count || 0);
    addLine('intent_graph_agents_duration_ms_avg', agentDuration?.avg || 0);

    // Latency metrics
    const captureLatency = metricsStore.getSummary(METRICS.CAPTURE_LATENCY);
    const queryLatency = metricsStore.getSummary(METRICS.QUERY_LATENCY);

    addLine('intent_graph_capture_latency_ms_avg', captureLatency?.avg || 0);
    addLine('intent_graph_capture_latency_ms_p99', captureLatency?.max || 0);
    addLine('intent_graph_query_latency_ms_avg', queryLatency?.avg || 0);
    addLine('intent_graph_query_latency_ms_p99', queryLatency?.max || 0);

    // Error metrics
    const captureErrors = metricsStore.getSummary(METRICS.CAPTURE_ERROR);
    const queryErrors = metricsStore.getSummary(METRICS.QUERY_ERROR);

    addLine('intent_graph_capture_errors_total', captureErrors?.sum || 0);
    addLine('intent_graph_query_errors_total', queryErrors?.sum || 0);

    // System metrics
    const memUsage = process.memoryUsage();
    addLine('intent_graph_process_memory_bytes', memUsage.heapUsed);
    addLine('intent_graph_process_uptime_seconds', process.uptime());

    // Cache metrics (from Redis)
    try {
      const { sharedMemory } = await import('../agents/shared-memory.js');
      const stats = await sharedMemory.stats();
      addLine('intent_graph_cache_entries', stats.keys);
    } catch {
      addLine('intent_graph_cache_entries', 0);
    }

    // Add HELP and TYPE comments
    const formatted = [
      '# HELP intent_graph_intents_captured_total Total intents captured',
      '# TYPE intent_graph_intents_captured_total counter',
      '# HELP intent_graph_nudges_sent_total Total nudges sent',
      '# TYPE intent_graph_nudges_sent_total counter',
      '# HELP intent_graph_agents_runs_total Total agent runs',
      '# TYPE intent_graph_agents_runs_total counter',
      '# HELP intent_graph_capture_latency_ms Latency of intent capture',
      '# TYPE intent_graph_capture_latency_ms gauge',
      '# HELP intent_graph_process_uptime_seconds Process uptime in seconds',
      '# TYPE intent_graph_process_uptime_seconds gauge',
      '',
      ...lines,
      '',
      `# Exported at ${new Date().toISOString()}`,
    ].join('\n');

    res.set('Content-Type', 'text/plain; version=0.0.4');
    res.send(formatted);
  } catch (error) {
    console.error('[Metrics] Prometheus export failed:', error);
    res.status(500).send('# Error exporting metrics\n');
  }
});

/**
 * GET /metrics/dashboard
 * JSON metrics for dashboard
 */
router.get('/dashboard', async (_req: Request, res: Response) => {
  try {
    const metrics = await getDashboardMetrics();
    res.json(metrics);
  } catch (error) {
    console.error('[Metrics] Dashboard export failed:', error);
    res.status(500).json({ error: 'Failed to export metrics' });
  }
});

export default router;

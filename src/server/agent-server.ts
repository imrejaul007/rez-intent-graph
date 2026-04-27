// ── ReZ Mind - Agent Server ─────────────────────────────────────────────────────
import 'dotenv/config';

// Standalone Express server for running the ReZ Mind agent swarm
// Part of ReZ Mind - AI-powered commerce intelligence platform
// DANGEROUS: Full autonomous mode with skip-permission capabilities

import express, { Request, Response, NextFunction } from 'express';
import {
  getSwarmCoordinator,
  runAgent,
  getSwarmStatus,
  runAllAgentsOnce,
  sharedMemory,
  // ── Autonomous Orchestrator ──────────────────────────────────────────────────
  getAutonomousOrchestrator,
  startAutonomousMode,
  stopAutonomousMode,
  executeAutonomousAction,
  // ── Dangerous Mode ───────────────────────────────────────────────────────────
  enableDangerousMode,
  disableDangerousMode,
  emergencyStop,
} from '../agents/index.js';

// ── External Services Integration ─────────────────────────────────────────────
import {
  chargeWallet,
  creditWallet,
  getWalletBalance,
  createOrder,
  updateOrderStatus,
  executeRoomServiceFlow,
  executeShoppingFlow,
  getCircuitBreakerStatus,
  resetCircuitBreaker,
  forceOpenCircuitBreaker,
  checkServiceHealth,
  getAllServiceHealth,
  type WalletBalance,
  type CreateOrderParams,
  type OrderResult,
} from '../integrations/external-services.js';

// ── Agent OS Integration ──────────────────────────────────────────────────────
import {
  intentGraphMemory,
  executeAgentTool,
  listAgentTools,
  type EnrichedContext,
} from '../integrations/agentOsIntegration.js';

// ── Merchant API Routes ───────────────────────────────────────────────────────
import merchantRouter from '../api/merchant.routes.js';

// ── Monitoring API Routes ──────────────────────────────────────────────────────
import monitoringRouter from '../api/monitoring.routes.js';

// ── Chat & Knowledge API Routes (Phase 7) ─────────────────────────────────────
import chatRouter from '../api/chat.routes.js';

// ── WebSocket Server ──────────────────────────────────────────────────────────
import { wsServer } from '../websocket/server.js';
import { standardLimiter } from '../middleware/rateLimit.js';

const app = express();
const PORT = process.env.AGENT_PORT || 3005;

// ── Dangerous Mode — only enable if explicitly configured ──────────────────────
if (process.env.REZ_DANGEROUS_MODE === 'true') {
  console.log('🚨 DANGEROUS MODE: Enabled via REZ_DANGEROUS_MODE env var');
  enableDangerousMode();
} else {
  console.log('🛡️  Safe mode: dangerous mode disabled. Set REZ_DANGEROUS_MODE=true to enable.');
}

app.use(express.json());

// Rate limiting - global standard limit
app.use(standardLimiter);

// ── Merchant Demand API (Phase 5) ────────────────────────────────────────────────
app.use('/api/merchant', merchantRouter);

// ── Monitoring API (Phase 6) ────────────────────────────────────────────────────
app.use('/api/monitoring', monitoringRouter);

// ── Chat & Knowledge API (Phase 7) ─────────────────────────────────────────────
app.use('/api', chatRouter);

// ── Request logging ─────────────────────────────────────────────────────────────

app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── Health check ───────────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Swarm status ────────────────────────────────────────────────────────────────

app.get('/api/swarm/status', async (_req: Request, res: Response) => {
  try {
    const status = await getSwarmStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ── Run single agent ───────────────────────────────────────────────────────────

app.post('/api/swarm/run/:agentName', async (req: Request, res: Response) => {
  const { agentName } = req.params;

  try {
    const result = await runAgent(agentName);
    if (!result) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ── Run all agents ─────────────────────────────────────────────────────────────

app.post('/api/swarm/run-all', async (_req: Request, res: Response) => {
  try {
    const results = await runAllAgentsOnce();
    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ── Memory stats ────────────────────────────────────────────────────────────────

app.get('/api/memory/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await sharedMemory.stats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ── Demand signals ─────────────────────────────────────────────────────────────

app.get('/api/demand/:merchantId/:category', async (req: Request, res: Response) => {
  const { merchantId, category } = req.params;

  try {
    const signal = await sharedMemory.getDemandSignal(merchantId, category);
    if (!signal) {
      res.status(404).json({ error: 'Signal not found' });
      return;
    }
    res.json(signal);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ── Scarcity signals ───────────────────────────────────────────────────────────

app.get('/api/scarcity/:merchantId/:category', async (req: Request, res: Response) => {
  const { merchantId, category } = req.params;

  try {
    const signal = await sharedMemory.getScarcitySignal(merchantId, category);
    if (!signal) {
      res.status(404).json({ error: 'Signal not found' });
      return;
    }
    res.json(signal);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/scarcity/critical', async (_req: Request, res: Response) => {
  try {
    const signals = await sharedMemory.getCriticalScarcity();
    res.json(signals);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ── User profiles ──────────────────────────────────────────────────────────────

app.get('/api/profiles/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params;

  try {
    const profile = await sharedMemory.getUserProfile(userId);
    if (!profile) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }
    res.json(profile);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ── Revenue reports ─────────────────────────────────────────────────────────────

app.get('/api/revenue/latest', async (_req: Request, res: Response) => {
  try {
    const report = await sharedMemory.getLatestRevenueReport();
    if (!report) {
      res.status(404).json({ error: 'No report found' });
      return;
    }
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ── Optimization recommendations ─────────────────────────────────────────────────

app.get('/api/optimizations', async (_req: Request, res: Response) => {
  try {
    const recommendations = await sharedMemory.getAllOptimizations();
    res.json(recommendations);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ── Trending intents ────────────────────────────────────────────────────────────

app.get('/api/trending/:category', async (req: Request, res: Response) => {
  const { category } = req.params;

  try {
    const trending = await sharedMemory.getTrendingIntents(category);
    res.json(trending);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════
// PHASE 4: AGENT OS INTEGRATION ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════════

// ── Intent Graph Memory ─────────────────────────────────────────────────────────

app.get('/api/agent/intents/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params;

  try {
    const intents = await intentGraphMemory.getActiveIntents(userId);
    res.json(intents);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/agent/dormant/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params;

  try {
    const dormantIntents = await intentGraphMemory.getDormantIntents(userId);
    res.json(dormantIntents);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/agent/profile/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params;

  try {
    const profile = await intentGraphMemory.getCrossAppProfile(userId);
    res.json(profile);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/agent/enrich/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params;

  try {
    const context = await intentGraphMemory.enrichContext(userId);
    res.json(context);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ── Agent Tools ─────────────────────────────────────────────────────────────────

app.get('/api/agent/tools', (_req: Request, res: Response) => {
  const tools = listAgentTools();
  res.json({ tools, count: tools.length });
});

app.post('/api/agent/tools/execute', async (req: Request, res: Response) => {
  const { toolName, params } = req.body;

  if (!toolName) {
    res.status(400).json({ error: 'toolName is required' });
    return;
  }

  try {
    const result = await executeAgentTool(toolName, params || {});
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/agent/insight', async (req: Request, res: Response) => {
  const { userId, agentId, insight } = req.body;

  if (!userId || !agentId || !insight) {
    res.status(400).json({ error: 'userId, agentId, and insight are required' });
    return;
  }

  try {
    await intentGraphMemory.recordAgentInsight(userId, agentId, insight);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ── Invalidate Cache ─────────────────────────────────────────────────────────────

app.post('/api/agent/cache/invalidate/:userId', (req: Request, res: Response) => {
  const { userId } = req.params;
  intentGraphMemory.invalidateCache(userId);
  res.json({ success: true, message: `Cache invalidated for user ${userId}` });
});

// ═══════════════════════════════════════════════════════════════════════════════════
// AUTONOMOUS MODE API ENDPOINTS - DANGEROUS OPERATIONS
// These endpoints enable full autonomous agent operation with skip-permission
// ═══════════════════════════════════════════════════════════════════════════════════

// ── Enable Full Autonomy ────────────────────────────────────────────────────────

app.post('/api/autonomous/start', async (_req: Request, res: Response) => {
  try {
    console.log('🚨 AUTONOMOUS MODE: Starting full autonomous operation');
    await startAutonomousMode();
    const status = await getAutonomousOrchestrator().getStatus();
    res.json({
      success: true,
      message: 'Full autonomous mode enabled',
      status,
      warnings: [
        'All agents can execute dangerous actions',
        'Skip-permission mode is ACTIVE',
        'Emergency stop threshold: 100 actions',
      ],
    });
  } catch (error) {
    console.error('❌ AUTONOMOUS MODE FAILED:', error);
    res.status(500).json({ error: String(error) });
  }
});

// ── Disable Autonomy ───────────────────────────────────────────────────────────

app.post('/api/autonomous/stop', async (_req: Request, res: Response) => {
  try {
    console.log('🛑 AUTONOMOUS MODE: Stopping autonomous operation');
    await stopAutonomousMode();
    res.json({
      success: true,
      message: 'Autonomous mode disabled',
    });
  } catch (error) {
    console.error('❌ STOP AUTONOMOUS FAILED:', error);
    res.status(500).json({ error: String(error) });
  }
});

// ── Execute Dangerous Action ───────────────────────────────────────────────────

app.post('/api/autonomous/action', async (req: Request, res: Response) => {
  const { actionType, payload, agentName } = req.body;

  if (!actionType || !agentName) {
    res.status(400).json({
      error: 'Missing required fields: actionType, agentName',
    });
    return;
  }

  try {
    console.log(`🚨 AUTONOMOUS ACTION: ${actionType} by ${agentName}`);
    const result = await executeAutonomousAction(actionType, payload || {});
    res.json({
      success: result,
      actionType,
      agentName,
      payload,
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`❌ AUTONOMOUS ACTION FAILED:`, error);
    res.status(500).json({ error: String(error) });
  }
});

// ── Get Autonomy Status ────────────────────────────────────────────────────────

app.get('/api/autonomous/status', async (_req: Request, res: Response) => {
  try {
    const status = await getAutonomousOrchestrator().getStatus();
    const swarmStatus = await getSwarmStatus();
    res.json({
      orchestrator: status,
      swarm: swarmStatus,
      dangerousMode: {
        enabled: swarmStatus.dangerousMode,
        skipPermission: true,
      },
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ── Emergency Stop ─────────────────────────────────────────────────────────────

app.post('/api/autonomous/emergency-stop', async (req: Request, res: Response) => {
  const reason = req.body?.reason || 'Manual emergency stop via API';

  try {
    console.error(`🚨🚨🚨 EMERGENCY STOP TRIGGERED: ${reason}`);
    emergencyStop();
    res.json({
      success: true,
      message: 'Emergency stop executed',
      reason,
    });
  } catch (error) {
    console.error('❌ EMERGENCY STOP FAILED:', error);
    res.status(500).json({ error: String(error) });
  }
});

// ── Start All Agents ───────────────────────────────────────────────────────────

app.post('/api/autonomous/agents/start', async (_req: Request, res: Response) => {
  try {
    const orchestrator = getAutonomousOrchestrator();
    await orchestrator.startAllAgents();
    res.json({
      success: true,
      message: 'All agents started',
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ── Stop All Agents ────────────────────────────────────────────────────────────

app.post('/api/autonomous/agents/stop', async (_req: Request, res: Response) => {
  try {
    const orchestrator = getAutonomousOrchestrator();
    await orchestrator.stop();
    res.json({
      success: true,
      message: 'All agents stopped',
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ── Error handler ──────────────────────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Server Error]', err);
  res.status(500).json({ error: err.message });
});

// ═══════════════════════════════════════════════════════════════════════════════════
// PHASE 2: REAL SERVICE INTEGRATION ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════════

// ── Service Health & Circuit Breaker ───────────────────────────────────────────

app.get('/api/services/health', async (_req: Request, res: Response) => {
  try {
    const health = await getAllServiceHealth();
    const circuitBreaker = getCircuitBreakerStatus();
    res.json({
      services: health,
      circuitBreakers: circuitBreaker,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/services/health/:service', async (req: Request, res: Response) => {
  const { service } = req.params;
  try {
    const healthy = await checkServiceHealth(service as 'wallet' | 'order');
    const cbStatus = getCircuitBreakerStatus().find(s => s.name === service);
    res.json({
      service,
      healthy,
      circuitBreaker: cbStatus,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/services/circuit-breaker/status', (_req: Request, res: Response) => {
  const status = getCircuitBreakerStatus();
  res.json({ services: status });
});

app.post('/api/services/circuit-breaker/reset/:service', (req: Request, res: Response) => {
  const { service } = req.params;
  const success = resetCircuitBreaker(service);
  res.json({ success, service, message: success ? 'Circuit breaker reset' : 'Service not found' });
});

app.post('/api/services/circuit-breaker/open/:service', (req: Request, res: Response) => {
  const { service } = req.params;
  const success = forceOpenCircuitBreaker(service);
  res.json({ success, service, message: success ? 'Circuit breaker forced open' : 'Service not found' });
});

// ── Wallet Operations ─────────────────────────────────────────────────────────

app.get('/api/wallet/:userId/balance', async (req: Request, res: Response) => {
  const { userId } = req.params;
  try {
    const balance = await getWalletBalance(userId);
    if (!balance) {
      res.status(404).json({ error: 'Balance not found' });
      return;
    }
    res.json(balance);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/wallet/charge', async (req: Request, res: Response) => {
  const { userId, amount, description, coinType, referenceId, referenceType } = req.body;

  if (!userId || !amount) {
    res.status(400).json({ error: 'Missing required fields: userId, amount' });
    return;
  }

  try {
    const result = await chargeWallet(userId, amount, description || 'Charge', {
      coinType,
      referenceId,
      referenceType,
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/wallet/credit', async (req: Request, res: Response) => {
  const { userId, amount, description, coinType, referenceId, referenceType } = req.body;

  if (!userId || !amount) {
    res.status(400).json({ error: 'Missing required fields: userId, amount' });
    return;
  }

  try {
    const result = await creditWallet(userId, amount, description || 'Credit', {
      coinType,
      referenceId,
      referenceType,
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ── Order Operations ───────────────────────────────────────────────────────────

app.post('/api/orders/create', async (req: Request, res: Response) => {
  const params: CreateOrderParams = req.body;

  if (!params.userId || !params.storeId || !params.items?.length) {
    res.status(400).json({ error: 'Missing required fields: userId, storeId, items' });
    return;
  }

  try {
    const result = await createOrder(params);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.patch('/api/orders/:orderId/status', async (req: Request, res: Response) => {
  const { orderId } = req.params;
  const { status } = req.body;

  if (!status) {
    res.status(400).json({ error: 'Missing status field' });
    return;
  }

  try {
    const result = await updateOrderStatus(orderId, status);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ── Complete Flows ─────────────────────────────────────────────────────────────

app.post('/api/room-service/execute', async (req: Request, res: Response) => {
  const { guestId, roomNumber, hotelId, items, complimentaryItems } = req.body;

  if (!guestId || !roomNumber || !hotelId || !items?.length) {
    res.status(400).json({ error: 'Missing required fields: guestId, roomNumber, hotelId, items' });
    return;
  }

  try {
    console.log('[API] Executing room service flow', { guestId, roomNumber, hotelId });
    const result = await executeRoomServiceFlow(guestId, roomNumber, hotelId, items, complimentaryItems);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/shopping/execute', async (req: Request, res: Response) => {
  const { userId, storeId, merchantId, items } = req.body;

  if (!userId || !storeId || !merchantId || !items?.length) {
    res.status(400).json({ error: 'Missing required fields: userId, storeId, merchantId, items' });
    return;
  }

  try {
    console.log('[API] Executing shopping flow', { userId, storeId, merchantId });
    const result = await executeShoppingFlow(userId, storeId, merchantId, items);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ── Start server ───────────────────────────────────────────────────────────────

export function startAgentServer(): void {
  const coordinator = getSwarmCoordinator();

  const server = app.listen(PORT, () => {
    // Initialize WebSocket server
    wsServer.initialize(server);
    console.log('[Agent Server] WebSocket server initialized on /ws');
    console.log(`[Agent Server] Running on port ${PORT}`);
    console.log('[Agent Server] Starting swarm coordinator...');

    coordinator.start();

    console.log('[Agent Server] Swarm coordinator started');
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  PHASE 7: MERCHANT KNOWLEDGE & AUTONOMOUS CHAT');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  MERCHANT KNOWLEDGE:');
    console.log('  POST /api/knowledge/merchant/:id/entries  - Add knowledge entry');
    console.log('  POST /api/knowledge/merchant/:id/bulk    - Bulk import');
    console.log('  GET  /api/knowledge/merchant/:id         - Get knowledge base');
    console.log('  GET  /api/knowledge/merchant/:id/search - Search knowledge');
    console.log('  POST /api/knowledge/merchant/:id/menu    - Upload menu');
    console.log('  POST /api/knowledge/merchant/:id/policy  - Upload policies');
    console.log('  POST /api/knowledge/merchant/:id/faq     - Upload FAQs');
    console.log('');
    console.log('  AUTONOMOUS CHAT:');
    console.log('  POST /api/chat/message           - Send chat message');
    console.log('  GET  /api/chat/history/:userId  - Get chat history');
    console.log('  POST /api/chat/end-session      - End chat session');
    console.log('  GET  /api/chat/context/:userId  - Get chat context');
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  PHASE 6: REAL-TIME & MONITORING');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  WEBSOCKET: ws://localhost:' + PORT + '/ws');
    console.log('  Channels: demand_signals, scarcity_alerts, nudge_events,');
    console.log('           system_metrics, merchant_dashboard, user_intents');
    console.log('');
    console.log('  MONITORING:');
    console.log('  GET  /api/monitoring/health           - Health check');
    console.log('  GET  /api/monitoring/dashboard        - Dashboard metrics');
    console.log('  GET  /api/monitoring/metrics         - All metrics');
    console.log('  GET  /api/monitoring/alerts           - Active alerts');
    console.log('  GET  /api/monitoring/websocket        - WS stats');
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  PHASE 5: MERCHANT DEMAND SIGNALS');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  MERCHANT DASHBOARD:');
    console.log('  GET  /api/merchant/:id/demand/dashboard - Demand overview');
    console.log('  GET  /api/merchant/:id/demand/signal   - Real-time signal');
    console.log('  GET  /api/merchant/:id/procurement     - Procurement signals');
    console.log('  GET  /api/merchant/:id/intents/top     - Top performing intents');
    console.log('  GET  /api/merchant/:id/trends          - Demand trends');
    console.log('  GET  /api/merchant/:id/locations       - City insights');
    console.log('  GET  /api/merchant/:id/pricing        - Price expectations');
    console.log('  POST /api/merchant/:id/alerts          - Configure alerts');
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  PHASE 4: AGENT OS INTEGRATION');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  GET  /api/agent/tools            - List available tools');
    console.log('  POST /api/agent/tools/execute    - Execute agent tool');
    console.log('  GET  /api/agent/intents/:userId  - Get active intents');
    console.log('  GET  /api/agent/dormant/:userId - Get dormant intents');
    console.log('  GET  /api/agent/enrich/:userId  - Get enriched context');
    console.log('  POST /api/agent/insight         - Record agent insight');
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  PHASE 2: SERVICE INTEGRATION');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  SERVICE HEALTH: GET /api/services/health');
    console.log('  WALLET: GET /api/wallet/:userId/balance');
    console.log('  ORDERS: POST /api/orders/create');
    console.log('  FLOWS: POST /api/room-service/execute, /api/shopping/execute');
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  AUTONOMOUS MODE (DANGEROUS)');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  POST /api/autonomous/start    - Enable full autonomy');
    console.log('  POST /api/autonomous/stop     - Disable autonomy');
    console.log('  POST /api/autonomous/action   - Execute dangerous action');
    console.log('═══════════════════════════════════════════════════════════════');
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('[Agent Server] Shutting down...');
    coordinator.stop();
    server.close(() => {
      console.log('[Agent Server] Stopped');
      process.exit(0);
    });
  });
}

// Start if run directly
const isMainModule = decodeURIComponent(import.meta.url) === `file://${process.argv[1]}`;
if (isMainModule) {
  startAgentServer();
}

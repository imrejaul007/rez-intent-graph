// ── Intent Graph Server ───────────────────────────────────────────────────────────
// Standalone Express server for RTMN Commerce Memory Intent Graph
// Uses MongoDB for data storage
import 'dotenv/config';


import express, { Request, Response, NextFunction } from 'express';
import { connectDB, getConnectionStatus } from '../models/index.js';
import intentRouter from '../api/intent.routes.js';
import commerceMemoryRouter from '../api/commerce-memory.routes.js';
import {
  standardLimiter,
  strictLimiter,
  captureLimiter,
  nudgeLimiter,
} from '../middleware/rateLimit.js';

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json());

// CORS - restrict origins in production
const allowedOrigins = (() => {
  const env = process.env.ALLOWED_ORIGINS;
  if (env) return env.split(',').map(s => s.trim());
  // Default: localhost only for dev safety
  if (process.env.NODE_ENV === 'production') return [];
  return ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:3001'];
})();

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin && (allowedOrigins.length === 0 || allowedOrigins.includes(origin))) {
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

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// ── Health Check ────────────────────────────────────────────────────────────

app.get('/health', async (_req: Request, res: Response) => {
  const mongoConnected = getConnectionStatus();
  res.json({
    status: 'healthy',
    service: 'intent-graph',
    mongodb: mongoConnected ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
});

// ── API Routes ─────────────────────────────────────────────────────────────

app.use('/api/intent', intentRouter);
app.use('/api/commerce-memory', commerceMemoryRouter);

// ── Error Handler ─────────────────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Error]', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// ── Database Connection & Server Start ─────────────────────────────────────

async function startServer() {
  try {
    // Connect to MongoDB
    console.log('[MongoDB] Connecting to ReZ ecosystem database...');
    await connectDB();
    console.log('[MongoDB] Connected successfully');

    // Start Express server
    app.listen(PORT, () => {
      console.log(`[Intent Graph] Server running on port ${PORT}`);
      console.log(`[Intent Graph] Health check: http://localhost:${PORT}/health`);
      console.log(`[Intent Graph] Intent API: http://localhost:${PORT}/api/intent`);
      console.log(`[Intent Graph] Commerce Memory API: http://localhost:${PORT}/api/commerce-memory`);
    });
  } catch (error) {
    console.error('[Intent Graph] Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

export default app;

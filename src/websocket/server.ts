// ── WebSocket Server ─────────────────────────────────────────────────────────────────
// Phase 6: Real-time updates for agents, merchants, and consumers
// Supports subscriptions to demand signals, nudge events, and system metrics

import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { IncomingMessage } from 'http';
import { sharedMemory } from '../agents/shared-memory.js';
import { log } from '../utils/logger.js';
import { timingSafeEqual } from 'crypto';

// ── WebSocket Authentication ──────────────────────────────────────────────────────

interface AuthResult {
  success: boolean;
  userId?: string;
  error?: string;
}

/**
 * Validate WebSocket connection token
 * Supports multiple auth methods: Bearer token, API key, or internal service token
 */
function validateConnectionToken(req: IncomingMessage): AuthResult {
  // Get token from query string (for WebSocket clients)
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  const apiKey = url.searchParams.get('apiKey');

  // Also check headers for upgrade requests
  const authHeader = req.headers.authorization;
  const internalToken = req.headers['x-internal-token'] as string;
  const headerApiKey = req.headers['x-api-key'] as string;

  // Check internal service token first (highest privilege)
  const configuredInternalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (configuredInternalToken && internalToken) {
    try {
      const tokenBuffer = Buffer.from(internalToken);
      const expectedBuffer = Buffer.from(configuredInternalToken);
      if (tokenBuffer.length === expectedBuffer.length && timingSafeEqual(tokenBuffer, expectedBuffer)) {
        return { success: true, userId: 'internal-service' };
      }
    } catch {
      log.warn('[WebSocket] Auth failed: timing-safe comparison error');
      return { success: false, error: 'Invalid internal token format' };
    }
  }

  // Check API key
  const configuredApiKey = process.env.MERCHANT_API_KEY;
  if (configuredApiKey) {
    const keyToCheck = apiKey || headerApiKey;
    if (keyToCheck) {
      try {
        const keyBuffer = Buffer.from(keyToCheck);
        const expectedBuffer = Buffer.from(configuredApiKey);
        if (keyBuffer.length === expectedBuffer.length && timingSafeEqual(keyBuffer, expectedBuffer)) {
          const merchantId = url.searchParams.get('merchantId');
          return { success: true, userId: merchantId || 'merchant-api' };
        }
      } catch {
        log.warn('[WebSocket] Auth failed: API key comparison error');
        return { success: false, error: 'Invalid API key format' };
      }
    }
  }

  // Check Bearer token (JWT validation would happen here in production)
  if (authHeader?.startsWith('Bearer ')) {
    const bearerToken = authHeader.substring(7);
    if (bearerToken && bearerToken.length > 10) {
      // In production, validate JWT here
      // For now, accept well-formed tokens
      return { success: true, userId: 'authenticated-user' };
    }
  }

  // Check token query param
  if (token && token.length > 10) {
    return { success: true, userId: 'token-user' };
  }

  return { success: false, error: 'Missing or invalid authentication' };
}

// ── Subscription Types ────────────────────────────────────────────────────────────

export type SubscriptionChannel =
  | 'demand_signals'
  | 'scarcity_alerts'
  | 'nudge_events'
  | 'system_metrics'
  | 'merchant_dashboard'
  | 'user_intents';

interface Subscription {
  channel: SubscriptionChannel;
  filter?: {
    merchantId?: string;
    userId?: string;
    category?: string;
  };
}

interface WebSocketMessage {
  type: 'subscribe' | 'unsubscribe' | 'ping' | 'broadcast';
  channel?: SubscriptionChannel;
  payload?: unknown;
  filter?: Subscription['filter'];
}

// ── WebSocket Client ──────────────────────────────────────────────────────────────

interface Client {
  id: string;
  ws: WebSocket;
  subscriptions: Set<SubscriptionChannel>;
  filters: Map<SubscriptionChannel, Subscription['filter']>;
  lastPing: number;
}

// ── WebSocket Server Manager ─────────────────────────────────────────────────────

export class ReZWSServer {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, Client> = new Map();
  private clientCounter = 0;
  private metricsInterval: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  /**
   * Initialize WebSocket server
   */
  initialize(server: Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      // Authenticate the connection first
      const authResult = validateConnectionToken(req);

      if (!authResult.success) {
        log.warn('[WebSocket] Connection rejected: authentication failed', {
          ip: req.socket.remoteAddress,
          error: authResult.error,
        });
        ws.close(1008, 'Authentication required');
        return;
      }

      log.info('[WebSocket] Client authenticated', {
        userId: authResult.userId,
        ip: req.socket.remoteAddress,
      });

      const clientId = `client_${++this.clientCounter}`;
      const client: Client = {
        id: clientId,
        ws,
        subscriptions: new Set(),
        filters: new Map(),
        lastPing: Date.now(),
      };

      this.clients.set(clientId, client);
      log.info('[WebSocket] Client connected', { clientId, total: this.clients.size, userId: authResult.userId });

      // Send welcome message
      this.sendToClient(clientId, {
        type: 'connected',
        payload: { clientId, message: 'Connected to ReZ Mind WebSocket' },
      });

      // Handle messages
      ws.on('message', (data: Buffer) => {
        try {
          const message: WebSocketMessage = JSON.parse(data.toString());
          this.handleMessage(clientId, message);
        } catch (error) {
          log.error('[WebSocket] Invalid message', { clientId, error });
          this.sendToClient(clientId, {
            type: 'error',
            payload: { message: 'Invalid JSON' },
          });
        }
      });

      // Handle pong (heartbeat response)
      ws.on('pong', () => {
        const client = this.clients.get(clientId);
        if (client) {
          client.lastPing = Date.now();
        }
      });

      // Handle disconnect
      ws.on('close', () => {
        this.clients.delete(clientId);
        log.info('[WebSocket] Client disconnected', { clientId, remaining: this.clients.size });
      });

      // Handle errors
      ws.on('error', (error: Error) => {
        log.error('[WebSocket] Client error', { clientId, error: error.message });
      });
    });

    // Start heartbeat check
    this.startHeartbeat();

    // Start metrics broadcast
    this.startMetricsBroadcast();

    log.info('[WebSocket] Server initialized', { path: '/ws' });
  }

  /**
   * Handle incoming message
   */
  private handleMessage(clientId: string, message: WebSocketMessage): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    switch (message.type) {
      case 'subscribe':
        this.subscribe(clientId, message.channel!, message.filter);
        break;

      case 'unsubscribe':
        this.unsubscribe(clientId, message.channel!);
        break;

      case 'ping':
        client.ws.ping();
        this.sendToClient(clientId, { type: 'pong' });
        break;

      default:
        log.warn('[WebSocket] Unknown message type', { clientId, type: message.type });
    }
  }

  /**
   * Subscribe to a channel
   */
  subscribe(clientId: string, channel: SubscriptionChannel, filter?: Subscription['filter']): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.subscriptions.add(channel);
    if (filter) {
      client.filters.set(channel, filter);
    }

    log.info('[WebSocket] Client subscribed', { clientId, channel, filter });
    this.sendToClient(clientId, {
      type: 'subscribed',
      payload: { channel, filter },
    });

    // Send initial data for the channel
    this.sendInitialData(clientId, channel, filter);
  }

  /**
   * Unsubscribe from a channel
   */
  unsubscribe(clientId: string, channel: SubscriptionChannel): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.subscriptions.delete(channel);
    client.filters.delete(channel);

    log.info('[WebSocket] Client unsubscribed', { clientId, channel });
    this.sendToClient(clientId, {
      type: 'unsubscribed',
      payload: { channel },
    });
  }

  /**
   * Send initial data when subscribing
   */
  private async sendInitialData(clientId: string, channel: SubscriptionChannel, filter?: Subscription['filter']): Promise<void> {
    switch (channel) {
      case 'demand_signals':
        if (filter?.merchantId) {
          const signal = await sharedMemory.getDemandSignal(filter.merchantId, filter.category || 'DINING');
          this.sendToClient(clientId, {
            type: 'initial_data',
            payload: { channel, data: signal },
          });
        }
        break;

      case 'system_metrics':
        const stats = await sharedMemory.stats();
        this.sendToClient(clientId, {
          type: 'initial_data',
          payload: { channel, data: stats },
        });
        break;
    }
  }

  /**
   * Broadcast to all clients subscribed to a channel
   */
  broadcast(channel: SubscriptionChannel, payload: unknown, filter?: Subscription['filter']): void {
    let count = 0;

    this.clients.forEach((client) => {
      if (client.subscriptions.has(channel)) {
        // Check filter
        const clientFilter = client.filters.get(channel);
        if (clientFilter && filter) {
          if (clientFilter.merchantId && clientFilter.merchantId !== filter.merchantId) return;
          if (clientFilter.userId && clientFilter.userId !== filter.userId) return;
          if (clientFilter.category && clientFilter.category !== filter.category) return;
        }

        this.sendToClient(client.id, {
          type: 'event',
          channel,
          payload,
        });
        count++;
      }
    });

    log.debug('[WebSocket] Broadcast sent', { channel, clients: count });
  }

  /**
   * Broadcast to specific merchant's subscribers
   */
  broadcastToMerchant(merchantId: string, event: string, data: unknown): void {
    this.clients.forEach((client) => {
      const filter = client.filters.get('merchant_dashboard');
      if (filter?.merchantId === merchantId) {
        this.sendToClient(client.id, {
          type: 'event',
          channel: 'merchant_dashboard',
          payload: { event, data, merchantId },
        });
      }
    });
  }

  /**
   * Broadcast to specific user's subscribers
   */
  broadcastToUser(userId: string, event: string, data: unknown): void {
    this.clients.forEach((client) => {
      const filter = client.filters.get('user_intents');
      if (filter?.userId === userId) {
        this.sendToClient(client.id, {
          type: 'event',
          channel: 'user_intents',
          payload: { event, data, userId },
        });
      }
    });
  }

  /**
   * Send message to specific client
   */
  private sendToClient(clientId: string, message: object): void {
    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) return;

    try {
      client.ws.send(JSON.stringify(message));
    } catch (error) {
      log.error('[WebSocket] Failed to send to client', { clientId, error });
    }
  }

  /**
   * Start heartbeat to detect stale connections
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const staleThreshold = 60000; // 60 seconds

      this.clients.forEach((client, clientId) => {
        if (now - client.lastPing > staleThreshold * 2) {
          log.warn('[WebSocket] Client stale, closing', { clientId });
          client.ws.terminate();
          this.clients.delete(clientId);
        } else if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.ping();
        }
      });
    }, 30000);
  }

  /**
   * Start periodic metrics broadcast
   */
  private startMetricsBroadcast(): void {
    this.metricsInterval = setInterval(async () => {
      try {
        const stats = await sharedMemory.stats();

        // Broadcast to all subscribers
        this.broadcast('system_metrics', {
          timestamp: new Date().toISOString(),
          ...stats,
        });
      } catch (error) {
        log.error('[WebSocket] Metrics broadcast failed', { error });
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Get server stats
   */
  getStats(): {
    totalClients: number;
    subscriptions: Record<SubscriptionChannel, number>;
    uptime: number;
  } {
    const subscriptions: Record<SubscriptionChannel, number> = {
      demand_signals: 0,
      scarcity_alerts: 0,
      nudge_events: 0,
      system_metrics: 0,
      merchant_dashboard: 0,
      user_intents: 0,
    };

    this.clients.forEach((client) => {
      client.subscriptions.forEach((channel) => {
        subscriptions[channel]++;
      });
    });

    return {
      totalClients: this.clients.size,
      subscriptions,
      uptime: process.uptime(),
    };
  }

  /**
   * Shutdown server
   */
  shutdown(): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.metricsInterval) clearInterval(this.metricsInterval);

    this.clients.forEach((client) => {
      client.ws.close(1001, 'Server shutdown');
    });

    if (this.wss) {
      this.wss.close();
    }

    log.info('[WebSocket] Server shut down');
  }
}

// ── Singleton Instance ─────────────────────────────────────────────────────────

export const wsServer = new ReZWSServer();

// ── Event Publishers ─────────────────────────────────────────────────────────────

/**
 * Publish demand spike event
 */
export async function publishDemandSpike(merchantId: string, signal: unknown): Promise<void> {
  wsServer.broadcastToMerchant(merchantId, 'demand_spike', signal);
  wsServer.broadcast('demand_signals', { type: 'demand_spike', merchantId, signal });
}

/**
 * Publish scarcity alert
 */
export async function publishScarcityAlert(merchantId: string, alert: unknown): Promise<void> {
  wsServer.broadcastToMerchant(merchantId, 'scarcity_alert', alert);
  wsServer.broadcast('scarcity_alerts', { type: 'scarcity_alert', merchantId, alert });
}

/**
 * Publish nudge event
 */
export async function publishNudgeEvent(userId: string, event: string, data: unknown): Promise<void> {
  wsServer.broadcastToUser(userId, `nudge_${event}`, data);
  wsServer.broadcast('nudge_events', { type: event, userId, data });
}

/**
 * Publish intent update
 */
export async function publishIntentUpdate(userId: string, intent: unknown): Promise<void> {
  wsServer.broadcastToUser(userId, 'intent_update', intent);
}

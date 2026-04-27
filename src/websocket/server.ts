// ── WebSocket Server ─────────────────────────────────────────────────────────────────
// Phase 6: Real-time updates for agents, merchants, and consumers
// Supports subscriptions to demand signals, nudge events, and system metrics

import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { sharedMemory } from '../agents/shared-memory.js';

const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => console.log(`[WebSocket] ${msg}`, meta || ''),
  warn: (msg: string, meta?: Record<string, unknown>) => console.warn(`[WebSocket] ${msg}`, meta || ''),
  error: (msg: string, meta?: Record<string, unknown>) => console.error(`[WebSocket] ${msg}`, meta || ''),
  debug: (msg: string, meta?: Record<string, unknown>) => console.debug(`[WebSocket] ${msg}`, meta || ''),
};

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

    this.wss.on('connection', (ws: WebSocket) => {
      const clientId = `client_${++this.clientCounter}`;
      const client: Client = {
        id: clientId,
        ws,
        subscriptions: new Set(),
        filters: new Map(),
        lastPing: Date.now(),
      };

      this.clients.set(clientId, client);
      logger.info('Client connected', { clientId, total: this.clients.size });

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
          logger.error('Invalid message', { clientId, error });
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
        logger.info('Client disconnected', { clientId, remaining: this.clients.size });
      });

      // Handle errors
      ws.on('error', (error: Error) => {
        logger.error('Client error', { clientId, error: error.message });
      });
    });

    // Start heartbeat check
    this.startHeartbeat();

    // Start metrics broadcast
    this.startMetricsBroadcast();

    logger.info('WebSocket server initialized', { path: '/ws' });
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
        logger.warn('Unknown message type', { clientId, type: message.type });
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

    logger.info('Client subscribed', { clientId, channel, filter });
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

    logger.info('Client unsubscribed', { clientId, channel });
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

    logger.debug('Broadcast sent', { channel, clients: count });
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
      logger.error('Failed to send to client', { clientId, error });
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
          logger.warn('Client stale, closing', { clientId });
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
        logger.error('Metrics broadcast failed', { error });
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

    logger.info('WebSocket server shut down');
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

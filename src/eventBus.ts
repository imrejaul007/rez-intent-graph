/**
 * ReZ Mind Event Bus
 * Redis pub/sub for cross-service insight events
 */

import { publisher, subscriber } from './config/redis.js';
import { log } from './utils/logger.js';

export interface InsightEvent {
  event: string;
  data: Record<string, unknown>;
  timestamp: number;
}

const CHANNEL = 'rez-mind';

export async function emitEvent(event: string, data: Record<string, unknown>): Promise<void> {
  try {
    const payload: InsightEvent = {
      event,
      data,
      timestamp: Date.now(),
    };
    await publisher.publish(CHANNEL, JSON.stringify(payload));
    log.info(`[EventBus] Emitted: ${event}`, { userId: data.userId as string | undefined });
  } catch (error) {
    log.error('[EventBus] Failed to emit event', { error: error instanceof Error ? error : String(error) });
    throw error;
  }
}

type EventHandler = (data: Record<string, unknown>) => Promise<void>;

const handlers: Map<string, Set<EventHandler>> = new Map();
let isSubscribed = false;

async function ensureSubscription(): Promise<void> {
  if (!isSubscribed) {
    await subscriber.subscribe(CHANNEL);
    subscriber.on('message', (channel, message) => {
      if (channel === CHANNEL) {
        try {
          const { event, data } = JSON.parse(message) as InsightEvent;
          const eventHandlers = handlers.get(event);
          if (eventHandlers) {
            eventHandlers.forEach(async (handler) => {
              try {
                await handler(data);
              } catch (err) {
                log.error(`[EventBus] Handler error for ${event}`, { error: err instanceof Error ? err : String(err) });
              }
            });
          }
        } catch (err) {
          log.error('[EventBus] Failed to parse message', { error: err instanceof Error ? err : String(err) });
        }
      }
    });
    isSubscribed = true;
    log.info('[EventBus] Subscribed to channel', { channel: CHANNEL });
  }
}

export function subscribeToEvent(event: string, handler: EventHandler): () => void {
  if (!handlers.has(event)) {
    handlers.set(event, new Set());
  }
  handlers.get(event)!.add(handler);

  // Ensure we're listening to the Redis channel
  ensureSubscription().catch((err) => {
    log.error('[EventBus] Failed to subscribe', { error: err });
  });

  // Return unsubscribe function
  return () => {
    const eventHandlers = handlers.get(event);
    if (eventHandlers) {
      eventHandlers.delete(handler);
      if (eventHandlers.size === 0) {
        handlers.delete(event);
      }
    }
  };
}

export async function emitInsightGenerated(data: {
  userId: string;
  insightType: string;
  title: string;
  recommendation: string;
  confidence: number;
  priority: 'high' | 'medium' | 'low';
}): Promise<void> {
  await emitEvent('insight.generated', {
    userId: data.userId,
    insightType: data.insightType,
    title: data.title,
    recommendation: data.recommendation,
    confidence: data.confidence,
    priority: data.priority,
  });
}

export async function emitInsightTriggered(data: {
  userId: string;
  insightId: string;
  triggerType: string;
}): Promise<void> {
  await emitEvent('insight.triggered', {
    userId: data.userId,
    insightId: data.insightId,
    triggerType: data.triggerType,
  });
}

export async function emitInsightActioned(data: {
  userId: string;
  insightId: string;
  action: string;
  converted: boolean;
}): Promise<void> {
  await emitEvent('insight.actioned', {
    userId: data.userId,
    insightId: data.insightId,
    action: data.action,
    converted: data.converted,
  });
}

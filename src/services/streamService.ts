// ── Redis Streams ───────────────────────────────────────────────────────────────────
// Real-time intent signal ingestion pipeline
// Uses Redis Streams for reliable, ordered, durable event processing

import { redis, publisher } from '../config/redis.js';

const STREAM_KEYS = {
  INTENT_EVENTS: 'stream:intent:events',
  NUDGE_EVENTS: 'stream:intent:nudges',
  ANALYTICS: 'stream:intent:analytics',
} as const;

const CONSUMER_GROUP = 'intent-graph-processors';
const CONSUMER_NAME = `processor-${process.pid}`;

interface IntentEvent {
  userId: string;
  appType: string;
  intentKey: string;
  eventType: string;
  category: string;
  intentQuery?: string;
  metadata?: Record<string, any>;
  merchantId?: string;
  timestamp: number;
}

/**
 * Publish an intent event to the stream
 */
export async function publishIntentEvent(event: Omit<IntentEvent, 'timestamp'>): Promise<string> {
  const eventWithTimestamp: IntentEvent = {
    ...event,
    timestamp: Date.now(),
  };

  const messageId = await publisher.xadd(
    STREAM_KEYS.INTENT_EVENTS,
    '*',
    'data', JSON.stringify(eventWithTimestamp),
    'userId', event.userId,
    'appType', event.appType,
    'category', event.category
  );

  console.log(`[Stream] Published intent event ${messageId} for user ${event.userId}`);
  return messageId || '';
}

/**
 * Publish a nudge event
 */
export async function publishNudgeEvent(
  nudgeId: string,
  userId: string,
  event: 'sent' | 'delivered' | 'clicked' | 'converted',
  metadata?: Record<string, any>
): Promise<string> {
  const messageId = await publisher.xadd(
    STREAM_KEYS.NUDGE_EVENTS,
    '*',
    'nudgeId', nudgeId,
    'userId', userId,
    'event', event,
    'metadata', JSON.stringify(metadata || {}),
    'timestamp', String(Date.now())
  );

  console.log(`[Stream] Published nudge event ${event} for nudge ${nudgeId}`);
  return messageId || '';
}

/**
 * Publish analytics event
 */
export async function publishAnalyticsEvent(
  metric: string,
  value: number,
  labels?: Record<string, string>
): Promise<string> {
  const messageId = await publisher.xadd(
    STREAM_KEYS.ANALYTICS,
    '*',
    'metric', metric,
    'value', String(value),
    'labels', JSON.stringify(labels || {}),
    'timestamp', String(Date.now())
  );

  return messageId || '';
}

/**
 * Initialize consumer group for stream processing
 * Creates the group if it doesn't exist
 */
export async function initializeConsumerGroup(stream: string): Promise<void> {
  try {
    await redis.xgroup('CREATE', stream, CONSUMER_GROUP, '0', 'MKSTREAM');
    console.log(`[Stream] Created consumer group '${CONSUMER_GROUP}' for stream '${stream}'`);
  } catch (error: any) {
    if (error.message?.includes('BUSYGROUP')) {
      console.log(`[Stream] Consumer group '${CONSUMER_GROUP}' already exists for stream '${stream}'`);
    } else {
      throw error;
    }
  }
}

/**
 * Read pending messages from stream
 * Used for recovery after crashes
 */
export async function readPendingMessages(
  stream: string,
  count: number = 10
): Promise<Array<{ id: string; event: IntentEvent }>> {
  try {
    // First, claim old pending messages
    const pending = await redis.xreadgroup(
      'GROUP', CONSUMER_GROUP, CONSUMER_NAME,
      'STREAMS', stream,
      '0', // Read pending messages
      'COUNT', String(count)
    );

    if (!pending) return [];

    const messages: Array<{ id: string; event: IntentEvent }> = [];
    const [, entries] = pending[0];

    for (const [id, fields] of entries) {
      const dataField = fields.find((_, i) => i % 2 === 0 && fields[i] === 'data');
      if (dataField !== undefined) {
        const dataIndex = fields.indexOf(dataField);
        const event = JSON.parse(fields[dataIndex + 1]);
        messages.push({ id, event });
      }
    }

    return messages;
  } catch (error) {
    console.error(`[Stream] Failed to read pending messages from ${stream}:`, error);
    return [];
  }
}

/**
 * Process new messages from stream
 * Blocks for timeoutMs if no messages available
 */
export async function readNewMessages(
  stream: string,
  count: number = 10,
  timeoutMs: number = 5000
): Promise<Array<{ id: string; event: IntentEvent }>> {
  try {
    const result = await redis.xreadgroup(
      'GROUP', CONSUMER_GROUP, CONSUMER_NAME,
      'COUNT', String(count),
      'BLOCK', String(timeoutMs),
      'STREAMS', stream,
      '>'
    );

    if (!result) return [];

    const messages: Array<{ id: string; event: IntentEvent }> = [];
    const [, entries] = result[0];

    for (const [id, fields] of entries) {
      const dataField = fields.find((_, i) => i % 2 === 0 && fields[i] === 'data');
      if (dataField !== undefined) {
        const dataIndex = fields.indexOf(dataField);
        const event = JSON.parse(fields[dataIndex + 1]);
        messages.push({ id, event });
      }
    }

    return messages;
  } catch (error) {
    console.error(`[Stream] Failed to read messages from ${stream}:`, error);
    return [];
  }
}

/**
 * Acknowledge processed messages
 */
export async function acknowledgeMessages(stream: string, messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return;

  try {
    await redis.xack(stream, CONSUMER_GROUP, ...messageIds);
    console.log(`[Stream] Acknowledged ${messageIds.length} messages from ${stream}`);
  } catch (error) {
    console.error(`[Stream] Failed to acknowledge messages:`, error);
  }
}

/**
 * Get stream info (length, consumer group status)
 */
export async function getStreamInfo(stream: string): Promise<Record<string, any>> {
  try {
    const info = await redis.xinfo('GROUPS', stream);
    const length = await redis.xlen(stream);

    return {
      length,
      consumerGroups: info,
    };
  } catch (error) {
    console.error(`[Stream] Failed to get stream info for ${stream}:`, error);
    return { length: 0, consumerGroups: [] };
  }
}

/**
 * Health check for streams
 */
export async function checkStreamHealth(): Promise<boolean> {
  try {
    await publisher.ping();
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

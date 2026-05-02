/**
 * Event Platform Integration for ReZ Mind
 *
 * Consumes events from rez-event-platform BullMQ queues and forwards
 * relevant events to the internal event bus for AI processing.
 *
 * Events consumed:
 * - order.completed: Triggers personalization and revenue attribution
 * - conversion: Triggers dormant user analysis and re-engagement
 * - ad.impression, ad.click: Updates user intent signals
 * - notification.sent, notification.opened: Triggers engagement analysis
 */

import { Redis as IORedis } from 'ioredis';
import { redis } from '../config/redis.js';

const logger = {
  info: (msg: string, meta?: Record<string, unknown>) =>
    console.log(`[EventPlatform] ${msg}`, meta || ''),
  warn: (msg: string, meta?: Record<string, unknown>) =>
    console.warn(`[EventPlatform] ${msg}`, meta || ''),
  error: (msg: string, meta?: Record<string, unknown>) =>
    console.error(`[EventPlatform] ${msg}`, meta || ''),
};

interface EventPlatformEvent {
  id: string;
  type: string;
  timestamp: string;
  correlationId?: string;
  source: string;
  payload: Record<string, unknown>;
}

// Event type mappings to internal event bus
const EVENT_TYPE_MAP: Record<string, string> = {
  'order.completed': 'commerce.order_completed',
  'conversion': 'commerce.conversion',
  'ad.impression': 'ads.impression',
  'ad.click': 'ads.click',
  'notification.sent': 'engagement.notification_sent',
  'notification.opened': 'engagement.notification_opened',
};

// Import the internal emitEvent function
import { emitEvent } from '../eventBus.js';

/**
 * Process and forward event to internal bus
 */
async function processEvent(event: EventPlatformEvent): Promise<void> {
  const internalEventType = EVENT_TYPE_MAP[event.type];

  if (!internalEventType) {
    logger.info(`Skipping unhandled event type: ${event.type}`);
    return;
  }

  logger.info(`Processing event: ${event.type} -> ${internalEventType}`, {
    eventId: event.id,
    source: event.source,
  });

  try {
    await emitEvent(internalEventType, {
      ...event.payload,
      _source: 'event-platform',
      _eventId: event.id,
      _timestamp: event.timestamp,
      _correlationId: event.correlationId,
    });

    logger.info(`Event forwarded: ${internalEventType}`, { eventId: event.id });
  } catch (error) {
    logger.error(`Failed to forward event: ${event.type}`, { error });
    throw error;
  }
}

// Track last processed job ID per queue
const lastProcessedIds = new Map<string, string | null>();

/**
 * Poll an event queue for new jobs
 */
async function pollQueue(queueName: string): Promise<void> {
  try {
    // Get waiting jobs from BullMQ queue
    // BullMQ stores jobs in sorted sets and lists
    const queueKey = `bullmq:queuing:${queueName}`;
    const jobs = await redis.lrange(queueKey, 0, 9);

    for (const jobData of jobs) {
      try {
        const job = JSON.parse(jobData);
        const lastId = lastProcessedIds.get(queueName);

        if (job.id !== lastId && job.data?.event) {
          await processEvent(job.data.event as EventPlatformEvent);
          lastProcessedIds.set(queueName, job.id);
        }
      } catch {
        // Skip malformed job data
      }
    }
  } catch (error) {
    logger.error(`Polling error for ${queueName}:`, { error });
  }
}

/**
 * Subscribe to event queues
 */
async function subscribeToQueues(): Promise<void> {
  const queues = [
    'events-order-completed',
    'events-conversion',
    'events-ad-impression',
    'events-ad-click',
    'events-notification-sent',
    'events-notification-opened',
  ];

  logger.info('Starting event queue polling...');

  // Poll every 5 seconds
  setInterval(async () => {
    await Promise.all(queues.map(pollQueue));
  }, 5000);

  // Initial poll
  await Promise.all(queues.map(pollQueue));

  logger.info('Event queue polling started', { queues });
}

/**
 * Initialize event platform integration
 */
export async function initializeEventPlatformIntegration(): Promise<void> {
  logger.info('Initializing event platform integration...');

  await subscribeToQueues();

  logger.info('Event platform integration initialized');
}

// Auto-initialize
let initialized = false;
export function ensureInitialized(): void {
  if (!initialized && process.env.EVENT_PLATFORM_ENABLED !== 'false') {
    initialized = true;
    initializeEventPlatformIntegration().catch((error) => {
      logger.error('Failed to initialize event platform integration:', { error });
    });
  }
}

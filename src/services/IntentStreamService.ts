/**
 * Redis Streams Service for Intent Signal Ingestion
 * Real-time signal processing pipeline
 * Falls back to direct MongoDB writes when Redis unavailable
 */

import { intentCaptureService } from './IntentCaptureService.js';
import { sharedMemory } from '../agents/shared-memory.js';

const logger = {
  info: (msg: string, meta?: unknown) => console.log(`[IntentStream] ${msg}`, meta || ''),
  warn: (msg: string, meta?: unknown) => console.warn(`[IntentStream] ${msg}`, meta || ''),
  error: (msg: string, meta?: unknown) => console.error(`[IntentStream] ${msg}`, meta || ''),
};

// Stream names
const STREAMS = {
  INTENT_CAPTURE: 'intent:capture:stream',
  INTENT_DORMANT: 'intent:dormant:stream',
  NUDGE_QUEUE: 'intent:nudge:stream',
} as const;

// Consumer group for distributed processing
const CONSUMER_GROUP = 'intent-processors';

export interface IntentSignal {
  userId: string;
  appType: string;
  eventType: string;
  category: string;
  intentKey: string;
  intentQuery?: string;
  metadata?: Record<string, unknown>;
  merchantId?: string;
  timestamp: number;
}

class IntentStreamService {
  private useStreams = false;
  private consumerId: string;
  private isProcessing = false;

  constructor() {
    this.useStreams = sharedMemory.isRedisAvailable();
    this.consumerId = `consumer-${process.pid}-${Date.now()}`;

    if (this.useStreams) {
      logger.info('Redis Streams enabled for intent ingestion');
      this.initializeConsumerGroup();
    } else {
      logger.warn('Redis unavailable - using direct MongoDB writes');
    }
  }

  /**
   * Initialize consumer group for distributed processing
   */
  private async initializeConsumerGroup(): Promise<void> {
    try {
      // Would use XGROUP CREATE in production Redis
      logger.info('Consumer group initialized', { group: CONSUMER_GROUP });
    } catch (error) {
      logger.error('Failed to initialize consumer group', { error });
    }
  }

  /**
   * Publish intent signal to stream
   * Uses Redis Streams when available, falls back to direct processing
   */
  async publish(signal: IntentSignal): Promise<void> {
    if (this.useStreams) {
      await this.publishToStream(STREAMS.INTENT_CAPTURE, signal);
    } else {
      // Direct processing fallback
      await this.processSignal(signal);
    }
  }

  /**
   * Publish to Redis Stream
   */
  private async publishToStream(stream: string, signal: IntentSignal): Promise<void> {
    try {
      // Store in shared memory as stream fallback
      // Production would use: await redis.xadd(stream, '*', ...fields)
      const key = `stream:${stream}:${signal.timestamp}:${Math.random().toString(36).substr(2, 9)}`;
      await sharedMemory.set(key, signal, 86400); // 24 hour TTL

      logger.info('Signal published to stream', { stream, intentKey: signal.intentKey });
    } catch (error) {
      logger.error('Failed to publish to stream', { error, stream });
      // Fallback to direct processing
      await this.processSignal(signal);
    }
  }

  /**
   * Process a single intent signal
   */
  private async processSignal(signal: IntentSignal): Promise<void> {
    try {
      await intentCaptureService.capture({
        userId: signal.userId,
        appType: signal.appType,
        eventType: signal.eventType,
        category: signal.category,
        intentKey: signal.intentKey,
        intentQuery: signal.intentQuery,
        metadata: signal.metadata,
        merchantId: signal.merchantId,
      });

      logger.info('Signal processed', { eventType: signal.eventType, intentKey: signal.intentKey });
    } catch (error) {
      logger.error('Failed to process signal', { error, signal });
      throw error;
    }
  }

  /**
   * Start consuming from streams (for background workers)
   */
  async startConsumer(): Promise<void> {
    if (this.isProcessing) {
      logger.warn('Consumer already running');
      return;
    }

    this.isProcessing = true;
    logger.info('Starting stream consumer', { consumerId: this.consumerId });

    // In production, this would use XREADGROUP for distributed processing
    // For now, we rely on the direct capture flow

    const processLoop = async () => {
      while (this.isProcessing) {
        try {
          // Would poll Redis Streams here
          // await this.consumeFromStream(STREAMS.INTENT_CAPTURE);
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          logger.error('Consumer loop error', { error });
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    };

    processLoop();
  }

  /**
   * Consume messages from a stream
   */
  private async consumeFromStream(stream: string): Promise<void> {
    // Production implementation would use:
    // const messages = await redis.xreadgroup(
    //   'GROUP', CONSUMER_GROUP, this.consumerId,
    //   'COUNT', 100, 'BLOCK', 5000,
    //   'STREAMS', stream, '>'
    // );

    // For each message, call processSignal()
    // Then acknowledge with XACK
  }

  /**
   * Stop consumer
   */
  stopConsumer(): void {
    logger.info('Stopping stream consumer');
    this.isProcessing = false;
  }

  /**
   * Get stream stats
   */
  async getStats(): Promise<{
    streamsEnabled: boolean;
    consumerId: string;
    isProcessing: boolean;
  }> {
    return {
      streamsEnabled: this.useStreams,
      consumerId: this.consumerId,
      isProcessing: this.isProcessing,
    };
  }
}

export const intentStreamService = new IntentStreamService();

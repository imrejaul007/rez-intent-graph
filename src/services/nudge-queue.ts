// ── Nudge Queue Service ─────────────────────────────────────────────────────────
// Message queue integration for dormant intent revival nudges
// DANGEROUS: Enables automatic nudge delivery with skip-permission

import { sharedMemory } from '../agents/shared-memory.js';

const logger = {
  info: (msg: string, meta?: unknown) => console.log(`[NudgeQueue] ${msg}`, meta || ''),
  warn: (msg: string, meta?: unknown) => console.warn(`[NudgeQueue] ${msg}`, meta || ''),
  error: (msg: string, meta?: unknown) => console.error(`[NudgeQueue] ${msg}`, meta || ''),
};

// Queue names
const QUEUES = {
  NUDGE_REVIVAL: 'nudge:revival:queue',
  NUDGE_PRIORITY: 'nudge:priority:queue',
  NUDGE_BULK: 'nudge:bulk:queue',
  NUDGE_DEAD_LETTER: 'nudge:dead_letter:queue',
} as const;

// Queue item structure
interface NudgeJob {
  id: string;
  type: 'intent_revival_nudge' | 'price_drop_nudge' | 'seasonality_nudge' | 'manual_nudge';
  payload: {
    dormantIntentId: string;
    userId: string;
    intentKey: string;
    category: string;
    appType: string;
    message: string;
    revivalScore: number;
    channel: 'push' | 'email' | 'sms' | 'in_app';
    scheduledFor?: string;
  };
  metadata: {
    createdAt: string;
    retries: number;
    maxRetries: number;
    priority: 'low' | 'medium' | 'high' | 'critical';
  };
}

class NudgeQueueService {
  private redisAvailable = false;

  constructor() {
    // Check if Redis is available
    this.redisAvailable = sharedMemory.isRedisAvailable();
    if (!this.redisAvailable) {
      logger.warn('Redis not available, using in-memory queue fallback');
    }
  }

  /**
   * Enqueue a nudge job
   */
  async enqueue(job: NudgeJob): Promise<{ success: boolean; queuePosition?: number }> {
    const queueName = this.getQueueForPriority(job.metadata.priority);

    if (this.redisAvailable) {
      return this.enqueueRedis(queueName, job);
    }

    return this.enqueueMemory(queueName, job);
  }

  /**
   * Enqueue to Redis (production)
   */
  private async enqueueRedis(queueName: string, job: NudgeJob): Promise<{ success: boolean; queuePosition?: number }> {
    try {
      // In production, this would use actual Redis
      // For now, store in shared memory
      await sharedMemory.set(
        `${queueName}:${job.id}`,
        job,
        86400 // 24 hours
      );

      logger.info('Nudge job enqueued to Redis', { jobId: job.id, queue: queueName });
      return { success: true };
    } catch (error) {
      logger.error('Failed to enqueue to Redis', { error, jobId: job.id });
      return this.enqueueMemory(queueName, job);
    }
  }

  /**
   * Enqueue to in-memory queue (fallback)
   */
  private async enqueueMemory(queueName: string, job: NudgeJob): Promise<{ success: boolean; queuePosition?: number }> {
    try {
      await sharedMemory.set(
        `${queueName}:${job.id}`,
        job,
        86400
      );

      // Track queue order
      const queueKey = `${queueName}:order`;
      const order = await sharedMemory.get<string[]>(queueKey) || [];
      order.push(job.id);
      await sharedMemory.set(queueKey, order, 86400);

      logger.info('Nudge job enqueued to memory', { jobId: job.id, queue: queueName });
      return { success: true, queuePosition: order.length };
    } catch (error) {
      logger.error('Failed to enqueue to memory', { error, jobId: job.id });
      return { success: false };
    }
  }

  /**
   * Dequeue next job from queue
   */
  async dequeue(priority: 'low' | 'medium' | 'high' | 'critical' = 'medium'): Promise<NudgeJob | null> {
    const queueName = this.getQueueForPriority(priority);

    if (this.redisAvailable) {
      return this.dequeueRedis(queueName);
    }

    return this.dequeueMemory(queueName);
  }

  private async dequeueRedis(queueName: string): Promise<NudgeJob | null> {
    // In production: BRPOPLPUSH for reliable queue
    return this.dequeueMemory(queueName);
  }

  private async dequeueMemory(queueName: string): Promise<NudgeJob | null> {
    const queueKey = `${queueName}:order`;
    const order = await sharedMemory.get<string[]>(queueKey) || [];

    if (order.length === 0) return null;

    const jobId = order.shift();
    await sharedMemory.set(queueKey, order, 86400);

    if (!jobId) return null;

    const job = await sharedMemory.get<NudgeJob>(`${queueName}:${jobId}`);
    if (job) {
      await sharedMemory.delete(`${queueName}:${jobId}`);
    }

    return job || null;
  }

  /**
   * Get queue length
   */
  async getQueueLength(priority?: 'low' | 'medium' | 'high' | 'critical'): Promise<number> {
    if (priority) {
      return this.getQueueLengthForPriority(priority);
    }

    let total = 0;
    for (const p of ['low', 'medium', 'high', 'critical'] as const) {
      total += await this.getQueueLengthForPriority(p);
    }
    return total;
  }

  private async getQueueLengthForPriority(priority: string): Promise<number> {
    const queueName = this.getQueueForPriority(priority as any);
    const order = await sharedMemory.get<string[]>(`${queueName}:order`) || [];
    return order.length;
  }

  /**
   * Move failed job to dead letter queue
   */
  async moveToDeadLetter(job: NudgeJob, reason: string): Promise<void> {
    const dlqJob = {
      ...job,
      metadata: {
        ...job.metadata,
        retries: job.metadata.retries + 1,
      },
      error: reason,
      failedAt: new Date().toISOString(),
    };

    await sharedMemory.set(
      `${QUEUES.NUDGE_DEAD_LETTER}:${job.id}`,
      dlqJob,
      604800 // 7 days
    );

    logger.warn('Job moved to dead letter queue', { jobId: job.id, reason });
  }

  /**
   * Bulk enqueue multiple jobs
   */
  async bulkEnqueue(jobs: NudgeJob[]): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;

    for (const job of jobs) {
      const result = await this.enqueue(job);
      if (result.success) {
        success++;
      } else {
        failed++;
      }
    }

    logger.info('Bulk enqueue complete', { success, failed, total: jobs.length });
    return { success, failed };
  }

  /**
   * Get queue statistics
   */
  async getStats(): Promise<{
    total: number;
    byPriority: Record<string, number>;
    deadLetter: number;
  }> {
    const byPriority: Record<string, number> = {};
    for (const p of ['low', 'medium', 'high', 'critical'] as const) {
      byPriority[p] = await this.getQueueLengthForPriority(p);
    }

    const dlqOrder = await sharedMemory.get<string[]>(`${QUEUES.NUDGE_DEAD_LETTER}:order`) || [];

    return {
      total: Object.values(byPriority).reduce((a, b) => a + b, 0),
      byPriority,
      deadLetter: dlqOrder.length,
    };
  }

  private getQueueForPriority(priority: 'low' | 'medium' | 'high' | 'critical'): string {
    switch (priority) {
      case 'critical':
        return QUEUES.NUDGE_PRIORITY;
      case 'high':
        return QUEUES.NUDGE_PRIORITY;
      default:
        return QUEUES.NUDGE_REVIVAL;
    }
  }
}

// Singleton
export const nudgeQueue = new NudgeQueueService();

// Helper to create nudge job
export function createNudgeJob(params: {
  dormantIntentId: string;
  userId: string;
  intentKey: string;
  category: string;
  appType: string;
  message: string;
  revivalScore: number;
  channel?: 'push' | 'email' | 'sms' | 'in_app';
  triggerType?: 'intent_revival_nudge' | 'price_drop_nudge' | 'seasonality_nudge' | 'manual_nudge';
  priority?: 'low' | 'medium' | 'high' | 'critical';
}): NudgeJob {
  const priority = params.priority || (params.revivalScore > 0.7 ? 'high' : 'medium');

  return {
    id: `nudge_${params.dormantIntentId}_${Date.now()}`,
    type: params.triggerType || 'intent_revival_nudge',
    payload: {
      dormantIntentId: params.dormantIntentId,
      userId: params.userId,
      intentKey: params.intentKey,
      category: params.category,
      appType: params.appType,
      message: params.message,
      revivalScore: params.revivalScore,
      channel: params.channel || 'push',
    },
    metadata: {
      createdAt: new Date().toISOString(),
      retries: 0,
      maxRetries: 3,
      priority,
    },
  };
}

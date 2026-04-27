// ── Dormant Intent Cron Job ───────────────────────────────────────────────────
// Daily job to detect dormant intents and schedule revival nudges
// DANGEROUS: Automatically triggers nudge delivery with skip-permission

import { dormantIntentService } from '../services/DormantIntentService.js';
import { intentScoringService } from '../services/IntentScoringService.js';
import { nudgeQueue, createNudgeJob } from '../services/nudge-queue.js';

export class DormantIntentCronJob {
  private isRunning = false;
  private lastRunAt?: Date;
  private intervalMs = 24 * 60 * 60 * 1000; // Daily

  /**
   * Run the dormant intent detection job
   */
  async run(): Promise<{
    detectedDormant: number;
    updatedRevivals: number;
    scheduledNudges: number;
  }> {
    if (this.isRunning) {
      console.log('[DormantIntentCron] Job already running, skipping...');
      return { detectedDormant: 0, updatedRevivals: 0, scheduledNudges: 0 };
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      console.log('[DormantIntentCron] Starting dormant intent detection...');

      // Step 1: Detect and mark new dormant intents
      const { processed, markedDormant } = await dormantIntentService.detectAndMarkDormant();
      console.log(`[DormantIntentCron] Processed ${processed} intents, marked ${markedDormant} as dormant`);

      // Step 2: Update revival scores
      const updatedRevivals = await dormantIntentService.updateRevivalScores();
      console.log(`[DormantIntentCron] Updated ${updatedRevivals} revival scores`);

      // Step 3: Get scheduled revivals and queue nudge jobs
      const scheduledNudges = await this.queueScheduledNudges();
      console.log(`[DormantIntentCron] Queued ${scheduledNudges} nudge jobs`);

      // Log queue stats
      const stats = await nudgeQueue.getStats();
      console.log(`[DormantIntentCron] Queue stats: ${stats.total} jobs total`);

      this.lastRunAt = new Date();
      const duration = Date.now() - startTime;

      console.log(`[DormantIntentCron] Completed in ${duration}ms`);

      return { detectedDormant: markedDormant, updatedRevivals, scheduledNudges };
    } catch (error) {
      console.error('[DormantIntentCron] Job failed:', error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Queue scheduled nudge jobs using the nudge queue service
   */
  private async queueScheduledNudges(): Promise<number> {
    const candidates = await dormantIntentService.getScheduledRevivals();
    let queued = 0;

    for (const candidate of candidates) {
      // Check if nudge should be sent (revival score threshold)
      if (candidate.revivalScore >= 0.3) {
        // Create nudge job with proper structure
        const nudgeJob = createNudgeJob({
          dormantIntentId: candidate.dormantIntent.id,
          userId: candidate.dormantIntent.userId,
          intentKey: candidate.dormantIntent.intentKey,
          category: String(candidate.dormantIntent.category),
          appType: String(candidate.dormantIntent.appType),
          message: candidate.suggestedNudge || `We noticed you were interested in ${candidate.dormantIntent.intentKey}`,
          revivalScore: candidate.revivalScore,
          channel: 'push',
          triggerType: 'intent_revival_nudge',
          priority: candidate.revivalScore > 0.7 ? 'high' : 'medium',
        });

        // Enqueue to message queue
        const result = await nudgeQueue.enqueue(nudgeJob);

        if (result.success) {
          await dormantIntentService.recordNudgeSent(candidate.dormantIntent.id);
          queued++;
          console.log(`[DormantIntentCron] Enqueued nudge for user ${candidate.dormantIntent.userId}, intent: ${candidate.dormantIntent.intentKey}`);
        }
      }
    }

    return queued;
  }

  /**
   * Start the cron job scheduler
   */
  start(): void {
    // Run immediately on start
    this.run().catch(console.error);

    // Then run on interval
    setInterval(() => {
      this.run().catch(console.error);
    }, this.intervalMs);

    console.log(`[DormantIntentCron] Started with ${this.intervalMs / 1000 / 60 / 60}h interval`);
  }

  /**
   * Get job status
   */
  getStatus(): {
    isRunning: boolean;
    lastRunAt?: Date;
    intervalMs: number;
  } {
    return {
      isRunning: this.isRunning,
      lastRunAt: this.lastRunAt,
      intervalMs: this.intervalMs,
    };
  }
}

// Singleton instance
export const dormantIntentCronJob = new DormantIntentCronJob();

// ── CLI Runner ────────────────────────────────────────────────────────────────

const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  console.log('[DormantIntentCron] Running as standalone job...');
  dormantIntentCronJob.run()
    .then((result) => {
      console.log('[DormantIntentCron] Result:', result);
      process.exit(0);
    })
    .catch((error) => {
      console.error('[DormantIntentCron] Failed:', error);
      process.exit(1);
    });
}

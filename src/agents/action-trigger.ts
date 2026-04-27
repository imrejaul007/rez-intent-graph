// ── Agent Action Triggers ────────────────────────────────────────────────────────
// Autonomous agent actions that skip permissions
// DANGEROUS: These actions execute automatically without user confirmation

import { sharedMemory } from './shared-memory.js';
import type { DemandSignal, ScarcitySignal, OptimizationRecommendation, RevenueReport } from './types.js';
import { intentCaptureService } from '../services/IntentCaptureService.js';
import { dormantIntentService } from '../services/DormantIntentService.js';
import { nudgeDeliveryService } from '../nudge/NudgeDeliveryService.js';
import { getSwarmCoordinator } from './swarm-coordinator.js';

const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => console.log(`[ActionTrigger] ${msg}`, meta || ''),
  warn: (msg: string, meta?: Record<string, unknown>) => console.warn(`[ActionTrigger] ${msg}`, meta || ''),
  error: (msg: string, meta?: Record<string, unknown>) => console.error(`[ActionTrigger] ${msg}`, meta || ''),
};

// ── Action Circuit Breaker ───────────────────────────────────────────────────────

interface ActionCircuitBreaker {
  failures: number;
  lastFailure: number;
  status: 'closed' | 'open' | 'half-open';
}

const actionCircuitBreakers = new Map<string, ActionCircuitBreaker>();

const ACTION_CIRCUIT_BREAKER = {
  failureThreshold: 10,    // Open after 10 failures
  resetTimeoutMs: 300000,  // 5 minutes
};

function canExecuteAction(actionType: string): boolean {
  const cb = actionCircuitBreakers.get(actionType) || { failures: 0, lastFailure: 0, status: 'closed' as const };

  if (cb.status === 'closed') return true;

  if (cb.status === 'open') {
    const timeSinceFailure = Date.now() - cb.lastFailure;
    if (timeSinceFailure >= ACTION_CIRCUIT_BREAKER.resetTimeoutMs) {
      cb.status = 'half-open';
      return true;
    }
    return false;
  }

  return true;
}

function recordActionFailure(actionType: string): void {
  let cb = actionCircuitBreakers.get(actionType);
  if (!cb) {
    cb = { failures: 0, lastFailure: 0, status: 'closed' as const };
    actionCircuitBreakers.set(actionType, cb);
  }

  cb.failures++;
  cb.lastFailure = Date.now();

  if (cb.failures >= ACTION_CIRCUIT_BREAKER.failureThreshold) {
    cb.status = 'open';
    logger.error(`[ActionCircuitBreaker] Circuit OPEN for ${actionType}`);
  }
}

function recordActionSuccess(actionType: string): void {
  const cb = actionCircuitBreakers.get(actionType);
  if (cb) {
    cb.failures = 0;
    cb.status = 'closed';
  }
}

// ── Action Types ────────────────────────────────────────────────────────────────

export type ActionType =
  | 'send_nudge'
  | 'send_urgency_nudge'
  | 'update_merchant_dashboard'
  | 'adjust_price'
  | 'pause_strategy'
  | 'alert_support'
  | 'trigger_revival'
  | 'pause_nudge_campaign'
  | 'reallocate_budget'
  | 'retrain_model'
  | 'threshold_adjust'
  // ── Payment Actions ─────────────────────────────────────────────────
  | 'charge_wallet'
  | 'refund_wallet'
  | 'send_to_pms'
  | 'send_to_merchant_os'
  | 'route_to_task_queue'
  | 'update_order_status'
  | 'send_staff_notification';

export interface Action {
  type: ActionType;
  target: string;
  payload: unknown;
  agent: string;
  skipPermission: boolean;
  risk: 'low' | 'medium' | 'high' | 'critical';
  executedAt?: Date;
  success?: boolean;
}

// ── Safety Thresholds ────────────────────────────────────────────────────────────

const THRESHOLDS = {
  demandSpike: 3.0, // 3x baseline
  scarcityCritical: 85,
  scarcityHigh: 70,
  conversionRateMin: 0.01,
  revenueDropAlert: 0.2,
  nudgeLimitPerUser: 5, // Max nudges per user per day
};

// ── Action Executor ─────────────────────────────────────────────────────────────

class ActionExecutor {
  private actionHistory: Action[] = [];
  private dailyNudgeCounts = new Map<string, number>();

  async execute(action: Action): Promise<boolean> {
    const startTime = Date.now();

    // Check dangerous mode and circuit breakers
    const swarm = getSwarmCoordinator();

    // Block if emergency stop
    if (swarm.getDangerousMode().emergencyStop) {
      logger.error('[ActionExecutor] BLOCKED: Emergency stop active');
      return false;
    }

    // For skipPermission actions, check dangerous mode
    if (action.skipPermission && !swarm.getDangerousMode().enabled) {
      logger.warn('[ActionExecutor] BLOCKED: Dangerous mode not enabled for skipPermission action');
      return false;
    }

    // Check action-specific circuit breaker
    if (!canExecuteAction(action.type)) {
      logger.error('[ActionExecutor] BLOCKED: Circuit breaker open for', { actionType: action.type });
      return false;
    }

    logger.info('[ActionExecutor] Executing action', { type: action.type, risk: action.risk, skipPermission: action.skipPermission });

    try {
      let success = false;

      switch (action.type) {
        case 'send_nudge':
          success = await this.sendNudge(action);
          break;
        case 'send_urgency_nudge':
          success = await this.sendUrgencyNudge(action);
          break;
        case 'update_merchant_dashboard':
          success = await this.updateMerchantDashboard(action);
          break;
        case 'adjust_price':
          success = await this.adjustPrice(action);
          break;
        case 'pause_strategy':
          success = await this.pauseStrategy(action);
          break;
        case 'alert_support':
          success = await this.alertSupport(action);
          break;
        case 'trigger_revival':
          success = await this.triggerRevival(action);
          break;
        case 'pause_nudge_campaign':
          success = await this.pauseNudgeCampaign(action);
          break;
        case 'reallocate_budget':
          success = await this.reallocateBudget(action);
          break;
        case 'retrain_model':
          success = await this.retrainModel(action);
          break;
        // ── Payment & System Actions ─────────────────────────────────────────
        case 'charge_wallet':
          success = await this.chargeWallet(action);
          break;
        case 'refund_wallet':
          success = await this.refundWallet(action);
          break;
        case 'send_to_pms':
          success = await this.sendToPMS(action);
          break;
        case 'send_to_merchant_os':
          success = await this.sendToMerchantOS(action);
          break;
        case 'route_to_task_queue':
          success = await this.routeToTaskQueue(action);
          break;
        case 'update_order_status':
          success = await this.updateOrderStatus(action);
          break;
        case 'send_staff_notification':
          success = await this.sendStaffNotification(action);
          break;
        default:
          logger.warn('[ActionExecutor] Unknown action type', { type: action.type });
      }

      // Record action
      action.executedAt = new Date();
      action.success = success;
      this.actionHistory.push(action);

      logger.info('[ActionExecutor] Action completed', {
        type: action.type,
        success,
        duration: Date.now() - startTime,
      });

      return success;
    } catch (error) {
      logger.error('[ActionExecutor] Action failed', { type: action.type, error });
      action.executedAt = new Date();
      action.success = false;
      this.actionHistory.push(action);
      return false;
    }
  }

  // ── Send Nudge ────────────────────────────────────────────────────────────

  private async sendNudge(action: Action): Promise<boolean> {
    const payload = action.payload as {
      userId: string;
      intentKey: string;
      message: string;
      channel: string;
    };

    // Check daily limit
    const dailyCount = this.dailyNudgeCounts.get(payload.userId) || 0;
    if (dailyCount >= THRESHOLDS.nudgeLimitPerUser) {
      logger.warn('[ActionExecutor] Nudge limit reached', { userId: payload.userId, count: dailyCount });
      return false;
    }

    // Send nudge (dangerously skips permission)
    try {
      await nudgeDeliveryService.send({
        userId: payload.userId,
        intentKey: payload.intentKey,
        message: payload.message,
        channel: payload.channel as 'push' | 'email' | 'sms' | 'in_app',
        template: 'revival_reminder',
      });

      // Update daily count
      this.dailyNudgeCounts.set(payload.userId, dailyCount + 1);

      logger.info('[ActionExecutor] Nudge sent (dangerously)', {
        userId: payload.userId,
        intentKey: payload.intentKey,
      });

      return true;
    } catch (error) {
      logger.error('[ActionExecutor] Nudge send failed', { error, payload });
      return false;
    }
  }

  // ── Send Urgency Nudge ─────────────────────────────────────────────────────

  private async sendUrgencyNudge(action: Action): Promise<boolean> {
    const payload = action.payload as {
      userId: string;
      merchantId: string;
      message: string;
      urgency: number;
    };

    // Only send for high urgency
    if (payload.urgency < THRESHOLDS.scarcityHigh) {
      logger.info('[ActionExecutor] Urgency below threshold', { urgency: payload.urgency });
      return false;
    }

    return this.sendNudge({
      ...action,
      payload: {
        userId: payload.userId,
        intentKey: `scarcity_${payload.merchantId}`,
        message: payload.message,
        channel: 'push',
      },
    });
  }

  // ── Update Merchant Dashboard ───────────────────────────────────────────────

  private async updateMerchantDashboard(action: Action): Promise<boolean> {
    const payload = action.payload as {
      merchantId: string;
      signal: DemandSignal | ScarcitySignal;
    };

    // Publish to shared memory for dashboard to consume
    await sharedMemory.publish({
      from: 'agent-system',
      to: 'merchant-dashboard',
      type: 'signal',
      payload: {
        type: 'dashboard_update',
        merchantId: payload.merchantId,
        signal: payload.signal,
      },
      timestamp: new Date(),
    });

    logger.info('[ActionExecutor] Merchant dashboard updated', { merchantId: payload.merchantId });
    return true;
  }

  // ── Adjust Price ──────────────────────────────────────────────────────────

  private async adjustPrice(action: Action): Promise<boolean> {
    const payload = action.payload as {
      merchantId: string;
      productId: string;
      adjustment: number; // percentage
      direction: 'up' | 'down';
    };

    // DANGEROUS: This auto-adjusts prices
    // Only allow adjustments up to 10%
    const maxAdjustment = Math.abs(payload.adjustment);
    if (maxAdjustment > 10) {
      logger.warn('[ActionExecutor] Price adjustment exceeds limit', {
        adjustment: payload.adjustment,
        limit: 10,
      });
      return false;
    }

    // Publish price adjustment event
    await sharedMemory.publish({
      from: 'agent-system',
      to: 'pricing-service',
      type: 'signal',
      payload: {
        type: 'price_adjustment',
        merchantId: payload.merchantId,
        productId: payload.productId,
        adjustment: payload.adjustment,
        direction: payload.direction,
        reason: 'demand_signal',
      },
      timestamp: new Date(),
    });

    logger.info('[ActionExecutor] Price adjustment triggered (dangerously)', {
      merchantId: payload.merchantId,
      adjustment: payload.adjustment,
    });

    return true;
  }

  // ── Pause Strategy ────────────────────────────────────────────────────────

  private async pauseStrategy(action: Action): Promise<boolean> {
    const payload = action.payload as {
      strategyId: string;
      reason: string;
    };

    await sharedMemory.publish({
      from: 'agent-system',
      to: 'nudge-service',
      type: 'signal',
      payload: {
        type: 'pause_strategy',
        strategyId: payload.strategyId,
        reason: payload.reason,
      },
      timestamp: new Date(),
    });

    logger.info('[ActionExecutor] Strategy paused', { strategyId: payload.strategyId });
    return true;
  }

  // ── Alert Support ─────────────────────────────────────────────────────────

  private async alertSupport(action: Action): Promise<boolean> {
    const payload = action.payload as {
      type: 'revenue_drop' | 'anomaly' | 'critical_error';
      severity: 'low' | 'medium' | 'high' | 'critical';
      message: string;
      data?: unknown;
    };

    await sharedMemory.publish({
      from: 'agent-system',
      to: 'support-service',
      type: 'alert',
      payload: {
        alertType: payload.type,
        severity: payload.severity,
        message: payload.message,
        data: payload.data,
        source: 'commerce-memory-agents',
      },
      timestamp: new Date(),
    });

    logger.info('[ActionExecutor] Support alerted', { type: payload.type, severity: payload.severity });
    return true;
  }

  // ── Trigger Revival ───────────────────────────────────────────────────────

  private async triggerRevival(action: Action): Promise<boolean> {
    const payload = action.payload as {
      userId: string;
      dormantIntentId: string;
      nudgeMessage?: string;
    };

    // Check daily limit
    const dailyCount = this.dailyNudgeCounts.get(payload.userId) || 0;
    if (dailyCount >= THRESHOLDS.nudgeLimitPerUser) {
      logger.warn('[ActionExecutor] Revival nudge limit reached');
      return false;
    }

    // Mark as revived and send nudge
    await dormantIntentService.markRevived(payload.dormantIntentId);

    if (payload.nudgeMessage) {
      await this.sendNudge({
        type: 'send_nudge',
        target: payload.userId,
        payload: {
          userId: payload.userId,
          intentKey: payload.dormantIntentId,
          message: payload.nudgeMessage,
          channel: 'push',
        },
        agent: 'feedback-loop-agent',
        skipPermission: true,
        risk: 'medium',
      });
    }

    logger.info('[ActionExecutor] Revival triggered (dangerously)', { dormantIntentId: payload.dormantIntentId });
    return true;
  }

  // ── Pause Nudge Campaign ─────────────────────────────────────────────────

  private async pauseNudgeCampaign(action: Action): Promise<boolean> {
    const payload = action.payload as {
      campaignId: string;
      reason: string;
    };

    await sharedMemory.publish({
      from: 'agent-system',
      to: 'nudge-service',
      type: 'signal',
      payload: {
        type: 'pause_campaign',
        campaignId: payload.campaignId,
        reason: payload.reason,
      },
      timestamp: new Date(),
    });

    logger.info('[ActionExecutor] Nudge campaign paused', { campaignId: payload.campaignId });
    return true;
  }

  // ── Reallocate Budget ─────────────────────────────────────────────────────

  private async reallocateBudget(action: Action): Promise<boolean> {
    const payload = action.payload as {
      channel: string;
      newBudget: number;
      reason: string;
    };

    // DANGEROUS: This changes marketing budget allocation
    await sharedMemory.publish({
      from: 'agent-system',
      to: 'marketing-service',
      type: 'signal',
      payload: {
        type: 'budget_reallocation',
        channel: payload.channel,
        newBudget: payload.newBudget,
        reason: payload.reason,
      },
      timestamp: new Date(),
    });

    logger.info('[ActionExecutor] Budget reallocated (dangerously)', { channel: payload.channel, newBudget: payload.newBudget });
    return true;
  }

  // ── Retrain Model ────────────────────────────────────────────────────────

  private async retrainModel(action: Action): Promise<boolean> {
    const { retrainModel } = await import('./adaptive-scoring-agent.js');
    await retrainModel();

    logger.info('[ActionExecutor] ML model retrained');
    return true;
  }

  // ── Charge Wallet ───────────────────────────────────────────────────────

  private async chargeWallet(action: Action): Promise<boolean> {
    const payload = action.payload as {
      userId: string;
      amount: number;
      currency: string;
      description: string;
      orderId?: string;
    };

    logger.info('[ActionExecutor] DANGEROUS: Charging wallet', {
      userId: payload.userId,
      amount: payload.amount,
      description: payload.description,
    });

    // Publish to wallet service
    await sharedMemory.publish({
      from: 'agent-system',
      to: 'wallet-service',
      type: 'transaction',
      payload: {
        type: 'charge',
        userId: payload.userId,
        amount: payload.amount,
        currency: payload.currency,
        description: payload.description,
        orderId: payload.orderId,
      },
      timestamp: new Date(),
    });

    return true;
  }

  // ── Refund Wallet ───────────────────────────────────────────────────────

  private async refundWallet(action: Action): Promise<boolean> {
    const payload = action.payload as {
      userId: string;
      amount: number;
      currency: string;
      reason: string;
      transactionId?: string;
    };

    logger.info('[ActionExecutor] DANGEROUS: Refunding wallet', {
      userId: payload.userId,
      amount: payload.amount,
      reason: payload.reason,
    });

    // Publish to wallet service
    await sharedMemory.publish({
      from: 'agent-system',
      to: 'wallet-service',
      type: 'transaction',
      payload: {
        type: 'refund',
        userId: payload.userId,
        amount: payload.amount,
        currency: payload.currency,
        reason: payload.reason,
        transactionId: payload.transactionId,
      },
      timestamp: new Date(),
    });

    return true;
  }

  // ── Send to PMS ─────────────────────────────────────────────────────────

  private async sendToPMS(action: Action): Promise<boolean> {
    const payload = action.payload as {
      hotelId: string;
      guestId: string;
      requestType: 'room_service' | 'housekeeping' | 'concierge' | 'checkout';
      items: Array<{ name: string; quantity: number; price?: number }>;
      notes?: string;
    };

    logger.info('[ActionExecutor] DANGEROUS: Sending to PMS', {
      hotelId: payload.hotelId,
      guestId: payload.guestId,
      requestType: payload.requestType,
    });

    // Publish to PMS service
    await sharedMemory.publish({
      from: 'agent-system',
      to: 'pms-service',
      type: 'request',
      payload: {
        type: 'guest_request',
        hotelId: payload.hotelId,
        guestId: payload.guestId,
        requestType: payload.requestType,
        items: payload.items,
        notes: payload.notes,
      },
      timestamp: new Date(),
    });

    return true;
  }

  // ── Send to Merchant OS ─────────────────────────────────────────────────

  private async sendToMerchantOS(action: Action): Promise<boolean> {
    const payload = action.payload as {
      merchantId: string;
      orderId: string;
      items: Array<{ productId: string; quantity: number; price: number }>;
      totalAmount: number;
      customerId: string;
    };

    logger.info('[ActionExecutor] DANGEROUS: Sending to Merchant OS', {
      merchantId: payload.merchantId,
      orderId: payload.orderId,
      totalAmount: payload.totalAmount,
    });

    // Publish to Merchant OS
    await sharedMemory.publish({
      from: 'agent-system',
      to: 'merchant-os',
      type: 'order',
      payload: {
        type: 'new_order',
        merchantId: payload.merchantId,
        orderId: payload.orderId,
        items: payload.items,
        totalAmount: payload.totalAmount,
        customerId: payload.customerId,
      },
      timestamp: new Date(),
    });

    return true;
  }

  // ── Route to Task Queue ────────────────────────────────────────────────

  private async routeToTaskQueue(action: Action): Promise<boolean> {
    const payload = action.payload as {
      department: 'housekeeping' | 'concierge' | 'maintenance' | 'kitchen';
      taskType: string;
      priority: 'low' | 'medium' | 'high' | 'urgent';
      description: string;
      assignedTo?: string;
      metadata?: Record<string, unknown>;
    };

    logger.info('[ActionExecutor] DANGEROUS: Routing to task queue', {
      department: payload.department,
      taskType: payload.taskType,
      priority: payload.priority,
    });

    // Publish to task queue
    await sharedMemory.publish({
      from: 'agent-system',
      to: 'task-queue',
      type: 'task',
      payload: {
        department: payload.department,
        taskType: payload.taskType,
        priority: payload.priority,
        description: payload.description,
        assignedTo: payload.assignedTo,
        metadata: payload.metadata,
      },
      timestamp: new Date(),
    });

    return true;
  }

  // ── Update Order Status ────────────────────────────────────────────────

  private async updateOrderStatus(action: Action): Promise<boolean> {
    const payload = action.payload as {
      orderId: string;
      status: 'pending' | 'confirmed' | 'preparing' | 'ready' | 'delivered' | 'cancelled';
      notes?: string;
    };

    logger.info('[ActionExecutor] Updating order status', {
      orderId: payload.orderId,
      status: payload.status,
    });

    // Publish to order service
    await sharedMemory.publish({
      from: 'agent-system',
      to: 'order-service',
      type: 'status_update',
      payload: {
        orderId: payload.orderId,
        status: payload.status,
        notes: payload.notes,
      },
      timestamp: new Date(),
    });

    return true;
  }

  // ── Send Staff Notification ─────────────────────────────────────────────

  private async sendStaffNotification(action: Action): Promise<boolean> {
    const payload = action.payload as {
      staffId?: string;
      department: string;
      title: string;
      message: string;
      priority: 'low' | 'medium' | 'high';
      actionRequired?: string;
    };

    logger.info('[ActionExecutor] Sending staff notification', {
      staffId: payload.staffId,
      department: payload.department,
      title: payload.title,
    });

    // Publish to staff notification service
    await sharedMemory.publish({
      from: 'agent-system',
      to: 'staff-notification-service',
      type: 'notification',
      payload: {
        staffId: payload.staffId,
        department: payload.department,
        title: payload.title,
        message: payload.message,
        priority: payload.priority,
        actionRequired: payload.actionRequired,
      },
      timestamp: new Date(),
    });

    return true;
  }

  // ── Get Action History ────────────────────────────────────────────────────

  getHistory(limit = 100): Action[] {
    return this.actionHistory.slice(-limit);
  }

  // ── Reset Daily Counts ─────────────────────────────────────────────────────

  resetDailyCounts(): void {
    this.dailyNudgeCounts.clear();
  }
}

// Singleton instance
const actionExecutor = new ActionExecutor();

// ── Demand Signal Actions ─────────────────────────────────────────────────────

export async function handleDemandSignalAction(signal: DemandSignal): Promise<void> {
  logger.info('[ActionTrigger] Handling demand signal', { merchantId: signal.merchantId, spike: signal.spikeDetected });

  // Spike detected
  if (signal.spikeDetected && signal.spikeFactor && signal.spikeFactor >= THRESHOLDS.demandSpike) {
    // Update dashboard
    await actionExecutor.execute({
      type: 'update_merchant_dashboard',
      target: signal.merchantId,
      payload: { merchantId: signal.merchantId, signal },
      agent: 'demand-signal-agent',
      skipPermission: true,
      risk: 'low',
    });

    // Consider price adjustment
    if (signal.spikeFactor >= 4.0) {
      await actionExecutor.execute({
        type: 'adjust_price',
        target: signal.merchantId,
        payload: {
          merchantId: signal.merchantId,
          productId: 'default',
          adjustment: Math.min(10, (signal.spikeFactor - 1) * 5), // Up to 10%
          direction: 'up',
        },
        agent: 'demand-signal-agent',
        skipPermission: true,
        risk: 'medium',
      });
    }
  }
}

// ── Scarcity Signal Actions ───────────────────────────────────────────────────

export async function handleScarcitySignalAction(signal: ScarcitySignal): Promise<void> {
  logger.info('[ActionTrigger] Handling scarcity signal', {
    merchantId: signal.merchantId,
    score: signal.scarcityScore,
    urgency: signal.urgencyLevel,
  });

  // Critical scarcity
  if (signal.scarcityScore >= THRESHOLDS.scarcityCritical) {
    // Alert support
    await actionExecutor.execute({
      type: 'alert_support',
      target: 'support-team',
      payload: {
        type: 'anomaly',
        severity: 'critical',
        message: `Critical scarcity for merchant ${signal.merchantId}`,
        data: signal,
      },
      agent: 'scarcity-agent',
      skipPermission: true,
      risk: 'medium',
    });

    // Update dashboard
    await actionExecutor.execute({
      type: 'update_merchant_dashboard',
      target: signal.merchantId,
      payload: { merchantId: signal.merchantId, signal },
      agent: 'scarcity-agent',
      skipPermission: true,
      risk: 'low',
    });
  }

  // High scarcity - trigger urgency nudges
  if (signal.scarcityScore >= THRESHOLDS.scarcityHigh) {
    // Get users with interest in this merchant
    const dormantIntents = await dormantIntentService.getDormantIntentsByMerchant(
      signal.merchantId,
      signal.category
    );

    for (const intent of dormantIntents.slice(0, 100)) {
      await actionExecutor.execute({
        type: 'send_urgency_nudge',
        target: intent.userId,
        payload: {
          userId: intent.userId,
          merchantId: signal.merchantId,
          message: `Only ${signal.supplyCount} left! Book now before it's gone.`,
          urgency: signal.scarcityScore,
        },
        agent: 'scarcity-agent',
        skipPermission: true,
        risk: 'medium',
      });
    }
  }
}

// ── Optimization Action ───────────────────────────────────────────────────────

export async function handleOptimizationAction(recommendation: OptimizationRecommendation): Promise<void> {
  logger.info('[ActionTrigger] Handling optimization', { type: recommendation.type, confidence: recommendation.confidence });

  // Only apply high-confidence recommendations
  if (recommendation.confidence < 0.8) {
    logger.info('[ActionTrigger] Confidence too low, skipping', { confidence: recommendation.confidence });
    return;
  }

  switch (recommendation.type) {
    case 'pause_strategy':
      await actionExecutor.execute({
        type: 'pause_strategy',
        target: recommendation.agent,
        payload: { strategyId: recommendation.agent, reason: recommendation.reason },
        agent: 'feedback-loop-agent',
        skipPermission: true,
        risk: 'low',
      });
      break;

    case 'rebalance_budget':
      if (recommendation.expectedImpact > 10) {
        await actionExecutor.execute({
          type: 'reallocate_budget',
          target: 'marketing',
          payload: {
            channel: 'email', // Would extract from recommendation
            newBudget: 50000, // Would calculate from recommendation
            reason: recommendation.reason,
          },
          agent: 'feedback-loop-agent',
          skipPermission: true,
          risk: 'high',
        });
      }
      break;

    case 'threshold_adjust':
      logger.info('[ActionTrigger] Threshold adjustment logged', { recommendation });
      break;
  }
}

// ── Revenue Drop Actions ───────────────────────────────────────────────────────

export async function handleRevenueDropAction(report: RevenueReport, previousReport: RevenueReport): Promise<void> {
  const drop = (previousReport.totalGMV - report.totalGMV) / previousReport.totalGMV;

  if (drop >= THRESHOLDS.revenueDropAlert) {
    logger.warn('[ActionTrigger] Revenue drop detected', { drop });

    await actionExecutor.execute({
      type: 'alert_support',
      target: 'support-team',
      payload: {
        type: 'revenue_drop',
        severity: drop > 0.3 ? 'critical' : 'high',
        message: `Revenue dropped ${Math.round(drop * 100)}%`,
        data: { current: report.totalGMV, previous: previousReport.totalGMV, drop },
      },
      agent: 'revenue-attribution-agent',
      skipPermission: true,
      risk: 'medium',
    });
  }
}

// ── Auto Revival Actions ───────────────────────────────────────────────────────

export async function triggerAutoRevival(userId: string, dormantIntentId: string, message: string): Promise<boolean> {
  return actionExecutor.execute({
    type: 'trigger_revival',
    target: userId,
    payload: { userId, dormantIntentId, nudgeMessage: message },
    agent: 'feedback-loop-agent',
    skipPermission: true,
    risk: 'medium',
  });
}

// ── Circuit Breaker Status ─────────────────────────────────────────────────────

export function getActionCircuitBreakerStatus(): Record<string, { status: string; failures: number }> {
  const status: Record<string, { status: string; failures: number }> = {};
  for (const [actionType, cb] of actionCircuitBreakers.entries()) {
    status[actionType] = { status: cb.status, failures: cb.failures };
  }
  return status;
}

export function resetActionCircuitBreaker(actionType?: string): void {
  if (actionType) {
    const cb = actionCircuitBreakers.get(actionType);
    if (cb) {
      cb.failures = 0;
      cb.status = 'closed';
      cb.lastFailure = 0;
    }
  } else {
    actionCircuitBreakers.clear();
  }
}

// ── Export executor for external use ────────────────────────────────────────────

export { actionExecutor };

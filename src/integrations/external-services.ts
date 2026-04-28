// ── External Service Integrations ─────────────────────────────────────────────────
// Real integrations with ReZ ecosystem services via HTTP API
// Connects intent-graph to wallet, order, payment, and operational services
// Includes retry + circuit breaker for resilient autonomous operations

import crypto from 'crypto';
import { sharedMemory } from '../agents/shared-memory.js';
import { SERVICE_URLS } from '../config/services.js';

const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => console.log(`[ExternalServices] ${msg}`, meta || ''),
  warn: (msg: string, meta?: Record<string, unknown>) => console.warn(`[ExternalServices] ${msg}`, meta || ''),
  error: (msg: string, meta?: Record<string, unknown>) => console.error(`[ExternalServices] ${msg}`, meta || ''),
};

// ── Service URLs — sourced from src/config/services.ts ──────────────────────────────
const SERVICES = SERVICE_URLS;

// ── Circuit Breaker Configuration ───────────────────────────────────────────────

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  status: 'closed' | 'open' | 'half-open';
}

const circuitBreakers = new Map<string, CircuitBreakerState>();

const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 5,      // Open circuit after 5 failures
  resetTimeoutMs: 60000,    // Try again after 60 seconds
  halfOpenSuccessThreshold: 2, // Need 2 successes to close circuit
};

function getCircuitBreaker(serviceName: string): CircuitBreakerState {
  if (!circuitBreakers.has(serviceName)) {
    circuitBreakers.set(serviceName, { failures: 0, lastFailure: 0, status: 'closed' });
  }
  return circuitBreakers.get(serviceName)!;
}

function recordSuccess(serviceName: string): void {
  const cb = getCircuitBreaker(serviceName);
  cb.failures = 0;
  cb.status = 'closed';
}

function recordFailure(serviceName: string): void {
  const cb = getCircuitBreaker(serviceName);
  cb.failures++;
  cb.lastFailure = Date.now();

  if (cb.failures >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
    cb.status = 'open';
    logger.warn(`[CircuitBreaker] Circuit OPEN for ${serviceName} after ${cb.failures} failures`);
  }
}

function canAttempt(serviceName: string): boolean {
  const cb = getCircuitBreaker(serviceName);

  if (cb.status === 'closed') return true;

  if (cb.status === 'open') {
    const timeSinceFailure = Date.now() - cb.lastFailure;
    if (timeSinceFailure >= CIRCUIT_BREAKER_CONFIG.resetTimeoutMs) {
      cb.status = 'half-open';
      logger.info(`[CircuitBreaker] Circuit HALF-OPEN for ${serviceName}, allowing test request`);
      return true;
    }
    return false;
  }

  // half-open: allow limited attempts
  return true;
}

// ── Retry Configuration ─────────────────────────────────────────────────────────

const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 2000,
  backoffMultiplier: 2,
};

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.min(ms, RETRY_CONFIG.maxDelayMs)));
}

// ── HTTP Client with internal service auth + retry + circuit breaker ────────────

interface HttpResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
  retries?: number;
}

async function httpRequest<T>(
  url: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
    timeout?: number;
    retries?: number;
    serviceName?: string;
  } = {}
): Promise<HttpResponse<T>> {
  const { method = 'GET', body, headers = {}, timeout = 10000, serviceName = 'unknown' } = options;

  // Check circuit breaker
  if (!canAttempt(serviceName)) {
    return {
      success: false,
      error: `Circuit breaker open for ${serviceName}`,
      statusCode: 503,
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  let lastError: string = '';
  let attempts = 0;
  const maxAttempts = options.retries ?? RETRY_CONFIG.maxRetries;

  while (attempts < maxAttempts) {
    attempts++;

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': process.env.INTERNAL_SERVICE_TOKEN || '',
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json().catch(() => ({} as Record<string, unknown>));

      if (!response.ok) {
        // Don't retry on client errors (4xx)
        if (response.status >= 400 && response.status < 500) {
          recordFailure(serviceName);
          return {
            success: false,
            error: (data as Record<string, unknown>).message as string || `HTTP ${response.status}`,
            statusCode: response.status,
            retries: attempts - 1,
          };
        }

        // Retry on server errors (5xx)
        lastError = (data as Record<string, unknown>).message as string || `HTTP ${response.status}`;
        logger.warn(`[HTTP] Server error ${response.status}, attempt ${attempts}/${maxAttempts}`, { url });

        if (attempts < maxAttempts) {
          const delay = RETRY_CONFIG.baseDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempts - 1);
          await sleep(delay);
          continue;
        }

        recordFailure(serviceName);
        return {
          success: false,
          error: lastError,
          statusCode: response.status,
          retries: attempts - 1,
        };
      }

      // Success!
      recordSuccess(serviceName);
      return { success: true, data: data as T, statusCode: response.status, retries: attempts - 1 };

    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error instanceof Error ? error.message : String(error);

      // Network errors - retry
      if (attempts < maxAttempts) {
        logger.warn(`[HTTP] Network error, attempt ${attempts}/${maxAttempts}`, { url, error: lastError });
        const delay = RETRY_CONFIG.baseDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempts - 1);
        await sleep(delay);
        continue;
      }

      recordFailure(serviceName);
      logger.error(`[HTTP] Request failed after ${maxAttempts} attempts: ${url}`, { error: lastError });
      return { success: false, error: lastError, retries: attempts - 1 };
    }
  }

  recordFailure(serviceName);
  return { success: false, error: lastError || 'Max retries exceeded', retries: maxAttempts };
}

// ── Wallet Service Integration ──────────────────────────────────────────────────

export interface WalletTransaction {
  userId: string;
  amount: number;
  type: 'credit' | 'debit';
  coinType?: 'rez' | 'prive' | 'branded' | 'promo' | 'cashback' | 'referral';
  description: string;
  referenceId?: string;
  referenceType?: 'order' | 'nudge' | 'refund' | 'bonus';
}

export interface WalletBalance {
  userId: string;
  total: number;
  available: number;
  pending: number;
  cashback: number;
  coins: Array<{ type: string; amount: number }>;
}

/**
 * Charge user wallet (Debit) via real HTTP call
 */
export async function chargeWallet(
  userId: string,
  amount: number,
  description: string,
  options: {
    coinType?: 'rez' | 'prive' | 'branded' | 'promo' | 'cashback' | 'referral';
    referenceId?: string;
    referenceType?: 'order' | 'nudge' | 'refund' | 'bonus';
  } = {}
): Promise<{ success: boolean; transactionId?: string; error?: string }> {
  try {
    // Map referenceType to wallet source
    const sourceMap: Record<string, string> = {
      order: 'order_payment',
      nudge: 'nudge_charge',
      refund: 'refund',
      bonus: 'bonus',
    };

    const result = await httpRequest<{ transactionId: string }>(
      `${SERVICES.wallet}/wallet/debit`,
      {
        method: 'POST',
        body: {
          userId,
          amount,
          coinType: options.coinType || 'rez',
          source: sourceMap[options.referenceType || 'order'] || 'intent_graph',
          description,
          sourceId: options.referenceId,
        },
        serviceName: 'wallet',
        retries: 3,
      }
    );

    if (result.success && result.data) {
      logger.info('[Wallet] Charging user', { userId, amount, description, transactionId: result.data.transactionId });

      // Also publish to shared memory for event tracking
      await sharedMemory.publish({
        from: 'intent-graph',
        to: 'wallet-service',
        type: 'transaction',
        payload: {
          action: 'charge',
          userId,
          amount,
          coinType: options.coinType || 'rez',
          description,
          transactionId: result.data.transactionId,
        },
        timestamp: new Date(),
      });

      // Cache transaction locally
      await sharedMemory.set(
        `wallet:txn:${result.data.transactionId}`,
        {
          userId,
          amount,
          coinType: options.coinType || 'rez',
          description,
          transactionId: result.data.transactionId,
          status: 'completed',
          timestamp: new Date(),
        },
        86400
      );

      return { success: true, transactionId: result.data.transactionId };
    }

    logger.error('[Wallet] Charge failed', { userId, amount, error: result.error });
    return { success: false, error: result.error };
  } catch (error) {
    logger.error('[Wallet] Charge exception', { userId, amount, error });
    return { success: false, error: String(error) };
  }
}

/**
 * Credit user wallet (Refund/Bonus) via real HTTP call
 */
export async function creditWallet(
  userId: string,
  amount: number,
  description: string,
  options: {
    coinType?: 'rez' | 'prive' | 'branded' | 'promo' | 'cashback' | 'referral';
    referenceId?: string;
    referenceType?: 'order' | 'nudge' | 'refund' | 'bonus';
  } = {}
): Promise<{ success: boolean; transactionId?: string; error?: string }> {
  try {
    // Map referenceType to wallet source
    const sourceMap: Record<string, string> = {
      order: 'order_refund',
      nudge: 'nudge_refund',
      refund: 'refund',
      bonus: 'bonus',
    };

    const result = await httpRequest<{ transactionId: string }>(
      `${SERVICES.wallet}/wallet/credit`,
      {
        method: 'POST',
        body: {
          userId,
          amount,
          coinType: options.coinType || 'cashback',
          source: sourceMap[options.referenceType || 'refund'] || 'intent_graph_refund',
          description,
          sourceId: options.referenceId,
        },
        serviceName: 'wallet',
        retries: 3,
      }
    );

    if (result.success && result.data) {
      logger.info('[Wallet] Crediting user', { userId, amount, description, transactionId: result.data.transactionId });

      await sharedMemory.publish({
        from: 'intent-graph',
        to: 'wallet-service',
        type: 'transaction',
        payload: {
          action: 'credit',
          userId,
          amount,
          coinType: options.coinType || 'cashback',
          description,
          transactionId: result.data.transactionId,
        },
        timestamp: new Date(),
      });

      await sharedMemory.set(
        `wallet:txn:${result.data.transactionId}`,
        {
          userId,
          amount,
          coinType: options.coinType || 'cashback',
          description,
          transactionId: result.data.transactionId,
          status: 'completed',
          timestamp: new Date(),
        },
        86400
      );

      return { success: true, transactionId: result.data.transactionId };
    }

    logger.error('[Wallet] Credit failed', { userId, amount, error: result.error });
    return { success: false, error: result.error };
  } catch (error) {
    logger.error('[Wallet] Credit exception', { userId, amount, error });
    return { success: false, error: String(error) };
  }
}

/**
 * Get user wallet balance via real HTTP call
 */
export async function getWalletBalance(userId: string): Promise<WalletBalance | null> {
  try {
    // Check cache first (5 min TTL)
    const cached = await sharedMemory.get<WalletBalance>(`wallet:balance:${userId}`);
    if (cached) return cached;

    const result = await httpRequest<{
      coins: Array<{ coinType: string; amount: number }>;
      pending: number;
      total: number;
    }>(`${SERVICES.wallet}/wallet/${userId}/balance`, { serviceName: 'wallet' });

    if (result.success && result.data) {
      const balance: WalletBalance = {
        userId,
        total: result.data.total || 0,
        available: result.data.total || 0,
        pending: result.data.pending || 0,
        cashback: result.data.coins?.find(c => c.coinType === 'cashback')?.amount || 0,
        coins: result.data.coins?.map(c => ({ type: c.coinType, amount: c.amount })) || [],
      };

      // Cache for 5 minutes
      await sharedMemory.set(`wallet:balance:${userId}`, balance, 300);
      return balance;
    }

    logger.warn('[Wallet] Get balance failed, returning cached', { userId, error: result.error });
    return cached || null;
  } catch (error) {
    logger.error('[Wallet] Get balance exception', { userId, error });

    // Return cached on failure
    const cached = await sharedMemory.get<WalletBalance>(`wallet:balance:${userId}`);
    return cached || null;
  }
}

// ── Order Service Integration ────────────────────────────────────────────────────

export interface OrderItem {
  itemId?: string;
  name: string;
  quantity: number;
  price: number;
}

export interface CreateOrderParams {
  userId: string;
  storeId: string;
  items: OrderItem[];
  deliveryType?: 'pickup' | 'delivery';
  deliveryAddress?: Record<string, unknown>;
  paymentMethod?: string;
  currency?: string;
}

export interface OrderResult {
  success: boolean;
  orderId?: string;
  status?: string;
  total?: number;
  error?: string;
}

/**
 * Create order in order service via real HTTP call
 */
export async function createOrder(params: CreateOrderParams): Promise<OrderResult> {
  try {
    const total = params.items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    const orderPayload = {
      userId: params.userId,
      storeId: params.storeId,
      items: params.items.map(item => ({
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        itemId: item.itemId,
      })),
      payment: {
        method: params.paymentMethod || 'wallet',
        status: 'pending',
        amount: total,
      },
      delivery: params.deliveryType ? {
        type: params.deliveryType,
        address: params.deliveryAddress,
      } : undefined,
      currency: params.currency || 'INR',
    };

    const result = await httpRequest<{ _id: string; orderId: string; status: string }>(
      `${SERVICES.monolith}/api/orders/create`,
      {
        method: 'POST',
        body: orderPayload,
        serviceName: 'order',
        retries: 3,
      }
    );

    if (result.success && result.data) {
      const orderId = result.data.orderId || result.data._id;

      logger.info('[Order] Order created', {
        userId: params.userId,
        storeId: params.storeId,
        orderId,
        items: params.items.length,
        total,
      });

      // Publish to shared memory
      await sharedMemory.publish({
        from: 'intent-graph',
        to: 'order-service',
        type: 'order',
        payload: {
          action: 'create',
          orderId,
          ...orderPayload,
        },
        timestamp: new Date(),
      });

      // Store order in memory
      await sharedMemory.set(
        `order:${orderId}`,
        {
          orderId,
          ...orderPayload,
          status: result.data.status || 'placed',
          totals: { total, subtotal: total },
          createdAt: new Date(),
        },
        86400 * 7
      );

      return { success: true, orderId, status: result.data.status || 'placed', total };
    }

    logger.error('[Order] Create order failed', { params, error: result.error });
    return { success: false, error: result.error };
  } catch (error) {
    logger.error('[Order] Create order exception', { params, error });
    return { success: false, error: String(error) };
  }
}

/**
 * Update order status via real HTTP call
 */
export async function updateOrderStatus(
  orderId: string,
  status: 'placed' | 'confirmed' | 'preparing' | 'ready' | 'dispatched' | 'out_for_delivery' | 'delivered' | 'cancelled'
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await httpRequest(
      `${SERVICES.monolith}/api/orders/${orderId}/status`,
      {
        method: 'PUT',
        body: { status },
        serviceName: 'order',
        retries: 3,
      }
    );

    if (result.success) {
      logger.info('[Order] Status updated', { orderId, status });

      // Update cached order
      const order = await sharedMemory.get<Record<string, unknown>>(`order:${orderId}`);
      if (order) {
        await sharedMemory.set(`order:${orderId}`, { ...order, status }, 86400 * 7);
      }

      // Publish status change
      await sharedMemory.publish({
        from: 'intent-graph',
        to: 'order-service',
        type: 'status_update',
        payload: { orderId, status },
        timestamp: new Date(),
      });

      return { success: true };
    }

    logger.error('[Order] Status update failed', { orderId, status, error: result.error });
    return { success: false, error: result.error };
  } catch (error) {
    logger.error('[Order] Status update exception', { orderId, status, error });
    return { success: false, error: String(error) };
  }
}

// ── PMS (Property Management System) Integration ─────────────────────────────────

export interface PMSGuestRequest {
  hotelId: string;
  guestId: string;
  roomNumber: string;
  requestType: 'room_service' | 'housekeeping' | 'concierge' | 'minibar' | 'checkout';
  items: Array<{ name: string; quantity: number; price?: number }>;
  notes?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  [key: string]: unknown;
}

/**
 * Submit guest request to PMS via HTTP (when PMS service is available)
 * Falls back to shared memory pub/sub if service unavailable
 */
export async function submitGuestRequest(request: PMSGuestRequest): Promise<{ success: boolean; requestId?: string; error?: string }> {
  try {
    // Try HTTP call first if PMS service URL is configured
    if (SERVICES.pms && !SERVICES.pms.includes('localhost')) {
      const result = await httpRequest<{ requestId: string }>(
        `${SERVICES.pms}/guest-requests`,
        {
          method: 'POST',
          body: request,
        }
      );

      if (result.success && result.data) {
        return { success: true, requestId: result.data.requestId };
      }
    }

    // Fallback: publish to shared memory for other services to consume
    const requestId = `pms_${crypto.randomUUID()}`;

    await sharedMemory.publish({
      from: 'intent-graph',
      to: 'pms-service',
      type: 'request',
      payload: {
        action: 'guest_request',
        requestId,
        ...request,
      },
      timestamp: new Date(),
    });

    logger.info('[PMS] Guest request submitted', {
      hotelId: request.hotelId,
      guestId: request.guestId,
      type: request.requestType,
      requestId,
    });

    await sharedMemory.set(
      `pms:request:${requestId}`,
      { ...request, requestId, status: 'submitted', timestamp: new Date() },
      86400
    );

    return { success: true, requestId };
  } catch (error) {
    logger.error('[PMS] Request failed', { request, error });
    return { success: false, error: String(error) };
  }
}

// ── Task Queue Integration ──────────────────────────────────────────────────────

export interface TaskAssignment {
  department: 'housekeeping' | 'concierge' | 'maintenance' | 'kitchen' | 'front_desk';
  taskType: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assignedTo?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Create task in operational queue via shared memory pub/sub
 * (Task queue is typically consumed by dedicated operational services)
 */
export async function createTask(task: TaskAssignment): Promise<{ success: boolean; taskId?: string; error?: string }> {
  try {
    const taskId = `task_${crypto.randomUUID()}`;

    await sharedMemory.publish({
      from: 'intent-graph',
      to: 'task-queue',
      type: 'task',
      payload: {
        action: 'create',
        taskId,
        ...task,
      },
      timestamp: new Date(),
    });

    logger.info('[Task] Task created', {
      department: task.department,
      type: task.taskType,
      priority: task.priority,
      taskId,
    });

    await sharedMemory.set(
      `task:${taskId}`,
      { ...task, taskId, status: 'pending', createdAt: new Date() },
      86400
    );

    return { success: true, taskId };
  } catch (error) {
    logger.error('[Task] Create task failed', { task, error });
    return { success: false, error: String(error) };
  }
}

// ── Notification Service Integration ─────────────────────────────────────────────

export interface StaffNotification {
  staffId?: string;
  department: string;
  title: string;
  message: string;
  priority: 'low' | 'medium' | 'high';
  actionRequired?: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Send notification to staff via shared memory pub/sub
 */
export async function sendStaffNotification(notification: StaffNotification): Promise<{ success: boolean; notificationId?: string; error?: string }> {
  try {
    const notificationId = `notif_${crypto.randomUUID()}`;

    await sharedMemory.publish({
      from: 'intent-graph',
      to: 'notification-service',
      type: 'notification',
      payload: {
        action: 'staff_alert',
        notificationId,
        ...notification,
      },
      timestamp: new Date(),
    });

    logger.info('[Notification] Staff notification sent', {
      department: notification.department,
      title: notification.title,
      notificationId,
    });

    return { success: true, notificationId };
  } catch (error) {
    logger.error('[Notification] Send failed', { notification, error });
    return { success: false, error: String(error) };
  }
}

/**
 * Send push notification to user via shared memory pub/sub
 */
export async function sendUserNotification(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<{ success: boolean; notificationId?: string; error?: string }> {
  try {
    const notificationId = `notif_${crypto.randomUUID()}`;

    await sharedMemory.publish({
      from: 'intent-graph',
      to: 'notification-service',
      type: 'notification',
      payload: {
        action: 'user_push',
        notificationId,
        userId,
        title,
        body,
        data,
      },
      timestamp: new Date(),
    });

    logger.info('[Notification] User notification sent', { userId, title, notificationId });

    return { success: true, notificationId };
  } catch (error) {
    logger.error('[Notification] User send failed', { userId, title, error });
    return { success: false, error: String(error) };
  }
}

// ── Merchant Service Integration ─────────────────────────────────────────────────

export interface MerchantOrder {
  merchantId: string;
  orderId: string;
  items: Array<{ productId: string; quantity: number; price: number }>;
  totalAmount: number;
  customerId: string;
  deliveryType?: 'pickup' | 'delivery';
}

/**
 * Send order to merchant OS via shared memory pub/sub
 */
export async function sendToMerchantOS(order: MerchantOrder): Promise<{ success: boolean; merchantOrderId?: string; error?: string }> {
  try {
    const merchantOrderId = `merch_${crypto.randomUUID()}`;

    await sharedMemory.publish({
      from: 'intent-graph',
      to: 'merchant-os',
      type: 'order',
      payload: {
        action: 'new_order',
        merchantOrderId,
        ...order,
      },
      timestamp: new Date(),
    });

    logger.info('[Merchant] Order sent to merchant OS', {
      merchantId: order.merchantId,
      orderId: order.orderId,
      total: order.totalAmount,
      merchantOrderId,
    });

    await sharedMemory.set(
      `merchant:order:${merchantOrderId}`,
      { ...order, merchantOrderId, status: 'received', timestamp: new Date() },
      86400 * 7
    );

    return { success: true, merchantOrderId };
  } catch (error) {
    logger.error('[Merchant] Send to OS failed', { order, error });
    return { success: false, error: String(error) };
  }
}

// ── Complete Flow Helpers ────────────────────────────────────────────────────────

/**
 * Complete Room QR flow:
 * 1. Charge wallet (if chargeable items)
 * 2. Submit PMS request
 * 3. Create task
 * 4. Notify staff
 * 5. Update memory
 */
export async function executeRoomServiceFlow(
  guestId: string,
  roomNumber: string,
  hotelId: string,
  items: Array<{ name: string; quantity: number; price: number }>,
  complimentaryItems: string[] = []
): Promise<{
  success: boolean;
  walletTransactionId?: string;
  pmsRequestId?: string;
  taskId?: string;
  notificationId?: string;
  totalCharged?: number;
  error?: string;
}> {
  const totalCharged = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const chargeableItems = items.filter(item => !complimentaryItems.includes(item.name));

  let walletTransactionId: string | undefined;
  let pmsRequestId: string | undefined;
  let taskId: string | undefined;
  let notificationId: string | undefined;

  try {
    // 1. Charge wallet if there are chargeable items
    if (chargeableItems.length > 0) {
      const chargeResult = await chargeWallet(
        guestId,
        totalCharged,
        `Room service: ${items.map(i => i.name).join(', ')}`,
        { referenceType: 'order', referenceId: `room_${roomNumber}` }
      );
      if (!chargeResult.success) {
        return { success: false, error: `Wallet charge failed: ${chargeResult.error}` };
      }
      walletTransactionId = chargeResult.transactionId;
    }

    // 2. Submit to PMS
    const pmsResult = await submitGuestRequest({
      hotelId,
      guestId,
      roomNumber,
      requestType: totalCharged > 0 ? 'room_service' : 'housekeeping',
      items,
      notes: complimentaryItems.length > 0 ? `Complimentary: ${complimentaryItems.join(', ')}` : undefined,
      priority: 'medium',
    });
    pmsRequestId = pmsResult.requestId;

    // 3. Create task for staff
    const taskResult = await createTask({
      department: 'concierge',
      taskType: 'room_delivery',
      description: `Room ${roomNumber}: ${items.map(i => `${i.quantity}x ${i.name}`).join(', ')}`,
      priority: 'medium',
      metadata: { guestId, hotelId, pmsRequestId },
    });
    taskId = taskResult.taskId;

    // 4. Notify staff
    const notifResult = await sendStaffNotification({
      department: 'concierge',
      title: 'Room Service Request',
      message: `Room ${roomNumber}: ${items.map(i => `${i.quantity}x ${i.name}`).join(', ')}`,
      priority: 'medium',
      actionRequired: 'Deliver to room',
      metadata: { taskId, pmsRequestId },
    });
    notificationId = notifResult.notificationId;

    // 5. Update memory with the flow completion
    await sharedMemory.set(
      `room_service:${guestId}:${Date.now()}`,
      {
        guestId,
        roomNumber,
        hotelId,
        items,
        totalCharged,
        walletTransactionId,
        pmsRequestId,
        taskId,
        notificationId,
        completedAt: new Date(),
      },
      86400 * 30
    );

    logger.info('[RoomService] Flow completed', { guestId, roomNumber, totalCharged });

    return {
      success: true,
      walletTransactionId,
      pmsRequestId,
      taskId,
      notificationId,
      totalCharged,
    };
  } catch (error) {
    logger.error('[RoomService] Flow failed', { guestId, roomNumber, error });
    return { success: false, error: String(error) };
  }
}

/**
 * Complete shopping flow:
 * 1. Charge wallet
 * 2. Create order
 * 3. Send to merchant OS
 * 4. Update memory
 */
export async function executeShoppingFlow(
  userId: string,
  storeId: string,
  merchantId: string,
  items: Array<{ name: string; quantity: number; price: number; productId?: string }>
): Promise<{
  success: boolean;
  orderId?: string;
  merchantOrderId?: string;
  total?: number;
  error?: string;
}> {
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  try {
    // 1. Charge wallet first
    const chargeResult = await chargeWallet(
      userId,
      total,
      `Order: ${items.map(i => i.name).join(', ')}`,
      { referenceType: 'order' }
    );
    if (!chargeResult.success) {
      return { success: false, error: `Payment failed: ${chargeResult.error}` };
    }

    // 2. Create order
    const orderResult = await createOrder({
      userId,
      storeId,
      items: items.map(i => ({
        name: i.name,
        quantity: i.quantity,
        price: i.price,
        itemId: i.productId,
      })),
      paymentMethod: 'wallet',
    });
    if (!orderResult.success || !orderResult.orderId) {
      // Refund wallet on order failure
      await creditWallet(userId, total, 'Order failed - refund', { referenceType: 'refund' });
      return { success: false, error: 'Order creation failed' };
    }

    // 3. Send to merchant OS
    const merchantResult = await sendToMerchantOS({
      merchantId,
      orderId: orderResult.orderId,
      items: items.map(i => ({
        productId: i.productId || '',
        quantity: i.quantity,
        price: i.price,
      })),
      totalAmount: total,
      customerId: userId,
    });

    // 4. Update memory
    await sharedMemory.set(
      `order:history:${userId}:${orderResult.orderId}`,
      {
        orderId: orderResult.orderId,
        merchantOrderId: merchantResult.merchantOrderId,
        items,
        total,
        status: 'placed',
        placedAt: new Date(),
      },
      86400 * 90
    );

    logger.info('[Shopping] Flow completed', { userId, orderId: orderResult.orderId, total });

    return {
      success: true,
      orderId: orderResult.orderId,
      merchantOrderId: merchantResult.merchantOrderId,
      total,
    };
  } catch (error) {
    logger.error('[Shopping] Flow failed', { userId, error });
    return { success: false, error: String(error) };
  }
}

// ── Auth Service Integration ─────────────────────────────────────────────────────

export interface UserValidationResult {
  valid: boolean;
  userId?: string;
  error?: string;
}

/**
 * Validate internal service token
 */
export async function validateInternalToken(token: string): Promise<boolean> {
  try {
    const result = await httpRequest<{ valid: boolean }>(
      `${SERVICES.auth}/auth/validate`,
      {
        method: 'GET',
        headers: {
          'X-Internal-Token': token,
        },
        serviceName: 'auth',
        retries: 1,
        timeout: 3000,
      }
    );
    return result.success && result.data?.valid === true;
  } catch {
    return false;
  }
}

/**
 * Get user info from auth service
 */
export async function getUserFromToken(token: string): Promise<{ userId: string; phone?: string } | null> {
  try {
    const result = await httpRequest<{ userId: string; phone?: string }>(
      `${SERVICES.auth}/auth/me`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        serviceName: 'auth',
        retries: 2,
        timeout: 5000,
      }
    );
    return result.success ? result.data || null : null;
  } catch {
    return null;
  }
}

// ── Service Health Checks ──────────────────────────────────────────────────────

export interface ServiceHealthStatus {
  name: string;
  healthy: boolean;
  circuitBreakerStatus: 'closed' | 'open' | 'half-open';
  failureCount: number;
  lastFailure: number | null;
}

export async function checkServiceHealth(service: string): Promise<boolean> {
  const healthEndpoints: Record<string, string> = {
    wallet: `${SERVICES.wallet}/health`,
    monolith: `${SERVICES.monolith}/api/health`,
    order: `${SERVICES.order}/health`,
    payment: `${SERVICES.payment}/health`,
    merchant: `${SERVICES.merchant}/health`,
    notification: `${SERVICES.notification}/health`,
    auth: `${SERVICES.auth}/health`,
    catalog: `${SERVICES.catalog}/health`,
    search: `${SERVICES.search}/health`,
    marketing: `${SERVICES.marketing}/health`,
    gamification: `${SERVICES.gamification}/health`,
    ads: `${SERVICES.ads}/health`,
    analytics: `${SERVICES.analytics}/health`,
  };

  const url = healthEndpoints[service];
  if (!url) return false;

  try {
    const result = await httpRequest<{ status: string }>(url, {
      timeout: 3000,
      serviceName: service,
      retries: 1,
    });
    return result.success && result.data?.status === 'ok';
  } catch {
    return false;
  }
}

export async function getAllServiceHealth(): Promise<Record<string, boolean>> {
  const services = ['wallet', 'monolith', 'payment', 'merchant', 'notification', 'auth', 'analytics'];

  const results = await Promise.all(
    services.map(async (service) => ({
      service,
      healthy: await checkServiceHealth(service),
    }))
  );

  return results.reduce((acc, { service, healthy }) => {
    acc[service] = healthy;
    return acc;
  }, {} as Record<string, boolean>);
}

/**
 * Get detailed circuit breaker status for all services
 */
export function getCircuitBreakerStatus(): ServiceHealthStatus[] {
  const services = [
    'wallet', 'monolith', 'order', 'payment', 'merchant',
    'notification', 'auth', 'catalog', 'search', 'marketing',
    'gamification', 'ads', 'pms', 'analytics'
  ];

  return services.map(name => {
    const cb = getCircuitBreaker(name);
    return {
      name,
      healthy: cb.status === 'closed',
      circuitBreakerStatus: cb.status,
      failureCount: cb.failures,
      lastFailure: cb.lastFailure > 0 ? cb.lastFailure : null,
    };
  });
}

/**
 * Reset circuit breaker for a service (admin operation)
 */
export function resetCircuitBreaker(serviceName: string): boolean {
  if (circuitBreakers.has(serviceName)) {
    const cb = getCircuitBreaker(serviceName);
    cb.failures = 0;
    cb.status = 'closed';
    cb.lastFailure = 0;
    logger.info(`[CircuitBreaker] Reset circuit breaker for ${serviceName}`);
    return true;
  }
  return false;
}

/**
 * Force open circuit breaker for a service (admin operation)
 */
export function forceOpenCircuitBreaker(serviceName: string): boolean {
  if (circuitBreakers.has(serviceName)) {
    const cb = getCircuitBreaker(serviceName);
    cb.status = 'open';
    cb.failures = CIRCUIT_BREAKER_CONFIG.failureThreshold;
    cb.lastFailure = Date.now();
    logger.warn(`[CircuitBreaker] Force OPEN circuit breaker for ${serviceName}`);
    return true;
  }
  return false;
}

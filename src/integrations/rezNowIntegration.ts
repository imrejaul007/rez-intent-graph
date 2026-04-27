// ── ReZ Now Integration ────────────────────────────────────────────────────────
// Hooks rez-now checkout flow to Intent Graph

import { intentCaptureService } from '../services/IntentCaptureService.js';
import { dormantIntentService } from '../services/DormantIntentService.js';
import type { AppType, Category, EventType } from '../types/intent.js';

const RESTAURANT_APP_TYPE: AppType = 'restaurant';
const DINING_CATEGORY: Category = 'DINING';

export interface RestaurantIntentContext {
  userId: string;
  merchantId: string;
  productId?: string;
  category?: string;
  query?: string;
}

/**
 * Capture restaurant/merchant search intent
 */
export async function captureRestaurantSearch(params: RestaurantIntentContext): Promise<void> {
  const intentKey = buildRestaurantIntentKey('search', params);

  await intentCaptureService.capture({
    userId: params.userId,
    appType: RESTAURANT_APP_TYPE,
    eventType: 'search',
    category: DINING_CATEGORY,
    intentKey,
    intentQuery: params.query,
    metadata: {
      merchantId: params.merchantId,
      category: params.category,
    },
  });
}

/**
 * Capture merchant view intent
 */
export async function captureMerchantView(params: RestaurantIntentContext): Promise<void> {
  const intentKey = buildRestaurantIntentKey('view', params);

  await intentCaptureService.capture({
    userId: params.userId,
    appType: RESTAURANT_APP_TYPE,
    eventType: 'view',
    category: DINING_CATEGORY,
    intentKey,
    metadata: {
      merchantId: params.merchantId,
      category: params.category,
    },
  });
}

/**
 * Capture add to cart intent (strong purchase signal)
 */
export async function captureAddToCart(params: RestaurantIntentContext): Promise<void> {
  const intentKey = buildRestaurantIntentKey('cart_add', params);

  await intentCaptureService.capture({
    userId: params.userId,
    appType: RESTAURANT_APP_TYPE,
    eventType: 'cart_add',
    category: DINING_CATEGORY,
    intentKey,
    metadata: {
      merchantId: params.merchantId,
      productId: params.productId,
    },
  });
}

/**
 * Capture checkout start intent
 */
export async function captureCheckoutStart(params: RestaurantIntentContext): Promise<void> {
  const intentKey = buildRestaurantIntentKey('checkout_start', params);

  await intentCaptureService.capture({
    userId: params.userId,
    appType: RESTAURANT_APP_TYPE,
    eventType: 'checkout_start',
    category: DINING_CATEGORY,
    intentKey,
    metadata: {
      merchantId: params.merchantId,
    },
  });
}

/**
 * Capture order placed (intent fulfilled)
 */
export async function captureOrderPlaced(params: RestaurantIntentContext): Promise<void> {
  const intentKey = buildRestaurantIntentKey('fulfilled', params);

  const result = await intentCaptureService.capture({
    userId: params.userId,
    appType: RESTAURANT_APP_TYPE,
    eventType: 'fulfilled',
    category: DINING_CATEGORY,
    intentKey,
    metadata: {
      merchantId: params.merchantId,
    },
  });

  // Check if this revived a dormant intent
  if (result.intent.status === 'FULFILLED') {
    const dormantIntents = await dormantIntentService.getUserDormantIntents(params.userId);
    const revived = dormantIntents.find(
      (di) => di.intentKey.includes(params.merchantId || '')
    );
    if (revived) {
      await dormantIntentService.markRevived(revived.id);
    }
  }
}

/**
 * Capture cart abandonment
 */
export async function captureCartAbandoned(params: RestaurantIntentContext): Promise<void> {
  const intentKey = buildRestaurantIntentKey('abandoned', params);

  await intentCaptureService.capture({
    userId: params.userId,
    appType: RESTAURANT_APP_TYPE,
    eventType: 'abandoned',
    category: DINING_CATEGORY,
    intentKey,
    metadata: {
      merchantId: params.merchantId,
      productId: params.productId,
    },
  });
}

/**
 * Build standardized restaurant intent key
 */
function buildRestaurantIntentKey(
  action: string,
  params: RestaurantIntentContext
): string {
  const parts = [
    'restaurant',
    action,
    params.merchantId || 'unknown',
    params.productId || '',
  ];
  return parts.filter(Boolean).join('_');
}

/**
 * Get active dining intents for a user
 */
export async function getActiveDiningIntents(userId: string) {
  return intentCaptureService.getActiveIntents(userId);
}

/**
 * ReZ Now Integration object
 */
export const rezNowIntegration = {
  captureSearch: captureRestaurantSearch,
  captureView: captureMerchantView,
  captureAddToCart: captureAddToCart,
  captureCheckoutStart: captureCheckoutStart,
  captureOrderPlaced: captureOrderPlaced,
  captureCartAbandoned: captureCartAbandoned,
  getActiveIntents: getActiveDiningIntents,
};

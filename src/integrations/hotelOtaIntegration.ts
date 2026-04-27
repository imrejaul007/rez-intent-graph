// ── Hotel OTA Integration ─────────────────────────────────────────────────────
// Hooks Hotel OTA booking flow to Intent Graph

import { intentCaptureService } from '../services/IntentCaptureService.js';
import { dormantIntentService } from '../services/DormantIntentService.js';
import type { AppType, Category, EventType } from '../types/intent.js';

const HOTEL_APP_TYPE: AppType = 'hotel_ota';
const TRAVEL_CATEGORY: Category = 'TRAVEL';

export interface HotelIntentContext {
  userId: string;
  hotelId: string;
  roomTypeId?: string;
  city?: string;
  checkIn?: string;
  checkOut?: string;
  guests?: number;
}

/**
 * Capture hotel search intent
 */
export async function captureHotelSearch(params: HotelIntentContext): Promise<void> {
  const intentKey = buildHotelIntentKey('search', params);

  await intentCaptureService.capture({
    userId: params.userId,
    appType: HOTEL_APP_TYPE,
    eventType: 'search',
    category: TRAVEL_CATEGORY,
    intentKey,
    intentQuery: `${params.city || ''} hotels`,
    metadata: {
      hotelId: params.hotelId,
      city: params.city,
      checkIn: params.checkIn,
      checkOut: params.checkOut,
      guests: params.guests,
    },
  });
}

/**
 * Capture hotel view intent
 */
export async function captureHotelView(params: HotelIntentContext): Promise<void> {
  const intentKey = buildHotelIntentKey('view', params);

  await intentCaptureService.capture({
    userId: params.userId,
    appType: HOTEL_APP_TYPE,
    eventType: 'view',
    category: TRAVEL_CATEGORY,
    intentKey,
    metadata: {
      hotelId: params.hotelId,
      roomTypeId: params.roomTypeId,
      city: params.city,
    },
  });
}

/**
 * Capture booking hold intent (strong purchase signal)
 */
export async function captureBookingHold(params: HotelIntentContext): Promise<void> {
  const intentKey = buildHotelIntentKey('hold', params);

  await intentCaptureService.capture({
    userId: params.userId,
    appType: HOTEL_APP_TYPE,
    eventType: 'hold',
    category: TRAVEL_CATEGORY,
    intentKey,
    metadata: {
      hotelId: params.hotelId,
      roomTypeId: params.roomTypeId,
      checkIn: params.checkIn,
      checkOut: params.checkOut,
      guests: params.guests,
    },
  });
}

/**
 * Capture booking confirmation (intent fulfilled)
 */
export async function captureBookingConfirmed(params: HotelIntentContext): Promise<void> {
  const intentKey = buildHotelIntentKey('confirmed', params);

  const result = await intentCaptureService.capture({
    userId: params.userId,
    appType: HOTEL_APP_TYPE,
    eventType: 'fulfilled',
    category: TRAVEL_CATEGORY,
    intentKey,
    metadata: {
      hotelId: params.hotelId,
      roomTypeId: params.roomTypeId,
      checkIn: params.checkIn,
      checkOut: params.checkOut,
    },
  });

  // Check if this revived a dormant intent
  if (result.intent.status === 'FULFILLED') {
    const dormantIntents = await dormantIntentService.getUserDormantIntents(params.userId);
    const revived = dormantIntents.find(
      (di) => di.intentKey.includes(params.hotelId || '')
    );
    if (revived) {
      await dormantIntentService.markRevived(revived.id);
    }
  }
}

/**
 * Capture booking cancellation (intent abandoned)
 */
export async function captureBookingCancelled(params: HotelIntentContext): Promise<void> {
  const intentKey = buildHotelIntentKey('cancelled', params);

  await intentCaptureService.capture({
    userId: params.userId,
    appType: HOTEL_APP_TYPE,
    eventType: 'abandoned',
    category: TRAVEL_CATEGORY,
    intentKey,
    metadata: {
      hotelId: params.hotelId,
      roomTypeId: params.roomTypeId,
      reason: 'user_cancelled',
    },
  });
}

/**
 * Build standardized hotel intent key
 */
function buildHotelIntentKey(
  action: string,
  params: HotelIntentContext
): string {
  const parts = [
    'hotel',
    action,
    params.city?.toLowerCase().replace(/\s+/g, '_') || 'unknown',
    params.hotelId || '',
  ];
  return parts.filter(Boolean).join('_');
}

/**
 * Get active travel intents for a user
 */
export async function getActiveTravelIntents(userId: string) {
  return intentCaptureService.getActiveIntents(userId);
}

/**
 * Hotel OTA Integration object
 */
export const hotelOtaIntegration = {
  captureSearch: captureHotelSearch,
  captureView: captureHotelView,
  captureHold: captureBookingHold,
  captureConfirmed: captureBookingConfirmed,
  captureCancelled: captureBookingCancelled,
  getActiveIntents: getActiveTravelIntents,
};

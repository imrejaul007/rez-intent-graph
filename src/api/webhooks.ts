// ── Intent Graph Webhooks ─────────────────────────────────────────────────────────
// Webhook handlers for external events that trigger intent actions

import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { intentCaptureService } from '../services/IntentCaptureService.js';
import { dormantIntentService } from '../services/DormantIntentService.js';
import { Nudge } from '../models/index.js';

const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => console.log(`[Webhook] ${msg}`, meta || ''),
  warn: (msg: string, meta?: Record<string, unknown>) => console.warn(`[Webhook] ${msg}`, meta || ''),
  error: (msg: string, meta?: Record<string, unknown>) => console.error(`[Webhook] ${msg}`, meta || ''),
};

// ── Webhook Secret Verification ─────────────────────────────────────────────────

function verifyWebhookSecret(req: Request): boolean {
  const secret = process.env.INTENT_WEBHOOK_SECRET;
  if (!secret) {
    // In production, reject if no secret is configured
    if (process.env.NODE_ENV === 'production') {
      logger.error('[Webhook] Production webhook received but no INTENT_WEBHOOK_SECRET configured');
      return false;
    }
    logger.warn('[Webhook] No webhook secret configured — allowing (dev mode only)');
    return true;
  }
  const webhookSecret = req.headers['x-webhook-secret'] as string;
  if (!webhookSecret || webhookSecret !== secret) {
    logger.warn('[Webhook] Invalid or missing webhook secret', {
      hasHeader: !!webhookSecret,
    });
    return false;
  }
  return true;
}

// ── Hotel OTA Events ───────────────────────────────────────────────────────────

/**
 * POST /api/webhooks/hotel/search
 * Captures hotel search intent
 */
export async function handleHotelSearch(req: Request, res: Response): Promise<void> {
  if (!verifyWebhookSecret(req)) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  const { userId, hotelId, city, checkIn, checkout, guests } = req.body;

  if (!userId) {
    res.status(400).json({ success: false, message: 'userId is required' });
    return;
  }

  try {
    await intentCaptureService.capture({
      userId,
      appType: 'hotel_ota',
      eventType: 'search',
      category: 'TRAVEL',
      intentKey: `hotel_search_${city?.toLowerCase().replace(/\s+/g, '_') || 'unknown'}`,
      intentQuery: `${city || ''} hotels`,
      metadata: { hotelId, city, checkIn, checkout, guests },
    });

    res.json({ success: true });
  } catch (error) {
    logger.error('[Webhook] Hotel search capture failed', { error });
    res.status(500).json({ success: false, message: 'Failed to capture intent' });
  }
}

/**
 * POST /api/webhooks/hotel/hold
 * Captures booking hold intent
 */
export async function handleHotelHold(req: Request, res: Response): Promise<void> {
  if (!verifyWebhookSecret(req)) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  const { userId, hotelId, roomTypeId, checkIn, checkout } = req.body;

  if (!userId || !hotelId) {
    res.status(400).json({ success: false, message: 'userId and hotelId are required' });
    return;
  }

  try {
    await intentCaptureService.capture({
      userId,
      appType: 'hotel_ota',
      eventType: 'hold',
      category: 'TRAVEL',
      intentKey: `hotel_hold_${hotelId}_${roomTypeId || 'default'}`,
      metadata: { hotelId, roomTypeId, checkIn, checkout },
    });

    res.json({ success: true });
  } catch (error) {
    logger.error('[Webhook] Hotel hold capture failed', { error });
    res.status(500).json({ success: false, message: 'Failed to capture intent' });
  }
}

/**
 * POST /api/webhooks/hotel/confirm
 * Captures booking confirmation (intent fulfilled)
 */
export async function handleHotelConfirm(req: Request, res: Response): Promise<void> {
  if (!verifyWebhookSecret(req)) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  const { userId, hotelId, bookingId } = req.body;

  if (!userId || !hotelId) {
    res.status(400).json({ success: false, message: 'userId and hotelId are required' });
    return;
  }

  try {
    const result = await intentCaptureService.capture({
      userId,
      appType: 'hotel_ota',
      eventType: 'fulfilled',
      category: 'TRAVEL',
      intentKey: `hotel_fulfilled_${hotelId}`,
      metadata: { hotelId, bookingId },
    });

    // Check if this revived a dormant intent
    if (result.intent.status === 'FULFILLED') {
      const dormantIntents = await dormantIntentService.getUserDormantIntents(userId);
      const revived = dormantIntents.find((di) => di.intentKey.includes(hotelId));
      if (revived) {
        await dormantIntentService.markRevived(revived.id);
        logger.info('[Webhook] Dormant intent revived', { dormantIntentId: revived.id });
      }
    }

    res.json({ success: true, data: { revived: result.intent.status === 'FULFILLED' } });
  } catch (error) {
    logger.error('[Webhook] Hotel confirm capture failed', { error });
    res.status(500).json({ success: false, message: 'Failed to capture intent' });
  }
}

// ── Restaurant/Order Events ─────────────────────────────────────────────────────

/**
 * POST /api/webhooks/restaurant/view
 * Captures restaurant/menu view intent
 */
export async function handleRestaurantView(req: Request, res: Response): Promise<void> {
  if (!verifyWebhookSecret(req)) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  const { userId, merchantId, storeSlug, category } = req.body;

  if (!userId || !merchantId) {
    res.status(400).json({ success: false, message: 'userId and merchantId are required' });
    return;
  }

  try {
    await intentCaptureService.capture({
      userId,
      appType: 'restaurant',
      eventType: 'view',
      category: 'DINING',
      intentKey: `restaurant_view_${merchantId}`,
      metadata: { merchantId, storeSlug, category },
    });

    res.json({ success: true });
  } catch (error) {
    logger.error('[Webhook] Restaurant view capture failed', { error });
    res.status(500).json({ success: false, message: 'Failed to capture intent' });
  }
}

/**
 * POST /api/webhooks/restaurant/add-to-cart
 * Captures add to cart intent
 */
export async function handleAddToCart(req: Request, res: Response): Promise<void> {
  if (!verifyWebhookSecret(req)) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  const { userId, merchantId, productId, productName } = req.body;

  if (!userId || !merchantId) {
    res.status(400).json({ success: false, message: 'userId and merchantId are required' });
    return;
  }

  try {
    await intentCaptureService.capture({
      userId,
      appType: 'restaurant',
      eventType: 'cart_add',
      category: 'DINING',
      intentKey: `cart_add_${merchantId}_${productId || 'unknown'}`,
      intentQuery: productName,
      metadata: { merchantId, productId, productName },
    });

    res.json({ success: true });
  } catch (error) {
    logger.error('[Webhook] Add to cart capture failed', { error });
    res.status(500).json({ success: false, message: 'Failed to capture intent' });
  }
}

/**
 * POST /api/webhooks/restaurant/order
 * Captures order placed (intent fulfilled)
 */
export async function handleOrderPlaced(req: Request, res: Response): Promise<void> {
  if (!verifyWebhookSecret(req)) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  const { userId, merchantId, orderId } = req.body;

  if (!userId || !merchantId) {
    res.status(400).json({ success: false, message: 'userId and merchantId are required' });
    return;
  }

  try {
    const result = await intentCaptureService.capture({
      userId,
      appType: 'restaurant',
      eventType: 'fulfilled',
      category: 'DINING',
      intentKey: `order_fulfilled_${merchantId}`,
      metadata: { merchantId, orderId },
    });

    // Check if this revived a dormant intent
    if (result.intent.status === 'FULFILLED') {
      const dormantIntents = await dormantIntentService.getUserDormantIntents(userId);
      const revived = dormantIntents.find((di) => di.intentKey.includes(merchantId));
      if (revived) {
        await dormantIntentService.markRevived(revived.id);
        logger.info('[Webhook] Dormant restaurant intent revived', { dormantIntentId: revived.id });
      }
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('[Webhook] Order capture failed', { error });
    res.status(500).json({ success: false, message: 'Failed to capture intent' });
  }
}

// ── Nudge Events ────────────────────────────────────────────────────────────────

/**
 * POST /api/webhooks/nudge/delivered
 * Records nudge delivery event
 */
export async function handleNudgeDelivered(req: Request, res: Response): Promise<void> {
  if (!verifyWebhookSecret(req)) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  const { nudgeId } = req.body;

  if (!nudgeId) {
    res.status(400).json({ success: false, message: 'nudgeId is required' });
    return;
  }

  try {
    await Nudge.findByIdAndUpdate(nudgeId, {
      $set: { status: 'delivered', deliveredAt: new Date() },
    });
    logger.info('[Webhook] Nudge delivered event', { nudgeId });
    res.json({ success: true, message: 'Nudge delivery recorded' });
  } catch (error) {
    logger.error('[Webhook] Nudge delivered update failed', { nudgeId, error });
    res.status(500).json({ success: false, message: 'Failed to update nudge status' });
  }
}

/**
 * POST /api/webhooks/nudge/clicked
 * Records nudge click event
 */
export async function handleNudgeClicked(req: Request, res: Response): Promise<void> {
  if (!verifyWebhookSecret(req)) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  const { nudgeId } = req.body;

  if (!nudgeId) {
    res.status(400).json({ success: false, message: 'nudgeId is required' });
    return;
  }

  try {
    await Nudge.findByIdAndUpdate(nudgeId, {
      $set: { status: 'clicked', clickedAt: new Date() },
    });
    logger.info('[Webhook] Nudge clicked event', { nudgeId });
    res.json({ success: true, message: 'Nudge click recorded' });
  } catch (error) {
    logger.error('[Webhook] Nudge clicked update failed', { nudgeId, error });
    res.status(500).json({ success: false, message: 'Failed to update nudge status' });
  }
}

/**
 * POST /api/webhooks/nudge/converted
 * Records nudge conversion event
 */
export async function handleNudgeConverted(req: Request, res: Response): Promise<void> {
  if (!verifyWebhookSecret(req)) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  const { nudgeId, dormantIntentId } = req.body;

  if (!nudgeId) {
    res.status(400).json({ success: false, message: 'nudgeId is required' });
    return;
  }

  try {
    await Nudge.findByIdAndUpdate(nudgeId, {
      $set: { status: 'converted', convertedAt: new Date() },
    });
    logger.info('[Webhook] Nudge converted event', { nudgeId, dormantIntentId });
    if (dormantIntentId) {
      await dormantIntentService.markRevived(dormantIntentId);
    }
    res.json({ success: true, message: 'Nudge conversion recorded' });
  } catch (error) {
    logger.error('[Webhook] Record conversion failed', { error });
    res.status(500).json({ success: false, message: 'Failed to record conversion' });
  }
}

// ── Batch Events ────────────────────────────────────────────────────────────────

/**
 * POST /api/webhooks/batch/capture
 * Batch capture multiple intent events
 */
export async function handleBatchCapture(req: Request, res: Response): Promise<void> {
  if (!verifyWebhookSecret(req)) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  const { events } = req.body;

  if (!Array.isArray(events)) {
    res.status(400).json({ success: false, message: 'events array is required' });
    return;
  }

  const results: Array<{ index: number; success: boolean; error?: string }> = [];

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    try {
      await intentCaptureService.capture({
        userId: event.userId,
        appType: event.appType || 'general',
        eventType: event.eventType || 'view',
        category: event.category || 'GENERAL',
        intentKey: event.intentKey,
        intentQuery: event.intentQuery,
        metadata: event.metadata,
      });
      results.push({ index: i, success: true });
    } catch (error) {
      results.push({ index: i, success: false, error: String(error) });
    }
  }

  const successCount = results.filter((r) => r.success).length;
  logger.info('[Webhook] Batch capture completed', { total: events.length, success: successCount });

  res.json({ success: true, data: { results } });
}

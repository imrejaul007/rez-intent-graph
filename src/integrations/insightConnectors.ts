/**
 * Insight Service Connectors
 * Subscribes to ReZ Mind insight events and triggers downstream actions
 *
 * - Order Service: Check for upsell insights before checkout
 * - Marketing Service: Apply campaign insights
 * - Wallet Service: Trigger coin offers based on insights
 */

import { subscribeToEvent } from '../eventBus.js';
import { SERVICE_URLS } from '../config/services.js';

const logger = {
  info: (msg: string, meta?: Record<string, unknown>) =>
    console.log(`[InsightConnectors] ${msg}`, meta || ''),
  warn: (msg: string, meta?: Record<string, unknown>) =>
    console.warn(`[InsightConnectors] ${msg}`, meta || ''),
  error: (msg: string, meta?: Record<string, unknown>) =>
    console.error(`[InsightConnectors] ${msg}`, meta || ''),
};

interface InsightData {
  userId?: string;
  insightType?: string;
  title?: string;
  recommendation?: string;
  confidence?: number;
  priority?: 'high' | 'medium' | 'low';
  metadata?: Record<string, unknown>;
}

/**
 * Connect to Order Service - handle upsell insights
 */
async function handleUpsellInsight(data: InsightData): Promise<void> {
  if (data.insightType !== 'upsell') return;

  try {
    const response = await fetch(`${SERVICE_URLS.order}/api/insights/upsell`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': process.env.INTERNAL_TOKEN || '',
      },
      body: JSON.stringify({
        userId: data.userId,
        insightType: data.insightType,
        title: data.title,
        recommendation: data.recommendation,
        confidence: data.confidence,
        priority: data.priority,
        metadata: data.metadata,
      }),
    });

    if (response.ok) {
      logger.info('Upsell insight sent to order service', {
        userId: data.userId,
        priority: data.priority,
      });
    } else {
      logger.warn('Order service rejected upsell insight', {
        status: response.status,
      });
    }
  } catch (error) {
    logger.error('Failed to send upsell to order service', { error });
  }
}

/**
 * Connect to Marketing Service - apply campaign insights
 */
async function handleCampaignInsight(data: InsightData): Promise<void> {
  const campaignTypes = ['cross_sell', 'loyalty', 'personalization'];

  if (!campaignTypes.includes(data.insightType as typeof campaignTypes[number])) return;

  try {
    const response = await fetch(`${SERVICE_URLS.marketing}/api/insights/campaign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': process.env.INTERNAL_TOKEN || '',
      },
      body: JSON.stringify({
        userId: data.userId,
        campaignType: data.insightType,
        title: data.title,
        recommendation: data.recommendation,
        confidence: data.confidence,
        priority: data.priority,
        metadata: data.metadata,
      }),
    });

    if (response.ok) {
      logger.info('Campaign insight sent to marketing service', {
        userId: data.userId,
        campaignType: data.insightType,
      });
    } else {
      logger.warn('Marketing service rejected campaign insight', {
        status: response.status,
      });
    }
  } catch (error) {
    logger.error('Failed to send campaign to marketing service', { error });
  }
}

/**
 * Connect to Wallet Service - trigger coin offers
 */
async function handleCoinOfferInsight(data: InsightData): Promise<void> {
  const coinOfferTypes = ['loyalty', 'dormant_recovery', 'cross_sell'];

  if (!coinOfferTypes.includes(data.insightType as typeof coinOfferTypes[number])) return;
  if ((data.confidence ?? 0) < 0.5) return; // Only high-confidence insights trigger coin offers

  const coinAmount = calculateCoinOffer(data);

  try {
    const response = await fetch(`${SERVICE_URLS.wallet}/api/offers/insight-triggered`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': process.env.INTERNAL_TOKEN || '',
      },
      body: JSON.stringify({
        userId: data.userId,
        offerType: data.insightType,
        coinAmount,
        reason: data.title,
        metadata: data.metadata,
      }),
    });

    if (response.ok) {
      logger.info('Coin offer triggered via wallet service', {
        userId: data.userId,
        coinAmount,
        insightType: data.insightType,
      });
    } else {
      logger.warn('Wallet service rejected coin offer', {
        status: response.status,
      });
    }
  } catch (error) {
    logger.error('Failed to trigger coin offer via wallet service', { error });
  }
}

/**
 * Calculate coin offer amount based on insight type and confidence
 */
function calculateCoinOffer(data: InsightData): number {
  const baseOffers: Record<string, number> = {
    loyalty: 100,
    dormant_recovery: 75,
    cross_sell: 50,
    personalization: 25,
  };

  const base = data.insightType ? (baseOffers[data.insightType] || 25) : 25;
  const confidenceMultiplier = 0.5 + (data.confidence ?? 0) * 0.5; // 0.5-1.0 based on confidence
  const priorityMultiplier = data.priority === 'high' ? 1.5 : data.priority === 'medium' ? 1.0 : 0.5;

  return Math.round(base * confidenceMultiplier * priorityMultiplier);
}

/**
 * Initialize all insight connectors
 */
export function initializeInsightConnectors(): void {
  logger.info('Initializing insight service connectors');

  // Subscribe to insight.generated events
  subscribeToEvent('insight.generated', async (data) => {
    const insightData = data as unknown as InsightData;

    // Run all connectors in parallel
    await Promise.allSettled([
      handleUpsellInsight(insightData),
      handleCampaignInsight(insightData),
      handleCoinOfferInsight(insightData),
    ]);
  });

  logger.info('Insight connectors initialized successfully');
}

// Auto-initialize when imported
let initialized = false;
export function ensureInitialized(): void {
  if (!initialized) {
    initialized = true;
    initializeInsightConnectors();
  }
}

// Initialize on first import
ensureInitialized();

// ── Intent Graph API Routes ──────────────────────────────────────────────────────
// Express routes for RTMN Commerce Memory Intent Graph
// Uses MongoDB for data storage

import { Router, Request, Response } from 'express';
import { intentCaptureService } from '../services/IntentCaptureService.js';
import { dormantIntentService } from '../services/DormantIntentService.js';
import { crossAppAggregationService } from '../services/CrossAppAggregationService.js';
import { Intent, Nudge } from '../models/index.js';
import { verifyInternalToken, verifyApiKey, verifyCronSecret } from '../middleware/auth.js';
import { captureLimiter, nudgeLimiter } from '../middleware/rateLimit.js';

const router = Router();

// ── Capture Intent ────────────────────────────────────────────────────────────

/**
 * POST /api/intent/capture
 * Capture a new intent event
 */
router.post('/capture', verifyInternalToken, captureLimiter, async (req: Request, res: Response) => {
  try {
    const { userId, appType, intentKey, eventType, category, intentQuery, metadata, merchantId } = req.body;

    if (!userId || !appType || !intentKey || !eventType || !category) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const result = await intentCaptureService.capture({
      userId,
      appType,
      intentKey,
      eventType,
      category,
      intentQuery,
      metadata,
      merchantId,
    });

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('[IntentAPI] Capture failed:', error);
    res.status(500).json({ success: false, message: 'Failed to capture intent' });
  }
});

// ── Get Active Intents ────────────────────────────────────────────────────────

/**
 * GET /api/intent/active/:userId
 * Get active intents for a user
 */
router.get('/active/:userId', verifyInternalToken, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const intents = await intentCaptureService.getActiveIntents(userId);
    res.json({ success: true, data: intents });
  } catch (error) {
    console.error('[IntentAPI] Get active intents failed:', error);
    res.status(500).json({ success: false, message: 'Failed to get active intents' });
  }
});

// ── Get All User Intents ──────────────────────────────────────────────────────

/**
 * GET /api/intent/user/:userId
 * Get all intents for a user
 */
router.get('/user/:userId', verifyInternalToken, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const intents = await intentCaptureService.getUserIntents(userId);
    res.json({ success: true, data: intents });
  } catch (error) {
    console.error('[IntentAPI] Get user intents failed:', error);
    res.status(500).json({ success: false, message: 'Failed to get user intents' });
  }
});

// ── Get Dormant Intents ──────────────────────────────────────────────────────

/**
 * GET /api/intent/dormant/:userId
 * Get dormant intents for a user
 */
router.get('/dormant/:userId', verifyInternalToken, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const dormantIntents = await dormantIntentService.getUserDormantIntents(userId);
    res.json({ success: true, data: dormantIntents });
  } catch (error) {
    console.error('[IntentAPI] Get dormant intents failed:', error);
    res.status(500).json({ success: false, message: 'Failed to get dormant intents' });
  }
});

// ── Get Cross-App Profile ─────────────────────────────────────────────────────

/**
 * GET /api/intent/profile/:userId
 * Get cross-app intent profile for a user
 */
router.get('/profile/:userId', verifyInternalToken, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const profile = await crossAppAggregationService.getProfile(userId);
    res.json({ success: true, data: profile });
  } catch (error) {
    console.error('[IntentAPI] Get profile failed:', error);
    res.status(500).json({ success: false, message: 'Failed to get profile' });
  }
});

// ── Get Enriched Context ──────────────────────────────────────────────────────

/**
 * GET /api/intent/enriched/:userId
 * Get comprehensive enriched context for an agent
 */
router.get('/enriched/:userId', verifyInternalToken, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const context = await crossAppAggregationService.getEnrichedContext(userId);
    res.json({ success: true, data: context });
  } catch (error) {
    console.error('[IntentAPI] Get enriched context failed:', error);
    res.status(500).json({ success: false, message: 'Failed to get enriched context' });
  }
});

// ── Trigger Revival ────────────────────────────────────────────────────────────

/**
 * POST /api/intent/revival
 * Trigger revival for a dormant intent
 */
router.post('/revival', verifyInternalToken, async (req: Request, res: Response) => {
  try {
    const { dormantIntentId, triggerType } = req.body;

    if (!dormantIntentId || !triggerType) {
      return res.status(400).json({ success: false, message: 'dormantIntentId and triggerType are required' });
    }

    const candidate = await dormantIntentService.triggerRevival(
      dormantIntentId,
      triggerType as 'price_drop' | 'return_user' | 'seasonality' | 'offer_match' | 'manual'
    );

    if (!candidate) {
      return res.status(404).json({ success: false, message: 'Dormant intent not found or not eligible for revival' });
    }

    res.json({ success: true, data: candidate });
  } catch (error) {
    console.error('[IntentAPI] Trigger revival failed:', error);
    res.status(500).json({ success: false, message: 'Failed to trigger revival' });
  }
});

// ── Mark Revived ─────────────────────────────────────────────────────────────

/**
 * POST /api/intent/revived/:dormantIntentId
 * Mark a dormant intent as revived (user converted)
 */
router.post('/revived/:dormantIntentId', verifyInternalToken, async (req: Request, res: Response) => {
  try {
    const { dormantIntentId } = req.params;
    await dormantIntentService.markRevived(dormantIntentId);
    res.json({ success: true });
  } catch (error) {
    console.error('[IntentAPI] Mark revived failed:', error);
    res.status(500).json({ success: false, message: 'Failed to mark as revived' });
  }
});

// ── Get Scheduled Revivals ───────────────────────────────────────────────────

/**
 * GET /api/intent/scheduled-revivals
 * Get dormant intents due for nudge
 */
router.get('/scheduled-revivals', verifyInternalToken, async (req: Request, res: Response) => {
  try {
    const candidates = await dormantIntentService.getScheduledRevivals();
    res.json({ success: true, data: candidates });
  } catch (error) {
    console.error('[IntentAPI] Get scheduled revivals failed:', error);
    res.status(500).json({ success: false, message: 'Failed to get scheduled revivals' });
  }
});

// ── Pause Nudges ─────────────────────────────────────────────────────────────

/**
 * POST /api/intent/pause/:dormantIntentId
 * Pause nudges for a dormant intent
 */
router.post('/pause/:dormantIntentId', verifyInternalToken, async (req: Request, res: Response) => {
  try {
    const { dormantIntentId } = req.params;
    await dormantIntentService.pauseNudges(dormantIntentId);
    res.json({ success: true });
  } catch (error) {
    console.error('[IntentAPI] Pause nudges failed:', error);
    res.status(500).json({ success: false, message: 'Failed to pause nudges' });
  }
});

// ── Merchant Demand Aggregation ────────────────────────────────────────────────

/**
 * GET /api/intent/merchant-demand/:merchantId
 * Get demand signals for a merchant
 */
router.get('/merchant-demand/:merchantId', verifyInternalToken, async (req: Request, res: Response) => {
  try {
    const { merchantId } = req.params;
    const category = (req.query.category as string) || 'DINING';
    const demand = await crossAppAggregationService.aggregateMerchantDemand(merchantId, category);
    res.json({ success: true, data: demand });
  } catch (error) {
    console.error('[IntentAPI] Get merchant demand failed:', error);
    res.status(500).json({ success: false, message: 'Failed to get merchant demand' });
  }
});

// ── User Affinities ───────────────────────────────────────────────────────────

/**
 * GET /api/intent/affinities/:userId
 * Get user affinity scores across categories
 */
router.get('/affinities/:userId', verifyInternalToken, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const affinities = await crossAppAggregationService.getUserAffinities(userId);
    res.json({ success: true, data: affinities });
  } catch (error) {
    console.error('[IntentAPI] Get affinities failed:', error);
    res.status(500).json({ success: false, message: 'Failed to get affinities' });
  }
});

// ── Cron: Detect Dormant Intents ──────────────────────────────────────────────

/**
 * POST /api/intent/cron/detect-dormant
 * Detect and mark intents as dormant (called by scheduler)
 */
router.post('/cron/detect-dormant', verifyCronSecret, async (req: Request, res: Response) => {
  try {
    const result = await dormantIntentService.detectAndMarkDormant();
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('[IntentAPI] Detect dormant failed:', error);
    res.status(500).json({ success: false, message: 'Failed to detect dormant intents' });
  }
});

// ── Cron: Update Revival Scores ─────────────────────────────────────────────

/**
 * POST /api/intent/cron/update-scores
 * Update revival scores for all dormant intents (called by scheduler)
 */
router.post('/cron/update-scores', verifyCronSecret, async (req: Request, res: Response) => {
  try {
    const updated = await dormantIntentService.updateRevivalScores();
    res.json({ success: true, data: { updated } });
  } catch (error) {
    console.error('[IntentAPI] Update scores failed:', error);
    res.status(500).json({ success: false, message: 'Failed to update revival scores' });
  }
});

// ── Nudge Management ─────────────────────────────────────────────────────────

/**
 * POST /api/intent/nudge/send
 * Manually send a nudge — requires auth
 */
router.post('/nudge/send', verifyInternalToken, nudgeLimiter, async (req: Request, res: Response) => {
  try {
    const { userId, intentKey, message, channel = 'push' } = req.body;

    if (!userId || !intentKey) {
      return res.status(400).json({ success: false, message: 'userId and intentKey are required' });
    }

    // Find dormant intent
    const dormant = await dormantIntentService.getUserDormantIntents(userId);
    const match = dormant.find((d) => d.intentKey === intentKey);

    if (match) {
      await dormantIntentService.createNudge(
        match._id.toString(),
        userId,
        channel as 'push' | 'email' | 'sms' | 'in_app',
        message || `We noticed you were interested in ${intentKey}`
      );
      await dormantIntentService.recordNudgeSent(match._id.toString());
    }

    res.json({ success: true, data: { intentKey, channel } });
  } catch (error) {
    console.error('[IntentAPI] Send nudge failed:', error);
    res.status(500).json({ success: false, message: 'Failed to send nudge' });
  }
});

/**
 * GET /api/intent/nudge/history/:userId
 * Get nudge history for a user
 */
router.get('/nudge/history/:userId', verifyInternalToken, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const nudges = await Nudge.find({ userId })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json({ success: true, data: nudges });
  } catch (error) {
    console.error('[IntentAPI] Get nudge history failed:', error);
    res.status(500).json({ success: false, message: 'Failed to get nudge history' });
  }
});

// ── Stats ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/intent/stats
 * Get intent graph statistics
 */
router.get('/stats', verifyInternalToken, async (req: Request, res: Response) => {
  try {
    const summary = await crossAppAggregationService.getCrossAppSummary();
    const intentCount = await Intent.countDocuments();
    const dormantCount = await Intent.countDocuments({ status: 'DORMANT' });

    res.json({
      success: true,
      data: {
        totalIntents: intentCount,
        dormantIntents: dormantCount,
        ...summary,
      },
    });
  } catch (error) {
    console.error('[IntentAPI] Get stats failed:', error);
    res.status(500).json({ success: false, message: 'Failed to get stats' });
  }
});

// ── ReZ Mind Insights ────────────────────────────────────────────────────────

/**
 * POST /api/intent/insights/generate
 * Generate insights for a user based on their intent profile
 */
router.post('/insights/generate', verifyInternalToken, async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required' });
    }

    const { generateInsights } = await import('../services/insightService.js');
    const results = await generateInsights(userId);

    res.json({
      success: true,
      data: {
        count: results.length,
        insights: results.map((r) => r.insight),
        stored: results.filter((r) => r.stored).length,
      },
    });
  } catch (error) {
    console.error('[IntentAPI] Generate insights failed:', error);
    res.status(500).json({ success: false, message: 'Failed to generate insights' });
  }
});

/**
 * GET /api/intent/insights/:userId
 * Get existing insights for a user
 */
router.get('/insights/:userId', verifyInternalToken, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const { getInsights } = await import('../services/insightService.js');
    const insights = await getInsights(userId);

    res.json({ success: true, data: insights });
  } catch (error) {
    console.error('[IntentAPI] Get insights failed:', error);
    res.status(500).json({ success: false, message: 'Failed to get insights' });
  }
});

// ── Similarity Search ────────────────────────────────────────────────────────

/**
 * GET /api/intent/similar
 * Find similar intents for a user
 * ?userId=<id>&intentKey=<key>&category=<cat>&limit=10
 */
router.get('/similar', verifyInternalToken, async (req: Request, res: Response) => {
  try {
    const { userId, intentKey, category, limit } = req.query;

    if (!userId || !intentKey) {
      return res.status(400).json({ success: false, message: 'userId and intentKey are required' });
    }

    const results = await intentCaptureService.findSimilarIntents(
      userId as string,
      intentKey as string,
      category as string | undefined,
      limit ? parseInt(limit as string) : 10
    );

    res.json({ success: true, data: results });
  } catch (error) {
    console.error('[IntentAPI] Find similar failed:', error);
    res.status(500).json({ success: false, message: 'Failed to find similar intents' });
  }
});

/**
 * GET /api/intent/recommendations
 * Get recommendations for a user based on similar users
 * ?userId=<id>&category=<cat>&limit=10
 */
router.get('/recommendations', verifyInternalToken, async (req: Request, res: Response) => {
  try {
    const { userId, category, limit } = req.query;

    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required' });
    }

    const recommendations = await intentCaptureService.getRecommendations(
      userId as string,
      category as string | undefined,
      limit ? parseInt(limit as string) : 10
    );

    res.json({ success: true, data: { recommendations } });
  } catch (error) {
    console.error('[IntentAPI] Get recommendations failed:', error);
    res.status(500).json({ success: false, message: 'Failed to get recommendations' });
  }
});

/**
 * GET /api/intent/similar/global
 * Find similar intents across all users (for demand signals)
 * ?intentKey=<key>&category=<cat>&limit=20
 */
router.get('/similar/global', verifyInternalToken, async (req: Request, res: Response) => {
  try {
    const { intentKey, category, limit } = req.query;

    if (!intentKey) {
      return res.status(400).json({ success: false, message: 'intentKey is required' });
    }

    const { vectorSimilarityService } = await import('../services/VectorSimilarityService.js');
    const results = await vectorSimilarityService.findSimilarIntentsGlobal(
      intentKey as string,
      category as string | undefined,
      limit ? parseInt(limit as string) : 20
    );

    res.json({ success: true, data: results });
  } catch (error) {
    console.error('[IntentAPI] Find global similar failed:', error);
    res.status(500).json({ success: false, message: 'Failed to find global similar intents' });
  }
});

export default router;

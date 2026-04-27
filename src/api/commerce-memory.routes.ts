// ── Commerce Memory Context API Routes ──────────────────────────────────────────
// API endpoints for Commerce Memory context (used by Chat AI and Support Provider)
// Uses MongoDB for data storage

import { Router, Request, Response } from 'express';
import { Intent, DormantIntent } from '../models/index.js';
import { dormantIntentService } from '../services/DormantIntentService.js';
import { crossAppAggregationService } from '../services/CrossAppAggregationService.js';
import { verifyInternalToken } from '../middleware/auth.js';
import { strictLimiter } from '../middleware/rateLimit.js';

const router = Router();

// ── Get Commerce Memory Context ──────────────────────────────────────────────────

/**
 * GET /api/commerce-memory/context/:userId
 * Get comprehensive Commerce Memory context for a user
 * Used by Chat AI and Support Provider
 */
router.get('/context/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    // Get active intents
    const activeIntents = await Intent.find(
      { userId, status: 'ACTIVE' },
      {
        intentKey: 1,
        category: 1,
        confidence: 1,
        lastSeenAt: 1,
        metadata: 1,
      }
    )
      .sort({ lastSeenAt: -1 })
      .limit(10);

    // Get dormant intents
    const dormantIntents = await DormantIntent.find(
      { userId, status: 'active' },
      {
        intentKey: 1,
        category: 1,
        dormancyScore: 1,
        revivalScore: 1,
        daysDormant: 1,
        lastNudgeSent: 1,
      }
    )
      .sort({ revivalScore: -1 })
      .limit(5);

    // Get user profile
    const profile = await crossAppAggregationService.getProfile(userId);

    // Format response for CommerceMemorySupportProvider
    const context = {
      activeIntents: activeIntents.map((i) => ({
        key: i.intentKey,
        category: i.category,
        confidence: i.confidence,
        lastSeen: formatRelativeTime(i.lastSeenAt),
      })),
      dormantIntents: dormantIntents.map((d) => ({
        key: d.intentKey,
        category: d.category,
        confidence: d.dormancyScore,
        lastSeen: formatRelativeTime(d.lastNudgeSent || new Date(Date.now() - d.daysDormant * 24 * 60 * 60 * 1000)),
        daysDormant: d.daysDormant,
        revivalScore: d.revivalScore,
      })),
      profile: profile ? {
        travelAffinity: profile.travelAffinity,
        diningAffinity: profile.diningAffinity,
        retailAffinity: profile.retailAffinity,
        preferredChannel: 'push',
        totalConversions: profile.totalConversions,
      } : null,
      recentOrders: [], // Orders come from the orders service
      recommendations: generateRecommendations(activeIntents, dormantIntents),
    };

    res.json(context);
  } catch (error) {
    console.error('[CommerceMemoryAPI] Get context failed:', error);
    res.status(500).json({ error: 'Failed to get Commerce Memory context' });
  }
});

// ── Trigger Revival ─────────────────────────────────────────────────────────────

/**
 * POST /api/commerce-memory/revival/trigger
 * Trigger revival for a dormant intent
 * Used by Support Provider
 */
router.post('/revival/trigger', async (req: Request, res: Response) => {
  try {
    const { userId, intentKey } = req.body;

    if (!userId || !intentKey) {
      return res.status(400).json({ error: 'Missing userId or intentKey' });
    }

    // Find dormant intent
    const dormantIntent = await DormantIntent.findOne({
      userId,
      intentKey,
      status: 'active',
    });

    if (!dormantIntent) {
      return res.status(404).json({ error: 'Dormant intent not found' });
    }

    res.json({ success: true, dormantIntentId: dormantIntent._id.toString() });
  } catch (error) {
    console.error('[CommerceMemoryAPI] Trigger revival failed:', error);
    res.status(500).json({ error: 'Failed to trigger revival' });
  }
});

// ── Send Offer ─────────────────────────────────────────────────────────────────

/**
 * POST /api/commerce-memory/offer/send
 * Send a personalized offer for a dormant intent
 * Used by Support Provider
 */
router.post('/offer/send', verifyInternalToken, strictLimiter, async (req: Request, res: Response) => {
  try {
    const { userId, intentKey, offer } = req.body;

    if (!userId || !intentKey || !offer) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Find dormant intent
    const dormantIntent = await DormantIntent.findOne({
      userId,
      intentKey,
      status: 'active',
    });

    if (!dormantIntent) {
      return res.status(404).json({ error: 'Dormant intent not found' });
    }

    res.json({ success: true, offerSent: offer });
  } catch (error) {
    console.error('[CommerceMemoryAPI] Send offer failed:', error);
    res.status(500).json({ error: 'Failed to send offer' });
  }
});

// ── Get Enriched Context ───────────────────────────────────────────────────────

/**
 * GET /api/commerce-memory/enriched/:userId
 * Get enriched context for AI agents
 */
router.get('/enriched/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const context = await crossAppAggregationService.getEnrichedContext(userId);
    res.json(context);
  } catch (error) {
    console.error('[CommerceMemoryAPI] Get enriched context failed:', error);
    res.status(500).json({ error: 'Failed to get enriched context' });
  }
});

// ── Health Check ──────────────────────────────────────────────────────────────

/**
 * GET /api/commerce-memory/health
 * Health check endpoint
 */
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatRelativeTime(date: Date | null): string {
  if (!date) return 'unknown';

  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 60) return `${diffMins} minutes ago`;
  if (diffHours < 24) return `${diffHours} hours ago`;
  if (diffDays < 7) return `${diffDays} days ago`;
  return `${Math.floor(diffDays / 7)} weeks ago`;
}

function generateRecommendations(
  activeIntents: Array<{ intentKey: string; confidence: number }>,
  dormantIntents: Array<{ intentKey: string; revivalScore: number }>
): string[] {
  const recommendations: string[] = [];

  // Recommend revival for high-score dormant intents
  for (const dormant of dormantIntents) {
    if (dormant.revivalScore > 0.7) {
      recommendations.push(`High-potential revival: ${dormant.intentKey.replace(/_/g, ' ')}`);
    }
  }

  // Recommend follow-up for high-confidence active intents
  for (const active of activeIntents) {
    if (active.confidence > 0.8) {
      recommendations.push(`Strong intent detected: ${active.intentKey.replace(/_/g, ' ')}`);
    }
  }

  return recommendations.slice(0, 5);
}

export default router;

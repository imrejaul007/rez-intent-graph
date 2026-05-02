// ── Merchant Demand API Routes ──────────────────────────────────────────────────────
// Phase 5: Demand Signals for Merchants - Procurement Intelligence
// MongoDB implementation

import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Intent, MerchantDemandSignal } from '../models/index.js';
import { sharedMemory } from '../agents/shared-memory.js';

const router = Router();

// ── Merchant Authentication Middleware ──────────────────────────────────────────

interface MerchantAuthPayload {
  merchantId?: string;
  role?: string;
}

function verifyMerchantAuth(req: Request, res: Response, next: Function): void {
  const merchantToken = req.headers['x-merchant-token'] as string;
  const internalToken = req.headers['x-internal-token'] as string;
  const apiKey = req.headers['x-api-key'] as string;

  // Internal service token (server-to-server)
  const tokenEnv = process.env.INTERNAL_SERVICE_TOKEN;
  const apiKeyEnv = process.env.MERCHANT_API_KEY;
  const merchantJwtSecret = process.env.JWT_MERCHANT_SECRET;

  if (internalToken && tokenEnv && internalToken === tokenEnv) {
    // Internal service has full access
    (req as any).merchantAuth = { type: 'internal' };
    next();
    return;
  }

  // API key auth — API keys have full access
  if (apiKey && apiKeyEnv && apiKey === apiKeyEnv) {
    (req as any).merchantAuth = { type: 'api_key' };
    next();
    return;
  }

  // Merchant token auth — require both header presence AND non-empty value
  if (!merchantToken || merchantToken.trim() === '') {
    res.status(401).json({ error: 'Authentication required. Provide x-internal-token, x-api-key, or x-merchant-token header.' });
    return;
  }

  // Validate merchant JWT token to extract merchantId for authorization
  if (merchantJwtSecret && merchantToken.length > 20) {
    try {
      const decoded = jwt.verify(merchantToken, merchantJwtSecret, { algorithms: ['HS256'] }) as MerchantAuthPayload;
      if (decoded.merchantId) {
        (req as any).merchantAuth = {
          type: 'merchant',
          merchantId: decoded.merchantId,
          role: decoded.role
        };
        next();
        return;
      }
    } catch {
      // Token verification failed, continue to legacy check
    }
  }

  // Legacy check: require properly formatted token (non-empty, min 16 chars)
  // SECURITY NOTE: This is a fallback for legacy merchant tokens that aren't JWTs.
  // In production, all merchant tokens should be JWTs with embedded merchantId.
  if (process.env.NODE_ENV === 'production') {
    res.status(401).json({
      error: 'Invalid merchant token. Merchant tokens must be JWTs containing merchantId claim.'
    });
    return;
  }

  // Development fallback (remove in production!)
  (req as any).merchantAuth = { type: 'dev_fallback' };
  next();
}

/**
 * Middleware to verify the requesting merchant can access the requested merchantId
 * Prevents IDOR attacks where Merchant A accesses Merchant B's data
 */
function authorizeMerchantAccess(req: Request, res: Response, next: Function): void {
  const requestedMerchantId = req.params.merchantId;
  const auth = (req as any).merchantAuth;

  if (!requestedMerchantId) {
    next();
    return;
  }

  // Internal services and API keys have full access
  if (auth?.type === 'internal' || auth?.type === 'api_key') {
    next();
    return;
  }

  // For merchant tokens, verify ownership
  if (auth?.type === 'merchant') {
    if (auth.merchantId !== requestedMerchantId) {
      res.status(403).json({
        error: 'Forbidden: You do not have access to this merchant\'s data'
      });
      return;
    }
  }

  // Development fallback allows access (remove in production!)
  if (auth?.type === 'dev_fallback' && process.env.NODE_ENV !== 'production') {
    next();
    return;
  }

  // If no merchantAuth context, reject
  if (!auth) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  next();
}

router.use(verifyMerchantAuth);

// ── Demand Dashboard ────────────────────────────────────────────────────────────

router.get('/:merchantId/demand/dashboard', authorizeMerchantAccess, async (req: Request, res: Response) => {
  const { merchantId } = req.params;
  const { category } = req.query;

  try {
    const categories = category ? [category as string] : ['TRAVEL', 'DINING', 'RETAIL'];

    const dashboard: Record<string, unknown> = {
      merchantId,
      timestamp: new Date().toISOString(),
      categories: {},
    };

    for (const cat of categories) {
      const signal = await sharedMemory.getDemandSignal(merchantId, cat);

      const intentCount = await Intent.countDocuments({ merchantId, category: cat });
      const activeCount = await Intent.countDocuments({ merchantId, category: cat, status: 'ACTIVE' });
      const dormantCount = await Intent.countDocuments({ merchantId, category: cat, status: 'DORMANT' });

      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentSignals = await Intent.countDocuments({
        merchantId,
        category: cat,
        'signals.capturedAt': { $gte: since },
      });

      (dashboard.categories as Record<string, unknown>)[cat] = {
        signal: signal || null,
        stats: {
          totalIntents: intentCount,
          activeIntents: activeCount,
          dormantIntents: dormantCount,
          recentActivity: recentSignals,
        },
        health: signal ? getDemandHealth(signal.demandCount, signal.unmetDemandPct) : 'unknown',
      };
    }

    res.json(dashboard);
  } catch (error) {
    console.error('[MerchantAPI] Dashboard failed:', error);
    res.status(500).json({ error: 'Failed to get dashboard' });
  }
});

// ── Demand Signal ─────────────────────────────────────────────────────────────

router.get('/:merchantId/demand/signal', authorizeMerchantAccess, async (req: Request, res: Response) => {
  const { merchantId } = req.params;
  const { category = 'DINING' } = req.query;

  try {
    const signal = await MerchantDemandSignal.findOne({ merchantId, category: category as string });
    res.json(signal);
  } catch (error) {
    console.error('[MerchantAPI] Demand signal failed:', error);
    res.status(500).json({ error: 'Failed to get demand signal' });
  }
});

// ── Procurement Signals ───────────────────────────────────────────────────────────

router.get('/:merchantId/procurement', async (req: Request, res: Response) => {
  const { merchantId } = req.params;
  const { category = 'DINING' } = req.query;

  try {
    const demandSignals = await MerchantDemandSignal.find({ category: category as string })
      .sort({ demandCount: -1 })
      .limit(100);

    const totalDemand = demandSignals.reduce((sum, s) => sum + s.demandCount, 0);
    const avgUnmetDemand =
      demandSignals.length > 0
        ? demandSignals.reduce((sum, s) => sum + s.unmetDemandPct, 0) / demandSignals.length
        : 0;

    const gaps = demandSignals
      .filter((s) => s.demandCount > 10 && s.unmetDemandPct > 30)
      .map((s) => ({
        merchantId: s.merchantId,
        demandCount: s.demandCount,
        unmetPct: s.unmetDemandPct,
        gapScore: s.demandCount * (s.unmetDemandPct / 100),
      }))
      .sort((a, b) => b.gapScore - a.gapScore)
      .slice(0, 10)
      .map((gap) => ({
        type: 'expand_inventory',
        priority: gap.gapScore > 50 ? 'high' : gap.gapScore > 20 ? 'medium' : 'low',
        demandCount: gap.demandCount,
        unmetDemand: `${gap.unmetPct.toFixed(0)}%`,
        action: `Consider expanding inventory to capture ${gap.demandCount} unmet demand`,
        expectedCapture: `${Math.min(80, gap.unmetPct).toFixed(0)}% conversion if addressed`,
      }));

    const seasonality = getSeasonalityForecast(category as string);

    res.json({
      merchantId,
      category: category,
      totalMarketDemand: totalDemand,
      avgUnmetDemand: avgUnmetDemand.toFixed(1),
      gaps,
      seasonality,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[MerchantAPI] Procurement failed:', error);
    res.status(500).json({ error: 'Failed to get procurement signals' });
  }
});

// ── Top Performing Intents ───────────────────────────────────────────────────────

router.get('/:merchantId/intents/top', authorizeMerchantAccess, async (req: Request, res: Response) => {
  const { merchantId } = req.params;
  const { category, limit = '20' } = req.query;

  try {
    const whereClause: Record<string, unknown> = { merchantId };
    if (category) whereClause.category = category;

    const intents = await Intent.find(whereClause)
      .sort({ confidence: -1 })
      .limit(parseInt(limit as string));

    res.json({
      merchantId,
      intents: intents.map((i) => ({
        id: i._id.toString(),
        intentKey: i.intentKey,
        category: i.category,
        confidence: i.confidence,
        status: i.status,
        signalCount: i.signals?.length || 0,
        firstSeen: i.firstSeenAt,
        lastSeen: i.lastSeenAt,
        conversionPotential:
          i.confidence > 0.7 ? 'high' : i.confidence > 0.4 ? 'medium' : 'low',
      })),
    });
  } catch (error) {
    console.error('[MerchantAPI] Top intents failed:', error);
    res.status(500).json({ error: 'Failed to get top intents' });
  }
});

// ── Demand Trends ───────────────────────────────────────────────────────────────

router.get('/:merchantId/trends', authorizeMerchantAccess, async (req: Request, res: Response) => {
  const { merchantId } = req.params;
  const { category, period = '7d' } = req.query;

  const periodMs =
    period === '24h' ? 24 * 60 * 60 * 1000 :
    period === '7d' ? 7 * 24 * 60 * 60 * 1000 :
    30 * 24 * 60 * 60 * 1000;

  const since = new Date(Date.now() - periodMs);
  const bucketSize = period === '24h' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;

  try {
    const intents = await Intent.find({
      merchantId,
      lastSeenAt: { $gte: since },
      ...(category ? { category } : {}),
    }).select('signals lastSeenAt');

    const buckets: Record<string, { search: number; view: number; wishlist: number; cart: number }> = {};

    for (const intent of intents) {
      for (const signal of intent.signals || []) {
        if (signal.capturedAt < since) continue;
        const bucketTime = new Date(
          Math.floor(signal.capturedAt.getTime() / bucketSize) * bucketSize
        );
        const key = bucketTime.toISOString();

        if (!buckets[key]) {
          buckets[key] = { search: 0, view: 0, wishlist: 0, cart: 0 };
        }

        if (signal.eventType === 'search') buckets[key].search++;
        else if (signal.eventType === 'view') buckets[key].view++;
        else if (signal.eventType === 'wishlist') buckets[key].wishlist++;
        else if (signal.eventType === 'cart_add') buckets[key].cart++;
      }
    }

    const trend = Object.entries(buckets)
      .map(([time, counts]) => ({
        time,
        ...counts,
        total: counts.search + counts.view + counts.wishlist + counts.cart,
      }))
      .sort((a, b) => a.time.localeCompare(b.time));

    const totalSignals = trend.reduce((sum, t) => sum + t.total, 0);
    const avgSignals = trend.length > 0 ? totalSignals / trend.length : 0;
    const firstTrend = trend.length > 0 ? trend[0].total : 0;
    const lastTrend = trend.length > 0 ? trend[trend.length - 1].total : 0;
    const trendDirection =
      lastTrend > firstTrend * 1.1 ? 'rising' :
      lastTrend < firstTrend * 0.9 ? 'declining' : 'stable';

    res.json({
      merchantId,
      category: category || 'all',
      period,
      dataPoints: trend.length,
      summary: {
        totalSignals,
        avgPerBucket: avgSignals.toFixed(1),
        trendDirection,
        changePct: firstTrend > 0
          ? (((lastTrend - firstTrend) / firstTrend) * 100).toFixed(1)
          : '0',
      },
      trend,
    });
  } catch (error) {
    console.error('[MerchantAPI] Trends failed:', error);
    res.status(500).json({ error: 'Failed to get trends' });
  }
});

// ── City/Location Insights ──────────────────────────────────────────────────────

router.get('/:merchantId/locations', authorizeMerchantAccess, async (req: Request, res: Response) => {
  const { merchantId } = req.params;
  const { category, limit = '10' } = req.query;

  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const whereClause: Record<string, unknown> = { merchantId, firstSeenAt: { $gte: since } };
    if (category) whereClause.category = category;

    const intents = await Intent.find(whereClause).select('metadata');

    const cityCounts = new Map<string, number>();
    for (const intent of intents) {
      const metadata = intent.metadata as Record<string, unknown> | null;
      const city = (metadata?.city as string) || (intent.metadata as { city?: string })?.city;
      if (city && typeof city === 'string') {
        cityCounts.set(city, (cityCounts.get(city) || 0) + 1);
      }
    }

    const topCities = Array.from(cityCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, parseInt(limit as string))
      .map(([city, count], index) => ({
        rank: index + 1,
        city,
        demandCount: count,
        demandPct: ((count / intents.length) * 100).toFixed(1),
      }));

    res.json({
      merchantId,
      category: category || 'all',
      period: '30d',
      totalIntents: intents.length,
      locations: topCities,
    });
  } catch (error) {
    console.error('[MerchantAPI] Locations failed:', error);
    res.status(500).json({ error: 'Failed to get location insights' });
  }
});

// ── Price Expectations ─────────────────────────────────────────────────────────

router.get('/:merchantId/pricing', authorizeMerchantAccess, async (req: Request, res: Response) => {
  const { merchantId } = req.params;
  const { category } = req.query;

  try {
    const whereClause: Record<string, unknown> = {
      merchantId,
      status: { $in: ['ACTIVE', 'DORMANT'] },
    };
    if (category) whereClause.category = category;

    const intents = await Intent.find(whereClause).select('metadata confidence');

    let priceSum = 0;
    let priceCount = 0;
    let highConfidenceSum = 0;
    let highConfidenceCount = 0;

    for (const intent of intents) {
      const metadata = intent.metadata as Record<string, unknown> | null;
      const price = (metadata?.price as number) || (intent.metadata as { price?: number })?.price;
      if (price && price > 0) {
        priceSum += price;
        priceCount++;
        if (intent.confidence > 0.6) {
          highConfidenceSum += price;
          highConfidenceCount++;
        }
      }
    }

    const avgPrice = priceCount > 0 ? priceSum / priceCount : 0;
    const avgHighConfidencePrice =
      highConfidenceCount > 0 ? highConfidenceSum / highConfidenceCount : avgPrice;

    res.json({
      merchantId,
      category: category || 'all',
      priceExpectations: {
        avgPrice: avgPrice > 0 ? avgPrice.toFixed(2) : null,
        avgHighIntentPrice: avgHighConfidencePrice > 0 ? avgHighConfidencePrice.toFixed(2) : null,
        sampleSize: priceCount,
        recommendation:
          avgHighConfidencePrice > 0 && avgPrice > 0
            ? avgHighConfidencePrice > avgPrice
              ? 'Price point acceptable, consider premium positioning'
              : 'Consider competitive pricing to capture high-intent users'
            : 'Insufficient data for pricing recommendation',
      },
    });
  } catch (error) {
    console.error('[MerchantAPI] Pricing failed:', error);
    res.status(500).json({ error: 'Failed to get pricing insights' });
  }
});

// ── Alerts Configuration ───────────────────────────────────────────────────────

router.post('/:merchantId/alerts', authorizeMerchantAccess, async (req: Request, res: Response) => {
  const { merchantId } = req.params;
  const { category, threshold, webhookUrl, enabled = true } = req.body;

  if (!threshold || threshold < 1 || threshold > 100) {
    res.status(400).json({ error: 'Threshold must be between 1 and 100' });
    return;
  }

  try {
    const alertConfig = {
      merchantId,
      category: category || 'all',
      threshold,
      webhookUrl,
      enabled,
      createdAt: new Date().toISOString(),
    };

    await sharedMemory.set(
      `merchant:alert:${merchantId}:${category || 'all'}`,
      alertConfig,
      86400 * 30
    );

    res.json({ success: true, config: alertConfig });
  } catch (error) {
    console.error('[MerchantAPI] Alert config failed:', error);
    res.status(500).json({ error: 'Failed to configure alert' });
  }
});

// ── Helpers ─────────────────────────────────────────────────────────────────────

function getDemandHealth(demandCount: number, unmetPct: number): string {
  if (demandCount > 50 && unmetPct < 30) return 'excellent';
  if (demandCount > 20 && unmetPct < 50) return 'good';
  if (demandCount > 5) return 'moderate';
  return 'low';
}

function getSeasonalityForecast(category: string): Array<{ month: number; expectedDemand: string; isCurrentMonth: boolean }> {
  const currentMonth = new Date().getMonth();

  const multipliers: Record<string, number[]> = {
    TRAVEL: [0.5, 0.6, 0.7, 0.8, 0.9, 1.2, 1.4, 1.3, 0.9, 0.7, 0.8, 1.0],
    DINING: [0.9, 0.9, 1.0, 1.0, 1.1, 1.1, 1.2, 1.2, 1.0, 1.0, 1.1, 1.3],
    RETAIL: [0.7, 0.7, 0.8, 0.9, 1.0, 1.0, 0.9, 1.0, 1.1, 1.3, 1.5, 1.8],
  };

  const forecast = multipliers[category] || multipliers.DINING;

  return forecast.map((mult, index) => ({
    month: index + 1,
    expectedDemand: `${(mult * 100).toFixed(0)} (${mult > 1 ? '+' : ''}${((mult - 1) * 100).toFixed(0)}%)`,
    isCurrentMonth: index === currentMonth,
  }));
}

export default router;

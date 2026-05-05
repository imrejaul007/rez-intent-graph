// ── Fraud Prevention API Routes ──────────────────────────────────────────────
// REST API endpoints for cashback fraud detection and reporting

import { Router, Request, Response, NextFunction } from 'express';
import {
  cashbackFraudPrevention,
  type ICashbackRequest,
  type FraudCheckResult,
  type VelocityMetrics,
} from '../services/CashbackFraudPrevention.js';
import {
  FraudReport,
  UserRiskProfile,
  CashbackRequest,
  type FraudAction,
} from '../models/CashbackFraud.js';

const router = Router();

/**
 * Middleware to validate request body
 */
function validateRequest(schema: Record<string, unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const errors: string[] = [];

    for (const [field, rules] of Object.entries(schema)) {
      const value = req.body[field];
      const rule = rules as { required?: boolean; type?: string; min?: number; max?: number };

      if (rule.required && (value === undefined || value === null || value === '')) {
        errors.push(`${field} is required`);
        continue;
      }

      if (value !== undefined && rule.type && typeof value !== rule.type) {
        errors.push(`${field} must be of type ${rule.type}`);
      }

      if (rule.min !== undefined && typeof value === 'number' && value < rule.min) {
        errors.push(`${field} must be at least ${rule.min}`);
      }

      if (rule.max !== undefined && typeof value === 'number' && value > rule.max) {
        errors.push(`${field} must be at most ${rule.max}`);
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    next();
  };
}

/**
 * POST /api/fraud/validate
 * Validate a cashback request for fraud
 */
router.post(
  '/validate',
  validateRequest({
    requestId: { required: true, type: 'string' },
    userId: { required: true, type: 'string' },
    merchantId: { required: true, type: 'string' },
    orderId: { required: true, type: 'string' },
    amount: { required: true, type: 'number', min: 0 },
    cashbackAmount: { required: true, type: 'number', min: 0 },
  }),
  async (req: Request, res: Response) => {
    try {
      const request: ICashbackRequest = {
        requestId: req.body.requestId,
        userId: req.body.userId,
        merchantId: req.body.merchantId,
        orderId: req.body.orderId,
        amount: req.body.amount,
        cashbackAmount: req.body.cashbackAmount,
        currency: req.body.currency || 'USD',
        deviceFingerprint: req.body.deviceFingerprint,
        ipAddress: req.body.ipAddress || req.ip,
        userAgent: req.body.userAgent || req.get('user-agent'),
        location: req.body.location,
        metadata: req.body.metadata,
        requestedAt: new Date(),
      };

      const result = await cashbackFraudPrevention.validateCashbackRequest(request);

      // Update user risk profile
      await cashbackFraudPrevention.updateUserRiskProfile(
        request.userId,
        result.isFraudulent,
        result.flags
      );

      res.status(result.isFraudulent ? 200 : 200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('[FraudAPI] Validation error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to validate request',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
);

/**
 * GET /api/fraud/report/:reportId
 * Get a specific fraud report by ID
 */
router.get('/report/:reportId', async (req: Request, res: Response) => {
  try {
    const { reportId } = req.params;
    const report = await cashbackFraudPrevention.getFraudReport(reportId);

    if (!report) {
      return res.status(404).json({
        success: false,
        error: 'Report not found',
      });
    }

    res.json({
      success: true,
      data: report,
    });
  } catch (error) {
    console.error('[FraudAPI] Get report error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve report',
    });
  }
});

/**
 * GET /api/fraud/reports/user/:userId
 * Get fraud reports for a specific user
 */
router.get('/reports/user/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    const reports = await cashbackFraudPrevention.getUserFraudReports(userId, limit);

    res.json({
      success: true,
      data: reports,
      count: reports.length,
    });
  } catch (error) {
    console.error('[FraudAPI] Get user reports error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve user reports',
    });
  }
});

/**
 * GET /api/fraud/reports/pending
 * Get pending fraud reports (not yet actioned)
 */
router.get('/reports/pending', async (req: Request, res: Response) => {
  try {
    const riskLevel = req.query.riskLevel as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | undefined;
    const limit = parseInt(req.query.limit as string) || 100;

    const reports = await cashbackFraudPrevention.getPendingFraudReports(riskLevel, limit);

    res.json({
      success: true,
      data: reports,
      count: reports.length,
    });
  } catch (error) {
    console.error('[FraudAPI] Get pending reports error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve pending reports',
    });
  }
});

/**
 * POST /api/fraud/report/:reportId/action
 * Action a fraud report (approve/reject/mark for review)
 */
router.post(
  '/report/:reportId/action',
  validateRequest({
    action: { required: true, type: 'string' },
  }),
  async (req: Request, res: Response) => {
    try {
      const { reportId } = req.params;
      const { action, notes } = req.body;
      const actionedBy = req.body.actionedBy || req.headers['x-user-id'] || 'system';

      if (!['APPROVED', 'REJECTED', 'MANUAL_REVIEW'].includes(action)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid action. Must be APPROVED, REJECTED, or MANUAL_REVIEW',
        });
      }

      const report = await cashbackFraudPrevention.actionFraudReport(
        reportId,
        action as FraudAction,
        actionedBy as string,
        notes
      );

      if (!report) {
        return res.status(404).json({
          success: false,
          error: 'Report not found',
        });
      }

      res.json({
        success: true,
        data: report,
        message: `Report ${action.toLowerCase()}`,
      });
    } catch (error) {
      console.error('[FraudAPI] Action report error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to action report',
      });
    }
  }
);

/**
 * GET /api/fraud/statistics
 * Get fraud statistics
 */
router.get('/statistics', async (req: Request, res: Response) => {
  try {
    const startDate = req.query.startDate
      ? new Date(req.query.startDate as string)
      : undefined;
    const endDate = req.query.endDate
      ? new Date(req.query.endDate as string)
      : undefined;

    const stats = await cashbackFraudPrevention.getFraudStatistics(startDate, endDate);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('[FraudAPI] Get statistics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve statistics',
    });
  }
});

/**
 * GET /api/fraud/velocity/:userId
 * Get velocity metrics for a user
 */
router.get('/velocity/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const metrics = await cashbackFraudPrevention.getVelocityMetrics(userId);

    res.json({
      success: true,
      data: metrics,
    });
  } catch (error) {
    console.error('[FraudAPI] Get velocity error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve velocity metrics',
    });
  }
});

/**
 * GET /api/fraud/profile/:userId
 * Get risk profile for a user
 */
router.get('/profile/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const profile = await cashbackFraudPrevention.getUserRiskProfile(userId);

    if (!profile) {
      return res.status(404).json({
        success: false,
        error: 'Profile not found',
      });
    }

    res.json({
      success: true,
      data: profile,
    });
  } catch (error) {
    console.error('[FraudAPI] Get profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve risk profile',
    });
  }
});

/**
 * POST /api/fraud/profile/:userId/whitelist
 * Add user to whitelist
 */
router.post('/profile/:userId/whitelist', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    await cashbackFraudPrevention.whitelistUser(userId);

    res.json({
      success: true,
      message: `User ${userId} added to whitelist`,
    });
  } catch (error) {
    console.error('[FraudAPI] Whitelist error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to whitelist user',
    });
  }
});

/**
 * POST /api/fraud/profile/:userId/blacklist
 * Add user to blacklist
 */
router.post('/profile/:userId/blacklist', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    await cashbackFraudPrevention.blacklistUser(userId);

    res.json({
      success: true,
      message: `User ${userId} added to blacklist`,
    });
  } catch (error) {
    console.error('[FraudAPI] Blacklist error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to blacklist user',
    });
  }
});

/**
 * DELETE /api/fraud/profile/:userId/list
 * Remove user from whitelist/blacklist
 */
router.delete('/profile/:userId/list', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    await cashbackFraudPrevention.unlistUser(userId);

    res.json({
      success: true,
      message: `User ${userId} removed from whitelist/blacklist`,
    });
  } catch (error) {
    console.error('[FraudAPI] Unlist error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to unlist user',
    });
  }
});

/**
 * POST /api/fraud/chain
 * Add user to reward chain
 */
router.post(
  '/chain',
  validateRequest({
    userId: { required: true, type: 'string' },
    merchantId: { required: true, type: 'string' },
    orderId: { required: true, type: 'string' },
    cashbackAmount: { required: true, type: 'number', min: 0 },
  }),
  async (req: Request, res: Response) => {
    try {
      const { userId, merchantId, orderId, cashbackAmount, parentUserId } = req.body;

      const node = await cashbackFraudPrevention.addToRewardChain(
        userId,
        merchantId,
        orderId,
        cashbackAmount,
        parentUserId
      );

      res.status(201).json({
        success: true,
        data: node,
      });
    } catch (error) {
      console.error('[FraudAPI] Add chain node error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to add chain node',
      });
    }
  }
);

/**
 * GET /api/fraud/chains/user/:userId
 * Get reward chain for a user
 */
router.get('/chains/user/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { RewardChainNode } = await import('../models/CashbackFraud.js');

    const nodes = await RewardChainNode.find({ userId })
      .sort({ createdAt: -1 })
      .limit(20);

    res.json({
      success: true,
      data: nodes,
      count: nodes.length,
    });
  } catch (error) {
    console.error('[FraudAPI] Get chain error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve reward chain',
    });
  }
});

/**
 * GET /api/fraud/requests/user/:userId
 * Get cashback requests for a user
 */
router.get('/requests/user/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    const skip = parseInt(req.query.skip as string) || 0;

    const requests = await CashbackRequest.find({ userId })
      .sort({ requestedAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await CashbackRequest.countDocuments({ userId });

    res.json({
      success: true,
      data: requests,
      pagination: {
        total,
        limit,
        skip,
        hasMore: skip + limit < total,
      },
    });
  } catch (error) {
    console.error('[FraudAPI] Get requests error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve requests',
    });
  }
});

/**
 * GET /api/fraud/high-risk-users
 * Get list of high-risk users
 */
router.get('/high-risk-users', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const minScore = parseFloat(req.query.minScore as string) || 0.5;

    const users = await UserRiskProfile.find({
      $or: [
        { riskLevel: { $in: ['HIGH', 'CRITICAL'] } },
        { riskScore: { $gte: minScore } },
        { isBlacklisted: true },
      ],
    })
      .sort({ riskScore: -1 })
      .limit(limit);

    res.json({
      success: true,
      data: users,
      count: users.length,
    });
  } catch (error) {
    console.error('[FraudAPI] Get high-risk users error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve high-risk users',
    });
  }
});

/**
 * POST /api/fraud/batch-validate
 * Batch validate multiple cashback requests
 */
router.post('/batch-validate', async (req: Request, res: Response) => {
  try {
    const { requests } = req.body;

    if (!Array.isArray(requests)) {
      return res.status(400).json({
        success: false,
        error: 'requests must be an array',
      });
    }

    if (requests.length > 100) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 100 requests per batch',
      });
    }

    const results: FraudCheckResult[] = [];

    for (const request of requests) {
      const result = await cashbackFraudPrevention.validateCashbackRequest({
        requestId: request.requestId,
        userId: request.userId,
        merchantId: request.merchantId,
        orderId: request.orderId,
        amount: request.amount,
        cashbackAmount: request.cashbackAmount,
        currency: request.currency || 'USD',
        deviceFingerprint: request.deviceFingerprint,
        ipAddress: request.ipAddress,
        location: request.location,
        requestedAt: new Date(),
      });
      results.push(result);
    }

    const summary = {
      total: results.length,
      flagged: results.filter((r) => r.isFraudulent).length,
      byRiskLevel: {
        LOW: results.filter((r) => r.riskLevel === 'LOW').length,
        MEDIUM: results.filter((r) => r.riskLevel === 'MEDIUM').length,
        HIGH: results.filter((r) => r.riskLevel === 'HIGH').length,
        CRITICAL: results.filter((r) => r.riskLevel === 'CRITICAL').length,
      },
      avgProcessingTimeMs:
        results.reduce((sum, r) => sum + r.processingTimeMs, 0) / results.length,
    };

    res.json({
      success: true,
      data: results,
      summary,
    });
  } catch (error) {
    console.error('[FraudAPI] Batch validate error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to batch validate requests',
    });
  }
});

/**
 * GET /api/fraud/health
 * Health check endpoint
 */
router.get('/health', async (_req: Request, res: Response) => {
  try {
    // Quick connectivity check
    await CashbackRequest.findOne().lean();
    await FraudReport.findOne().lean();
    await UserRiskProfile.findOne().lean();

    res.json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;

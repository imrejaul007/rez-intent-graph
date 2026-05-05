// ── Cashback Fraud Prevention Service ─────────────────────────────────────────
// Comprehensive fraud detection for cashback rewards
// Includes duplicate detection, self-reward, circular chains, velocity checks, anomaly scoring

import mongoose, { Schema, Document, Model } from 'mongoose';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ICashbackRequest {
  requestId: string;
  userId: string;
  merchantId: string;
  orderId: string;
  amount: number;
  cashbackAmount: number;
  currency: string;
  deviceFingerprint?: string;
  ipAddress?: string;
  userAgent?: string;
  location?: {
    country?: string;
    region?: string;
    city?: string;
    lat?: number;
    lon?: number;
  };
  metadata?: Record<string, unknown>;
  requestedAt: Date;
}

export interface FraudCheckResult {
  requestId: string;
  isFraudulent: boolean;
  fraudScore: number; // 0-1, higher = more likely fraud
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  flags: FraudFlag[];
  checks: FraudCheck[];
  recommendations: string[];
  checkedAt: Date;
  processingTimeMs: number;
}

export interface FraudFlag {
  type: FraudFlagType;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
  evidence: Record<string, unknown>;
  points: number; // Points added to fraud score
}

export type FraudFlagType =
  | 'DUPLICATE_REQUEST'
  | 'SELF_REWARD'
  | 'CIRCULAR_REWARD_CHAIN'
  | 'VELOCITY_ANOMALY'
  | 'DEVICE_ANOMALY'
  | 'IP_ANOMALY'
  | 'AMOUNT_ANOMALY'
  | 'CARD_ANOMALY'
  | 'LOCATION_ANOMALY'
  | 'ACCOUNT_ANOMALY'
  | 'BEHAVIOR_ANOMALY';

export interface FraudCheck {
  name: string;
  passed: boolean;
  score: number;
  details: string;
}

export interface VelocityMetrics {
  requestsLastHour: number;
  requestsLast24Hours: number;
  requestsLast7Days: number;
  totalCashbackLast24Hours: number;
  avgCashbackPerRequest: number;
  requestFrequency: number; // requests per hour
}

export interface AnomalyContext {
  userId: string;
  deviceFingerprint?: string;
  ipAddress?: string;
  sessionId?: string;
  merchantId?: string;
  orderId?: string;
  cardLast4?: string;
  location?: {
    country?: string;
    region?: string;
    city?: string;
  };
}

// ── Thresholds & Constants ────────────────────────────────────────────────────

const FRAUD_THRESHOLDS = {
  // Velocity limits
  MAX_REQUESTS_PER_HOUR: 5,
  MAX_REQUESTS_PER_DAY: 20,
  MAX_CASHBACK_PER_DAY: 500, // currency units
  MAX_REQUESTS_SAME_MERCHANT_HOUR: 3,

  // Self-reward chain detection
  MAX_CHAIN_LENGTH: 5,

  // Amount thresholds
  MAX_SINGLE_CASHBACK: 200,
  MIN_SINGLE_CASHBACK: 0.01,

  // Anomaly thresholds
  AMOUNT_STD_DEV_THRESHOLD: 3, // standard deviations
  TIME_GAP_MIN_SECONDS: 60, // minimum gap between requests

  // Risk scoring
  FRAUD_SCORE_LOW: 0.2,
  FRAUD_SCORE_MEDIUM: 0.5,
  FRAUD_SCORE_HIGH: 0.75,
  FRAUD_SCORE_CRITICAL: 0.9,

  // Auto-reject threshold
  AUTO_REJECT_SCORE: 0.85,
};

// ── MongoDB Models ─────────────────────────────────────────────────────────────

// Cashback Request Log
const CashbackRequestSchema = new Schema<ICashbackRequest & Document>({
  requestId: { type: String, required: true, unique: true, index: true },
  userId: { type: String, required: true, index: true },
  merchantId: { type: String, required: true, index: true },
  orderId: { type: String, required: true, index: true },
  amount: { type: Number, required: true },
  cashbackAmount: { type: Number, required: true },
  currency: { type: String, default: 'USD' },
  deviceFingerprint: { type: String, index: true },
  ipAddress: { type: String, index: true },
  userAgent: { type: String },
  location: {
    country: String,
    region: String,
    city: String,
    lat: Number,
    lon: Number,
  },
  metadata: { type: Schema.Types.Mixed },
  requestedAt: { type: Date, default: Date.now, index: true },
});

// Compound indexes for fraud detection
CashbackRequestSchema.index({ userId: 1, requestedAt: -1 });
CashbackRequestSchema.index({ userId: 1, merchantId: 1, requestedAt: -1 });
CashbackRequestSchema.index({ deviceFingerprint: 1, requestedAt: -1 });
CashbackRequestSchema.index({ ipAddress: 1, requestedAt: -1 });
CashbackRequestSchema.index({ orderId: 1 }, { unique: true });

// Fraud Report Log
export interface IFraudReport extends Document {
  reportId: string;
  requestId: string;
  userId: string;
  fraudScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  flags: FraudFlag[];
  isActioned: boolean;
  action?: 'APPROVED' | 'REJECTED' | 'MANUAL_REVIEW';
  actionedBy?: string;
  actionedAt?: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const FraudFlagSubSchema = new Schema(
  {
    type: { type: String, required: true },
    severity: { type: String, required: true },
    description: { type: String, required: true },
    evidence: { type: Schema.Types.Mixed },
    points: { type: Number, required: true },
  },
  { _id: false }
);

const FraudReportSchema = new Schema<IFraudReport>(
  {
    reportId: { type: String, required: true, unique: true, index: true },
    requestId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    fraudScore: { type: Number, required: true },
    riskLevel: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      required: true,
    },
    flags: [FraudFlagSubSchema],
    isActioned: { type: Boolean, default: false },
    action: { type: String, enum: ['APPROVED', 'REJECTED', 'MANUAL_REVIEW'] },
    actionedBy: String,
    actionedAt: Date,
    notes: String,
  },
  { timestamps: true }
);

FraudReportSchema.index({ userId: 1, createdAt: -1 });
FraudReportSchema.index({ fraudScore: 1, createdAt: -1 });
FraudReportSchema.index({ riskLevel: 1, isActioned: 1 });

// User Risk Profile
export interface IUserRiskProfile extends Document {
  userId: string;
  riskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  totalRequests: number;
  fraudRequests: number;
  lastFraudAt?: Date;
  flags: string[];
  firstSeenAt: Date;
  lastSeenAt: Date;
  isWhitelisted: boolean;
  isBlacklisted: boolean;
  updateCount: number;
}

const UserRiskProfileSchema = new Schema<IUserRiskProfile>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    riskScore: { type: Number, default: 0 },
    riskLevel: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      default: 'LOW',
    },
    totalRequests: { type: Number, default: 0 },
    fraudRequests: { type: Number, default: 0 },
    lastFraudAt: Date,
    flags: [String],
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    isWhitelisted: { type: Boolean, default: false },
    isBlacklisted: { type: Boolean, default: false },
    updateCount: { type: Number, default: 0 },
  },
  { timestamps: false }
);

// Reward Chain Graph (for circular detection)
export interface IRewardChainNode extends Document {
  userId: string;
  merchantId: string;
  orderId: string;
  cashbackAmount: number;
  parentUserId?: string; // User who referred this one
  childUserIds: string[];
  depth: number;
  chainHash: string; // Hash of the full chain for quick comparison
  createdAt: Date;
}

const RewardChainNodeSchema = new Schema<IRewardChainNode>({
  userId: { type: String, required: true, index: true },
  merchantId: { type: String, required: true },
  orderId: { type: String, required: true, unique: true },
  cashbackAmount: { type: Number, required: true },
  parentUserId: { type: String, index: true },
  childUserIds: [String],
  depth: { type: Number, default: 0 },
  chainHash: { type: String, index: true },
  createdAt: { type: Date, default: Date.now },
});

RewardChainNodeSchema.index({ chainHash: 1 });
RewardChainNodeSchema.index({ parentUserId: 1, childUserIds: 1 });

// ── Service Class ─────────────────────────────────────────────────────────────

export class CashbackFraudPreventionService {
  private CashbackRequest: Model<ICashbackRequest & Document>;
  private FraudReport: Model<IFraudReport>;
  private UserRiskProfile: Model<IUserRiskProfile>;
  private RewardChainNode: Model<IRewardChainNode>;

  constructor() {
    // Initialize models if not already registered
    this.CashbackRequest =
      mongoose.models.CashbackRequest ||
      mongoose.model<ICashbackRequest & Document>(
        'CashbackRequest',
        CashbackRequestSchema
      );
    this.FraudReport =
      mongoose.models.FraudReport ||
      mongoose.model<IFraudReport>('FraudReport', FraudReportSchema);
    this.UserRiskProfile =
      mongoose.models.UserRiskProfile ||
      mongoose.model<IUserRiskProfile>('UserRiskProfile', UserRiskProfileSchema);
    this.RewardChainNode =
      mongoose.models.RewardChainNode ||
      mongoose.model<IRewardChainNode>('RewardChainNode', RewardChainNodeSchema);
  }

  /**
   * Main entry point: Validate a cashback request for fraud
   */
  async validateCashbackRequest(
    request: ICashbackRequest
  ): Promise<FraudCheckResult> {
    const startTime = Date.now();
    const flags: FraudFlag[] = [];
    const checks: FraudCheck[] = [];

    try {
      // 1. Duplicate Request Detection
      const duplicateCheck = await this.checkDuplicateRequest(request);
      checks.push(duplicateCheck);
      if (!duplicateCheck.passed) {
        flags.push(this.createFlag('DUPLICATE_REQUEST', duplicateCheck));
      }

      // 2. Self-Reward Detection
      const selfRewardCheck = await this.checkSelfReward(request);
      checks.push(selfRewardCheck);
      if (!selfRewardCheck.passed) {
        flags.push(this.createFlag('SELF_REWARD', selfRewardCheck));
      }

      // 3. Circular Reward Chain Detection
      const circularChainCheck = await this.checkCircularRewardChain(request);
      checks.push(circularChainCheck);
      if (!circularChainCheck.passed) {
        flags.push(this.createFlag('CIRCULAR_REWARD_CHAIN', circularChainCheck));
      }

      // 4. Velocity Checks
      const velocityCheck = await this.checkVelocity(request);
      checks.push(velocityCheck);
      if (!velocityCheck.passed) {
        flags.push(this.createFlag('VELOCITY_ANOMALY', velocityCheck));
      }

      // 5. Device Anomaly Detection
      const deviceCheck = await this.checkDeviceAnomaly(request);
      checks.push(deviceCheck);
      if (!deviceCheck.passed) {
        flags.push(this.createFlag('DEVICE_ANOMALY', deviceCheck));
      }

      // 6. IP Anomaly Detection
      const ipCheck = await this.checkIpAnomaly(request);
      checks.push(ipCheck);
      if (!ipCheck.passed) {
        flags.push(this.createFlag('IP_ANOMALY', ipCheck));
      }

      // 7. Amount Anomaly Detection
      const amountCheck = await this.checkAmountAnomaly(request);
      checks.push(amountCheck);
      if (!amountCheck.passed) {
        flags.push(this.createFlag('AMOUNT_ANOMALY', amountCheck));
      }

      // 8. Location Anomaly Detection
      const locationCheck = await this.checkLocationAnomaly(request);
      checks.push(locationCheck);
      if (!locationCheck.passed) {
        flags.push(this.createFlag('LOCATION_ANOMALY', locationCheck));
      }

      // 9. Account Anomaly Detection
      const accountCheck = await this.checkAccountAnomaly(request);
      checks.push(accountCheck);
      if (!accountCheck.passed) {
        flags.push(this.createFlag('ACCOUNT_ANOMALY', accountCheck));
      }

      // Calculate final fraud score
      const fraudScore = this.calculateFraudScore(flags);
      const riskLevel = this.calculateRiskLevel(fraudScore);

      // Get recommendations
      const recommendations = this.generateRecommendations(
        flags,
        fraudScore,
        riskLevel
      );

      // Save the request and fraud report
      await this.logRequest(request);
      await this.createFraudReport(request, fraudScore, riskLevel, flags);

      const processingTimeMs = Date.now() - startTime;

      return {
        requestId: request.requestId,
        isFraudulent: fraudScore >= FRAUD_THRESHOLDS.AUTO_REJECT_SCORE,
        fraudScore,
        riskLevel,
        flags,
        checks,
        recommendations,
        checkedAt: new Date(),
        processingTimeMs,
      };
    } catch (error) {
      console.error('[FraudPrevention] Validation error:', error);
      throw error;
    }
  }

  /**
   * 1. Duplicate Request Detection
   * Checks if this exact request or very similar request already exists
   */
  private async checkDuplicateRequest(
    request: ICashbackRequest
  ): Promise<FraudCheck> {
    try {
      // Exact order ID check
      const exactMatch = await this.CashbackRequest.findOne({
        orderId: request.orderId,
      });

      if (exactMatch) {
        return {
          name: 'Duplicate Request Detection',
          passed: false,
          score: 1.0,
          details: `Duplicate order ID: ${request.orderId} already processed at ${exactMatch.requestedAt}`,
        };
      }

      // Check for near-duplicate (same user, merchant, amount within time window)
      const nearDuplicate = await this.CashbackRequest.findOne({
        userId: request.userId,
        merchantId: request.merchantId,
        cashbackAmount: request.cashbackAmount,
        requestedAt: {
          $gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
        },
      });

      if (nearDuplicate) {
        return {
          name: 'Duplicate Request Detection',
          passed: false,
          score: 0.8,
          details: `Similar request found for same user/merchant within 24 hours`,
        };
      }

      // Check for rapid resubmission
      const recentSameUser = await this.CashbackRequest.findOne({
        userId: request.userId,
        requestedAt: {
          $gte: new Date(Date.now() - 60 * 1000), // Last minute
        },
      });

      if (recentSameUser) {
        return {
          name: 'Duplicate Request Detection',
          passed: false,
          score: 0.6,
          details: `User submitted request within 1 minute of previous request`,
        };
      }

      return {
        name: 'Duplicate Request Detection',
        passed: true,
        score: 0,
        details: 'No duplicate detected',
      };
    } catch (error) {
      console.error('[FraudPrevention] Duplicate check error:', error);
      return {
        name: 'Duplicate Request Detection',
        passed: true,
        score: 0,
        details: 'Check skipped due to error',
      };
    }
  }

  /**
   * 2. Self-Reward Detection
   * Checks if user is attempting to reward themselves through manipulation
   */
  private async checkSelfReward(request: ICashbackRequest): Promise<FraudCheck> {
    try {
      // Check if merchant is owned/associated with user
      // In real implementation, this would check merchant ownership

      // Check for patterns that suggest self-reward:
      // 1. Same device/IP as merchant account
      // 2. Unusual cashback amounts
      // 3. Multiple accounts from same device

      // Get other requests from same device/IP
      const sameDeviceRequests = request.deviceFingerprint
        ? await this.CashbackRequest.countDocuments({
            deviceFingerprint: request.deviceFingerprint,
            userId: { $ne: request.userId },
          })
        : 0;

      const sameIpRequests = request.ipAddress
        ? await this.CashbackRequest.countDocuments({
            ipAddress: request.ipAddress,
            userId: { $ne: request.userId },
          })
        : 0;

      // Flag if multiple users making requests from same device/IP
      if (sameDeviceRequests > 2 || sameIpRequests > 5) {
        return {
          name: 'Self-Reward Detection',
          passed: false,
          score: 0.9,
          details: `Multiple users (${sameDeviceRequests} device, ${sameIpRequests} IP) sharing authentication factors`,
        };
      }

      // Check for unusually high cashback rate
      const userRecentRequests = await this.CashbackRequest.find({
        userId: request.userId,
        requestedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      }).limit(50);

      if (userRecentRequests.length >= 10) {
        const successRate =
          userRecentRequests.filter((r) => r.cashbackAmount > 0).length /
          userRecentRequests.length;
        if (successRate > 0.95) {
          return {
            name: 'Self-Reward Detection',
            passed: false,
            score: 0.7,
            details: `Unusually high success rate (${(successRate * 100).toFixed(1)}%) over 10+ requests`,
          };
        }
      }

      return {
        name: 'Self-Reward Detection',
        passed: true,
        score: 0,
        details: 'No self-reward patterns detected',
      };
    } catch (error) {
      console.error('[FraudPrevention] Self-reward check error:', error);
      return {
        name: 'Self-Reward Detection',
        passed: true,
        score: 0,
        details: 'Check skipped due to error',
      };
    }
  }

  /**
   * 3. Circular Reward Chain Detection
   * Detects if users are creating circular reward patterns (A->B->C->A)
   */
  private async checkCircularRewardChain(
    request: ICashbackRequest
  ): Promise<FraudCheck> {
    try {
      // Get the chain for this user
      const chainNodes = await this.RewardChainNode.find({
        userId: request.userId,
      })
        .sort({ depth: -1 })
        .limit(FRAUD_THRESHOLDS.MAX_CHAIN_LENGTH);

      if (chainNodes.length === 0) {
        // First-time user in chain, check for suspicious parent
        const suspiciousParent = await this.RewardChainNode.findOne({
          childUserIds: request.userId,
          $expr: {
            $gte: [{ $size: '$childUserIds' }, 3], // Parent has 3+ children
          },
        });

        if (suspiciousParent) {
          return {
            name: 'Circular Reward Chain Detection',
            passed: false,
            score: 0.6,
            details: 'User referred by high-volume referrer (potential ring)',
          };
        }

        return {
          name: 'Circular Reward Chain Detection',
          passed: true,
          score: 0,
          details: 'No chain found for user',
        };
      }

      // Build ancestor chain
      const ancestors = new Set<string>();
      let currentUserId: string | undefined = request.userId;

      for (let i = 0; i < FRAUD_THRESHOLDS.MAX_CHAIN_LENGTH; i++) {
        const parent = chainNodes.find((n) => n.userId === currentUserId);
        if (!parent?.parentUserId) break;
        if (ancestors.has(parent.parentUserId)) {
          // Circular reference detected!
          return {
            name: 'Circular Reward Chain Detection',
            passed: false,
            score: 1.0,
            details: `Circular reference detected: user ${parent.parentUserId} appears twice in chain`,
          };
        }
        ancestors.add(parent.parentUserId);
        currentUserId = parent.parentUserId;
      }

      // Check chain depth
      const maxDepth = Math.max(...chainNodes.map((n) => n.depth));
      if (maxDepth >= FRAUD_THRESHOLDS.MAX_CHAIN_LENGTH) {
        return {
          name: 'Circular Reward Chain Detection',
          passed: false,
          score: 0.5,
          details: `Chain depth (${maxDepth}) exceeds maximum (${FRAUD_THRESHOLDS.MAX_CHAIN_LENGTH})`,
        };
      }

      return {
        name: 'Circular Reward Chain Detection',
        passed: true,
        score: 0,
        details: 'No circular patterns detected',
      };
    } catch (error) {
      console.error('[FraudPrevention] Circular chain check error:', error);
      return {
        name: 'Circular Reward Chain Detection',
        passed: true,
        score: 0,
        details: 'Check skipped due to error',
      };
    }
  }

  /**
   * 4. Velocity Checks
   * Detects requests coming too fast or too frequently
   */
  private async checkVelocity(request: ICashbackRequest): Promise<FraudCheck> {
    try {
      const now = Date.now();
      const oneHourAgo = new Date(now - 60 * 60 * 1000);
      const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);

      // Get recent requests for user
      const recentRequests = await this.CashbackRequest.find({
        userId: request.userId,
        requestedAt: { $gte: oneDayAgo },
      });

      const requestsLastHour = recentRequests.filter(
        (r) => r.requestedAt.getTime() >= oneHourAgo.getTime()
      ).length;

      const requestsLast24Hours = recentRequests.length;
      const totalCashbackLast24Hours = recentRequests.reduce(
        (sum, r) => sum + r.cashbackAmount,
        0
      );

      // Check velocity limits
      if (
        requestsLastHour >=
        FRAUD_THRESHOLDS.MAX_REQUESTS_PER_HOUR
      ) {
        return {
          name: 'Velocity Check',
          passed: false,
          score: 0.9,
          details: `${requestsLastHour} requests in last hour (max: ${FRAUD_THRESHOLDS.MAX_REQUESTS_PER_HOUR})`,
        };
      }

      if (
        requestsLast24Hours >=
        FRAUD_THRESHOLDS.MAX_REQUESTS_PER_DAY
      ) {
        return {
          name: 'Velocity Check',
          passed: false,
          score: 0.8,
          details: `${requestsLast24Hours} requests in last 24 hours (max: ${FRAUD_THRESHOLDS.MAX_REQUESTS_PER_DAY})`,
        };
      }

      if (
        totalCashbackLast24Hours + request.cashbackAmount >
        FRAUD_THRESHOLDS.MAX_CASHBACK_PER_DAY
      ) {
        return {
          name: 'Velocity Check',
          passed: false,
          score: 0.85,
          details: `Total cashback (${(totalCashbackLast24Hours + request.cashbackAmount).toFixed(2)}) exceeds daily limit`,
        };
      }

      // Check same merchant velocity
      const requestsSameMerchantHour = recentRequests.filter(
        (r) =>
          r.merchantId === request.merchantId &&
          r.requestedAt.getTime() >= oneHourAgo.getTime()
      ).length;

      if (
        requestsSameMerchantHour >=
        FRAUD_THRESHOLDS.MAX_REQUESTS_SAME_MERCHANT_HOUR
      ) {
        return {
          name: 'Velocity Check',
          passed: false,
          score: 0.7,
          details: `${requestsSameMerchantHour} requests to same merchant in last hour`,
        };
      }

      // Check minimum time gap
      if (recentRequests.length > 0) {
        const lastRequest = recentRequests.sort(
          (a, b) => b.requestedAt.getTime() - a.requestedAt.getTime()
        )[0];
        const timeGap = now - lastRequest.requestedAt.getTime();
        const gapSeconds = timeGap / 1000;

        if (gapSeconds < FRAUD_THRESHOLDS.TIME_GAP_MIN_SECONDS) {
          return {
            name: 'Velocity Check',
            passed: false,
            score: 0.6,
            details: `Only ${gapSeconds.toFixed(1)} seconds since last request (min: ${FRAUD_THRESHOLDS.TIME_GAP_MIN_SECONDS}s)`,
          };
        }
      }

      return {
        name: 'Velocity Check',
        passed: true,
        score: 0,
        details: 'Velocity within normal limits',
      };
    } catch (error) {
      console.error('[FraudPrevention] Velocity check error:', error);
      return {
        name: 'Velocity Check',
        passed: true,
        score: 0,
        details: 'Check skipped due to error',
      };
    }
  }

  /**
   * 5. Device Anomaly Detection
   * Detects suspicious device patterns
   */
  private async checkDeviceAnomaly(request: ICashbackRequest): Promise<FraudCheck> {
    try {
      if (!request.deviceFingerprint) {
        return {
          name: 'Device Anomaly Detection',
          passed: true,
          score: 0.1,
          details: 'No device fingerprint provided - reduced confidence',
        };
      }

      // Check how many different users used this device
      const deviceUsers = await this.CashbackRequest.distinct('userId', {
        deviceFingerprint: request.deviceFingerprint,
      });

      if (deviceUsers.length > 3) {
        return {
          name: 'Device Anomaly Detection',
          passed: false,
          score: 0.8,
          details: `${deviceUsers.length} different users on same device`,
        };
      }

      // Check for new device patterns
      const firstDeviceRequest = await this.CashbackRequest.findOne({
        deviceFingerprint: request.deviceFingerprint,
      })
        .sort({ requestedAt: 1 })
        .lean();

      if (firstDeviceRequest) {
        const daysSinceFirstUse =
          (Date.now() - firstDeviceRequest.requestedAt.getTime()) /
          (1000 * 60 * 60 * 24);

        // Very new device making large requests
        if (daysSinceFirstUse < 1 && request.cashbackAmount > 50) {
          return {
            name: 'Device Anomaly Detection',
            passed: false,
            score: 0.6,
            details: `Large request on very new device (${daysSinceFirstUse.toFixed(1)} days old)`,
          };
        }
      }

      return {
        name: 'Device Anomaly Detection',
        passed: true,
        score: 0,
        details: 'Device appears legitimate',
      };
    } catch (error) {
      console.error('[FraudPrevention] Device check error:', error);
      return {
        name: 'Device Anomaly Detection',
        passed: true,
        score: 0,
        details: 'Check skipped due to error',
      };
    }
  }

  /**
   * 6. IP Anomaly Detection
   * Detects suspicious IP patterns
   */
  private async checkIpAnomaly(request: ICashbackRequest): Promise<FraudCheck> {
    try {
      if (!request.ipAddress) {
        return {
          name: 'IP Anomaly Detection',
          passed: true,
          score: 0.1,
          details: 'No IP address provided - reduced confidence',
        };
      }

      // Check for too many users from same IP
      const ipUsers = await this.CashbackRequest.distinct('userId', {
        ipAddress: request.ipAddress,
      });

      if (ipUsers.length > 5) {
        return {
          name: 'IP Anomaly Detection',
          passed: false,
          score: 0.7,
          details: `${ipUsers.length} different users from same IP`,
        };
      }

      // Check for VPN/Proxy indicators (simplified)
      // In production, would integrate with VPN/proxy detection service
      const suspiciousIps = await this.getSuspiciousIpList();
      if (suspiciousIps.has(request.ipAddress)) {
        return {
          name: 'IP Anomaly Detection',
          passed: false,
          score: 0.9,
          details: 'IP address flagged as VPN/Proxy/Tor',
        };
      }

      // Check geographic consistency
      if (request.location && request.userId) {
        const lastKnownLocation = await this.getLastKnownLocation(request.userId);
        if (lastKnownLocation && request.location.country) {
          if (lastKnownLocation.country !== request.location.country) {
            // Check if it's plausible (user traveling)
            const lastRequest = await this.CashbackRequest.findOne({
              userId: request.userId,
            })
              .sort({ requestedAt: -1 })
              .lean();

            if (lastRequest && lastRequest.requestedAt) {
              const hoursSinceLastRequest =
                (Date.now() - lastRequest.requestedAt.getTime()) / (1000 * 60 * 60);
              if (hoursSinceLastRequest < 24) {
                return {
                  name: 'IP Anomaly Detection',
                  passed: false,
                  score: 0.75,
                  details: `Country changed from ${lastKnownLocation.country} to ${request.location.country} within 24 hours`,
                };
              }
            }
          }
        }
      }

      return {
        name: 'IP Anomaly Detection',
        passed: true,
        score: 0,
        details: 'IP appears legitimate',
      };
    } catch (error) {
      console.error('[FraudPrevention] IP check error:', error);
      return {
        name: 'IP Anomaly Detection',
        passed: true,
        score: 0,
        details: 'Check skipped due to error',
      };
    }
  }

  /**
   * 7. Amount Anomaly Detection
   * Detects unusual cashback amounts
   */
  private async checkAmountAnomaly(request: ICashbackRequest): Promise<FraudCheck> {
    try {
      // Check absolute thresholds
      if (request.cashbackAmount > FRAUD_THRESHOLDS.MAX_SINGLE_CASHBACK) {
        return {
          name: 'Amount Anomaly Detection',
          passed: false,
          score: 0.85,
          details: `Cashback amount ${request.cashbackAmount} exceeds maximum ${FRAUD_THRESHOLDS.MAX_SINGLE_CASHBACK}`,
        };
      }

      if (request.cashbackAmount < FRAUD_THRESHOLDS.MIN_SINGLE_CASHBACK) {
        return {
          name: 'Amount Anomaly Detection',
          passed: false,
          score: 0.5,
          details: `Cashback amount ${request.cashbackAmount} below minimum ${FRAUD_THRESHOLDS.MIN_SINGLE_CASHBACK}`,
        };
      }

      // Check statistical anomaly
      const userRequests = await this.CashbackRequest.find({
        userId: request.userId,
        requestedAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      })
        .select('cashbackAmount')
        .lean();

      if (userRequests.length >= 5) {
        const amounts = userRequests.map((r) => r.cashbackAmount);
        const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
        const stdDev = Math.sqrt(
          amounts.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / amounts.length
        );

        if (stdDev > 0) {
          const zScore = Math.abs(request.cashbackAmount - mean) / stdDev;
          if (zScore > FRAUD_THRESHOLDS.AMOUNT_STD_DEV_THRESHOLD) {
            return {
              name: 'Amount Anomaly Detection',
              passed: false,
              score: 0.7,
              details: `Amount ${request.cashbackAmount} is ${zScore.toFixed(1)} std deviations from mean (${mean.toFixed(2)})`,
            };
          }
        }
      }

      // Check round number anomaly (often used in fraud)
      const isSuspiciousRound =
        request.cashbackAmount === Math.floor(request.cashbackAmount) &&
        request.cashbackAmount > 10;
      if (isSuspiciousRound) {
        const roundNumberCount = userRequests.filter(
          (r) => r.cashbackAmount === Math.floor(r.cashbackAmount)
        ).length;
        if (roundNumberCount / Math.max(userRequests.length, 1) > 0.8) {
          return {
            name: 'Amount Anomaly Detection',
            passed: false,
            score: 0.4,
            details: 'Suspiciously high proportion of round number amounts',
          };
        }
      }

      return {
        name: 'Amount Anomaly Detection',
        passed: true,
        score: 0,
        details: 'Amount within normal range',
      };
    } catch (error) {
      console.error('[FraudPrevention] Amount check error:', error);
      return {
        name: 'Amount Anomaly Detection',
        passed: true,
        score: 0,
        details: 'Check skipped due to error',
      };
    }
  }

  /**
   * 8. Location Anomaly Detection
   * Detects suspicious location patterns
   */
  private async checkLocationAnomaly(request: ICashbackRequest): Promise<FraudCheck> {
    try {
      if (!request.location) {
        return {
          name: 'Location Anomaly Detection',
          passed: true,
          score: 0.05,
          details: 'No location data provided - reduced confidence',
        };
      }

      // Check high-risk countries
      const highRiskCountries = ['XX', 'YY', 'ZZ']; // Would be real list
      if (request.location.country && highRiskCountries.includes(request.location.country)) {
        return {
          name: 'Location Anomaly Detection',
          passed: false,
          score: 0.7,
          details: `Request from high-risk country: ${request.location.country}`,
        };
      }

      // Check impossible travel
      if (request.userId && request.location.lat && request.location.lon) {
        const lastLocation = await this.getLastKnownLocation(request.userId);
        if (lastLocation && lastLocation.lat && lastLocation.lon) {
          const distance = this.calculateDistance(
            lastLocation.lat,
            lastLocation.lon,
            request.location.lat,
            request.location.lon
          );
          const lastRequest = await this.CashbackRequest.findOne({
            userId: request.userId,
          })
            .sort({ requestedAt: -1 })
            .lean();

          if (lastRequest && lastRequest.requestedAt) {
            const hoursSinceLast = (Date.now() - lastRequest.requestedAt.getTime()) / (1000 * 60 * 60);
            const maxPossibleDistance = hoursSinceLast * 1000; // Max 1000 km/h (fast plane)

            if (distance > maxPossibleDistance) {
              return {
                name: 'Location Anomaly Detection',
                passed: false,
                score: 0.95,
                details: `Impossible travel: ${distance.toFixed(0)} km in ${hoursSinceLast.toFixed(1)} hours`,
              };
            }
          }
        }
      }

      return {
        name: 'Location Anomaly Detection',
        passed: true,
        score: 0,
        details: 'Location appears legitimate',
      };
    } catch (error) {
      console.error('[FraudPrevention] Location check error:', error);
      return {
        name: 'Location Anomaly Detection',
        passed: true,
        score: 0,
        details: 'Check skipped due to error',
      };
    }
  }

  /**
   * 9. Account Anomaly Detection
   * Detects suspicious account behavior patterns
   */
  private async checkAccountAnomaly(request: ICashbackRequest): Promise<FraudCheck> {
    try {
      // Check user risk profile
      const riskProfile = await this.UserRiskProfile.findOne({
        userId: request.userId,
      });

      if (riskProfile?.isBlacklisted) {
        return {
          name: 'Account Anomaly Detection',
          passed: false,
          score: 1.0,
          details: 'User is blacklisted',
        };
      }

      if (riskProfile?.isWhitelisted) {
        return {
          name: 'Account Anomaly Detection',
          passed: true,
          score: 0,
          details: 'User is whitelisted - bypassed checks',
        };
      }

      if (riskProfile && riskProfile.riskScore > 0.7) {
        return {
          name: 'Account Anomaly Detection',
          passed: false,
          score: riskProfile.riskScore,
          details: `User has elevated risk score: ${riskProfile.riskScore.toFixed(2)}`,
        };
      }

      // Check account age
      const firstRequest = await this.CashbackRequest.findOne({
        userId: request.userId,
      })
        .sort({ requestedAt: 1 })
        .lean();

      if (firstRequest && firstRequest.requestedAt) {
        const accountAgeDays =
          (Date.now() - firstRequest.requestedAt.getTime()) / (1000 * 60 * 60 * 24);

        // New account with high cashback
        if (accountAgeDays < 7 && request.cashbackAmount > 100) {
          return {
            name: 'Account Anomaly Detection',
            passed: false,
            score: 0.65,
            details: `New account (${accountAgeDays.toFixed(1)} days) requesting large cashback`,
          };
        }

        // Very new account
        if (accountAgeDays < 1) {
          return {
            name: 'Account Anomaly Detection',
            passed: false,
            score: 0.3,
            details: `Very new account (< 24 hours old)`,
          };
        }
      }

      // Check for known fraud patterns in flags
      if (riskProfile && riskProfile.flags.length > 3) {
        return {
          name: 'Account Anomaly Detection',
          passed: false,
          score: 0.5,
          details: `User has ${riskProfile.flags.length} historical fraud flags`,
        };
      }

      return {
        name: 'Account Anomaly Detection',
        passed: true,
        score: 0,
        details: 'Account appears legitimate',
      };
    } catch (error) {
      console.error('[FraudPrevention] Account check error:', error);
      return {
        name: 'Account Anomaly Detection',
        passed: true,
        score: 0,
        details: 'Check skipped due to error',
      };
    }
  }

  // ── Helper Methods ─────────────────────────────────────────────────────────

  private calculateFraudScore(flags: FraudFlag[]): number {
    if (flags.length === 0) return 0;

    // Weighted sum with diminishing returns
    const sortedFlags = [...flags].sort((a, b) => b.points - a.points);
    let totalScore = 0;

    sortedFlags.forEach((flag, index) => {
      // First flag has full weight, subsequent flags have diminishing weight
      const weight = Math.pow(0.7, index);
      totalScore += flag.points * weight;
    });

    // Cap at 1.0
    return Math.min(1.0, totalScore);
  }

  private calculateRiskLevel(score: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (score >= FRAUD_THRESHOLDS.FRAUD_SCORE_CRITICAL) return 'CRITICAL';
    if (score >= FRAUD_THRESHOLDS.FRAUD_SCORE_HIGH) return 'HIGH';
    if (score >= FRAUD_THRESHOLDS.FRAUD_SCORE_MEDIUM) return 'MEDIUM';
    return 'LOW';
  }

  private createFlag(
    type: FraudFlagType,
    check: FraudCheck
  ): FraudFlag {
    let severity: FraudFlag['severity'] = 'LOW';
    if (check.score >= 0.9) severity = 'CRITICAL';
    else if (check.score >= 0.7) severity = 'HIGH';
    else if (check.score >= 0.4) severity = 'MEDIUM';

    return {
      type,
      severity,
      description: check.details,
      evidence: { checkScore: check.score },
      points: check.score,
    };
  }

  private generateRecommendations(
    flags: FraudFlag[],
    score: number,
    riskLevel: string
  ): string[] {
    const recommendations: string[] = [];

    if (score >= FRAUD_THRESHOLDS.AUTO_REJECT_SCORE) {
      recommendations.push('AUTO_REJECT: Fraud score exceeds automatic rejection threshold');
    } else if (riskLevel === 'CRITICAL' || riskLevel === 'HIGH') {
      recommendations.push('MANUAL_REVIEW: Requires human review before processing');
    }

    const flagTypes = flags.map((f) => f.type);

    if (flagTypes.includes('DUPLICATE_REQUEST')) {
      recommendations.push('Check for duplicate processing - refund second request');
    }

    if (flagTypes.includes('SELF_REWARD')) {
      recommendations.push('Review user-merchant relationship for conflicts of interest');
    }

    if (flagTypes.includes('CIRCULAR_REWARD_CHAIN')) {
      recommendations.push('Investigate referral chain for coordinated fraud');
    }

    if (flagTypes.includes('VELOCITY_ANOMALY')) {
      recommendations.push('Consider implementing stricter rate limiting for this user');
    }

    if (flagTypes.includes('LOCATION_ANOMALY')) {
      recommendations.push('Verify user identity - potential account compromise');
    }

    if (flagTypes.includes('AMOUNT_ANOMALY')) {
      recommendations.push('Review transaction for legitimate business justification');
    }

    if (recommendations.length === 0) {
      recommendations.push('APPROVE: Request passes all fraud checks');
    }

    return recommendations;
  }

  private async logRequest(request: ICashbackRequest): Promise<void> {
    try {
      await this.CashbackRequest.create({
        ...request,
        requestedAt: request.requestedAt || new Date(),
      });
    } catch (error: unknown) {
      // Ignore duplicate key errors (already logged)
      if ((error as { code?: number }).code !== 11000) {
        throw error;
      }
    }
  }

  private async createFraudReport(
    request: ICashbackRequest,
    fraudScore: number,
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
    flags: FraudFlag[]
  ): Promise<IFraudReport> {
    const reportId = `FR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    return this.FraudReport.create({
      reportId,
      requestId: request.requestId,
      userId: request.userId,
      fraudScore,
      riskLevel,
      flags,
      isActioned: false,
    });
  }

  async updateUserRiskProfile(
    userId: string,
    fraudDetected: boolean,
    flags: FraudFlag[]
  ): Promise<void> {
    const update: Record<string, unknown> = {
      $set: { lastSeenAt: new Date() },
      $inc: { totalRequests: 1, updateCount: 1 },
    };

    if (fraudDetected) {
      update.$inc = { ...((update.$inc as Record<string, number>) || {}), fraudRequests: 1 };
      update.$set = {
        ...((update.$set as Record<string, unknown>) || {}),
        lastFraudAt: new Date(),
      };
    }

    // Update flags array
    const flagTypes = flags.map((f) => f.type);
    update.$addToSet = { flags: { $each: flagTypes } };

    await this.UserRiskProfile.findOneAndUpdate({ userId }, update, {
      upsert: true,
      setDefaultsOnInsert: true,
    });

    // Recalculate risk score
    const profile = await this.UserRiskProfile.findOne({ userId });
    if (profile) {
      const fraudRate = profile.fraudRequests / Math.max(profile.totalRequests, 1);
      const flagCount = profile.flags.length;
      const newRiskScore = Math.min(1, fraudRate * 0.5 + flagCount * 0.1);

      let newRiskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
      if (newRiskScore >= 0.8) newRiskLevel = 'CRITICAL';
      else if (newRiskScore >= 0.5) newRiskLevel = 'HIGH';
      else if (newRiskScore >= 0.2) newRiskLevel = 'MEDIUM';

      await this.UserRiskProfile.updateOne(
        { userId },
        { $set: { riskScore: newRiskScore, riskLevel: newRiskLevel } }
      );
    }
  }

  async addToRewardChain(
    userId: string,
    merchantId: string,
    orderId: string,
    cashbackAmount: number,
    parentUserId?: string
  ): Promise<IRewardChainNode> {
    // Calculate depth
    let depth = 0;
    if (parentUserId) {
      const parentNode = await this.RewardChainNode.findOne({ userId: parentUserId });
      depth = parentNode ? parentNode.depth + 1 : 0;
    }

    // Generate chain hash
    const chainHash = this.generateChainHash(userId, parentUserId);

    const node = await this.RewardChainNode.create({
      userId,
      merchantId,
      orderId,
      cashbackAmount,
      parentUserId,
      childUserIds: [],
      depth,
      chainHash,
    });

    // Update parent's child list
    if (parentUserId) {
      await this.RewardChainNode.updateOne(
        { userId: parentUserId },
        { $addToSet: { childUserIds: userId } }
      );
    }

    return node;
  }

  private generateChainHash(userId: string, parentUserId?: string): string {
    // Simple hash for chain identification
    const input = parentUserId ? `${parentUserId}->${userId}` : userId;
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  private async getSuspiciousIpList(): Promise<Set<string>> {
    // In production, would query from a VPN/proxy database
    // For now, return empty set
    return new Set();
  }

  private async getLastKnownLocation(
    userId: string
  ): Promise<{ country?: string; lat?: number; lon?: number } | null> {
    const lastRequest = await this.CashbackRequest.findOne({
      userId,
      'location.country': { $exists: true },
    })
      .sort({ requestedAt: -1 })
      .select('location')
      .lean();

    return lastRequest?.location || null;
  }

  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    // Haversine formula
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  // ── Public API Methods ───────────────────────────────────────────────────

  /**
   * Get velocity metrics for a user
   */
  async getVelocityMetrics(userId: string): Promise<VelocityMetrics> {
    const now = Date.now();
    const oneHourAgo = new Date(now - 60 * 60 * 1000);
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const [lastHour, last24Hours, last7Days] = await Promise.all([
      this.CashbackRequest.countDocuments({
        userId,
        requestedAt: { $gte: oneHourAgo },
      }),
      this.CashbackRequest.countDocuments({
        userId,
        requestedAt: { $gte: oneDayAgo },
      }),
      this.CashbackRequest.find({
        userId,
        requestedAt: { $gte: sevenDaysAgo },
      }).lean(),
    ]);

    const totalCashback = last24Hours
      ? (
          await this.CashbackRequest.find({
            userId,
            requestedAt: { $gte: oneDayAgo },
          })
            .select('cashbackAmount')
            .lean()
        ).reduce((sum, r) => sum + r.cashbackAmount, 0)
      : 0;

    return {
      requestsLastHour: lastHour,
      requestsLast24Hours: last24Hours,
      requestsLast7Days: last7Days.length,
      totalCashbackLast24Hours: totalCashback,
      avgCashbackPerRequest: last24Hours > 0 ? totalCashback / last24Hours : 0,
      requestFrequency: lastHour > 0 ? lastHour : 0,
    };
  }

  /**
   * Get fraud report by ID
   */
  async getFraudReport(reportId: string): Promise<IFraudReport | null> {
    return this.FraudReport.findOne({ reportId });
  }

  /**
   * Get fraud reports for a user
   */
  async getUserFraudReports(
    userId: string,
    limit = 50
  ): Promise<IFraudReport[]> {
    return this.FraudReport.find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit);
  }

  /**
   * Get pending fraud reports (not yet actioned)
   */
  async getPendingFraudReports(
    riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
    limit = 100
  ): Promise<IFraudReport[]> {
    const query: Record<string, unknown> = { isActioned: false };
    if (riskLevel) query.riskLevel = riskLevel;
    return this.FraudReport.find(query).sort({ fraudScore: -1, createdAt: -1 }).limit(limit);
  }

  /**
   * Action a fraud report (approve/reject/mark for review)
   */
  async actionFraudReport(
    reportId: string,
    action: 'APPROVED' | 'REJECTED' | 'MANUAL_REVIEW',
    actionedBy: string,
    notes?: string
  ): Promise<IFraudReport | null> {
    return this.FraudReport.findOneAndUpdate(
      { reportId },
      {
        $set: {
          isActioned: true,
          action,
          actionedBy,
          actionedAt: new Date(),
          notes,
        },
      },
      { new: true }
    );
  }

  /**
   * Get fraud statistics
   */
  async getFraudStatistics(
    startDate?: Date,
    endDate?: Date
  ): Promise<{
    totalReports: number;
    byRiskLevel: Record<string, number>;
    byAction: Record<string, number>;
    avgFraudScore: number;
    topFlagTypes: { type: string; count: number }[];
  }> {
    const query: Record<string, unknown> = {};
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) (query.createdAt as Record<string, Date>).$gte = startDate;
      if (endDate) (query.createdAt as Record<string, Date>).$lte = endDate;
    }

    const reports = await this.FraudReport.find(query).lean();

    const byRiskLevel: Record<string, number> = {};
    const byAction: Record<string, number> = {};
    let totalScore = 0;
    const flagCounts: Record<string, number> = {};

    for (const report of reports) {
      byRiskLevel[report.riskLevel] = (byRiskLevel[report.riskLevel] || 0) + 1;
      if (report.action) {
        byAction[report.action] = (byAction[report.action] || 0) + 1;
      }
      totalScore += report.fraudScore;

      for (const flag of report.flags) {
        flagCounts[flag.type] = (flagCounts[flag.type] || 0) + 1;
      }
    }

    const topFlagTypes = Object.entries(flagCounts)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalReports: reports.length,
      byRiskLevel,
      byAction,
      avgFraudScore: reports.length > 0 ? totalScore / reports.length : 0,
      topFlagTypes,
    };
  }

  /**
   * Whitelist a user (skip fraud checks)
   */
  async whitelistUser(userId: string): Promise<void> {
    await this.UserRiskProfile.findOneAndUpdate(
      { userId },
      { $set: { isWhitelisted: true } },
      { upsert: true }
    );
  }

  /**
   * Blacklist a user (always reject)
   */
  async blacklistUser(userId: string): Promise<void> {
    await this.UserRiskProfile.findOneAndUpdate(
      { userId },
      { $set: { isBlacklisted: true, isWhitelisted: false } },
      { upsert: true }
    );
  }

  /**
   * Remove user from whitelist/blacklist
   */
  async unlistUser(userId: string): Promise<void> {
    await this.UserRiskProfile.updateOne(
      { userId },
      { $set: { isWhitelisted: false, isBlacklisted: false } }
    );
  }

  /**
   * Get user risk profile
   */
  async getUserRiskProfile(userId: string): Promise<IUserRiskProfile | null> {
    return this.UserRiskProfile.findOne({ userId });
  }
}

// ── Export Singleton ───────────────────────────────────────────────────────────

export const cashbackFraudPrevention = new CashbackFraudPreventionService();
export default cashbackFraudPrevention;

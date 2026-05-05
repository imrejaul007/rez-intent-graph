// ── Cashback Fraud Detection Models ────────────────────────────────────────────
// MongoDB schemas for fraud prevention data structures

import mongoose, { Schema, Document, Model } from 'mongoose';

// ── Cashback Request Model ──────────────────────────────────────────────────────

export interface ICashbackRequestDocument extends Document {
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

const CashbackRequestLocationSchema = new Schema(
  {
    country: { type: String, index: true },
    region: { type: String },
    city: { type: String },
    lat: { type: Number },
    lon: { type: Number },
  },
  { _id: false }
);

const CashbackRequestSchema = new Schema<ICashbackRequestDocument>(
  {
    requestId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    merchantId: {
      type: String,
      required: true,
      index: true,
    },
    orderId: {
      type: String,
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    cashbackAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: 'USD',
    },
    deviceFingerprint: {
      type: String,
      index: true,
    },
    ipAddress: {
      type: String,
      index: true,
    },
    userAgent: {
      type: String,
    },
    location: CashbackRequestLocationSchema,
    metadata: {
      type: Schema.Types.Mixed,
    },
    requestedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

// Compound indexes for fraud detection queries
CashbackRequestSchema.index({ userId: 1, requestedAt: -1 });
CashbackRequestSchema.index({ userId: 1, merchantId: 1, requestedAt: -1 });
CashbackRequestSchema.index({ deviceFingerprint: 1, requestedAt: -1 });
CashbackRequestSchema.index({ ipAddress: 1, requestedAt: -1 });
CashbackRequestSchema.index({ orderId: 1 }, { unique: true });
CashbackRequestSchema.index({ userId: 1, cashbackAmount: 1 });

// ── Fraud Report Model ─────────────────────────────────────────────────────────

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

export type FraudSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type FraudAction = 'APPROVED' | 'REJECTED' | 'MANUAL_REVIEW';

export interface IFraudFlag {
  type: FraudFlagType;
  severity: FraudSeverity;
  description: string;
  evidence: Record<string, unknown>;
  points: number;
}

export interface IFraudReportDocument extends Document {
  reportId: string;
  requestId: string;
  userId: string;
  merchantId?: string;
  fraudScore: number;
  riskLevel: FraudSeverity;
  flags: IFraudFlag[];
  isActioned: boolean;
  action?: FraudAction;
  actionedBy?: string;
  actionedAt?: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const FraudFlagSchema = new Schema<IFraudFlag>(
  {
    type: {
      type: String,
      required: true,
      enum: [
        'DUPLICATE_REQUEST',
        'SELF_REWARD',
        'CIRCULAR_REWARD_CHAIN',
        'VELOCITY_ANOMALY',
        'DEVICE_ANOMALY',
        'IP_ANOMALY',
        'AMOUNT_ANOMALY',
        'CARD_ANOMALY',
        'LOCATION_ANOMALY',
        'ACCOUNT_ANOMALY',
        'BEHAVIOR_ANOMALY',
      ],
    },
    severity: {
      type: String,
      required: true,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    },
    description: {
      type: String,
      required: true,
    },
    evidence: {
      type: Schema.Types.Mixed,
    },
    points: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
  },
  { _id: false }
);

const FraudReportSchema = new Schema<IFraudReportDocument>(
  {
    reportId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    requestId: {
      type: String,
      required: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    merchantId: {
      type: String,
      index: true,
    },
    fraudScore: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    riskLevel: {
      type: String,
      required: true,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    },
    flags: [FraudFlagSchema],
    isActioned: {
      type: Boolean,
      default: false,
    },
    action: {
      type: String,
      enum: ['APPROVED', 'REJECTED', 'MANUAL_REVIEW'],
    },
    actionedBy: {
      type: String,
    },
    actionedAt: {
      type: Date,
    },
    notes: {
      type: String,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Indexes for fraud report queries
FraudReportSchema.index({ userId: 1, createdAt: -1 });
FraudReportSchema.index({ fraudScore: 1, createdAt: -1 });
FraudReportSchema.index({ riskLevel: 1, isActioned: 1 });
FraudReportSchema.index({ isActioned: 1, createdAt: -1 });

// ── User Risk Profile Model ────────────────────────────────────────────────────

export interface IUserRiskProfileDocument extends Document {
  userId: string;
  riskScore: number;
  riskLevel: FraudSeverity;
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

const UserRiskProfileSchema = new Schema<IUserRiskProfileDocument>(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    riskScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 1,
    },
    riskLevel: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      default: 'LOW',
    },
    totalRequests: {
      type: Number,
      default: 0,
    },
    fraudRequests: {
      type: Number,
      default: 0,
    },
    lastFraudAt: {
      type: Date,
    },
    flags: [
      {
        type: String,
        index: true,
      },
    ],
    firstSeenAt: {
      type: Date,
      default: Date.now,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
    isWhitelisted: {
      type: Boolean,
      default: false,
    },
    isBlacklisted: {
      type: Boolean,
      default: false,
    },
    updateCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

// Indexes
UserRiskProfileSchema.index({ riskScore: 1 });
UserRiskProfileSchema.index({ riskLevel: 1 });
UserRiskProfileSchema.index({ isBlacklisted: 1 });
UserRiskProfileSchema.index({ isWhitelisted: 1 });
UserRiskProfileSchema.index({ flags: 1 });

// ── Reward Chain Node Model ─────────────────────────────────────────────────────

export interface IRewardChainNodeDocument extends Document {
  userId: string;
  merchantId: string;
  orderId: string;
  cashbackAmount: number;
  parentUserId?: string;
  childUserIds: string[];
  depth: number;
  chainHash: string;
  createdAt: Date;
}

const RewardChainNodeSchema = new Schema<IRewardChainNodeDocument>(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    merchantId: {
      type: String,
      required: true,
    },
    orderId: {
      type: String,
      required: true,
      unique: true,
    },
    cashbackAmount: {
      type: Number,
      required: true,
    },
    parentUserId: {
      type: String,
      index: true,
    },
    childUserIds: [
      {
        type: String,
        index: true,
      },
    ],
    depth: {
      type: Number,
      default: 0,
    },
    chainHash: {
      type: String,
      index: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

// Indexes
RewardChainNodeSchema.index({ chainHash: 1 });
RewardChainNodeSchema.index({ parentUserId: 1, childUserIds: 1 });
RewardChainNodeSchema.index({ userId: 1, depth: 1 });

// ── Fraud Configuration Model ──────────────────────────────────────────────────

export interface IFraudConfigDocument extends Document {
  key: string;
  value: number | string | boolean;
  description?: string;
  updatedAt: Date;
}

const FraudConfigSchema = new Schema<IFraudConfigDocument>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    value: {
      type: Schema.Types.Mixed,
      required: true,
    },
    description: {
      type: String,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

// ── Model Exports ─────────────────────────────────────────────────────────────

export const CashbackRequest: Model<ICashbackRequestDocument> =
  mongoose.models.CashbackRequest ||
  mongoose.model<ICashbackRequestDocument>('CashbackRequest', CashbackRequestSchema);

export const FraudReport: Model<IFraudReportDocument> =
  mongoose.models.FraudReport ||
  mongoose.model<IFraudReportDocument>('FraudReport', FraudReportSchema);

export const UserRiskProfile: Model<IUserRiskProfileDocument> =
  mongoose.models.UserRiskProfile ||
  mongoose.model<IUserRiskProfileDocument>('UserRiskProfile', UserRiskProfileSchema);

export const RewardChainNode: Model<IRewardChainNodeDocument> =
  mongoose.models.RewardChainNode ||
  mongoose.model<IRewardChainNodeDocument>('RewardChainNode', RewardChainNodeSchema);

export const FraudConfig: Model<IFraudConfigDocument> =
  mongoose.models.FraudConfig ||
  mongoose.model<IFraudConfigDocument>('FraudConfig', FraudConfigSchema);

// ── Default Configuration ──────────────────────────────────────────────────────

export const DEFAULT_FRAUD_THRESHOLDS = {
  // Velocity limits
  MAX_REQUESTS_PER_HOUR: 5,
  MAX_REQUESTS_PER_DAY: 20,
  MAX_CASHBACK_PER_DAY: 500,
  MAX_REQUESTS_SAME_MERCHANT_HOUR: 3,

  // Chain detection
  MAX_CHAIN_LENGTH: 5,

  // Amount thresholds
  MAX_SINGLE_CASHBACK: 200,
  MIN_SINGLE_CASHBACK: 0.01,

  // Anomaly thresholds
  AMOUNT_STD_DEV_THRESHOLD: 3,
  TIME_GAP_MIN_SECONDS: 60,

  // Risk scoring
  FRAUD_SCORE_LOW: 0.2,
  FRAUD_SCORE_MEDIUM: 0.5,
  FRAUD_SCORE_HIGH: 0.75,
  FRAUD_SCORE_CRITICAL: 0.9,

  // Auto-reject threshold
  AUTO_REJECT_SCORE: 0.85,
};

// ── Seed Default Configuration ────────────────────────────────────────────────

export async function seedFraudConfig(): Promise<void> {
  for (const [key, value] of Object.entries(DEFAULT_FRAUD_THRESHOLDS)) {
    await FraudConfig.findOneAndUpdate(
      { key },
      {
        $set: {
          value,
          description: `Default threshold for ${key}`,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
  }
}

export default {
  CashbackRequest,
  FraudReport,
  UserRiskProfile,
  RewardChainNode,
  FraudConfig,
  seedFraudConfig,
  DEFAULT_FRAUD_THRESHOLDS,
};

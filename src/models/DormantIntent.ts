/**
 * DormantIntent Model - MongoDB Schema
 * Tracks dormant purchase intents for revival
 */

import mongoose, { Schema, Document, Model } from 'mongoose';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface IDormantIntent extends Document {
  _id: mongoose.Types.ObjectId;
  intentId: mongoose.Types.ObjectId;
  userId: string;
  appType: string;
  category: string;
  intentKey: string;
  intentQuery?: string;
  metadata?: Record<string, unknown>;
  dormancyScore: number;
  revivalScore: number;
  daysDormant: number;
  lastNudgeSent?: Date;
  nudgeCount: number;
  idealRevivalAt?: Date;
  status: 'active' | 'paused' | 'revived';
  revivedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ── Schema ────────────────────────────────────────────────────────────────────

const DormantIntentSchema = new Schema<IDormantIntent>({
  intentId: { type: Schema.Types.ObjectId, ref: 'Intent', required: true },
  userId: { type: String, required: true, index: true },
  appType: { type: String, required: true },
  category: { type: String, required: true },
  intentKey: { type: String, required: true },
  intentQuery: { type: String },
  metadata: { type: Schema.Types.Mixed },
  dormancyScore: { type: Number, required: true, min: 0, max: 1, default: 0.5 },
  revivalScore: { type: Number, required: true, min: 0, max: 1, default: 0.5 },
  daysDormant: { type: Number, required: true, default: 0 },
  lastNudgeSent: { type: Date },
  nudgeCount: { type: Number, default: 0 },
  idealRevivalAt: { type: Date },
  status: {
    type: String,
    enum: ['active', 'paused', 'revived'],
    default: 'active',
    index: true
  },
  revivedAt: { type: Date }
}, {
  timestamps: true,
  versionKey: false
});

// Compound indexes
DormantIntentSchema.index({ userId: 1, appType: 1, intentKey: 1 }, { unique: true });
DormantIntentSchema.index({ userId: 1, status: 1 });
DormantIntentSchema.index({ status: 1, revivalScore: 1 });
DormantIntentSchema.index({ idealRevivalAt: 1 }, { sparse: true });

// ── Model ─────────────────────────────────────────────────────────────────────

export const DormantIntent: Model<IDormantIntent> = mongoose.model<IDormantIntent>('DormantIntent', DormantIntentSchema);
export default DormantIntent;

/**
 * NudgeSchedule Model - MongoDB Schema
 * User nudge preferences and scheduling
 */

import mongoose, { Schema, Document, Model } from 'mongoose';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface INudgeSchedule extends Document {
  _id: mongoose.Types.ObjectId;
  userId: string;
  category: 'TRAVEL' | 'DINING' | 'RETAIL' | 'ALL';
  triggerType: 'scheduled' | 'price_drop' | 'return_user' | 'seasonality' | 'offer_match';
  channel: 'push' | 'email' | 'sms' | 'in_app';
  minRevivalScore: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ── Schema ────────────────────────────────────────────────────────────────────

const NudgeScheduleSchema = new Schema<INudgeSchedule>({
  userId: { type: String, required: true, index: true },
  category: {
    type: String,
    enum: ['TRAVEL', 'DINING', 'RETAIL', 'ALL'],
    default: 'ALL'
  },
  triggerType: {
    type: String,
    enum: ['scheduled', 'price_drop', 'return_user', 'seasonality', 'offer_match'],
    required: true
  },
  channel: {
    type: String,
    enum: ['push', 'email', 'sms', 'in_app'],
    required: true
  },
  minRevivalScore: { type: Number, default: 0.3, min: 0, max: 1 },
  active: { type: Boolean, default: true, index: true }
}, {
  timestamps: { updatedAt: true, createdAt: false },
  versionKey: false
});

// Compound indexes
NudgeScheduleSchema.index({ userId: 1, active: 1 });
NudgeScheduleSchema.index({ category: 1, triggerType: 1 });

// ── Model ─────────────────────────────────────────────────────────────────────

export const NudgeSchedule: Model<INudgeSchedule> = mongoose.model<INudgeSchedule>('NudgeSchedule', NudgeScheduleSchema);
export default NudgeSchedule;

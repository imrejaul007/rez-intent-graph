/**
 * Nudge Model - MongoDB Schema
 * Tracks nudge delivery and engagement
 */

import mongoose, { Schema, Document, Model } from 'mongoose';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface INudge extends Document {
  _id: mongoose.Types.ObjectId;
  dormantIntentId: mongoose.Types.ObjectId;
  userId: string;
  channel: 'push' | 'email' | 'sms' | 'in_app';
  message: string;
  status: 'pending' | 'sent' | 'delivered' | 'clicked' | 'converted' | 'failed';
  sentAt?: Date;
  deliveredAt?: Date;
  clickedAt?: Date;
  convertedAt?: Date;
  error?: string;
  createdAt: Date;
}

// ── Schema ────────────────────────────────────────────────────────────────────

const NudgeSchema = new Schema<INudge>({
  dormantIntentId: { type: Schema.Types.ObjectId, ref: 'DormantIntent', required: true },
  userId: { type: String, required: true, index: true },
  channel: {
    type: String,
    enum: ['push', 'email', 'sms', 'in_app'],
    required: true
  },
  message: { type: String, required: true },
  status: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'clicked', 'converted', 'failed'],
    default: 'pending',
    index: true
  },
  sentAt: { type: Date },
  deliveredAt: { type: Date },
  clickedAt: { type: Date },
  convertedAt: { type: Date },
  error: { type: String }
}, {
  timestamps: { createdAt: true, updatedAt: false },
  versionKey: false
});

// Compound indexes
NudgeSchema.index({ dormantIntentId: 1 });
NudgeSchema.index({ userId: 1, status: 1 });
NudgeSchema.index({ status: 1, createdAt: 1 });
NudgeSchema.index({ channel: 1, status: 1 });

// ── Model ─────────────────────────────────────────────────────────────────────

export const Nudge: Model<INudge> = mongoose.model<INudge>('Nudge', NudgeSchema);
export default Nudge;

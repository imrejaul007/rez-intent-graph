/**
 * IntentSequence Model - MongoDB Schema
 * Tracks the sequence of events leading to a purchase intent
 */

import mongoose, { Schema, Document, Model } from 'mongoose';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface IIntentSequence extends Document {
  _id: mongoose.Types.ObjectId;
  intentId: mongoose.Types.ObjectId;
  userId: string;
  eventType: string;
  sequenceOrder: number;
  durationMs?: number;
  occurredAt: Date;
}

// ── Schema ────────────────────────────────────────────────────────────────────

const IntentSequenceSchema = new Schema<IIntentSequence>({
  intentId: { type: Schema.Types.ObjectId, ref: 'Intent', required: true, index: true },
  userId: { type: String, required: true, index: true },
  eventType: { type: String, required: true },
  sequenceOrder: { type: Number, required: true },
  durationMs: { type: Number },
  occurredAt: { type: Date, default: Date.now }
}, {
  timestamps: false,
  versionKey: false
});

// Compound indexes
IntentSequenceSchema.index({ intentId: 1, sequenceOrder: 1 });
IntentSequenceSchema.index({ userId: 1, occurredAt: 1 });

// ── Model ─────────────────────────────────────────────────────────────────────

export const IntentSequence: Model<IIntentSequence> = mongoose.model<IIntentSequence>('IntentSequence', IntentSequenceSchema);
export default IntentSequence;

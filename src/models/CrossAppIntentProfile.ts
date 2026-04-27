/**
 * CrossAppIntentProfile Model - MongoDB Schema
 * Aggregates user intent data across all ReZ apps
 */

import mongoose, { Schema, Document, Model } from 'mongoose';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ICrossAppIntentProfile extends Document {
  _id: mongoose.Types.ObjectId;
  userId: string;
  travelIntentCount: number;
  diningIntentCount: number;
  retailIntentCount: number;
  dormantTravelCount: number;
  dormantDiningCount: number;
  dormantRetailCount: number;
  totalConversions: number;
  travelAffinity: number;
  diningAffinity: number;
  retailAffinity: number;
  lastAppUsed?: string;
  updatedAt: Date;
}

// ── Schema ────────────────────────────────────────────────────────────────────

const CrossAppIntentProfileSchema = new Schema<ICrossAppIntentProfile>({
  userId: { type: String, required: true, unique: true, index: true },
  travelIntentCount: { type: Number, default: 0 },
  diningIntentCount: { type: Number, default: 0 },
  retailIntentCount: { type: Number, default: 0 },
  dormantTravelCount: { type: Number, default: 0 },
  dormantDiningCount: { type: Number, default: 0 },
  dormantRetailCount: { type: Number, default: 0 },
  totalConversions: { type: Number, default: 0 },
  travelAffinity: { type: Number, default: 50, min: 0, max: 100 },
  diningAffinity: { type: Number, default: 50, min: 0, max: 100 },
  retailAffinity: { type: Number, default: 50, min: 0, max: 100 },
  lastAppUsed: { type: String }
}, {
  timestamps: { updatedAt: true, createdAt: false },
  versionKey: false
});

// Indexes for affinity queries
CrossAppIntentProfileSchema.index({ travelAffinity: -1 });
CrossAppIntentProfileSchema.index({ diningAffinity: -1 });
CrossAppIntentProfileSchema.index({ totalConversions: -1 });

// ── Model ─────────────────────────────────────────────────────────────────────

export const CrossAppIntentProfile: Model<ICrossAppIntentProfile> = mongoose.model<ICrossAppIntentProfile>('CrossAppIntentProfile', CrossAppIntentProfileSchema);
export default CrossAppIntentProfile;

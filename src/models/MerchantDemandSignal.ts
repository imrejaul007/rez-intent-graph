/**
 * MerchantDemandSignal Model - MongoDB Schema
 * Aggregated demand signals for merchants
 */

import mongoose, { Schema, Document, Model } from 'mongoose';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface IMerchantDemandSignal extends Document {
  _id: mongoose.Types.ObjectId;
  merchantId: string;
  category: string;
  demandCount: number;
  unmetDemandPct: number;
  avgPriceExpectation?: number;
  topCities: string[];
  trend: 'rising' | 'stable' | 'declining';
  lastAggregated: Date;
}

// ── Schema ────────────────────────────────────────────────────────────────────

const MerchantDemandSignalSchema = new Schema<IMerchantDemandSignal>({
  merchantId: { type: String, required: true, index: true },
  category: { type: String, required: true },
  demandCount: { type: Number, default: 0 },
  unmetDemandPct: { type: Number, default: 0, min: 0, max: 100 },
  avgPriceExpectation: { type: Number },
  topCities: [{ type: String }],
  trend: {
    type: String,
    enum: ['rising', 'stable', 'declining'],
    default: 'stable'
  },
  lastAggregated: { type: Date, default: Date.now }
}, {
  timestamps: false,
  versionKey: false
});

// Compound indexes
MerchantDemandSignalSchema.index({ merchantId: 1, category: 1 }, { unique: true });
MerchantDemandSignalSchema.index({ category: 1, trend: 1 });
MerchantDemandSignalSchema.index({ demandCount: -1 });

// ── Model ─────────────────────────────────────────────────────────────────────

export const MerchantDemandSignal: Model<IMerchantDemandSignal> = mongoose.model<IMerchantDemandSignal>('MerchantDemandSignal', MerchantDemandSignalSchema);
export default MerchantDemandSignal;

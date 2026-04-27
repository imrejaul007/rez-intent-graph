/**
 * MerchantKnowledge Model - MongoDB Schema
 * Stores merchant knowledge base for autonomous chat
 */

import mongoose, { Schema, Document, Model } from 'mongoose';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface IMerchantKnowledge extends Document {
  _id: mongoose.Types.ObjectId;
  merchantId: string;
  type: 'menu' | 'policy' | 'faq' | 'offer' | 'hours' | 'contact' | 'custom';
  title: string;
  content: string;
  tags: string[];
  metadata?: Record<string, unknown>;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ── Schema ────────────────────────────────────────────────────────────────────

const MerchantKnowledgeSchema = new Schema<IMerchantKnowledge>({
  merchantId: { type: String, required: true, index: true },
  type: {
    type: String,
    enum: ['menu', 'policy', 'faq', 'offer', 'hours', 'contact', 'custom'],
    required: true
  },
  title: { type: String, required: true },
  content: { type: String, required: true },
  tags: [{ type: String }],
  metadata: { type: Schema.Types.Mixed },
  active: { type: Boolean, default: true, index: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, {
  timestamps: false,
  versionKey: false
});

// Compound indexes
MerchantKnowledgeSchema.index({ merchantId: 1, active: 1 });
MerchantKnowledgeSchema.index({ type: 1, merchantId: 1 });
MerchantKnowledgeSchema.index({ merchantId: 1, type: 1 });
MerchantKnowledgeSchema.index({ merchantId: 1, tags: 1 });

// Text index for search
MerchantKnowledgeSchema.index({ title: 'text', content: 'text', tags: 'text' });

// ── Model ─────────────────────────────────────────────────────────────────────

export const MerchantKnowledge: Model<IMerchantKnowledge> = mongoose.model<IMerchantKnowledge>('MerchantKnowledge', MerchantKnowledgeSchema);
export default MerchantKnowledge;

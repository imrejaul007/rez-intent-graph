/**
 * Merchant Knowledge Service - MongoDB
 * Stores and retrieves merchant knowledge base for autonomous chat
 */

import { MerchantKnowledge } from '../models/index.js';
import type { IMerchantKnowledge } from '../models/MerchantKnowledge.js';

export interface KnowledgeEntry {
  type: 'menu' | 'policy' | 'faq' | 'offer' | 'hours' | 'contact' | 'custom';
  title: string;
  content: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export type KnowledgeType = KnowledgeEntry['type'];

export interface ChatContext {
  merchantId: string;
  relevantEntries: IMerchantKnowledge[];
  summary: string;
}

/**
 * Merchant Knowledge Service - MongoDB Implementation
 */
export class MerchantKnowledgeService {
  /**
   * Add knowledge entry for a merchant
   */
  async addKnowledgeEntry(merchantId: string, entry: KnowledgeEntry): Promise<IMerchantKnowledge> {
    return MerchantKnowledge.create({
      merchantId,
      type: entry.type,
      title: entry.title,
      content: entry.content,
      tags: entry.tags || [],
      metadata: entry.metadata,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  /**
   * Bulk import knowledge entries
   */
  async bulkImportKnowledge(merchantId: string, entries: KnowledgeEntry[]): Promise<number> {
    const docs = entries.map((entry) => ({
      merchantId,
      type: entry.type,
      title: entry.title,
      content: entry.content,
      tags: entry.tags || [],
      metadata: entry.metadata,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    const result = await MerchantKnowledge.insertMany(docs, { ordered: false });
    return result.length;
  }

  /**
   * Search merchant knowledge — two call signatures
   * (1) searchKnowledge(merchantId, query, type?) — direct call
   * (2) searchKnowledge({ merchantId, query, category, limit }) — object call
   */
  async searchKnowledge(
    merchantIdOrParams: string | { merchantId: string; query?: string; category?: string; limit?: number; type?: string },
    query?: string,
    type?: string
  ): Promise<IMerchantKnowledge[]> {
    let merchantId: string;
    let q: string;
    let limit: number;

    if (typeof merchantIdOrParams === 'string') {
      merchantId = merchantIdOrParams;
      q = query || '';
      limit = 10;
    } else {
      merchantId = merchantIdOrParams.merchantId;
      q = merchantIdOrParams.query || '';
      limit = merchantIdOrParams.limit || 10;
      type = merchantIdOrParams.type || merchantIdOrParams.category;
    }

    const searchQuery: Record<string, unknown> = { merchantId, active: true };
    if (type) searchQuery.type = type;

    // Try text search first
    let results = await MerchantKnowledge.find({
      ...searchQuery,
      $text: { $search: q },
    })
      .sort({ score: { $meta: 'textScore' } })
      .limit(limit);

    // Fallback to regex search
    if (results.length === 0 && q) {
      results = await MerchantKnowledge.find({
        ...searchQuery,
        $or: [
          { title: { $regex: q, $options: 'i' } },
          { content: { $regex: q, $options: 'i' } },
          { tags: { $regex: q, $options: 'i' } },
        ],
      }).limit(limit);
    }

    return results;
  }

  /**
   * Get all active knowledge for a merchant
   */
  async getMerchantKnowledge(
    merchantId: string,
    type?: string
  ): Promise<IMerchantKnowledge[]> {
    const query: Record<string, unknown> = { merchantId, active: true };
    if (type) query.type = type;

    return MerchantKnowledge.find(query).sort({ type: 1, title: 1 });
  }

  /**
   * Update knowledge entry
   */
  async updateKnowledgeEntry(
    entryId: string,
    updates: Partial<KnowledgeEntry>
  ): Promise<IMerchantKnowledge | null> {
    return MerchantKnowledge.findByIdAndUpdate(
      entryId,
      { $set: { ...updates, updatedAt: new Date() } },
      { new: true }
    );
  }

  /**
   * Deactivate knowledge entry
   */
  async deactivateKnowledge(entryId: string): Promise<void> {
    await MerchantKnowledge.updateOne(
      { _id: entryId },
      { $set: { active: false, updatedAt: new Date() } }
    );
  }

  /**
   * Get chat context for a merchant (grouped by type)
   */
  async getChatContext(merchantId: string): Promise<Record<string, IMerchantKnowledge[]>> {
    const knowledge = await MerchantKnowledge.find({ merchantId, active: true });

    const grouped: Record<string, IMerchantKnowledge[]> = {
      menu: [],
      hours: [],
      policy: [],
      faq: [],
      offer: [],
      contact: [],
      custom: [],
    };

    for (const entry of knowledge) {
      if (grouped[entry.type]) {
        grouped[entry.type].push(entry);
      }
    }

    return grouped;
  }

  /**
   * Get knowledge statistics for a merchant
   */
  async getKnowledgeStats(merchantId: string): Promise<Record<string, number>> {
    const knowledge = await MerchantKnowledge.aggregate([
      { $match: { merchantId, active: true } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]);

    const stats: Record<string, number> = {
      menu: 0, hours: 0, policy: 0, faq: 0, offer: 0, contact: 0, custom: 0,
    };

    for (const item of knowledge) {
      stats[item._id] = item.count;
    }

    return stats;
  }

  /**
   * Get menu items for a merchant
   */
  async getMenuItems(merchantId: string): Promise<IMerchantKnowledge[]> {
    return MerchantKnowledge.find({ merchantId, type: 'menu', active: true })
      .sort({ title: 1 });
  }

  /**
   * Get FAQs for a merchant
   */
  async getFaqs(merchantId: string): Promise<IMerchantKnowledge[]> {
    return MerchantKnowledge.find({ merchantId, type: 'faq', active: true })
      .sort({ title: 1 });
  }

  /**
   * Get offers for a merchant
   */
  async getOffers(merchantId: string): Promise<IMerchantKnowledge[]> {
    return MerchantKnowledge.find({ merchantId, type: 'offer', active: true })
      .sort({ title: 1 });
  }

  /**
   * Get knowledge base with all active entries (wrapper for autonomous chat)
   */
  async getKnowledgeBase(merchantId: string): Promise<{ entries: IMerchantKnowledge[] }> {
    const entries = await MerchantKnowledge.find({ merchantId, active: true }).sort({ createdAt: -1 });
    return { entries };
  }

  /**
   * Add a knowledge entry (legacy wrapper)
   */
  async addEntry(params: { merchantId: string; type: string; title: string; content: string; tags?: string[] }): Promise<IMerchantKnowledge> {
    return this.addKnowledgeEntry(params.merchantId, {
      type: params.type as KnowledgeEntry['type'],
      title: params.title,
      content: params.content,
      tags: params.tags,
    });
  }

  /**
   * Bulk import entries (legacy wrapper)
   */
  async bulkImport(params: { merchantId: string; entries: KnowledgeEntry[] }): Promise<{ imported: number }> {
    const count = await this.bulkImportKnowledge(params.merchantId, params.entries);
    return { imported: count };
  }

}


export const merchantKnowledgeService = new MerchantKnowledgeService();

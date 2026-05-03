/**
 * Merchant Knowledge Service - MongoDB
 * Stores and retrieves merchant knowledge base for autonomous chat
 * Includes QR context-aware knowledge retrieval
 */

import { MerchantKnowledge } from '../models/index.js';
import type { IMerchantKnowledge } from '../models/MerchantKnowledge.js';

// QRSource type - local definition since @rez/shared-types not available
type QRSource = 'rez_now' | 'room_qr' | 'menu_qr' | 'ads_qr';

export interface KnowledgeEntry {
  type: 'menu' | 'policy' | 'faq' | 'offer' | 'hours' | 'contact' | 'custom';
  title: string;
  content: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export type KnowledgeType = KnowledgeEntry['type'];

// QR Context-aware knowledge entry extensions
export interface QRKnowledgeEntry extends KnowledgeEntry {
  qrSources?: QRSource[];
  triggerIntents?: string[];
  priorityForIntent?: Record<string, number>;
}

export interface ChatContext {
  merchantId: string;
  relevantEntries: IMerchantKnowledge[];
  summary: string;
}

export interface QRChatContext extends ChatContext {
  qrSource?: QRSource;
  currentIntent?: string;
  suggestedKnowledge?: IMerchantKnowledge[];
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
   * Add QR-aware knowledge entry
   */
  async addQRKnowledgeEntry(merchantId: string, entry: QRKnowledgeEntry): Promise<IMerchantKnowledge> {
    return MerchantKnowledge.create({
      merchantId,
      type: entry.type,
      title: entry.title,
      content: entry.content,
      tags: entry.tags || [],
      metadata: {
        ...entry.metadata,
        qrSources: entry.qrSources,
        triggerIntents: entry.triggerIntents,
        priorityForIntent: entry.priorityForIntent,
      },
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

  // ============================================================
  // QR Context-Aware Knowledge Retrieval
  // ============================================================

  /**
   * Search knowledge with QR context awareness
   */
  async searchKnowledgeForQR(
    merchantId: string,
    query: string,
    qrSource: QRSource,
    currentIntent?: string
  ): Promise<IMerchantKnowledge[]> {
    const searchQuery: Record<string, unknown> = { merchantId, active: true };

    // Build QR-aware search conditions
    const qrConditions: Record<string, unknown>[] = [
      // Entries without QR restrictions (qrSources is null or empty)
      { 'metadata.qrSources': { $exists: false } },
      { 'metadata.qrSources': { $eq: null } },
      { 'metadata.qrSources': { $size: 0 } },
    ];

    // Add QR source-specific entries
    qrConditions.push({ 'metadata.qrSources': qrSource });

    // If we have a current intent, also include entries that trigger on this intent
    if (currentIntent) {
      qrConditions.push({ 'metadata.triggerIntents': currentIntent });
    }

    searchQuery.$or = qrConditions;

    // Text search
    let results = await MerchantKnowledge.find({
      ...searchQuery,
      $text: { $search: query },
    })
      .sort({ score: { $meta: 'textScore' } })
      .limit(20);

    // Fallback to regex
    if (results.length === 0) {
      results = await MerchantKnowledge.find({
        ...searchQuery,
        $or: [
          { title: { $regex: query, $options: 'i' } },
          { content: { $regex: query, $options: 'i' } },
          { tags: { $regex: query, $options: 'i' } },
        ],
      }).limit(20);
    }

    // Sort by QR priority if applicable
    if (currentIntent && results.length > 0) {
      results.sort((a, b) => {
        const aPriority = (a.metadata?.priorityForIntent as Record<string, number>)?.[currentIntent] || 0;
        const bPriority = (b.metadata?.priorityForIntent as Record<string, number>)?.[currentIntent] || 0;
        return bPriority - aPriority;
      });
    }

    return results;
  }

  /**
   * Get knowledge entries triggered by specific intent
   */
  async getKnowledgeForIntent(
    merchantId: string,
    intent: string,
    qrSource?: QRSource
  ): Promise<IMerchantKnowledge[]> {
    const query: Record<string, unknown> = {
      merchantId,
      active: true,
      'metadata.triggerIntents': intent,
    };

    if (qrSource) {
      query.$or = [
        { 'metadata.qrSources': { $exists: false } },
        { 'metadata.qrSources': { $eq: null } },
        { 'metadata.qrSources': qrSource },
      ];
    }

    return MerchantKnowledge.find(query).sort({
      'metadata.priorityForIntent': -1,
    });
  }

  /**
   * Get QR context for chat
   */
  async getQRChatContext(
    merchantId: string,
    qrSource: QRSource,
    currentIntent?: string
  ): Promise<QRChatContext> {
    // Get relevant knowledge based on QR source
    const query: Record<string, unknown> = {
      merchantId,
      active: true,
      $or: [
        { 'metadata.qrSources': { $exists: false } },
        { 'metadata.qrSources': { $eq: null } },
        { 'metadata.qrSources': qrSource },
      ],
    };

    const relevantEntries = await MerchantKnowledge.find(query);

    // Filter by intent if provided
    let suggestedKnowledge: IMerchantKnowledge[] = [];
    if (currentIntent) {
      suggestedKnowledge = relevantEntries.filter(
        e => (e.metadata?.triggerIntents as string[])?.includes(currentIntent)
      );
    }

    // Generate summary
    const grouped = await this.getChatContext(merchantId);
    const summary = this.generateContextSummary(grouped, qrSource, currentIntent);

    return {
      merchantId,
      relevantEntries,
      summary,
      qrSource,
      currentIntent,
      suggestedKnowledge,
    };
  }

  /**
   * Generate context summary for chat
   */
  private generateContextSummary(
    grouped: Record<string, IMerchantKnowledge[]>,
    qrSource: QRSource,
    currentIntent?: string
  ): string {
    const parts: string[] = [];

    // Add QR source context
    const sourceNames: Record<QRSource, string> = {
      room_qr: 'Hotel Room Service',
      menu_qr: 'Restaurant Menu',
      rez_now: 'Store Discovery',
      ads_qr: 'Campaign',
    };
    parts.push(`Context: ${sourceNames[qrSource]}`);

    // Add intent context
    if (currentIntent) {
      parts.push(`Current Action: ${currentIntent}`);
    }

    // Add knowledge summary
    const menuCount = grouped.menu?.length || 0;
    const faqCount = grouped.faq?.length || 0;
    const offerCount = grouped.offer?.length || 0;

    if (menuCount > 0) parts.push(`${menuCount} menu items`);
    if (faqCount > 0) parts.push(`${faqCount} FAQs`);
    if (offerCount > 0) parts.push(`${offerCount} offers`);

    return parts.join(' | ');
  }

  /**
   * Get knowledge for specific QR scenario
   */
  async getKnowledgeForQRScenario(
    merchantId: string,
    qrSource: QRSource,
    scenario: string
  ): Promise<IMerchantKnowledge[]> {
    const scenarios: Record<string, string[]> = {
      // Room QR scenarios
      'room-service': ['menu', 'policy', 'offer'],
      'checkout': ['policy', 'offer', 'contact'],
      'feedback': ['faq', 'policy'],

      // Menu QR scenarios
      'ordering': ['menu'],
      'dietary': ['menu', 'faq'],
      'payment': ['policy', 'contact'],

      // Store QR scenarios
      'discovery': ['menu', 'offer'],
      'booking': ['policy', 'faq', 'contact'],

      // Ad QR scenarios
      'campaign': ['offer', 'contact'],
      'purchase': ['policy', 'faq'],
    };

    const types = scenarios[scenario] || ['menu', 'faq', 'offer'];

    const query: Record<string, unknown> = {
      merchantId,
      active: true,
      type: { $in: types },
      $or: [
        { 'metadata.qrSources': { $exists: false } },
        { 'metadata.qrSources': { $eq: null } },
        { 'metadata.qrSources': qrSource },
      ],
    };

    return MerchantKnowledge.find(query);
  }

  /**
   * Bulk import QR-aware knowledge entries
   */
  async bulkImportQRKnowledge(
    merchantId: string,
    entries: QRKnowledgeEntry[]
  ): Promise<{ imported: number }> {
    const docs = entries.map((entry) => ({
      merchantId,
      type: entry.type,
      title: entry.title,
      content: entry.content,
      tags: entry.tags || [],
      metadata: {
        ...entry.metadata,
        qrSources: entry.qrSources,
        triggerIntents: entry.triggerIntents,
        priorityForIntent: entry.priorityForIntent,
      },
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    const result = await MerchantKnowledge.insertMany(docs, { ordered: false });
    return { imported: result.length };
  }

  /**
   * Update QR knowledge metadata
   */
  async updateQRMetadata(
    entryId: string,
    qrMetadata: {
      qrSources?: QRSource[];
      triggerIntents?: string[];
      priorityForIntent?: Record<string, number>;
    }
  ): Promise<IMerchantKnowledge | null> {
    return MerchantKnowledge.findByIdAndUpdate(
      entryId,
      {
        $set: {
          'metadata.qrSources': qrMetadata.qrSources,
          'metadata.triggerIntents': qrMetadata.triggerIntents,
          'metadata.priorityForIntent': qrMetadata.priorityForIntent,
          updatedAt: new Date(),
        },
      },
      { new: true }
    );
  }
}


export const merchantKnowledgeService = new MerchantKnowledgeService();

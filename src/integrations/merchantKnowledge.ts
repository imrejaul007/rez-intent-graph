// ── Merchant Knowledge Base ─────────────────────────────────────────────────────────
// Phase 7: Each merchant shares their knowledge base
// ReZ Mind collects and indexes merchant knowledge for autonomous chat
// MongoDB implementation

import { MerchantKnowledge } from '../models/index.js';
import { sharedMemory } from '../agents/shared-memory.js';

export type KnowledgeType =
  | 'menu'
  | 'policy'
  | 'faq'
  | 'offer'
  | 'hours'
  | 'contact'
  | 'custom';

export interface MerchantKnowledgeEntry {
  id: string;
  merchantId: string;
  type: KnowledgeType;
  title: string;
  content: string;
  tags: string[];
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  active: boolean;
}

export interface MerchantKnowledgeBase {
  merchantId: string;
  merchantName: string;
  category: string;
  entries: MerchantKnowledgeEntry[];
  indexedAt?: Date;
}

export class MerchantKnowledgeService {
  async addEntry(params: {
    merchantId: string;
    type: KnowledgeType;
    title: string;
    content: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<MerchantKnowledgeEntry> {
    const entry = await MerchantKnowledge.create({
      merchantId: params.merchantId,
      type: params.type,
      title: params.title,
      content: params.content,
      tags: params.tags || [],
      metadata: params.metadata,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await this.invalidateCache(params.merchantId);

    await sharedMemory.publish({
      from: 'intent-graph',
      to: 'merchant-knowledge',
      type: 'notification',
      payload: { merchantId: params.merchantId, entryId: entry._id.toString(), type: params.type },
      timestamp: new Date(),
    });

    return entry.toObject() as MerchantKnowledgeEntry;
  }

  async bulkImport(params: {
    merchantId: string;
    entries: Array<{
      type: KnowledgeType;
      title: string;
      content: string;
      tags?: string[];
    }>;
  }): Promise<{ imported: number; errors: string[] }> {
    let imported = 0;
    const errors: string[] = [];

    for (const entry of params.entries) {
      try {
        await this.addEntry({
          merchantId: params.merchantId,
          type: entry.type,
          title: entry.title,
          content: entry.content,
          tags: entry.tags,
        });
        imported++;
      } catch (error) {
        errors.push(`${entry.title}: ${String(error)}`);
      }
    }

    await this.indexMerchantKnowledge(params.merchantId);

    return { imported, errors };
  }

  async getKnowledgeBase(merchantId: string): Promise<MerchantKnowledgeBase | null> {
    const entries = await MerchantKnowledge.find({ merchantId, active: true })
      .sort({ updatedAt: -1 });

    if (entries.length === 0) return null;

    return {
      merchantId,
      merchantName: merchantId,
      category: 'general',
      entries: entries.map((e) => e.toObject() as MerchantKnowledgeEntry),
      indexedAt: new Date(),
    };
  }

  async searchKnowledge(params: {
    merchantId?: string;
    category?: string;
    query: string;
    limit?: number;
  }): Promise<MerchantKnowledgeEntry[]> {
    const searchQuery: Record<string, unknown> = { active: true };

    if (params.merchantId) searchQuery.merchantId = params.merchantId;
    if (params.category) searchQuery.type = params.category;

    const entries = await MerchantKnowledge.find(searchQuery)
      .sort({ updatedAt: -1 })
      .limit(params.limit || 20);

    // Simple text search
    const query = params.query.toLowerCase();
    const results = entries.filter((entry) => {
      const searchText = `${entry.title} ${entry.content} ${entry.tags.join(' ')}`.toLowerCase();
      return searchText.includes(query);
    });

    return results.map((e) => e.toObject() as MerchantKnowledgeEntry);
  }

  async getChatContext(params: {
    merchantId: string;
    userId?: string;
    query: string;
  }): Promise<{
    merchantKnowledge: MerchantKnowledgeEntry[];
    userContext?: {
      activeIntents: string[];
      recentOrders?: string[];
      preferences?: string[];
    };
    suggestions?: string[];
  }> {
    const knowledge = await this.searchKnowledge({
      merchantId: params.merchantId,
      query: params.query,
      limit: 5,
    });

    let userContext;
    if (params.userId) {
      try {
        const activeIntents = await sharedMemory.get<string[]>(`intents:active:${params.userId}`);
        userContext = {
          activeIntents: activeIntents || [],
        };
      } catch {
        // Ignore
      }
    }

    const suggestions = this.generateSuggestions(knowledge, params.query);

    return {
      merchantKnowledge: knowledge,
      userContext,
      suggestions,
    };
  }

  private generateSuggestions(knowledge: MerchantKnowledgeEntry[], query: string): string[] {
    const suggestions: string[] = [];
    const queryLower = query.toLowerCase();

    const hasMenu = knowledge.some((k) => k.type === 'menu');
    const hasOffers = knowledge.some((k) => k.type === 'offer');
    const hasPolicies = knowledge.some((k) => k.type === 'policy');
    const hasFaqs = knowledge.some((k) => k.type === 'faq');

    if (hasMenu && !queryLower.includes('menu')) {
      suggestions.push('Would you like to see our menu?');
    }
    if (hasOffers && !queryLower.includes('offer')) {
      suggestions.push('Check out our current offers!');
    }
    if (hasPolicies && !queryLower.includes('policy')) {
      suggestions.push('Need to know about our policies?');
    }
    if (hasFaqs && !queryLower.includes('faq')) {
      suggestions.push('Have questions? Check our FAQs.');
    }

    return suggestions.slice(0, 3);
  }

  async indexMerchantKnowledge(merchantId: string): Promise<void> {
    const knowledge = await this.getKnowledgeBase(merchantId);
    if (!knowledge) return;

    await sharedMemory.set(
      `knowledge:${merchantId}`,
      knowledge,
      86400
    );

    await sharedMemory.publish({
      from: 'intent-graph',
      to: 'chat-agent',
      type: 'notification',
      payload: { merchantId, entryCount: knowledge.entries.length },
      timestamp: new Date(),
    });
  }

  async getMerchantsWithKnowledge(): Promise<string[]> {
    const merchants = await MerchantKnowledge.distinct('merchantId', { active: true });
    return merchants;
  }

  async updateEntry(
    entryId: string,
    updates: Partial<{
      title: string;
      content: string;
      tags: string[];
      active: boolean;
    }>
  ): Promise<MerchantKnowledgeEntry | null> {
    const entry = await MerchantKnowledge.findByIdAndUpdate(
      entryId,
      { $set: { ...updates, updatedAt: new Date() } },
      { new: true }
    );

    if (entry) {
      await this.invalidateCache(entry.merchantId);
    }

    return entry ? (entry.toObject() as MerchantKnowledgeEntry) : null;
  }

  async deleteEntry(entryId: string): Promise<boolean> {
    const entry = await MerchantKnowledge.findByIdAndUpdate(
      entryId,
      { $set: { active: false, updatedAt: new Date() } },
      { new: true }
    );

    if (entry) {
      await this.invalidateCache(entry.merchantId);
    }

    return !!entry;
  }

  private async invalidateCache(merchantId: string): Promise<void> {
    await sharedMemory.delete(`knowledge:${merchantId}`);
  }
}

export const merchantKnowledgeService = new MerchantKnowledgeService();

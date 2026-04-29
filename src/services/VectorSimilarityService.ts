/**
 * Vector Similarity Service
 * Provides intent similarity search using embeddings
 * Supports OpenAI embeddings or local model fallback
 */

import { Intent } from '../models/index.js';

const logger = {
  info: (msg: string, meta?: unknown) => console.log(`[VectorSimilarity] ${msg}`, meta || ''),
  warn: (msg: string, meta?: unknown) => console.warn(`[VectorSimilarity] ${msg}`, meta || ''),
  error: (msg: string, meta?: unknown) => console.error(`[VectorSimilarity] ${msg}`, meta || ''),
};

export interface IntentEmbedding {
  id: string;
  userId: string;
  intentKey: string;
  category: string;
  embedding: number[];
  lastUpdated: Date;
}

export interface SimilarityResult {
  id: string;
  intentKey: string;
  category: string;
  userId: string;
  similarity: number;
}

// Simple hash-based embedding fallback
// Creates deterministic embeddings from intent keys
function simpleHashEmbedding(text: string, dimensions: number = 1536): number[] {
  const embedding = new Array(dimensions).fill(0);
  const normalized = text.toLowerCase().trim();

  for (let i = 0; i < normalized.length; i++) {
    const charCode = normalized.charCodeAt(i);
    const index = (charCode * (i + 1) * 17) % dimensions;
    embedding[index] += 1;
  }

  // Normalize
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  return embedding.map(val => val / (magnitude || 1));
}

// Cosine similarity
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

// OpenAI embedding (if available)
async function getOpenAIEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return null;
  }

  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: text,
        model: 'text-embedding-3-small',
      }),
    });

    if (!response.ok) {
      logger.warn('OpenAI embedding failed', { status: response.status });
      return null;
    }

    const data = await response.json();
    return data.data[0].embedding;
  } catch (error) {
    logger.error('OpenAI embedding error', { error });
    return null;
  }
}

class VectorSimilarityService {
  private useOpenAI = false;
  private embeddingDimensions = 1536;

  constructor() {
    this.useOpenAI = !!process.env.OPENAI_API_KEY;
    logger.info(`Vector similarity initialized`, { mode: this.useOpenAI ? 'openai' : 'hash' });
  }

  /**
   * Generate embedding for an intent key
   */
  async generateEmbedding(intentKey: string, category?: string): Promise<number[]> {
    const text = category ? `${intentKey} ${category}` : intentKey;

    if (this.useOpenAI) {
      const embedding = await getOpenAIEmbedding(text);
      if (embedding) {
        return embedding;
      }
    }

    return simpleHashEmbedding(text, this.embeddingDimensions);
  }

  /**
   * Find similar intents for a user
   */
  async findSimilarIntents(
    userId: string,
    targetIntentKey: string,
    category?: string,
    limit: number = 10
  ): Promise<SimilarityResult[]> {
    // Generate embedding for target
    const targetEmbedding = await this.generateEmbedding(targetIntentKey, category);

    // Get user's other intents
    const userIntents = await Intent.find({
      userId,
      intentKey: { $ne: targetIntentKey },
    }).select('intentKey category embedding lastSeenAt').limit(50);

    // Calculate similarities
    const results: SimilarityResult[] = [];

    for (const intent of userIntents) {
      let embedding = (intent as any).embedding;

      if (!embedding) {
        // Generate on-the-fly (less accurate but works)
        embedding = await this.generateEmbedding(intent.intentKey, intent.category);
      }

      const similarity = cosineSimilarity(targetEmbedding, embedding);

      if (similarity > 0.3) { // Threshold
        results.push({
          id: intent._id.toString(),
          intentKey: intent.intentKey,
          category: intent.category,
          userId: intent.userId,
          similarity: Math.round(similarity * 1000) / 1000,
        });
      }
    }

    // Sort by similarity descending
    results.sort((a, b) => b.similarity - a.similarity);

    return results.slice(0, limit);
  }

  /**
   * Find similar intents across all users (for demand signals)
   */
  async findSimilarIntentsGlobal(
    targetIntentKey: string,
    category?: string,
    limit: number = 20
  ): Promise<SimilarityResult[]> {
    const targetEmbedding = await this.generateEmbedding(targetIntentKey, category);

    // Sample recent intents (for performance)
    const recentIntents = await Intent.find({
      lastSeenAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // Last 7 days
    })
      .select('intentKey category userId embedding')
      .limit(1000);

    const results: SimilarityResult[] = [];

    for (const intent of recentIntents) {
      let embedding = (intent as any).embedding;

      if (!embedding) {
        embedding = await this.generateEmbedding(intent.intentKey, intent.category);
      }

      const similarity = cosineSimilarity(targetEmbedding, embedding);

      if (similarity > 0.4) {
        results.push({
          id: intent._id.toString(),
          intentKey: intent.intentKey,
          category: intent.category,
          userId: intent.userId,
          similarity: Math.round(similarity * 0.1) / 1000,
        });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);

    return results.slice(0, limit);
  }

  /**
   * Batch generate embeddings for intents (for initial setup)
   */
  async batchGenerateEmbeddings(limit: number = 1000): Promise<number> {
    const intents = await Intent.find({ embedding: { $exists: false } })
      .select('intentKey category')
      .limit(limit);

    let count = 0;

    for (const intent of intents) {
      const embedding = await this.generateEmbedding(intent.intentKey, intent.category);
      await Intent.updateOne(
        { _id: intent._id },
        { $set: { embedding } }
      );
      count++;

      if (count % 100 === 0) {
        logger.info(`Generated ${count} embeddings`);
      }
    }

    logger.info(`Batch embedding complete`, { count });
    return count;
  }

  /**
   * Get recommendations based on similar users
   */
  async getSimilarUserRecommendations(
    userId: string,
    category?: string,
    limit: number = 10
  ): Promise<string[]> {
    // Find user's top intents by confidence
    const userTopIntents = await Intent.find({
      userId,
      status: 'ACTIVE',
    })
      .sort({ confidence: -1 })
      .limit(5)
      .select('intentKey category');

    if (userTopIntents.length === 0) {
      return [];
    }

    // Get intents with same category from other users
    const categoryFilter = category ? { category } : {};
    const similarIntents = await Intent.find({
      userId: { $ne: userId },
      status: 'ACTIVE',
      confidence: { $gte: 0.5 },
      ...categoryFilter,
    })
      .select('intentKey category userId')
      .limit(100);

    // Score by similarity to user's intents
    const scores: Map<string, { intentKey: string; score: number }> = new Map();

    for (const intent of similarIntents) {
      let maxSimilarity = 0;

      for (const userIntent of userTopIntents) {
        const embedding1 = await this.generateEmbedding(userIntent.intentKey, userIntent.category);
        const embedding2 = await this.generateEmbedding(intent.intentKey, intent.category);
        const similarity = cosineSimilarity(embedding1, embedding2);

        if (similarity > maxSimilarity) {
          maxSimilarity = similarity;
        }
      }

      if (maxSimilarity > 0.3) {
        const existing = scores.get(intent.intentKey);
        if (!existing || existing.score < maxSimilarity) {
          scores.set(intent.intentKey, {
            intentKey: intent.intentKey,
            score: maxSimilarity,
          });
        }
      }
    }

    // Return top scoring intent keys
    return Array.from(scores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.intentKey);
  }
}

export const vectorSimilarityService = new VectorSimilarityService();

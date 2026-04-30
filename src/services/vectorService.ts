// ── Vector Search Service ─────────────────────────────────────────────────────────────
// Semantic similarity search using MongoDB's $vectorSearch
// Stores and queries user intent embeddings for personalized recommendations

import mongoose from 'mongoose';
import { Collection } from 'mongodb';

const VECTOR_INDEX_NAME = 'intent_embeddings_index';
const EMBEDDING_DIMENSION = 384; // Matches MiniLM model output
const METRIC_TYPE = 'cosine'; // cosine similarity for embeddings
const NUM_CANDIDATES = 100; // Number of documents to search

interface IntentEmbedding {
  userId: string;
  appType: string;
  intentKey: string;
  category: string;
  embedding: number[];
  intentQuery?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Create vector search index on the embeddings collection
 * Run this once during deployment/initialization
 */
export async function createVectorIndex(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('MongoDB not connected');
  }

  const collection = db.collection('intent_embeddings');

  try {
    // Check if index exists
    const indexes = await collection.indexes();
    const existingIndex = indexes.find((idx: any) => idx.name === VECTOR_INDEX_NAME);

    if (!existingIndex) {
      await db.command({
        createSearchIndexes: 'intent_embeddings',
        indexes: [{
          name: VECTOR_INDEX_NAME,
          definition: {
            fields: [{
              type: 'vector',
              path: 'embedding',
              similarity: METRIC_TYPE,
              dimension: EMBEDDING_DIMENSION,
              numCandidates: NUM_CANDIDATES,
              M: 16, // No. of nearest neighbors to explore during search
              efConstruction: 64, // Size of dynamic candidate list during construction
            }],
          },
        }],
      });
      console.log(`[VectorSearch] Created index: ${VECTOR_INDEX_NAME}`);
    } else {
      console.log(`[VectorSearch] Index ${VECTOR_INDEX_NAME} already exists`);
    }
  } catch (error: any) {
    if (error.code === 72) {
      console.warn('[VectorSearch] Vector search not available (requires MongoDB 7.0+)');
      console.warn('[VectorSearch] Falling back to keyword-based similarity');
    } else {
      throw error;
    }
  }
}

/**
 * Store an intent embedding
 */
export async function storeEmbedding(embedding: IntentEmbedding): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('MongoDB not connected');
  }

  const collection = db.collection<IntentEmbedding>('intent_embeddings');

  await collection.updateOne(
    {
      userId: embedding.userId,
      appType: embedding.appType,
      intentKey: embedding.intentKey,
    },
    {
      $set: {
        ...embedding,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );
}

/**
 * Find similar intents using vector search
 */
export async function findSimilarIntents(
  embedding: number[],
  userId: string,
  appType: string,
  limit: number = 5
): Promise<IntentEmbedding[]> {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('MongoDB not connected');
  }

  const collection = db.collection<IntentEmbedding>('intent_embeddings');

  try {
    const results = await collection.aggregate([
      {
        $vectorSearch: {
          index: VECTOR_INDEX_NAME,
          path: 'embedding',
          query: {
            userId: { $ne: userId }, // Exclude current user
            appType: appType,
          },
          numCandidates: NUM_CANDIDATES,
          limit: limit,
        },
      },
      {
        $project: {
          _id: 0,
          userId: 1,
          appType: 1,
          intentKey: 1,
          category: 1,
          intentQuery: 1,
          metadata: 1,
          createdAt: 1,
          updatedAt: 1,
          score: { $meta: 'vectorSearchScore' },
        },
      },
    ]).toArray();

    return results as IntentEmbedding[];
  } catch (error: any) {
    if (error.code === 72) {
      // Vector search not available, fall back to keyword matching
      console.warn('[VectorSearch] Falling back to keyword-based search');
      return fallbackKeywordSearch(collection, embedding, userId, appType, limit);
    }
    throw error;
  }
}

/**
 * Fallback keyword-based similarity search
 * Used when vector search is not available (pre-MongoDB 7.0)
 */
async function fallbackKeywordSearch(
  collection: Collection<IntentEmbedding>,
  embedding: number[],
  userId: string,
  appType: string,
  limit: number
): Promise<IntentEmbedding[]> {
  // Extract keywords from intent queries
  const results = await collection.find({
    userId: { $ne: userId },
    appType: appType,
    intentQuery: { $exists: true, $ne: '' },
  })
    .sort({ updatedAt: -1 })
    .limit(limit * 2)
    .toArray();

  // Simple relevance scoring based on category match
  return results.slice(0, limit).map(doc => ({
    ...doc,
    score: 0.5, // Lower score for fallback results
  }));
}

/**
 * Delete embeddings for a user
 */
export async function deleteUserEmbeddings(userId: string): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('MongoDB not connected');
  }

  const collection = db.collection('intent_embeddings');
  await collection.deleteMany({ userId });
}

/**
 * Get embedding statistics
 */
export async function getEmbeddingStats(): Promise<{
  total: number;
  byAppType: Record<string, number>;
  oldestDate: Date | null;
  newestDate: Date | null;
}> {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('MongoDB not connected');
  }

  const collection = db.collection('intent_embeddings');

  const [count, byAppType, oldest, newest] = await Promise.all([
    collection.countDocuments(),
    collection.aggregate([
      { $group: { _id: '$appType', count: { $sum: 1 } } },
    ]).toArray(),
    collection.findOne({}, { sort: { createdAt: 1 }, projection: { createdAt: 1 } }),
    collection.findOne({}, { sort: { createdAt: -1 }, projection: { createdAt: 1 } }),
  ]);

  return {
    total: count,
    byAppType: Object.fromEntries(byAppType.map((r: any) => [r._id, r.count])),
    oldestDate: oldest?.createdAt || null,
    newestDate: newest?.createdAt || null,
  };
}

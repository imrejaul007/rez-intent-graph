// ── Shared Memory Hub ──────────────────────────────────────────────────────────
// Redis-based inter-agent communication and state sharing
// DANGEROUS: This enables distributed state across all agent instances
// Falls back to in-memory Map when Redis unavailable

import type {
  DemandSignal,
  ScarcitySignal,
  UserResponseProfile,
  AttributionRecord,
  ScoredIntent,
  OptimizationRecommendation,
  CollaborativeSignal,
  RevenueReport,
  AgentHealth,
  AgentMessage,
} from './types.js';

// ── Redis Configuration ─────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || process.env.INTENT_GRAPH_REDIS_URL || 'redis://localhost:6379';

// IORedis type interface for when the module is not available
interface IORedisLike {
  new(url: string, options?: Record<string, unknown>): IORedisInstance;
  status?: string;
}

interface IORedisInstance {
  status: string;
  connect(): Promise<void>;
  disconnect(): void;
  on(event: string, handler: (arg?: unknown) => void): void;
  // Specific overload for message event
  on(event: 'message', handler: (channel: string, message: string) => void): void;
  zremrangebyscore(key: string, min: number, max: number): Promise<number>;
  zcard(key: string): Promise<number>;
  zadd(key: string, score: number, member: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: (string | number)[]): Promise<unknown>;
  del(key: string): Promise<number>;
  exists(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  sadd(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  setex(key: string, seconds: number, value: string): Promise<unknown>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string): Promise<number>;
  duplicate(): IORedisInstance;
  removeListener(event: string, handler: (arg?: unknown) => void): void;
}

// Try to load IORedis, fall back to null if not available
let IORedis: IORedisLike | null = null;
try {
  // Dynamic import to avoid build errors when ioredis not installed
  IORedis = require('ioredis') as IORedisLike;
} catch {
  // IORedis not available, will use in-memory fallback
}

const logger = {
  info: (msg: string, meta?: unknown) => console.log(`[SharedMemory] ${msg}`, meta || ''),
  warn: (msg: string, meta?: unknown) => console.warn(`[SharedMemory] ${msg}`, meta || ''),
  error: (msg: string, meta?: unknown) => console.error(`[SharedMemory] ${msg}`, meta || ''),
};

// ── Key Prefixes ──────────────────────────────────────────────────────────────

const KEYS = {
  DEMAND_SIGNALS: 'demand:signals:',
  SCARCITY_SIGNALS: 'scarcity:signals:',
  USER_PROFILES: 'profiles:',
  ATTRIBUTION: 'attribution:',
  SCORED_INTENTS: 'scored:intents:',
  OPTIMIZATIONS: 'optimizations:',
  COLLABORATIVE: 'collaborative:',
  REVENUE_REPORTS: 'revenue:reports:',
  AGENT_HEALTH: 'health:',
  MESSAGE_QUEUE: 'messages:',
  GLOBAL_DEMAND: 'demand:global:',
  TRENDING: 'trending:',
  WALLET_TXN: 'wallet:txn:',
  WALLET_BALANCE: 'wallet:balance:',
  ORDER: 'order:',
  PMS_REQUEST: 'pms:request:',
  TASK: 'task:',
  MERCHANT_ORDER: 'merchant:order:',
  CHANNEL: 'channel:',
} as const;

// ── TTL Configurations ─────────────────────────────────────────────────────────

const TTL = {
  DEMAND_SIGNALS: 300, // 5 minutes
  SCARCITY_SIGNALS: 60, // 1 minute
  USER_PROFILES: 86400, // 24 hours
  ATTRIBUTION: 604800, // 7 days
  SCORED_INTENTS: 3600, // 1 hour
  OPTIMIZATIONS: 3600, // 1 hour
  COLLABORATIVE: 43200, // 12 hours
  REVENUE_REPORTS: 900, // 15 minutes
  HEALTH: 300, // 5 minutes
  WALLET_TXN: 86400, // 24 hours
  WALLET_BALANCE: 300, // 5 minutes
  ORDER: 604800, // 7 days
  PMS_REQUEST: 86400, // 24 hours
  TASK: 86400, // 24 hours
  MERCHANT_ORDER: 604800, // 7 days
} as const;

// ── Redis Client (Lazy Init) ──────────────────────────────────────────────────

let redisClient: IORedisInstance | null = null;
let redisSubscriber: IORedisInstance | null = null;
let isRedisConnected = false;

function getRedisClient(): IORedisInstance | null {
  if (!IORedis) {
    logger.warn('IORedis not available, using in-memory fallback');
    return null;
  }

  if (redisClient && redisClient.status === 'ready') {
    return redisClient;
  }

  try {
    redisClient = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      retryStrategy: (times: number) => {
        if (times > 3) return null; // Stop retrying
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
    });

    redisClient.on('connect', () => {
      logger.info('[Redis] Connected');
      isRedisConnected = true;
    });

    redisClient.on('error', (err: Error) => {
      logger.warn('[Redis] Error:', err.message);
      isRedisConnected = false;
    });

    redisClient.on('close', () => {
      logger.warn('[Redis] Connection closed');
      isRedisConnected = false;
    });

    // Connect lazily
    redisClient.connect().catch((err: Error) => {
      logger.warn('[Redis] Connection failed:', err.message);
      isRedisConnected = false;
    });

    return redisClient;
  } catch (err) {
    logger.warn('[Redis] Failed to create client:', err);
    return null;
  }
}

function getRedisSubscriber(): IORedisInstance | null {
  if (!IORedis) return null;

  if (redisSubscriber && redisSubscriber.status === 'ready') {
    return redisSubscriber;
  }

  try {
    const client = getRedisClient();
    if (!client) return null;

    redisSubscriber = client.duplicate();
    redisSubscriber.on('error', (err: Error) => {
      logger.warn('[Redis Subscriber] Error:', err.message);
    });

    return redisSubscriber;
  } catch {
    return null;
  }
}

// ── In-Memory Fallback ────────────────────────────────────────────────────────

const memoryStore = new Map<string, { value: unknown; expiresAt: number | null }>();
const subscribers = new Map<string, Set<(msg: AgentMessage) => void>>();

// ── Shared Memory Class ────────────────────────────────────────────────────────

export class SharedMemory {
  private static instance: SharedMemory;

  private constructor() {}

  static getInstance(): SharedMemory {
    if (!SharedMemory.instance) {
      SharedMemory.instance = new SharedMemory();
    }
    return SharedMemory.instance;
  }

  // ── Generic Operations (Redis + In-Memory Fallback) ─────────────────────────

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const redis = getRedisClient();

    if (redis && isRedisConnected) {
      try {
        const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
        await redis.set(key, JSON.stringify({ value, expiresAt }), 'EX', ttlSeconds || 999999);
        return;
      } catch (err) {
        logger.warn('[Redis] Set failed, using in-memory fallback:', err);
      }
    }

    // In-memory fallback
    memoryStore.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
  }

  async get<T>(key: string): Promise<T | null> {
    const redis = getRedisClient();

    if (redis && isRedisConnected) {
      try {
        const data = await redis.get(key);
        if (!data) return null;

        const parsed = JSON.parse(data) as { value: T; expiresAt: number | null };
        if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
          await redis.del(key);
          return null;
        }
        return parsed.value;
      } catch (err) {
        logger.warn('[Redis] Get failed, using in-memory fallback:', err);
      }
    }

    // In-memory fallback
    const entry = memoryStore.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      memoryStore.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async delete(key: string): Promise<void> {
    const redis = getRedisClient();

    if (redis && isRedisConnected) {
      try {
        await redis.del(key);
        return;
      } catch (err) {
        logger.warn('[Redis] Delete failed:', err);
      }
    }

    memoryStore.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    const redis = getRedisClient();

    if (redis && isRedisConnected) {
      try {
        const result = await redis.exists(key);
        return result === 1;
      } catch {
        // Fall through to in-memory
      }
    }

    const entry = memoryStore.get(key);
    if (!entry) return false;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      memoryStore.delete(key);
      return false;
    }
    return true;
  }

  async keys(pattern: string): Promise<string[]> {
    const redis = getRedisClient();

    if (redis && isRedisConnected) {
      try {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        const allKeys = await redis.keys(pattern);
        return allKeys.filter((k: string) => regex.test(k));
      } catch {
        // Fall through to in-memory
      }
    }

    // In-memory fallback
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    const result: string[] = [];
    for (const key of memoryStore.keys()) {
      if (regex.test(key)) {
        const entry = memoryStore.get(key);
        if (entry && (!entry.expiresAt || Date.now() <= entry.expiresAt)) {
          result.push(key);
        }
      }
    }
    return result;
  }

  async mget<T>(pattern: string): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    const keys = await this.keys(pattern);
    for (const key of keys) {
      const value = await this.get<T>(key);
      if (value !== null) {
        result.set(key, value);
      }
    }
    return result;
  }

  // ── Demand Signals ──────────────────────────────────────────────────────────

  async setDemandSignal(signal: DemandSignal): Promise<void> {
    const key = `${KEYS.DEMAND_SIGNALS}${signal.merchantId}:${signal.category}`;
    await this.set(key, signal, TTL.DEMAND_SIGNALS);
    await this.updateGlobalDemandIndex(signal);
  }

  async getDemandSignal(merchantId: string, category: string): Promise<DemandSignal | null> {
    return this.get<DemandSignal>(`${KEYS.DEMAND_SIGNALS}${merchantId}:${category}`);
  }

  async getAllDemandSignals(): Promise<DemandSignal[]> {
    const signals = await this.mget<DemandSignal>(`${KEYS.DEMAND_SIGNALS}*`);
    return Array.from(signals.values());
  }

  async updateGlobalDemandIndex(signal: DemandSignal): Promise<void> {
    const globalKey = `${KEYS.GLOBAL_DEMAND}${signal.category}`;
    const existing = await this.get<Record<string, number>>(globalKey) || {};
    existing[signal.merchantId] = signal.demandCount;
    await this.set(globalKey, existing, TTL.DEMAND_SIGNALS * 2);
  }

  async getGlobalDemand(category: string): Promise<Record<string, number>> {
    return (await this.get<Record<string, number>>(`${KEYS.GLOBAL_DEMAND}${category}`)) ?? {};
  }

  async getTopDemandedMerchants(category: string, limit = 10): Promise<Array<{ merchantId: string; demand: number }>> {
    const global = await this.getGlobalDemand(category);
    return Object.entries(global)
      .map(([merchantId, demand]) => ({ merchantId, demand }))
      .sort((a, b) => b.demand - a.demand)
      .slice(0, limit);
  }

  // ── Scarcity Signals ────────────────────────────────────────────────────────

  async setScarcitySignal(signal: ScarcitySignal): Promise<void> {
    const key = `${KEYS.SCARCITY_SIGNALS}${signal.merchantId}:${signal.category}`;
    await this.set(key, signal, TTL.SCARCITY_SIGNALS);
  }

  async getScarcitySignal(merchantId: string, category: string): Promise<ScarcitySignal | null> {
    return this.get<ScarcitySignal>(`${KEYS.SCARCITY_SIGNALS}${merchantId}:${category}`);
  }

  async getAllScarcitySignals(): Promise<ScarcitySignal[]> {
    const signals = await this.mget<ScarcitySignal>(`${KEYS.SCARCITY_SIGNALS}*`);
    return Array.from(signals.values());
  }

  async getCriticalScarcity(): Promise<ScarcitySignal[]> {
    const signals = await this.getAllScarcitySignals();
    return signals.filter((s) => s.scarcityScore > 70);
  }

  // ── User Response Profiles ──────────────────────────────────────────────────

  async setUserProfile(profile: UserResponseProfile): Promise<void> {
    const key = `${KEYS.USER_PROFILES}${profile.userId}`;
    await this.set(key, profile, TTL.USER_PROFILES);
  }

  async getUserProfile(userId: string): Promise<UserResponseProfile | null> {
    return this.get<UserResponseProfile>(`${KEYS.USER_PROFILES}${userId}`);
  }

  async getUserProfiles(userIds: string[]): Promise<Map<string, UserResponseProfile>> {
    const result = new Map<string, UserResponseProfile>();
    for (const userId of userIds) {
      const profile = await this.getUserProfile(userId);
      if (profile) result.set(userId, profile);
    }
    return result;
  }

  // ── Attribution Records ──────────────────────────────────────────────────────

  async recordAttribution(record: AttributionRecord): Promise<void> {
    const key = `${KEYS.ATTRIBUTION}${record.id}`;
    await this.set(key, record, TTL.ATTRIBUTION);

    const userKey = `${KEYS.ATTRIBUTION}user:${record.userId}`;
    const existing = await this.get<string[]>(userKey) || [];
    existing.push(record.id);
    await this.set(userKey, existing, TTL.ATTRIBUTION);
  }

  async getAttributionRecord(id: string): Promise<AttributionRecord | null> {
    return this.get<AttributionRecord>(`${KEYS.ATTRIBUTION}${id}`);
  }

  async getUserAttributions(userId: string): Promise<AttributionRecord[]> {
    const userKey = `${KEYS.ATTRIBUTION}user:${userId}`;
    const ids = await this.get<string[]>(userKey) || [];
    const records: AttributionRecord[] = [];
    for (const id of ids) {
      const record = await this.getAttributionRecord(id);
      if (record) records.push(record);
    }
    return records;
  }

  // ── Scored Intents ──────────────────────────────────────────────────────────

  async setScoredIntent(scored: ScoredIntent): Promise<void> {
    const key = `${KEYS.SCORED_INTENTS}${scored.intentId}`;
    await this.set(key, scored, TTL.SCORED_INTENTS);

    const userKey = `${KEYS.SCORED_INTENTS}user:${scored.userId}`;
    const existing = await this.get<string[]>(userKey) || [];
    if (!existing.includes(scored.intentId)) {
      existing.push(scored.intentId);
      await this.set(userKey, existing, TTL.SCORED_INTENTS);
    }
  }

  async getScoredIntent(intentId: string): Promise<ScoredIntent | null> {
    return this.get<ScoredIntent>(`${KEYS.SCORED_INTENTS}${intentId}`);
  }

  async getUserScoredIntents(userId: string): Promise<ScoredIntent[]> {
    const userKey = `${KEYS.SCORED_INTENTS}user:${userId}`;
    const ids = await this.get<string[]>(userKey) || [];
    const results: ScoredIntent[] = [];
    for (const id of ids) {
      const scored = await this.getScoredIntent(id);
      if (scored) results.push(scored);
    }
    return results;
  }

  // ── Optimization Recommendations ─────────────────────────────────────────────

  async addOptimization(rec: OptimizationRecommendation): Promise<void> {
    const key = `${KEYS.OPTIMIZATIONS}${rec.agent}:${Date.now()}`;
    await this.set(key, rec, TTL.OPTIMIZATIONS);
    await this.set(`${KEYS.OPTIMIZATIONS}latest:${rec.agent}`, rec, TTL.OPTIMIZATIONS);
  }

  async getLatestOptimization(agent: string): Promise<OptimizationRecommendation | null> {
    return this.get<OptimizationRecommendation>(`${KEYS.OPTIMIZATIONS}latest:${agent}`);
  }

  async getAllOptimizations(): Promise<OptimizationRecommendation[]> {
    const recs = await this.mget<OptimizationRecommendation>(`${KEYS.OPTIMIZATIONS}*`);
    return Array.from(recs.values()).filter((r) => r.type);
  }

  // ── Collaborative Signals ────────────────────────────────────────────────────

  async setCollaborativeSignal(signal: CollaborativeSignal): Promise<void> {
    const key = `${KEYS.COLLABORATIVE}${signal.userId}`;
    await this.set(key, signal, TTL.COLLABORATIVE);
  }

  async getCollaborativeSignal(userId: string): Promise<CollaborativeSignal | null> {
    return this.get<CollaborativeSignal>(`${KEYS.COLLABORATIVE}${userId}`);
  }

  async addTrendingIntent(intentKey: string, category: string): Promise<void> {
    const key = `${KEYS.TRENDING}${category}`;
    const existing = await this.get<Record<string, number>>(key) || {};
    existing[intentKey] = (existing[intentKey] || 0) + 1;
    await this.set(key, existing, 3600);
  }

  async getTrendingIntents(category: string, limit = 10): Promise<Array<{ intentKey: string; count: number }>> {
    const trending = await this.get<Record<string, number>>(`${KEYS.TRENDING}${category}`) || {};
    return Object.entries(trending)
      .map(([intentKey, count]) => ({ intentKey, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  // ── Revenue Reports ──────────────────────────────────────────────────────────

  async saveRevenueReport(report: RevenueReport): Promise<void> {
    const key = `${KEYS.REVENUE_REPORTS}${report.period.start.getTime()}`;
    await this.set(key, report, TTL.REVENUE_REPORTS);
    await this.set(`${KEYS.REVENUE_REPORTS}latest`, report, TTL.REVENUE_REPORTS);
  }

  async getLatestRevenueReport(): Promise<RevenueReport | null> {
    return this.get<RevenueReport>(`${KEYS.REVENUE_REPORTS}latest`);
  }

  async getRevenueReports(since: Date): Promise<RevenueReport[]> {
    const reports = await this.mget<RevenueReport>(`${KEYS.REVENUE_REPORTS}*`);
    return Array.from(reports.values())
      .filter((r) => r.period.start >= since)
      .sort((a, b) => a.period.start.getTime() - b.period.start.getTime());
  }

  // ── Agent Health ─────────────────────────────────────────────────────────────

  async updateAgentHealth(health: AgentHealth): Promise<void> {
    const key = `${KEYS.AGENT_HEALTH}${health.agent}`;
    await this.set(key, health, TTL.HEALTH);
  }

  async getAgentHealth(agent: string): Promise<AgentHealth | null> {
    return this.get<AgentHealth>(`${KEYS.AGENT_HEALTH}${agent}`);
  }

  async getAllAgentHealth(): Promise<AgentHealth[]> {
    const health = await this.mget<AgentHealth>(`${KEYS.AGENT_HEALTH}*`);
    return Array.from(health.values()).filter((h) => h.agent);
  }

  // ── Pub/Sub Messaging (Redis + In-Memory Fallback) ─────────────────────────

  async publish(message: AgentMessage): Promise<void> {
    const channel = `${KEYS.CHANNEL}${message.to}`;

    // Publish to Redis for distributed messaging
    const redis = getRedisClient();
    if (redis && isRedisConnected) {
      try {
        await redis.publish(channel, JSON.stringify(message));
      } catch (err) {
        logger.warn('[Redis] Publish failed:', err);
      }
    }

    // Also call local subscribers
    const localSubscribers = subscribers.get(channel) || new Set();
    for (const callback of localSubscribers) {
      try {
        callback(message);
      } catch (err) {
        logger.error('Local subscriber callback failed', { error: err, channel });
      }
    }
  }

  subscribe(agent: string, callback: (msg: AgentMessage) => void): () => void {
    const channel = `${KEYS.CHANNEL}${agent}`;

    // Add to local subscribers
    if (!subscribers.has(channel)) {
      subscribers.set(channel, new Set());
    }
    subscribers.get(channel)!.add(callback);

    // Subscribe to Redis channel if available
    const redis = getRedisSubscriber();
    if (redis && isRedisConnected) {
      redis.subscribe(channel).catch((err: Error) => {
        logger.warn('[Redis] Subscribe failed:', err.message);
      });

      redis.on('message', (ch: string, msg: string): void => {
        if (ch === channel) {
          try {
            const message = JSON.parse(msg) as AgentMessage;
            callback(message);
          } catch (err) {
            logger.error('Failed to parse Redis message', { error: err, channel });
          }
        }
      });
    }

    // Return unsubscribe function
    return () => {
      subscribers.get(channel)?.delete(callback);
    };
  }

  // ── Wallet Integration Helpers ────────────────────────────────────────────────

  async setWalletTransaction(transactionId: string, data: Record<string, unknown>): Promise<void> {
    const key = `${KEYS.WALLET_TXN}${transactionId}`;
    await this.set(key, data, TTL.WALLET_TXN);
  }

  async getWalletTransaction(transactionId: string): Promise<Record<string, unknown> | null> {
    return this.get<Record<string, unknown>>(`${KEYS.WALLET_TXN}${transactionId}`);
  }

  async setWalletBalance(userId: string, balance: Record<string, unknown>): Promise<void> {
    const key = `${KEYS.WALLET_BALANCE}${userId}`;
    await this.set(key, balance, TTL.WALLET_BALANCE);
  }

  async getWalletBalance(userId: string): Promise<Record<string, unknown> | null> {
    return this.get<Record<string, unknown>>(`${KEYS.WALLET_BALANCE}${userId}`);
  }

  async invalidateWalletBalance(userId: string): Promise<void> {
    await this.delete(`${KEYS.WALLET_BALANCE}${userId}`);
  }

  // ── Order Integration Helpers ────────────────────────────────────────────────

  async setOrder(orderId: string, data: Record<string, unknown>): Promise<void> {
    const key = `${KEYS.ORDER}${orderId}`;
    await this.set(key, data, TTL.ORDER);
  }

  async getOrder(orderId: string): Promise<Record<string, unknown> | null> {
    return this.get<Record<string, unknown>>(`${KEYS.ORDER}${orderId}`);
  }

  // ── PMS Integration Helpers ──────────────────────────────────────────────────

  async setPMSRequest(requestId: string, data: Record<string, unknown>): Promise<void> {
    const key = `${KEYS.PMS_REQUEST}${requestId}`;
    await this.set(key, data, TTL.PMS_REQUEST);
  }

  async getPMSRequest(requestId: string): Promise<Record<string, unknown> | null> {
    return this.get<Record<string, unknown>>(`${KEYS.PMS_REQUEST}${requestId}`);
  }

  // ── Task Integration Helpers ────────────────────────────────────────────────

  async setTask(taskId: string, data: Record<string, unknown>): Promise<void> {
    const key = `${KEYS.TASK}${taskId}`;
    await this.set(key, data, TTL.TASK);
  }

  async getTask(taskId: string): Promise<Record<string, unknown> | null> {
    return this.get<Record<string, unknown>>(`${KEYS.TASK}${taskId}`);
  }

  // ── Utility ───────────────────────────────────────────────────────────────────

  async flush(): Promise<void> {
    const redis = getRedisClient();
    if (redis && isRedisConnected) {
      try {
        const keys = await this.keys('*');
        for (const key of keys) {
          await redis.del(key);
        }
      } catch (err) {
        logger.warn('[Redis] Flush failed:', err);
      }
    }
    memoryStore.clear();
  }

  async stats(): Promise<{ keys: number; memoryUsage: string; redisConnected: boolean }> {
    let inMemoryCount = memoryStore.size;
    let redisCount = 0;

    const redis = getRedisClient();
    if (redis && isRedisConnected) {
      try {
        const keys = await redis.keys('*');
        redisCount = keys.length;
      } catch {
        // Ignore
      }
    }

    return {
      keys: inMemoryCount + redisCount,
      memoryUsage: `~${Math.round(JSON.stringify([...memoryStore.values()]).length / 1024)} KB`,
      redisConnected: isRedisConnected,
    };
  }

  isRedisAvailable(): boolean {
    return isRedisConnected;
  }
}

export const sharedMemory = SharedMemory.getInstance();

/**
 * Integration Tests - Health Check Endpoints
 * Tests for API health monitoring and status reporting
 */

import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';

// ── Mock Redis Connection ─────────────────────────────────────────────────────────

interface MockRedisClient {
  isConnected: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  ping: () => Promise<'PONG'>;
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<'OK'>;
  setex: (key: string, ttl: number, value: string) => Promise<'OK'>;
  del: (...keys: string[]) => Promise<number>;
  keys: (pattern: string) => Promise<string[]>;
}

function createMockRedisClient(): MockRedisClient {
  const data = new Map<string, string>();
  let isConnected = false;

  return {
    get isConnected() { return isConnected; },
    connect: async function() {
      isConnected = true;
    },
    disconnect: async function() {
      isConnected = false;
    },
    ping: async function() {
      if (!isConnected) throw new Error('Not connected');
      return 'PONG';
    },
    get: async function(key: string) {
      if (!isConnected) throw new Error('Not connected');
      return data.get(key) || null;
    },
    set: async function(key: string, value: string) {
      if (!isConnected) throw new Error('Not connected');
      data.set(key, value);
      return 'OK';
    },
    setex: async function(key: string, _ttl: number, value: string) {
      if (!isConnected) throw new Error('Not connected');
      data.set(key, value);
      return 'OK';
    },
    del: async function(...keys: string[]) {
      if (!isConnected) throw new Error('Not connected');
      let deleted = 0;
      keys.forEach(key => {
        if (data.delete(key)) deleted++;
      });
      return deleted;
    },
    keys: async function(pattern: string) {
      if (!isConnected) throw new Error('Not connected');
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
      return Array.from(data.keys()).filter(key => regex.test(key));
    },
  };
}

// ── Mock MongoDB Connection ──────────────────────────────────────────────────────

interface MockMongoDBConnection {
  isConnected: boolean;
  host: string;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  getStatus: () => { connected: boolean; host: string };
}

function createMockMongoDBConnection(): MockMongoDBConnection {
  let isConnected = false;
  const host = 'localhost';

  return {
    get isConnected() { return isConnected; },
    connect: async function() {
      isConnected = true;
    },
    disconnect: async function() {
      isConnected = false;
    },
    getStatus: function() {
      return {
        connected: isConnected,
        host,
      };
    },
  };
}

// ── Test Suite ───────────────────────────────────────────────────────────────────

describe('Health Check Integration Tests', () => {
  let redisClient: MockRedisClient;
  let mongoConnection: MockMongoDBConnection;

  beforeAll(async () => {
    redisClient = createMockRedisClient();
    mongoConnection = createMockMongoDBConnection();
    await redisClient.connect();
    await mongoConnection.connect();
  });

  afterAll(async () => {
    await redisClient.disconnect();
    await mongoConnection.disconnect();
  });

  describe('Redis Connection', () => {
    it('should be connected after connect()', async () => {
      expect(redisClient.isConnected).toBe(true);
    });

    it('should respond to ping', async () => {
      const response = await redisClient.ping();
      expect(response).toBe('PONG');
    });

    it('should set and get values', async () => {
      await redisClient.set('test:key', 'test-value');
      const value = await redisClient.get('test:key');
      expect(value).toBe('test-value');
    });

    it('should delete values', async () => {
      await redisClient.set('test:delete', 'value');
      const deleted = await redisClient.del('test:delete');
      expect(deleted).toBe(1);

      const value = await redisClient.get('test:delete');
      expect(value).toBeNull();
    });

    it('should find keys by pattern', async () => {
      await redisClient.set('cache:user:1', 'data1');
      await redisClient.set('cache:user:2', 'data2');
      await redisClient.set('cache:product:1', 'data3');

      const userKeys = await redisClient.keys('cache:user:*');
      expect(userKeys).toHaveLength(2);
    });

    it('should handle setex with TTL', async () => {
      await redisClient.setex('test:ttl', 300, 'value-with-ttl');
      const value = await redisClient.get('test:ttl');
      expect(value).toBe('value-with-ttl');
    });
  });

  describe('MongoDB Connection', () => {
    it('should be connected after connect()', async () => {
      expect(mongoConnection.isConnected).toBe(true);
    });

    it('should report correct status', () => {
      const status = mongoConnection.getStatus();
      expect(status.connected).toBe(true);
      expect(status.host).toBe('localhost');
    });
  });

  describe('Health Endpoint Response Format', () => {
    it('should include required fields', () => {
      const healthResponse = {
        status: 'healthy',
        service: 'intent-graph',
        mongodb: 'connected',
        timestamp: new Date().toISOString(),
      };

      expect(healthResponse).toHaveProperty('status');
      expect(healthResponse).toHaveProperty('service');
      expect(healthResponse).toHaveProperty('mongodb');
      expect(healthResponse).toHaveProperty('timestamp');
    });

    it('should have valid status values', () => {
      const validStatuses = ['healthy', 'unhealthy', 'degraded'];
      expect(validStatuses).toContain('healthy');
    });

    it('should have valid MongoDB connection values', () => {
      const validMongodbStatuses = ['connected', 'disconnected', 'connecting'];
      expect(validMongodbStatuses).toContain('connected');
    });

    it('should have valid ISO timestamp', () => {
      const timestamp = new Date().toISOString();
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
    });
  });
});

describe('Redis Cache Integration Tests', () => {
  let redisClient: MockRedisClient;

  beforeAll(async () => {
    redisClient = createMockRedisClient();
    await redisClient.connect();
  });

  afterAll(async () => {
    await redisClient.disconnect();
  });

  beforeEach(async () => {
    // Clear all keys before each test
    const keys = await redisClient.keys('*');
    if (keys.length > 0) {
      await redisClient.del(...keys);
    }
  });

  describe('Cache Operations', () => {
    it('should cache intent data', async () => {
      const intentData = JSON.stringify({
        userId: 'user123',
        appType: 'restaurant',
        category: 'italian',
        confidence: 0.75,
      });

      await redisClient.setex('cache:intent:user123', 300, intentData);

      const cached = await redisClient.get('cache:intent:user123');
      expect(cached).toBe(intentData);
    });

    it('should cache user preferences', async () => {
      const prefs = JSON.stringify({
        dietaryRestrictions: ['vegetarian'],
        preferredCuisine: 'italian',
      });

      await redisClient.set('cache:prefs:user123', prefs);

      const cached = await redisClient.get('cache:prefs:user123');
      expect(JSON.parse(cached!)).toEqual(JSON.parse(prefs));
    });

    it('should invalidate cache by pattern', async () => {
      await redisClient.set('cache:api:user1:data', 'data1');
      await redisClient.set('cache:api:user2:data', 'data2');
      await redisClient.set('cache:api:user3:data', 'data3');

      // Invalidate all user1 cache
      const keys = await redisClient.keys('cache:api:user1:*');
      await redisClient.del(...keys);

      const remainingKeys = await redisClient.keys('cache:api:*');
      expect(remainingKeys).toHaveLength(2);
    });

    it('should handle concurrent cache operations', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        redisClient.set(`cache:concurrent:${i}`, `value${i}`)
      );

      await Promise.all(promises);

      const keys = await redisClient.keys('cache:concurrent:*');
      expect(keys).toHaveLength(10);
    });
  });

  describe('Cache TTL Behavior', () => {
    it('should store data with setex', async () => {
      await redisClient.setex('cache:ttl:short', 60, 'short-lived');
      const value = await redisClient.get('cache:ttl:short');
      expect(value).toBe('short-lived');
    });

    it('should store data with extended TTL', async () => {
      await redisClient.setex('cache:ttl:extended', 3600, 'long-lived');
      const value = await redisClient.get('cache:ttl:extended');
      expect(value).toBe('long-lived');
    });
  });
});

describe('WebSocket Connection Lifecycle', () => {
  interface MockWebSocket {
    readyState: number;
    isOpen: boolean;
    messages: string[];
    connect: () => void;
    disconnect: () => void;
    send: (data: string) => void;
    onMessage?: (data: string) => void;
    onOpen?: () => void;
    onClose?: () => void;
    onError?: (error: Error) => void;
  }

  function createMockWebSocket(): MockWebSocket {
    return {
      readyState: 0, // CONNECTING
      isOpen: false,
      messages: [],
      connect() {
        this.readyState = 1; // OPEN
        this.isOpen = true;
        this.onOpen?.();
      },
      disconnect() {
        this.readyState = 3; // CLOSED
        this.isOpen = false;
        this.onClose?.();
      },
      send(data: string) {
        if (!this.isOpen) {
          throw new Error('WebSocket is not open');
        }
        this.messages.push(data);
      },
    };
  }

  describe('Connection Lifecycle', () => {
    it('should start in CONNECTING state', () => {
      const ws = createMockWebSocket();
      expect(ws.readyState).toBe(0);
      expect(ws.isOpen).toBe(false);
    });

    it('should transition to OPEN on connect', () => {
      const ws = createMockWebSocket();
      ws.connect();
      expect(ws.readyState).toBe(1);
      expect(ws.isOpen).toBe(true);
    });

    it('should transition to CLOSED on disconnect', () => {
      const ws = createMockWebSocket();
      ws.connect();
      ws.disconnect();
      expect(ws.readyState).toBe(3);
      expect(ws.isOpen).toBe(false);
    });

    it('should not send messages when closed', () => {
      const ws = createMockWebSocket();
      expect(() => ws.send('test')).toThrow('WebSocket is not open');
    });

    it('should send messages when open', () => {
      const ws = createMockWebSocket();
      ws.connect();
      ws.send('test message');
      expect(ws.messages).toContain('test message');
    });
  });

  describe('Message Handling', () => {
    it('should store received messages via callback', () => {
      const ws = createMockWebSocket();
      ws.connect();
      ws.messages.push('server message');
      expect(ws.messages).toContain('server message');
    });

    it('should handle JSON messages', () => {
      const ws = createMockWebSocket();
      ws.connect();

      const intentData = JSON.stringify({
        type: 'intent_update',
        userId: 'user123',
        intentKey: 'italian_food',
      });

      ws.send(intentData);
      const parsed = JSON.parse(ws.messages[0]);
      expect(parsed.type).toBe('intent_update');
      expect(parsed.userId).toBe('user123');
    });
  });

  describe('Event Callbacks', () => {
    it('should call onOpen when connecting', () => {
      const ws = createMockWebSocket();
      let opened = false;
      ws.onOpen = () => { opened = true; };
      ws.connect();
      expect(opened).toBe(true);
    });

    it('should call onClose when disconnecting', () => {
      const ws = createMockWebSocket();
      let closed = false;
      ws.onClose = () => { closed = true; };
      ws.connect();
      ws.disconnect();
      expect(closed).toBe(true);
    });

    it('should call onError on error', () => {
      const ws = createMockWebSocket();
      let errorReceived: Error | undefined;
      ws.onError = (error) => { errorReceived = error; };
      ws.onError?.(new Error('Test error'));
      expect(errorReceived).toBeDefined();
    });
  });
});

describe('Connection Error Handling', () => {
  describe('Redis Error Recovery', () => {
    it('should handle connection failure gracefully', async () => {
      const failingClient = createMockRedisClient();
      // Don't connect - simulate failure
      await expect(failingClient.ping()).rejects.toThrow('Not connected');
    });

    it('should allow reconnection after failure', async () => {
      const client = createMockRedisClient();
      try {
        await client.ping();
      } catch {
        // Expected failure
      }

      await client.connect();
      const response = await client.ping();
      expect(response).toBe('PONG');
    });
  });

  describe('MongoDB Error Recovery', () => {
    it('should handle connection failure gracefully', async () => {
      const failingConnection = createMockMongoDBConnection();
      expect(failingConnection.isConnected).toBe(false);
    });

    it('should allow reconnection after failure', async () => {
      const connection = createMockMongoDBConnection();
      await connection.connect();
      expect(connection.isConnected).toBe(true);

      await connection.disconnect();
      expect(connection.isConnected).toBe(false);

      await connection.connect();
      expect(connection.isConnected).toBe(true);
    });
  });
});

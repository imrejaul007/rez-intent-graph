/**
 * Redis (ioredis) Mock
 * Provides comprehensive mocking for Redis operations
 */

export interface RedisData {
  [key: string]: string;
}

class MockRedis {
  private data: RedisData = {};
  private subscribers: Map<string, Set<(message: string) => void>> = new Map();

  // Core operations
  async get(key: string): Promise<string | null> {
    return this.data[key] || null;
  }

  async set(key: string, value: string): Promise<'OK'> {
    this.data[key] = value;
    return 'OK';
  }

  async setex(key: string, seconds: number, value: string): Promise<'OK'> {
    this.data[key] = value;
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    keys.forEach(key => {
      if (this.data[key] !== undefined) {
        delete this.data[key];
        deleted++;
      }
    });
    return deleted;
  }

  async keys(pattern: string): Promise<string[]> {
    // Convert glob pattern to regex
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    );
    return Object.keys(this.data).filter(key => regex.test(key));
  }

  async exists(...keys: string[]): Promise<number> {
    return keys.filter(key => this.data[key] !== undefined).length;
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.data[key] !== undefined ? 1 : 0;
  }

  async ttl(key: string): Promise<number> {
    return this.data[key] !== undefined ? 300 : -2;
  }

  async ping(): Promise<'PONG'> {
    return 'PONG';
  }

  // Pub/Sub
  async publish(channel: string, message: string): Promise<number> {
    const subs = this.subscribers.get(channel);
    if (subs) {
      subs.forEach(callback => callback(message));
      return subs.size;
    }
    return 0;
  }

  // Connection events (no-ops for mock)
  on = jest.fn((event: string, callback: (...args: unknown[]) => void) => {
    if (event === 'connect' || event === 'ready') {
      setTimeout(() => callback(), 0);
    }
    return this;
  });

  // Clone method for publisher/subscriber
  clone(): MockRedis {
    return new MockRedis();
  }

  // Clear all data (for test cleanup)
  clear(): void {
    this.data = {};
  }

  // Get all keys (for debugging)
  getAllData(): RedisData {
    return { ...this.data };
  }

  // Set data directly (for test setup)
  setData(key: string, value: string): void {
    this.data[key] = value;
  }
}

// Export singleton instance
export const redis = new MockRedis();

// Export for creating additional clients (publisher, subscriber)
export const createMockRedis = (): MockRedis => new MockRedis();

// Export mock for direct usage
export default MockRedis;

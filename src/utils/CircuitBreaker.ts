/**
 * Circuit Breaker Utility
 * Prevents cascade failures when intent graph is slow or down
 * Consumer apps will gracefully degrade to non-personalized results
 */

export interface CircuitBreakerConfig {
  name: string;
  timeout: number; // ms before opening circuit
  resetTimeout: number; // ms before attempting half-open
  maxFailures: number; // failures before opening
  volumeThreshold: number; // min requests before checking
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerStats {
  name: string;
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure: number | null;
  lastSuccess: number | null;
  averageLatency: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  name: 'default',
  timeout: 5000, // 5 seconds
  resetTimeout: 30000, // 30 seconds
  maxFailures: 5,
  volumeThreshold: 10,
};

class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private successes = 0;
  private lastFailure: number | null = null;
  private lastSuccess: number | null = null;
  private totalLatency = 0;
  private requestCount = 0;
  private nextAttempt: number = 0;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(
    fn: () => Promise<T>,
    fallback: () => T
  ): Promise<T> {
    // Check state
    if (this.state === 'OPEN') {
      if (Date.now() >= this.nextAttempt) {
        this.state = 'HALF_OPEN';
        console.log(`[CircuitBreaker:${this.config.name}] HALF_OPEN - attempting recovery`);
      } else {
        console.log(`[CircuitBreaker:${this.config.name}] OPEN - using fallback`);
        return fallback();
      }
    }

    const startTime = Date.now();

    try {
      const result = await this.executeWithTimeout(fn);
      this.recordSuccess(Date.now() - startTime);
      return result;
    } catch (error) {
      this.recordFailure();
      console.error(`[CircuitBreaker:${this.config.name}] Request failed:`, error);
      return fallback();
    }
  }

  /**
   * Execute with timeout
   */
  private async executeWithTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Circuit breaker timeout after ${this.config.timeout}ms`));
      }, this.config.timeout);

      fn()
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * Record successful request
   */
  private recordSuccess(latency: number): void {
    this.successes++;
    this.lastSuccess = Date.now();
    this.requestCount++;
    this.totalLatency += latency;

    if (this.state === 'HALF_OPEN') {
      console.log(`[CircuitBreaker:${this.config.name}] HALF_OPEN → CLOSED - recovery successful`);
      this.state = 'CLOSED';
      this.failures = 0;
    }
  }

  /**
   * Record failed request
   */
  private recordFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();
    this.requestCount++;

    if (this.state === 'HALF_OPEN') {
      console.log(`[CircuitBreaker:${this.config.name}] HALF_OPEN → OPEN - recovery failed`);
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.config.resetTimeout;
    } else if (
      this.requestCount >= this.config.volumeThreshold &&
      this.failures >= this.config.maxFailures
    ) {
      console.log(`[CircuitBreaker:${this.config.name}] CLOSED → OPEN - too many failures`);
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.config.resetTimeout;
    }
  }

  /**
   * Get circuit breaker stats
   */
  getStats(): CircuitBreakerStats {
    return {
      name: this.config.name,
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailure: this.lastFailure,
      lastSuccess: this.lastSuccess,
      averageLatency: this.requestCount > 0 ? this.totalLatency / this.requestCount : 0,
    };
  }

  /**
   * Force circuit to a specific state (for testing/admin)
   */
  forceState(state: CircuitState): void {
    console.log(`[CircuitBreaker:${this.config.name}] Forced to ${state}`);
    this.state = state;
    if (state === 'CLOSED') {
      this.failures = 0;
    }
  }

  /**
   * Reset circuit breaker
   */
  reset(): void {
    this.state = 'CLOSED';
    this.failures = 0;
    this.successes = 0;
    this.requestCount = 0;
    this.totalLatency = 0;
    this.lastFailure = null;
    this.lastSuccess = null;
    console.log(`[CircuitBreaker:${this.config.name}] Reset`);
  }
}

// Singleton instances for common services
export const intentGraphCircuit = new CircuitBreaker({
  name: 'intent-graph',
  timeout: 5000,
  resetTimeout: 30000,
  maxFailures: 5,
});

export const recommendationCircuit = new CircuitBreaker({
  name: 'recommendation',
  timeout: 3000,
  resetTimeout: 60000,
  maxFailures: 3,
});

export default CircuitBreaker;

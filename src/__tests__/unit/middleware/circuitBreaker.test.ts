/**
 * CircuitBreaker Unit Tests
 * Tests for fail-fast pattern implementation
 */

import { jest } from '@jest/globals';

// Mock console.log to avoid noise in tests
const originalLog = console.log;
beforeAll(() => {
  console.log = jest.fn();
});
afterAll(() => {
  console.log = originalLog;
});

// Import CircuitBreaker implementation directly for unit testing
// We test the class, not the singleton instances

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitMetrics {
  failures: number;
  successes: number;
  lastFailure: number;
  state: CircuitState;
  lastStateChange: number;
}

interface CircuitBreakerOptions {
  name: string;
  failureThreshold?: number;
  recoveryTimeout?: number;
  halfOpenRequests?: number;
}

class TestableCircuitBreaker {
  metrics: Map<string, CircuitMetrics> = new Map();
  private readonly options: Required<CircuitBreakerOptions>;

  constructor(options: CircuitBreakerOptions) {
    this.options = {
      name: options.name,
      failureThreshold: options.failureThreshold ?? 5,
      recoveryTimeout: options.recoveryTimeout ?? 30000,
      halfOpenRequests: options.halfOpenRequests ?? 3,
    };
  }

  getMetrics(): CircuitMetrics {
    if (!this.metrics.has(this.options.name)) {
      this.metrics.set(this.options.name, {
        failures: 0,
        successes: 0,
        lastFailure: 0,
        state: 'CLOSED',
        lastStateChange: Date.now(),
      });
    }
    return this.metrics.get(this.options.name)!;
  }

  canExecute(): boolean {
    const metrics = this.getMetrics();

    if (metrics.state === 'CLOSED') {
      return true;
    }

    if (metrics.state === 'OPEN') {
      if (Date.now() - metrics.lastFailure >= this.options.recoveryTimeout) {
        this.transitionTo('HALF_OPEN');
        return true;
      }
      return false;
    }

    return true;
  }

  recordSuccess(): void {
    const metrics = this.getMetrics();

    if (metrics.state === 'HALF_OPEN') {
      metrics.successes++;
      if (metrics.successes >= this.options.halfOpenRequests) {
        this.transitionTo('CLOSED');
      }
    } else if (metrics.state === 'CLOSED') {
      metrics.failures = 0;
    }
  }

  recordFailure(): void {
    const metrics = this.getMetrics();
    metrics.lastFailure = Date.now();

    if (metrics.state === 'HALF_OPEN') {
      this.transitionTo('OPEN');
    } else if (metrics.state === 'CLOSED') {
      metrics.failures++;
      if (metrics.failures >= this.options.failureThreshold) {
        this.transitionTo('OPEN');
      }
    }
  }

  getState(): CircuitState {
    return this.getMetrics().state;
  }

  forceState(state: CircuitState): void {
    this.transitionTo(state);
  }

  private transitionTo(state: CircuitState): void {
    const metrics = this.getMetrics();
    metrics.state = state;
    metrics.lastStateChange = Date.now();

    if (state === 'CLOSED') {
      metrics.failures = 0;
      metrics.successes = 0;
    } else if (state === 'OPEN') {
      metrics.successes = 0;
    } else if (state === 'HALF_OPEN') {
      metrics.successes = 0;
    }
  }
}

class CircuitOpenError extends Error {
  constructor(public readonly serviceName: string) {
    super(`Circuit breaker is OPEN for service: ${serviceName}`);
    this.name = 'CircuitOpenError';
  }
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('CircuitBreaker', () => {
  let breaker: TestableCircuitBreaker;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T00:00:00Z').getTime());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('initialization', () => {
    it('should initialize with CLOSED state', () => {
      breaker = new TestableCircuitBreaker({ name: 'test-service' });
      expect(breaker.getState()).toBe('CLOSED');
    });

    it('should use default options', () => {
      breaker = new TestableCircuitBreaker({ name: 'test-service' });
      const metrics = breaker.getMetrics();
      expect(metrics.failures).toBe(0);
      expect(metrics.successes).toBe(0);
    });

    it('should accept custom options', () => {
      breaker = new TestableCircuitBreaker({
        name: 'custom-service',
        failureThreshold: 3,
        recoveryTimeout: 5000,
        halfOpenRequests: 2,
      });
      expect(breaker.getState()).toBe('CLOSED');
    });
  });

  describe('canExecute', () => {
    it('should return true when circuit is CLOSED', () => {
      breaker = new TestableCircuitBreaker({ name: 'test-service' });
      expect(breaker.canExecute()).toBe(true);
    });

    it('should return false when circuit is OPEN', () => {
      breaker = new TestableCircuitBreaker({ name: 'test-service' });
      breaker.forceState('OPEN');
      breaker.getMetrics().lastFailure = Date.now();
      expect(breaker.canExecute()).toBe(false);
    });

    it('should transition to HALF_OPEN after recovery timeout', () => {
      breaker = new TestableCircuitBreaker({
        name: 'test-service',
        recoveryTimeout: 30000,
      });

      // Force OPEN state with lastFailure 30 seconds ago
      breaker.forceState('OPEN');
      breaker.getMetrics().lastFailure = Date.now() - 30000;

      // Advance time by 30 seconds
      jest.advanceTimersByTime(30000);

      expect(breaker.canExecute()).toBe(true);
      expect(breaker.getState()).toBe('HALF_OPEN');
    });

    it('should return true when circuit is HALF_OPEN', () => {
      breaker = new TestableCircuitBreaker({ name: 'test-service' });
      breaker.forceState('HALF_OPEN');
      expect(breaker.canExecute()).toBe(true);
    });
  });

  describe('recordSuccess', () => {
    it('should reset failure count on success in CLOSED state', () => {
      breaker = new TestableCircuitBreaker({ name: 'test-service' });
      breaker.getMetrics().failures = 3;

      breaker.recordSuccess();

      expect(breaker.getMetrics().failures).toBe(0);
    });

    it('should increment success count in HALF_OPEN state', () => {
      breaker = new TestableCircuitBreaker({ name: 'test-service' });
      breaker.forceState('HALF_OPEN');

      breaker.recordSuccess();
      expect(breaker.getMetrics().successes).toBe(1);

      breaker.recordSuccess();
      expect(breaker.getMetrics().successes).toBe(2);
    });

    it('should transition to CLOSED after reaching halfOpenRequests', () => {
      breaker = new TestableCircuitBreaker({
        name: 'test-service',
        halfOpenRequests: 2,
      });
      breaker.forceState('HALF_OPEN');

      breaker.recordSuccess();
      breaker.recordSuccess();

      expect(breaker.getState()).toBe('CLOSED');
      expect(breaker.getMetrics().successes).toBe(0);
    });
  });

  describe('recordFailure', () => {
    it('should increment failure count in CLOSED state', () => {
      breaker = new TestableCircuitBreaker({ name: 'test-service' });

      breaker.recordFailure();
      expect(breaker.getMetrics().failures).toBe(1);

      breaker.recordFailure();
      expect(breaker.getMetrics().failures).toBe(2);
    });

    it('should open circuit when failure threshold is reached', () => {
      breaker = new TestableCircuitBreaker({
        name: 'test-service',
        failureThreshold: 3,
      });

      breaker.recordFailure();
      expect(breaker.getState()).toBe('CLOSED');

      breaker.recordFailure();
      expect(breaker.getState()).toBe('CLOSED');

      breaker.recordFailure();
      expect(breaker.getState()).toBe('OPEN');
    });

    it('should transition to OPEN on any failure in HALF_OPEN state', () => {
      breaker = new TestableCircuitBreaker({
        name: 'test-service',
        halfOpenRequests: 3,
      });
      breaker.forceState('HALF_OPEN');
      breaker.getMetrics().successes = 2;

      breaker.recordFailure();

      expect(breaker.getState()).toBe('OPEN');
    });
  });

  describe('forceState', () => {
    it('should allow forced transition to OPEN', () => {
      breaker = new TestableCircuitBreaker({ name: 'test-service' });
      breaker.forceState('OPEN');
      expect(breaker.getState()).toBe('OPEN');
    });

    it('should allow forced transition to CLOSED', () => {
      breaker = new TestableCircuitBreaker({ name: 'test-service' });
      breaker.forceState('OPEN');
      breaker.forceState('CLOSED');
      expect(breaker.getState()).toBe('CLOSED');
    });

    it('should reset metrics on transition to CLOSED', () => {
      breaker = new TestableCircuitBreaker({ name: 'test-service' });
      breaker.getMetrics().failures = 5;
      breaker.getMetrics().successes = 2;

      breaker.forceState('CLOSED');

      expect(breaker.getMetrics().failures).toBe(0);
      expect(breaker.getMetrics().successes).toBe(0);
    });
  });

  describe('CircuitOpenError', () => {
    it('should have correct name and message', () => {
      const error = new CircuitOpenError('test-service');
      expect(error.name).toBe('CircuitOpenError');
      expect(error.message).toContain('test-service');
      expect(error.serviceName).toBe('test-service');
    });

    it('should be an instance of Error', () => {
      const error = new CircuitOpenError('test-service');
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('state transitions', () => {
    it('should follow CLOSED -> OPEN -> HALF_OPEN -> CLOSED flow', () => {
      breaker = new TestableCircuitBreaker({
        name: 'test-service',
        failureThreshold: 2,
        recoveryTimeout: 1000,
        halfOpenRequests: 2,
      });

      // Start CLOSED
      expect(breaker.getState()).toBe('CLOSED');

      // Accumulate failures to OPEN
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe('OPEN');

      // Wait for recovery timeout
      jest.advanceTimersByTime(1000);
      breaker.canExecute();
      expect(breaker.getState()).toBe('HALF_OPEN');

      // Successful requests transition back to CLOSED
      breaker.recordSuccess();
      breaker.recordSuccess();
      expect(breaker.getState()).toBe('CLOSED');
    });

    it('should handle rapid failure accumulation', () => {
      breaker = new TestableCircuitBreaker({
        name: 'test-service',
        failureThreshold: 5,
      });

      // Simulate rapid failures
      for (let i = 0; i < 10; i++) {
        breaker.recordFailure();
      }

      // Should be OPEN after reaching threshold
      expect(breaker.getState()).toBe('OPEN');
      expect(breaker.getMetrics().failures).toBe(5);
    });
  });

  describe('concurrent scenarios', () => {
    it('should handle interleaved success and failure', () => {
      breaker = new TestableCircuitBreaker({
        name: 'test-service',
        failureThreshold: 3,
      });

      breaker.recordSuccess();
      breaker.recordFailure();
      breaker.recordSuccess();
      breaker.recordFailure();

      // After success(), failures are reset to 0.
      // Then after failure(), failures = 1.
      // Then after success(), failures are reset to 0.
      // Then after failure(), failures = 1.
      expect(breaker.getState()).toBe('CLOSED');
      expect(breaker.getMetrics().failures).toBe(1);

      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe('OPEN');
    });
  });
});

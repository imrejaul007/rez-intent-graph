// ── Circuit Breaker ──────────────────────────────────────────────────────────────
// Fail-fast pattern: when upstream services fail repeatedly, circuit opens
// Prevents cascading failures across the ecosystem

import { Request, Response } from 'express';

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerOptions {
  name: string;
  failureThreshold?: number; // Number of failures before opening
  recoveryTimeout?: number; // ms to wait before trying again
  halfOpenRequests?: number; // Max requests in half-open state
}

interface CircuitMetrics {
  failures: number;
  successes: number;
  lastFailure: number;
  state: CircuitState;
  lastStateChange: number;
}

class CircuitBreaker {
  private metrics: Map<string, CircuitMetrics> = new Map();
  private readonly options: Required<CircuitBreakerOptions>;

  constructor(options: CircuitBreakerOptions) {
    this.options = {
      name: options.name,
      failureThreshold: options.failureThreshold ?? 5,
      recoveryTimeout: options.recoveryTimeout ?? 30000, // 30 seconds
      halfOpenRequests: options.halfOpenRequests ?? 3,
    };
  }

  private getMetrics(): CircuitMetrics {
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

  /**
   * Check if circuit allows request
   */
  canExecute(): boolean {
    const metrics = this.getMetrics();

    if (metrics.state === 'CLOSED') {
      return true;
    }

    if (metrics.state === 'OPEN') {
      // Check if recovery timeout has passed
      if (Date.now() - metrics.lastFailure >= this.options.recoveryTimeout) {
        this.transitionTo('HALF_OPEN');
        return true;
      }
      return false;
    }

    // HALF_OPEN: allow limited requests
    return true;
  }

  /**
   * Record a successful request
   */
  recordSuccess(): void {
    const metrics = this.getMetrics();

    if (metrics.state === 'HALF_OPEN') {
      metrics.successes++;
      if (metrics.successes >= this.options.halfOpenRequests) {
        this.transitionTo('CLOSED');
      }
    } else if (metrics.state === 'CLOSED') {
      // Reset failure count on success
      metrics.failures = 0;
    }
  }

  /**
   * Record a failed request
   */
  recordFailure(): void {
    const metrics = this.getMetrics();
    metrics.lastFailure = Date.now();

    if (metrics.state === 'HALF_OPEN') {
      // Any failure in half-open goes back to open
      this.transitionTo('OPEN');
    } else if (metrics.state === 'CLOSED') {
      metrics.failures++;
      if (metrics.failures >= this.options.failureThreshold) {
        this.transitionTo('OPEN');
      }
    }
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.getMetrics().state;
  }

  /**
   * Force transition to a state (for testing/admin)
   */
  forceState(state: CircuitState): void {
    this.transitionTo(state);
  }

  private transitionTo(state: CircuitState): void {
    const metrics = this.getMetrics();
    console.log(`[CircuitBreaker:${this.options.name}] ${metrics.state} -> ${state}`);
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

// Singleton instances for different services
const circuits: Map<string, CircuitBreaker> = new Map();

export function getCircuit(name: string, options?: Omit<CircuitBreakerOptions, 'name'>): CircuitBreaker {
  if (!circuits.has(name)) {
    circuits.set(name, new CircuitBreaker({ name, ...options }));
  }
  return circuits.get(name)!;
}

/**
 * Circuit breaker middleware for HTTP calls
 */
export function withCircuitBreaker(serviceName: string, options?: Omit<CircuitBreakerOptions, 'name'>) {
  const breaker = getCircuit(serviceName, options);

  return async <T>(
    fn: () => Promise<T>,
    fallback?: () => T
  ): Promise<T> => {
    if (!breaker.canExecute()) {
      if (fallback) {
        console.warn(`[CircuitBreaker:${serviceName}] Circuit OPEN, using fallback`);
        return fallback();
      }
      throw new CircuitOpenError(serviceName);
    }

    try {
      const result = await fn();
      breaker.recordSuccess();
      return result;
    } catch (error) {
      breaker.recordFailure();
      throw error;
    }
  };
}

export class CircuitOpenError extends Error {
  constructor(public readonly serviceName: string) {
    super(`Circuit breaker is OPEN for service: ${serviceName}`);
    this.name = 'CircuitOpenError';
  }
}

/**
 * Express middleware to expose circuit breaker status
 */
export function circuitBreakerStatus(req: Request, res: Response) {
  const status = Array.from(circuits.entries()).map(([name, breaker]) => ({
    name,
    state: breaker.getState(),
  }));
  res.json({ circuits: status });
}

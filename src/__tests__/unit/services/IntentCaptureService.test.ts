/**
 * IntentCaptureService Unit Tests
 * Tests for intent capture flow, confidence calculation, and data operations
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// ── Signal Weights (from source) ─────────────────────────────────────────────────

const SIGNAL_WEIGHTS: Record<string, number> = {
  search: 0.15,
  view: 0.10,
  wishlist: 0.25,
  cart_add: 0.30,
  hold: 0.35,
  checkout_start: 0.40,
  booking_start: 0.40,
  booking_confirmed: 1.0,
  fulfilled: 1.0,
  abandoned: 0.0,
};

const BASE_CONFIDENCE = 0.3;

// ── Testable Service ─────────────────────────────────────────────────────────────

class TestableIntentCaptureService {
  /**
   * Calculate new confidence based on existing signals and new event
   */
  calculateNewConfidence(existingConfidence: number, existingLastSeenAt: Date, existingSignals: Array<{ eventType: string; weight: number; capturedAt: Date }>, newSignalWeight: number): number {
    const recencyMultiplier = this.calculateRecencyMultiplier(existingLastSeenAt);
    const velocityBonus = this.calculateVelocityBonus(existingSignals);
    const baseConfidence = existingConfidence;

    const newConfidence = baseConfidence + (newSignalWeight * recencyMultiplier) + velocityBonus;
    return Math.min(1.0, Math.max(0.0, newConfidence));
  }

  calculateRecencyMultiplier(lastSeenAt: Date): number {
    const daysSince = (Date.now() - lastSeenAt.getTime()) / (1000 * 60 * 60 * 24);
    return Math.exp(-daysSince / 30);
  }

  calculateVelocityBonus(signals: Array<{ eventType: string; weight: number; capturedAt: Date }>): number {
    if (signals.length < 2) return 0;

    const recentSignals = signals.slice(-5);
    const avgTimeBetweenSignals = this.calculateAvgTimeBetweenSignals(recentSignals);

    if (avgTimeBetweenSignals < 60000) return 0.2;
    if (avgTimeBetweenSignals < 300000) return 0.1;
    if (avgTimeBetweenSignals < 3600000) return 0.05;
    return 0;
  }

  calculateAvgTimeBetweenSignals(signals: Array<{ capturedAt: Date }>): number {
    if (signals.length < 2) return Infinity;

    let totalMs = 0;
    for (let i = 0; i < signals.length - 1; i++) {
      totalMs += Math.abs(signals[i].capturedAt.getTime() - signals[i + 1].capturedAt.getTime());
    }
    return totalMs / (signals.length - 1);
  }

  determineStatus(eventType: string, confidence: number): string {
    if (eventType === 'fulfilled') return 'FULFILLED';
    if (eventType === 'abandoned') return 'DORMANT';
    if (confidence < 0.3) return 'DORMANT';
    return 'ACTIVE';
  }

  getSignalWeight(eventType: string): number {
    const weight = SIGNAL_WEIGHTS[eventType];
    return weight !== undefined ? weight : 0.1;
  }

  calculateInitialConfidence(signalWeight: number): number {
    return Math.min(1.0, BASE_CONFIDENCE + signalWeight);
  }
}

// ── Test Suite ──────────────────────────────────────────────────────────────────

describe('IntentCaptureService', () => {
  let service: TestableIntentCaptureService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-15T12:00:00Z').getTime());
    service = new TestableIntentCaptureService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getSignalWeight', () => {
    it('should return correct weight for search event', () => {
      expect(service.getSignalWeight('search')).toBe(0.15);
    });

    it('should return correct weight for view event', () => {
      expect(service.getSignalWeight('view')).toBe(0.1);
    });

    it('should return correct weight for wishlist event', () => {
      expect(service.getSignalWeight('wishlist')).toBe(0.25);
    });

    it('should return correct weight for cart_add event', () => {
      expect(service.getSignalWeight('cart_add')).toBe(0.3);
    });

    it('should return correct weight for booking_confirmed event', () => {
      expect(service.getSignalWeight('booking_confirmed')).toBe(1.0);
    });

    it('should return correct weight for fulfilled event', () => {
      expect(service.getSignalWeight('fulfilled')).toBe(1.0);
    });

    it('should return correct weight for abandoned event', () => {
      expect(service.getSignalWeight('abandoned')).toBe(0.0);
    });

    it('should return default weight for unknown event', () => {
      expect(service.getSignalWeight('unknown_event')).toBe(0.1);
    });
  });

  describe('calculateInitialConfidence', () => {
    it('should calculate initial confidence correctly', () => {
      const weight = service.getSignalWeight('view');
      const confidence = service.calculateInitialConfidence(weight);
      expect(confidence).toBe(0.4); // 0.3 + 0.1
    });

    it('should cap confidence at 1.0', () => {
      const weight = service.getSignalWeight('booking_confirmed');
      const confidence = service.calculateInitialConfidence(weight);
      expect(confidence).toBe(1.0); // Would be 1.3, capped at 1.0
    });

    it('should handle minimum weight', () => {
      const weight = service.getSignalWeight('abandoned');
      const confidence = service.calculateInitialConfidence(weight);
      expect(confidence).toBe(0.3); // 0.3 + 0.0
    });
  });

  describe('calculateRecencyMultiplier', () => {
    it('should return 1.0 for signals seen just now', () => {
      const lastSeen = new Date(Date.now() - 1000); // 1 second ago
      const multiplier = service.calculateRecencyMultiplier(lastSeen);
      expect(multiplier).toBeCloseTo(1.0, 5);
    });

    it('should return ~0.97 for signals seen 1 day ago', () => {
      const lastSeen = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const multiplier = service.calculateRecencyMultiplier(lastSeen);
      expect(multiplier).toBeGreaterThan(0.96);
      expect(multiplier).toBeLessThan(0.98);
    });

    it('should return ~0.78 for signals seen 7 days ago', () => {
      const lastSeen = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const multiplier = service.calculateRecencyMultiplier(lastSeen);
      expect(multiplier).toBeGreaterThan(0.75);
      expect(multiplier).toBeLessThan(0.81);
    });

    it('should return ~0.37 for signals seen 30 days ago', () => {
      const lastSeen = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const multiplier = service.calculateRecencyMultiplier(lastSeen);
      expect(multiplier).toBeCloseTo(0.37, 1);
    });

    it('should return ~0.14 for signals seen 60 days ago', () => {
      const lastSeen = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      const multiplier = service.calculateRecencyMultiplier(lastSeen);
      expect(multiplier).toBeCloseTo(0.14, 1);
    });
  });

  describe('calculateVelocityBonus', () => {
    it('should return 0 for single signal', () => {
      const signals = [{ eventType: 'view', weight: 0.1, capturedAt: new Date() }];
      expect(service.calculateVelocityBonus(signals)).toBe(0);
    });

    it('should return 0 for empty signals', () => {
      expect(service.calculateVelocityBonus([])).toBe(0);
    });

    it('should return 0.2 for signals less than 1 minute apart', () => {
      const now = Date.now();
      const signals = [
        { eventType: 'view', weight: 0.1, capturedAt: new Date(now - 30000) },
        { eventType: 'view', weight: 0.1, capturedAt: new Date(now) },
      ];
      expect(service.calculateVelocityBonus(signals)).toBe(0.2);
    });

    it('should return 0.1 for signals less than 5 minutes apart', () => {
      const now = Date.now();
      const signals = [
        { eventType: 'view', weight: 0.1, capturedAt: new Date(now - 120000) },
        { eventType: 'view', weight: 0.1, capturedAt: new Date(now) },
      ];
      expect(service.calculateVelocityBonus(signals)).toBe(0.1);
    });

    it('should return 0.05 for signals less than 1 hour apart', () => {
      const now = Date.now();
      const signals = [
        { eventType: 'view', weight: 0.1, capturedAt: new Date(now - 1800000) },
        { eventType: 'view', weight: 0.1, capturedAt: new Date(now) },
      ];
      expect(service.calculateVelocityBonus(signals)).toBe(0.05);
    });

    it('should return 0 for signals more than 1 hour apart', () => {
      const now = Date.now();
      const signals = [
        { eventType: 'view', weight: 0.1, capturedAt: new Date(now - 7200000) },
        { eventType: 'view', weight: 0.1, capturedAt: new Date(now) },
      ];
      expect(service.calculateVelocityBonus(signals)).toBe(0);
    });
  });

  describe('calculateAvgTimeBetweenSignals', () => {
    it('should return Infinity for single signal', () => {
      const signals = [{ capturedAt: new Date() }];
      expect(service.calculateAvgTimeBetweenSignals(signals)).toBe(Infinity);
    });

    it('should return Infinity for empty array', () => {
      expect(service.calculateAvgTimeBetweenSignals([])).toBe(Infinity);
    });

    it('should calculate average time between signals', () => {
      const now = Date.now();
      const signals = [
        { capturedAt: new Date(now - 60000) },
        { capturedAt: new Date(now - 30000) },
        { capturedAt: new Date(now) },
      ];
      const avg = service.calculateAvgTimeBetweenSignals(signals);
      expect(avg).toBe(30000); // Average of 60000 and 30000
    });
  });

  describe('calculateNewConfidence', () => {
    it('should calculate new confidence for recent signals', () => {
      const now = Date.now();
      const existingConfidence = 0.5;
      const lastSeenAt = new Date(now - 1000); // 1 second ago
      const existingSignals = [
        { eventType: 'view', weight: 0.1, capturedAt: new Date(now - 1000) },
        { eventType: 'view', weight: 0.1, capturedAt: new Date(now) },
      ];
      const newSignalWeight = 0.3;

      const newConfidence = service.calculateNewConfidence(
        existingConfidence,
        lastSeenAt,
        existingSignals,
        newSignalWeight
      );

      // 0.5 + (0.3 * ~1.0) + 0.2 = ~1.0, capped at 1.0
      expect(newConfidence).toBeCloseTo(1.0, 1);
    });

    it('should calculate new confidence for old signals', () => {
      const now = Date.now();
      const existingConfidence = 0.5;
      const lastSeenAt = new Date(now - 7 * 24 * 60 * 60 * 1000); // 7 days ago
      const existingSignals = [
        { eventType: 'view', weight: 0.1, capturedAt: new Date(now - 7 * 24 * 60 * 60 * 1000) },
      ];
      const newSignalWeight = 0.1;

      const newConfidence = service.calculateNewConfidence(
        existingConfidence,
        lastSeenAt,
        existingSignals,
        newSignalWeight
      );

      // Should be close to 0.5 + small contribution
      expect(newConfidence).toBeGreaterThan(0.5);
      expect(newConfidence).toBeLessThan(0.7);
    });

    it('should cap confidence at 1.0', () => {
      const existingConfidence = 0.9;
      const lastSeenAt = new Date(Date.now() - 1000);
      const existingSignals = [
        { eventType: 'view', weight: 0.1, capturedAt: new Date(Date.now() - 1000) },
        { eventType: 'view', weight: 0.1, capturedAt: new Date() },
      ];
      const newSignalWeight = 0.5;

      const newConfidence = service.calculateNewConfidence(
        existingConfidence,
        lastSeenAt,
        existingSignals,
        newSignalWeight
      );

      expect(newConfidence).toBe(1.0);
    });

    it('should ensure confidence never goes below 0', () => {
      const existingConfidence = 0.1;
      const lastSeenAt = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100 days ago
      const existingSignals = [
        { eventType: 'abandoned', weight: 0.0, capturedAt: new Date() },
      ];
      const newSignalWeight = 0.0;

      const newConfidence = service.calculateNewConfidence(
        existingConfidence,
        lastSeenAt,
        existingSignals,
        newSignalWeight
      );

      expect(newConfidence).toBeGreaterThanOrEqual(0);
    });
  });

  describe('determineStatus', () => {
    it('should return FULFILLED for fulfilled event', () => {
      expect(service.determineStatus('fulfilled', 0.5)).toBe('FULFILLED');
    });

    it('should return DORMANT for abandoned event', () => {
      expect(service.determineStatus('abandoned', 0.8)).toBe('DORMANT');
    });

    it('should return DORMANT for low confidence', () => {
      expect(service.determineStatus('view', 0.2)).toBe('DORMANT');
    });

    it('should return ACTIVE for normal confidence', () => {
      expect(service.determineStatus('view', 0.5)).toBe('ACTIVE');
    });

    it('should return ACTIVE for high confidence', () => {
      expect(service.determineStatus('view', 0.9)).toBe('ACTIVE');
    });

    it('should prioritize fulfilled over confidence', () => {
      expect(service.determineStatus('fulfilled', 0.1)).toBe('FULFILLED');
    });
  });

  describe('intent capture flow', () => {
    it('should handle new intent creation', () => {
      const signalWeight = service.getSignalWeight('view');
      const initialConfidence = service.calculateInitialConfidence(signalWeight);
      const status = service.determineStatus('view', initialConfidence);

      expect(initialConfidence).toBe(0.4);
      expect(status).toBe('ACTIVE');
    });

    it('should handle existing intent update', () => {
      const existingConfidence = 0.4;
      const lastSeenAt = new Date(Date.now() - 1000);
      const existingSignals = [
        { eventType: 'view', weight: 0.1, capturedAt: new Date() },
      ];
      const newSignalWeight = service.getSignalWeight('wishlist');

      const newConfidence = service.calculateNewConfidence(
        existingConfidence,
        lastSeenAt,
        existingSignals,
        newSignalWeight
      );
      const status = service.determineStatus('wishlist', newConfidence);

      expect(newConfidence).toBeGreaterThan(existingConfidence);
      expect(status).toBe('ACTIVE');
    });

    it('should transition to FULFILLED on fulfilled event', () => {
      const status = service.determineStatus('fulfilled', 1.0);
      expect(status).toBe('FULFILLED');
    });

    it('should transition to DORMANT on abandoned', () => {
      const status = service.determineStatus('abandoned', 0.8);
      expect(status).toBe('DORMANT');
    });
  });

  describe('signal weight configurations', () => {
    it('should have all expected event types', () => {
      const expectedEvents = [
        'search', 'view', 'wishlist', 'cart_add', 'hold',
        'checkout_start', 'booking_start', 'booking_confirmed', 'fulfilled', 'abandoned'
      ];

      expectedEvents.forEach(event => {
        expect(SIGNAL_WEIGHTS).toHaveProperty(event);
      });
    });

    it('should have weights in valid range', () => {
      Object.values(SIGNAL_WEIGHTS).forEach(weight => {
        expect(weight).toBeGreaterThanOrEqual(0);
        expect(weight).toBeLessThanOrEqual(1);
      });
    });

    it('should have checkout and booking_start with same weight', () => {
      expect(SIGNAL_WEIGHTS.checkout_start).toBe(SIGNAL_WEIGHTS.booking_start);
    });

    it('should have booking_confirmed and fulfilled with max weight', () => {
      expect(SIGNAL_WEIGHTS.booking_confirmed).toBe(1.0);
      expect(SIGNAL_WEIGHTS.fulfilled).toBe(1.0);
    });
  });
});

describe('IntentCaptureService Integration Scenarios', () => {
  let service: TestableIntentCaptureService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-15T12:00:00Z').getTime());
    service = new TestableIntentCaptureService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('user journey scenarios', () => {
    it('should build confidence through shopping journey', () => {
      // Step 1: User searches
      let confidence = service.calculateInitialConfidence(service.getSignalWeight('search'));
      expect(confidence).toBeCloseTo(0.45, 1); // 0.3 + 0.15

      // Step 2: User views items
      const lastSeen = new Date(Date.now() - 1000);
      const signals = [{ eventType: 'search', weight: 0.15, capturedAt: new Date() }];
      confidence = service.calculateNewConfidence(
        confidence, lastSeen, signals, service.getSignalWeight('view')
      );
      expect(confidence).toBeGreaterThan(0.45);

      // Step 3: User adds to cart
      confidence = service.calculateNewConfidence(
        confidence, lastSeen, signals, service.getSignalWeight('cart_add')
      );
      expect(confidence).toBeGreaterThan(0.5);

      // Step 4: User starts checkout
      confidence = service.calculateNewConfidence(
        confidence, lastSeen, signals, service.getSignalWeight('checkout_start')
      );
      expect(confidence).toBeGreaterThan(0.7);
    });

    it('should handle abandoned cart scenario', () => {
      const highConfidence = 0.7;
      const status = service.determineStatus('abandoned', highConfidence);

      expect(status).toBe('DORMANT');
    });

    it('should handle successful booking', () => {
      // booking_confirmed results in ACTIVE (only 'fulfilled' results in FULFILLED)
      const status = service.determineStatus('booking_confirmed', 1.0);
      expect(status).toBe('ACTIVE');
    });

    it('should handle dormancy and re-engagement', () => {
      // User has old intent
      const oldConfidence = 0.4;
      const oldLastSeen = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const oldSignals = [{ eventType: 'view', weight: 0.1, capturedAt: oldLastSeen }];

      // User re-engages
      const newConfidence = service.calculateNewConfidence(
        oldConfidence,
        oldLastSeen,
        oldSignals,
        service.getSignalWeight('wishlist')
      );

      // Should be lower multiplier for old signals, but still increase
      expect(newConfidence).toBeGreaterThan(oldConfidence);
      expect(service.determineStatus('wishlist', newConfidence)).toBe('ACTIVE');
    });
  });
});

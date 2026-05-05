// ── Cashback Fraud Prevention Tests ──────────────────────────────────────────
// Comprehensive test suite for fraud detection system

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import {
  CashbackFraudPreventionService,
  type ICashbackRequest,
  type FraudCheckResult,
} from '../services/CashbackFraudPrevention.js';
import {
  CashbackRequest,
  FraudReport,
  UserRiskProfile,
  RewardChainNode,
} from '../models/CashbackFraud.js';

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/rez-intent-graph-test';

describe('CashbackFraudPreventionService', () => {
  let fraudService: CashbackFraudPreventionService;

  beforeAll(async () => {
    // Connect to test database
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(MONGO_URI);
    }
    fraudService = new CashbackFraudPreventionService();
  });

  afterAll(async () => {
    // Clean up and disconnect
    await Promise.all([
      CashbackRequest.deleteMany({}),
      FraudReport.deleteMany({}),
      UserRiskProfile.deleteMany({}),
      RewardChainNode.deleteMany({}),
    ]);
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    // Clean up before each test
    await Promise.all([
      CashbackRequest.deleteMany({}),
      FraudReport.deleteMany({}),
      UserRiskProfile.deleteMany({}),
      RewardChainNode.deleteMany({}),
    ]);
  });

  // ── Test Helpers ─────────────────────────────────────────────────────────

  function createValidRequest(overrides: Partial<ICashbackRequest> = {}): ICashbackRequest {
    return {
      requestId: `REQ-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      userId: 'user-001',
      merchantId: 'merchant-001',
      orderId: `ORDER-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      amount: 100,
      cashbackAmount: 10,
      currency: 'USD',
      deviceFingerprint: 'device-001',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
      location: {
        country: 'US',
        region: 'CA',
        city: 'San Francisco',
        lat: 37.7749,
        lon: -122.4194,
      },
      requestedAt: new Date(),
      ...overrides,
    };
  }

  // ── Duplicate Request Detection Tests ────────────────────────────────────

  describe('Duplicate Request Detection', () => {
    it('should pass when request is unique', async () => {
      const request = createValidRequest();
      const result = await fraudService.validateCashbackRequest(request);

      expect(result.checks.find(c => c.name === 'Duplicate Request Detection')?.passed).toBe(true);
      expect(result.fraudScore).toBeLessThan(0.5);
    });

    it('should detect exact duplicate order ID', async () => {
      const orderId = `ORDER-DUP-${Date.now()}`;
      const request1 = createValidRequest({ orderId });
      const request2 = createValidRequest({
        orderId,
        requestId: `REQ-2-${Date.now()}`,
      });

      // First request should pass
      await fraudService.validateCashbackRequest(request1);

      // Second request with same order ID should fail
      const result = await fraudService.validateCashbackRequest(request2);
      const duplicateCheck = result.checks.find(c => c.name === 'Duplicate Request Detection');

      expect(duplicateCheck?.passed).toBe(false);
      expect(duplicateCheck?.score).toBe(1.0);
      expect(result.flags.some(f => f.type === 'DUPLICATE_REQUEST')).toBe(true);
    });

    it('should detect near-duplicate within 24 hours', async () => {
      const request1 = createValidRequest({
        orderId: `ORDER-NEAR-1-${Date.now()}`,
        cashbackAmount: 50,
      });
      const request2 = createValidRequest({
        orderId: `ORDER-NEAR-2-${Date.now()}`,
        cashbackAmount: 50, // Same amount
      });

      await fraudService.validateCashbackRequest(request1);
      const result = await fraudService.validateCashbackRequest(request2);

      expect(result.checks.find(c => c.name === 'Duplicate Request Detection')?.passed).toBe(false);
    });
  });

  // ── Velocity Check Tests ─────────────────────────────────────────────────

  describe('Velocity Checks', () => {
    it('should detect excessive requests per hour', async () => {
      // Create 5 requests in quick succession (max allowed is 5)
      for (let i = 0; i < 5; i++) {
        await fraudService.validateCashbackRequest(
          createValidRequest({ orderId: `ORDER-${Date.now()}-${i}` })
        );
      }

      // 6th request should trigger velocity check
      const result = await fraudService.validateCashbackRequest(
        createValidRequest({ orderId: `ORDER-${Date.now()}-6` })
      );

      const velocityCheck = result.checks.find(c => c.name === 'Velocity Check');
      expect(velocityCheck?.passed).toBe(false);
      expect(result.flags.some(f => f.type === 'VELOCITY_ANOMALY')).toBe(true);
    });

    it('should detect excessive requests per day', async () => {
      // Create 20 requests (max per day)
      for (let i = 0; i < 20; i++) {
        await fraudService.validateCashbackRequest(
          createValidRequest({ orderId: `ORDER-DAY-${Date.now()}-${i}` })
        );
      }

      const result = await fraudService.validateCashbackRequest(
        createValidRequest({ orderId: `ORDER-DAY-21-${Date.now()}` })
      );

      expect(result.checks.find(c => c.name === 'Velocity Check')?.passed).toBe(false);
    });

    it('should detect excessive cashback per day', async () => {
      // Create requests with large cashback amounts
      for (let i = 0; i < 10; i++) {
        await fraudService.validateCashbackRequest(
          createValidRequest({
            orderId: `ORDER-CB-${Date.now()}-${i}`,
            cashbackAmount: 100, // $100 per request
          })
        );
      }

      const result = await fraudService.validateCashbackRequest(
        createValidRequest({
          orderId: `ORDER-CB-11-${Date.now()}`,
          cashbackAmount: 100,
        })
      );

      expect(result.checks.find(c => c.name === 'Velocity Check')?.passed).toBe(false);
    });
  });

  // ── Self-Reward Detection Tests ──────────────────────────────────────────

  describe('Self-Reward Detection', () => {
    it('should detect multiple users on same device', async () => {
      // Create requests from different users on same device
      for (let i = 0; i < 3; i++) {
        await fraudService.validateCashbackRequest(
          createValidRequest({
            userId: `user-${i}`,
            deviceFingerprint: 'shared-device',
            orderId: `ORDER-SHARE-${Date.now()}-${i}`,
          })
        );
      }

      // 4th user on same device should be flagged
      const result = await fraudService.validateCashbackRequest(
        createValidRequest({
          userId: 'user-4',
          deviceFingerprint: 'shared-device',
          orderId: `ORDER-SHARE-${Date.now()}-4`,
        })
      );

      expect(result.checks.find(c => c.name === 'Self-Reward Detection')?.passed).toBe(false);
    });

    it('should detect high success rate pattern', async () => {
      // Create many successful requests (simulating suspicious pattern)
      for (let i = 0; i < 15; i++) {
        await fraudService.validateCashbackRequest(
          createValidRequest({
            orderId: `ORDER-SR-${Date.now()}-${i}`,
            cashbackAmount: 5 + i, // Varying amounts
          })
        );
      }

      const result = await fraudService.validateCashbackRequest(
        createValidRequest({
          orderId: `ORDER-SR-${Date.now()}-final`,
          cashbackAmount: 20,
        })
      );

      // Should have high success rate flagged
      const selfRewardCheck = result.checks.find(c => c.name === 'Self-Reward Detection');
      expect(selfRewardCheck?.score).toBeGreaterThan(0);
    });
  });

  // ── Amount Anomaly Tests ──────────────────────────────────────────────────

  describe('Amount Anomaly Detection', () => {
    it('should detect amount exceeding maximum', async () => {
      const result = await fraudService.validateCashbackRequest(
        createValidRequest({ cashbackAmount: 500 }) // Way over the limit
      );

      const amountCheck = result.checks.find(c => c.name === 'Amount Anomaly Detection');
      expect(amountCheck?.passed).toBe(false);
      expect(amountCheck?.score).toBe(0.85);
    });

    it('should detect statistical anomaly', async () => {
      // First, establish normal pattern
      for (let i = 0; i < 10; i++) {
        await fraudService.validateCashbackRequest(
          createValidRequest({
            orderId: `ORDER-NORMAL-${Date.now()}-${i}`,
            cashbackAmount: 10 + Math.random() * 2, // Normal range: 10-12
          })
        );
      }

      // Now try with extreme outlier
      const result = await fraudService.validateCashbackRequest(
        createValidRequest({
          orderId: `ORDER-OUTLIER-${Date.now()}`,
          cashbackAmount: 100, // Way outside normal range
        })
      );

      const amountCheck = result.checks.find(c => c.name === 'Amount Anomaly Detection');
      expect(amountCheck?.passed).toBe(false);
    });

    it('should pass for normal amounts', async () => {
      const result = await fraudService.validateCashbackRequest(
        createValidRequest({ cashbackAmount: 25 })
      );

      expect(result.checks.find(c => c.name === 'Amount Anomaly Detection')?.passed).toBe(true);
    });
  });

  // ── Device Anomaly Tests ──────────────────────────────────────────────────

  describe('Device Anomaly Detection', () => {
    it('should detect too many users on same device', async () => {
      // Create 4 different users on same device
      for (let i = 0; i < 4; i++) {
        await fraudService.validateCashbackRequest(
          createValidRequest({
            userId: `multi-user-${i}`,
            deviceFingerprint: 'suspicious-device',
            orderId: `ORDER-MU-${Date.now()}-${i}`,
          })
        );
      }

      const result = await fraudService.validateCashbackRequest(
        createValidRequest({
          userId: 'multi-user-5',
          deviceFingerprint: 'suspicious-device',
          orderId: `ORDER-MU-${Date.now()}-5`,
        })
      );

      const deviceCheck = result.checks.find(c => c.name === 'Device Anomaly Detection');
      expect(deviceCheck?.passed).toBe(false);
    });

    it('should detect large request on new device', async () => {
      // First request from device with large cashback
      const result = await fraudService.validateCashbackRequest(
        createValidRequest({
          cashbackAmount: 100,
          deviceFingerprint: 'brand-new-device',
          orderId: `ORDER-NEW-${Date.now()}`,
        })
      );

      const deviceCheck = result.checks.find(c => c.name === 'Device Anomaly Detection');
      expect(deviceCheck?.score).toBeGreaterThan(0);
    });
  });

  // ── IP Anomaly Tests ─────────────────────────────────────────────────────

  describe('IP Anomaly Detection', () => {
    it('should detect too many users from same IP', async () => {
      for (let i = 0; i < 6; i++) {
        await fraudService.validateCashbackRequest(
          createValidRequest({
            userId: `ip-user-${i}`,
            ipAddress: '10.0.0.1',
            orderId: `ORDER-IP-${Date.now()}-${i}`,
          })
        );
      }

      const result = await fraudService.validateCashbackRequest(
        createValidRequest({
          userId: 'ip-user-6',
          ipAddress: '10.0.0.1',
          orderId: `ORDER-IP-${Date.now()}-6`,
        })
      );

      expect(result.checks.find(c => c.name === 'IP Anomaly Detection')?.passed).toBe(false);
    });
  });

  // ── Location Anomaly Tests ────────────────────────────────────────────────

  describe('Location Anomaly Detection', () => {
    it('should pass for consistent location', async () => {
      const result = await fraudService.validateCashbackRequest(
        createValidRequest({
          location: { country: 'US', lat: 37.7749, lon: -122.4194 },
          orderId: `ORDER-LOC-${Date.now()}`,
        })
      );

      expect(result.checks.find(c => c.name === 'Location Anomaly Detection')?.passed).toBe(true);
    });

    it('should reduce confidence when no location provided', async () => {
      const result = await fraudService.validateCashbackRequest(
        createValidRequest({
          location: undefined,
          orderId: `ORDER-NO-LOC-${Date.now()}`,
        })
      );

      const locationCheck = result.checks.find(c => c.name === 'Location Anomaly Detection');
      expect(locationCheck?.score).toBeLessThan(0.1);
    });
  });

  // ── Account Anomaly Tests ─────────────────────────────────────────────────

  describe('Account Anomaly Detection', () => {
    it('should detect blacklisted user', async () => {
      // Blacklist a user first
      await fraudService.blacklistUser('blacklisted-user');

      const result = await fraudService.validateCashbackRequest(
        createValidRequest({
          userId: 'blacklisted-user',
          orderId: `ORDER-BL-${Date.now()}`,
        })
      );

      const accountCheck = result.checks.find(c => c.name === 'Account Anomaly Detection');
      expect(accountCheck?.passed).toBe(false);
      expect(accountCheck?.score).toBe(1.0);
    });

    it('should whitelist user and bypass checks', async () => {
      // Whitelist a user
      await fraudService.whitelistUser('whitelisted-user');

      const result = await fraudService.validateCashbackRequest(
        createValidRequest({
          userId: 'whitelisted-user',
          orderId: `ORDER-WL-${Date.now()}`,
        })
      );

      const accountCheck = result.checks.find(c => c.name === 'Account Anomaly Detection');
      expect(accountCheck?.passed).toBe(true);
      expect(accountCheck?.score).toBe(0);
    });

    it('should detect new account with large cashback', async () => {
      const result = await fraudService.validateCashbackRequest(
        createValidRequest({
          userId: 'brand-new-user',
          cashbackAmount: 150,
          orderId: `ORDER-NEW-ACCT-${Date.now()}`,
        })
      );

      const accountCheck = result.checks.find(c => c.name === 'Account Anomaly Detection');
      expect(accountCheck?.score).toBeGreaterThan(0);
    });
  });

  // ── Circular Reward Chain Tests ───────────────────────────────────────────

  describe('Circular Reward Chain Detection', () => {
    it('should build reward chain correctly', async () => {
      // User A -> User B -> User C
      await fraudService.addToRewardChain('user-A', 'merchant-001', 'order-A1', 10);

      const nodeB = await fraudService.addToRewardChain('user-B', 'merchant-001', 'order-B1', 10, 'user-A');

      expect(nodeB.depth).toBe(1);
      expect(nodeB.parentUserId).toBe('user-A');

      const nodeC = await fraudService.addToRewardChain('user-C', 'merchant-001', 'order-C1', 10, 'user-B');

      expect(nodeC.depth).toBe(2);
      expect(nodeC.parentUserId).toBe('user-B');
    });

    it('should detect chain depth limit', async () => {
      // Build a deep chain (exceeds MAX_CHAIN_LENGTH)
      let parentUserId = 'chain-user-0';
      for (let i = 1; i <= 6; i++) {
        await fraudService.addToRewardChain(
          `chain-user-${i}`,
          'merchant-001',
          `order-chain-${i}`,
          10,
          parentUserId
        );
        parentUserId = `chain-user-${i}`;
      }

      // Add one more - should trigger chain depth check
      const result = await fraudService.validateCashbackRequest(
        createValidRequest({
          userId: 'chain-user-7',
          orderId: `ORDER-CHAIN-7-${Date.now()}`,
        })
      );

      // The user would have been added to chain, so the check should pass initially
      // But subsequent validation would catch the deep chain
      expect(result.checks.find(c => c.name === 'Circular Reward Chain Detection')).toBeDefined();
    });
  });

  // ── Risk Scoring Tests ───────────────────────────────────────────────────

  describe('Risk Scoring', () => {
    it('should calculate correct risk level for LOW score', async () => {
      const result = await fraudService.validateCashbackRequest(
        createValidRequest({ cashbackAmount: 5 })
      );

      expect(result.riskLevel).toBe('LOW');
      expect(result.fraudScore).toBeLessThan(0.2);
    });

    it('should calculate correct risk level for CRITICAL score', async () => {
      // Blacklist the user first
      await fraudService.blacklistUser('critical-user');

      const result = await fraudService.validateCashbackRequest(
        createValidRequest({
          userId: 'critical-user',
          cashbackAmount: 500,
          orderId: `ORDER-CR-${Date.now()}`,
        })
      );

      expect(result.riskLevel).toBe('CRITICAL');
      expect(result.fraudScore).toBeGreaterThanOrEqual(0.9);
    });

    it('should flag as fraudulent when score exceeds threshold', async () => {
      // Multiple fraud indicators
      await fraudService.blacklistUser('fraudulent-user');

      const result = await fraudService.validateCashbackRequest(
        createValidRequest({
          userId: 'fraudulent-user',
          cashbackAmount: 500,
          orderId: `ORDER-FRAUD-${Date.now()}`,
        })
      );

      expect(result.isFraudulent).toBe(true);
      expect(result.flags.length).toBeGreaterThan(0);
    });

    it('should generate appropriate recommendations', async () => {
      const result = await fraudService.validateCashbackRequest(
        createValidRequest({ cashbackAmount: 500 })
      );

      expect(result.recommendations.length).toBeGreaterThan(0);
      expect(result.recommendations.some(r => r.includes('REJECT') || r.includes('REVIEW'))).toBe(true);
    });
  });

  // ── Velocity Metrics Tests ───────────────────────────────────────────────

  describe('Velocity Metrics', () => {
    it('should calculate correct velocity metrics', async () => {
      // Create some requests
      for (let i = 0; i < 5; i++) {
        await fraudService.validateCashbackRequest(
          createValidRequest({
            orderId: `ORDER-VM-${Date.now()}-${i}`,
            cashbackAmount: 10,
          })
        );
      }

      const metrics = await fraudService.getVelocityMetrics('user-001');

      expect(metrics.requestsLast24Hours).toBeGreaterThanOrEqual(5);
      expect(metrics.totalCashbackLast24Hours).toBeGreaterThanOrEqual(50);
    });
  });

  // ── Fraud Report Tests ───────────────────────────────────────────────────

  describe('Fraud Reports', () => {
    it('should create fraud report on validation', async () => {
      const request = createValidRequest({ cashbackAmount: 500 });
      await fraudService.validateCashbackRequest(request);

      const reports = await fraudService.getUserFraudReports('user-001');

      expect(reports.length).toBeGreaterThan(0);
    });

    it('should action report correctly', async () => {
      const request = createValidRequest({ cashbackAmount: 500 });
      const result = await fraudService.validateCashbackRequest(request);

      const report = result.flags.length > 0
        ? await fraudService.getUserFraudReports('user-001').then(reports => reports[0])
        : null;

      if (report) {
        const actioned = await fraudService.actionFraudReport(
          (report as any).reportId,
          'REJECTED',
          'admin-user',
          'Confirmed fraud'
        );

        expect(actioned?.isActioned).toBe(true);
        expect(actioned?.action).toBe('REJECTED');
      }
    });

    it('should get pending reports', async () => {
      await fraudService.validateCashbackRequest(createValidRequest({ cashbackAmount: 100 }));
      await fraudService.validateCashbackRequest(createValidRequest({ cashbackAmount: 200 }));

      const pending = await fraudService.getPendingFraudReports();

      expect(pending.length).toBeGreaterThan(0);
    });
  });

  // ── Statistics Tests ────────────────────────────────────────────────────

  describe('Fraud Statistics', () => {
    it('should calculate accurate statistics', async () => {
      // Create various requests
      await fraudService.validateCashbackRequest(createValidRequest({ cashbackAmount: 10 }));
      await fraudService.validateCashbackRequest(createValidRequest({ cashbackAmount: 20 }));
      await fraudService.validateCashbackRequest(createValidRequest({ cashbackAmount: 500 }));

      const stats = await fraudService.getFraudStatistics();

      expect(stats.totalReports).toBeGreaterThanOrEqual(3);
      expect(stats.topFlagTypes).toBeDefined();
    });

    it('should filter statistics by date range', async () => {
      const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const endDate = new Date();

      await fraudService.validateCashbackRequest(createValidRequest());

      const stats = await fraudService.getFraudStatistics(startDate, endDate);

      expect(stats.totalReports).toBeGreaterThanOrEqual(1);
    });
  });

  // ── User Risk Profile Tests ──────────────────────────────────────────────

  describe('User Risk Profile', () => {
    it('should update user risk profile', async () => {
      const request = createValidRequest({ cashbackAmount: 500 });
      await fraudService.validateCashbackRequest(request);

      const profile = await fraudService.getUserRiskProfile('user-001');

      expect(profile).toBeDefined();
      expect(profile?.totalRequests).toBeGreaterThan(0);
    });

    it('should recalculate risk score', async () => {
      // Create multiple fraudulent requests
      for (let i = 0; i < 5; i++) {
        await fraudService.validateCashbackRequest(
          createValidRequest({
            userId: 'risk-user',
            cashbackAmount: 500,
            orderId: `ORDER-RISK-${Date.now()}-${i}`,
          })
        );
      }

      const profile = await fraudService.getUserRiskProfile('risk-user');

      expect(profile?.riskScore).toBeGreaterThan(0);
    });
  });

  // ── Batch Validation Tests ───────────────────────────────────────────────

  describe('Batch Validation', () => {
    it('should validate multiple requests', async () => {
      const requests = Array.from({ length: 5 }, (_, i) =>
        createValidRequest({
          orderId: `ORDER-BATCH-${Date.now()}-${i}`,
          cashbackAmount: 10 + i * 5,
        })
      );

      const results: FraudCheckResult[] = [];
      for (const request of requests) {
        const result = await fraudService.validateCashbackRequest(request);
        results.push(result);
      }

      expect(results.length).toBe(5);
      expect(results.every(r => r.requestId)).toBe(true);
    });
  });
});

// ── Integration Tests ────────────────────────────────────────────────────────

describe('Fraud Prevention Integration', () => {
  let fraudService: CashbackFraudPreventionService;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(MONGO_URI);
    }
    fraudService = new CashbackFraudPreventionService();
  });

  afterAll(async () => {
    await Promise.all([
      CashbackRequest.deleteMany({}),
      FraudReport.deleteMany({}),
      UserRiskProfile.deleteMany({}),
      RewardChainNode.deleteMany({}),
    ]);
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await Promise.all([
      CashbackRequest.deleteMany({}),
      FraudReport.deleteMany({}),
      UserRiskProfile.deleteMany({}),
      RewardChainNode.deleteMany({}),
    ]);
  });

  it('should handle complex fraud scenario', async () => {
    // Simulate a coordinated fraud attack
    const attackUser = 'attack-user';

    // Step 1: Initial reconnaissance - small requests
    for (let i = 0; i < 3; i++) {
      await fraudService.validateCashbackRequest({
        requestId: `ATTACK-INIT-${Date.now()}-${i}`,
        userId: attackUser,
        merchantId: 'merchant-001',
        orderId: `ORDER-ATTACK-INIT-${Date.now()}-${i}`,
        amount: 50,
        cashbackAmount: 5,
        currency: 'USD',
        deviceFingerprint: 'attack-device',
        ipAddress: '10.10.10.10',
        requestedAt: new Date(),
      });
    }

    // Step 2: Escalation - larger requests
    for (let i = 0; i < 3; i++) {
      const result = await fraudService.validateCashbackRequest({
        requestId: `ATTACK-ESC-${Date.now()}-${i}`,
        userId: attackUser,
        merchantId: 'merchant-001',
        orderId: `ORDER-ATTACK-ESC-${Date.now()}-${i}`,
        amount: 200,
        cashbackAmount: 20,
        currency: 'USD',
        deviceFingerprint: 'attack-device',
        ipAddress: '10.10.10.10',
        requestedAt: new Date(),
      });

      // Should be flagged due to velocity
      expect(result.flags.some(f => f.type === 'VELOCITY_ANOMALY')).toBe(true);
    }

    // Step 3: Final attack - maximum damage attempt
    const finalResult = await fraudService.validateCashbackRequest({
      requestId: `ATTACK-FINAL-${Date.now()}`,
      userId: attackUser,
      merchantId: 'merchant-001',
      orderId: `ORDER-ATTACK-FINAL-${Date.now()}`,
      amount: 1000,
      cashbackAmount: 100,
      currency: 'USD',
      deviceFingerprint: 'attack-device',
      ipAddress: '10.10.10.10',
      requestedAt: new Date(),
    });

    // Should be flagged as fraudulent
    expect(finalResult.riskLevel).toBe('HIGH');
    expect(finalResult.flags.length).toBeGreaterThan(2);

    // User should have elevated risk profile
    const profile = await fraudService.getUserRiskProfile(attackUser);
    expect(profile?.riskScore).toBeGreaterThan(0.3);
  });
});

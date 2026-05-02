/**
 * Load Profiles for Rez Intent Graph
 * Scalable from 100 to 1M users
 */

import type { LoadProfile } from './types.js';

// ============================================================================
// Profile Definitions
// ============================================================================

export type { LoadProfile };

// Re-export LoadScenario from types for backwards compatibility
export type { LoadScenario } from './types.js';

export interface LoadPhase {
  name: string;
  duration: number; // seconds
  arrivalRate: number; // requests per second
  concurrentUsers: number;
}

export interface LoadTestConfig {
  targetUrl: string;
  reportingInterval: number; // milliseconds
  enableWebSocket: boolean;
  enableApi: boolean;
  enableIntentCapture: boolean;
  tls: boolean;
  keepAlive: boolean;
}

// ============================================================================
// Load Profiles
// ============================================================================

export const LOAD_PROFILES: Record<string, LoadProfile> = {
  light: {
    name: 'Light',
    description: 'Development and local testing - 100 concurrent users',
    totalUsers: 100,
    activeUsers: 100,
    concurrentConnections: 100,
    requestsPerSecond: 500,
    targetUrl: 'http://localhost:3000',
    duration: 10,
    rampUp: 2,
    thinkTime: 100,
    timeout: 30000,
    phases: [
      { name: 'Warm Up', duration: 60, arrivalRate: 10, concurrentUsers: 10 },
      { name: 'Light Load', duration: 180, arrivalRate: 50, concurrentUsers: 50 },
      { name: 'Steady State', duration: 300, arrivalRate: 100, concurrentUsers: 100 },
      { name: 'Cool Down', duration: 60, arrivalRate: 20, concurrentUsers: 20 },
    ],
  },

  normal: {
    name: 'Normal',
    description: 'Standard production load - 1,000 concurrent users',
    totalUsers: 10000,
    activeUsers: 1000,
    concurrentConnections: 1000,
    requestsPerSecond: 5000,
    targetUrl: 'http://localhost:3000',
    duration: 30,
    rampUp: 5,
    thinkTime: 50,
    timeout: 15000,
    phases: [
      { name: 'Warm Up', duration: 120, arrivalRate: 100, concurrentUsers: 100 },
      { name: 'Ramp Up', duration: 180, arrivalRate: 500, concurrentUsers: 500 },
      { name: 'Normal Load', duration: 600, arrivalRate: 1000, concurrentUsers: 1000 },
      { name: 'Steady State', duration: 600, arrivalRate: 1000, concurrentUsers: 1000 },
      { name: 'Cool Down', duration: 120, arrivalRate: 200, concurrentUsers: 200 },
    ],
  },

  heavy: {
    name: 'Heavy',
    description: 'High load testing - 10,000 concurrent users',
    totalUsers: 100000,
    activeUsers: 10000,
    concurrentConnections: 10000,
    requestsPerSecond: 50000,
    targetUrl: 'http://localhost:3000',
    duration: 60,
    rampUp: 10,
    thinkTime: 20,
    timeout: 10000,
    phases: [
      { name: 'Warm Up', duration: 180, arrivalRate: 500, concurrentUsers: 500 },
      { name: 'Ramp Up', duration: 300, arrivalRate: 2000, concurrentUsers: 2000 },
      { name: 'Heavy Load', duration: 900, arrivalRate: 5000, concurrentUsers: 5000 },
      { name: 'Stress Point', duration: 600, arrivalRate: 8000, concurrentUsers: 8000 },
      { name: 'Peak Test', duration: 300, arrivalRate: 10000, concurrentUsers: 10000 },
      { name: 'Cool Down', duration: 180, arrivalRate: 1000, concurrentUsers: 1000 },
    ],
  },

  peak: {
    name: 'Peak',
    description: 'Peak load simulation - 50,000 concurrent users (1M users @ 5% active)',
    totalUsers: 1000000,
    activeUsers: 50000,
    concurrentConnections: 50000,
    requestsPerSecond: 250000,
    targetUrl: 'http://localhost:3000',
    duration: 120,
    rampUp: 20,
    thinkTime: 10,
    timeout: 5000,
    phases: [
      { name: 'Warm Up', duration: 300, arrivalRate: 1000, concurrentUsers: 1000 },
      { name: 'Ramp Up 1', duration: 300, arrivalRate: 5000, concurrentUsers: 5000 },
      { name: 'Ramp Up 2', duration: 300, arrivalRate: 15000, concurrentUsers: 15000 },
      { name: 'Ramp Up 3', duration: 300, arrivalRate: 30000, concurrentUsers: 30000 },
      { name: 'Peak Load', duration: 1800, arrivalRate: 50000, concurrentUsers: 50000 },
      { name: 'Sustained Peak', duration: 1200, arrivalRate: 50000, concurrentUsers: 50000 },
      { name: 'Gradual Decrease', duration: 300, arrivalRate: 25000, concurrentUsers: 25000 },
      { name: 'Cool Down', duration: 300, arrivalRate: 5000, concurrentUsers: 5000 },
    ],
  },

  // Special profiles for specific testing scenarios
  smoke: {
    name: 'Smoke',
    description: 'Quick smoke test - 10 concurrent users',
    totalUsers: 10,
    activeUsers: 10,
    concurrentConnections: 10,
    requestsPerSecond: 50,
    targetUrl: 'http://localhost:3000',
    duration: 2,
    rampUp: 0.5,
    thinkTime: 200,
    timeout: 30000,
    phases: [
      { name: 'Smoke Test', duration: 60, arrivalRate: 10, concurrentUsers: 10 },
    ],
  },

  soak: {
    name: 'Soak',
    description: 'Long duration stability test - 5,000 concurrent users for 8 hours',
    totalUsers: 500000,
    activeUsers: 5000,
    concurrentConnections: 5000,
    requestsPerSecond: 25000,
    targetUrl: 'http://localhost:3000',
    duration: 480, // 8 hours
    rampUp: 30,
    thinkTime: 30,
    timeout: 10000,
    phases: [
      { name: 'Warm Up', duration: 600, arrivalRate: 1000, concurrentUsers: 1000 },
      { name: 'Ramp Up', duration: 900, arrivalRate: 3000, concurrentUsers: 3000 },
      { name: 'Soak Test', duration: 25200, arrivalRate: 5000, concurrentUsers: 5000 },
      { name: 'Cool Down', duration: 600, arrivalRate: 1000, concurrentUsers: 1000 },
    ],
  },

  spike: {
    name: 'Spike',
    description: 'Sudden traffic spike test',
    totalUsers: 1000000,
    activeUsers: 50000,
    concurrentConnections: 50000,
    requestsPerSecond: 250000,
    targetUrl: 'http://localhost:3000',
    duration: 30,
    rampUp: 2,
    thinkTime: 5,
    timeout: 5000,
    phases: [
      { name: 'Baseline', duration: 120, arrivalRate: 1000, concurrentUsers: 1000 },
      { name: 'Spike', duration: 60, arrivalRate: 50000, concurrentUsers: 50000 },
      { name: 'Sustained', duration: 180, arrivalRate: 50000, concurrentUsers: 50000 },
      { name: 'Recovery', duration: 120, arrivalRate: 1000, concurrentUsers: 1000 },
    ],
  },
};

// ============================================================================
// Scale Calculator
// ============================================================================

export interface ScaleCalculation {
  targetRps: number;
  concurrentConnections: number;
  arrivalInterval: number; // microseconds
  batchSize: number;
  workerThreads: number;
  estimatedMemory: number; // MB
  estimatedCpuCores: number;
}

export function calculateScale(profile: LoadProfile): ScaleCalculation {
  // Calculate optimal configuration based on target RPS
  const targetRps = profile.requestsPerSecond;

  // Artillery/k6 recommendation: 1 worker per 50-100 concurrent connections
  const workerThreads = Math.ceil(profile.concurrentConnections / 50);

  // Calculate arrival interval in microseconds
  const arrivalInterval = Math.floor(1000000 / targetRps);

  // Batch size for efficient processing
  const batchSize = Math.max(1, Math.floor(targetRps / 100));

  // Estimate memory requirements: ~1MB per 100 concurrent connections
  const estimatedMemory = Math.ceil(profile.concurrentConnections / 100);

  // Estimate CPU: ~1 core per 5000 RPS
  const estimatedCpuCores = Math.ceil(targetRps / 5000);

  return {
    targetRps,
    concurrentConnections: profile.concurrentConnections,
    arrivalInterval,
    batchSize,
    workerThreads,
    estimatedMemory,
    estimatedCpuCores,
  };
}

// ============================================================================
// Profile Selector
// ============================================================================

export function getLoadProfile(name: string): LoadProfile {
  const profile = LOAD_PROFILES[name.toLowerCase()];
  if (!profile) {
    throw new Error(`Unknown load profile: ${name}. Available profiles: ${Object.keys(LOAD_PROFILES).join(', ')}`);
  }
  return profile;
}

export function listLoadProfiles(): Array<{ name: string; description: string }> {
  return Object.values(LOAD_PROFILES).map((p) => ({
    name: p.name,
    description: p.description,
  }));
}

// ============================================================================
// Profile Customization
// ============================================================================

export function customizeProfile(
  baseProfile: LoadProfile,
  overrides: Partial<LoadProfile>
): LoadProfile {
  return {
    ...baseProfile,
    ...overrides,
    phases: overrides.phases || baseProfile.phases,
  };
}

// ============================================================================
// Test Configuration
// ============================================================================

export const DEFAULT_TEST_CONFIG: LoadTestConfig = {
  targetUrl: 'http://localhost:3000',
  reportingInterval: 5000,
  enableWebSocket: true,
  enableApi: true,
  enableIntentCapture: true,
  tls: false,
  keepAlive: true,
};

// ============================================================================
// Export
// ============================================================================

export const LOAD_PROFILE_CONFIG = {
  profiles: LOAD_PROFILES,
  getProfile: getLoadProfile,
  listProfiles: listLoadProfiles,
  calculateScale,
  customizeProfile,
  defaultConfig: DEFAULT_TEST_CONFIG,
};

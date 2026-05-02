/**
 * Load Testing Types for Rez Intent Graph
 * Shared types for load profiles and scenarios
 */

export interface LoadPhase {
  name: string;
  duration: number; // seconds
  arrivalRate: number; // requests per second
  concurrentUsers: number;
}

export interface LoadProfile {
  name: string;
  description: string;
  totalUsers: number;
  activeUsers: number;
  concurrentConnections: number;
  requestsPerSecond: number;
  targetUrl: string;
  duration: number; // minutes
  rampUp: number; // minutes
  thinkTime: number; // milliseconds
  timeout: number; // milliseconds
  phases?: LoadPhase[];
}

export interface LoadScenario {
  name: string;
  profiles: LoadProfile[];
  thinkTime: number; // milliseconds
  timeout: number; // milliseconds
}

export interface LoadResult {
  profile: string;
  timestamp: Date;
  duration: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  p50: number;
  p95: number;
  p99: number;
  maxRps: number;
  avgRps: number;
  errors: Record<string, number>;
}

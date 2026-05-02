/**
 * Load Test Reporter for Rez Intent Graph
 * Results aggregation, analysis, and reporting
 */

import type { ScenarioResult } from './scenario.js';
import type { LoadProfile } from './loadProfile.js';

// ============================================================================
// Report Types
// ============================================================================

export interface AggregatedMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  errorRate: number;
  requestsPerSecond: number;
  avgResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  p999: number;
  stdDeviation: number;
  throughput: number; // bytes per second
  totalBytesIn: number;
  totalBytesOut: number;
}

export interface ScenarioMetrics {
  scenarioName: string;
  requestCount: number;
  successCount: number;
  failureCount: number;
  errorRate: number;
  avgResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  rps: number;
}

export interface TimeSeriesDataPoint {
  timestamp: number;
  rps: number;
  latency: number;
  errorRate: number;
  activeConnections: number;
}

export interface LoadTestReport {
  testId: string;
  profileName: string;
  startTime: number;
  endTime: number;
  duration: number;
  aggregatedMetrics: AggregatedMetrics;
  scenarioMetrics: ScenarioMetrics[];
  timeSeriesData: TimeSeriesDataPoint[];
  errors: ErrorSummary[];
  systemMetrics: SystemMetrics;
  recommendations: string[];
}

export interface ErrorSummary {
  errorCode: number;
  errorMessage: string;
  count: number;
  percentage: number;
}

export interface SystemMetrics {
  cpuUsage: number;
  memoryUsage: number;
  memoryTotal: number;
  memoryUsed: number;
  activeConnections: number;
  eventLoopLag: number;
  gcCount: number;
  gcPause: number;
}

// ============================================================================
// Reporter Class
// ============================================================================

export class LoadTestReporter {
  private results: ScenarioResult[] = [];
  private timeSeriesData: TimeSeriesDataPoint[] = [];
  private testStartTime: number = 0;
  private testEndTime: number = 0;
  private profile: LoadProfile | null = null;
  private activeConnectionsSamples: number[] = [];
  private errors: Map<string, number> = new Map();
  private testId: string = '';

  constructor() {
    this.testId = this.generateTestId();
  }

  private generateTestId(): string {
    return `load_test_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  startTest(profile: LoadProfile): void {
    this.profile = profile;
    this.testStartTime = Date.now();
    this.results = [];
    this.timeSeriesData = [];
    this.activeConnectionsSamples = [];
    this.errors = new Map();
    this.testId = this.generateTestId();
  }

  recordResult(result: ScenarioResult): void {
    this.results.push(result);

    // Track errors
    if (!result.success) {
      const errorKey = `${result.statusCode}:${result.error || 'unknown'}`;
      this.errors.set(errorKey, (this.errors.get(errorKey) || 0) + 1);
    }
  }

  recordActiveConnections(count: number): void {
    this.activeConnectionsSamples.push(count);
  }

  recordTimeSeries(data: TimeSeriesDataPoint): void {
    this.timeSeriesData.push(data);
  }

  endTest(): void {
    this.testEndTime = Date.now();
  }

  // ==========================================================================
  // Aggregation Methods
  // ==========================================================================

  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  private calculateStandardDeviation(values: number[], mean: number): number {
    if (values.length === 0) return 0;
    const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length;
    return Math.sqrt(avgSquaredDiff);
  }

  aggregateMetrics(): AggregatedMetrics {
    const durations = this.results.map((r) => r.duration);
    const bytesIn = this.results.map((r) => r.bytesIn);
    const bytesOut = this.results.map((r) => r.bytesOut);

    const totalRequests = this.results.length;
    const successfulRequests = this.results.filter((r) => r.success).length;
    const failedRequests = totalRequests - successfulRequests;
    const errorRate = totalRequests > 0 ? (failedRequests / totalRequests) * 100 : 0;

    const duration = this.testEndTime - this.testStartTime || 1;
    const durationSeconds = duration / 1000;

    const avgResponseTime = durations.length > 0
      ? durations.reduce((sum, d) => sum + d, 0) / durations.length
      : 0;

    const totalBytesIn = bytesIn.reduce((sum, b) => sum + b, 0);
    const totalBytesOut = bytesOut.reduce((sum, b) => sum + b, 0);

    return {
      totalRequests,
      successfulRequests,
      failedRequests,
      errorRate,
      requestsPerSecond: totalRequests / durationSeconds,
      avgResponseTime,
      minResponseTime: Math.min(...durations, 0),
      maxResponseTime: Math.max(...durations, 0),
      p50: this.calculatePercentile(durations, 50),
      p75: this.calculatePercentile(durations, 75),
      p90: this.calculatePercentile(durations, 90),
      p95: this.calculatePercentile(durations, 95),
      p99: this.calculatePercentile(durations, 99),
      p999: this.calculatePercentile(durations, 99.9),
      stdDeviation: this.calculateStandardDeviation(durations, avgResponseTime),
      throughput: (totalBytesIn + totalBytesOut) / durationSeconds,
      totalBytesIn,
      totalBytesOut,
    };
  }

  aggregateScenarioMetrics(): ScenarioMetrics[] {
    const scenarioGroups = new Map<string, ScenarioResult[]>();

    for (const result of this.results) {
      const group = scenarioGroups.get(result.scenarioName) || [];
      group.push(result);
      scenarioGroups.set(result.scenarioName, group);
    }

    const metrics: ScenarioMetrics[] = [];
    const duration = this.testEndTime - this.testStartTime || 1;

    for (const [scenarioName, results] of scenarioGroups) {
      const durations = results.map((r) => r.duration);
      const successCount = results.filter((r) => r.success).length;

      metrics.push({
        scenarioName,
        requestCount: results.length,
        successCount,
        failureCount: results.length - successCount,
        errorRate: (results.length - successCount) / results.length * 100,
        avgResponseTime: durations.reduce((sum, d) => sum + d, 0) / durations.length,
        p95ResponseTime: this.calculatePercentile(durations, 95),
        p99ResponseTime: this.calculatePercentile(durations, 99),
        rps: results.length / (duration / 1000),
      });
    }

    return metrics.sort((a, b) => b.requestCount - a.requestCount);
  }

  aggregateErrors(): ErrorSummary[] {
    const totalErrors = Array.from(this.errors.values()).reduce((sum, count) => sum + count, 0);

    return Array.from(this.errors.entries())
      .map(([errorKey, count]) => {
        const [code, message] = errorKey.split(':');
        return {
          errorCode: parseInt(code, 10) || 0,
          errorMessage: message || 'Unknown error',
          count,
          percentage: totalErrors > 0 ? (count / totalErrors) * 100 : 0,
        };
      })
      .sort((a, b) => b.count - a.count);
  }

  // ==========================================================================
  // System Metrics (if available)
// ==========================================================================

  collectSystemMetrics(): SystemMetrics {
    const memoryUsage = process.memoryUsage();
    const activeConnections = this.activeConnectionsSamples.length > 0
      ? this.activeConnectionsSamples.reduce((sum, c) => sum + c, 0) / this.activeConnectionsSamples.length
      : 0;

    return {
      cpuUsage: 0, // Would require native addon
      memoryUsage: (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100,
      memoryTotal: memoryUsage.heapTotal,
      memoryUsed: memoryUsage.heapUsed,
      activeConnections: Math.round(activeConnections),
      eventLoopLag: 0, // Would require monitoring
      gcCount: 0, // Would require v8 hooks
      gcPause: 0,
    };
  }

  // ==========================================================================
  // Generate Recommendations
  // ==========================================================================

  generateRecommendations(): string[] {
    const recommendations: string[] = [];
    const metrics = this.aggregateMetrics();

    // Latency recommendations
    if (metrics.p99 > 1000) {
      recommendations.push(
        `HIGH: P99 latency (${metrics.p99.toFixed(0)}ms) exceeds 1 second threshold. ` +
        'Consider optimizing database queries, adding caching, or scaling horizontally.'
      );
    }

    if (metrics.p95 > 500) {
      recommendations.push(
        `WARNING: P95 latency (${metrics.p95.toFixed(0)}ms) exceeds 500ms threshold. ` +
        'Review slow endpoints and consider query optimization.'
      );
    }

    // Error rate recommendations
    if (metrics.errorRate > 5) {
      recommendations.push(
        `CRITICAL: Error rate (${metrics.errorRate.toFixed(2)}%) exceeds 5% threshold. ` +
        'Investigate failing requests immediately.'
      );
    } else if (metrics.errorRate > 1) {
      recommendations.push(
        `WARNING: Error rate (${metrics.errorRate.toFixed(2)}%) exceeds 1% threshold. ` +
        'Monitor error trends and identify root causes.'
      );
    }

    // Throughput recommendations
    if (this.profile && metrics.requestsPerSecond < this.profile.requestsPerSecond * 0.8) {
      recommendations.push(
        `THROUGHPUT: Actual RPS (${metrics.requestsPerSecond.toFixed(0)}) is below target ` +
        `(${this.profile.requestsPerSecond}). Consider optimizing handlers or increasing resources.`
      );
    }

    // Memory recommendations
    const systemMetrics = this.collectSystemMetrics();
    if (systemMetrics.memoryUsage > 85) {
      recommendations.push(
        `CRITICAL: Memory usage (${systemMetrics.memoryUsage.toFixed(1)}%) exceeds 85%. ` +
        'Risk of out-of-memory errors. Consider increasing memory or optimizing usage.'
      );
    } else if (systemMetrics.memoryUsage > 70) {
      recommendations.push(
        `WARNING: Memory usage (${systemMetrics.memoryUsage.toFixed(1)}%) above 70%. ` +
        'Monitor for potential memory leaks.'
      );
    }

    // Variability recommendations
    if (metrics.stdDeviation > metrics.avgResponseTime * 0.5) {
      recommendations.push(
        `VARIABILITY: High standard deviation (${metrics.stdDeviation.toFixed(0)}ms) indicates ` +
        'inconsistent response times. Investigate resource contention or GC pauses.'
      );
    }

    return recommendations;
  }

  // ==========================================================================
  // Report Generation
  // ==========================================================================

  generateReport(): LoadTestReport {
    return {
      testId: this.testId,
      profileName: this.profile?.name || 'Unknown',
      startTime: this.testStartTime,
      endTime: this.testEndTime,
      duration: this.testEndTime - this.testStartTime,
      aggregatedMetrics: this.aggregateMetrics(),
      scenarioMetrics: this.aggregateScenarioMetrics(),
      timeSeriesData: this.timeSeriesData,
      errors: this.aggregateErrors(),
      systemMetrics: this.collectSystemMetrics(),
      recommendations: this.generateRecommendations(),
    };
  }

  generateMarkdownReport(): string {
    const report = this.generateReport();
    const metrics = report.aggregatedMetrics;

    const startDate = new Date(report.startTime).toISOString();
    const endDate = new Date(report.endTime).toISOString();

    let markdown = `# Load Test Report: ${report.profileName}\n\n`;
    markdown += `**Test ID:** \`${report.testId}\`\n`;
    markdown += `**Start:** ${startDate}\n`;
    markdown += `**End:** ${endDate}\n`;
    markdown += `**Duration:** ${(report.duration / 1000 / 60).toFixed(2)} minutes\n\n`;

    markdown += `## Summary\n\n`;
    markdown += `| Metric | Value |\n`;
    markdown += `|--------|-------|\n`;
    markdown += `| Total Requests | ${metrics.totalRequests.toLocaleString()} |\n`;
    markdown += `| Successful | ${metrics.successfulRequests.toLocaleString()} |\n`;
    markdown += `| Failed | ${metrics.failedRequests.toLocaleString()} |\n`;
    markdown += `| Error Rate | ${metrics.errorRate.toFixed(2)}% |\n`;
    markdown += `| RPS | ${metrics.requestsPerSecond.toFixed(2)} |\n`;
    markdown += `| Throughput | ${(metrics.throughput / 1024 / 1024).toFixed(2)} MB/s |\n\n`;

    markdown += `## Latency (ms)\n\n`;
    markdown += `| Percentile | Value |\n`;
    markdown += `|-------------|-------|\n`;
    markdown += `| Min | ${metrics.minResponseTime.toFixed(2)} |\n`;
    markdown += `| Avg | ${metrics.avgResponseTime.toFixed(2)} |\n`;
    markdown += `| P50 | ${metrics.p50.toFixed(2)} |\n`;
    markdown += `| P75 | ${metrics.p75.toFixed(2)} |\n`;
    markdown += `| P90 | ${metrics.p90.toFixed(2)} |\n`;
    markdown += `| P95 | ${metrics.p95.toFixed(2)} |\n`;
    markdown += `| P99 | ${metrics.p99.toFixed(2)} |\n`;
    markdown += `| P99.9 | ${metrics.p999.toFixed(2)} |\n`;
    markdown += `| Max | ${metrics.maxResponseTime.toFixed(2)} |\n`;
    markdown += `| Std Dev | ${metrics.stdDeviation.toFixed(2)} |\n\n`;

    if (report.scenarioMetrics.length > 0) {
      markdown += `## Scenario Breakdown\n\n`;
      markdown += `| Scenario | Requests | Success | Error Rate | Avg Latency | P95 | RPS |\n`;
      markdown += `|----------|----------|---------|------------|-------------|-----|-----|\n`;

      for (const scenario of report.scenarioMetrics) {
        markdown += `| ${scenario.scenarioName} | ${scenario.requestCount.toLocaleString()} | `;
        markdown += `${scenario.successCount.toLocaleString()} | ${scenario.errorRate.toFixed(2)}% | `;
        markdown += `${scenario.avgResponseTime.toFixed(2)}ms | ${scenario.p95ResponseTime.toFixed(2)}ms | `;
        markdown += `${scenario.rps.toFixed(2)} |\n`;
      }
      markdown += `\n`;
    }

    if (report.errors.length > 0) {
      markdown += `## Errors\n\n`;
      markdown += `| Code | Error | Count | Percentage |\n`;
      markdown += `|------|-------|-------|------------|\n`;

      for (const error of report.errors.slice(0, 10)) {
        markdown += `| ${error.errorCode} | ${error.errorMessage} | ${error.count} | ${error.percentage.toFixed(2)}% |\n`;
      }
      markdown += `\n`;
    }

    markdown += `## System Metrics\n\n`;
    markdown += `| Metric | Value |\n`;
    markdown += `|--------|-------|\n`;
    markdown += `| Memory Usage | ${report.systemMetrics.memoryUsage.toFixed(1)}% |\n`;
    markdown += `| Memory Used | ${(report.systemMetrics.memoryUsed / 1024 / 1024).toFixed(0)} MB |\n`;
    markdown += `| Memory Total | ${(report.systemMetrics.memoryTotal / 1024 / 1024).toFixed(0)} MB |\n`;
    markdown += `| Active Connections | ${report.systemMetrics.activeConnections} |\n\n`;

    if (report.recommendations.length > 0) {
      markdown += `## Recommendations\n\n`;
      for (const rec of report.recommendations) {
        markdown += `- ${rec}\n`;
      }
      markdown += `\n`;
    }

    return markdown;
  }

  // ==========================================================================
  // Export Methods
  // ==========================================================================

  exportJson(): string {
    return JSON.stringify(this.generateReport(), null, 2);
  }

  exportPrometheusMetrics(): string {
    const metrics = this.aggregateMetrics();
    const scenarios = this.aggregateScenarioMetrics();

    let output = `# HELP load_test_requests_total Total number of load test requests\n`;
    output += `# TYPE load_test_requests_total counter\n`;
    output += `load_test_requests_total{status="success"} ${metrics.successfulRequests}\n`;
    output += `load_test_requests_total{status="failure"} ${metrics.failedRequests}\n\n`;

    output += `# HELP load_test_rps Requests per second\n`;
    output += `# TYPE load_test_rps gauge\n`;
    output += `load_test_rps ${metrics.requestsPerSecond.toFixed(2)}\n\n`;

    output += `# HELP load_test_latency_ms Response latency in milliseconds\n`;
    output += `# TYPE load_test_latency_ms gauge\n`;
    output += `load_test_latency_ms{quantile="50"} ${metrics.p50.toFixed(2)}\n`;
    output += `load_test_latency_ms{quantile="75"} ${metrics.p75.toFixed(2)}\n`;
    output += `load_test_latency_ms{quantile="90"} ${metrics.p90.toFixed(2)}\n`;
    output += `load_test_latency_ms{quantile="95"} ${metrics.p95.toFixed(2)}\n`;
    output += `load_test_latency_ms{quantile="99"} ${metrics.p99.toFixed(2)}\n`;
    output += `load_test_latency_ms{quantile="999"} ${metrics.p999.toFixed(2)}\n`;
    output += `load_test_latency_ms{quantile="avg"} ${metrics.avgResponseTime.toFixed(2)}\n\n`;

    output += `# HELP load_test_error_rate Error rate percentage\n`;
    output += `# TYPE load_test_error_rate gauge\n`;
    output += `load_test_error_rate ${metrics.errorRate.toFixed(4)}\n\n`;

    for (const scenario of scenarios) {
      output += `# HELP load_test_scenario_requests_total Requests per scenario\n`;
      output += `# TYPE load_test_scenario_requests_total counter\n`;
      output += `load_test_scenario_requests_total{scenario="${scenario.scenarioName}",status="success"} ${scenario.successCount}\n`;
      output += `load_test_scenario_requests_total{scenario="${scenario.scenarioName}",status="failure"} ${scenario.failureCount}\n`;
    }

    return output;
  }

  clear(): void {
    this.results = [];
    this.timeSeriesData = [];
    this.activeConnectionsSamples = [];
    this.errors = new Map();
  }
}

// ============================================================================
// Export
// ============================================================================

export const REPORTER_CONFIG = {
  LoadTestReporter,
  createReporter: () => new LoadTestReporter(),
};

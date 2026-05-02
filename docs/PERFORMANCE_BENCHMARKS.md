# Performance Benchmarks - Rez Intent Graph

This document defines the performance benchmarks and thresholds for the Rez Intent Graph system, targeting 1M user scale.

## Table of Contents

- [Overview](#overview)
- [Latency Thresholds](#latency-thresholds)
- [Throughput Targets](#throughput-targets)
- [Error Rate Limits](#error-rate-limits)
- [Resource Utilization Guidelines](#resource-utilization-guidelines)
- [Load Profile Definitions](#load-profile-definitions)
- [Benchmark Methodology](#benchmark-methodology)

---

## Overview

The Rez Intent Graph is designed to handle **1 million users** with **5% active users** at peak, resulting in **50,000 concurrent connections** and **250,000 requests per second** throughput.

### System Requirements

| Component | Specification |
|-----------|---------------|
| Total Users | 1,000,000 |
| Active Users (5%) | 50,000 |
| Concurrent WebSocket Connections | 50,000 |
| Target RPS | 250,000 |
| Data Retention | 90 days |

---

## Latency Thresholds

### API Response Time Targets

All latency values are measured at the **application layer** (end-to-end).

| Endpoint Category | p50 | p75 | p90 | p95 | p99 | Max |
|-------------------|-----|-----|-----|-----|-----|-----|
| **Intent Capture** | < 10ms | < 25ms | < 50ms | < 75ms | < 150ms | 500ms |
| **Intent Query** | < 50ms | < 100ms | < 200ms | < 300ms | < 500ms | 1000ms |
| **User Graph** | < 100ms | < 200ms | < 400ms | < 500ms | < 1000ms | 2000ms |
| **Chat API** | < 100ms | < 200ms | < 300ms | < 400ms | < 800ms | 1500ms |
| **Merchant Analytics** | < 200ms | < 400ms | < 600ms | < 800ms | < 1500ms | 3000ms |
| **Health Check** | < 5ms | < 10ms | < 15ms | < 20ms | < 50ms | 100ms |

### WebSocket Message Latency

| Metric | Threshold |
|--------|-----------|
| Connection Establishment | < 100ms |
| Message Round-Trip | < 50ms |
| Subscription Response | < 100ms |

### Database Query Targets

| Query Type | p95 | p99 |
|------------|-----|-----|
| Intent Insert | < 20ms | < 50ms |
| User Graph Lookup | < 100ms | < 200ms |
| Time-Range Query | < 200ms | < 500ms |
| Aggregation Query | < 500ms | < 1000ms |

---

## Throughput Targets

### Requests Per Second (RPS)

| Profile | Concurrent Users | Target RPS | Burst Capacity |
|---------|-----------------|------------|----------------|
| Light | 100 | 500 | 1,000 |
| Normal | 1,000 | 5,000 | 10,000 |
| Heavy | 10,000 | 50,000 | 100,000 |
| Peak | 50,000 | 250,000 | 500,000 |

### Throughput by Endpoint

| Endpoint | RPS Allocation | Max RPS |
|----------|---------------|---------|
| POST /api/intent/capture | 40% | 100,000 |
| GET /api/intent/user/:id/graph | 20% | 50,000 |
| POST /api/intent/query | 15% | 37,500 |
| GET /api/merchant/:id/analytics | 10% | 25,000 |
| POST /api/chat/message | 10% | 25,000 |
| Other | 5% | 12,500 |

### WebSocket Throughput

| Metric | Target | Maximum |
|--------|--------|---------|
| Messages/Second (Inbound) | 500,000 | 1,000,000 |
| Messages/Second (Outbound) | 2,000,000 | 4,000,000 |
| Concurrent Connections | 50,000 | 100,000 |

---

## Error Rate Limits

### Acceptable Error Rates

| Error Type | Warning Threshold | Critical Threshold | SLI Target |
|------------|------------------|-------------------|------------|
| **HTTP 5xx Errors** | > 0.1% | > 1% | < 0.01% |
| **HTTP 4xx Errors** | > 1% | > 5% | < 0.1% |
| **Timeouts** | > 0.1% | > 1% | < 0.01% |
| **Connection Failures** | > 0.01% | > 0.1% | < 0.001% |
| **Total Error Rate** | > 0.5% | > 2% | < 0.1% |

### HTTP Status Code Distribution (Target)

| Status Code | Percentage |
|-------------|------------|
| 2xx Success | 99.9% |
| 400 Bad Request | 0.05% |
| 401 Unauthorized | 0.02% |
| 404 Not Found | 0.02% |
| 429 Rate Limited | 0.01% |
| 5xx Server Error | 0.00% |

---

## Resource Utilization Guidelines

### CPU Utilization

| Load Level | Target | Warning | Critical |
|------------|--------|---------|----------|
| Idle | < 10% | - | - |
| Light | 20-40% | > 60% | > 80% |
| Normal | 40-60% | > 70% | > 85% |
| Heavy | 60-75% | > 80% | > 90% |
| Peak | 75-85% | > 90% | > 95% |

### Memory Utilization

| Metric | Target | Warning | Critical |
|--------|--------|---------|----------|
| Heap Usage | < 60% | > 70% | > 85% |
| RSS Memory | < 80% | > 85% | > 90% |
| Event Loop Lag | < 10ms | > 50ms | > 100ms |

### Network Utilization

| Metric | Target | Maximum |
|--------|--------|---------|
| Bandwidth In | - | 1 Gbps |
| Bandwidth Out | - | 1 Gbps |
| Connection Pool Usage | < 80% | 100% |

### Database Connection Pool

| Metric | Target | Maximum |
|--------|--------|---------|
| Pool Utilization | < 70% | 100% |
| Query Wait Time | < 50ms | 200ms |
| Idle Connections | 10-20% | < 5% |

---

## Load Profile Definitions

### Profile Comparison

| Metric | Light | Normal | Heavy | Peak |
|--------|-------|--------|-------|------|
| Total Users | 100 | 10,000 | 100,000 | 1,000,000 |
| Active Users | 100 | 1,000 | 10,000 | 50,000 |
| Concurrent WS | 100 | 1,000 | 10,000 | 50,000 |
| Target RPS | 500 | 5,000 | 50,000 | 250,000 |
| Duration | 10 min | 30 min | 60 min | 120 min |

### Peak Load Profile (1M Users)

```
Phase 1: Warm Up (5 min)
  - Arrival Rate: 1,000 RPS
  - Concurrent Users: 1,000

Phase 2: Ramp Up 1 (5 min)
  - Arrival Rate: 5,000 RPS
  - Concurrent Users: 5,000

Phase 3: Ramp Up 2 (5 min)
  - Arrival Rate: 15,000 RPS
  - Concurrent Users: 15,000

Phase 4: Ramp Up 3 (5 min)
  - Arrival Rate: 30,000 RPS
  - Concurrent Users: 30,000

Phase 5: Peak Load (30 min)
  - Arrival Rate: 50,000 RPS
  - Concurrent Users: 50,000

Phase 6: Sustained Peak (20 min)
  - Arrival Rate: 50,000 RPS
  - Concurrent Users: 50,000

Phase 7: Gradual Decrease (5 min)
  - Arrival Rate: 25,000 RPS
  - Concurrent Users: 25,000

Phase 8: Cool Down (5 min)
  - Arrival Rate: 5,000 RPS
  - Concurrent Users: 5,000
```

---

## Benchmark Methodology

### Testing Approach

1. **Warm-up Phase**: Pre-cache data and establish baseline
2. **Ramp-up Phase**: Gradually increase load to target
3. **Steady State Phase**: Maintain target load for duration
4. **Cool-down Phase**: Gradually reduce load
5. **Analysis Phase**: Analyze results and generate report

### Measurement Points

- **Client-side**: Request initiation to response received
- **Server-side**: Request receipt to response sent
- **Database**: Query execution time
- **Network**: Time to first byte (TTFB)

### Metrics Collection

| Category | Metrics |
|----------|---------|
| Latency | p50, p75, p90, p95, p99, p99.9, max |
| Throughput | RPS, bandwidth, concurrent connections |
| Errors | Error rate, error types, error distribution |
| Resources | CPU, memory, network, disk I/O |
| Application | Event loop lag, GC pauses, heap usage |

### Pass/Fail Criteria

A load test passes if:

- [ ] p99 latency < threshold for all endpoints
- [ ] Error rate < 0.1%
- [ ] No timeout errors
- [ ] CPU < 90% sustained
- [ ] Memory < 85% sustained
- [ ] System remains stable during cool-down

### Test Environments

| Environment | Purpose | Data Volume |
|-------------|---------|-------------|
| Local | Development | < 1,000 users |
| CI | Automated testing | < 100 users |
| Staging | Pre-production | < 10,000 users |
| Production | Live validation | Full scale |

---

## Monitoring Alerts

### Latency Alerts

```yaml
alerts:
  - name: high_p99_latency
    condition: p99_latency > 500ms
    severity: warning
    duration: 5m

  - name: critical_p99_latency
    condition: p99_latency > 1000ms
    severity: critical
    duration: 1m
```

### Throughput Alerts

```yaml
alerts:
  - name: low_throughput
    condition: rps < 80%_of_target
    severity: warning
    duration: 10m

  - name: throughput_degradation
    condition: rps_drop > 30%_over_5m
    severity: critical
    duration: 2m
```

### Resource Alerts

```yaml
alerts:
  - name: high_cpu
    condition: cpu_usage > 85%
    severity: warning
    duration: 5m

  - name: critical_cpu
    condition: cpu_usage > 95%
    severity: critical
    duration: 1m

  - name: high_memory
    condition: memory_usage > 80%
    severity: warning
    duration: 5m

  - name: memory_leak
    condition: memory_growth > 10%_over_30m
    severity: critical
    duration: 10m
```

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-05-02 | Performance Engineering | Initial benchmarks |

---

## Appendix: Quick Reference

### Latency Quick Reference

```
10ms   - Excellent (cache hit)
50ms   - Good (simple query)
100ms  - Acceptable (complex query)
200ms  - Warning (optimization needed)
500ms  - Critical (user impact)
1000ms - Unacceptable (timeout risk)
```

### Resource Quick Reference

```
CPU:    Target < 70%, Warning > 85%, Critical > 95%
Memory: Target < 60%, Warning > 75%, Critical > 85%
Disk:   Target < 60%, Warning > 80%, Critical > 90%
Network: Target < 50%, Warning > 70%, Critical > 85%
```

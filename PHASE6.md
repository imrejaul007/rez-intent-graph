# Phase 6: Real-time WebSocket & Monitoring

## Overview

Phase 6 adds **real-time capabilities** and **comprehensive monitoring** to ReZ Mind:
- WebSocket server for live updates
- Metrics collection and reporting
- Health checking and alerting
- Prometheus-compatible metrics export

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Real-time Architecture                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                   │
│  │  Merchant  │    │  Consumer   │    │  Agent     │                   │
│  │  Dashboard │    │     App     │    │  Dashboard  │                   │
│  └──────┬─────┘    └──────┬─────┘    └──────┬─────┘                   │
│         │                  │                  │                            │
│         └──────────────────┼──────────────────┘                            │
│                            │                                                │
│                            ▼                                                │
│  ┌─────────────────────────────────────────────────────────────┐           │
│  │                   WebSocket Server                           │           │
│  │                  ws://host/ws                               │           │
│  └─────────────────────────────────────────────────────────────┘           │
│                            │                                                │
│         ┌──────────────────┼──────────────────┐                            │
│         ▼                  ▼                  ▼                            │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                   │
│  │  Demand     │    │   Nudge     │    │   System    │                   │
│  │  Signals    │    │   Events    │    │   Metrics   │                   │
│  └─────────────┘    └─────────────┘    └─────────────┘                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## WebSocket Server

### Connection

```javascript
const ws = new WebSocket('ws://localhost:3005/ws');

ws.onopen = () => {
  console.log('Connected');
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received:', data);
};
```

### Subscribe to Channels

```javascript
// Subscribe to demand signals for a merchant
ws.send(JSON.stringify({
  type: 'subscribe',
  channel: 'demand_signals',
  filter: { merchantId: 'merchant_123', category: 'DINING' }
}));

// Subscribe to system metrics
ws.send(JSON.stringify({
  type: 'subscribe',
  channel: 'system_metrics'
}));

// Subscribe to nudge events for a user
ws.send(JSON.stringify({
  type: 'subscribe',
  channel: 'nudge_events',
  filter: { userId: 'user_456' }
}));
```

### Available Channels

| Channel | Description | Events |
|---------|-------------|--------|
| `demand_signals` | Real-time demand updates | `demand_spike`, `signal_update` |
| `scarcity_alerts` | Inventory alerts | `scarcity_warning`, `scarcity_critical` |
| `nudge_events` | Nudge lifecycle | `nudge_sent`, `nudge_clicked`, `nudge_converted` |
| `system_metrics` | Periodic metrics | `metrics_update` (every 30s) |
| `merchant_dashboard` | Dashboard updates | `demand_spike`, `trend_update` |
| `user_intents` | User activity | `intent_captured`, `intent_fulfilled` |

### Message Types

**Server → Client:**
```javascript
// Welcome message
{ type: 'connected', payload: { clientId, message } }

// Event
{ type: 'event', channel: 'demand_signals', payload: {...} }

// Initial data
{ type: 'initial_data', payload: { channel, data } }

// Subscription confirmed
{ type: 'subscribed', payload: { channel, filter } }
```

**Client → Server:**
```javascript
// Subscribe
{ type: 'subscribe', channel: 'demand_signals', filter: {...} }

// Unsubscribe
{ type: 'unsubscribe', channel: 'demand_signals' }

// Heartbeat
{ type: 'ping' }
```

## Monitoring API

### Health Check

```bash
GET /api/monitoring/health

# Response
{
  "healthy": true,
  "checks": {
    "database": true,
    "redis": false,
    "services": true
  },
  "services": {
    "healthy": 5,
    "total": 6,
    "status": { "wallet": true, "order": true, ... }
  },
  "uptime": 86400
}
```

### Dashboard Metrics

```bash
GET /api/monitoring/dashboard

# Response
{
  "timestamp": 1745692800000,
  "uptime": 172800,
  "system": {
    "memoryUsageMB": 128.45,
    "sharedMemoryEntries": 1542,
    "uptime": 172800
  },
  "intents": {
    "captured": 15420,
    "dormant": 342,
    "fulfilled": 890
  },
  "nudges": {
    "sent": 1234,
    "delivered": 1180,
    "clicked": 156,
    "converted": 45,
    "conversionRate": 3.65
  },
  "agents": {
    "totalRuns": 890,
    "successRate": 94.5,
    "avgDuration": 234
  },
  "alerts": {
    "activeCount": 2,
    "criticalCount": 0
  }
}
```

### Metrics API

```bash
# Get all metrics
GET /api/monitoring/metrics

# Get specific metric
GET /api/monitoring/metrics/:name

# Record custom metric
POST /api/monitoring/metrics/record
{ "name": "custom_counter", "value": 1, "type": "counter" }

# Export in Prometheus format
GET /api/monitoring/metrics/export
```

### Alerts API

```bash
# Get active alerts
GET /api/monitoring/alerts

# Get alert history
GET /api/monitoring/alerts/history?limit=100

# Acknowledge alert
POST /api/monitoring/alerts/:id/acknowledge

# Trigger alert manually
POST /api/monitoring/alerts/trigger
{ "metric": "nudge_conversion_rate", "severity": "warning", "message": "Conversion below threshold", "value": 2.1, "threshold": 5.0 }
```

## Metrics Collected

### Intent Metrics
| Metric | Type | Description |
|--------|------|-------------|
| `intent_captured` | counter | Total intents captured |
| `intent_dormant` | counter | Intents marked dormant |
| `intent_fulfilled` | counter | Intents fulfilled |

### Nudge Metrics
| Metric | Type | Description |
|--------|------|-------------|
| `nudge_sent` | counter | Nudges sent |
| `nudge_delivered` | counter | Nudges delivered |
| `nudge_clicked` | counter | Nudges clicked |
| `nudge_converted` | counter | Nudges converted |
| `nudge_failed` | counter | Nudges failed |

### Agent Metrics
| Metric | Type | Description |
|--------|------|-------------|
| `agent_run_duration` | timer | Agent execution time |
| `agent_run_success` | counter | Successful runs |
| `agent_run_failed` | counter | Failed runs |

### Service Metrics
| Metric | Type | Description |
|--------|------|-------------|
| `service_request_total` | counter | Total requests |
| `service_request_duration` | timer | Request latency |
| `service_error_total` | counter | Errors |
| `circuit_breaker_open` | counter | Circuit breaker opens |

## Health Checks

Health checks are registered for:
- Database connectivity
- Shared memory availability
- Service dependencies
- Circuit breaker status

## Alert System

### Alert Severities
- **info**: Informational alerts
- **warning**: Attention needed
- **critical**: Immediate action required

### Default Thresholds
```javascript
// Set custom thresholds
metricsCollector.setAlertThreshold('nudge_conversion_rate', 5.0); // %
metricsCollector.setAlertThreshold('agent_failure_rate', 10.0); // %
```

## Integration with Other Phases

- **Phase 3**: Nudge events published to WebSocket
- **Phase 4**: Agent metrics collected
- **Phase 5**: Merchant dashboard updates via WebSocket

## WebSocket Client Example

```javascript
class ReZMindoWebSocket {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.handlers = {};
  }

  connect() {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => console.log('Connected to ReZ Mind');
    this.ws.onmessage = (e) => this.handleMessage(JSON.parse(e.data));
    this.ws.onclose = () => {
      console.log('Disconnected, reconnecting...');
      setTimeout(() => this.connect(), 5000);
    };
  }

  subscribe(channel, filter) {
    this.ws.send(JSON.stringify({ type: 'subscribe', channel, filter }));
  }

  on(event, handler) {
    this.handlers[event] = handler;
  }

  handleMessage(msg) {
    if (msg.type === 'event') {
      const handler = this.handlers[msg.channel];
      if (handler) handler(msg.payload);
    }
  }
}

// Usage
const client = new ReZMindoWebSocket('ws://localhost:3005/ws');
client.connect();

client.subscribe('demand_signals', { merchantId: 'm123' });
client.on('demand_signals', (data) => {
  console.log('Demand spike:', data);
});
```

## Next Steps

1. Add Grafana dashboard configuration
2. Add distributed tracing (OpenTelemetry)
3. Add log aggregation
4. Add SLA monitoring

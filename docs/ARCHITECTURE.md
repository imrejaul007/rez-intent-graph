# Intent Graph Architecture

## System Overview

The Intent Graph is the AI moat of the ReZ ecosystem - capturing user intent signals across all apps and enabling cross-app personalization.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        ReZ Ecosystem                                     │
│                                                                         │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│  │  ReZ    │ │  Hotel  │ │ Hotel   │ │ Nexta   │ │Resturan-│           │
│  │  Now    │ │   OTA   │ │   PMS   │ │  BiZ    │ │   tian  │           │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘           │
│       │           │           │           │           │                 │
│       └───────────┴───────────┴───────────┴───────────┘                 │
│                              │                                           │
│                    82 Events Captured                                   │
│                    (search, view, book, order, etc.)                    │
└──────────────────────────────┼──────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    INTENT GRAPH SERVICE                                  │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     API Layer (Express)                          │   │
│  │  POST /api/intent/capture    - Capture intent                   │   │
│  │  GET  /api/intent/active     - Get active intents               │   │
│  │  GET  /api/intent/similar    - Find similar intents             │   │
│  │  GET  /api/intent/recommend  - Get recommendations              │   │
│  │  GET  /metrics              - Prometheus metrics                │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                   │
│  │    Redis     │ │   MongoDB    │ │    OpenAI    │                   │
│  │   (Cache)    │ │  (Storage)   │ │ (Embeddings) │                   │
│  │              │ │              │ │              │                   │
│  │  • Hot data  │ │  • All data  │ │  • Similar   │                   │
│  │  • Sessions  │ │  • History   │ │  • Recommend │                   │
│  │  • Streams   │ │  • Indexes   │ │              │                   │
│  └──────────────┘ └──────────────┘ └──────────────┘                   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                  Processing Layer                                │   │
│  │  • Dormant Intent Cron (daily)                                 │   │
│  │  • Agent Swarm (optional)                                       │   │
│  │  • Nudge Delivery Queue                                        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Intelligence Outputs                                  │
│                                                                         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐  │
│  │  Personal-   │ │   Dormant    │ │    Cross-    │ │   Merchant   │  │
│  │  ization     │ │   Intent     │ │    App       │ │   Demand     │  │
│  │              │ │   Revival    │ │   Profile    │ │   Signals    │  │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Data Model

### Intent Document

```typescript
interface Intent {
  _id: ObjectId;
  userId: string;              // User identifier
  appType: string;             // 'hotel_ota', 'restaurant', 'rez_now', etc.
  category: string;            // 'TRAVEL', 'DINING', 'RETAIL'
  intentKey: string;            // Normalized intent key (e.g., 'coffee_shop')
  intentQuery: string;         // Original search query
  confidence: number;          // 0.0 - 1.0
  status: 'ACTIVE' | 'DORMANT' | 'FULFILLED';
  merchantId?: string;         // Associated merchant if applicable
  metadata: Record<string, any>; // Additional context
  signals: IntentSignal[];     // History of events
  embedding?: number[];        // Vector embedding for similarity
  firstSeenAt: Date;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface IntentSignal {
  eventType: string;           // 'search', 'view', 'book', 'order'
  weight: number;              // Signal importance
  data?: Record<string, any>; // Event metadata
  capturedAt: Date;
}
```

### Signal Weights

| Event Type | Weight | Confidence Impact |
|------------|--------|-------------------|
| `search` | 0.15 | Low intent |
| `view` | 0.10 | Low intent |
| `wishlist` | 0.25 | Medium intent |
| `cart_add` | 0.30 | Medium-high intent |
| `hold` | 0.35 | High intent |
| `checkout_start` | 0.40 | High intent |
| `booking_confirmed` | 1.00 | Fulfilled |
| `fulfilled` | 1.00 | Complete |

### Cross-App Profile

```typescript
interface CrossAppIntentProfile {
  _id: ObjectId;
  userId: string;
  travelAffinity: number;      // 0-100
  diningAffinity: number;     // 0-100
  retailAffinity: number;     // 0-100
  activeIntents: number;
  dormantIntents: number;
  totalConversions: number;
  lastActivityAt: Date;
  updatedAt: Date;
}
```

## Confidence Calculation

```
new_confidence = existing_confidence + (event_weight × recency_multiplier) + velocity_bonus

where:
  recency_multiplier = e^(-days_since_last_signal / 30)
  velocity_bonus = 0.2 if <1min, 0.1 if <5min, 0.05 if <1hr, else 0
```

## API Endpoints

### Intent Capture

```bash
POST /api/intent/capture
Headers: x-internal-token: <token>
Body: {
  userId: string;
  appType: string;
  eventType: string;
  category: string;
  intentKey: string;
  intentQuery?: string;
  metadata?: Record<string, any>;
}
```

### Recommendations

```bash
GET /api/intent/recommendations?userId=<id>&category=<cat>&limit=10
GET /api/intent/similar?userId=<id>&intentKey=<key>&category=<cat>
```

### Monitoring

```bash
GET /metrics           # Prometheus format
GET /health           # Health check
GET /metrics/dashboard # JSON dashboard
```

## Scaling Strategy

### Current (MVP)
- Single Express server on Render
- MongoDB Atlas for storage
- Redis optional for caching

### Production Scaling

1. **Horizontal Scaling**: Multiple Express instances behind load balancer
2. **Redis Streams**: Real-time signal ingestion pipeline
3. **pgvector**: Dedicated vector similarity search
4. **Workers**: Separate cron/nudge workers

### Deployment Configuration

```yaml
# render.yaml
services:
  - type: web
    name: intent-graph
    env: node
    plan: starter
    numInstances: 3
    healthCheckPath: /health
    envVars:
      - key: NODE_ENV
        value: production
      - key: MONGODB_URI
        sync: false
      - key: REDIS_URL
        sync: false
      - key: INTERNAL_SERVICE_TOKEN
        sync: false
```

## Circuit Breaker Pattern

Consumer apps implement circuit breakers to gracefully degrade when intent graph is slow/down:

```typescript
// Consumer app code
const result = await circuitBreaker.execute(
  () => fetch('/api/intent/recommendations'),
  () => [] // Fallback: non-personalized results
);
```

## Observability

### Prometheus Metrics

```
# Intent metrics
intent_graph_intents_captured_total
intent_graph_intents_dormant_total
intent_graph_intents_fulfilled_total

# Nudge metrics
intent_graph_nudges_sent_total
intent_graph_nudges_converted_total

# Latency metrics
intent_graph_capture_latency_ms_avg
intent_graph_query_latency_ms_p99

# System metrics
intent_graph_process_memory_bytes
intent_graph_process_uptime_seconds
intent_graph_cache_entries
```

### Alerting Rules

```yaml
groups:
  - name: intent-graph
    rules:
      - alert: IntentGraphDown
        expr: up{job="intent-graph"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: Intent Graph is down

      - alert: IntentCaptureLatencyHigh
        expr: histogram_quantile(0.99, rate(intent_graph_capture_latency_ms_bucket[5m])) > 1000
        for: 5m
        labels:
          severity: warning
```

# Phase 5: Merchant Demand Signals

## Overview

Phase 5 provides **procurement intelligence** to merchants - real-time demand aggregation, gap analysis, and actionable insights to optimize inventory and pricing.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Merchant Demand Intelligence                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                   │
│  │  Consumer   │    │  Consumer   │    │  Consumer   │                   │
│  │  Intent:    │    │  Intent:    │    │  Intent:    │                   │
│  │  Biryani!   │    │  Goa Trip!  │    │  Sneakers!  │                   │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘                   │
│         │                   │                   │                           │
│         └───────────────────┼───────────────────┘                           │
│                             ▼                                               │
│  ┌───────────────────────────────────────────────────────┐                 │
│  │              Demand Signal Engine                      │                 │
│  │  • Aggregate intent signals                           │                 │
│  │  • Detect demand spikes                              │                 │
│  │  • Calculate unmet demand                            │                 │
│  │  • Generate procurement recommendations               │                 │
│  └──────────────────────┬──────────────────────────────┘                 │
│                         ▼                                                  │
│  ┌───────────────────────────────────────────────────────┐                 │
│  │              Merchant Dashboard API                    │                 │
│  │  • Real-time demand metrics                         │                 │
│  │  • Procurement signals                              │                 │
│  │  • Price expectations                              │                 │
│  │  • Location insights                                │                 │
│  │  • Trend analysis                                   │                 │
│  └───────────────────────────────────────────────────────┘                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Key Features

### 1. Demand Dashboard

Complete visibility into demand across categories:

```bash
GET /api/merchant/:merchantId/demand/dashboard

# Response
{
  "merchantId": "merchant_123",
  "categories": {
    "DINING": {
      "stats": {
        "totalIntents": 1250,
        "activeIntents": 340,
        "dormantIntents": 910,
        "recentActivity": 87
      },
      "signal": {
        "demandCount": 156,
        "unmetDemandPct": 28,
        "trend": "rising",
        "spikeDetected": false
      },
      "health": "good"
    }
  }
}
```

### 2. Procurement Signals

Identify inventory gaps and expansion opportunities:

```bash
GET /api/merchant/:merchantId/procurement?category=DINING

# Response
{
  "merchantId": "merchant_123",
  "totalMarketDemand": 15000,
  "avgUnmetDemand": "35%",
  "gaps": [
    {
      "type": "expand_inventory",
      "priority": "high",
      "demandCount": 234,
      "unmetDemand": "45%",
      "action": "Consider expanding inventory to capture 234 unmet demand",
      "expectedCapture": "80% conversion if addressed"
    }
  ],
  "seasonality": [
    { "month": 1, "expectedDemand": "1125 (-10%)" },
    { "month": 12, "expectedDemand": "2250 (+80%)", "isCurrentMonth": false }
  ]
}
```

### 3. Demand Trends

Track demand over time with bucket analysis:

```bash
GET /api/merchant/:merchantId/trends?period=7d

# Response
{
  "merchantId": "merchant_123",
  "period": "7d",
  "summary": {
    "totalSignals": 3420,
    "avgPerBucket": "489",
    "trendDirection": "rising",
    "changePct": "+15%"
  },
  "trend": [
    { "time": "2026-04-21T00:00:00Z", "search": 120, "view": 180, "wishlist": 45, "cart": 15, "total": 360 },
    { "time": "2026-04-22T00:00:00Z", "search": 135, "view": 195, "wishlist": 52, "cart": 18, "total": 400 }
  ]
}
```

### 4. Location Insights

Understand demand by geography:

```bash
GET /api/merchant/:merchantId/locations?category=DINING

# Response
{
  "merchantId": "merchant_123",
  "totalIntents": 1250,
  "locations": [
    { "rank": 1, "city": "Mumbai", "demandCount": 420, "demandPct": "33.6%" },
    { "rank": 2, "city": "Delhi", "demandCount": 380, "demandPct": "30.4%" },
    { "rank": 3, "city": "Bangalore", "demandCount": 290, "demandPct": "23.2%" }
  ]
}
```

### 5. Price Expectations

Get data-driven pricing insights:

```bash
GET /api/merchant/:merchantId/pricing?category=DINING

# Response
{
  "merchantId": "merchant_123",
  "priceExpectations": {
    "avgPrice": "299.50",
    "avgHighIntentPrice": "349.99",
    "sampleSize": 856,
    "recommendation": "Consider competitive pricing to capture high-intent users"
  }
}
```

### 6. Alert Configuration

Set up demand threshold alerts:

```bash
POST /api/merchant/:merchantId/alerts
{
  "category": "DINING",
  "threshold": 50,
  "webhookUrl": "https://merchant.example.com/webhooks/demand",
  "enabled": true
}
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/merchant/:id/demand/dashboard` | GET | Complete demand dashboard |
| `/api/merchant/:id/demand/signal` | GET | Real-time demand signal |
| `/api/merchant/:id/procurement` | GET | Procurement recommendations |
| `/api/merchant/:id/intents/top` | GET | Top performing intents |
| `/api/merchant/:id/trends` | GET | Demand trends over time |
| `/api/merchant/:id/locations` | GET | Demand by location |
| `/api/merchant/:id/pricing` | GET | Price expectations |
| `/api/merchant/:id/alerts` | POST | Configure demand alerts |

## Authentication

All merchant endpoints require either:

1. **Merchant JWT Token:**
   ```
   X-Merchant-Token: <merchant_jwt_token>
   ```

2. **Internal Service Token:**
   ```
   X-Internal-Token: <INTERNAL_SERVICE_TOKEN>
   ```

## Demand Signal Model

```typescript
interface MerchantDemandSignal {
  merchantId: string;
  category: string;
  demandCount: number;        // Aggregated demand signals
  unmetDemandPct: number;      // % of demand not fulfilled
  avgPriceExpectation: number;
  topCities: string[];         // Top demand locations
  trend: 'rising' | 'stable' | 'declining';
  spikeDetected: boolean;
  spikeFactor?: number;
  timestamp: Date;
}
```

## Procurement Recommendation Types

| Type | Priority | Description |
|------|----------|-------------|
| `expand_inventory` | high | High unmet demand, add capacity |
| `launch_category` | high | New category demand detected |
| `optimize_pricing` | medium | Price mismatch detected |
| `expand_location` | medium | Geographic expansion opportunity |
| `seasonal_prep` | low | Upcoming seasonality alert |

## Health Status

Dashboard health indicators:

| Status | Criteria |
|--------|----------|
| **excellent** | demandCount > 50 AND unmetDemandPct < 30% |
| **good** | demandCount > 20 AND unmetDemandPct < 50% |
| **moderate** | demandCount > 5 |
| **low** | demandCount <= 5 |

## Use Cases

### 1. Restaurant Owner
- "Which dishes should I add to my menu?"
- "Where should I open my next branch?"
- "Am I priced competitively?"

### 2. Hotel Manager
- "What destinations are trending?"
- "When should I launch a weekend special?"
- "Which cities have highest demand for my property type?"

### 3. Retailer
- "What products should I stock up on?"
- "Are my prices competitive?"
- "Which neighborhoods have underserved demand?"

## Integration with Other Phases

- **Phase 3**: Dormant intent revival → generates demand signals
- **Phase 4**: Agent insights → enrich demand understanding
- **Phase 5**: Merchant dashboard → actionable intelligence

## Next Steps

1. **Phase 6**: Real-time WebSocket updates for merchants
2. Automated procurement workflow integration
3. AI-powered demand forecasting with ML models

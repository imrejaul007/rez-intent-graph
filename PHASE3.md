# Phase 3: Dormant Intent Revival System

## Overview

Phase 3 implements the **Dormant Intent Revival Engine** - the predictive intelligence that reactivates unfulfilled purchase intentions through automated nudges.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Dormant Intent Revival Flow                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Intent Activity                                                 │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────┐     No activity     ┌─────────────┐                │
│  │  ACTIVE │ ──────────────────▶ │   DORMANT   │                │
│  └─────────┘     7+ days         └──────┬──────┘                │
│                                        │                        │
│                                        ▼                        │
│                               ┌─────────────────┐               │
│                               │ Calculate       │               │
│                               │ Revival Score   │               │
│                               └────────┬────────┘               │
│                                        │                        │
│                                        ▼                        │
│                               ┌─────────────────┐               │
│                               │ Score ≥ 0.3?    │──No──▶ Wait  │
│                               └────────┬────────┘               │
│                                        │Yes                      │
│                                        ▼                        │
│                               ┌─────────────────┐               │
│                               │ Queue Nudge     │               │
│                               │ Job             │               │
│                               └────────┬────────┘               │
│                                        │                        │
│                                        ▼                        │
│                               ┌─────────────────┐               │
│                               │ Deliver via     │               │
│                               │ Push/Email/SMS  │               │
│                               └────────┬────────┘               │
│                                        │                        │
│       ┌───────────────────────────────┴─────────────────────┐   │
│       │                                                       │   │
│       ▼                                                       ▼   │
│  ┌─────────┐                                            ┌─────────┐
│  │CONVERTED│                                            │DECLINED │
│  └─────────┘                                            └─────────┘
└─────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Dormant Intent Detection

**Cron Job** runs daily to detect intents that have been inactive for 7+ days:

```typescript
// Triggers daily at 6 AM
POST /api/intent/cron/detect-dormant

// Response
{
  "success": true,
  "data": {
    "processed": 1500,    // Total intents checked
    "markedDormant": 42   // New dormant intents
  }
}
```

### 2. Revival Score Calculation

Revival score is calculated based on:

| Factor | Weight | Description |
|--------|--------|-------------|
| Intent Strength | 40% | Original confidence score |
| Days Dormant | 25% | Longer = higher urgency |
| Category Affinity | 20% | User's affinity for category |
| Price Match | 15% | Current price vs. search price |

**Formula:**
```
revivalScore = (confidence × 0.4) + (min(daysDormant/30, 1) × 0.25) + (affinity/100 × 0.2) + priceMatchBonus
```

### 3. Trigger Events

Revival can be triggered by multiple events:

| Trigger | Bonus | Use Case |
|---------|-------|----------|
| **Price Drop** | +0.25 | Item price decreased |
| **Return User** | +0.15-0.25 | User returns after absence |
| **Seasonality** | +0.10-0.25 | Weekend/holiday alignment |
| **Offer Match** | +0.15-0.25 | Discount/cashback available |
| **Manual** | +0.05 | Agent-initiated |

```typescript
// Trigger examples
POST /api/intent/revival
{
  "dormantIntentId": "dormant_abc123",
  "triggerType": "price_drop",
  "triggerData": { "priceDropPct": 15 }
}
```

### 4. Nudge Delivery System

**Supported Channels:**
- Push Notification (via notification service)
- Email
- SMS
- In-App Message

**Message Templates:**

| Category | Template |
|----------|----------|
| TRAVEL | "Your {intent} search - still available!" |
| DINING | "Your {intent} cravings - satisfied!" |
| RETAIL | "{intent} is back in stock!" |

### 5. Nudge Queue

Priority-based queue system for managing nudge delivery:

```
nudge:priority:queue  ← Critical/High priority nudges
nudge:revival:queue   ← Medium/Low priority nudges
nudge:dead_letter:queue ← Failed nudges for retry
```

## API Endpoints

### Dormant Intent Management

```bash
GET  /api/intent/dormant/:userId         # Get user's dormant intents
GET  /api/intent/revival-candidates      # Get eligible revivals
GET  /api/intent/scheduled-revivals      # Get due nudges
POST /api/intent/revival                 # Trigger revival
POST /api/intent/revived/:id             # Mark as revived
POST /api/intent/pause/:id               # Pause nudges
```

### Nudge Management

```bash
GET  /api/intent/nudge/stats             # Queue and delivery stats
POST /api/intent/nudge/process           # Process scheduled nudges
POST /api/intent/nudge/send              # Manual nudge send
GET  /api/intent/nudge/history/:userId  # User's nudge history
PATCH /api/intent/nudge/:id/status       # Update nudge status
```

### Cron Jobs

```bash
POST /api/intent/cron/detect-dormant     # Run daily detection
POST /api/intent/cron/update-scores      # Update revival scores
```

## Database Models

### DormantIntent

```prisma
model DormantIntent {
  id              String    @id
  intentId        String
  userId          String
  category        String
  dormancyScore   Decimal   // How dormant (0-1)
  revivalScore    Decimal   // Urgency to revive (0-1)
  daysDormant     Int
  idealRevivalAt  DateTime? // Best time to nudge
  status          String    // active, paused, revived
}
```

### Nudge

```prisma
model Nudge {
  id               String    @id
  dormantIntentId  String
  userId           String
  channel          String    // push, email, sms
  message          String
  status           String    // pending, sent, delivered, clicked, converted, failed
  sentAt           DateTime?
  convertedAt      DateTime?
}
```

## Integration with Other Services

### Notification Service (Phase 2)

Nudges are delivered via the notification service:

```typescript
import { sendUserNotification } from './integrations/external-services.js';

await sendUserNotification(
  userId,
  'ReZ Mind',
  'Your Goa trip is waiting!',
  { intentKey: 'goa_weekend', category: 'TRAVEL' }
);
```

### Webhook Events

Track nudge lifecycle via webhooks:

```bash
POST /api/webhooks/nudge/delivered
POST /api/webhooks/nudge/clicked
POST /api/webhooks/nudge/converted
```

## Testing

```bash
# Run dormant intent detection
curl -X POST http://localhost:3005/api/intent/cron/detect-dormant \
  -H "X-Cron-Secret: your-secret"

# Send test nudge
curl -X POST http://localhost:3005/api/intent/nudge/send \
  -H "Content-Type: application/json" \
  -d '{"userId": "user123", "intentKey": "goa_beach", "message": "Goa deals!")'

# Get nudge stats
curl http://localhost:3005/api/intent/nudge/stats
```

## Metrics & Monitoring

Key metrics to track:

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Conversion Rate | >5% | <2% |
| Avg Revival Score | >0.5 | <0.3 |
| Queue Size | <1000 | >5000 |
| Delivery Success | >95% | <80% |

## Next Steps

1. **Phase 3.1**: Add A/B testing for nudge templates
2. **Phase 3.2**: Machine learning for optimal timing
3. **Phase 3.3**: Multi-touch attribution for conversions

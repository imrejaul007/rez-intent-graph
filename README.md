# ReZ Mind

**AI-powered commerce intelligence platform** — RTMN Commerce Memory + ReZ Agent OS combined.

Tracks user purchase intent across the ReZ ecosystem (hotel, restaurant, retail apps), detects dormant intents, orchestrates revival nudges, and runs 8 autonomous AI agents.

## Quick Start

```bash
git clone <repo>
cd packages/rez-intent-graph
cp .env.example .env    # fill in MONGODB_URI
npm install
npm run build
npm start              # API server on port 3001
```

## Source of Truth

All external service URLs are centralized in [src/config/services.ts](src/config/services.ts). Do not hardcode URLs anywhere else — update them there and override via env vars.

## Environment Variables

Copy `.env.example` to `.env` and set these:

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URI` | **Yes** | MongoDB Atlas connection string |
| `PORT` | No | API server port (default: 3001) |
| `AGENT_PORT` | No | Agent server port (default: 3005) |
| `INTERNAL_SERVICE_TOKEN` | Prod | Server-to-server auth token |
| `INTENT_WEBHOOK_SECRET` | Prod | Webhook signature verification |
| `INTENT_CRON_SECRET` | Prod | Cron job authentication |
| `ALLOWED_ORIGINS` | No | Comma-separated CORS origins |
| `REDIS_URL` | No | Redis for distributed memory (falls back to in-memory) |
| `REZ_DANGEROUS_MODE` | No | Set `true` to auto-enable dangerous mode |

## Servers

### API Server (port 3001)
```bash
npm run start
# or for dev:
npx tsx src/server/server.ts
```

### Agent Swarm Server (port 3005)
```bash
npx tsx src/server/agent-server.ts
```

## API Endpoints

### Intent Capture
```
POST   /api/intent/capture              Capture intent signal
GET    /api/intent/active/:userId       Get active intents
GET    /api/intent/dormant/:userId      Get dormant intents
POST   /api/intent/revive               Trigger revival
GET    /api/intent/user/:userId         Get all user intents
GET    /api/intent/stats                Aggregate stats
POST   /api/intent/trigger              Fire revival trigger
POST   /api/intent/nudge/send           Send a nudge
```

### Commerce Memory
```
GET    /api/commerce-memory/user/:userId   Full enriched context
GET    /api/commerce-memory/affinity/:userId  Affinity profile
POST   /api/commerce-memory/sync/:userId    Sync cross-app profile
GET    /api/commerce-memory/dashboard        Summary stats
```

### Merchant Demand
```
GET    /api/merchant/:id/demand/dashboard   Demand overview
GET    /api/merchant/:id/demand/signal      Real-time signal
GET    /api/merchant/:id/procurement        Procurement signals
GET    /api/merchant/:id/intents/top        Top intents
GET    /api/merchant/:id/trends             Demand trends
GET    /api/merchant/:id/locations          City insights
GET    /api/merchant/:id/pricing            Price expectations
POST   /api/merchant/:id/alerts            Configure alerts
```

### Webhooks
```
POST   /webhooks/hotel/search             Hotel search event
POST   /webhooks/hotel/hold              Booking hold event
POST   /webhooks/hotel/confirm           Booking confirmed
POST   /webhooks/restaurant/view         Restaurant view
POST   /webhooks/restaurant/add-to-cart  Add to cart
POST   /webhooks/restaurant/order         Order placed
POST   /webhooks/nudge/delivered         Nudge delivery callback
POST   /webhooks/nudge/clicked           Nudge click callback
POST   /webhooks/nudge/converted         Nudge conversion callback
POST   /webhooks/batch/capture           Batch capture
```

### Autonomous Mode (Agent Server, port 3005)
```
POST   /api/autonomous/start              Enable full autonomy
POST   /api/autonomous/stop              Disable autonomy
POST   /api/autonomous/action            Execute dangerous action
POST   /api/autonomous/emergency-stop    Emergency stop
GET    /api/autonomous/status            Get status
```

### Agent Tools
```
GET    /api/agent/tools                   List available tools
POST   /api/agent/tools/execute           Execute a tool
GET    /api/agent/intents/:userId        Get active intents
GET    /api/agent/dormant/:userId        Get dormant intents
GET    /api/agent/enrich/:userId         Get enriched context
```

### Knowledge & Chat
```
POST   /api/knowledge                     Create knowledge entry
GET    /api/knowledge/search              Search knowledge base
POST   /api/chat/message                  Send chat message
GET    /api/chat/history/:userId         Chat history
```

### Health & Monitoring
```
GET    /health                            Service health
GET    /api/monitoring/health             Detailed health
GET    /api/monitoring/metrics           Metrics
GET    /api/monitoring/alerts            Active alerts
GET    /api/services/health              External services
```

## WebSocket (port 3005)

Connect to `/ws`. Subscribe to channels:

```
intent:user:{userId}         User intent updates
intent:merchant:{merchantId}  Merchant demand updates
intent:global                 Global statistics
agent:events                 Agent lifecycle events
nudge:user:{userId}          Nudge delivery events
commerce:memory:{userId}      Commerce memory updates
```

## 8 Autonomous Agents

| Agent | Schedule | Purpose |
|---|---|---|
| DemandSignalAgent | Every 5 min | Aggregate demand per merchant/category |
| ScarcityAgent | Every 1 min | Supply/demand ratios, urgency alerts |
| PersonalizationAgent | Event-driven | User response profiling, A/B testing |
| AttributionAgent | Event-driven | Multi-touch conversion attribution |
| AdaptiveScoringAgent | Hourly | ML retraining of intent scoring |
| FeedbackLoopAgent | Event-driven | Closed-loop optimization, drift detection |
| NetworkEffectAgent | Daily | Collaborative filtering, user similarity |
| RevenueAttributionAgent | Every 15 min | GMV tracking, ROI per agent/nudge |

## Tests

```bash
npm run test:smoke       # Quick smoke test (5 checks)
npm run test:agents      # Full agent integration test
```

## Docker

```bash
docker build -t rez-intent-graph .
docker run -p 3001:3001 \
  -e MONGODB_URI="your-connection-string" \
  -e REZ_DANGEROUS_MODE=false \
  rez-intent-graph
```

## Database

Uses MongoDB Atlas. Collections (indexes auto-created at startup):

| Collection | Purpose |
|---|---|
| `intents` | User intent records |
| `dormantintents` | Dormant purchase tracking |
| `intentsequences` | Event sequence tracking |
| `crossappintentprofiles` | Cross-app user profiles |
| `merchantknowledge` | Merchant knowledge base |
| `nudges` | Nudge delivery records |
| `nudgescheduiles` | User nudge preferences |
| `merchantdemandsignals` | Aggregated demand |

## Architecture

```
┌─────────────────────────────────────────────────┐
│              ReZ Mind Intent Graph               │
├─────────────────────────────────────────────────┤
│  IntentCaptureService → Intent (MongoDB)       │
│  DormantIntentService → DormantIntent (MongoDB) │
│  CrossAppAggregation → CrossAppIntentProfile    │
│                                                 │
│  SwarmCoordinator → 8 Autonomous Agents         │
│  ├── DemandSignalAgent                          │
│  ├── ScarcityAgent                              │
│  ├── PersonalizationAgent                       │
│  ├── AttributionAgent                           │
│  ├── AdaptiveScoringAgent                       │
│  ├── FeedbackLoopAgent                          │
│  ├── NetworkEffectAgent                         │
│  └── RevenueAttributionAgent                    │
│                                                 │
│  ActionTrigger → 17 Action Types               │
│  SharedMemory → Redis / In-Memory              │
│  WebSocket Server → Real-time subscriptions    │
└─────────────────────────────────────────────────┘
```

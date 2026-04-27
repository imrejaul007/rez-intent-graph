# Phase 4: Agent OS Integration

## Overview

Phase 4 connects **ReZ Mind** to the **Agent OS** for intelligent commerce assistance. The Intent Graph provides memory capabilities to 8 autonomous agents, enabling personalized, context-aware AI actions.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ReZ Mind Agent OS Integration                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                   │
│  │   Hotel OTA │    │  Restaurant  │    │   Retail    │                   │
│  │     App     │    │     App      │    │     App      │                   │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘                   │
│         │                   │                   │                          │
│         └───────────────────┼───────────────────┘                          │
│                             │                                              │
│                             ▼                                              │
│  ┌───────────────────────────────────────────────────────┐                 │
│  │              Intent Graph Memory Layer                  │                 │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │                 │
│  │  │ Active       │ │ Dormant     │ │ Cross-App    │   │                 │
│  │  │ Intents      │ │ Intents     │ │ Profile      │   │                 │
│  │  └──────────────┘ └──────────────┘ └──────────────┘   │                 │
│  └──────────────────────┬────────────────────────────────┘                 │
│                         │                                                  │
│                         ▼                                                  │
│  ┌───────────────────────────────────────────────────────┐                 │
│  │              Agent Swarm (8 Agents)                    │                 │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐    │                 │
│  │  │ Demand  │ │ Scarcity│ │ Perso-  │ │ Attri-  │    │                 │
│  │  │ Signal  │ │         │ │ nalize  │ │ bution  │    │                 │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘    │                 │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐    │                 │
│  │  │Adaptive │ │ Feedback│ │ Network │ │ Revenue │    │                 │
│  │  │ Scoring │ │ Loop    │ │ Effect  │ │ Attrib  │    │                 │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘    │                 │
│  └───────────────────────────────────────────────────────┘                 │
│                             │                                              │
│                             ▼                                              │
│  ┌───────────────────────────────────────────────────────┐                 │
│  │           Autonomous Orchestrator                     │                 │
│  │   Dangerous Mode • Skip Permission • Full Autonomy    │                 │
│  └───────────────────────────────────────────────────────┘                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Agent Tools

Agents can access user intent data through these tools:

| Tool | Description |
|------|-------------|
| `get_user_intents` | Get active intents for personalization |
| `get_dormant_intents` | Get dormant intents for revival suggestions |
| `get_enriched_context` | Get comprehensive context (intents + affinities + suggestions) |
| `record_agent_insight` | Record agent insight for future reference |
| `suggest_intent_revive` | Get nudge suggestion for a dormant intent |
| `get_cross_app_profile` | Get user affinities across categories |
| `score_intent` | Calculate revival score for an intent |
| `trigger_revival` | Trigger revival with specific trigger type |

## Enriched Context

The enriched context provides agents with:

```typescript
interface EnrichedContext {
  userId: string;
  activeIntents: IntentSummary[];      // What user is currently interested in
  dormantIntents: DormantIntentSummary[]; // Past interests to revive
  suggestedNudges: NudgeSuggestion[];    // Recommended nudge messages
  affinities: AffinityScores;           // Category preferences
  recentActivity: ActivityEvent[];       // Recent user actions
  agentInsights: AgentInsight[];         // Past agent observations
}
```

## API Endpoints

### Agent Tools

```bash
# List available tools
GET /api/agent/tools

# Execute a tool
POST /api/agent/tools/execute
{
  "toolName": "get_enriched_context",
  "params": { "userId": "user_123" }
}
```

### Intent Memory

```bash
# Get active intents
GET /api/agent/intents/:userId

# Get dormant intents
GET /api/agent/dormant/:userId

# Get cross-app profile
GET /api/agent/profile/:userId

# Get enriched context
GET /api/agent/enrich/:userId

# Record agent insight
POST /api/agent/insight
{
  "userId": "user_123",
  "agentId": "personalization-agent",
  "insight": "User prefers premium hotels on weekends"
}

# Clear user cache
POST /api/agent/cache/invalidate/:userId
```

## Integration with Agents

### Personalization Agent

Uses enriched context to personalize recommendations:

```typescript
// Agent calls intent memory
const context = await intentGraphMemory.enrichContext(userId);

// Uses active intents for recommendations
const recommendations = context.activeIntents.map(intent => ({
  category: intent.category,
  key: intent.intentKey,
  confidence: intent.confidence,
}));
```

### Demand Signal Agent

Aggregates demand from dormant intents:

```typescript
// Get dormant intents for category
const dormant = await intentGraphMemory.getDormantIntents(userId);
const categoryDemand = dormant
  .filter(d => d.category === 'DINING')
  .map(d => d.intentKey);
```

### Attribution Agent

Records agent insights for multi-touch attribution:

```typescript
// Record insight after agent action
await intentGraphMemory.recordAgentInsight(
  userId,
  'demand-signal-agent',
  'Suggested restaurant based on dormant dining intent'
);
```

## 8 Autonomous Agents

| Agent | Purpose | Dangerous Actions |
|-------|---------|-------------------|
| **DemandSignalAgent** | Aggregate consumer demand | Update merchant dashboard |
| **ScarcityAgent** | Detect inventory scarcity | Trigger price adjustments |
| **PersonalizationAgent** | Personalize user experience | Send nudges |
| **AttributionAgent** | Track conversion attribution | - |
| **AdaptiveScoringAgent** | ML-based intent scoring | Adjust scoring weights |
| **FeedbackLoopAgent** | Monitor agent health | Trigger alerts |
| **NetworkEffectAgent** | Collaborative filtering | Trigger cohort campaigns |
| **RevenueAttributionAgent** | Track revenue | - |

## Autonomous Mode

Agents can operate in **full autonomous mode** with skip-permission:

```bash
# Enable autonomous mode
POST /api/autonomous/start

# Execute dangerous action
POST /api/autonomous/action
{
  "actionType": "adjust_price",
  "agentName": "scarcity-agent",
  "payload": { "merchantId": "m123", "adjustment": 10 }
}

# Emergency stop
POST /api/autonomous/emergency-stop
```

## Memory Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Shared Memory (Redis)                     │
├─────────────────────────────────────────────────────────────┤
│  Demand Signals   │ Scarcity Signals │ User Profiles       │
│  ───────────────  │ ────────────────│ ────────────────    │
│  demand:merchant  │ scarcity:merchant│ profiles:userId    │
│  demand:category  │ scarcity:critical │ insights:userId    │
│                                                             │
│  Revalidation: Real-time via Prisma                        │
│  Fallback: In-memory Map if Redis unavailable              │
└─────────────────────────────────────────────────────────────┘
```

## Testing

```bash
# List agent tools
curl http://localhost:3005/api/agent/tools

# Get enriched context
curl http://localhost:3005/api/agent/enrich/user_123

# Execute tool
curl -X POST http://localhost:3005/api/agent/tools/execute \
  -H "Content-Type: application/json" \
  -d '{"toolName": "get_user_intents", "params": {"userId": "user_123"}}'

# Get swarm status
curl http://localhost:3005/api/swarm/status

# Run single agent
curl -X POST http://localhost:3005/api/swarm/run/demand-signal-agent
```

## Next Steps

1. **Phase 5**: Demand Signals for merchants (procurement)
2. Add WebSocket support for real-time agent updates
3. Add metrics and alerting for agent performance
4. Add distributed tracing across agents

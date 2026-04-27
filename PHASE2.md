# Phase 2: Real Service Integration

## Overview

Phase 2 connects **ReZ Mind** to the actual backend services in the ReZ ecosystem.

## Service Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ ReZ Mind │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ External Services Integration Layer │ │
│ │ • HTTP Client (retry + circuit breaker) │ │
│ │ • Wallet │ │
│ │ • Order │ │
│ │ • Notification │ │
│ │ • Merchant │ │
│ │ • PMS │ │
│ └─────────────────────────────────────────────────────┘ │
└────────────────────────┬────────────────────────────────────┘
 │
 ▼
┌─────────────────────────────────────────────────────────────┐
│ Backend Services │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│ │ Wallet │ │ Order │ │ Notif │ │ Merchant │ │
│ │ Service │ │ Service │ │ Service │ │ Service │ │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Services Integrated

| Service | Purpose | Connection |
|---------|---------|------------|
| **Wallet Service** | Coin debit/credit, balance | HTTP |
| **Order Service** | Order creation, status updates | HTTP |
| **Notification Service** | Push notifications | Pub/Sub |
| **Merchant Service** | Merchant operations | Pub/Sub |
| **PMS Service** | Property management | Pub/Sub |
| **Task Queue** | Operational tasks | Pub/Sub |

## Service URLs

```bash
# Environment Variables (from SOURCE-OF-TRUTH/ENV-VARS.md)
WALLET_SERVICE_URL=https://rez-wallet-service-36vo.onrender.com
MONOLITH_URL=https://rez-backend-8dfu.onrender.com
ORDER_SERVICE_URL=https://rez-order-service-hz18.onrender.com
PAYMENT_SERVICE_URL=https://rez-payment-service.onrender.com
MERCHANT_SERVICE_URL=https://rez-merchant-service-n3q2.onrender.com
NOTIFICATION_SERVICE_URL=https://rez-notification-events-mwdz.onrender.com
AUTH_SERVICE_URL=https://rez-auth-service.onrender.com
CATALOG_SERVICE_URL=https://rez-catalog-service-1.onrender.com
SEARCH_SERVICE_URL=https://rez-search-service.onrender.com
MARKETING_SERVICE_URL=https://rez-marketing-service.onrender.com
GAMIFICATION_SERVICE_URL=https://rez-gamification-service-3b5d.onrender.com
ADS_SERVICE_URL=https://rez-ads-service.onrender.com
ANALYTICS_SERVICE_URL=https://analytics-events-37yy.onrender.com
INTERNAL_SERVICE_TOKEN=<GET FROM RENDER>
```

## API Endpoints Added

### Service Health

```bash
GET /api/services/health # All service health
GET /api/services/health/:service # Single service health
POST /api/services/circuit-breaker/reset/:service # Reset circuit breaker
POST /api/services/circuit-breaker/open/:service # Force open circuit
```

### Wallet Operations

```bash
GET /api/wallet/:userId/balance # Get wallet balance
POST /api/wallet/charge # Charge user wallet
POST /api/wallet/credit # Credit user wallet
```

### Order Operations

```bash
POST /api/orders/create # Create order
PATCH /api/orders/:orderId/status # Update order status
```

### Room Service Flow

```bash
POST /api/room-service/execute # Complete room QR flow
```

### Shopping Flow

```bash
POST /api/shopping/execute # Complete shopping flow
```

## Circuit Breaker Pattern

Each service has its own circuit breaker:

```
CLOSED → Normal operation
  ↓ (5 failures)
OPEN → Block requests for 60 seconds
  ↓ (timeout)
HALF-OPEN → Allow test requests
  ↓ (2 successes)
CLOSED → Resume normal operation
```

### Circuit Breaker Status

```bash
GET /api/services/circuit-breaker/status
```

Response:
```json
{
  "services": [
    { "name": "wallet", "status": "closed", "failures": 0 },
    { "name": "order", "status": "open", "failures": 5 },
    { "name": "notification", "status": "closed", "failures": 0 }
  ]
}
```

## Retry Strategy

Failed requests are retried with exponential backoff:

```
Attempt 1: Immediate
Attempt 2: 100ms delay
Attempt 3: 200ms delay
Attempt 4: 400ms delay (max)
```

## Complete Flows

### Room QR Flow

```
1. Charge wallet (if payable items)
2. Submit PMS guest request
3. Create operational task
4. Send staff notification
5. Update memory
```

### Shopping Flow

```
1. Charge wallet
2. Create order
3. Send to merchant OS
4. Update memory
```

## Testing

```bash
# Run Phase 2 integration tests (tests against production services)
npx tsx src/test/phase2-integration-test.ts

# Run smoke tests
npm run test:smoke

# Run agent tests
npm run test:agents
```

## Service Availability

When a service is unavailable:
1. Circuit breaker opens after 5 failures
2. Requests are blocked for 60 seconds
3. Fallback to cached data where available
4. Error logged for monitoring

## Authentication

All service-to-service calls require the `X-Internal-Token` header:
```bash
X-Internal-Token: <INTERNAL_SERVICE_TOKEN>
```

This token is configured in the `rez-core` Render environment group and must be set for ReZ Mind to communicate with other services.

## Monitoring

```bash
# Check all service health (via agent server)
curl https://rez-intent-graph.onrender.com/api/services/health

# Check circuit breaker status
curl https://rez-intent-graph.onrender.com/api/services/circuit-breaker/status
```

## Next Steps

1. Add more services (Auth, Catalog, Search)
2. Add WebSocket support for real-time updates
3. Add metrics and alerting
4. Add distributed tracing

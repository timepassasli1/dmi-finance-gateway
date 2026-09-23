# Architecture

## System Layers

1. **Platform Admin** — Controls everything: onboards clients, configures processing merchants, monitors all transactions
2. **Clients** — Independent businesses with API credentials, see only their own data
3. **Processing Merchants** — Payment processing backends configured by admin; credentials never exposed to clients

## Payment Flow

```
Client Website
  └── Gateway SDK (pk_live_)
       └── Your Server (sk_live_) → POST /v1/orders
                                  → POST /v1/orders/:id/pay
                                  → GET  /v1/payments/:id
                                  → POST /v1/payments/:id/verify
                                         │
                                    Verification Engine
                                         │
                                    Provider Abstraction
                                         │
                                    UPI / Payment Network
                                         │
                                    Webhook → Client Backend
```

## State Machine

```
CREATED → PENDING → SUCCESS → REFUND_PENDING → REFUNDED
              ↓→ FAILED
              ↓→ EXPIRED
              ↓→ PENDING_REVIEW → SUCCESS | FAILED
```

## Tenant Isolation

Every database query is scoped by `client_id`:
```sql
SELECT * FROM payments WHERE id = $1 AND client_id = $2
```

`client_id` is always derived from the authenticated API key or JWT — never accepted from frontend input.

## Verification Engine

Payment is finalized **only** when:
1. Provider confirms payment amount matches order amount
2. Transaction reference is unique (no duplicate processing)
3. Payment is in PENDING state (valid transition)
4. DB transaction successfully atomically: updates payment + credits wallet + records ledger

## Verification Agent

A separately deployable service that:
- Registers with the gateway
- Sends heartbeats every 30s
- Consumes authorized transaction feeds
- Submits verification events
- Never uses screen scraping, CAPTCHA bypass, or unauthorized automation

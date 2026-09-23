# UPI Gateway Platform

A production-structured, multi-tenant UPI payment gateway platform.

## Architecture

```
PLATFORM ADMIN
     │
     ├── CLIENTS (independent businesses)
     │        │
     │        └── Gateway SDK → Orders → Payments
     │
     └── PROCESSING MERCHANTS (configured by admin)
              │
              └── Provider Abstraction → UPI
```

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Go 1.23+ (for local development)
- Node.js 20+ (for local development)

### Run with Docker Compose

```bash
cp .env.example .env
# Edit .env if needed

docker compose up --build
```

Services will be available at:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8080
- **Admin Login**: admin@gateway.local / Admin@123456

**Production:** API base `https://gpzes.com/gw` · App `https://gpzes.com` · Integration guide in dashboard → Integration.

### Local Development (without Docker)

**Backend:**
```bash
cd backend
go mod tidy
go run ./cmd/server
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

**Verification Agent:**
```bash
cd verification-agent
go mod tidy
go run ./cmd
```

## Complete Flow Test

```bash
# 1. Login as admin
curl -X POST http://localhost:8080/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@gateway.local","password":"Admin@123456"}'

# 2. Create a processing merchant (use admin token)
curl -X POST http://localhost:8080/v1/admin/processing-merchants \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"merchant_code":"PM_001","display_name":"Primary Merchant","provider":"mock"}'

# 3. Register a client (or use the UI at http://localhost:3000/auth/register)
curl -X POST http://localhost:8080/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"client@test.com","password":"Test@12345","business_name":"Test Business","legal_name":"Test Pvt Ltd"}'

# 4. Approve client (admin)
curl -X POST http://localhost:8080/v1/admin/clients/<client_id>/approve \
  -H "Authorization: Bearer <admin_token>"

# 5. Assign processing merchant to client
curl -X POST http://localhost:8080/v1/admin/routes \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"client_id":"<client_id>","processing_merchant_id":"<merchant_id>","priority":1}'

# 6. Generate API keys for client (admin)
curl -X POST http://localhost:8080/v1/admin/clients/<client_id>/api-keys \
  -H "Authorization: Bearer <admin_token>"

# 7. Create an order (client backend, use sk_live_ key)
curl -X POST http://localhost:8080/v1/orders \
  -H "Authorization: Bearer sk_live_<secret_key>" \
  -H "Content-Type: application/json" \
  -d '{"order_id":"ORDER_001","amount":50000,"currency":"INR","customer":{"name":"Test","email":"test@test.com","phone":"9999999999"}}'

# 8. Initiate payment
curl -X POST http://localhost:8080/v1/orders/<gateway_order_id>/pay \
  -H "Authorization: Bearer sk_live_<secret_key>"

# 9. Open payment page in browser
open http://localhost:3000/pay/<gateway_payment_id>

# 10. Simulate success (dev only)
curl -X POST http://localhost:8080/dev/mock/set-state \
  -d '{"state":"success"}'

# 11. Verify payment (client backend — status poll; SUCCESS only after real UPI confirm)
# On production mock rails this returns PENDING until the Paytm extension matches GWxxxxxxxx.
curl -X POST http://localhost:8080/v1/payments/<gateway_payment_id>/verify \
  -H "Authorization: Bearer sk_live_<secret_key>" \
  -H "Content-Type: application/json" \
  -d '{"gateway_payment_id":"<gateway_payment_id>"}'
```

## Mock Payment States (Development Only)

```bash
# Set mock state before triggering verification
curl -X POST http://localhost:8080/dev/mock/set-state -d '{"state":"success"}'
curl -X POST http://localhost:8080/dev/mock/set-state -d '{"state":"failed"}'
curl -X POST http://localhost:8080/dev/mock/set-state -d '{"state":"amount_mismatch"}'
curl -X POST http://localhost:8080/dev/mock/set-state -d '{"state":"pending"}'
```

## Run Tests

```bash
cd backend
go test ./...
```

## Environment Variables

See `.env.example` for all configuration options.

## Security Notes

- **Never expose `sk_live_` keys in browser JavaScript**
- All payment finalization requires server-to-server verification
- The wallet/ledger is an accounting representation, not a bank account
- Tenant isolation: every query is scoped by `client_id`
- All credentials are encrypted at rest (AES-256-GCM)
- Webhook payloads are signed with HMAC-SHA256

## Project Structure

```
gateway-platform/
├── backend/              # Go API server
│   ├── cmd/server/       # Entry point
│   ├── internal/         # Domain packages
│   ├── migrations/       # PostgreSQL migrations
│   └── pkg/              # Shared packages
├── frontend/             # Next.js dashboard
├── sdk/                  # Browser SDK
├── verification-agent/   # Verification agent
├── docs/                 # Documentation
└── docker/               # Nginx configuration
```

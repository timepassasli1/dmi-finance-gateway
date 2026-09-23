-- +goose Up
-- +goose StatementBegin

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users (platform admin + client users)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20),
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('PLATFORM_ADMIN', 'CLIENT_ADMIN', 'CLIENT_STAFF')),
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')),
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Clients
CREATE TABLE clients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_code VARCHAR(20) UNIQUE NOT NULL,
    business_name VARCHAR(255) NOT NULL,
    legal_name VARCHAR(255) NOT NULL,
    website_url VARCHAR(500),
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'UNDER_REVIEW', 'ACTIVE', 'SUSPENDED', 'REJECTED')),
    kyc_status VARCHAR(50) NOT NULL DEFAULT 'NOT_SUBMITTED'
        CHECK (kyc_status IN ('NOT_SUBMITTED', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED')),
    risk_status VARCHAR(50) NOT NULL DEFAULT 'LOW'
        CHECK (risk_status IN ('LOW', 'MEDIUM', 'HIGH', 'BLOCKED')),
    settlement_account JSONB,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_clients_status ON clients(status);
CREATE INDEX idx_clients_kyc_status ON clients(kyc_status);

-- Client Users (many-to-one clients)
CREATE TABLE client_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (client_id, user_id)
);

CREATE INDEX idx_client_users_client ON client_users(client_id);
CREATE INDEX idx_client_users_user ON client_users(user_id);

-- Client Documents
CREATE TABLE client_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    document_type VARCHAR(100) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size INT,
    mime_type VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED')),
    rejection_reason TEXT,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES users(id)
);

CREATE INDEX idx_documents_client ON client_documents(client_id);

-- Client API Keys
CREATE TABLE client_api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    key_name VARCHAR(100) NOT NULL,
    client_key VARCHAR(30) NOT NULL UNIQUE,   -- CL_XXXXXX
    public_key VARCHAR(80) NOT NULL UNIQUE,   -- pk_live_xxx
    secret_key_hash VARCHAR(255) NOT NULL,    -- bcrypt hash
    secret_key_prefix VARCHAR(20) NOT NULL,   -- sk_live_xxxx (first chars for display)
    webhook_secret VARCHAR(255) NOT NULL,     -- stored encrypted
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_api_keys_client ON client_api_keys(client_id);
CREATE INDEX idx_api_keys_public ON client_api_keys(public_key);

-- Processing Merchants (controlled by platform admin)
CREATE TABLE processing_merchants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_code VARCHAR(30) UNIQUE NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    provider VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')),
    supported_currencies TEXT[] NOT NULL DEFAULT ARRAY['INR'],
    daily_limit BIGINT DEFAULT 0,
    transaction_limit BIGINT DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Processing Merchant Credentials (encrypted, never exposed to clients)
CREATE TABLE processing_merchant_credentials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES processing_merchants(id) ON DELETE CASCADE,
    credential_type VARCHAR(100) NOT NULL,
    encrypted_value TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Client Processing Routes
CREATE TABLE client_processing_routes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    processing_merchant_id UUID NOT NULL REFERENCES processing_merchants(id),
    priority INT NOT NULL DEFAULT 1,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    daily_limit BIGINT DEFAULT 0,
    transaction_limit BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (client_id, processing_merchant_id)
);

CREATE INDEX idx_routes_client ON client_processing_routes(client_id, status, priority);

-- Orders
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    gateway_order_id VARCHAR(30) UNIQUE NOT NULL,
    client_id UUID NOT NULL REFERENCES clients(id),
    client_order_id VARCHAR(255) NOT NULL,
    amount BIGINT NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    customer_name VARCHAR(255),
    customer_email VARCHAR(255),
    customer_phone VARCHAR(20),
    status VARCHAR(50) NOT NULL DEFAULT 'CREATED'
        CHECK (status IN ('CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'EXPIRED')),
    metadata JSONB DEFAULT '{}',
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 minutes',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (client_id, client_order_id)
);

CREATE INDEX idx_orders_client ON orders(client_id);
CREATE INDEX idx_orders_gateway_id ON orders(gateway_order_id);

-- Payments
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    gateway_payment_id VARCHAR(30) UNIQUE NOT NULL,
    order_id UUID NOT NULL REFERENCES orders(id),
    client_id UUID NOT NULL REFERENCES clients(id),
    processing_merchant_id UUID REFERENCES processing_merchants(id),
    amount BIGINT NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    status VARCHAR(50) NOT NULL DEFAULT 'CREATED'
        CHECK (status IN ('CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'EXPIRED', 'PENDING_REVIEW', 'REFUND_PENDING', 'REFUNDED')),
    provider_payment_id VARCHAR(255),
    provider_transaction_id VARCHAR(255),
    provider_transaction_ref VARCHAR(255),
    upi_id VARCHAR(255),
    payment_method VARCHAR(50),
    failure_reason TEXT,
    metadata JSONB DEFAULT '{}',
    finalized_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_client ON payments(client_id);
CREATE INDEX idx_payments_order ON payments(order_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_provider_ref ON payments(provider_transaction_ref) WHERE provider_transaction_ref IS NOT NULL;

-- Payment Attempts
CREATE TABLE payment_attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_id UUID NOT NULL REFERENCES payments(id),
    status VARCHAR(50) NOT NULL,
    provider_response JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Payment Events
CREATE TABLE payment_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_id UUID NOT NULL REFERENCES payments(id),
    event_type VARCHAR(100) NOT NULL,
    source VARCHAR(100),
    data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_events_payment ON payment_events(payment_id);

-- Verification Events
CREATE TABLE verification_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_id UUID REFERENCES payments(id),
    agent_id UUID,
    source VARCHAR(100),
    provider VARCHAR(100),
    provider_transaction_ref VARCHAR(255),
    amount BIGINT,
    currency VARCHAR(10),
    status VARCHAR(50),
    result VARCHAR(50),
    raw_data JSONB,
    idempotency_key VARCHAR(255) UNIQUE,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_verification_events_ref ON verification_events(provider_transaction_ref);
CREATE INDEX idx_verification_events_payment ON verification_events(payment_id);

-- Wallet Accounts
CREATE TABLE wallet_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL REFERENCES clients(id) UNIQUE,
    available_balance BIGINT NOT NULL DEFAULT 0,
    pending_balance BIGINT NOT NULL DEFAULT 0,
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'FROZEN', 'CLOSED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Wallet Ledger (append-only)
CREATE TABLE wallet_ledger (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL REFERENCES clients(id),
    wallet_id UUID NOT NULL REFERENCES wallet_accounts(id),
    payment_id UUID REFERENCES payments(id),
    entry_type VARCHAR(50) NOT NULL CHECK (entry_type IN ('CREDIT', 'DEBIT', 'HOLD', 'RELEASE', 'REFUND')),
    amount BIGINT NOT NULL,
    balance_before BIGINT NOT NULL,
    balance_after BIGINT NOT NULL,
    reference VARCHAR(255),
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ledger_client ON wallet_ledger(client_id, created_at DESC);
CREATE INDEX idx_ledger_payment ON wallet_ledger(payment_id);

-- Refunds
CREATE TABLE refunds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    refund_id VARCHAR(30) UNIQUE NOT NULL,
    payment_id UUID NOT NULL REFERENCES payments(id),
    client_id UUID NOT NULL REFERENCES clients(id),
    amount BIGINT NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    reason TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED')),
    provider_refund_id VARCHAR(255),
    provider_reference VARCHAR(255),
    initiated_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refunds_payment ON refunds(payment_id);
CREATE INDEX idx_refunds_client ON refunds(client_id);

-- Settlements
CREATE TABLE settlements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    settlement_id VARCHAR(30) UNIQUE NOT NULL,
    client_id UUID NOT NULL REFERENCES clients(id),
    amount BIGINT NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
    provider_reference VARCHAR(255),
    bank_reference VARCHAR(255),
    period_start TIMESTAMPTZ,
    period_end TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Webhook Endpoints
CREATE TABLE webhooks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    url VARCHAR(500) NOT NULL,
    events TEXT[] NOT NULL DEFAULT ARRAY['payment.success', 'payment.failed', 'payment.pending'],
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    secret_encrypted TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Webhook Deliveries
CREATE TABLE webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    webhook_id UUID NOT NULL REFERENCES webhooks(id),
    payment_id UUID REFERENCES payments(id),
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'RETRYING')),
    attempt_count INT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ,
    last_response_code INT,
    last_response_body TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhook_deliveries_status ON webhook_deliveries(status, next_attempt_at) WHERE status IN ('PENDING', 'RETRYING');
CREATE INDEX idx_webhook_deliveries_payment ON webhook_deliveries(payment_id);

-- Idempotency Keys
CREATE TABLE idempotency_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    key VARCHAR(255) NOT NULL,
    response JSONB,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    UNIQUE (client_id, key)
);

CREATE INDEX idx_idempotency_expires ON idempotency_keys(expires_at);

-- Audit Logs
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_id UUID REFERENCES users(id),
    actor_type VARCHAR(50),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100),
    entity_id VARCHAR(255),
    client_id UUID REFERENCES clients(id),
    details JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    request_id VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_client ON audit_logs(client_id, created_at DESC);
CREATE INDEX idx_audit_actor ON audit_logs(actor_id, created_at DESC);
CREATE INDEX idx_audit_action ON audit_logs(action, created_at DESC);

-- Verification Agents
CREATE TABLE verification_agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_code VARCHAR(50) UNIQUE NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    processing_merchant_id UUID REFERENCES processing_merchants(id),
    status VARCHAR(50) NOT NULL DEFAULT 'REGISTERED'
        CHECK (status IN ('REGISTERED', 'ONLINE', 'OFFLINE', 'SUSPENDED')),
    secret_hash VARCHAR(255) NOT NULL,
    last_heartbeat_at TIMESTAMPTZ,
    ip_address VARCHAR(45),
    version VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Notifications
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    client_id UUID REFERENCES clients(id),
    type VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, is_read, created_at DESC);

-- Risk Events
CREATE TABLE risk_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id),
    payment_id UUID REFERENCES payments(id),
    event_type VARCHAR(100) NOT NULL,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    details JSONB,
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_risk_client ON risk_events(client_id, resolved, created_at DESC);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS risk_events CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS verification_agents CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS idempotency_keys CASCADE;
DROP TABLE IF EXISTS webhook_deliveries CASCADE;
DROP TABLE IF EXISTS webhooks CASCADE;
DROP TABLE IF EXISTS settlements CASCADE;
DROP TABLE IF EXISTS refunds CASCADE;
DROP TABLE IF EXISTS wallet_ledger CASCADE;
DROP TABLE IF EXISTS wallet_accounts CASCADE;
DROP TABLE IF EXISTS verification_events CASCADE;
DROP TABLE IF EXISTS payment_events CASCADE;
DROP TABLE IF EXISTS payment_attempts CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS client_processing_routes CASCADE;
DROP TABLE IF EXISTS processing_merchant_credentials CASCADE;
DROP TABLE IF EXISTS processing_merchants CASCADE;
DROP TABLE IF EXISTS client_api_keys CASCADE;
DROP TABLE IF EXISTS client_documents CASCADE;
DROP TABLE IF EXISTS client_users CASCADE;
DROP TABLE IF EXISTS clients CASCADE;
DROP TABLE IF EXISTS users CASCADE;
-- +goose StatementEnd

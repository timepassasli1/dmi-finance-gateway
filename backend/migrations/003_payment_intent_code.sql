-- +goose Up
ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS intent_code VARCHAR(32),
    ADD COLUMN IF NOT EXISTS intent_code_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_payments_intent_code ON payments(intent_code) WHERE intent_code IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS idx_payments_intent_code;
ALTER TABLE payments
    DROP COLUMN IF EXISTS intent_code_expires_at,
    DROP COLUMN IF EXISTS intent_code;

-- +goose Up
ALTER TABLE payments ADD COLUMN IF NOT EXISTS last_watched_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_payments_last_watched_at ON payments (last_watched_at DESC NULLS LAST);

-- +goose Down
DROP INDEX IF EXISTS idx_payments_last_watched_at;
ALTER TABLE payments DROP COLUMN IF EXISTS last_watched_at;

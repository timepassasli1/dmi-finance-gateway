-- +goose Up
-- Payment / order session TTL: 1 minute
ALTER TABLE orders ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '1 minute');

-- +goose Down
ALTER TABLE orders ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '30 minutes');

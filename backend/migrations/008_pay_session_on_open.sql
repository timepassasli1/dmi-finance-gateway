-- +goose Up
-- Pay session TTL: 1.5 minutes, starts when customer opens the pay page
ALTER TABLE orders ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '24 hours');

-- +goose Down
ALTER TABLE orders ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '1 minute');

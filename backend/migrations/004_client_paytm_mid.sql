-- +goose Up
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS paytm_mid VARCHAR(64);

-- +goose Down
ALTER TABLE clients DROP COLUMN IF EXISTS paytm_mid;

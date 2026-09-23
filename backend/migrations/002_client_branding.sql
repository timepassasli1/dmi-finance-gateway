-- +goose Up
-- +goose StatementBegin
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS logo_url VARCHAR(500),
  ADD COLUMN IF NOT EXISTS brand_color VARCHAR(20) DEFAULT '#6726A8',
  ADD COLUMN IF NOT EXISTS upi_vpa VARCHAR(120);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE clients
  DROP COLUMN IF EXISTS logo_url,
  DROP COLUMN IF EXISTS brand_color,
  DROP COLUMN IF EXISTS upi_vpa;
-- +goose StatementEnd

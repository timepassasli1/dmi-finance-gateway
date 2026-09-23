-- +goose Up
-- +goose StatementBegin
ALTER TABLE clients
    ADD COLUMN IF NOT EXISTS share_link_token VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_share_link_token
    ON clients (share_link_token)
    WHERE share_link_token IS NOT NULL AND share_link_token <> '';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_clients_share_link_token;
ALTER TABLE clients DROP COLUMN IF EXISTS share_link_token;
-- +goose StatementEnd

-- +goose Up
ALTER TABLE verification_agents
    ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_verification_agents_client ON verification_agents(client_id);

ALTER TABLE processing_merchants
    ADD COLUMN IF NOT EXISTS upi_vpa VARCHAR(255),
    ADD COLUMN IF NOT EXISTS paytm_mid VARCHAR(64);

-- +goose Down
ALTER TABLE processing_merchants DROP COLUMN IF EXISTS paytm_mid;
ALTER TABLE processing_merchants DROP COLUMN IF EXISTS upi_vpa;
DROP INDEX IF EXISTS idx_verification_agents_client;
ALTER TABLE verification_agents DROP COLUMN IF EXISTS client_id;

package api_keys

import (
	"context"
	"crypto/rand"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/gateway/backend/pkg/security"
)

type APIKey struct {
	ID              string     `json:"id"`
	ClientID        string     `json:"client_id"`
	KeyName         string     `json:"key_name"`
	ClientKey       string     `json:"client_key"`
	PublicKey       string     `json:"public_key"`
	SecretKeyPrefix string     `json:"secret_key_prefix"`
	Status          string     `json:"status"`
	LastUsedAt      *time.Time `json:"last_used_at,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
}

type APIKeyWithSecret struct {
	APIKey
	SecretKey     string `json:"secret_key"`
	WebhookSecret string `json:"webhook_secret"`
}

type Service struct {
	db            *sql.DB
	encryptionKey string
}

func NewService(db *sql.DB, encKey string) *Service {
	return &Service{db: db, encryptionKey: encKey}
}

func (s *Service) Generate(ctx context.Context, clientID, keyName string) (*APIKeyWithSecret, error) {
	// Generate keys
	clientKey := "CL_" + strings.ToUpper(randomHex(6))
	publicKey, _ := security.GenerateSecureToken("pk_live_")
	secretKey, _ := security.GenerateSecureToken("sk_live_")
	webhookSecret, _ := security.GenerateSecureToken("whsec_")

	// Hash secret key for storage
	secretHash, err := security.HashPassword(secretKey)
	if err != nil {
		return nil, err
	}

	// Encrypt webhook secret
	encWebhook, err := security.EncryptAES256GCM(s.encryptionKey, webhookSecret)
	if err != nil {
		return nil, err
	}

	secretPrefix := secretKey[:20] // Show first 20 chars for display

	var id string
	err = s.db.QueryRowContext(ctx,
		`INSERT INTO client_api_keys (client_id, key_name, client_key, public_key, secret_key_hash, secret_key_prefix, webhook_secret, status)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE') RETURNING id`,
		clientID, keyName, clientKey, publicKey, secretHash, secretPrefix, encWebhook,
	).Scan(&id)
	if err != nil {
		return nil, fmt.Errorf("generate key: %w", err)
	}

	return &APIKeyWithSecret{
		APIKey: APIKey{
			ID:              id,
			ClientID:        clientID,
			KeyName:         keyName,
			ClientKey:       clientKey,
			PublicKey:       publicKey,
			SecretKeyPrefix: secretPrefix,
			Status:          "ACTIVE",
			CreatedAt:       time.Now(),
		},
		SecretKey:     secretKey,
		WebhookSecret: webhookSecret,
	}, nil
}

func (s *Service) List(ctx context.Context, clientID string) ([]APIKey, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, client_id, key_name, client_key, public_key, secret_key_prefix,
		        status, last_used_at, created_at
		 FROM client_api_keys WHERE client_id = $1 AND status = 'ACTIVE'
		 ORDER BY created_at DESC`,
		clientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var keys []APIKey
	for rows.Next() {
		var k APIKey
		rows.Scan(&k.ID, &k.ClientID, &k.KeyName, &k.ClientKey, &k.PublicKey,
			&k.SecretKeyPrefix, &k.Status, &k.LastUsedAt, &k.CreatedAt)
		keys = append(keys, k)
	}
	return keys, nil
}

func (s *Service) Revoke(ctx context.Context, keyID, clientID string) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE client_api_keys SET status = 'REVOKED', revoked_at = NOW()
		 WHERE id = $1 AND client_id = $2 AND status = 'ACTIVE'`,
		keyID, clientID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("key not found or already revoked")
	}
	return nil
}

// AuthenticateByPublicKey finds the API key record by public key and returns client_id.
func (s *Service) AuthenticateByPublicKey(ctx context.Context, publicKey string) (string, string, error) {
	var clientID, keyID string
	err := s.db.QueryRowContext(ctx,
		`SELECT client_id, id FROM client_api_keys WHERE public_key = $1 AND status = 'ACTIVE'`,
		publicKey,
	).Scan(&clientID, &keyID)
	if err == sql.ErrNoRows {
		return "", "", fmt.Errorf("invalid API key")
	}
	return clientID, keyID, err
}

// AuthenticateBySecretKey verifies secret key and returns client_id.
func (s *Service) AuthenticateBySecretKey(ctx context.Context, secretKey string) (string, string, error) {
	// Get all active keys and check bcrypt (expensive, consider token hashing in prod)
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, client_id, secret_key_hash FROM client_api_keys WHERE status = 'ACTIVE'`)
	if err != nil {
		return "", "", err
	}
	defer rows.Close()

	for rows.Next() {
		var id, clientID, hash string
		rows.Scan(&id, &clientID, &hash)
		if security.CheckPassword(secretKey, hash) {
			// Update last used
			s.db.ExecContext(ctx, `UPDATE client_api_keys SET last_used_at = NOW() WHERE id = $1`, id)
			return clientID, id, nil
		}
	}
	return "", "", fmt.Errorf("invalid API key")
}

// GetWebhookSecret returns the decrypted webhook secret for a client.
func (s *Service) GetWebhookSecret(ctx context.Context, clientID string) (string, error) {
	var enc string
	err := s.db.QueryRowContext(ctx,
		`SELECT webhook_secret FROM client_api_keys WHERE client_id = $1 AND status = 'ACTIVE' LIMIT 1`,
		clientID,
	).Scan(&enc)
	if err != nil {
		return "", err
	}
	return security.DecryptAES256GCM(s.encryptionKey, enc)
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		// fallback: time-based uniqueness
		return fmt.Sprintf("%0*X", n, time.Now().UnixNano())[:n]
	}
	const hexdigits = "0123456789ABCDEF"
	out := make([]byte, n)
	for i := range b {
		out[i] = hexdigits[int(b[i])%16]
	}
	return string(out)
}

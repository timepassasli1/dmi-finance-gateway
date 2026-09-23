package idempotency

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type Key struct {
	ID        string
	ClientID  string
	Key       string
	Response  []byte
	Status    string
	CreatedAt time.Time
	ExpiresAt time.Time
}

type Store struct {
	db *sql.DB
}

func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

// Get retrieves an idempotency key.
func (s *Store) Get(ctx context.Context, clientID, key string) (*Key, error) {
	var k Key
	err := s.db.QueryRowContext(ctx,
		`SELECT id, client_id, key, response, status, created_at, expires_at
		 FROM idempotency_keys WHERE client_id = $1 AND key = $2`,
		clientID, key,
	).Scan(&k.ID, &k.ClientID, &k.Key, &k.Response, &k.Status, &k.CreatedAt, &k.ExpiresAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get idempotency key: %w", err)
	}
	if k.ExpiresAt.Before(time.Now()) {
		return nil, nil
	}
	return &k, nil
}

// Set saves an idempotency key response.
func (s *Store) Set(ctx context.Context, clientID, key string, response []byte, ttl time.Duration) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO idempotency_keys (client_id, key, response, status, expires_at)
		 VALUES ($1, $2, $3, 'completed', $4)
		 ON CONFLICT (client_id, key) DO UPDATE SET response = $3, status = 'completed'`,
		clientID, key, response, time.Now().Add(ttl),
	)
	return err
}

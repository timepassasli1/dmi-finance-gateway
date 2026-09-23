package webhooks

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/lib/pq"
	"github.com/gateway/backend/pkg/logger"
	"github.com/gateway/backend/pkg/security"
)

type Webhook struct {
	ID            string   `json:"id"`
	ClientID      string   `json:"client_id"`
	URL           string   `json:"url"`
	Events        []string `json:"events"`
	IsActive      bool     `json:"is_active"`
	SigningSecret string   `json:"signing_secret,omitempty"` // returned once on create
}

type Delivery struct {
	ID               string    `json:"id"`
	WebhookID        string    `json:"webhook_id"`
	PaymentID        string    `json:"payment_id,omitempty"`
	EventType        string    `json:"event_type"`
	Status           string    `json:"status"`
	AttemptCount     int       `json:"attempt_count"`
	LastResponseCode int       `json:"last_response_code,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
}

// Retry schedule: 1m, 5m, 15m, 30m, 1h
var retryDelays = []time.Duration{
	1 * time.Minute,
	5 * time.Minute,
	15 * time.Minute,
	30 * time.Minute,
	1 * time.Hour,
}

type Service struct {
	db            *sql.DB
	encryptionKey string
	log           *logger.Logger
}

func NewService(db *sql.DB, encKey string) *Service {
	return &Service{db: db, encryptionKey: encKey, log: logger.New("webhooks")}
}

func (s *Service) Register(ctx context.Context, clientID, url string, events []string) (*Webhook, error) {
	secret, _ := security.GenerateSecureToken("whsec_")
	encSecret, err := security.EncryptAES256GCM(s.encryptionKey, secret)
	if err != nil {
		return nil, err
	}

	var w Webhook
	err = s.db.QueryRowContext(ctx,
		`INSERT INTO webhooks (client_id, url, events, secret_encrypted)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, client_id, url, is_active`,
		clientID, url, pq.Array(events), encSecret,
	).Scan(&w.ID, &w.ClientID, &w.URL, &w.IsActive)
	if err != nil {
		return nil, err
	}
	w.Events = events
	w.SigningSecret = secret
	return &w, nil
}

func (s *Service) List(ctx context.Context, clientID string) ([]Webhook, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, client_id, url, events, is_active FROM webhooks WHERE client_id = $1`,
		clientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var whs []Webhook
	for rows.Next() {
		var w Webhook
		var events pq.StringArray
		rows.Scan(&w.ID, &w.ClientID, &w.URL, &events, &w.IsActive)
		w.Events = []string(events)
		whs = append(whs, w)
	}
	return whs, nil
}

func (s *Service) ListDeliveries(ctx context.Context, clientID string) ([]Delivery, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT d.id, d.webhook_id, d.payment_id, d.event_type, d.status, d.attempt_count,
		        d.last_response_code, d.created_at
		 FROM webhook_deliveries d
		 JOIN webhooks w ON w.id = d.webhook_id
		 WHERE w.client_id = $1
		 ORDER BY d.created_at DESC LIMIT 100`,
		clientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var deliveries []Delivery
	for rows.Next() {
		var d Delivery
		var pID sql.NullString
		var code sql.NullInt32
		rows.Scan(&d.ID, &d.WebhookID, &pID, &d.EventType, &d.Status, &d.AttemptCount, &code, &d.CreatedAt)
		d.PaymentID = pID.String
		d.LastResponseCode = int(code.Int32)
		deliveries = append(deliveries, d)
	}
	return deliveries, nil
}

// Deliver sends a webhook event to the client's configured endpoints.
func (s *Service) Deliver(ctx context.Context, clientID, paymentID, eventType string, payload map[string]interface{}) {
	// Get active webhooks
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, url, secret_encrypted FROM webhooks WHERE client_id = $1 AND is_active = true`,
		clientID)
	if err != nil {
		s.log.Error("webhook query failed", map[string]interface{}{"error": err.Error()})
		return
	}
	defer rows.Close()

	body, _ := json.Marshal(payload)

	for rows.Next() {
		var whID, url, encSecret string
		rows.Scan(&whID, &url, &encSecret)

		secret, err := security.DecryptAES256GCM(s.encryptionKey, encSecret)
		if err != nil {
			continue
		}

		// Create delivery record
		var deliveryID string
		s.db.QueryRowContext(ctx,
			`INSERT INTO webhook_deliveries (webhook_id, payment_id, event_type, payload, status, next_attempt_at)
			 VALUES ($1, $2, $3, $4, 'PENDING', NOW())
			 RETURNING id`,
			whID, paymentID, eventType, body,
		).Scan(&deliveryID)

		go s.deliver(deliveryID, url, secret, body)
	}
}

func (s *Service) deliver(deliveryID, url, secret string, body []byte) {
	ctx := context.Background()
	timestamp := time.Now().Unix()
	sig := security.WebhookSignature(secret, timestamp, body)

	for attempt := 0; attempt <= len(retryDelays); attempt++ {
		if attempt > 0 {
			delay := retryDelays[attempt-1]
			time.Sleep(delay)
		}

		code, err := s.sendHTTP(url, sig, timestamp, body)

		s.db.ExecContext(ctx,
			`UPDATE webhook_deliveries SET attempt_count = $1, last_response_code = $2, updated_at = NOW() WHERE id = $3`,
			attempt+1, code, deliveryID)

		if err == nil && code >= 200 && code < 300 {
			s.db.ExecContext(ctx,
				`UPDATE webhook_deliveries SET status = 'SUCCESS' WHERE id = $1`, deliveryID)
			return
		}

		if attempt < len(retryDelays) {
			s.db.ExecContext(ctx,
				`UPDATE webhook_deliveries SET status = 'RETRYING', next_attempt_at = $1 WHERE id = $2`,
				time.Now().Add(retryDelays[attempt]), deliveryID)
		}
	}

	s.db.ExecContext(ctx,
		`UPDATE webhook_deliveries SET status = 'FAILED' WHERE id = $1`, deliveryID)
}

func (s *Service) sendHTTP(url, sig string, timestamp int64, body []byte) (int, error) {
	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return 0, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Gateway-Signature", "v1="+sig)
	req.Header.Set("X-Gateway-Timestamp", fmt.Sprintf("%d", timestamp))
	req.Header.Set("X-Gateway-Event-ID", security.GenerateRequestID())

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	return resp.StatusCode, nil
}

// UpdateWebhookEndpoint updates a webhook URL, events, and active flag for a client.
func (s *Service) Update(ctx context.Context, whID, clientID, url string, events []string, active bool) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE webhooks SET url = $1, events = $2, is_active = $3, updated_at = NOW()
		 WHERE id = $4 AND client_id = $5`,
		url, pq.Array(events), active, whID, clientID)
	return err
}

func (s *Service) Delete(ctx context.Context, whID, clientID string) error {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM webhooks WHERE id = $1 AND client_id = $2`, whID, clientID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("webhook not found")
	}
	return nil
}

// Package agent implements the verification agent that consumes
// authorized transaction feeds and reports payment verification events to the gateway.
//
// IMPORTANT: This agent must ONLY consume data from an authorized source.
// It must NOT implement:
//   - CAPTCHA bypass
//   - Anti-bot bypass
//   - Credential extraction
//   - Session-cookie extraction
//   - Stealth browser automation
//   - Unauthorized scraping
//   - Security-control bypass
package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"
)

// Config holds agent configuration.
type Config struct {
	GatewayURL string
	AgentCode  string
	Secret     string
	HeartbeatInterval time.Duration
	Version    string
}

// VerificationEvent is the payload sent to the gateway.
type VerificationEvent struct {
	GatewayPaymentID       string `json:"gateway_payment_id"`
	MerchantOrderID        string `json:"merchant_order_id"`
	ProviderTransactionRef string `json:"provider_transaction_ref"`
	Amount                 int64  `json:"amount"`
	Currency               string `json:"currency"`
	Status                 string `json:"status"`
	Timestamp              int64  `json:"timestamp"`
}

// TransactionSource is the interface for authorized transaction data sources.
// Implement this interface for each authorized payment provider.
type TransactionSource interface {
	GetNewTransactions(ctx context.Context) ([]TransactionRecord, error)
	GetTransactionDetails(ctx context.Context, ref string) (*TransactionRecord, error)
}

// TransactionRecord is a transaction from the authorized source.
type TransactionRecord struct {
	ProviderRef string
	Amount      int64
	Currency    string
	Status      string
	Timestamp   int64
	Description string
}

// Agent is the verification agent.
type Agent struct {
	cfg     Config
	client  *http.Client
	source  TransactionSource
}

// New creates a new Agent.
func New(cfg Config, source TransactionSource) *Agent {
	return &Agent{
		cfg:    cfg,
		client: &http.Client{Timeout: 30 * time.Second},
		source: source,
	}
}

// Run starts the agent loop.
func (a *Agent) Run(ctx context.Context) error {
	fmt.Printf("[agent] Starting verification agent %s\n", a.cfg.AgentCode)

	// Register
	if err := a.register(ctx); err != nil {
		return fmt.Errorf("registration failed: %w", err)
	}
	fmt.Println("[agent] Registered with gateway")

	heartbeat := time.NewTicker(a.cfg.HeartbeatInterval)
	poll := time.NewTicker(60 * time.Second)
	defer heartbeat.Stop()
	defer poll.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-heartbeat.C:
			if err := a.sendHeartbeat(ctx); err != nil {
				fmt.Fprintf(os.Stderr, "[agent] heartbeat failed: %v\n", err)
			}
		case <-poll.C:
			if err := a.processNewTransactions(ctx); err != nil {
				fmt.Fprintf(os.Stderr, "[agent] process transactions failed: %v\n", err)
			}
		}
	}
}

func (a *Agent) register(ctx context.Context) error {
	body, _ := json.Marshal(map[string]string{
		"agent_code":   a.cfg.AgentCode,
		"display_name": "Verification Agent " + a.cfg.AgentCode,
		"secret":       a.cfg.Secret,
		"version":      a.cfg.Version,
	})
	resp, err := a.post(ctx, "/v1/agents/register", body, false)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		return fmt.Errorf("registration returned %d", resp.StatusCode)
	}
	return nil
}

func (a *Agent) sendHeartbeat(ctx context.Context) error {
	body, _ := json.Marshal(map[string]string{"status": "ok"})
	resp, err := a.post(ctx, "/v1/agents/heartbeat", body, true)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}

func (a *Agent) processNewTransactions(ctx context.Context) error {
	if a.source == nil {
		return nil
	}

	txns, err := a.source.GetNewTransactions(ctx)
	if err != nil {
		return fmt.Errorf("get transactions: %w", err)
	}

	for _, txn := range txns {
		event := VerificationEvent{
			ProviderTransactionRef: txn.ProviderRef,
			Amount:                 txn.Amount,
			Currency:               txn.Currency,
			Status:                 txn.Status,
			Timestamp:              txn.Timestamp,
		}
		if err := a.submitVerificationEvent(ctx, event); err != nil {
			fmt.Fprintf(os.Stderr, "[agent] submit event failed for %s: %v\n", txn.ProviderRef, err)
		}
	}
	return nil
}

func (a *Agent) submitVerificationEvent(ctx context.Context, event VerificationEvent) error {
	body, _ := json.Marshal(event)
	resp, err := a.post(ctx, "/v1/agents/verification-event", body, true)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	fmt.Printf("[agent] submitted verification event: %s status=%d\n", event.ProviderTransactionRef, resp.StatusCode)
	return nil
}

func (a *Agent) post(ctx context.Context, path string, body []byte, withAuth bool) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, "POST", a.cfg.GatewayURL+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if withAuth {
		req.Header.Set("X-Agent-Code", a.cfg.AgentCode)
		req.Header.Set("X-Agent-Secret", a.cfg.Secret)
	}
	return a.client.Do(req)
}

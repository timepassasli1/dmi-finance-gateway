package verification

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/gateway/backend/internal/payment_providers"
	"github.com/gateway/backend/internal/payments"
	"github.com/gateway/backend/internal/wallet"
	"github.com/gateway/backend/internal/webhooks"
	"github.com/gateway/backend/pkg/logger"
)

type VerifyRequest struct {
	GatewayPaymentID       string `json:"gateway_payment_id"`
	ClientOrderID          string `json:"client_order_id"`
	ProviderTransactionID  string `json:"provider_transaction_id"`
	ProviderTransactionRef string `json:"provider_transaction_ref"`
	Amount                 int64  `json:"amount"`
	Currency               string `json:"currency"`
	// ClientID is set by the API-key middleware path — never trust body for ownership.
	ClientID string `json:"-"`
}

type VerifyResult struct {
	Status         string `json:"status"`
	GatewayPaymentID string `json:"gateway_payment_id"`
	TransactionRef string `json:"transaction_ref,omitempty"`
	FailureReason  string `json:"failure_reason,omitempty"`
	Message        string `json:"message"`
}

type Engine struct {
	db          *sql.DB
	provReg     *payment_providers.Registry
	paymentsSvc *payments.Service
	walletSvc   *wallet.Service
	webhookSvc  *webhooks.Service
	log         *logger.Logger
}

func NewEngine(
	db *sql.DB,
	provReg *payment_providers.Registry,
	paymentsSvc *payments.Service,
	walletSvc *wallet.Service,
	webhookSvc *webhooks.Service,
) *Engine {
	return &Engine{
		db:          db,
		provReg:     provReg,
		paymentsSvc: paymentsSvc,
		walletSvc:   walletSvc,
		webhookSvc:  webhookSvc,
		log:         logger.New("verification"),
	}
}

func (e *Engine) Payments() *payments.Service { return e.paymentsSvc }

// Verify processes a payment verification request.
// A frontend redirect or customer-provided ID can NEVER finalize a payment.
// Only an authorized confirmation source (extension agent / real provider proof) can finalize.
func (e *Engine) Verify(ctx context.Context, req VerifyRequest) (*VerifyResult, error) {
	// Load without starting the hosted pay-session timer (GetPublic would).
	var payment *payments.Payment
	var err error
	if req.ClientID != "" {
		payment, err = e.paymentsSvc.GetByGatewayID(ctx, req.GatewayPaymentID, req.ClientID)
	} else {
		payment, err = e.paymentsSvc.GetForAgent(ctx, req.GatewayPaymentID)
	}
	if err != nil {
		return nil, fmt.Errorf("PAYMENT_NOT_FOUND: %w", err)
	}

	if payment.Status == "SUCCESS" {
		return &VerifyResult{
			Status:           "SUCCESS",
			GatewayPaymentID: payment.GatewayPaymentID,
			TransactionRef:   payment.ProviderTransactionRef,
			Message:          "Payment already verified",
		}, nil
	}

	if payment.Status == "FAILED" || payment.Status == "EXPIRED" {
		return &VerifyResult{
			Status:           payment.Status,
			GatewayPaymentID: payment.GatewayPaymentID,
			FailureReason:    payment.FailureReason,
			Message:          "Payment is finalized",
		}, nil
	}

	// Check for duplicate transaction reference
	if req.ProviderTransactionRef != "" {
		var existingPaymentID string
		e.db.QueryRowContext(ctx,
			`SELECT id FROM payments WHERE provider_transaction_ref = $1 AND status = 'SUCCESS'`,
			req.ProviderTransactionRef,
		).Scan(&existingPaymentID)
		if existingPaymentID != "" && existingPaymentID != payment.ID {
			return nil, fmt.Errorf("TRANSACTION_ALREADY_PROCESSED: this transaction reference is already processed")
		}
	}

	// Get the processing merchant's provider
	var provider string
	e.db.QueryRowContext(ctx,
		`SELECT pm.provider FROM payments p
		 JOIN processing_merchants pm ON pm.id = p.processing_merchant_id
		 WHERE p.id = $1`, payment.ID,
	).Scan(&provider)

	if provider == "" {
		provider = "mock"
	}

	// Mock / intent-only rails: API verify is a status poll. Real UPI is confirmed by the
	// browser extension (Paytm remarks ↔ GW track). Never auto-credit from mock.
	if provider == "mock" {
		return &VerifyResult{
			Status:           payment.Status,
			GatewayPaymentID: payment.GatewayPaymentID,
			Message:          "Awaiting UPI confirmation — poll until status is SUCCESS",
		}, nil
	}

	prov, err := e.provReg.Get(provider)
	if err != nil {
		return nil, fmt.Errorf("PROVIDER_UNAVAILABLE: %w", err)
	}

	// Verify with provider
	result, err := prov.VerifyPayment(ctx, payment_providers.VerifyRequest{
		ProviderPaymentID:      payment.ProviderPaymentID,
		ProviderTransactionID:  req.ProviderTransactionID,
		ProviderTransactionRef: req.ProviderTransactionRef,
		Amount:                 payment.Amount,
		Currency:               payment.Currency,
		GatewayPaymentID:       payment.GatewayPaymentID,
	})
	if err != nil {
		return nil, fmt.Errorf("verification failed: %w", err)
	}

	e.log.Info("verification result", map[string]interface{}{
		"gateway_payment_id": payment.GatewayPaymentID,
		"result":             result.Status,
	})

	// Log verification event
	e.db.ExecContext(ctx,
		`INSERT INTO verification_events (payment_id, source, provider, provider_transaction_ref, amount, currency, status, result, idempotency_key, processed_at)
		 VALUES ($1, 'api', $2, $3, $4, $5, 'received', $6, $7, NOW())`,
		payment.ID, provider, req.ProviderTransactionRef, req.Amount, req.Currency,
		result.Status, req.ProviderTransactionRef+"_"+payment.ID,
	)

	switch result.Status {
	case "VERIFIED_SUCCESS":
		txnRef := req.ProviderTransactionRef
		if txnRef == "" {
			txnRef = result.TransactionRef
		}
		return e.finalizeSuccess(ctx, payment, result, txnRef)
	case "VERIFIED_FAILED":
		return e.finalizeFailed(ctx, payment, result.FailureReason)
	case "PENDING_REVIEW":
		e.paymentsSvc.TransitionState(ctx, payment.ID, "PENDING_REVIEW", map[string]interface{}{
			"provider_transaction_ref": req.ProviderTransactionRef,
		})
		return &VerifyResult{
			Status:           "PENDING_REVIEW",
			GatewayPaymentID: payment.GatewayPaymentID,
			FailureReason:    result.FailureReason,
			Message:          "Payment requires manual review",
		}, nil
	default:
		return &VerifyResult{
			Status:           "INVALID",
			GatewayPaymentID: payment.GatewayPaymentID,
			Message:          "Verification inconclusive",
		}, nil
	}
}

func isRetryableTxErr(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "could not serialize") ||
		strings.Contains(msg, "serialization failure") ||
		strings.Contains(msg, "deadlock detected") ||
		strings.Contains(msg, "40001") ||
		strings.Contains(msg, "40p01")
}

func (e *Engine) finalizeSuccess(ctx context.Context, payment *payments.Payment, result *payment_providers.VerificationResult, txnRef string) (*VerifyResult, error) {
	// Burst: many SUCCESS events hit the same wallet — retry serializable conflicts
	var lastErr error
	for attempt := 0; attempt < 10; attempt++ {
		out, err := e.finalizeSuccessOnce(ctx, payment, result, txnRef)
		if err == nil {
			return out, nil
		}
		lastErr = err
		if !isRetryableTxErr(err) {
			return nil, err
		}
		time.Sleep(time.Duration(15*(attempt+1)) * time.Millisecond)
	}
	return nil, lastErr
}

func (e *Engine) finalizeSuccessOnce(ctx context.Context, payment *payments.Payment, result *payment_providers.VerificationResult, txnRef string) (*VerifyResult, error) {
	// Use DB transaction to prevent double-credit
	tx, err := e.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	// Lock payment row
	var currentStatus string
	err = tx.QueryRowContext(ctx,
		`SELECT status FROM payments WHERE id = $1 FOR UPDATE`, payment.ID,
	).Scan(&currentStatus)
	if err != nil {
		return nil, err
	}

	if currentStatus == "SUCCESS" {
		tx.Rollback()
		return &VerifyResult{
			Status:           "SUCCESS",
			GatewayPaymentID: payment.GatewayPaymentID,
			Message:          "Payment already credited",
		}, nil
	}

	// Check transaction reference isn't already processed
	if txnRef != "" {
		var count int
		tx.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM payments WHERE provider_transaction_ref = $1 AND status = 'SUCCESS' AND id != $2`,
			txnRef, payment.ID,
		).Scan(&count)
		if count > 0 {
			tx.Rollback()
			return nil, fmt.Errorf("TRANSACTION_ALREADY_PROCESSED: duplicate transaction")
		}
	}

	now := time.Now()

	// Update payment
	_, err = tx.ExecContext(ctx,
		`UPDATE payments SET status = 'SUCCESS', provider_transaction_ref = $1, finalized_at = $2, updated_at = NOW()
		 WHERE id = $3`,
		txnRef, now, payment.ID)
	if err != nil {
		return nil, err
	}

	// Credit wallet
	if err := e.walletSvc.CreditTx(ctx, tx, payment.ClientID, payment.ID, payment.Amount, txnRef); err != nil {
		return nil, fmt.Errorf("wallet credit failed: %w", err)
	}

	// Update order status
	tx.ExecContext(ctx,
		`UPDATE orders SET status = 'SUCCESS', updated_at = NOW() WHERE id = (SELECT order_id FROM payments WHERE id = $1)`,
		payment.ID)

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	// Trigger webhook asynchronously
	go e.webhookSvc.Deliver(context.Background(), payment.ClientID, payment.ID, "payment.success", map[string]interface{}{
		"event":                    "payment.success",
		"gateway_payment_id":       payment.GatewayPaymentID,
		"gateway_order_id":         payment.GatewayOrderID,
		"client_order_id":          payment.ClientOrderID,
		"amount":                   payment.Amount,
		"currency":                 payment.Currency,
		"status":                   "SUCCESS",
		"transaction_reference":    txnRef,
		"timestamp":                now.UTC().Format(time.RFC3339),
	})

	return &VerifyResult{
		Status:           "SUCCESS",
		GatewayPaymentID: payment.GatewayPaymentID,
		TransactionRef:   txnRef,
		Message:          "Payment verified and credited",
	}, nil
}

func (e *Engine) finalizeFailed(ctx context.Context, payment *payments.Payment, reason string) (*VerifyResult, error) {
	e.paymentsSvc.TransitionState(ctx, payment.ID, "FAILED", map[string]interface{}{
		"failure_reason": reason,
	})

	go e.webhookSvc.Deliver(context.Background(), payment.ClientID, payment.ID, "payment.failed", map[string]interface{}{
		"event":              "payment.failed",
		"gateway_payment_id": payment.GatewayPaymentID,
		"amount":             payment.Amount,
		"currency":           payment.Currency,
		"status":             "FAILED",
		"failure_reason":     reason,
		"timestamp":          time.Now().UTC().Format(time.RFC3339),
	})

	return &VerifyResult{
		Status:           "FAILED",
		GatewayPaymentID: payment.GatewayPaymentID,
		FailureReason:    reason,
		Message:          "Payment verification failed",
	}, nil
}

// ProcessAgentEvent handles verification events from the verification agent / browser extension.
func (e *Engine) ProcessAgentEvent(ctx context.Context, agentID string, event AgentVerificationEvent, scope payments.AgentScope) (*VerifyResult, error) {
	// Multi-tenant: agent must be bound to a client (or merchant). Unscoped agents cannot credit.
	if strings.TrimSpace(scope.ClientID) == "" && strings.TrimSpace(scope.ProcessingMerchantID) == "" {
		return nil, fmt.Errorf("AGENT_SCOPE_REQUIRED: bind this agent to a client before verifying payments")
	}

	gwID := event.GatewayPaymentID

	// Extension: only GW / PAY_ from Paytm remarks. Never amount, never admin History HTML.
	src := strings.ToLower(strings.TrimSpace(event.Source))
	if strings.Contains(src, "extension") || src == "" {
		blob := event.TrackCode + " " + event.Remarks + " " + event.RawSnippet + " " + event.GatewayPaymentID
		up := strings.ToUpper(blob)
		hasGW := regexp.MustCompile(`\bGW[A-F0-9]{8}\b`).MatchString(up)
		hasPAY := extractPAYID(blob) != ""
		if !hasGW && !hasPAY {
			return nil, fmt.Errorf("TRACK_REQUIRED: confirm only with GWxxxxxxxx (or PAY_) from Paytm")
		}
	}

	// Prefer explicit track note from Paytm details / UPI remarks (GWxxxxxxxx)
	if gwID == "" {
		for _, candidate := range []string{event.TrackCode, event.Remarks, event.RawSnippet, event.ProviderTransactionRef} {
			if code := extractTrackCode(candidate); code != "" {
				if matched, err := e.paymentsSvc.FindPendingByTrackCode(ctx, code, scope); err == nil {
					gwID = matched
					break
				}
			}
			if payID := extractPAYID(candidate); payID != "" {
				gwID = payID
				break
			}
		}
	}

	if gwID == "" && event.MerchantOrderID != "" {
		_ = e.db.QueryRowContext(ctx,
			`SELECT p.gateway_payment_id FROM payments p
			 JOIN orders o ON o.id = p.order_id
			 WHERE o.client_order_id = $1 ORDER BY p.created_at DESC LIMIT 1`,
			event.MerchantOrderID,
		).Scan(&gwID)
	}
	// Track code (GWxxxxxxxx) or explicit gateway_payment_id only.
	// Never amount-match — same-time same-amount pays would mis-credit.
	if gwID == "" {
		return nil, fmt.Errorf("PAYMENT_NOT_FOUND: gateway_payment_id or track code (GWxxxxxxxx) required")
	}

	payment, err := e.paymentsSvc.GetForAgent(ctx, gwID)
	if err != nil {
		return nil, fmt.Errorf("PAYMENT_NOT_FOUND: cannot match payment for agent event")
	}

	scope = e.paymentsSvc.FillAgentScope(ctx, scope)

	// Agent isolation: same Paytm VPA can confirm any client on that merchant.
	if !e.paymentsSvc.PaymentAllowedForAgent(ctx, payment.ProcessingMerchantID, payment.ClientID, scope) {
		return nil, fmt.Errorf("PAYMENT_NOT_FOUND: payment does not belong to this agent's merchant")
	}

	// Idempotent: already SUCCESS → no double credit
	if strings.EqualFold(payment.Status, "SUCCESS") {
		return &VerifyResult{
			Status:           "SUCCESS",
			GatewayPaymentID: payment.GatewayPaymentID,
			TransactionRef:   event.ProviderTransactionRef,
			Message:          "Payment already credited",
		}, nil
	}

	status := strings.ToUpper(strings.TrimSpace(event.Status))
	if status == "" {
		status = "SUCCESS"
	}

	txnRef := event.ProviderTransactionRef
	if txnRef == "" {
		txnRef = fmt.Sprintf("EXT_%s_%d", payment.GatewayPaymentID, time.Now().Unix())
	}

	// GW already uniquely matched. Paytm scrape often sends rupees (2) vs our paise (200).
	amount := coerceEventAmount(event.Amount, payment.Amount)

	switch status {
	case "FAILED", "FAILURE", "DECLINED", "CANCELLED", "CANCELED":
		// Do not overwrite a timeout-FAILED if agent later reports SUCCESS path only
		return e.finalizeFailed(ctx, payment, "Detected failed payment on merchant/UPI confirmation page")
	case "SUCCESS", "SUCCESSFUL", "COMPLETED", "PAID":
		// Allow credit even if pay-page timer already marked FAILED (real UPI often arrives after UI timeout)
		return e.finalizeSuccess(ctx, payment, &payment_providers.VerificationResult{
			Status:         "VERIFIED_SUCCESS",
			Amount:         amount,
			Currency:       payment.Currency,
			TransactionRef: txnRef,
		}, txnRef)
	default:
		e.paymentsSvc.TransitionState(ctx, payment.ID, "PENDING_REVIEW", map[string]interface{}{
			"provider_transaction_ref": txnRef,
		})
		return &VerifyResult{Status: "PENDING_REVIEW", GatewayPaymentID: payment.GatewayPaymentID, Message: "Unrecognized status: " + status}, nil
	}
}

func coerceEventAmount(eventAmt, payAmt int64) int64 {
	if eventAmt == 0 || eventAmt == payAmt {
		return payAmt
	}
	if eventAmt*100 == payAmt || eventAmt == payAmt*100 {
		return payAmt
	}
	return payAmt
}

func extractTrackCode(hay string) string {
	if hay == "" {
		return ""
	}
	up := strings.ToUpper(hay)
	// Preferred: GWxxxxxxxx (8 hex)
	if m := regexp.MustCompile(`\bGW[A-F0-9]{8}\b`).FindString(up); m != "" {
		return m
	}
	// Fallback: bare 8-hex intent (PhonePe sometimes strips GW from note)
	if m := regexp.MustCompile(`(?:^|[^A-Z0-9])([A-F0-9]{8})(?:[^A-Z0-9]|$)`).FindStringSubmatch(up); len(m) == 2 {
		return "GW" + m[1]
	}
	return ""
}

func extractPAYID(hay string) string {
	if hay == "" {
		return ""
	}
	if m := regexp.MustCompile(`\bPAY_[A-Za-z0-9]+\b`).FindString(hay); m != "" {
		return m
	}
	return ""
}

type AgentVerificationEvent struct {
	GatewayPaymentID       string `json:"gateway_payment_id"`
	MerchantOrderID        string `json:"merchant_order_id"`
	ProviderTransactionRef string `json:"provider_transaction_ref"`
	Amount                 int64  `json:"amount"`
	Currency               string `json:"currency"`
	Status                 string `json:"status"`
	Timestamp              int64  `json:"timestamp"`
	Source                 string `json:"source"` // extension | agent | mock
	TrackCode              string `json:"track_code"`
	Remarks                string `json:"remarks"`
	RawSnippet             string `json:"raw_snippet"`
}

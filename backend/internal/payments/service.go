package payments

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/gateway/backend/internal/clients"
	"github.com/gateway/backend/internal/orders"
	"github.com/gateway/backend/internal/payment_providers"
	"github.com/gateway/backend/internal/routing"
)

type Payment struct {
	ID                     string     `json:"id"`
	GatewayPaymentID       string     `json:"gateway_payment_id"`
	GatewayOrderID         string     `json:"gateway_order_id"`
	ClientOrderID          string     `json:"client_order_id"`
	ClientID               string     `json:"client_id"`
	ProcessingMerchantID   string     `json:"processing_merchant_id,omitempty"`
	Amount                 int64      `json:"amount"`
	Currency               string     `json:"currency"`
	Status                 string     `json:"status"`
	ProviderPaymentID      string     `json:"provider_payment_id,omitempty"`
	ProviderTransactionID  string     `json:"provider_transaction_id,omitempty"`
	ProviderTransactionRef string     `json:"provider_transaction_ref,omitempty"`
	PaymentURL             string     `json:"payment_url,omitempty"`
	QRData                 string     `json:"qr_data,omitempty"`
	UPIIntentURL           string     `json:"upi_intent_url,omitempty"`
	FailureReason          string     `json:"failure_reason,omitempty"`
	FinalizedAt            *time.Time `json:"finalized_at,omitempty"`
	ExpiresAt              *time.Time `json:"expires_at,omitempty"`
	MerchantName           string     `json:"merchant_name,omitempty"`
	MerchantLogoURL        string     `json:"merchant_logo_url,omitempty"`
	BrandColor             string     `json:"brand_color,omitempty"`
	MerchantUPIVPA         string     `json:"merchant_upi_vpa,omitempty"`
	IntentCode             string     `json:"intent_code,omitempty"`
	TrackCode              string     `json:"track_code,omitempty"`
	IntentCodeExpiresAt    *time.Time `json:"intent_code_expires_at,omitempty"`
	LastWatchedAt          *time.Time `json:"last_watched_at,omitempty"`
	ClientEmail            string     `json:"client_email,omitempty"`
	CreatedAt              time.Time  `json:"created_at"`
	UpdatedAt              time.Time  `json:"updated_at"`
}

// Valid state transitions
var validTransitions = map[string][]string{
	"CREATED":        {"PENDING", "FAILED", "EXPIRED"},
	"PENDING":        {"SUCCESS", "FAILED", "EXPIRED", "PENDING_REVIEW"},
	"PENDING_REVIEW": {"SUCCESS", "FAILED"},
	"FAILED":         {"SUCCESS"}, // agent can recover timeout after real UPI credit
	"SUCCESS":        {"REFUND_PENDING"},
	"REFUND_PENDING": {"REFUNDED"},
}

type Service struct {
	db         *sql.DB
	routeEng   *routing.Engine
	provReg    *payment_providers.Registry
	clientsSvc *clients.Service
	ordersSvc  *orders.Service
	gatewayURL string
}

func NewService(
	db *sql.DB,
	routeEng *routing.Engine,
	provReg *payment_providers.Registry,
	clientsSvc *clients.Service,
	ordersSvc *orders.Service,
	gatewayURL string,
) *Service {
	return &Service{
		db:         db,
		routeEng:   routeEng,
		provReg:    provReg,
		clientsSvc: clientsSvc,
		ordersSvc:  ordersSvc,
		gatewayURL: gatewayURL,
	}
}

func (s *Service) GatewayURL() string { return s.gatewayURL }

// resolveMerchantVPA: shop settings UPI wins (Airtel/Paytm/Fino whatever they set),
// then processing merchant, then mock.
func (s *Service) resolveMerchantVPA(ctx context.Context, processingMerchantID, clientVPA string) string {
	if strings.TrimSpace(clientVPA) != "" {
		return strings.TrimSpace(clientVPA)
	}
	if processingMerchantID != "" {
		var vpa sql.NullString
		_ = s.db.QueryRowContext(ctx,
			`SELECT upi_vpa FROM processing_merchants WHERE id = $1 AND status = 'ACTIVE'`,
			processingMerchantID,
		).Scan(&vpa)
		if vpa.Valid && strings.TrimSpace(vpa.String) != "" {
			return strings.TrimSpace(vpa.String)
		}
	}
	return "mock@upi"
}

// ClientStats returns dashboard counters for one client.
func (s *Service) ClientStats(ctx context.Context, clientID string) (map[string]interface{}, error) {
	var total, success, pending, failed int
	var totalVol, todayVol int64
	_ = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM payments WHERE client_id = $1`, clientID).Scan(&total)
	_ = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM payments WHERE client_id = $1 AND status = 'SUCCESS'`, clientID).Scan(&success)
	_ = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM payments WHERE client_id = $1 AND status IN ('PENDING','CREATED','PENDING_REVIEW')`, clientID).Scan(&pending)
	_ = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM payments WHERE client_id = $1 AND status IN ('FAILED','EXPIRED')`, clientID).Scan(&failed)
	_ = s.db.QueryRowContext(ctx, `SELECT COALESCE(SUM(amount),0) FROM payments WHERE client_id = $1 AND status = 'SUCCESS'`, clientID).Scan(&totalVol)
	_ = s.db.QueryRowContext(ctx, `SELECT COALESCE(SUM(amount),0) FROM payments WHERE client_id = $1 AND status = 'SUCCESS' AND created_at >= CURRENT_DATE`, clientID).Scan(&todayVol)
	return map[string]interface{}{
		"total_payments":   total,
		"success_payments": success,
		"pending_payments": pending,
		"failed_payments":  failed,
		"total_volume":     totalVol,
		"today_volume":     todayVol,
	}, nil
}

// InitiatePayment creates a payment for an order.
func (s *Service) InitiatePayment(ctx context.Context, clientID, orderID string) (*Payment, error) {
	// Load order (client scoped)
	order, err := s.ordersSvc.Get(ctx, orderID, clientID)
	if err != nil {
		return nil, err
	}

	// Check if already paid
	var existing string
	s.db.QueryRowContext(ctx,
		`SELECT gateway_payment_id FROM payments WHERE order_id = $1 AND status NOT IN ('FAILED', 'EXPIRED') LIMIT 1`,
		order.ID).Scan(&existing)
	if existing != "" {
		return s.GetByGatewayID(ctx, existing, clientID)
	}

	// Check client status
	client, err := s.clientsSvc.GetByID(ctx, clientID)
	if err != nil {
		return nil, err
	}
	if client.Status != "ACTIVE" {
		return nil, fmt.Errorf("CLIENT_INACTIVE: client is not active")
	}
	if client.KYCStatus != "APPROVED" {
		return nil, fmt.Errorf("KYC_NOT_APPROVED: client KYC not approved")
	}
	if order.ExpiresAt.Before(time.Now()) {
		return nil, fmt.Errorf("PAYMENT_EXPIRED: order has expired")
	}

	// Select route
	route, err := s.routeEng.SelectRoute(ctx, clientID, order.Amount, order.Currency)
	if err != nil {
		return nil, err
	}

	// Get provider
	provider, err := s.provReg.Get(route.Provider)
	if err != nil {
		return nil, fmt.Errorf("PROVIDER_UNAVAILABLE: %w", err)
	}

	gwPaymentID := generatePaymentID()

	// Create payment with provider
	provResp, err := provider.CreatePayment(ctx, payment_providers.CreatePaymentRequest{
		GatewayPaymentID: gwPaymentID,
		Amount:           order.Amount,
		Currency:         order.Currency,
		CustomerName:     order.CustomerName,
		CustomerEmail:    order.CustomerEmail,
		CustomerPhone:    order.CustomerPhone,
		MerchantOrderID:  order.ClientOrderID,
	})
	if err != nil {
		return nil, fmt.Errorf("provider payment creation failed: %w", err)
	}

	payURL := fmt.Sprintf("%s/pay/%s", s.gatewayURL, gwPaymentID)

	// Persist payment
	var p Payment
	err = s.db.QueryRowContext(ctx,
		`INSERT INTO payments (gateway_payment_id, order_id, client_id, processing_merchant_id, amount, currency, status, provider_payment_id)
		 VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7)
		 RETURNING id, gateway_payment_id, client_id, processing_merchant_id, amount, currency, status, provider_payment_id, created_at, updated_at`,
		gwPaymentID, order.ID, clientID, route.ProcessingMerchantID, order.Amount, order.Currency, provResp.ProviderPaymentID,
	).Scan(&p.ID, &p.GatewayPaymentID, &p.ClientID, &p.ProcessingMerchantID,
		&p.Amount, &p.Currency, &p.Status, &p.ProviderPaymentID, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("persist payment: %w", err)
	}

	// Update order status
	s.ordersSvc.UpdateStatus(ctx, order.ID, "PENDING")

	p.GatewayOrderID = order.GatewayOrderID
	p.ClientOrderID = order.ClientOrderID
	p.PaymentURL = payURL
	p.QRData = provResp.QRData
	p.UPIIntentURL = provResp.UPIIntentURL

	// Prefer dedicated processing merchant VPA (isolation) over client profile fallback
	pn := client.BusinessName
	if pn == "" {
		pn = route.MerchantDisplayName
	}
	if pn == "" {
		pn = "Merchant"
	}
	vpa := s.resolveMerchantVPA(ctx, route.ProcessingMerchantID, client.UPIVPA)
	intent := fmt.Sprintf("upi://pay?pa=%s&pn=%s&am=%.2f&cu=%s&tn=%s",
		vpa, strings.ReplaceAll(pn, " ", "%20"), float64(order.Amount)/100, order.Currency, gwPaymentID)
	p.QRData = intent
	p.UPIIntentURL = intent
	p.MerchantName = pn
	p.MerchantLogoURL = client.LogoURL
	p.BrandColor = client.BrandColor
	p.MerchantUPIVPA = vpa

	// Issue first fresh intent code
	if err := s.rotateIntentCode(ctx, &p, pn, vpa, false); err != nil {
		return nil, err
	}

	return &p, nil
}

type CreatePaymentLinkRequest struct {
	Amount        int64  `json:"amount" binding:"required,min=1"` // paise
	Currency      string `json:"currency"`
	CustomerName  string `json:"customer_name"`
	CustomerEmail string `json:"customer_email"`
	CustomerPhone string `json:"customer_phone"`
	CustomerUPI   string `json:"customer_upi"` // optional — payment request target
	Note          string `json:"note"`
	Type          string `json:"type"` // link | request
}

// CreatePaymentLink creates an order + payment in one step (dashboard JWT).
func (s *Service) CreatePaymentLink(ctx context.Context, clientID string, req CreatePaymentLinkRequest) (*Payment, error) {
	if req.Currency == "" {
		req.Currency = "INR"
	}
	kind := strings.ToLower(strings.TrimSpace(req.Type))
	if kind == "" {
		kind = "link"
	}
	prefix := "LINK"
	if kind == "request" {
		prefix = "REQ"
	}
	orderID := fmt.Sprintf("%s_%d", prefix, time.Now().UnixNano())

	orderReq := orders.CreateOrderRequest{
		OrderID:  orderID,
		Amount:   req.Amount,
		Currency: req.Currency,
	}
	orderReq.Customer.Name = req.CustomerName
	orderReq.Customer.Email = req.CustomerEmail
	orderReq.Customer.Phone = req.CustomerPhone
	if req.Note != "" || req.CustomerUPI != "" {
		orderReq.Metadata = map[string]interface{}{
			"note":         req.Note,
			"customer_upi": req.CustomerUPI,
			"type":         kind,
		}
	}

	order, err := s.ordersSvc.Create(ctx, clientID, orderReq)
	if err != nil {
		return nil, err
	}

	return s.InitiatePayment(ctx, clientID, order.GatewayOrderID)
}

// GetByGatewayID fetches payment by gateway ID (client scoped).
func (s *Service) GetByGatewayID(ctx context.Context, gatewayPaymentID, clientID string) (*Payment, error) {
	var p Payment
	var merchantID, provPayID, provTxnID, provTxnRef, failReason sql.NullString
	err := s.db.QueryRowContext(ctx,
		`SELECT p.id, p.gateway_payment_id, o.gateway_order_id, o.client_order_id, p.client_id,
		        p.processing_merchant_id, p.amount, p.currency, p.status, p.provider_payment_id,
		        p.provider_transaction_id, p.provider_transaction_ref, p.failure_reason,
		        p.finalized_at, p.created_at, p.updated_at
		 FROM payments p
		 JOIN orders o ON o.id = p.order_id
		 WHERE p.gateway_payment_id = $1 AND p.client_id = $2`,
		gatewayPaymentID, clientID,
	).Scan(&p.ID, &p.GatewayPaymentID, &p.GatewayOrderID, &p.ClientOrderID, &p.ClientID,
		&merchantID, &p.Amount, &p.Currency, &p.Status, &provPayID,
		&provTxnID, &provTxnRef, &failReason,
		&p.FinalizedAt, &p.CreatedAt, &p.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("PAYMENT_NOT_FOUND: payment not found")
	}
	if err != nil {
		return nil, err
	}
	p.ProcessingMerchantID = merchantID.String
	p.ProviderPaymentID = provPayID.String
	p.ProviderTransactionID = provTxnID.String
	p.ProviderTransactionRef = provTxnRef.String
	p.FailureReason = failReason.String
	return &p, nil
}

// GetPublic fetches payment for the hosted payment page (no client auth required).
func (s *Service) GetPublic(ctx context.Context, gatewayPaymentID string) (*Payment, error) {
	// First open of pay page starts the 1.5-minute session timer.
	_ = s.ensurePaySessionStarted(ctx, gatewayPaymentID)

	var p Payment
	var merchantID, provPayID, provTxnID, provTxnRef, failReason sql.NullString
	var expiresAt time.Time
	var businessName, logoURL, brandColor, upiVPA sql.NullString
	var watchedAt sql.NullTime
	err := s.db.QueryRowContext(ctx,
		`SELECT p.id, p.gateway_payment_id, o.gateway_order_id, o.client_order_id, p.client_id,
		        p.processing_merchant_id, p.amount, p.currency, p.status, p.provider_payment_id,
		        p.provider_transaction_id, p.provider_transaction_ref, p.failure_reason,
		        p.finalized_at, p.created_at, p.updated_at, o.expires_at, c.business_name,
		        c.logo_url, c.brand_color, c.upi_vpa, p.last_watched_at
		 FROM payments p
		 JOIN orders o ON o.id = p.order_id
		 JOIN clients c ON c.id = p.client_id
		 WHERE p.gateway_payment_id = $1`,
		gatewayPaymentID,
	).Scan(&p.ID, &p.GatewayPaymentID, &p.GatewayOrderID, &p.ClientOrderID, &p.ClientID,
		&merchantID, &p.Amount, &p.Currency, &p.Status, &provPayID,
		&provTxnID, &provTxnRef, &failReason,
		&p.FinalizedAt, &p.CreatedAt, &p.UpdatedAt, &expiresAt, &businessName,
		&logoURL, &brandColor, &upiVPA, &watchedAt)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("PAYMENT_NOT_FOUND")
	}
	if err != nil {
		return nil, err
	}
	p.ProcessingMerchantID = merchantID.String
	p.ProviderPaymentID = provPayID.String
	p.ProviderTransactionID = provTxnID.String
	p.ProviderTransactionRef = provTxnRef.String
	p.FailureReason = failReason.String
	if watchedAt.Valid {
		t := watchedAt.Time
		p.LastWatchedAt = &t
	}

	pn := businessName.String
	if pn == "" {
		pn = "Merchant"
	}
	vpa := s.resolveMerchantVPA(ctx, merchantID.String, upiVPA.String)
	p.ExpiresAt = &expiresAt
	p.MerchantName = pn
	p.MerchantLogoURL = logoURL.String
	p.BrandColor = brandColor.String
	if p.BrandColor == "" {
		p.BrandColor = "#6726A8"
	}
	p.MerchantUPIVPA = vpa
	p.PaymentURL = fmt.Sprintf("%s/pay/%s", s.gatewayURL, p.GatewayPaymentID)

	// Session timer elapsed → mark FAILED (poll / page open pe)
	if err := s.failIfTimedOut(ctx, &p); err != nil {
		return nil, err
	}
	if p.Status == "FAILED" || p.Status == "EXPIRED" || p.Status == "SUCCESS" {
		return &p, nil
	}

	// Load existing intent. NEVER rotate a code that already exists while payment is still open —
	// rotating breaks QR/app notes already shown to the customer (extension won't match).
	var intentCode sql.NullString
	var intentExp sql.NullTime
	_ = s.db.QueryRowContext(ctx,
		`SELECT intent_code, intent_code_expires_at FROM payments WHERE id = $1`, p.ID,
	).Scan(&intentCode, &intentExp)

	if p.Status == "PENDING" || p.Status == "CREATED" || p.Status == "PENDING_REVIEW" {
		if !intentCode.Valid || intentCode.String == "" {
			if err := s.rotateIntentCode(ctx, &p, pn, vpa, true); err != nil {
				return nil, err
			}
		} else {
			p.IntentCode = intentCode.String
			// Keep same GW code; extend validity to cover the active pay session.
			exp := time.Now().Add(intentTTL)
			if p.ExpiresAt != nil && p.ExpiresAt.After(exp) {
				exp = *p.ExpiresAt
			}
			_, _ = s.db.ExecContext(ctx,
				`UPDATE payments SET intent_code_expires_at = $1, updated_at = NOW() WHERE id = $2`,
				exp, p.ID,
			)
			p.IntentCodeExpiresAt = &exp
			p.TrackCode = TrackNoteFromCode(p.IntentCode)
			s.applyIntentURL(&p, pn, vpa, p.IntentCode)
		}
	} else {
		// Finalized — do not expose live pay intents
		p.UPIIntentURL = ""
		p.QRData = ""
		p.IntentCode = ""
	}
	return &p, nil
}

// paySessionTTL is the countdown after the customer opens the hosted pay page.
const paySessionTTL = 20 * time.Minute

// intentTTL matches the pay-session window (refresh QR within the same session).
const intentTTL = paySessionTTL

// ensurePaySessionStarted starts the pay timer on first page open.
// Unopened links keep a long expires_at (24h) so they do not fail before viewing.
func (s *Service) ensurePaySessionStarted(ctx context.Context, gatewayPaymentID string) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE payments SET last_watched_at = NOW(), updated_at = NOW()
		 WHERE gateway_payment_id = $1
		   AND last_watched_at IS NULL
		   AND status IN ('PENDING', 'CREATED', 'PENDING_REVIEW')`,
		gatewayPaymentID,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil
	}
	_, err = s.db.ExecContext(ctx,
		`UPDATE orders SET expires_at = NOW() + INTERVAL '20 minutes', updated_at = NOW()
		 WHERE id = (SELECT order_id FROM payments WHERE gateway_payment_id = $1)`,
		gatewayPaymentID,
	)
	if err != nil {
		return err
	}
	// Lock the same intent/QR track for the whole session window
	_, err = s.db.ExecContext(ctx,
		`UPDATE payments SET intent_code_expires_at = NOW() + INTERVAL '20 minutes', updated_at = NOW()
		 WHERE gateway_payment_id = $1 AND COALESCE(intent_code, '') <> ''`,
		gatewayPaymentID,
	)
	return err
}

// failIfTimedOut marks open payments FAILED when the pay-session timer has elapsed.
func (s *Service) failIfTimedOut(ctx context.Context, p *Payment) error {
	if p == nil || p.ExpiresAt == nil {
		return nil
	}
	switch p.Status {
	case "PENDING", "CREATED", "PENDING_REVIEW":
	default:
		return nil
	}
	// Session not started yet (still on long idle expires_at) — do not fail.
	if p.LastWatchedAt == nil {
		return nil
	}
	if !time.Now().After(*p.ExpiresAt) {
		return nil
	}
	reason := "Payment timed out after 20 minutes"
	if err := s.TransitionState(ctx, p.ID, "FAILED", map[string]interface{}{
		"failure_reason": reason,
	}); err != nil {
		var st, fr string
		_ = s.db.QueryRowContext(ctx,
			`SELECT status, COALESCE(failure_reason,'') FROM payments WHERE id = $1`, p.ID,
		).Scan(&st, &fr)
		if st != "" {
			p.Status = st
			p.FailureReason = fr
		}
		return nil
	}
	p.Status = "FAILED"
	p.FailureReason = reason
	_, _ = s.db.ExecContext(ctx,
		`UPDATE orders SET status = 'FAILED', updated_at = NOW()
		 WHERE id = (SELECT order_id FROM payments WHERE id = $1)`, p.ID)
	return nil
}

// FreshIntent returns a live UPI intent/QR. Reuses the same track code for the whole
// pay session so Paytm remarks still match extension pending (do NOT rotate every tap).
func (s *Service) FreshIntent(ctx context.Context, gatewayPaymentID string) (*Payment, error) {
	p, err := s.GetPublic(ctx, gatewayPaymentID)
	if err != nil {
		return nil, err
	}
	if p.Status != "PENDING" && p.Status != "CREATED" && p.Status != "PENDING_REVIEW" {
		return nil, fmt.Errorf("PAYMENT_NOT_PAYABLE: payment is %s", p.Status)
	}
	// force=false → keep existing intent_code until TTL expires
	if err := s.rotateIntentCode(ctx, p, p.MerchantName, p.MerchantUPIVPA, false); err != nil {
		return nil, err
	}
	return p, nil
}

func (s *Service) rotateIntentCode(ctx context.Context, p *Payment, pn, vpa string, force bool) error {
	// Keep the same track for the whole open payment unless force=true.
	// Expiry alone must NEVER mint a new GW — QR/app notes would stop matching Paytm.
	if !force && p.IntentCode != "" {
		exp := time.Now().Add(intentTTL)
		if p.ExpiresAt != nil && p.ExpiresAt.After(exp) {
			exp = *p.ExpiresAt
		}
		_, _ = s.db.ExecContext(ctx,
			`UPDATE payments SET intent_code_expires_at = $1, updated_at = NOW() WHERE id = $2`,
			exp, p.ID,
		)
		p.IntentCodeExpiresAt = &exp
		p.TrackCode = TrackNoteFromCode(p.IntentCode)
		s.applyIntentURL(p, pn, vpa, p.IntentCode)
		return nil
	}
	// Preserve previous codes so late Paytm notes still resolve after a rare rotate
	prev := p.IntentCode
	code, err := randomIntentCode()
	if err != nil {
		return err
	}
	exp := time.Now().Add(intentTTL)
	_, err = s.db.ExecContext(ctx,
		`UPDATE payments SET
		   intent_code = $1,
		   intent_code_expires_at = $2,
		   metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
		     'intent_history', (
		       SELECT jsonb_agg(DISTINCT x)
		       FROM (
		         SELECT jsonb_array_elements_text(COALESCE(metadata->'intent_history', '[]'::jsonb)) AS x
		         UNION SELECT $4::text
		         UNION SELECT $1::text
		       ) s
		       WHERE x IS NOT NULL AND x <> ''
		     )
		   ),
		   updated_at = NOW()
		 WHERE id = $3`,
		code, exp, p.ID, prev,
	)
	if err != nil {
		// Fallback without history if jsonb path fails on older rows
		_, err = s.db.ExecContext(ctx,
			`UPDATE payments SET intent_code = $1, intent_code_expires_at = $2, updated_at = NOW() WHERE id = $3`,
			code, exp, p.ID,
		)
		if err != nil {
			return fmt.Errorf("rotate intent: %w", err)
		}
	}
	p.IntentCode = code
	p.IntentCodeExpiresAt = &exp
	p.TrackCode = TrackNoteFromCode(code)
	s.applyIntentURL(p, pn, vpa, code)
	return nil
}

func (s *Service) applyIntentURL(p *Payment, pn, vpa, code string) {
	if vpa == "" {
		vpa = "mock@upi"
	}
	if pn == "" {
		pn = "Merchant"
	}
	// Short UPI remark so Paytm Business "details / notes" can show a matchable track id.
	// Format: GW + 8 hex (e.g. GWA1B2C3D4) — maps to payments.intent_code
	tn := TrackNoteFromCode(code)
	am := float64(p.Amount) / 100
	cu := p.Currency
	if cu == "" {
		cu = "INR"
	}
	// Same shape as working checkout sites: pa keeps @, order pa/pn/am/cu/tn, no tr.
	pnQ := strings.ReplaceAll(pn, " ", "%20")
	raw := fmt.Sprintf("upi://pay?pa=%s&pn=%s&am=%.2f&cu=%s&tn=%s", vpa, pnQ, am, cu, tn)
	p.UPIIntentURL = raw
	p.QRData = raw
}

// TrackNoteFromCode builds the UPI tn / remarks value merchants can spot in Paytm details.
func TrackNoteFromCode(code string) string {
	code = strings.TrimSpace(code)
	if code == "" {
		return ""
	}
	if strings.HasPrefix(strings.ToUpper(code), "GW") {
		return strings.ToUpper(code)
	}
	return "GW" + strings.ToUpper(code)
}

func randomIntentCode() (string, error) {
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return strings.ToUpper(hex.EncodeToString(b)), nil // 8 hex chars
}

func (s *Service) List(ctx context.Context, clientID string, limit, offset int) ([]Payment, int, error) {
	var total int
	s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM payments WHERE client_id = $1`, clientID).Scan(&total)

	rows, err := s.db.QueryContext(ctx,
		`SELECT p.id, p.gateway_payment_id, o.gateway_order_id, o.client_order_id, p.client_id,
		        p.processing_merchant_id, p.amount, p.currency, p.status, p.provider_payment_id,
		        p.provider_transaction_id, p.provider_transaction_ref, p.failure_reason,
		        p.finalized_at, p.created_at, p.updated_at
		 FROM payments p JOIN orders o ON o.id = p.order_id
		 WHERE p.client_id = $1 ORDER BY p.created_at DESC LIMIT $2 OFFSET $3`,
		clientID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var list []Payment
	for rows.Next() {
		var p Payment
		var merchantID, provPayID, provTxnID, provTxnRef, failReason sql.NullString
		rows.Scan(&p.ID, &p.GatewayPaymentID, &p.GatewayOrderID, &p.ClientOrderID, &p.ClientID,
			&merchantID, &p.Amount, &p.Currency, &p.Status, &provPayID,
			&provTxnID, &provTxnRef, &failReason,
			&p.FinalizedAt, &p.CreatedAt, &p.UpdatedAt)
		p.ProcessingMerchantID = merchantID.String
		p.ProviderPaymentID = provPayID.String
		p.ProviderTransactionRef = provTxnRef.String
		p.FailureReason = failReason.String
		list = append(list, p)
	}
	return list, total, nil
}

// AgentScope limits verifier access. Same Paytm VPA = same merchant: any bound
// agent on that VPA can confirm any client's GW on that merchant (many Chromes, one config).
type AgentScope struct {
	ClientID             string
	ProcessingMerchantID string
	UPIVPA               string
}

func (s *Service) FillAgentScope(ctx context.Context, scope AgentScope) AgentScope {
	vpa := strings.ToLower(strings.TrimSpace(scope.UPIVPA))
	if vpa == "" && scope.ProcessingMerchantID != "" {
		_ = s.db.QueryRowContext(ctx,
			`SELECT lower(trim(upi_vpa)) FROM processing_merchants WHERE id = $1`,
			scope.ProcessingMerchantID,
		).Scan(&vpa)
	}
	if vpa == "" && scope.ClientID != "" {
		_ = s.db.QueryRowContext(ctx,
			`SELECT lower(trim(pm.upi_vpa))
			 FROM client_processing_routes r
			 JOIN processing_merchants pm ON pm.id = r.processing_merchant_id
			 WHERE r.client_id = $1 AND r.status = 'ACTIVE' AND COALESCE(trim(pm.upi_vpa),'') <> ''
			 ORDER BY r.priority ASC LIMIT 1`,
			scope.ClientID,
		).Scan(&vpa)
	}
	scope.UPIVPA = strings.ToLower(strings.TrimSpace(vpa))
	return scope
}

func appendAgentScopeSQL(q string, args []interface{}, i int, scope AgentScope, pAlias string) (string, []interface{}, int) {
	vpa := strings.ToLower(strings.TrimSpace(scope.UPIVPA))
	if vpa != "" {
		q += fmt.Sprintf(` AND %s.processing_merchant_id IN (
		     SELECT id FROM processing_merchants
		     WHERE lower(trim(upi_vpa)) = $%d AND COALESCE(trim(upi_vpa),'') <> '')`, pAlias, i)
		return q, append(args, vpa), i + 1
	}
	if scope.ClientID != "" {
		q += fmt.Sprintf(` AND %s.client_id = $%d`, pAlias, i)
		args = append(args, scope.ClientID)
		i++
	}
	if scope.ProcessingMerchantID != "" {
		q += fmt.Sprintf(` AND %s.processing_merchant_id = $%d`, pAlias, i)
		args = append(args, scope.ProcessingMerchantID)
		i++
	}
	return q, args, i
}

func (s *Service) PaymentAllowedForAgent(ctx context.Context, processingMerchantID, paymentClientID string, scope AgentScope) bool {
	scope = s.FillAgentScope(ctx, scope)
	if scope.UPIVPA != "" {
		var vpa string
		_ = s.db.QueryRowContext(ctx,
			`SELECT lower(trim(upi_vpa)) FROM processing_merchants WHERE id = $1`,
			processingMerchantID,
		).Scan(&vpa)
		return vpa != "" && vpa == scope.UPIVPA
	}
	if scope.ClientID != "" && paymentClientID != scope.ClientID {
		return false
	}
	if scope.ProcessingMerchantID != "" && processingMerchantID != scope.ProcessingMerchantID {
		return false
	}
	return scope.ClientID != "" || scope.ProcessingMerchantID != ""
}

// ListPendingForAgent returns open payments for the verifier extension.
// Same UPI VPA = same Paytm merchant — all clients on that VPA are included.
func (s *Service) ListPendingForAgent(ctx context.Context, scope AgentScope, limit int) ([]Payment, error) {
	// Expire timed-out sessions so extension does not fetch dead links.
	_ = s.ExpireStalePaySessions(ctx)

	scope = s.FillAgentScope(ctx, scope)
	if strings.TrimSpace(scope.ClientID) == "" && strings.TrimSpace(scope.ProcessingMerchantID) == "" && scope.UPIVPA == "" {
		return nil, fmt.Errorf("AGENT_SCOPE_REQUIRED: bind agent to a client before listing pending payments")
	}
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	q := `SELECT p.gateway_payment_id, o.client_order_id, p.amount, p.currency, p.status, p.created_at,
		        COALESCE(c.business_name, ''), COALESCE(p.intent_code, ''), p.last_watched_at
		 FROM payments p
		 JOIN orders o ON o.id = p.order_id
		 JOIN clients c ON c.id = p.client_id
		 WHERE (
		     p.status IN ('PENDING', 'CREATED', 'PENDING_REVIEW')
		     OR (
		       p.status IN ('FAILED', 'EXPIRED')
		       AND COALESCE(p.failure_reason,'') ILIKE '%timed out%'
		       AND p.updated_at > NOW() - INTERVAL '30 minutes'
		     )
		   )
		   AND p.created_at > NOW() - INTERVAL '24 hours'`
	args := []interface{}{}
	i := 1
	q, args, i = appendAgentScopeSQL(q, args, i, scope, "p")
	q += fmt.Sprintf(` ORDER BY p.last_watched_at DESC NULLS LAST, p.created_at DESC LIMIT $%d`, i)
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []Payment
	for rows.Next() {
		var p Payment
		var name string
		var watched sql.NullTime
		if err := rows.Scan(&p.GatewayPaymentID, &p.ClientOrderID, &p.Amount, &p.Currency, &p.Status, &p.CreatedAt, &name, &p.IntentCode, &watched); err != nil {
			return nil, err
		}
		p.MerchantName = name
		p.TrackCode = TrackNoteFromCode(p.IntentCode)
		if watched.Valid {
			t := watched.Time
			p.LastWatchedAt = &t
		}
		list = append(list, p)
	}
	return list, nil
}

// ExpireStalePaySessions marks opened pay sessions FAILED after the pay timer.
func (s *Service) ExpireStalePaySessions(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE payments p
		 SET status = 'FAILED',
		     failure_reason = 'Payment timed out after 20 minutes',
		     finalized_at = COALESCE(p.finalized_at, NOW()),
		     updated_at = NOW()
		 FROM orders o
		 WHERE p.order_id = o.id
		   AND p.status IN ('PENDING', 'CREATED')
		   AND p.last_watched_at IS NOT NULL
		   AND COALESCE(p.provider_transaction_ref, '') = ''
		   AND (
		     o.expires_at < NOW()
		     OR p.last_watched_at < NOW() - INTERVAL '25 minutes'
		   )`)
	if err != nil {
		return err
	}
	_, _ = s.db.ExecContext(ctx,
		`UPDATE orders o
		 SET status = 'FAILED', updated_at = NOW()
		 FROM payments p
		 WHERE p.order_id = o.id
		   AND p.status = 'FAILED'
		   AND p.failure_reason LIKE 'Payment timed out%'
		   AND o.status IN ('CREATED', 'PENDING')`)
	return nil
}

// MarkWatched records that the hosted pay page was opened (watch history + start timer).
func (s *Service) MarkWatched(ctx context.Context, gatewayPaymentID string) (*Payment, error) {
	if err := s.ensurePaySessionStarted(ctx, gatewayPaymentID); err != nil {
		return nil, err
	}
	// Touch watch timestamp on every open (even after session already started).
	res, err := s.db.ExecContext(ctx,
		`UPDATE payments SET last_watched_at = NOW(), updated_at = NOW()
		 WHERE gateway_payment_id = $1`, gatewayPaymentID)
	if err != nil {
		return nil, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, fmt.Errorf("PAYMENT_NOT_FOUND: unknown payment")
	}
	return s.GetPublic(ctx, gatewayPaymentID)
}

// ListWatchHistory returns payments whose pay page was opened (any status).
// clientID is REQUIRED — never returns cross-tenant history.
// ListWatchHistory returns this client's payment links / API pays (opened or not).
// clientID is REQUIRED — never returns cross-tenant history.
func (s *Service) ListWatchHistory(ctx context.Context, clientID string, limit int) ([]Payment, error) {
	if strings.TrimSpace(clientID) == "" {
		return nil, fmt.Errorf("CLIENT_REQUIRED: watch history is client-scoped")
	}
	if limit <= 0 || limit > 100 {
		limit = 40
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT p.gateway_payment_id, o.client_order_id, p.amount, p.currency, p.status, p.created_at,
		        COALESCE(c.business_name, ''), COALESCE(p.intent_code, ''), p.last_watched_at
		 FROM payments p
		 JOIN orders o ON o.id = p.order_id
		 JOIN clients c ON c.id = p.client_id
		 WHERE p.client_id = $1
		 ORDER BY COALESCE(p.last_watched_at, p.created_at) DESC
		 LIMIT $2`,
		clientID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []Payment
	for rows.Next() {
		var p Payment
		var name string
		var watched sql.NullTime
		if err := rows.Scan(&p.GatewayPaymentID, &p.ClientOrderID, &p.Amount, &p.Currency, &p.Status, &p.CreatedAt, &name, &p.IntentCode, &watched); err != nil {
			return nil, err
		}
		p.MerchantName = name
		p.TrackCode = TrackNoteFromCode(p.IntentCode)
		if watched.Valid {
			t := watched.Time
			p.LastWatchedAt = &t
		}
		list = append(list, p)
	}
	return list, nil
}

// ListWatchHistoryForAgent is merchant-VPA scoped (many Chromes / many clients, one Paytm).
func (s *Service) ListWatchHistoryForAgent(ctx context.Context, scope AgentScope, limit int) ([]Payment, error) {
	scope = s.FillAgentScope(ctx, scope)
	if strings.TrimSpace(scope.ClientID) == "" && strings.TrimSpace(scope.ProcessingMerchantID) == "" && scope.UPIVPA == "" {
		return nil, fmt.Errorf("AGENT_SCOPE_REQUIRED: bind agent to a client before listing watch history")
	}
	if limit <= 0 || limit > 100 {
		limit = 40
	}
	q := `SELECT p.gateway_payment_id, o.client_order_id, p.amount, p.currency, p.status, p.created_at,
		        COALESCE(c.business_name, ''), COALESCE(p.intent_code, ''), p.last_watched_at
		 FROM payments p
		 JOIN orders o ON o.id = p.order_id
		 JOIN clients c ON c.id = p.client_id
		 WHERE p.last_watched_at IS NOT NULL`
	args := []interface{}{}
	i := 1
	q, args, i = appendAgentScopeSQL(q, args, i, scope, "p")
	q += fmt.Sprintf(` ORDER BY p.last_watched_at DESC LIMIT $%d`, i)
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []Payment
	for rows.Next() {
		var p Payment
		var name string
		var watched sql.NullTime
		if err := rows.Scan(&p.GatewayPaymentID, &p.ClientOrderID, &p.Amount, &p.Currency, &p.Status, &p.CreatedAt, &name, &p.IntentCode, &watched); err != nil {
			return nil, err
		}
		p.MerchantName = name
		p.TrackCode = TrackNoteFromCode(p.IntentCode)
		if watched.Valid {
			t := watched.Time
			p.LastWatchedAt = &t
		}
		list = append(list, p)
	}
	return list, nil
}

// FindPendingByTrackCode resolves UPI remark / Paytm details note (GWxxxxxxxx or raw intent_code).
// Also matches recently timed-out payments so the extension can still credit after page expiry.
// When scope has ClientID / merchant, match is restricted to that tenant only.
func (s *Service) FindPendingByTrackCode(ctx context.Context, note string, scope AgentScope) (string, error) {
	note = strings.TrimSpace(strings.ToUpper(note))
	if note == "" {
		return "", fmt.Errorf("PAYMENT_NOT_FOUND: empty track code")
	}
	code := strings.TrimPrefix(note, "GW")
	q := `SELECT gateway_payment_id FROM payments
		 WHERE (
		     status IN ('PENDING', 'CREATED', 'PENDING_REVIEW')
		     OR (
		       status IN ('FAILED', 'EXPIRED')
		       AND failure_reason ILIKE '%timed out%'
		       AND updated_at > NOW() - INTERVAL '30 minutes'
		     )
		   )
		   AND (
		     UPPER(intent_code) = $1
		     OR UPPER(intent_code) = $2
		     OR UPPER(gateway_payment_id) = $1
		     OR EXISTS (
		       SELECT 1 FROM jsonb_array_elements_text(COALESCE(metadata->'intent_history', '[]'::jsonb)) h
		       WHERE UPPER(h) = $1 OR UPPER(h) = $2
		     )
		   )`
	args := []interface{}{note, code}
	i := 3
	q, args, _ = appendAgentScopeSQL(q, args, i, s.FillAgentScope(ctx, scope), "payments")
	q += ` ORDER BY created_at DESC LIMIT 1`

	var gwID string
	err := s.db.QueryRowContext(ctx, q, args...).Scan(&gwID)
	if err == sql.ErrNoRows {
		return "", fmt.Errorf("PAYMENT_NOT_FOUND: no pending payment for track code")
	}
	return gwID, err
}

// GetForAgent loads a payment for extension verification without starting/expiring the pay session.
func (s *Service) GetForAgent(ctx context.Context, gatewayPaymentID string) (*Payment, error) {
	var p Payment
	var merchantID, provPayID, provTxnID, provTxnRef, failReason sql.NullString
	var intent sql.NullString
	err := s.db.QueryRowContext(ctx,
		`SELECT p.id, p.gateway_payment_id, o.gateway_order_id, o.client_order_id, p.client_id,
		        p.processing_merchant_id, p.amount, p.currency, p.status, p.provider_payment_id,
		        p.provider_transaction_id, p.provider_transaction_ref, p.failure_reason,
		        p.finalized_at, p.created_at, p.updated_at, COALESCE(p.intent_code, '')
		 FROM payments p
		 JOIN orders o ON o.id = p.order_id
		 WHERE p.gateway_payment_id = $1`,
		gatewayPaymentID,
	).Scan(&p.ID, &p.GatewayPaymentID, &p.GatewayOrderID, &p.ClientOrderID, &p.ClientID,
		&merchantID, &p.Amount, &p.Currency, &p.Status, &provPayID,
		&provTxnID, &provTxnRef, &failReason,
		&p.FinalizedAt, &p.CreatedAt, &p.UpdatedAt, &intent)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("PAYMENT_NOT_FOUND")
	}
	if err != nil {
		return nil, err
	}
	p.ProcessingMerchantID = merchantID.String
	p.ProviderPaymentID = provPayID.String
	p.ProviderTransactionID = provTxnID.String
	p.ProviderTransactionRef = provTxnRef.String
	p.FailureReason = failReason.String
	p.IntentCode = intent.String
	p.TrackCode = TrackNoteFromCode(p.IntentCode)
	return &p, nil
}

// TransitionState validates and applies a payment state transition.
func (s *Service) TransitionState(ctx context.Context, paymentID, toStatus string, updates map[string]interface{}) error {
	var currentStatus string
	err := s.db.QueryRowContext(ctx, `SELECT status FROM payments WHERE id = $1 FOR UPDATE`, paymentID).Scan(&currentStatus)
	if err != nil {
		return fmt.Errorf("payment not found: %w", err)
	}

	allowed := validTransitions[currentStatus]
	valid := false
	for _, s := range allowed {
		if s == toStatus {
			valid = true
			break
		}
	}
	if !valid {
		return fmt.Errorf("invalid transition %s -> %s", currentStatus, toStatus)
	}

	setClauses := "status = $1, updated_at = NOW()"
	args := []interface{}{toStatus}
	i := 2

	if toStatus == "SUCCESS" || toStatus == "FAILED" || toStatus == "EXPIRED" {
		setClauses += fmt.Sprintf(", finalized_at = $%d", i)
		args = append(args, time.Now())
		i++
	}

	for k, v := range updates {
		if k == "provider_transaction_ref" {
			setClauses += fmt.Sprintf(", provider_transaction_ref = $%d", i)
			args = append(args, v)
			i++
		} else if k == "provider_transaction_id" {
			setClauses += fmt.Sprintf(", provider_transaction_id = $%d", i)
			args = append(args, v)
			i++
		} else if k == "failure_reason" {
			setClauses += fmt.Sprintf(", failure_reason = $%d", i)
			args = append(args, v)
			i++
		}
	}

	args = append(args, paymentID)
	_, err = s.db.ExecContext(ctx,
		fmt.Sprintf("UPDATE payments SET %s WHERE id = $%d", setClauses, i),
		args...)
	return err
}

// AdminList returns all payments (admin only) with GW track + owning shop.
func (s *Service) AdminList(ctx context.Context, status string, limit, offset int) ([]Payment, int, error) {
	if limit <= 0 || limit > 200 {
		limit = 80
	}
	query := `SELECT p.id, p.gateway_payment_id, o.gateway_order_id, o.client_order_id, p.client_id,
	                 p.processing_merchant_id, p.amount, p.currency, p.status, p.provider_payment_id,
	                 p.provider_transaction_id, p.provider_transaction_ref, p.failure_reason,
	                 p.finalized_at, p.created_at, p.updated_at,
	                 COALESCE(p.intent_code, ''), COALESCE(c.business_name, ''), COALESCE(c.email, ''),
	                 p.last_watched_at
	          FROM payments p
	          JOIN orders o ON o.id = p.order_id
	          JOIN clients c ON c.id = p.client_id`
	countQ := `SELECT COUNT(*) FROM payments p`
	args := []interface{}{}

	if status != "" {
		query += " WHERE p.status = $1"
		countQ += " WHERE p.status = $1"
		args = append(args, status)
	}
	query += fmt.Sprintf(" ORDER BY p.created_at DESC LIMIT %d OFFSET %d", limit, offset)

	var total int
	s.db.QueryRowContext(ctx, countQ, args...).Scan(&total)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var list []Payment
	for rows.Next() {
		var p Payment
		var merchantID, provPayID, provTxnID, provTxnRef, failReason sql.NullString
		var watched sql.NullTime
		rows.Scan(&p.ID, &p.GatewayPaymentID, &p.GatewayOrderID, &p.ClientOrderID, &p.ClientID,
			&merchantID, &p.Amount, &p.Currency, &p.Status, &provPayID,
			&provTxnID, &provTxnRef, &failReason,
			&p.FinalizedAt, &p.CreatedAt, &p.UpdatedAt,
			&p.IntentCode, &p.MerchantName, &p.ClientEmail, &watched)
		p.ProcessingMerchantID = merchantID.String
		p.FailureReason = failReason.String
		p.TrackCode = TrackNoteFromCode(p.IntentCode)
		p.PaymentURL = fmt.Sprintf("%s/pay/%s", strings.TrimRight(s.gatewayURL, "/"), p.GatewayPaymentID)
		if watched.Valid {
			t := watched.Time
			p.LastWatchedAt = &t
		}
		list = append(list, p)
	}
	return list, total, nil
}

func generatePaymentID() string {
	return fmt.Sprintf("PAY_%d", time.Now().UnixNano()/1000)
}

// isErrorCode checks prefix
func isErrorCode(err error, code string) bool {
	return err != nil && strings.HasPrefix(err.Error(), code)
}

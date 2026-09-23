package refunds

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/gateway/backend/internal/payment_providers"
	"github.com/gateway/backend/internal/wallet"
)

type Refund struct {
	ID                string     `json:"id"`
	RefundID          string     `json:"refund_id"`
	PaymentID         string     `json:"payment_id"`
	ClientID          string     `json:"client_id"`
	Amount            int64      `json:"amount"`
	Currency          string     `json:"currency"`
	Reason            string     `json:"reason,omitempty"`
	Status            string     `json:"status"`
	ProviderRefundID  string     `json:"provider_refund_id,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
}

type CreateRefundRequest struct {
	PaymentID string `json:"payment_id" binding:"required"`
	Amount    int64  `json:"amount" binding:"required,min=1"`
	Reason    string `json:"reason"`
}

type Service struct {
	db        *sql.DB
	provReg   *payment_providers.Registry
	walletSvc *wallet.Service
}

func NewService(db *sql.DB, provReg *payment_providers.Registry, walletSvc *wallet.Service) *Service {
	return &Service{db: db, provReg: provReg, walletSvc: walletSvc}
}

func (s *Service) Create(ctx context.Context, clientID, initiatedBy string, req CreateRefundRequest) (*Refund, error) {
	// Verify payment belongs to client and is SUCCESS
	var paymentID, gwPayID, provider, provPayID string
	var amount int64
	err := s.db.QueryRowContext(ctx,
		`SELECT p.id, p.gateway_payment_id, pm.provider, p.provider_payment_id, p.amount
		 FROM payments p
		 JOIN processing_merchants pm ON pm.id = p.processing_merchant_id
		 WHERE p.id = $1 AND p.client_id = $2 AND p.status = 'SUCCESS'`,
		req.PaymentID, clientID,
	).Scan(&paymentID, &gwPayID, &provider, &provPayID, &amount)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("payment not found or not eligible for refund")
	}
	if err != nil {
		return nil, err
	}
	if req.Amount > amount {
		return nil, fmt.Errorf("refund amount exceeds payment amount")
	}

	// Check for existing refunds
	var refunded int64
	s.db.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(amount), 0) FROM refunds WHERE payment_id = $1 AND status != 'FAILED'`,
		paymentID,
	).Scan(&refunded)
	if refunded+req.Amount > amount {
		return nil, fmt.Errorf("total refund would exceed original payment amount")
	}

	refundID := fmt.Sprintf("RFD_%d", time.Now().UnixNano()/1000)

	// Mark payment as refund pending
	s.db.ExecContext(ctx,
		`UPDATE payments SET status = 'REFUND_PENDING', updated_at = NOW() WHERE id = $1`, paymentID)

	// Create refund record
	var r Refund
	s.db.QueryRowContext(ctx,
		`INSERT INTO refunds (refund_id, payment_id, client_id, amount, currency, reason, status, initiated_by)
		 VALUES ($1, $2, $3, $4, 'INR', $5, 'PENDING', $6)
		 RETURNING id, refund_id, payment_id, client_id, amount, currency, reason, status, created_at`,
		refundID, paymentID, clientID, req.Amount, req.Reason, initiatedBy,
	).Scan(&r.ID, &r.RefundID, &r.PaymentID, &r.ClientID, &r.Amount, &r.Currency, &r.Reason, &r.Status, &r.CreatedAt)

	// Process with provider
	prov, err := s.provReg.Get(provider)
	if err == nil {
		resp, err := prov.RefundPayment(ctx, payment_providers.RefundRequest{
			ProviderPaymentID: provPayID,
			Amount:            req.Amount,
			Currency:          "INR",
			Reason:            req.Reason,
			RefundID:          refundID,
		})
		if err == nil && resp.Status == "SUCCESS" {
			// Debit wallet
			tx, err := s.db.BeginTx(ctx, nil)
			if err == nil {
				s.walletSvc.DebitTx(ctx, tx, clientID, req.Amount, refundID, "Refund processed")
				tx.Commit()
			}

			s.db.ExecContext(ctx,
				`UPDATE refunds SET status = 'SUCCESS', provider_refund_id = $1 WHERE id = $2`,
				resp.ProviderRefundID, r.ID)
			s.db.ExecContext(ctx,
				`UPDATE payments SET status = 'REFUNDED', updated_at = NOW() WHERE id = $1`, paymentID)
			r.Status = "SUCCESS"
			r.ProviderRefundID = resp.ProviderRefundID
		}
	}

	return &r, nil
}

func (s *Service) List(ctx context.Context, clientID string) ([]Refund, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, refund_id, payment_id, client_id, amount, currency, reason, status, provider_refund_id, created_at
		 FROM refunds WHERE client_id = $1 ORDER BY created_at DESC`,
		clientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []Refund
	for rows.Next() {
		var r Refund
		var reason, provRfID sql.NullString
		rows.Scan(&r.ID, &r.RefundID, &r.PaymentID, &r.ClientID, &r.Amount, &r.Currency,
			&reason, &r.Status, &provRfID, &r.CreatedAt)
		r.Reason = reason.String
		r.ProviderRefundID = provRfID.String
		list = append(list, r)
	}
	return list, nil
}

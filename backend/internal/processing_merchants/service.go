package processing_merchants

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/gateway/backend/pkg/security"
)

type ProcessingMerchant struct {
	ID                   string    `json:"id"`
	MerchantCode         string    `json:"merchant_code"`
	DisplayName          string    `json:"display_name"`
	Provider             string    `json:"provider"`
	Status               string    `json:"status"`
	UPIVPA               string    `json:"upi_vpa,omitempty"`
	PaytmMID             string    `json:"paytm_mid,omitempty"`
	SupportedCurrencies  []string  `json:"supported_currencies"`
	DailyLimit           int64     `json:"daily_limit"`
	TransactionLimit     int64     `json:"transaction_limit"`
	CreatedAt            time.Time `json:"created_at"`
	UpdatedAt            time.Time `json:"updated_at"`
}

type CreateRequest struct {
	MerchantCode        string   `json:"merchant_code" binding:"required"`
	DisplayName         string   `json:"display_name" binding:"required"`
	Provider            string   `json:"provider" binding:"required"`
	UPIVPA              string   `json:"upi_vpa"`
	PaytmMID            string   `json:"paytm_mid"`
	DailyLimit          int64    `json:"daily_limit"`
	TransactionLimit    int64    `json:"transaction_limit"`
	SupportedCurrencies []string `json:"supported_currencies"`
}

type UpdatePaytmRequest struct {
	UPIVPA   string `json:"upi_vpa"`
	PaytmMID string `json:"paytm_mid"`
}

type Credential struct {
	Type  string `json:"type"`
	Value string `json:"value"` // plaintext, will be encrypted
}

type Service struct {
	db            *sql.DB
	encryptionKey string
}

func NewService(db *sql.DB, encKey string) *Service {
	return &Service{db: db, encryptionKey: encKey}
}

func (s *Service) Create(ctx context.Context, req CreateRequest) (*ProcessingMerchant, error) {
	currencies := req.SupportedCurrencies
	if len(currencies) == 0 {
		currencies = []string{"INR"}
	}

	var m ProcessingMerchant
	err := s.db.QueryRowContext(ctx,
		`INSERT INTO processing_merchants (merchant_code, display_name, provider, status, daily_limit, transaction_limit, upi_vpa, paytm_mid)
		 VALUES ($1, $2, $3, 'ACTIVE', $4, $5, NULLIF($6,''), NULLIF($7,''))
		 RETURNING id, merchant_code, display_name, provider, status, daily_limit, transaction_limit, created_at, updated_at`,
		req.MerchantCode, req.DisplayName, req.Provider, req.DailyLimit, req.TransactionLimit, req.UPIVPA, req.PaytmMID,
	).Scan(&m.ID, &m.MerchantCode, &m.DisplayName, &m.Provider, &m.Status,
		&m.DailyLimit, &m.TransactionLimit, &m.CreatedAt, &m.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create merchant: %w", err)
	}
	m.SupportedCurrencies = currencies
	m.UPIVPA = req.UPIVPA
	m.PaytmMID = req.PaytmMID
	return &m, nil
}

func (s *Service) scanMerchant(row interface{ Scan(...interface{}) error }) (*ProcessingMerchant, error) {
	var m ProcessingMerchant
	var upiVPA, paytmMID sql.NullString
	err := row.Scan(&m.ID, &m.MerchantCode, &m.DisplayName, &m.Provider, &m.Status,
		&m.DailyLimit, &m.TransactionLimit, &upiVPA, &paytmMID, &m.CreatedAt, &m.UpdatedAt)
	if err != nil {
		return nil, err
	}
	m.UPIVPA = upiVPA.String
	m.PaytmMID = paytmMID.String
	m.SupportedCurrencies = []string{"INR"}
	return &m, nil
}

func (s *Service) Get(ctx context.Context, id string) (*ProcessingMerchant, error) {
	m, err := s.scanMerchant(s.db.QueryRowContext(ctx,
		`SELECT id, merchant_code, display_name, provider, status, daily_limit, transaction_limit,
		        COALESCE(upi_vpa,''), COALESCE(paytm_mid,''), created_at, updated_at
		 FROM processing_merchants WHERE id = $1`, id))
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("merchant not found")
	}
	return m, err
}

func (s *Service) List(ctx context.Context) ([]ProcessingMerchant, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, merchant_code, display_name, provider, status, daily_limit, transaction_limit,
		        COALESCE(upi_vpa,''), COALESCE(paytm_mid,''), created_at, updated_at
		 FROM processing_merchants ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []ProcessingMerchant
	for rows.Next() {
		m, err := s.scanMerchant(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, *m)
	}
	return list, nil
}

func (s *Service) UpdatePaytm(ctx context.Context, id string, req UpdatePaytmRequest) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE processing_merchants SET upi_vpa = NULLIF($1,''), paytm_mid = NULLIF($2,''), updated_at = NOW()
		 WHERE id = $3`,
		req.UPIVPA, req.PaytmMID, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("merchant not found")
	}
	return nil
}

func (s *Service) UpdateStatus(ctx context.Context, id, status string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE processing_merchants SET status = $1, updated_at = NOW() WHERE id = $2`,
		status, id)
	return err
}

func (s *Service) SetCredential(ctx context.Context, merchantID string, cred Credential) error {
	enc, err := security.EncryptAES256GCM(s.encryptionKey, cred.Value)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO processing_merchant_credentials (merchant_id, credential_type, encrypted_value)
		 VALUES ($1, $2, $3)
		 ON CONFLICT DO NOTHING`,
		merchantID, cred.Type, enc)
	return err
}

func (s *Service) GetCredential(ctx context.Context, merchantID, credType string) (string, error) {
	var enc string
	err := s.db.QueryRowContext(ctx,
		`SELECT encrypted_value FROM processing_merchant_credentials
		 WHERE merchant_id = $1 AND credential_type = $2`,
		merchantID, credType,
	).Scan(&enc)
	if err == sql.ErrNoRows {
		return "", fmt.Errorf("credential not found")
	}
	if err != nil {
		return "", err
	}
	return security.DecryptAES256GCM(s.encryptionKey, enc)
}

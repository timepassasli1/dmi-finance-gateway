package clients

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/gateway/backend/pkg/security"
	"github.com/google/uuid"
)

type Service struct {
	db        *sql.DB
	uploadDir string
}

func NewService(db *sql.DB, uploadDir string) *Service {
	_ = os.MkdirAll(filepath.Join(uploadDir, "logos"), 0o755)
	return &Service{db: db, uploadDir: uploadDir}
}

const clientSelect = `id, client_code, business_name, legal_name, website_url, email, phone,
	logo_url, brand_color, upi_vpa, COALESCE(paytm_mid,''), COALESCE(share_link_token,''),
	status, kyc_status, risk_status, created_at, updated_at`

func (s *Service) GetByID(ctx context.Context, id string) (*Client, error) {
	return s.scanClient(s.db.QueryRowContext(ctx,
		`SELECT `+clientSelect+` FROM clients WHERE id = $1`, id))
}

func (s *Service) GetByUserID(ctx context.Context, userID string) (*Client, error) {
	return s.scanClient(s.db.QueryRowContext(ctx,
		`SELECT c.id, c.client_code, c.business_name, c.legal_name, c.website_url, c.email, c.phone,
		        c.logo_url, c.brand_color, c.upi_vpa, COALESCE(c.paytm_mid,''), COALESCE(c.share_link_token,''),
		        c.status, c.kyc_status, c.risk_status, c.created_at, c.updated_at
		 FROM clients c
		 JOIN client_users cu ON cu.client_id = c.id
		 WHERE cu.user_id = $1`, userID))
}

// GetByShareToken resolves an ACTIVE client from the public caller share token.
func (s *Service) GetByShareToken(ctx context.Context, token string) (*Client, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, fmt.Errorf("client not found")
	}
	return s.scanClient(s.db.QueryRowContext(ctx,
		`SELECT `+clientSelect+` FROM clients WHERE share_link_token = $1 AND status = 'ACTIVE'`, token))
}

// EnsureShareToken returns existing token or creates one.
func (s *Service) EnsureShareToken(ctx context.Context, clientID string) (string, error) {
	c, err := s.GetByID(ctx, clientID)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(c.ShareLinkToken) != "" {
		return c.ShareLinkToken, nil
	}
	return s.RotateShareToken(ctx, clientID)
}

// RotateShareToken issues a new public caller share token.
func (s *Service) RotateShareToken(ctx context.Context, clientID string) (string, error) {
	raw, err := security.GenerateSecureToken("")
	if err != nil {
		return "", err
	}
	// Column is VARCHAR(64); full hex is 64 chars — use first 48 with short prefix.
	tok := "sl_" + raw[:48]
	_, err = s.db.ExecContext(ctx,
		`UPDATE clients SET share_link_token = $1, updated_at = NOW() WHERE id = $2`,
		tok, clientID)
	if err != nil {
		return "", fmt.Errorf("rotate share token: %w", err)
	}
	return tok, nil
}

func (s *Service) UpdateProfile(ctx context.Context, clientID string, req UpdateProfileRequest) (*Client, error) {
	_, err := s.db.ExecContext(ctx,
		`UPDATE clients SET business_name = COALESCE(NULLIF($1,''), business_name),
		  legal_name = COALESCE(NULLIF($2,''), legal_name),
		  website_url = COALESCE(NULLIF($3,''), website_url),
		  phone = COALESCE(NULLIF($4,''), phone),
		  brand_color = COALESCE(NULLIF($5,''), brand_color),
		  upi_vpa = COALESCE(NULLIF($6,''), upi_vpa),
		  paytm_mid = COALESCE(NULLIF($7,''), paytm_mid),
		  updated_at = NOW()
		 WHERE id = $8`,
		req.BusinessName, req.LegalName, req.WebsiteURL, req.Phone, req.BrandColor, req.UPIVPA, req.PaytmMID, clientID)
	if err != nil {
		return nil, fmt.Errorf("update profile: %w", err)
	}
	// Sync merchant display_name only when this client is the sole ACTIVE route to that merchant.
	// Shared merchants (multiple clients → one VPA) must keep their own label.
	if strings.TrimSpace(req.BusinessName) != "" {
		_, _ = s.db.ExecContext(ctx,
			`UPDATE processing_merchants pm
			 SET display_name = $1, updated_at = NOW()
			 FROM client_processing_routes cr
			 WHERE cr.processing_merchant_id = pm.id
			   AND cr.client_id = $2
			   AND cr.status = 'ACTIVE'
			   AND (
			     SELECT COUNT(*) FROM client_processing_routes r2
			     WHERE r2.processing_merchant_id = pm.id AND r2.status = 'ACTIVE'
			   ) = 1`,
			strings.TrimSpace(req.BusinessName), clientID,
		)
	}
	return s.GetByID(ctx, clientID)
}

func (s *Service) UpdateLogo(ctx context.Context, clientID, logoURL string) (*Client, error) {
	_, err := s.db.ExecContext(ctx,
		`UPDATE clients SET logo_url = $1, updated_at = NOW() WHERE id = $2`,
		logoURL, clientID)
	if err != nil {
		return nil, err
	}
	return s.GetByID(ctx, clientID)
}

func (s *Service) SaveLogoFile(clientID, filename string, r io.Reader) (string, error) {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg":
	default:
		return "", fmt.Errorf("unsupported logo type (use png/jpg/webp)")
	}
	name := fmt.Sprintf("%s_%s%s", clientID, uuid.New().String()[:8], ext)
	dir := filepath.Join(s.uploadDir, "logos")
	_ = os.MkdirAll(dir, 0o755)
	path := filepath.Join(dir, name)
	f, err := os.Create(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	if _, err := io.Copy(f, r); err != nil {
		return "", err
	}
	return "/uploads/logos/" + name, nil
}

func (s *Service) List(ctx context.Context, status string, limit, offset int) ([]Client, int, error) {
	query := `SELECT ` + clientSelect + ` FROM clients`
	countQuery := `SELECT COUNT(*) FROM clients`
	args := []interface{}{}

	if status != "" {
		query += " WHERE status = $1"
		countQuery += " WHERE status = $1"
		args = append(args, status)
	}
	query += fmt.Sprintf(" ORDER BY created_at DESC LIMIT %d OFFSET %d", limit, offset)

	var total int
	s.db.QueryRowContext(ctx, countQuery, args...).Scan(&total)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var list []Client
	for rows.Next() {
		c, err := s.scanClientRow(rows)
		if err != nil {
			return nil, 0, err
		}
		list = append(list, *c)
	}
	return list, total, nil
}

func (s *Service) Approve(ctx context.Context, clientID, adminID string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE clients SET status = 'ACTIVE', kyc_status = 'APPROVED', updated_at = NOW()
		 WHERE id = $1`, clientID)
	return err
}

func (s *Service) Reject(ctx context.Context, clientID, reason string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE clients SET status = 'REJECTED', kyc_status = 'REJECTED', updated_at = NOW()
		 WHERE id = $1`, clientID)
	return err
}

func (s *Service) Suspend(ctx context.Context, clientID, reason string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE clients SET status = 'SUSPENDED', updated_at = NOW()
		 WHERE id = $1`, clientID)
	return err
}

func (s *Service) Activate(ctx context.Context, clientID string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE clients SET status = 'ACTIVE', updated_at = NOW()
		 WHERE id = $1`, clientID)
	return err
}

func (s *Service) SubmitForReview(ctx context.Context, clientID string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE clients SET status = 'UNDER_REVIEW', kyc_status = 'SUBMITTED', updated_at = NOW()
		 WHERE id = $1 AND status = 'PENDING'`, clientID)
	return err
}

// SetupStatus tracks onboarding checklist progress for the client dashboard.
type SetupStatus struct {
	ProfileComplete   bool `json:"profile_complete"`
	DocumentsUploaded bool `json:"documents_uploaded"`
	HasAPIKey         bool `json:"has_api_key"`
	HasWebhook        bool `json:"has_webhook"`
	HasSuccessPayment bool `json:"has_success_payment"`
	AccountActive     bool `json:"account_active"`
	StepsComplete     int  `json:"steps_complete"`
	StepsTotal        int  `json:"steps_total"`
	Ready             bool `json:"ready"`
}

func (s *Service) GetSetupStatus(ctx context.Context, clientID string) (*SetupStatus, error) {
	client, err := s.GetByID(ctx, clientID)
	if err != nil {
		return nil, err
	}

	st := &SetupStatus{StepsTotal: 5}
	st.ProfileComplete = client.BusinessName != "" && client.Phone != ""
	st.AccountActive = client.Status == "ACTIVE"

	var docCount int
	_ = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM client_documents WHERE client_id = $1`, clientID).Scan(&docCount)
	st.DocumentsUploaded = docCount > 0

	var keyCount int
	_ = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM client_api_keys WHERE client_id = $1 AND status = 'ACTIVE'`, clientID).Scan(&keyCount)
	st.HasAPIKey = keyCount > 0

	var whCount int
	_ = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM webhooks WHERE client_id = $1 AND is_active = true`, clientID).Scan(&whCount)
	st.HasWebhook = whCount > 0

	var successCount int
	_ = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM payments WHERE client_id = $1 AND status = 'SUCCESS'`, clientID).Scan(&successCount)
	st.HasSuccessPayment = successCount > 0

	if st.ProfileComplete {
		st.StepsComplete++
	}
	if st.DocumentsUploaded {
		st.StepsComplete++
	}
	if st.HasAPIKey {
		st.StepsComplete++
	}
	if st.HasWebhook {
		st.StepsComplete++
	}
	if st.HasSuccessPayment {
		st.StepsComplete++
	}
	st.Ready = st.StepsComplete >= 4 && st.AccountActive
	return st, nil
}

func (s *Service) scanClient(row *sql.Row) (*Client, error) {
	var c Client
	var phone, websiteURL, legalName, logoURL, brandColor, upiVPA, paytmMID, shareTok sql.NullString
	err := row.Scan(&c.ID, &c.ClientCode, &c.BusinessName, &legalName, &websiteURL,
		&c.Email, &phone, &logoURL, &brandColor, &upiVPA, &paytmMID, &shareTok,
		&c.Status, &c.KYCStatus, &c.RiskStatus, &c.CreatedAt, &c.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("client not found")
	}
	if err != nil {
		return nil, err
	}
	c.Phone = phone.String
	c.WebsiteURL = websiteURL.String
	c.LegalName = legalName.String
	c.LogoURL = logoURL.String
	c.BrandColor = brandColor.String
	if c.BrandColor == "" {
		c.BrandColor = "#6726A8"
	}
	c.UPIVPA = upiVPA.String
	c.PaytmMID = paytmMID.String
	c.ShareLinkToken = shareTok.String
	return &c, nil
}

func (s *Service) scanClientRow(rows *sql.Rows) (*Client, error) {
	var c Client
	var phone, websiteURL, legalName, logoURL, brandColor, upiVPA, paytmMID, shareTok sql.NullString
	err := rows.Scan(&c.ID, &c.ClientCode, &c.BusinessName, &legalName, &websiteURL,
		&c.Email, &phone, &logoURL, &brandColor, &upiVPA, &paytmMID, &shareTok,
		&c.Status, &c.KYCStatus, &c.RiskStatus, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return nil, err
	}
	c.Phone = phone.String
	c.WebsiteURL = websiteURL.String
	c.LegalName = legalName.String
	c.LogoURL = logoURL.String
	c.BrandColor = brandColor.String
	if c.BrandColor == "" {
		c.BrandColor = "#6726A8"
	}
	c.UPIVPA = upiVPA.String
	c.PaytmMID = paytmMID.String
	c.ShareLinkToken = shareTok.String
	return &c, nil
}

package auth

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/gateway/backend/pkg/security"
)

type Service struct {
	db      *sql.DB
	jwt     *JWTManager
}

func NewService(db *sql.DB, jwt *JWTManager) *Service {
	return &Service{db: db, jwt: jwt}
}

func (s *Service) Login(ctx context.Context, req LoginRequest) (*TokenResponse, error) {
	var user User
	var hash string
	var clientID sql.NullString
	var phone sql.NullString

	err := s.db.QueryRowContext(ctx,
		`SELECT u.id, u.email, u.phone, u.role, u.status, u.email_verified, u.last_login_at,
		        u.created_at, u.updated_at, u.password_hash,
		        (SELECT cu.client_id::text FROM client_users cu WHERE cu.user_id = u.id LIMIT 1)
		 FROM users u WHERE u.email = $1`,
		req.Email,
	).Scan(&user.ID, &user.Email, &phone, &user.Role, &user.Status,
		&user.EmailVerified, &user.LastLoginAt, &user.CreatedAt, &user.UpdatedAt,
		&hash, &clientID)
	user.Phone = phone.String
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("invalid credentials")
	}
	if err != nil {
		return nil, fmt.Errorf("login query: %w", err)
	}
	if user.Status != "ACTIVE" {
		return nil, fmt.Errorf("account is %s", user.Status)
	}
	if !security.CheckPassword(req.Password, hash) {
		return nil, fmt.Errorf("invalid credentials")
	}

	// Update last login
	s.db.ExecContext(ctx, `UPDATE users SET last_login_at = NOW() WHERE id = $1`, user.ID)

	cid := ""
	if clientID.Valid {
		cid = clientID.String
	}

	token, err := s.jwt.Generate(user.ID, user.Role, cid)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	user.LastLoginAt = &now

	return &TokenResponse{
		AccessToken: token,
		TokenType:   "Bearer",
		ExpiresIn:   900,
		User:        &user,
	}, nil
}

func (s *Service) Register(ctx context.Context, req RegisterRequest) (*User, error) {
	hash, err := security.HashPassword(req.Password)
	if err != nil {
		return nil, err
	}

	// Generate client code
	clientCode, err := security.GenerateSecureToken("CL_")
	if err != nil {
		return nil, err
	}
	clientCode = clientCode[:12]

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	// Use business_name as legal_name if not provided
	if req.LegalName == "" {
		req.LegalName = req.BusinessName
	}

	// Create user
	var userID string
	var phoneVal sql.NullString
	if req.Phone != "" {
		phoneVal = sql.NullString{String: req.Phone, Valid: true}
	}
	err = tx.QueryRowContext(ctx,
		`INSERT INTO users (email, phone, password_hash, role, email_verified)
		 VALUES ($1, $2, $3, 'CLIENT_ADMIN', false) RETURNING id`,
		req.Email, phoneVal, hash,
	).Scan(&userID)
	if err != nil {
		return nil, fmt.Errorf("create user: %w", err)
	}

	// Create client record
	var clientID string
	err = tx.QueryRowContext(ctx,
		`INSERT INTO clients (client_code, business_name, legal_name, website_url, email, phone, status, kyc_status)
		 VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', 'NOT_SUBMITTED') RETURNING id`,
		clientCode, req.BusinessName, req.LegalName, req.WebsiteURL, req.Email, phoneVal,
	).Scan(&clientID)
	if err != nil {
		return nil, fmt.Errorf("create client: %w", err)
	}

	// Create client_user link
	_, err = tx.ExecContext(ctx,
		`INSERT INTO client_users (client_id, user_id) VALUES ($1, $2)`,
		clientID, userID,
	)
	if err != nil {
		return nil, fmt.Errorf("link client user: %w", err)
	}

	// Create wallet account
	_, err = tx.ExecContext(ctx,
		`INSERT INTO wallet_accounts (client_id, currency) VALUES ($1, 'INR')`,
		clientID,
	)
	if err != nil {
		return nil, fmt.Errorf("create wallet: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return &User{
		ID:    userID,
		Email: req.Email,
		Role:  RoleClientAdmin,
	}, nil
}

func (s *Service) GetUser(ctx context.Context, userID string) (*User, error) {
	var user User
	var phone sql.NullString
	err := s.db.QueryRowContext(ctx,
		`SELECT id, email, phone, role, status, email_verified, last_login_at, created_at, updated_at
		 FROM users WHERE id = $1`,
		userID,
	).Scan(&user.ID, &user.Email, &phone, &user.Role, &user.Status,
		&user.EmailVerified, &user.LastLoginAt, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		return nil, err
	}
	user.Phone = phone.String
	return &user, nil
}

// CreateAdminUser creates the initial platform admin (idempotent).
func (s *Service) CreateAdminUser(ctx context.Context, email, password string) error {
	var count int
	s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE role = 'PLATFORM_ADMIN'`).Scan(&count)
	if count > 0 {
		return nil
	}
	hash, err := security.HashPassword(password)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO users (email, password_hash, role, status, email_verified)
		 VALUES ($1, $2, 'PLATFORM_ADMIN', 'ACTIVE', true)
		 ON CONFLICT (email) DO NOTHING`,
		email, hash,
	)
	return err
}

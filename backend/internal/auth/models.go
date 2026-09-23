package auth

import "time"

type User struct {
	ID            string     `json:"id"`
	Email         string     `json:"email"`
	Phone         string     `json:"phone,omitempty"`
	Role          string     `json:"role"`
	Status        string     `json:"status"`
	EmailVerified bool       `json:"email_verified"`
	LastLoginAt   *time.Time `json:"last_login_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

type LoginRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=6"`
}

type RegisterRequest struct {
	Email       string `json:"email" binding:"required,email"`
	Password    string `json:"password" binding:"required,min=8"`
	Phone       string `json:"phone"`
	BusinessName string `json:"business_name" binding:"required"`
	LegalName    string `json:"legal_name"`
	WebsiteURL   string `json:"website_url"`
}

type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	User         *User  `json:"user"`
}

type Claims struct {
	UserID   string `json:"user_id"`
	Role     string `json:"role"`
	ClientID string `json:"client_id,omitempty"`
}

const (
	RolePlatformAdmin = "PLATFORM_ADMIN"
	RoleClientAdmin   = "CLIENT_ADMIN"
	RoleClientStaff   = "CLIENT_STAFF"
)

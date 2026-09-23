package clients

import "time"

type Client struct {
	ID            string    `json:"id"`
	ClientCode    string    `json:"client_code"`
	BusinessName  string    `json:"business_name"`
	LegalName     string    `json:"legal_name"`
	WebsiteURL    string    `json:"website_url"`
	Email         string    `json:"email"`
	Phone         string    `json:"phone"`
	LogoURL       string    `json:"logo_url,omitempty"`
	BrandColor    string    `json:"brand_color,omitempty"`
	UPIVPA         string    `json:"upi_vpa,omitempty"`
	PaytmMID       string    `json:"paytm_mid,omitempty"`
	ShareLinkToken string    `json:"share_link_token,omitempty"`
	Status         string    `json:"status"`
	KYCStatus      string    `json:"kyc_status"`
	RiskStatus     string    `json:"risk_status"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type UpdateProfileRequest struct {
	BusinessName string `json:"business_name"`
	LegalName    string `json:"legal_name"`
	WebsiteURL   string `json:"website_url"`
	Phone        string `json:"phone"`
	BrandColor   string `json:"brand_color"`
	UPIVPA       string `json:"upi_vpa"`
	PaytmMID     string `json:"paytm_mid"`
}

const (
	StatusPending     = "PENDING"
	StatusUnderReview = "UNDER_REVIEW"
	StatusActive      = "ACTIVE"
	StatusSuspended   = "SUSPENDED"
	StatusRejected    = "REJECTED"

	KYCNotSubmitted = "NOT_SUBMITTED"
	KYCSubmitted    = "SUBMITTED"
	KYCUnderReview  = "UNDER_REVIEW"
	KYCApproved     = "APPROVED"
	KYCRejected     = "REJECTED"
)

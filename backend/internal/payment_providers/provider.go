package payment_providers

import "context"

// PaymentProvider is the interface all payment providers must implement.
type PaymentProvider interface {
	Name() string
	CreatePayment(ctx context.Context, req CreatePaymentRequest) (*PaymentResponse, error)
	GetPaymentStatus(ctx context.Context, providerPaymentID string) (*PaymentStatus, error)
	VerifyPayment(ctx context.Context, req VerifyRequest) (*VerificationResult, error)
	RefundPayment(ctx context.Context, req RefundRequest) (*RefundResponse, error)
	CreateQR(ctx context.Context, req QRRequest) (*QRResponse, error)
	CreateIntent(ctx context.Context, req IntentRequest) (*IntentResponse, error)
}

type CreatePaymentRequest struct {
	GatewayPaymentID string
	Amount           int64
	Currency         string
	CustomerName     string
	CustomerEmail    string
	CustomerPhone    string
	Description      string
	MerchantOrderID  string
	Metadata         map[string]interface{}
}

type PaymentResponse struct {
	ProviderPaymentID string
	Status            string
	PaymentURL        string
	QRData            string
	UPIIntentURL      string
	Raw               map[string]interface{}
}

type PaymentStatus struct {
	ProviderPaymentID string
	Status            string
	Amount            int64
	Currency          string
	TransactionRef    string
	Raw               map[string]interface{}
}

type VerifyRequest struct {
	ProviderPaymentID       string
	ProviderTransactionID   string
	ProviderTransactionRef  string
	Amount                  int64
	Currency                string
	GatewayPaymentID        string
}

type VerificationResult struct {
	Status         string // VERIFIED_SUCCESS | VERIFIED_FAILED | PENDING_REVIEW | INVALID
	Amount         int64
	Currency       string
	TransactionRef string
	FailureReason  string
}

type RefundRequest struct {
	ProviderPaymentID string
	Amount            int64
	Currency          string
	Reason            string
	RefundID          string
}

type RefundResponse struct {
	ProviderRefundID string
	Status           string
	Amount           int64
}

type QRRequest struct {
	GatewayPaymentID string
	Amount           int64
	Currency         string
	Description      string
	UPIVpa           string
}

type QRResponse struct {
	QRData  string // base64 PNG or SVG
	UPIURL  string
}

type IntentRequest struct {
	GatewayPaymentID string
	Amount           int64
	Currency         string
	UPIVpa           string
	App              string // phonepe, googlepay, paytm, bhim
}

type IntentResponse struct {
	IntentURL string
	DeepLink  string
}

// VerificationSource is the interface for consuming authorized transaction feeds.
type VerificationSource interface {
	GetNewTransactions(ctx context.Context) ([]TransactionRecord, error)
	GetTransactionDetails(ctx context.Context, ref string) (*TransactionRecord, error)
	ReconcileTransaction(ctx context.Context, ref string) (*TransactionRecord, error)
}

type TransactionRecord struct {
	ProviderRef   string
	Amount        int64
	Currency      string
	Status        string
	Timestamp     int64
	PayerUPIID    string
	PayeeUPIID    string
	Description   string
	Raw           map[string]interface{}
}

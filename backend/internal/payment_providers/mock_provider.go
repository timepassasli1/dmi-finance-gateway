package payment_providers

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// MockPaymentProvider is a development-only provider for testing the full payment flow.
// Never use in production.
type MockPaymentProvider struct {
	// SimulateState controls what the mock returns
	// Values: "success", "failed", "pending", "amount_mismatch"
	SimulateState string
}

func NewMockProvider() *MockPaymentProvider {
	return &MockPaymentProvider{SimulateState: "success"}
}

func (m *MockPaymentProvider) Name() string { return "mock" }

func (m *MockPaymentProvider) CreatePayment(ctx context.Context, req CreatePaymentRequest) (*PaymentResponse, error) {
	providerID := "MOCK_" + uuid.New().String()[:8]
	return &PaymentResponse{
		ProviderPaymentID: providerID,
		Status:            "PENDING",
		PaymentURL:        fmt.Sprintf("/pay/%s", req.GatewayPaymentID),
		QRData:            m.mockQR(req.Amount, req.Currency, req.GatewayPaymentID),
		UPIIntentURL:      fmt.Sprintf("upi://pay?pa=mock@upi&pn=Gateway&am=%.2f&cu=%s&tn=%s", float64(req.Amount)/100, req.Currency, req.GatewayPaymentID),
		Raw:               map[string]interface{}{"provider": "mock", "created_at": time.Now().Unix()},
	}, nil
}

func (m *MockPaymentProvider) GetPaymentStatus(ctx context.Context, providerPaymentID string) (*PaymentStatus, error) {
	status := "PENDING"
	switch m.SimulateState {
	case "success":
		status = "SUCCESS"
	case "failed":
		status = "FAILED"
	}
	return &PaymentStatus{
		ProviderPaymentID: providerPaymentID,
		Status:            status,
		Amount:            50000, // 500 INR in paise
		Currency:          "INR",
		TransactionRef:    "MOCK_TXN_" + uuid.New().String()[:8],
		Raw:               map[string]interface{}{"provider": "mock"},
	}, nil
}

func (m *MockPaymentProvider) VerifyPayment(ctx context.Context, req VerifyRequest) (*VerificationResult, error) {
	txnRef := req.ProviderTransactionRef
	if txnRef == "" {
		txnRef = "MOCK_TXN_" + uuid.New().String()[:8]
	}
	switch m.SimulateState {
	case "success":
		return &VerificationResult{
			Status:         "VERIFIED_SUCCESS",
			Amount:         req.Amount,
			Currency:       req.Currency,
			TransactionRef: txnRef,
		}, nil
	case "failed":
		return &VerificationResult{
			Status:        "VERIFIED_FAILED",
			FailureReason: "Payment declined by bank",
		}, nil
	case "amount_mismatch":
		return &VerificationResult{
			Status:         "PENDING_REVIEW",
			Amount:         req.Amount + 100, // wrong amount
			Currency:       req.Currency,
			TransactionRef: txnRef,
			FailureReason:  "Amount mismatch detected",
		}, nil
	default:
		return &VerificationResult{Status: "PENDING_REVIEW"}, nil
	}
}

func (m *MockPaymentProvider) RefundPayment(ctx context.Context, req RefundRequest) (*RefundResponse, error) {
	return &RefundResponse{
		ProviderRefundID: "MOCK_RFD_" + uuid.New().String()[:8],
		Status:           "SUCCESS",
		Amount:           req.Amount,
	}, nil
}

func (m *MockPaymentProvider) CreateQR(ctx context.Context, req QRRequest) (*QRResponse, error) {
	upiURL := fmt.Sprintf("upi://pay?pa=%s&pn=Gateway&am=%.2f&cu=%s&tn=%s",
		req.UPIVpa, float64(req.Amount)/100, req.Currency, req.GatewayPaymentID)
	return &QRResponse{
		QRData: m.mockQR(req.Amount, req.Currency, req.GatewayPaymentID),
		UPIURL: upiURL,
	}, nil
}

func (m *MockPaymentProvider) CreateIntent(ctx context.Context, req IntentRequest) (*IntentResponse, error) {
	upiURL := fmt.Sprintf("upi://pay?pa=mock@upi&pn=Gateway&am=%.2f&cu=%s&tn=%s",
		float64(req.Amount)/100, req.Currency, req.GatewayPaymentID)
	return &IntentResponse{
		IntentURL: upiURL,
		DeepLink:  m.appDeepLink(req.App, upiURL),
	}, nil
}

func (m *MockPaymentProvider) mockQR(amount int64, currency, paymentID string) string {
	return fmt.Sprintf("upi://pay?pa=mock@upi&pn=Gateway&am=%.2f&cu=%s&tn=%s",
		float64(amount)/100, currency, paymentID)
}

func (m *MockPaymentProvider) appDeepLink(app, upiURL string) string {
	switch app {
	case "phonepe":
		return "phonepe://" + upiURL[6:]
	case "googlepay":
		return "tez://upi/" + upiURL[6:]
	case "paytm":
		return "paytmmp://" + upiURL[6:]
	default:
		return upiURL
	}
}

// MockVerificationSource is a development-only verification source.
type MockVerificationSource struct{}

func (m *MockVerificationSource) GetNewTransactions(ctx context.Context) ([]TransactionRecord, error) {
	return []TransactionRecord{
		{
			ProviderRef: "MOCK_TXN_" + fmt.Sprintf("%d", time.Now().Unix()),
			Amount:      50000,
			Currency:    "INR",
			Status:      "SUCCESS",
			Timestamp:   time.Now().Unix(),
			PayerUPIID:  "customer@upi",
			PayeeUPIID:  "mock@upi",
			Description: "Test payment",
		},
	}, nil
}

func (m *MockVerificationSource) GetTransactionDetails(ctx context.Context, ref string) (*TransactionRecord, error) {
	return &TransactionRecord{
		ProviderRef: ref,
		Amount:      50000,
		Currency:    "INR",
		Status:      "SUCCESS",
		Timestamp:   time.Now().Unix(),
	}, nil
}

func (m *MockVerificationSource) ReconcileTransaction(ctx context.Context, ref string) (*TransactionRecord, error) {
	return m.GetTransactionDetails(ctx, ref)
}

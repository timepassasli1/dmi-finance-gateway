// Package sources contains authorized transaction source implementations.
// Each source must only consume data from an authorized payment provider.
package sources

import (
	"context"
	"fmt"
	"time"

	"github.com/gateway/verification-agent/internal/agent"
)

// MockSource is a development-only transaction source for testing the agent flow.
// It generates synthetic transaction records.
//
// In production, replace this with an adapter for your authorized payment provider's
// official transaction feed, export API, or webhook.
type MockSource struct {
	counter int
}

func NewMockSource() *MockSource {
	return &MockSource{}
}

func (m *MockSource) GetNewTransactions(ctx context.Context) ([]agent.TransactionRecord, error) {
	// Return empty in real scenario — only return transactions when authorized feed has data
	// This mock returns one transaction every 5 calls for demo purposes
	m.counter++
	if m.counter%5 != 0 {
		return nil, nil
	}

	return []agent.TransactionRecord{
		{
			ProviderRef: fmt.Sprintf("MOCK_TXN_%d", time.Now().UnixNano()/1000),
			Amount:      50000, // 500 INR in paise
			Currency:    "INR",
			Status:      "SUCCESS",
			Timestamp:   time.Now().Unix(),
			Description: "Mock transaction from authorized source",
		},
	}, nil
}

func (m *MockSource) GetTransactionDetails(ctx context.Context, ref string) (*agent.TransactionRecord, error) {
	return &agent.TransactionRecord{
		ProviderRef: ref,
		Amount:      50000,
		Currency:    "INR",
		Status:      "SUCCESS",
		Timestamp:   time.Now().Unix(),
	}, nil
}

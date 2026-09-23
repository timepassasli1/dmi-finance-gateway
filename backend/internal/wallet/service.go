package wallet

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type Account struct {
	ID               string    `json:"id"`
	ClientID         string    `json:"client_id"`
	AvailableBalance int64     `json:"available_balance"`
	PendingBalance   int64     `json:"pending_balance"`
	Currency         string    `json:"currency"`
	Status           string    `json:"status"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type LedgerEntry struct {
	ID            string    `json:"id"`
	ClientID      string    `json:"client_id"`
	PaymentID     string    `json:"payment_id,omitempty"`
	EntryType     string    `json:"entry_type"`
	Amount        int64     `json:"amount"`
	BalanceBefore int64     `json:"balance_before"`
	BalanceAfter  int64     `json:"balance_after"`
	Reference     string    `json:"reference,omitempty"`
	Description   string    `json:"description,omitempty"`
	Status        string    `json:"status"`
	CreatedAt     time.Time `json:"created_at"`
}

type Service struct {
	db *sql.DB
}

func NewService(db *sql.DB) *Service {
	return &Service{db: db}
}

func (s *Service) GetAccount(ctx context.Context, clientID string) (*Account, error) {
	var a Account
	err := s.db.QueryRowContext(ctx,
		`SELECT id, client_id, available_balance, pending_balance, currency, status, updated_at
		 FROM wallet_accounts WHERE client_id = $1`,
		clientID,
	).Scan(&a.ID, &a.ClientID, &a.AvailableBalance, &a.PendingBalance, &a.Currency, &a.Status, &a.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("wallet not found")
	}
	return &a, err
}

// CreditTx credits the wallet within an existing transaction (for atomic payment finalization).
func (s *Service) CreditTx(ctx context.Context, tx *sql.Tx, clientID, paymentID string, amount int64, reference string) error {
	// Lock wallet row
	var walletID string
	var currentBalance int64
	err := tx.QueryRowContext(ctx,
		`SELECT id, available_balance FROM wallet_accounts WHERE client_id = $1 FOR UPDATE`,
		clientID,
	).Scan(&walletID, &currentBalance)
	if err != nil {
		return fmt.Errorf("wallet not found: %w", err)
	}

	newBalance := currentBalance + amount

	// Update wallet
	_, err = tx.ExecContext(ctx,
		`UPDATE wallet_accounts SET available_balance = $1, updated_at = NOW() WHERE id = $2`,
		newBalance, walletID)
	if err != nil {
		return err
	}

	// Append ledger entry (never update, only insert)
	var pIDPtr *string
	if paymentID != "" {
		pIDPtr = &paymentID
	}
	_, err = tx.ExecContext(ctx,
		`INSERT INTO wallet_ledger (client_id, wallet_id, payment_id, entry_type, amount, balance_before, balance_after, reference, description, status)
		 VALUES ($1, $2, $3, 'CREDIT', $4, $5, $6, $7, 'Payment received', 'COMPLETED')`,
		clientID, walletID, pIDPtr, amount, currentBalance, newBalance, reference)
	return err
}

// DebitTx debits the wallet within an existing transaction.
func (s *Service) DebitTx(ctx context.Context, tx *sql.Tx, clientID string, amount int64, reference, description string) error {
	var walletID string
	var currentBalance int64
	err := tx.QueryRowContext(ctx,
		`SELECT id, available_balance FROM wallet_accounts WHERE client_id = $1 FOR UPDATE`,
		clientID,
	).Scan(&walletID, &currentBalance)
	if err != nil {
		return fmt.Errorf("wallet not found: %w", err)
	}
	if currentBalance < amount {
		return fmt.Errorf("insufficient balance")
	}

	newBalance := currentBalance - amount
	tx.ExecContext(ctx,
		`UPDATE wallet_accounts SET available_balance = $1, updated_at = NOW() WHERE id = $2`,
		newBalance, walletID)
	tx.ExecContext(ctx,
		`INSERT INTO wallet_ledger (client_id, wallet_id, entry_type, amount, balance_before, balance_after, reference, description, status)
		 VALUES ($1, $2, 'DEBIT', $3, $4, $5, $6, $7, 'COMPLETED')`,
		clientID, walletID, amount, currentBalance, newBalance, reference, description)
	return nil
}

func (s *Service) GetLedger(ctx context.Context, clientID string, limit, offset int) ([]LedgerEntry, int, error) {
	var total int
	s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM wallet_ledger WHERE client_id = $1`, clientID).Scan(&total)

	rows, err := s.db.QueryContext(ctx,
		`SELECT id, client_id, payment_id, entry_type, amount, balance_before, balance_after,
		        reference, description, status, created_at
		 FROM wallet_ledger WHERE client_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
		clientID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var entries []LedgerEntry
	for rows.Next() {
		var e LedgerEntry
		var pID, ref, desc sql.NullString
		rows.Scan(&e.ID, &e.ClientID, &pID, &e.EntryType, &e.Amount,
			&e.BalanceBefore, &e.BalanceAfter, &ref, &desc, &e.Status, &e.CreatedAt)
		e.PaymentID = pID.String
		e.Reference = ref.String
		e.Description = desc.String
		entries = append(entries, e)
	}
	return entries, total, nil
}

// AdminGetAll returns all wallet accounts (admin only).
func (s *Service) AdminGetAll(ctx context.Context) ([]Account, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, client_id, available_balance, pending_balance, currency, status, updated_at
		 FROM wallet_accounts ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var accounts []Account
	for rows.Next() {
		var a Account
		rows.Scan(&a.ID, &a.ClientID, &a.AvailableBalance, &a.PendingBalance, &a.Currency, &a.Status, &a.UpdatedAt)
		accounts = append(accounts, a)
	}
	return accounts, nil
}

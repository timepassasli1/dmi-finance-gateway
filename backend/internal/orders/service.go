package orders

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

type Order struct {
	ID              string                 `json:"id"`
	GatewayOrderID  string                 `json:"gateway_order_id"`
	ClientID        string                 `json:"client_id"`
	ClientOrderID   string                 `json:"client_order_id"`
	Amount          int64                  `json:"amount"`
	Currency        string                 `json:"currency"`
	CustomerName    string                 `json:"customer_name"`
	CustomerEmail   string                 `json:"customer_email"`
	CustomerPhone   string                 `json:"customer_phone"`
	Status          string                 `json:"status"`
	Metadata        map[string]interface{} `json:"metadata,omitempty"`
	ExpiresAt       time.Time              `json:"expires_at"`
	CreatedAt       time.Time              `json:"created_at"`
}

type CreateOrderRequest struct {
	OrderID  string `json:"order_id" binding:"required"`
	Amount   int64  `json:"amount" binding:"required,min=1"`
	Currency string `json:"currency"`
	Customer struct {
		Name  string `json:"name"`
		Email string `json:"email"`
		Phone string `json:"phone"`
	} `json:"customer"`
	Metadata map[string]interface{} `json:"metadata"`
}

type Service struct {
	db *sql.DB
}

func NewService(db *sql.DB) *Service {
	return &Service{db: db}
}

func (s *Service) Create(ctx context.Context, clientID string, req CreateOrderRequest) (*Order, error) {
	if req.Currency == "" {
		req.Currency = "INR"
	}

	gwOrderID := generateOrderID()

	var o Order
	err := s.db.QueryRowContext(ctx,
		`INSERT INTO orders (gateway_order_id, client_id, client_order_id, amount, currency,
		  customer_name, customer_email, customer_phone, status, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'CREATED', NOW() + INTERVAL '24 hours')
		 RETURNING id, gateway_order_id, client_id, client_order_id, amount, currency,
		           customer_name, customer_email, customer_phone, status, expires_at, created_at`,
		gwOrderID, clientID, req.OrderID, req.Amount, req.Currency,
		req.Customer.Name, req.Customer.Email, req.Customer.Phone,
	).Scan(&o.ID, &o.GatewayOrderID, &o.ClientID, &o.ClientOrderID, &o.Amount, &o.Currency,
		&o.CustomerName, &o.CustomerEmail, &o.CustomerPhone, &o.Status, &o.ExpiresAt, &o.CreatedAt)
	if err != nil {
		if strings.Contains(err.Error(), "unique") {
			return nil, fmt.Errorf("ORDER_ALREADY_EXISTS: order_id %q already exists", req.OrderID)
		}
		return nil, fmt.Errorf("create order: %w", err)
	}
	return &o, nil
}

func (s *Service) Get(ctx context.Context, gatewayOrderID, clientID string) (*Order, error) {
	var o Order
	err := s.db.QueryRowContext(ctx,
		`SELECT id, gateway_order_id, client_id, client_order_id, amount, currency,
		        customer_name, customer_email, customer_phone, status, expires_at, created_at
		 FROM orders WHERE gateway_order_id = $1 AND client_id = $2`,
		gatewayOrderID, clientID,
	).Scan(&o.ID, &o.GatewayOrderID, &o.ClientID, &o.ClientOrderID, &o.Amount, &o.Currency,
		&o.CustomerName, &o.CustomerEmail, &o.CustomerPhone, &o.Status, &o.ExpiresAt, &o.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("PAYMENT_NOT_FOUND: order not found")
	}
	return &o, err
}

func (s *Service) GetByID(ctx context.Context, orderID string) (*Order, error) {
	var o Order
	err := s.db.QueryRowContext(ctx,
		`SELECT id, gateway_order_id, client_id, client_order_id, amount, currency,
		        customer_name, customer_email, customer_phone, status, expires_at, created_at
		 FROM orders WHERE id = $1`,
		orderID,
	).Scan(&o.ID, &o.GatewayOrderID, &o.ClientID, &o.ClientOrderID, &o.Amount, &o.Currency,
		&o.CustomerName, &o.CustomerEmail, &o.CustomerPhone, &o.Status, &o.ExpiresAt, &o.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("PAYMENT_NOT_FOUND: order not found")
	}
	return &o, err
}

func (s *Service) UpdateStatus(ctx context.Context, orderID, status string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2`,
		status, orderID)
	return err
}

func (s *Service) List(ctx context.Context, clientID string, limit, offset int) ([]Order, int, error) {
	var total int
	s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM orders WHERE client_id = $1`, clientID).Scan(&total)

	rows, err := s.db.QueryContext(ctx,
		`SELECT id, gateway_order_id, client_id, client_order_id, amount, currency,
		        customer_name, customer_email, customer_phone, status, expires_at, created_at
		 FROM orders WHERE client_id = $1
		 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
		clientID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var list []Order
	for rows.Next() {
		var o Order
		rows.Scan(&o.ID, &o.GatewayOrderID, &o.ClientID, &o.ClientOrderID, &o.Amount, &o.Currency,
			&o.CustomerName, &o.CustomerEmail, &o.CustomerPhone, &o.Status, &o.ExpiresAt, &o.CreatedAt)
		list = append(list, o)
	}
	return list, total, nil
}

func generateOrderID() string {
	return fmt.Sprintf("GW_ORD_%d", time.Now().UnixNano()/1000)
}

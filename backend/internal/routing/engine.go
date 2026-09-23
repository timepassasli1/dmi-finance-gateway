package routing

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type Route struct {
	ID                   string    `json:"id"`
	ClientID             string    `json:"client_id"`
	ProcessingMerchantID string    `json:"processing_merchant_id"`
	MerchantCode         string    `json:"merchant_code"`
	MerchantDisplayName  string    `json:"merchant_display_name"`
	Provider             string    `json:"provider"`
	Priority             int       `json:"priority"`
	Status               string    `json:"status"`
	DailyLimit           int64     `json:"daily_limit"`
	TransactionLimit     int64     `json:"transaction_limit"`
	CreatedAt            time.Time `json:"created_at"`
}

type CreateRouteRequest struct {
	ClientID             string `json:"client_id" binding:"required"`
	ProcessingMerchantID string `json:"processing_merchant_id" binding:"required"`
	Priority             int    `json:"priority"`
	DailyLimit           int64  `json:"daily_limit"`
	TransactionLimit     int64  `json:"transaction_limit"`
}

type Engine struct {
	db *sql.DB
}

func NewEngine(db *sql.DB) *Engine {
	return &Engine{db: db}
}

// SelectRoute returns the best processing route for a client/amount/currency.
func (e *Engine) SelectRoute(ctx context.Context, clientID string, amount int64, currency string) (*Route, error) {
	// Get active routes ordered by priority
	rows, err := e.db.QueryContext(ctx,
		`SELECT r.id, r.client_id, r.processing_merchant_id, pm.merchant_code,
		        pm.display_name, pm.provider, r.priority, r.status, r.daily_limit, r.transaction_limit, r.created_at
		 FROM client_processing_routes r
		 JOIN processing_merchants pm ON pm.id = r.processing_merchant_id
		 WHERE r.client_id = $1 AND r.status = 'ACTIVE' AND pm.status = 'ACTIVE'
		 ORDER BY r.priority ASC`,
		clientID)
	if err != nil {
		return nil, fmt.Errorf("query routes: %w", err)
	}
	defer rows.Close()

	var routes []Route
	for rows.Next() {
		var r Route
		rows.Scan(&r.ID, &r.ClientID, &r.ProcessingMerchantID, &r.MerchantCode,
			&r.MerchantDisplayName, &r.Provider, &r.Priority, &r.Status,
			&r.DailyLimit, &r.TransactionLimit, &r.CreatedAt)
		routes = append(routes, r)
	}

	for _, route := range routes {
		if route.TransactionLimit > 0 && amount > route.TransactionLimit {
			continue
		}
		return &route, nil
	}

	return nil, fmt.Errorf("PROVIDER_UNAVAILABLE: no available processing route for client")
}

// CreateRoute creates a new routing assignment.
func (e *Engine) CreateRoute(ctx context.Context, req CreateRouteRequest) (*Route, error) {
	if req.Priority == 0 {
		req.Priority = 1
	}
	var r Route
	err := e.db.QueryRowContext(ctx,
		`INSERT INTO client_processing_routes (client_id, processing_merchant_id, priority, status, daily_limit, transaction_limit)
		 VALUES ($1, $2, $3, 'ACTIVE', $4, $5)
		 ON CONFLICT (client_id, processing_merchant_id) DO UPDATE SET priority = $3, status = 'ACTIVE', daily_limit = $4, transaction_limit = $5, updated_at = NOW()
		 RETURNING id, client_id, processing_merchant_id, priority, status, daily_limit, transaction_limit, created_at`,
		req.ClientID, req.ProcessingMerchantID, req.Priority, req.DailyLimit, req.TransactionLimit,
	).Scan(&r.ID, &r.ClientID, &r.ProcessingMerchantID, &r.Priority, &r.Status,
		&r.DailyLimit, &r.TransactionLimit, &r.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("create route: %w", err)
	}
	return &r, nil
}

// ListRoutesForClient returns all routes for a client.
func (e *Engine) ListRoutesForClient(ctx context.Context, clientID string) ([]Route, error) {
	rows, err := e.db.QueryContext(ctx,
		`SELECT r.id, r.client_id, r.processing_merchant_id, pm.merchant_code,
		        pm.display_name, pm.provider, r.priority, r.status, r.daily_limit, r.transaction_limit, r.created_at
		 FROM client_processing_routes r
		 JOIN processing_merchants pm ON pm.id = r.processing_merchant_id
		 WHERE r.client_id = $1 ORDER BY r.priority`,
		clientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var routes []Route
	for rows.Next() {
		var r Route
		rows.Scan(&r.ID, &r.ClientID, &r.ProcessingMerchantID, &r.MerchantCode,
			&r.MerchantDisplayName, &r.Provider, &r.Priority, &r.Status,
			&r.DailyLimit, &r.TransactionLimit, &r.CreatedAt)
		routes = append(routes, r)
	}
	return routes, nil
}

package audit

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

type Log struct {
	ID         string                 `json:"id"`
	ActorID    string                 `json:"actor_id,omitempty"`
	ActorType  string                 `json:"actor_type,omitempty"`
	Action     string                 `json:"action"`
	EntityType string                 `json:"entity_type,omitempty"`
	EntityID   string                 `json:"entity_id,omitempty"`
	ClientID   string                 `json:"client_id,omitempty"`
	Details    map[string]interface{} `json:"details,omitempty"`
	IPAddress  string                 `json:"ip_address,omitempty"`
	RequestID  string                 `json:"request_id,omitempty"`
	CreatedAt  time.Time              `json:"created_at"`
}

type Service struct {
	db *sql.DB
}

func NewService(db *sql.DB) *Service {
	return &Service{db: db}
}

func (s *Service) Log(ctx context.Context, log Log) {
	details, _ := json.Marshal(log.Details)
	s.db.ExecContext(ctx,
		`INSERT INTO audit_logs (actor_id, actor_type, action, entity_type, entity_id, client_id, details, ip_address, request_id)
		 VALUES (NULLIF($1,'')::uuid, $2, $3, $4, $5, NULLIF($6,'')::uuid, $7, $8, $9)`,
		log.ActorID, log.ActorType, log.Action, log.EntityType, log.EntityID,
		log.ClientID, details, log.IPAddress, log.RequestID)
}

func (s *Service) List(ctx context.Context, clientID string, limit, offset int) ([]Log, int, error) {
	query := `SELECT id, actor_id, actor_type, action, entity_type, entity_id, client_id, details, ip_address, request_id, created_at
	          FROM audit_logs`
	args := []interface{}{}
	if clientID != "" {
		query += " WHERE client_id = $1"
		args = append(args, clientID)
	}
	query += " ORDER BY created_at DESC LIMIT $" + intStr(len(args)+1) + " OFFSET $" + intStr(len(args)+2)
	args = append(args, limit, offset)

	var total int
	if clientID != "" {
		s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM audit_logs WHERE client_id = $1`, clientID).Scan(&total)
	} else {
		s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM audit_logs`).Scan(&total)
	}

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var logs []Log
	for rows.Next() {
		var l Log
		var actorID, actorType, entityType, entityID, cID, ip, reqID sql.NullString
		var detailsJSON []byte
		rows.Scan(&l.ID, &actorID, &actorType, &l.Action, &entityType, &entityID,
			&cID, &detailsJSON, &ip, &reqID, &l.CreatedAt)
		l.ActorID = actorID.String
		l.ActorType = actorType.String
		l.EntityType = entityType.String
		l.EntityID = entityID.String
		l.ClientID = cID.String
		l.IPAddress = ip.String
		l.RequestID = reqID.String
		json.Unmarshal(detailsJSON, &l.Details)
		logs = append(logs, l)
	}
	return logs, total, nil
}

func intStr(n int) string {
	return fmt.Sprintf("%d", n)
}

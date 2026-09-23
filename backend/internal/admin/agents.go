package admin

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gateway/backend/pkg/security"
)

type Agent struct {
	ID                   string     `json:"id"`
	AgentCode            string     `json:"agent_code"`
	DisplayName          string     `json:"display_name"`
	ClientID             string     `json:"client_id,omitempty"`
	ProcessingMerchantID string     `json:"processing_merchant_id,omitempty"`
	Status               string     `json:"status"`
	LastHeartbeatAt      *time.Time `json:"last_heartbeat_at,omitempty"`
	IPAddress            string     `json:"ip_address,omitempty"`
	Version              string     `json:"version,omitempty"`
	CreatedAt            time.Time  `json:"created_at"`
}

type AgentService struct {
	db *sql.DB
}

func NewAgentService(db *sql.DB) *AgentService {
	return &AgentService{db: db}
}

type RegisterAgentRequest struct {
	AgentCode   string `json:"agent_code" binding:"required"`
	DisplayName string `json:"display_name" binding:"required"`
	Secret      string `json:"secret" binding:"required"`
	Version     string `json:"version"`
}

func (s *AgentService) Register(ctx context.Context, req RegisterAgentRequest, ip string) (*Agent, error) {
	hash, err := security.HashPassword(req.Secret)
	if err != nil {
		return nil, err
	}

	var a Agent
	err = s.db.QueryRowContext(ctx,
		`INSERT INTO verification_agents (agent_code, display_name, status, secret_hash, ip_address, version)
		 VALUES ($1, $2, 'REGISTERED', $3, $4, $5)
		 ON CONFLICT (agent_code) DO UPDATE SET status = 'REGISTERED', ip_address = $4, version = $5, updated_at = NOW()
		 RETURNING id, agent_code, display_name, status, last_heartbeat_at, ip_address, version, created_at`,
		req.AgentCode, req.DisplayName, hash, ip, req.Version,
	).Scan(&a.ID, &a.AgentCode, &a.DisplayName, &a.Status, &a.LastHeartbeatAt, &a.IPAddress, &a.Version, &a.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("register agent: %w", err)
	}
	return &a, nil
}

func (s *AgentService) Authenticate(ctx context.Context, agentCode, secret string) (*Agent, error) {
	var a Agent
	var hash string
	var clientID, mID sql.NullString
	var ip, ver sql.NullString
	err := s.db.QueryRowContext(ctx,
		`SELECT id, agent_code, display_name, client_id, processing_merchant_id, status, last_heartbeat_at, ip_address, version, created_at, secret_hash
		 FROM verification_agents WHERE agent_code = $1`,
		agentCode,
	).Scan(&a.ID, &a.AgentCode, &a.DisplayName, &clientID, &mID, &a.Status, &a.LastHeartbeatAt, &ip, &ver, &a.CreatedAt, &hash)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("agent not found")
	}
	if err != nil {
		return nil, err
	}
	a.ClientID = clientID.String
	a.ProcessingMerchantID = mID.String
	a.IPAddress = ip.String
	a.Version = ver.String
	if !security.CheckPassword(secret, hash) {
		return nil, fmt.Errorf("invalid agent credentials")
	}
	return &a, nil
}

func (s *AgentService) Heartbeat(ctx context.Context, agentID, ip string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE verification_agents SET status = 'ONLINE', last_heartbeat_at = NOW(), ip_address = $1, updated_at = NOW()
		 WHERE id = $2`,
		ip, agentID)
	return err
}

func (s *AgentService) List(ctx context.Context) ([]Agent, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, agent_code, display_name, client_id, processing_merchant_id, status, last_heartbeat_at, ip_address, version, created_at
		 FROM verification_agents ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var agents []Agent
	for rows.Next() {
		var a Agent
		var clientID, mID sql.NullString
		var ip, ver sql.NullString
		rows.Scan(&a.ID, &a.AgentCode, &a.DisplayName, &clientID, &mID, &a.Status, &a.LastHeartbeatAt, &ip, &ver, &a.CreatedAt)
		a.ClientID = clientID.String
		a.ProcessingMerchantID = mID.String
		a.IPAddress = ip.String
		a.Version = ver.String
		agents = append(agents, a)
	}
	return agents, nil
}

// BindClient links an agent to exactly one client + optional processing merchant (isolation).
func (s *AgentService) BindClient(ctx context.Context, agentCode, clientID, processingMerchantID string) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE verification_agents SET client_id = $1, processing_merchant_id = NULLIF($2, '')::uuid, updated_at = NOW()
		 WHERE agent_code = $3`,
		clientID, processingMerchantID, agentCode)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("agent not found")
	}
	return nil
}

// RegisterForClient creates or updates a dedicated verifier agent for one client.
func (s *AgentService) RegisterForClient(ctx context.Context, clientID, agentCode, displayName, secret, processingMerchantID string) (*Agent, error) {
	hash, err := security.HashPassword(secret)
	if err != nil {
		return nil, err
	}
	var a Agent
	var cID, mID sql.NullString
	var ip, ver sql.NullString
	err = s.db.QueryRowContext(ctx,
		`INSERT INTO verification_agents (agent_code, display_name, status, secret_hash, client_id, processing_merchant_id)
		 VALUES ($1, $2, 'REGISTERED', $3, $4, NULLIF($5, '')::uuid)
		 ON CONFLICT (agent_code) DO UPDATE SET
		   display_name = EXCLUDED.display_name,
		   secret_hash = EXCLUDED.secret_hash,
		   client_id = EXCLUDED.client_id,
		   processing_merchant_id = EXCLUDED.processing_merchant_id,
		   updated_at = NOW()
		 RETURNING id, agent_code, display_name, client_id, processing_merchant_id, status, last_heartbeat_at, ip_address, version, created_at`,
		agentCode, displayName, hash, clientID, processingMerchantID,
	).Scan(&a.ID, &a.AgentCode, &a.DisplayName, &cID, &mID, &a.Status, &a.LastHeartbeatAt, &ip, &ver, &a.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("register client agent: %w", err)
	}
	a.ClientID = cID.String
	a.ProcessingMerchantID = mID.String
	a.IPAddress = ip.String
	a.Version = ver.String
	return &a, nil
}

// AgentHandler handles agent-facing endpoints.
type AgentHandler struct {
	svc *AgentService
}

func NewAgentHandler(svc *AgentService) *AgentHandler {
	return &AgentHandler{svc: svc}
}

func (h *AgentHandler) Register(c *gin.Context) {
	var req RegisterAgentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, apiErr("INVALID_REQUEST", err.Error()))
		return
	}
	agent, err := h.svc.Register(c.Request.Context(), req, c.ClientIP())
	if err != nil {
		c.JSON(http.StatusBadRequest, apiErr("REGISTER_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusCreated, agent)
}

func (h *AgentHandler) Heartbeat(c *gin.Context) {
	agentID, _ := c.Get("agent_id")
	if err := h.svc.Heartbeat(c.Request.Context(), agentID.(string), c.ClientIP()); err != nil {
		c.JSON(http.StatusInternalServerError, apiErr("HEARTBEAT_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok", "timestamp": time.Now().UTC()})
}

func (h *AgentHandler) GetConfig(c *gin.Context) {
	clientID, _ := c.Get("agent_client_id")
	merchantID, _ := c.Get("agent_processing_merchant_id")
	c.JSON(http.StatusOK, gin.H{
		"heartbeat_interval":     "30s",
		"verify_endpoint":        "/v1/agents/verification-event",
		"reconcile_endpoint":     "/v1/agents/reconcile",
		"client_id":              clientID,
		"processing_merchant_id": merchantID,
		"scoped":                 clientID != nil && clientID != "",
	})
}

func (h *AgentHandler) AdminBindClient(c *gin.Context) {
	var body struct {
		AgentCode            string `json:"agent_code" binding:"required"`
		ClientID             string `json:"client_id" binding:"required"`
		ProcessingMerchantID string `json:"processing_merchant_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, apiErr("INVALID_REQUEST", err.Error()))
		return
	}
	if err := h.svc.BindClient(c.Request.Context(), body.AgentCode, body.ClientID, body.ProcessingMerchantID); err != nil {
		c.JSON(http.StatusBadRequest, apiErr("BIND_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Agent bound to client"})
}

func (h *AgentHandler) AdminRegisterForClient(c *gin.Context) {
	var body struct {
		AgentCode            string `json:"agent_code" binding:"required"`
		DisplayName          string `json:"display_name" binding:"required"`
		Secret               string `json:"secret" binding:"required"`
		ProcessingMerchantID string `json:"processing_merchant_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, apiErr("INVALID_REQUEST", err.Error()))
		return
	}
	agent, err := h.svc.RegisterForClient(c.Request.Context(), c.Param("id"), body.AgentCode, body.DisplayName, body.Secret, body.ProcessingMerchantID)
	if err != nil {
		c.JSON(http.StatusBadRequest, apiErr("REGISTER_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusCreated, agent)
}

func (h *AgentHandler) AdminList(c *gin.Context) {
	agents, err := h.svc.List(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, apiErr("LIST_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusOK, gin.H{"agents": agents})
}

func apiErr(code, msg string) gin.H {
	return gin.H{"error": gin.H{
		"code":    code,
		"message": msg,
	}}
}

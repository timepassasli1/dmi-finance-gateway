package verification

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gateway/backend/internal/payments"
	"github.com/gateway/backend/pkg/security"
)

type Handler struct {
	engine *Engine
}

func NewHandler(engine *Engine) *Handler {
	return &Handler{engine: engine}
}

// VerifyPayment handles client-side payment verification (server-to-server).
// A frontend redirect alone must never finalize a payment.
func (h *Handler) VerifyPayment(c *gin.Context) {
	var req VerifyRequest
	_ = c.ShouldBindJSON(&req)
	if id := c.Param("id"); id != "" {
		req.GatewayPaymentID = id
	}
	if req.GatewayPaymentID == "" {
		c.JSON(http.StatusBadRequest, apiErr("INVALID_REQUEST", "gateway_payment_id required"))
		return
	}
	if v, ok := c.Get("client_id"); ok {
		if s, ok := v.(string); ok {
			req.ClientID = s
		}
	}

	result, err := h.engine.Verify(c.Request.Context(), req)
	if err != nil {
		status := http.StatusBadRequest
		c.JSON(status, apiErr(errorCode(err), err.Error()))
		return
	}

	c.JSON(http.StatusOK, result)
}

// AgentVerificationEvent handles events from the verification agent.
func (h *Handler) AgentVerificationEvent(c *gin.Context) {
	agentID, _ := c.Get("agent_id")
	agentClientID, _ := c.Get("agent_client_id")
	agentMerchantID, _ := c.Get("agent_processing_merchant_id")

	var event AgentVerificationEvent
	if err := c.ShouldBindJSON(&event); err != nil {
		c.JSON(http.StatusBadRequest, apiErr("INVALID_REQUEST", err.Error()))
		return
	}

	result, err := h.engine.ProcessAgentEvent(c.Request.Context(), agentID.(string), event, payments.AgentScope{
		ClientID:             strVal(agentClientID),
		ProcessingMerchantID: strVal(agentMerchantID),
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, apiErr(errorCode(err), err.Error()))
		return
	}
	c.JSON(http.StatusOK, result)
}

// AgentPendingPayments lists payments waiting for merchant-panel verification.
func (h *Handler) AgentPendingPayments(c *gin.Context) {
	scope := payments.AgentScope{}
	if v, ok := c.Get("agent_client_id"); ok {
		scope.ClientID, _ = v.(string)
	}
	if v, ok := c.Get("agent_processing_merchant_id"); ok {
		scope.ProcessingMerchantID, _ = v.(string)
	}
	if scope.ClientID == "" && scope.ProcessingMerchantID == "" {
		c.JSON(http.StatusForbidden, apiErr("AGENT_SCOPE_REQUIRED", "Bind agent to a client (AGENT_VIVEK / AGENT_AP) — unscoped agents cannot see payments"))
		return
	}
	list, err := h.engine.Payments().ListPendingForAgent(c.Request.Context(), scope, 50)
	if err != nil {
		c.JSON(http.StatusInternalServerError, apiErr("LIST_FAILED", err.Error()))
		return
	}
	out := make([]gin.H, 0, len(list))
	for _, p := range list {
		track := payments.TrackNoteFromCode(p.IntentCode)
		out = append(out, gin.H{
			"gateway_payment_id": p.GatewayPaymentID,
			"client_order_id":    p.ClientOrderID,
			"amount":             p.Amount,
			"currency":           p.Currency,
			"status":             p.Status,
			"merchant_name":      p.MerchantName,
			"created_at":         p.CreatedAt,
			"intent_code":        p.IntentCode,
			"track_code":         track,
			"upi_note":           track,
			"last_watched_at":    p.LastWatchedAt,
			"watched":            p.LastWatchedAt != nil,
		})
	}
	c.JSON(http.StatusOK, gin.H{"payments": out, "total": len(out)})
}

// AgentWatchHistory lists pay pages opened on this agent's Paytm merchant (any client on same VPA).
func (h *Handler) AgentWatchHistory(c *gin.Context) {
	scope := payments.AgentScope{}
	if v, ok := c.Get("agent_client_id"); ok {
		scope.ClientID, _ = v.(string)
	}
	if v, ok := c.Get("agent_processing_merchant_id"); ok {
		scope.ProcessingMerchantID, _ = v.(string)
	}
	list, err := h.engine.Payments().ListWatchHistoryForAgent(c.Request.Context(), scope, 50)
	if err != nil {
		status := http.StatusInternalServerError
		if strings.Contains(err.Error(), "CLIENT_REQUIRED") || strings.Contains(err.Error(), "AGENT_SCOPE") {
			status = http.StatusForbidden
		}
		c.JSON(status, apiErr(errorCode(err), err.Error()))
		return
	}
	out := make([]gin.H, 0, len(list))
	for _, p := range list {
		track := payments.TrackNoteFromCode(p.IntentCode)
		out = append(out, gin.H{
			"gateway_payment_id": p.GatewayPaymentID,
			"client_order_id":    p.ClientOrderID,
			"amount":             p.Amount,
			"currency":           p.Currency,
			"status":             p.Status,
			"merchant_name":      p.MerchantName,
			"created_at":         p.CreatedAt,
			"intent_code":        p.IntentCode,
			"track_code":         track,
			"upi_note":           track,
			"last_watched_at":    p.LastWatchedAt,
		})
	}
	c.JSON(http.StatusOK, gin.H{"payments": out, "total": len(out)})
}

func errorCode(err error) string {
	codes := []string{"PAYMENT_NOT_FOUND", "TRANSACTION_ALREADY_PROCESSED", "PROVIDER_UNAVAILABLE", "VERIFICATION_FAILED", "AMBIGUOUS_AMOUNT", "AGENT_SCOPE_REQUIRED", "CLIENT_REQUIRED"}
	for _, c := range codes {
		if isCode(err, c) {
			return c
		}
	}
	return "VERIFICATION_FAILED"
}

func isCode(err error, code string) bool {
	return err != nil && len(err.Error()) >= len(code) && err.Error()[:len(code)] == code
}

func apiErr(code, msg string) gin.H {
	return gin.H{"error": gin.H{
		"code":       code,
		"message":    msg,
		"request_id": security.GenerateRequestID(),
	}}
}

func strVal(v interface{}) string {
	if v == nil {
		return ""
	}
	s, _ := v.(string)
	return s
}

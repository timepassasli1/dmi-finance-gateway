package webhooks

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gateway/backend/internal/auth"
	"github.com/gateway/backend/internal/clients"
	"github.com/gateway/backend/pkg/security"
)

type Handler struct {
	svc        *Service
	clientsSvc *clients.Service
}

func NewHandler(svc *Service, clientsSvc *clients.Service) *Handler {
	return &Handler{svc: svc, clientsSvc: clientsSvc}
}

func (h *Handler) Register(c *gin.Context) {
	claims := auth.MustGetClaims(c)
	client, err := h.clientsSvc.GetByUserID(c.Request.Context(), claims.UserID)
	if err != nil {
		c.JSON(http.StatusNotFound, apiErr("CLIENT_NOT_FOUND", err.Error()))
		return
	}

	var body struct {
		URL    string   `json:"url" binding:"required"`
		Events []string `json:"events"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, apiErr("INVALID_REQUEST", err.Error()))
		return
	}
	if len(body.Events) == 0 {
		body.Events = []string{"payment.success", "payment.failed", "payment.pending"}
	}

	wh, err := h.svc.Register(c.Request.Context(), client.ID, body.URL, body.Events)
	if err != nil {
		c.JSON(http.StatusInternalServerError, apiErr("REGISTER_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusCreated, wh)
}

func (h *Handler) List(c *gin.Context) {
	claims := auth.MustGetClaims(c)
	client, err := h.clientsSvc.GetByUserID(c.Request.Context(), claims.UserID)
	if err != nil {
		c.JSON(http.StatusNotFound, apiErr("CLIENT_NOT_FOUND", err.Error()))
		return
	}
	whs, err := h.svc.List(c.Request.Context(), client.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, apiErr("LIST_FAILED", err.Error()))
		return
	}
	deliveries, _ := h.svc.ListDeliveries(c.Request.Context(), client.ID)
	c.JSON(http.StatusOK, gin.H{"webhooks": whs, "recent_deliveries": deliveries})
}

func (h *Handler) TestWebhook(c *gin.Context) {
	claims := auth.MustGetClaims(c)
	client, err := h.clientsSvc.GetByUserID(c.Request.Context(), claims.UserID)
	if err != nil {
		c.JSON(http.StatusNotFound, apiErr("CLIENT_NOT_FOUND", err.Error()))
		return
	}
	go h.svc.Deliver(c.Request.Context(), client.ID, "", "payment.test", map[string]interface{}{
		"event":   "payment.test",
		"message": "This is a test webhook delivery",
	})
	c.JSON(http.StatusOK, gin.H{"message": "Test webhook queued"})
}

func (h *Handler) Update(c *gin.Context) {
	claims := auth.MustGetClaims(c)
	client, err := h.clientsSvc.GetByUserID(c.Request.Context(), claims.UserID)
	if err != nil {
		c.JSON(http.StatusNotFound, apiErr("CLIENT_NOT_FOUND", err.Error()))
		return
	}
	var body struct {
		URL      string   `json:"url" binding:"required"`
		Events   []string `json:"events"`
		IsActive *bool    `json:"is_active"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, apiErr("INVALID_REQUEST", err.Error()))
		return
	}
	if len(body.Events) == 0 {
		body.Events = []string{"payment.success", "payment.failed", "payment.pending"}
	}
	active := true
	if body.IsActive != nil {
		active = *body.IsActive
	}
	if err := h.svc.Update(c.Request.Context(), c.Param("id"), client.ID, body.URL, body.Events, active); err != nil {
		c.JSON(http.StatusBadRequest, apiErr("UPDATE_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Webhook updated"})
}

func (h *Handler) Delete(c *gin.Context) {
	claims := auth.MustGetClaims(c)
	client, err := h.clientsSvc.GetByUserID(c.Request.Context(), claims.UserID)
	if err != nil {
		c.JSON(http.StatusNotFound, apiErr("CLIENT_NOT_FOUND", err.Error()))
		return
	}
	if err := h.svc.Delete(c.Request.Context(), c.Param("id"), client.ID); err != nil {
		c.JSON(http.StatusBadRequest, apiErr("DELETE_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Webhook deleted"})
}

func apiErr(code, msg string) gin.H {
	return gin.H{"error": gin.H{
		"code":       code,
		"message":    msg,
		"request_id": security.GenerateRequestID(),
	}}
}

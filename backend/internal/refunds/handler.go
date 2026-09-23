package refunds

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

func (h *Handler) Create(c *gin.Context) {
	claims := auth.MustGetClaims(c)
	client, err := h.clientsSvc.GetByUserID(c.Request.Context(), claims.UserID)
	if err != nil {
		c.JSON(http.StatusNotFound, apiErr("CLIENT_NOT_FOUND", err.Error()))
		return
	}

	var req CreateRefundRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, apiErr("INVALID_REQUEST", err.Error()))
		return
	}

	refund, err := h.svc.Create(c.Request.Context(), client.ID, claims.UserID, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, apiErr("REFUND_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusCreated, refund)
}

func (h *Handler) List(c *gin.Context) {
	claims := auth.MustGetClaims(c)
	client, err := h.clientsSvc.GetByUserID(c.Request.Context(), claims.UserID)
	if err != nil {
		c.JSON(http.StatusNotFound, apiErr("CLIENT_NOT_FOUND", err.Error()))
		return
	}
	list, err := h.svc.List(c.Request.Context(), client.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, apiErr("LIST_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusOK, gin.H{"refunds": list})
}

func apiErr(code, msg string) gin.H {
	return gin.H{"error": gin.H{
		"code":       code,
		"message":    msg,
		"request_id": security.GenerateRequestID(),
	}}
}

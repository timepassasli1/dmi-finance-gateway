package api_keys

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

func (h *Handler) Generate(c *gin.Context) {
	claims := auth.MustGetClaims(c)
	client, err := h.clientsSvc.GetByUserID(c.Request.Context(), claims.UserID)
	if err != nil {
		c.JSON(http.StatusNotFound, apiErr("CLIENT_NOT_FOUND", err.Error()))
		return
	}
	if client.Status != "ACTIVE" {
		c.JSON(http.StatusForbidden, apiErr("CLIENT_INACTIVE", "Account must be approved by admin before generating API keys. Complete profile & documents, then wait for activation."))
		return
	}

	var body struct {
		KeyName string `json:"key_name"`
	}
	c.ShouldBindJSON(&body)
	if body.KeyName == "" {
		body.KeyName = "Default"
	}

	key, err := h.svc.Generate(c.Request.Context(), client.ID, body.KeyName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, apiErr("KEY_GENERATION_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusCreated, gin.H{
		"key":     key,
		"warning": "The secret_key and webhook_secret are shown only once. Store them securely.",
	})
}

func (h *Handler) List(c *gin.Context) {
	claims := auth.MustGetClaims(c)
	client, err := h.clientsSvc.GetByUserID(c.Request.Context(), claims.UserID)
	if err != nil {
		c.JSON(http.StatusNotFound, apiErr("CLIENT_NOT_FOUND", err.Error()))
		return
	}
	keys, err := h.svc.List(c.Request.Context(), client.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, apiErr("LIST_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusOK, gin.H{"api_keys": keys})
}

func (h *Handler) Revoke(c *gin.Context) {
	claims := auth.MustGetClaims(c)
	client, err := h.clientsSvc.GetByUserID(c.Request.Context(), claims.UserID)
	if err != nil {
		c.JSON(http.StatusNotFound, apiErr("CLIENT_NOT_FOUND", err.Error()))
		return
	}
	if err := h.svc.Revoke(c.Request.Context(), c.Param("id"), client.ID); err != nil {
		c.JSON(http.StatusBadRequest, apiErr("REVOKE_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "API key revoked"})
}

// AdminGenerateForClient - admin can generate keys for any client
func (h *Handler) AdminGenerateForClient(c *gin.Context) {
	client, err := h.clientsSvc.GetByID(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, apiErr("CLIENT_NOT_FOUND", err.Error()))
		return
	}
	key, err := h.svc.Generate(c.Request.Context(), client.ID, "Admin Generated")
	if err != nil {
		c.JSON(http.StatusInternalServerError, apiErr("KEY_GENERATION_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusCreated, gin.H{
		"key":     key,
		"warning": "Store secret_key and webhook_secret securely — shown only once.",
	})
}

func apiErr(code, msg string) gin.H {
	return gin.H{"error": gin.H{
		"code":       code,
		"message":    msg,
		"request_id": security.GenerateRequestID(),
	}}
}

package wallet

import (
	"net/http"
	"strconv"

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

func (h *Handler) GetWallet(c *gin.Context) {
	claims := auth.MustGetClaims(c)
	client, err := h.clientsSvc.GetByUserID(c.Request.Context(), claims.UserID)
	if err != nil {
		c.JSON(http.StatusNotFound, apiErr("CLIENT_NOT_FOUND", err.Error()))
		return
	}
	account, err := h.svc.GetAccount(c.Request.Context(), client.ID)
	if err != nil {
		c.JSON(http.StatusNotFound, apiErr("WALLET_NOT_FOUND", err.Error()))
		return
	}
	c.JSON(http.StatusOK, account)
}

func (h *Handler) GetLedger(c *gin.Context) {
	claims := auth.MustGetClaims(c)
	client, err := h.clientsSvc.GetByUserID(c.Request.Context(), claims.UserID)
	if err != nil {
		c.JSON(http.StatusNotFound, apiErr("CLIENT_NOT_FOUND", err.Error()))
		return
	}

	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))

	entries, total, err := h.svc.GetLedger(c.Request.Context(), client.ID, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, apiErr("LEDGER_ERROR", err.Error()))
		return
	}
	c.JSON(http.StatusOK, gin.H{"entries": entries, "total": total})
}

func (h *Handler) AdminGetWallets(c *gin.Context) {
	accounts, err := h.svc.AdminGetAll(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, apiErr("LIST_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusOK, gin.H{"wallets": accounts})
}

func apiErr(code, msg string) gin.H {
	return gin.H{"error": gin.H{
		"code":       code,
		"message":    msg,
		"request_id": security.GenerateRequestID(),
	}}
}

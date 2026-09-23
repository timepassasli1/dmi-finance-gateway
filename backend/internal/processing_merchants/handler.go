package processing_merchants

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gateway/backend/pkg/security"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) Create(c *gin.Context) {
	var req CreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, apiErr("INVALID_REQUEST", err.Error()))
		return
	}
	m, err := h.svc.Create(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusBadRequest, apiErr("CREATE_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusCreated, m)
}

func (h *Handler) List(c *gin.Context) {
	list, err := h.svc.List(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, apiErr("LIST_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusOK, gin.H{"processing_merchants": list})
}

func (h *Handler) Get(c *gin.Context) {
	m, err := h.svc.Get(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, apiErr("NOT_FOUND", err.Error()))
		return
	}
	c.JSON(http.StatusOK, m)
}

func (h *Handler) SetCredential(c *gin.Context) {
	var cred Credential
	if err := c.ShouldBindJSON(&cred); err != nil {
		c.JSON(http.StatusBadRequest, apiErr("INVALID_REQUEST", err.Error()))
		return
	}
	if err := h.svc.SetCredential(c.Request.Context(), c.Param("id"), cred); err != nil {
		c.JSON(http.StatusInternalServerError, apiErr("CREDENTIAL_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Credential stored securely"})
}

func (h *Handler) UpdateStatus(c *gin.Context) {
	var body struct {
		Status string `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, apiErr("INVALID_REQUEST", err.Error()))
		return
	}
	if err := h.svc.UpdateStatus(c.Request.Context(), c.Param("id"), body.Status); err != nil {
		c.JSON(http.StatusInternalServerError, apiErr("UPDATE_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Status updated"})
}

func (h *Handler) UpdatePaytm(c *gin.Context) {
	var req UpdatePaytmRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, apiErr("INVALID_REQUEST", err.Error()))
		return
	}
	if err := h.svc.UpdatePaytm(c.Request.Context(), c.Param("id"), req); err != nil {
		c.JSON(http.StatusBadRequest, apiErr("UPDATE_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Paytm config updated"})
}

func apiErr(code, msg string) gin.H {
	return gin.H{"error": gin.H{
		"code":       code,
		"message":    msg,
		"request_id": security.GenerateRequestID(),
	}}
}

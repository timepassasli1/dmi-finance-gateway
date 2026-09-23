package client_documents

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

func (h *Handler) Upload(c *gin.Context) {
	claims := auth.MustGetClaims(c)
	client, err := h.clientsSvc.GetByUserID(c.Request.Context(), claims.UserID)
	if err != nil {
		c.JSON(http.StatusNotFound, apiErr("CLIENT_NOT_FOUND", err.Error()))
		return
	}

	docType := c.PostForm("document_type")
	if docType == "" {
		c.JSON(http.StatusBadRequest, apiErr("INVALID_REQUEST", "document_type required"))
		return
	}

	fh, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, apiErr("INVALID_FILE", "file required"))
		return
	}

	doc, err := h.svc.Upload(c.Request.Context(), client.ID, docType, fh)
	if err != nil {
		c.JSON(http.StatusInternalServerError, apiErr("UPLOAD_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusCreated, doc)
}

func (h *Handler) List(c *gin.Context) {
	claims := auth.MustGetClaims(c)
	client, err := h.clientsSvc.GetByUserID(c.Request.Context(), claims.UserID)
	if err != nil {
		c.JSON(http.StatusNotFound, apiErr("CLIENT_NOT_FOUND", err.Error()))
		return
	}
	docs, err := h.svc.List(c.Request.Context(), client.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, apiErr("LIST_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusOK, gin.H{"documents": docs})
}

func (h *Handler) AdminList(c *gin.Context) {
	docs, err := h.svc.AdminListAll(c.Request.Context(), c.Query("status"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, apiErr("LIST_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusOK, gin.H{"documents": docs})
}

func (h *Handler) AdminReview(c *gin.Context) {
	claims := auth.MustGetClaims(c)
	var body struct {
		Status string `json:"status" binding:"required"`
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, apiErr("INVALID_REQUEST", err.Error()))
		return
	}
	if err := h.svc.AdminReview(c.Request.Context(), c.Param("id"), body.Status, body.Reason, claims.UserID); err != nil {
		c.JSON(http.StatusInternalServerError, apiErr("REVIEW_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Document reviewed"})
}

func apiErr(code, msg string) gin.H {
	return gin.H{"error": gin.H{
		"code":       code,
		"message":    msg,
		"request_id": security.GenerateRequestID(),
	}}
}

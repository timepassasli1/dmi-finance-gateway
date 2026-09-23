package clients

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gateway/backend/internal/auth"
	"github.com/gateway/backend/pkg/security"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) GetProfile(c *gin.Context) {
	claims := auth.MustGetClaims(c)
	client, err := h.svc.GetByUserID(c.Request.Context(), claims.UserID)
	if err != nil {
		c.JSON(http.StatusNotFound, apiErr("CLIENT_NOT_FOUND", err.Error()))
		return
	}
	if tok, err := h.svc.EnsureShareToken(c.Request.Context(), client.ID); err == nil {
		client.ShareLinkToken = tok
	}
	c.JSON(http.StatusOK, client)
}

func (h *Handler) UpdateProfile(c *gin.Context) {
	claims := auth.MustGetClaims(c)
	client, err := h.svc.GetByUserID(c.Request.Context(), claims.UserID)
	if err != nil {
		c.JSON(http.StatusNotFound, apiErr("CLIENT_NOT_FOUND", err.Error()))
		return
	}

	var req UpdateProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, apiErr("INVALID_REQUEST", err.Error()))
		return
	}
	updated, err := h.svc.UpdateProfile(c.Request.Context(), client.ID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, apiErr("UPDATE_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusOK, updated)
}

func (h *Handler) UploadLogo(c *gin.Context) {
	claims := auth.MustGetClaims(c)
	client, err := h.svc.GetByUserID(c.Request.Context(), claims.UserID)
	if err != nil {
		c.JSON(http.StatusNotFound, apiErr("CLIENT_NOT_FOUND", err.Error()))
		return
	}
	file, err := c.FormFile("logo")
	if err != nil {
		c.JSON(http.StatusBadRequest, apiErr("INVALID_REQUEST", "logo file required"))
		return
	}
	if file.Size > 2*1024*1024 {
		c.JSON(http.StatusBadRequest, apiErr("INVALID_REQUEST", "logo must be under 2MB"))
		return
	}
	f, err := file.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, apiErr("INVALID_REQUEST", err.Error()))
		return
	}
	defer f.Close()

	url, err := h.svc.SaveLogoFile(client.ID, file.Filename, f)
	if err != nil {
		c.JSON(http.StatusBadRequest, apiErr("UPLOAD_FAILED", err.Error()))
		return
	}
	updated, err := h.svc.UpdateLogo(c.Request.Context(), client.ID, url)
	if err != nil {
		c.JSON(http.StatusInternalServerError, apiErr("UPDATE_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusOK, updated)
}

func (h *Handler) SubmitForReview(c *gin.Context) {
	claims := auth.MustGetClaims(c)
	client, err := h.svc.GetByUserID(c.Request.Context(), claims.UserID)
	if err != nil {
		c.JSON(http.StatusNotFound, apiErr("CLIENT_NOT_FOUND", err.Error()))
		return
	}
	if err := h.svc.SubmitForReview(c.Request.Context(), client.ID); err != nil {
		c.JSON(http.StatusBadRequest, apiErr("SUBMIT_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Submitted for review"})
}

// Admin handlers
func (h *Handler) AdminList(c *gin.Context) {
	status := c.Query("status")
	clients, total, err := h.svc.List(c.Request.Context(), status, 50, 0)
	if err != nil {
		c.JSON(http.StatusInternalServerError, apiErr("LIST_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusOK, gin.H{"clients": clients, "total": total})
}

func (h *Handler) AdminGet(c *gin.Context) {
	client, err := h.svc.GetByID(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, apiErr("CLIENT_NOT_FOUND", err.Error()))
		return
	}
	c.JSON(http.StatusOK, client)
}

func (h *Handler) AdminApprove(c *gin.Context) {
	claims := auth.MustGetClaims(c)
	if err := h.svc.Approve(c.Request.Context(), c.Param("id"), claims.UserID); err != nil {
		c.JSON(http.StatusBadRequest, apiErr("APPROVE_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Client approved"})
}

func (h *Handler) AdminReject(c *gin.Context) {
	var body struct {
		Reason string `json:"reason"`
	}
	c.ShouldBindJSON(&body)
	if err := h.svc.Reject(c.Request.Context(), c.Param("id"), body.Reason); err != nil {
		c.JSON(http.StatusBadRequest, apiErr("REJECT_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Client rejected"})
}

func (h *Handler) AdminSuspend(c *gin.Context) {
	var body struct {
		Reason string `json:"reason"`
	}
	c.ShouldBindJSON(&body)
	if err := h.svc.Suspend(c.Request.Context(), c.Param("id"), body.Reason); err != nil {
		c.JSON(http.StatusBadRequest, apiErr("SUSPEND_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Client suspended"})
}

func (h *Handler) GetSetupStatus(c *gin.Context) {
	claims := auth.MustGetClaims(c)
	client, err := h.svc.GetByUserID(c.Request.Context(), claims.UserID)
	if err != nil {
		c.JSON(http.StatusNotFound, apiErr("CLIENT_NOT_FOUND", err.Error()))
		return
	}
	st, err := h.svc.GetSetupStatus(c.Request.Context(), client.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, apiErr("SETUP_STATUS_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusOK, st)
}

// EnsureShareLink returns (or creates) the public caller create-link token.
func (h *Handler) EnsureShareLink(c *gin.Context) {
	claims := auth.MustGetClaims(c)
	client, err := h.svc.GetByUserID(c.Request.Context(), claims.UserID)
	if err != nil {
		c.JSON(http.StatusNotFound, apiErr("CLIENT_NOT_FOUND", err.Error()))
		return
	}
	tok, err := h.svc.EnsureShareToken(c.Request.Context(), client.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, apiErr("SHARE_LINK_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusOK, gin.H{"share_link_token": tok})
}

// RotateShareLink issues a new shared create token (old link stops working).
func (h *Handler) RotateShareLink(c *gin.Context) {
	claims := auth.MustGetClaims(c)
	client, err := h.svc.GetByUserID(c.Request.Context(), claims.UserID)
	if err != nil {
		c.JSON(http.StatusNotFound, apiErr("CLIENT_NOT_FOUND", err.Error()))
		return
	}
	tok, err := h.svc.RotateShareToken(c.Request.Context(), client.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, apiErr("SHARE_LINK_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusOK, gin.H{"share_link_token": tok})
}

func apiErr(code, msg string) gin.H {
	return gin.H{"error": gin.H{
		"code":       code,
		"message":    msg,
		"request_id": security.GenerateRequestID(),
	}}
}

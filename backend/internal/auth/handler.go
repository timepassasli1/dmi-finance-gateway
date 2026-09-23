package auth

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

func (h *Handler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, apiError("INVALID_REQUEST", err.Error()))
		return
	}
	resp, err := h.svc.Login(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusUnauthorized, apiError("INVALID_CREDENTIALS", err.Error()))
		return
	}
	c.JSON(http.StatusOK, resp)
}

func (h *Handler) Register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, apiError("INVALID_REQUEST", err.Error()))
		return
	}
	user, err := h.svc.Register(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusBadRequest, apiError("REGISTRATION_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusCreated, gin.H{"user": user, "message": "Registration successful. Please wait for admin approval."})
}

func (h *Handler) Me(c *gin.Context) {
	claims := MustGetClaims(c)
	user, err := h.svc.GetUser(c.Request.Context(), claims.UserID)
	if err != nil {
		c.JSON(http.StatusNotFound, apiError("USER_NOT_FOUND", "User not found"))
		return
	}
	c.JSON(http.StatusOK, user)
}

func apiError(code, msg string) gin.H {
	return gin.H{"error": gin.H{
		"code":       code,
		"message":    msg,
		"request_id": security.GenerateRequestID(),
	}}
}

// MustGetClaims extracts claims from gin context (set by middleware).
func MustGetClaims(c *gin.Context) *Claims {
	v, _ := c.Get("claims")
	return v.(*Claims)
}

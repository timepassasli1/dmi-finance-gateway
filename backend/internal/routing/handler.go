package routing

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gateway/backend/pkg/security"
)

type Handler struct {
	engine *Engine
}

func NewHandler(engine *Engine) *Handler {
	return &Handler{engine: engine}
}

func (h *Handler) CreateRoute(c *gin.Context) {
	var req CreateRouteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, apiErr("INVALID_REQUEST", err.Error()))
		return
	}
	route, err := h.engine.CreateRoute(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusBadRequest, apiErr("ROUTE_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusCreated, route)
}

func (h *Handler) ListRoutes(c *gin.Context) {
	clientID := c.Query("client_id")
	routes, err := h.engine.ListRoutesForClient(c.Request.Context(), clientID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, apiErr("LIST_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusOK, gin.H{"routes": routes})
}

func apiErr(code, msg string) gin.H {
	return gin.H{"error": gin.H{
		"code":       code,
		"message":    msg,
		"request_id": security.GenerateRequestID(),
	}}
}

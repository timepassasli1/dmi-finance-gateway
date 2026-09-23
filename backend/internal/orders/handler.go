package orders

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/gateway/backend/pkg/security"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// CreateOrder is called by client backend (authenticated with secret key).
// clientID must already be set in context by API key middleware.
func (h *Handler) CreateOrder(c *gin.Context) {
	clientID, _ := c.Get("client_id")
	var req CreateOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, apiErr("INVALID_REQUEST", err.Error()))
		return
	}

	order, err := h.svc.Create(c.Request.Context(), clientID.(string), req)
	if err != nil {
		if isConflict(err) {
			c.JSON(http.StatusConflict, apiErr("ORDER_ALREADY_EXISTS", err.Error()))
			return
		}
		c.JSON(http.StatusInternalServerError, apiErr("ORDER_CREATION_FAILED", err.Error()))
		return
	}

	c.JSON(http.StatusCreated, order)
}

func (h *Handler) GetOrder(c *gin.Context) {
	clientID, _ := c.Get("client_id")
	order, err := h.svc.Get(c.Request.Context(), c.Param("id"), clientID.(string))
	if err != nil {
		c.JSON(http.StatusNotFound, apiErr("PAYMENT_NOT_FOUND", err.Error()))
		return
	}
	c.JSON(http.StatusOK, order)
}

func (h *Handler) ListOrders(c *gin.Context) {
	clientID, _ := c.Get("client_id")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))

	orders, total, err := h.svc.List(c.Request.Context(), clientID.(string), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, apiErr("LIST_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusOK, gin.H{"orders": orders, "total": total})
}

func isConflict(err error) bool {
	return err != nil && len(err.Error()) > 20 && err.Error()[:20] == "ORDER_ALREADY_EXISTS"
}

func apiErr(code, msg string) gin.H {
	return gin.H{"error": gin.H{
		"code":       code,
		"message":    msg,
		"request_id": security.GenerateRequestID(),
	}}
}

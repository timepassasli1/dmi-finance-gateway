package payments

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
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

// InitiatePayment is called after order creation to start the payment.
func (h *Handler) InitiatePayment(c *gin.Context) {
	clientID, _ := c.Get("client_id")
	orderID := c.Param("order_id")

	payment, err := h.svc.InitiatePayment(c.Request.Context(), clientID.(string), orderID)
	if err != nil {
		status := http.StatusInternalServerError
		if isClientError(err) {
			status = http.StatusBadRequest
		}
		c.JSON(status, apiErr(errorCode(err), err.Error()))
		return
	}
	c.JSON(http.StatusCreated, payment)
}

// CreatePaymentLink creates a shareable payment link from the client dashboard (JWT).
func (h *Handler) CreatePaymentLink(c *gin.Context) {
	clientID, _ := c.Get("client_id")
	var req CreatePaymentLinkRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, apiErr("VALIDATION_ERROR", err.Error()))
		return
	}
	payment, err := h.svc.CreatePaymentLink(c.Request.Context(), clientID.(string), req)
	if err != nil {
		status := http.StatusInternalServerError
		if isClientError(err) {
			status = http.StatusBadRequest
		}
		c.JSON(status, apiErr(errorCode(err), err.Error()))
		return
	}
	c.JSON(http.StatusCreated, payment)
}

// GetShareInfo is public: callers open shared create page (no login).
func (h *Handler) GetShareInfo(c *gin.Context) {
	client, err := h.clientsSvc.GetByShareToken(c.Request.Context(), c.Param("token"))
	if err != nil {
		c.JSON(http.StatusNotFound, apiErr("SHARE_NOT_FOUND", "Invalid or inactive share link"))
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"business_name": client.BusinessName,
		"brand_color":   client.BrandColor,
		"logo_url":      client.LogoURL,
		"has_upi":       strings.TrimSpace(client.UPIVPA) != "",
	})
}

// CreateSharePaymentLink lets callers create a customer pay link via shared token.
func (h *Handler) CreateSharePaymentLink(c *gin.Context) {
	client, err := h.clientsSvc.GetByShareToken(c.Request.Context(), c.Param("token"))
	if err != nil {
		c.JSON(http.StatusNotFound, apiErr("SHARE_NOT_FOUND", "Invalid or inactive share link"))
		return
	}
	var req CreatePaymentLinkRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, apiErr("VALIDATION_ERROR", err.Error()))
		return
	}
	req.Type = "link"
	payment, err := h.svc.CreatePaymentLink(c.Request.Context(), client.ID, req)
	if err != nil {
		status := http.StatusInternalServerError
		if isClientError(err) {
			status = http.StatusBadRequest
		}
		c.JSON(status, apiErr(errorCode(err), err.Error()))
		return
	}
	c.JSON(http.StatusCreated, payment)
}

// GetPayment returns payment details (client scoped).
func (h *Handler) GetPayment(c *gin.Context) {
	clientID, _ := c.Get("client_id")
	payment, err := h.svc.GetByGatewayID(c.Request.Context(), c.Param("id"), clientID.(string))
	if err != nil {
		c.JSON(http.StatusNotFound, apiErr("PAYMENT_NOT_FOUND", err.Error()))
		return
	}
	c.JSON(http.StatusOK, payment)
}

// GetPaymentPublic is for the hosted payment page (no auth).
func (h *Handler) GetPaymentPublic(c *gin.Context) {
	payment, err := h.svc.GetPublic(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, apiErr("PAYMENT_NOT_FOUND", err.Error()))
		return
	}
	c.JSON(http.StatusOK, publicPaymentJSON(payment))
}

// WatchPayment records that the pay page was opened — extension watch history.
func (h *Handler) WatchPayment(c *gin.Context) {
	payment, err := h.svc.MarkWatched(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, apiErr("PAYMENT_NOT_FOUND", err.Error()))
		return
	}
	c.JSON(http.StatusOK, publicPaymentJSON(payment))
}

// ListWatchHistory is the merchant dashboard history of opened pay pages.
func (h *Handler) ListWatchHistory(c *gin.Context) {
	clientID, ok := c.Get("client_id")
	cid, _ := clientID.(string)
	if !ok || strings.TrimSpace(cid) == "" {
		c.JSON(http.StatusForbidden, apiErr("CLIENT_REQUIRED", "client scope required"))
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "40"))
	list, err := h.svc.ListWatchHistory(c.Request.Context(), cid, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, apiErr("LIST_FAILED", err.Error()))
		return
	}
	out := make([]gin.H, 0, len(list))
	for _, p := range list {
		out = append(out, gin.H{
			"gateway_payment_id": p.GatewayPaymentID,
			"client_order_id":    p.ClientOrderID,
			"amount":             p.Amount,
			"currency":           p.Currency,
			"status":             p.Status,
			"track_code":         p.TrackCode,
			"upi_note":           p.TrackCode,
			"merchant_name":      p.MerchantName,
			"last_watched_at":    p.LastWatchedAt,
			"created_at":         p.CreatedAt,
			"payment_url":        fmt.Sprintf("%s/pay/%s", strings.TrimRight(h.svc.GatewayURL(), "/"), p.GatewayPaymentID),
		})
	}
	c.JSON(http.StatusOK, gin.H{"payments": out, "total": len(out)})
}

// FreshIntent issues a new short-lived UPI intent/QR code (anti-replay).
func (h *Handler) FreshIntent(c *gin.Context) {
	payment, err := h.svc.FreshIntent(c.Request.Context(), c.Param("id"))
	if err != nil {
		status := http.StatusBadRequest
		if strings.Contains(err.Error(), "PAYMENT_NOT_FOUND") {
			status = http.StatusNotFound
		}
		c.JSON(status, apiErr(errorCode(err), err.Error()))
		return
	}
	c.JSON(http.StatusOK, publicPaymentJSON(payment))
}

func publicPaymentJSON(payment *Payment) gin.H {
	return gin.H{
		"gateway_payment_id":     payment.GatewayPaymentID,
		"gateway_order_id":       payment.GatewayOrderID,
		"client_order_id":        payment.ClientOrderID,
		"amount":                 payment.Amount,
		"currency":               payment.Currency,
		"status":                 payment.Status,
		"upi_intent_url":         payment.UPIIntentURL,
		"qr_data":                payment.QRData,
		"merchant_name":          payment.MerchantName,
		"merchant_logo_url":      payment.MerchantLogoURL,
		"brand_color":            payment.BrandColor,
		"merchant_upi_vpa":       payment.MerchantUPIVPA,
		"intent_code":            payment.IntentCode,
		"track_code":             TrackNoteFromCode(payment.IntentCode),
		"intent_code_expires_at": payment.IntentCodeExpiresAt,
		"expires_at":             payment.ExpiresAt,
		"created_at":             payment.CreatedAt,
	}
}

func (h *Handler) ListPayments(c *gin.Context) {
	clientID, _ := c.Get("client_id")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))

	payments, total, err := h.svc.List(c.Request.Context(), clientID.(string), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, apiErr("LIST_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusOK, gin.H{"payments": payments, "total": total})
}

func (h *Handler) GetStats(c *gin.Context) {
	clientID, _ := c.Get("client_id")
	stats, err := h.svc.ClientStats(c.Request.Context(), clientID.(string))
	if err != nil {
		c.JSON(http.StatusInternalServerError, apiErr("STATS_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusOK, stats)
}

func (h *Handler) AdminList(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))

	payments, total, err := h.svc.AdminList(c.Request.Context(), c.Query("status"), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, apiErr("LIST_FAILED", err.Error()))
		return
	}
	c.JSON(http.StatusOK, gin.H{"payments": payments, "total": total})
}

func isClientError(err error) bool {
	codes := []string{"CLIENT_INACTIVE", "KYC_NOT_APPROVED", "PAYMENT_EXPIRED", "ORDER_ALREADY_EXISTS", "PAYMENT_NOT_FOUND", "PROVIDER_UNAVAILABLE", "PAYMENT_NOT_PAYABLE"}
	for _, c := range codes {
		if isErrorCode(err, c) {
			return true
		}
	}
	return false
}

func errorCode(err error) string {
	codes := []string{"CLIENT_INACTIVE", "KYC_NOT_APPROVED", "PAYMENT_EXPIRED", "ORDER_ALREADY_EXISTS", "PAYMENT_NOT_FOUND", "PROVIDER_UNAVAILABLE", "PAYMENT_NOT_PAYABLE"}
	for _, c := range codes {
		if isErrorCode(err, c) {
			return c
		}
	}
	return "PAYMENT_CREATION_FAILED"
}

func apiErr(code, msg string) gin.H {
	return gin.H{"error": gin.H{
		"code":       code,
		"message":    msg,
		"request_id": security.GenerateRequestID(),
	}}
}

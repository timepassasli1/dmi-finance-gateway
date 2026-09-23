package api_keys

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gateway/backend/pkg/security"
)

// APIKeyMiddleware authenticates requests using sk_live_ or pk_live_ API keys.
type APIKeyMiddleware struct {
	svc *Service
}

func NewAPIKeyMiddleware(svc *Service) *APIKeyMiddleware {
	return &APIKeyMiddleware{svc: svc}
}

// RequireSecretKey verifies client secret key (for server-to-server calls).
func (m *APIKeyMiddleware) RequireSecretKey() gin.HandlerFunc {
	return func(c *gin.Context) {
		key := extractAPIKey(c)
		if key == "" || !strings.HasPrefix(key, "sk_live_") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": gin.H{"code": "INVALID_API_KEY", "message": "Valid secret API key required"},
			})
			return
		}

		clientID, keyID, err := m.svc.AuthenticateBySecretKey(c.Request.Context(), key)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": gin.H{"code": "INVALID_API_KEY", "message": "Invalid or revoked API key",
					"request_id": security.GenerateRequestID()},
			})
			return
		}

		c.Set("client_id", clientID)
		c.Set("api_key_id", keyID)
		c.Set("auth_type", "api_key")
		c.Next()
	}
}

// RequirePublicKey verifies client public key (for frontend-initiated calls).
func (m *APIKeyMiddleware) RequirePublicKey() gin.HandlerFunc {
	return func(c *gin.Context) {
		key := extractAPIKey(c)
		if key == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": gin.H{"code": "INVALID_API_KEY", "message": "API key required"},
			})
			return
		}

		clientID, keyID, err := m.svc.AuthenticateByPublicKey(c.Request.Context(), key)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": gin.H{"code": "INVALID_API_KEY", "message": "Invalid API key"},
			})
			return
		}

		c.Set("client_id", clientID)
		c.Set("api_key_id", keyID)
		c.Next()
	}
}

func extractAPIKey(c *gin.Context) string {
	// Check Authorization header: "Bearer sk_live_xxx" or "Basic" (base64 encoded)
	auth := c.GetHeader("Authorization")
	if auth != "" {
		parts := strings.SplitN(auth, " ", 2)
		if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
			return parts[1]
		}
	}
	// Check X-API-Key header
	if key := c.GetHeader("X-API-Key"); key != "" {
		return key
	}
	return ""
}

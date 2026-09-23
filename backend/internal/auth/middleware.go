package auth

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gateway/backend/pkg/security"
)

type Middleware struct {
	jwt *JWTManager
}

func NewMiddleware(jwt *JWTManager) *Middleware {
	return &Middleware{jwt: jwt}
}

// RequireAuth validates JWT token.
func (m *Middleware) RequireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Request-ID", security.GenerateRequestID())

		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": gin.H{"code": "UNAUTHORIZED", "message": "Authorization header required"},
			})
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": gin.H{"code": "UNAUTHORIZED", "message": "Invalid authorization format"},
			})
			return
		}

		claims, err := m.jwt.Verify(parts[1])
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": gin.H{"code": "UNAUTHORIZED", "message": "Invalid or expired token"},
			})
			return
		}

		c.Set("claims", claims)
		c.Set("user_id", claims.UserID)
		c.Set("role", claims.Role)
		c.Set("client_id", claims.ClientID)
		c.Next()
	}
}

// RequireRole requires specific roles.
func (m *Middleware) RequireRole(roles ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		claims := MustGetClaims(c)
		for _, r := range roles {
			if claims.Role == r {
				c.Next()
				return
			}
		}
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
			"error": gin.H{"code": "FORBIDDEN", "message": "Insufficient permissions"},
		})
	}
}

// RequireAdmin requires PLATFORM_ADMIN role.
func (m *Middleware) RequireAdmin() gin.HandlerFunc {
	return m.RequireRole(RolePlatformAdmin)
}

// RequireClient requires CLIENT_ADMIN or CLIENT_STAFF role.
func (m *Middleware) RequireClient() gin.HandlerFunc {
	return m.RequireRole(RoleClientAdmin, RoleClientStaff)
}

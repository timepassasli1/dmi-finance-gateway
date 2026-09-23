package admin

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// AgentAuthMiddleware authenticates verification agent requests.
func AgentAuthMiddleware(svc *AgentService) gin.HandlerFunc {
	return func(c *gin.Context) {
		agentCode := c.GetHeader("X-Agent-Code")
		agentSecret := c.GetHeader("X-Agent-Secret")

		// Also accept Authorization: Bearer <code>:<secret>
		if agentCode == "" {
			auth := c.GetHeader("Authorization")
			if strings.HasPrefix(auth, "Bearer ") {
				parts := strings.SplitN(strings.TrimPrefix(auth, "Bearer "), ":", 2)
				if len(parts) == 2 {
					agentCode = parts[0]
					agentSecret = parts[1]
				}
			}
		}

		if agentCode == "" || agentSecret == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": gin.H{"code": "UNAUTHORIZED", "message": "Agent credentials required"},
			})
			return
		}

		agent, err := svc.Authenticate(c.Request.Context(), agentCode, agentSecret)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": gin.H{"code": "UNAUTHORIZED", "message": "Invalid agent credentials"},
			})
			return
		}

		c.Set("agent_id", agent.ID)
		c.Set("agent_code", agent.AgentCode)
		if agent.ClientID != "" {
			c.Set("agent_client_id", agent.ClientID)
		}
		if agent.ProcessingMerchantID != "" {
			c.Set("agent_processing_merchant_id", agent.ProcessingMerchantID)
		}
		c.Next()
	}
}

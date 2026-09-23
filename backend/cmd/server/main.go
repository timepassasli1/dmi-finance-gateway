package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/pressly/goose/v3"

	adminpkg "github.com/gateway/backend/internal/admin"
	"github.com/gateway/backend/internal/api_keys"
	"github.com/gateway/backend/internal/audit"
	"github.com/gateway/backend/internal/auth"
	"github.com/gateway/backend/internal/client_documents"
	"github.com/gateway/backend/internal/clients"
	"github.com/gateway/backend/internal/orders"
	"github.com/gateway/backend/internal/payment_providers"
	"github.com/gateway/backend/internal/payments"
	"github.com/gateway/backend/internal/processing_merchants"
	"github.com/gateway/backend/internal/refunds"
	"github.com/gateway/backend/internal/routing"
	"github.com/gateway/backend/internal/verification"
	"github.com/gateway/backend/internal/wallet"
	"github.com/gateway/backend/internal/webhooks"
	"github.com/gateway/backend/pkg/database"
	"github.com/gateway/backend/pkg/logger"

	_ "github.com/lib/pq"
)

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	log := logger.New("server")

	// Database — supports DATABASE_URL (Railway/Neon/Render) or individual DB_* vars
	var db *sql.DB
	var dbErr error
	if dbURL := os.Getenv("DATABASE_URL"); dbURL != "" {
		db, dbErr = database.ConnectURL(dbURL, 25, 10)
	} else {
		dbHost := getenv("DB_HOST", "localhost")
		dbPort := 5432
		fmt.Sscanf(getenv("DB_PORT", "5432"), "%d", &dbPort)
		db, dbErr = database.Connect(database.Config{
			Host:         dbHost,
			Port:         dbPort,
			Name:         getenv("DB_NAME", "gateway"),
			User:         getenv("DB_USER", "gateway"),
			Password:     getenv("DB_PASSWORD", "gateway_secret"),
			SSLMode:      getenv("DB_SSL_MODE", "disable"),
			MaxOpenConns: 25,
			MaxIdleConns: 10,
		})
	}
	if dbErr != nil {
		log.Error("database connection failed", map[string]interface{}{"error": dbErr.Error()})
		os.Exit(1)
	}
	defer db.Close()

	// Run migrations
	goose.SetBaseFS(nil)
	if err := goose.SetDialect("postgres"); err != nil {
		log.Error("goose dialect", map[string]interface{}{"error": err.Error()})
		os.Exit(1)
	}
	if err := goose.Up(db, "migrations"); err != nil {
		log.Error("migrations failed", map[string]interface{}{"error": err.Error()})
		os.Exit(1)
	}
	log.Info("migrations applied")

	encKey := getenv("ENCRYPTION_KEY", "0000000000000000000000000000000000000000000000000000000000000000")
	jwtSecret := getenv("JWT_SECRET", "dev_jwt_secret_at_least_32_chars_long!")
	gatewayURL := getenv("NEXT_PUBLIC_GATEWAY_URL", "https://gpzes.com")
	if gatewayURL == "" || strings.Contains(gatewayURL, "localhost") || strings.Contains(gatewayURL, "127.0.0.1") {
		gatewayURL = "https://gpzes.com"
	}
	uploadDir := getenv("UPLOAD_DIR", "./uploads")
	mockPayments := getenv("MOCK_PAYMENTS", "true") == "true"
	appEnv := getenv("APP_ENV", "development")

	// Services
	jwtManager := auth.NewJWTManager(jwtSecret, 15*time.Minute)
	authSvc := auth.NewService(db, jwtManager)
	authMiddleware := auth.NewMiddleware(jwtManager)

	clientsSvc := clients.NewService(db, uploadDir)
	docsSvc := client_documents.NewService(db, uploadDir)
	apiKeySvc := api_keys.NewService(db, encKey)
	apiKeyMiddleware := api_keys.NewAPIKeyMiddleware(apiKeySvc)
	merchantsSvc := processing_merchants.NewService(db, encKey)
	routeEngine := routing.NewEngine(db)
	ordersSvc := orders.NewService(db)
	walletSvc := wallet.NewService(db)
	webhookSvc := webhooks.NewService(db, encKey)

	// Provider registry
	provReg := payment_providers.NewRegistry()
	if mockPayments || appEnv == "development" {
		provReg.Register(payment_providers.NewMockProvider())
	}

	paymentsSvc := payments.NewService(db, routeEngine, provReg, clientsSvc, ordersSvc, gatewayURL)
	verificationEngine := verification.NewEngine(db, provReg, paymentsSvc, walletSvc, webhookSvc)
	refundsSvc := refunds.NewService(db, provReg, walletSvc)
	auditSvc := audit.NewService(db)
	agentSvc := adminpkg.NewAgentService(db)

	// Handlers
	authHandler := auth.NewHandler(authSvc)
	clientsHandler := clients.NewHandler(clientsSvc)
	docsHandler := client_documents.NewHandler(docsSvc, clientsSvc)
	apiKeyHandler := api_keys.NewHandler(apiKeySvc, clientsSvc)
	merchantsHandler := processing_merchants.NewHandler(merchantsSvc)
	routeHandler := routing.NewHandler(routeEngine)
	orderHandler := orders.NewHandler(ordersSvc)
	paymentHandler := payments.NewHandler(paymentsSvc, clientsSvc)
	verifyHandler := verification.NewHandler(verificationEngine)
	walletHandler := wallet.NewHandler(walletSvc, clientsSvc)
	webhookHandler := webhooks.NewHandler(webhookSvc, clientsSvc)
	refundHandler := refunds.NewHandler(refundsSvc, clientsSvc)
	agentHandler := adminpkg.NewAgentHandler(agentSvc)

	// Seed admin user
	ctx := context.Background()
	adminEmail := getenv("ADMIN_EMAIL", "admin@gateway.local")
	adminPwd := getenv("ADMIN_PASSWORD", "Admin@123456")
	if err := authSvc.CreateAdminUser(ctx, adminEmail, adminPwd); err != nil {
		log.Error("create admin user", map[string]interface{}{"error": err.Error()})
	}

	// Seed browser-extension verification agent (dev default)
	extCode := getenv("EXT_AGENT_CODE", "EXT_WATCHER_01")
	extSecret := getenv("EXT_AGENT_SECRET", "ext_watcher_secret_change_me")
	if _, err := agentSvc.Register(ctx, adminpkg.RegisterAgentRequest{
		AgentCode:   extCode,
		DisplayName: "Browser Payment Watcher",
		Secret:      extSecret,
		Version:     "1.0.0",
	}, "127.0.0.1"); err != nil {
		log.Error("register extension agent", map[string]interface{}{"error": err.Error()})
	} else {
		log.Info("extension agent ready", map[string]interface{}{"agent_code": extCode})
	}

	// Router
	if appEnv != "development" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("X-XSS-Protection", "1; mode=block")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Next()
	})

	// CORS
	r.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-API-Key, X-Agent-Code, X-Agent-Secret")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	// Health
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok", "service": "gateway", "time": time.Now().UTC()})
	})
	r.GET("/ready", func(c *gin.Context) {
		if err := db.PingContext(c.Request.Context()); err != nil {
			c.JSON(503, gin.H{"status": "not_ready", "error": err.Error()})
			return
		}
		c.JSON(200, gin.H{"status": "ready"})
	})

	// Public payment page data
	r.GET("/v1/pay/:id", paymentHandler.GetPaymentPublic)
	r.POST("/v1/pay/:id/watch", paymentHandler.WatchPayment)
	r.POST("/v1/pay/:id/fresh-intent", paymentHandler.FreshIntent)
	// Shared caller create page (no login)
	r.GET("/v1/share/:token", paymentHandler.GetShareInfo)
	r.POST("/v1/share/:token/payment-links", paymentHandler.CreateSharePaymentLink)

	// Serve uploaded logos / documents
	r.Static("/uploads", uploadDir)

	v1 := r.Group("/v1")

	// Auth
	authGroup := v1.Group("/auth")
	authGroup.POST("/login", authHandler.Login)
	authGroup.POST("/register", authHandler.Register)
	authGroup.GET("/me", authMiddleware.RequireAuth(), authHandler.Me)

	// Client API (JWT auth)
	clientGroup := v1.Group("/client", authMiddleware.RequireAuth(), authMiddleware.RequireClient())
	clientGroup.GET("/profile", clientsHandler.GetProfile)
	clientGroup.POST("/profile", clientsHandler.UpdateProfile)
	clientGroup.POST("/logo", clientsHandler.UploadLogo)
	clientGroup.POST("/submit-review", clientsHandler.SubmitForReview)
	clientGroup.POST("/documents", docsHandler.Upload)
	clientGroup.GET("/documents", docsHandler.List)
	clientGroup.POST("/api-keys", apiKeyHandler.Generate)
	clientGroup.GET("/api-keys", apiKeyHandler.List)
	clientGroup.POST("/api-keys/:id/revoke", apiKeyHandler.Revoke)

	// Wallet & Ledger (JWT auth)
	clientGroup.GET("/wallet", walletHandler.GetWallet)
	clientGroup.GET("/wallet/ledger", walletHandler.GetLedger)

	// Webhooks (JWT auth)
	clientGroup.POST("/webhooks", webhookHandler.Register)
	clientGroup.GET("/webhooks", webhookHandler.List)
	clientGroup.POST("/webhooks/test", webhookHandler.TestWebhook)
	clientGroup.PATCH("/webhooks/:id", webhookHandler.Update)
	clientGroup.DELETE("/webhooks/:id", webhookHandler.Delete)

	// Refunds (JWT auth)
	clientGroup.POST("/refunds", refundHandler.Create)
	clientGroup.GET("/refunds", refundHandler.List)

	// Payments (JWT auth - for client dashboard viewing)
	clientGroup.GET("/payments", paymentHandler.ListPayments)
	clientGroup.GET("/payments/:id", paymentHandler.GetPayment)
	clientGroup.GET("/stats", paymentHandler.GetStats)
	clientGroup.GET("/setup-status", clientsHandler.GetSetupStatus)
	clientGroup.GET("/watch-history", paymentHandler.ListWatchHistory)
	clientGroup.POST("/payment-links", paymentHandler.CreatePaymentLink)
	clientGroup.POST("/share-link", clientsHandler.EnsureShareLink)
	clientGroup.POST("/share-link/rotate", clientsHandler.RotateShareLink)

	// Orders & Payments (API Key auth - server-to-server)
	apiGroup := v1.Group("/", apiKeyMiddleware.RequireSecretKey())
	apiGroup.POST("/orders", orderHandler.CreateOrder)
	apiGroup.GET("/orders/:id", orderHandler.GetOrder)
	apiGroup.POST("/orders/:order_id/pay", paymentHandler.InitiatePayment)
	apiGroup.GET("/payments/:id", paymentHandler.GetPayment)
	apiGroup.POST("/payments/:id/verify", verifyHandler.VerifyPayment)

	// Admin routes
	adminGroup := v1.Group("/admin", authMiddleware.RequireAuth(), authMiddleware.RequireAdmin())
	adminGroup.GET("/clients", clientsHandler.AdminList)
	adminGroup.GET("/clients/:id", clientsHandler.AdminGet)
	adminGroup.POST("/clients/:id/approve", clientsHandler.AdminApprove)
	adminGroup.POST("/clients/:id/reject", clientsHandler.AdminReject)
	adminGroup.POST("/clients/:id/suspend", clientsHandler.AdminSuspend)
	adminGroup.POST("/clients/:id/api-keys", apiKeyHandler.AdminGenerateForClient)

	adminGroup.GET("/documents", docsHandler.AdminList)
	adminGroup.POST("/documents/:id/review", docsHandler.AdminReview)

	adminGroup.GET("/processing-merchants", merchantsHandler.List)
	adminGroup.POST("/processing-merchants", merchantsHandler.Create)
	adminGroup.GET("/processing-merchants/:id", merchantsHandler.Get)
	adminGroup.POST("/processing-merchants/:id/status", merchantsHandler.UpdateStatus)
	adminGroup.PATCH("/processing-merchants/:id/paytm", merchantsHandler.UpdatePaytm)
	adminGroup.POST("/processing-merchants/:id/credentials", merchantsHandler.SetCredential)

	adminGroup.GET("/routes", routeHandler.ListRoutes)
	adminGroup.POST("/routes", routeHandler.CreateRoute)

	adminGroup.GET("/payments", paymentHandler.AdminList)
	adminGroup.GET("/wallets", walletHandler.AdminGetWallets)
	adminGroup.GET("/audit-logs", func(c *gin.Context) {
		logs, total, err := auditSvc.List(c.Request.Context(), c.Query("client_id"), 50, 0)
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		c.JSON(200, gin.H{"logs": logs, "total": total})
	})
	adminGroup.GET("/agents", agentHandler.AdminList)
	adminGroup.POST("/agents/bind", agentHandler.AdminBindClient)
	adminGroup.POST("/clients/:id/agents", agentHandler.AdminRegisterForClient)

	// Dashboard stats
	adminGroup.GET("/stats", func(c *gin.Context) {
		var totalClients, activeClients, pendingKYC int
		var totalPayments, successPayments int
		var totalVolume int64
		db.QueryRowContext(ctx, `SELECT COUNT(*) FROM clients`).Scan(&totalClients)
		db.QueryRowContext(ctx, `SELECT COUNT(*) FROM clients WHERE status = 'ACTIVE'`).Scan(&activeClients)
		db.QueryRowContext(ctx, `SELECT COUNT(*) FROM clients WHERE kyc_status IN ('SUBMITTED','UNDER_REVIEW')`).Scan(&pendingKYC)
		db.QueryRowContext(ctx, `SELECT COUNT(*) FROM payments`).Scan(&totalPayments)
		db.QueryRowContext(ctx, `SELECT COUNT(*) FROM payments WHERE status = 'SUCCESS'`).Scan(&successPayments)
		db.QueryRowContext(ctx, `SELECT COALESCE(SUM(amount),0) FROM payments WHERE status = 'SUCCESS'`).Scan(&totalVolume)
		c.JSON(200, gin.H{
			"total_clients":    totalClients,
			"active_clients":   activeClients,
			"pending_kyc":      pendingKYC,
			"total_payments":   totalPayments,
			"success_payments": successPayments,
			"total_volume":     totalVolume,
		})
	})

	// Verification Agent endpoints
	agentPublic := v1.Group("/agents")
	agentPublic.POST("/register", agentHandler.Register)

	agentAuth := v1.Group("/agents", adminpkg.AgentAuthMiddleware(agentSvc))
	agentAuth.POST("/heartbeat", agentHandler.Heartbeat)
	agentAuth.GET("/config", agentHandler.GetConfig)
	agentAuth.GET("/pending-payments", verifyHandler.AgentPendingPayments)
	agentAuth.GET("/watch-history", verifyHandler.AgentWatchHistory)
	agentAuth.POST("/verification-event", verifyHandler.AgentVerificationEvent)
	agentAuth.POST("/reconcile", func(c *gin.Context) {
		c.JSON(200, gin.H{"message": "reconciliation accepted"})
	})

	// Mock control (development only)
	if mockPayments && appEnv == "development" {
		r.POST("/dev/mock/set-state", func(c *gin.Context) {
			var body struct {
				State string `json:"state"`
			}
			c.ShouldBindJSON(&body)
			state := strings.ToLower(strings.TrimSpace(body.State))
			switch state {
			case "success", "failed", "pending", "amount_mismatch":
			default:
				c.JSON(400, gin.H{"error": "state must be success|failed|pending|amount_mismatch"})
				return
			}
			mp, err := provReg.Get("mock")
			if err == nil {
				if m, ok := mp.(*payment_providers.MockPaymentProvider); ok {
					m.SimulateState = state
					c.JSON(200, gin.H{"mock_state": state})
					return
				}
			}
			c.JSON(400, gin.H{"error": "mock provider not available"})
		})
	}

	// Run server
	port := getenv("APP_PORT", "8080")
	srv := &http.Server{
		Addr:    ":" + port,
		Handler: r,
	}

	go func() {
		log.Info("server starting", map[string]interface{}{"port": port, "env": appEnv})
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Error("server error", map[string]interface{}{"error": err.Error()})
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Info("shutting down")
	ctx2, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	srv.Shutdown(ctx2)
}

// Suppress unused import
var _ = log.Printf

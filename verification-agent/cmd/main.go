package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gateway/verification-agent/internal/agent"
	"github.com/gateway/verification-agent/internal/sources"
)

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	cfg := agent.Config{
		GatewayURL:        getenv("AGENT_GATEWAY_URL", "http://localhost:8080"),
		AgentCode:         getenv("AGENT_CODE", "AGENT_001"),
		Secret:            getenv("AGENT_SECRET", "agent_secret_change_in_production"),
		HeartbeatInterval: 30 * time.Second,
		Version:           "0.1.0",
	}

	if cfg.Secret == "" {
		fmt.Fprintln(os.Stderr, "[agent] AGENT_SECRET must be set")
		os.Exit(1)
	}

	// Use mock source in development
	var src agent.TransactionSource
	sourceType := getenv("AGENT_SOURCE", "mock")
	switch sourceType {
	case "mock":
		src = sources.NewMockSource()
		fmt.Println("[agent] Using mock transaction source (development only)")
	default:
		fmt.Fprintf(os.Stderr, "[agent] Unknown source type: %s\n", sourceType)
		os.Exit(1)
	}

	a := agent.New(cfg, src)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-quit
		fmt.Println("[agent] Shutting down...")
		cancel()
	}()

	if err := a.Run(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "[agent] error: %v\n", err)
		os.Exit(1)
	}
}

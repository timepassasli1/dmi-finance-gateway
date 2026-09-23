#!/bin/bash
set -e

echo "=== Gateway Platform Setup ==="

# Check for Go
if ! command -v go &>/dev/null; then
  echo "Go not found. Installing via Homebrew..."
  if command -v brew &>/dev/null; then
    brew install go
  else
    echo "Please install Go from https://go.dev/dl/ and re-run this script"
    exit 1
  fi
fi

echo "Go version: $(go version)"

# Check for Node.js
if ! command -v node &>/dev/null; then
  echo "Node.js not found. Please install from https://nodejs.org"
  exit 1
fi

echo "Node version: $(node --version)"

# Check for Docker
if command -v docker &>/dev/null; then
  echo "Docker found. You can run: docker compose up --build"
fi

# Copy env
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

# Backend dependencies
echo ""
echo "=== Installing Backend Dependencies ==="
cd backend
go mod tidy
echo "Backend dependencies installed"
cd ..

# Frontend dependencies
echo ""
echo "=== Installing Frontend Dependencies ==="
cd frontend
npm install
echo "Frontend dependencies installed"
cd ..

# Verification agent
echo ""
echo "=== Installing Agent Dependencies ==="
cd verification-agent
go mod tidy 2>/dev/null || true
cd ..

echo ""
echo "=== Setup Complete ==="
echo ""
echo "To start with Docker:"
echo "  docker compose up --build"
echo ""
echo "To start locally (requires PostgreSQL + Redis):"
echo "  # Terminal 1: Backend"
echo "  cd backend && APP_ENV=development MOCK_PAYMENTS=true go run ./cmd/server"
echo ""
echo "  # Terminal 2: Frontend"
echo "  cd frontend && npm run dev"
echo ""
echo "  # Terminal 3: Agent (optional)"
echo "  cd verification-agent && go run ./cmd"
echo ""
echo "Admin login: admin@gateway.local / Admin@123456"

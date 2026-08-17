#!/bin/bash

# Marketing AI - Start All Services
# This script starts both backend and frontend services

set -e  # Exit on error

echo "=================================="
echo "Marketing AI - Starting All Services"
echo "=================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get project root directory
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"

# Check if backend directory exists
if [ ! -d "$BACKEND_DIR" ]; then
    echo -e "${RED}Error: Backend directory not found at $BACKEND_DIR${NC}"
    exit 1
fi

# Check if node_modules exists
if [ ! -d "$PROJECT_ROOT/node_modules" ]; then
    echo -e "${YELLOW}Warning: node_modules not found. Running npm install...${NC}"
    npm install
fi

# Check if backend .env exists
if [ ! -f "$BACKEND_DIR/.env" ]; then
    echo -e "${RED}Error: Backend .env file not found at $BACKEND_DIR/.env${NC}"
    echo "Please copy .env.example to .env and configure it"
    exit 1
fi

# Check if frontend .env exists
if [ ! -f "$PROJECT_ROOT/.env" ]; then
    echo -e "${YELLOW}Warning: Frontend .env file not found at $PROJECT_ROOT/.env${NC}"
    echo "Please copy .env.example to .env and configure it"
fi

echo -e "${BLUE}[1/2] Starting Backend Services...${NC}"
echo "  - Redis"
echo "  - Celery Worker"
echo "  - FastAPI Server"
echo ""

cd "$BACKEND_DIR"
./start_all.sh

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Backend services started successfully${NC}"
else
    echo -e "${RED}✗ Failed to start backend services${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}[2/2] Starting Frontend Development Server...${NC}"
echo ""

cd "$PROJECT_ROOT"

# Kill any existing Vite process on port 5173
EXISTING_VITE_PID=$(lsof -ti:5173 2>/dev/null || true)
if [ ! -z "$EXISTING_VITE_PID" ]; then
    echo -e "${YELLOW}Killing existing process on port 5173 (PID: $EXISTING_VITE_PID)${NC}"
    kill -9 $EXISTING_VITE_PID 2>/dev/null || true
    sleep 1
fi

# Start frontend in background
nohup npm run dev > logs/frontend.log 2>&1 &
FRONTEND_PID=$!

# Save frontend PID
echo $FRONTEND_PID > .frontend_pid

# Wait a moment for frontend to start
echo "Waiting for frontend to start..."
sleep 3

# Check if frontend is running
if ps -p $FRONTEND_PID > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Frontend server started successfully (PID: $FRONTEND_PID)${NC}"
else
    echo -e "${RED}✗ Failed to start frontend server${NC}"
    echo "Check logs/frontend.log for details"
    exit 1
fi

echo ""
echo "=================================="
echo -e "${GREEN}All Services Started Successfully!${NC}"
echo "=================================="
echo ""
echo "Access Points:"
echo "  Frontend:     http://localhost:5173"
echo "  Backend API:  http://localhost:8000"
echo "  API Docs:     http://localhost:8000/api/docs"
echo ""
echo "Logs:"
echo "  Frontend:     tail -f logs/frontend.log"
echo "  Backend API:  tail -f backend/logs/api.log"
echo "  Celery:       tail -f backend/logs/celery.log"
echo ""
echo "Commands:"
echo "  Check Status: ./status.sh"
echo "  Stop All:     ./stop_all.sh"
echo ""
echo "=================================="

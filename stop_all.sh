#!/bin/bash

# Marketing AI - Stop All Services
# This script stops both backend and frontend services

echo "=================================="
echo "Marketing AI - Stopping All Services"
echo "=================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get project root directory
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"

# Stop Frontend
echo "Stopping Frontend..."
if [ -f "$PROJECT_ROOT/.frontend_pid" ]; then
    FRONTEND_PID=$(cat "$PROJECT_ROOT/.frontend_pid")
    if ps -p $FRONTEND_PID > /dev/null 2>&1; then
        kill $FRONTEND_PID 2>/dev/null || true
        sleep 1
        if ps -p $FRONTEND_PID > /dev/null 2>&1; then
            kill -9 $FRONTEND_PID 2>/dev/null || true
        fi
        echo -e "${GREEN}✓ Frontend stopped (PID: $FRONTEND_PID)${NC}"
    else
        echo -e "${YELLOW}Frontend not running${NC}"
    fi
    rm -f "$PROJECT_ROOT/.frontend_pid"
else
    # Try to find and kill any process on port 5173
    FRONTEND_PID=$(lsof -ti:5173 2>/dev/null || true)
    if [ ! -z "$FRONTEND_PID" ]; then
        kill -9 $FRONTEND_PID 2>/dev/null || true
        echo -e "${GREEN}✓ Killed process on port 5173 (PID: $FRONTEND_PID)${NC}"
    else
        echo -e "${YELLOW}No frontend process found${NC}"
    fi
fi

echo ""

# Stop Backend
echo "Stopping Backend Services..."
if [ -d "$BACKEND_DIR" ]; then
    cd "$BACKEND_DIR"
    if [ -f "./stop_all.sh" ]; then
        ./stop_all.sh
        echo -e "${GREEN}✓ Backend services stopped${NC}"
    else
        echo -e "${RED}Backend stop script not found${NC}"
    fi
else
    echo -e "${RED}Backend directory not found${NC}"
fi

echo ""
echo "=================================="
echo -e "${GREEN}All Services Stopped${NC}"
echo "=================================="

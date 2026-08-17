#!/bin/bash

# Marketing AI - Check Status of All Services
# This script checks if backend and frontend services are running

echo "=================================="
echo "Marketing AI - Services Status"
echo "=================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get project root directory
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"

ALL_RUNNING=true

# Check Frontend
echo -e "${BLUE}Frontend (Vite Dev Server):${NC}"
FRONTEND_PORT_PID=$(lsof -ti:5173 2>/dev/null || true)
if [ ! -z "$FRONTEND_PORT_PID" ]; then
    echo -e "  Status: ${GREEN}RUNNING${NC} (PID: $FRONTEND_PORT_PID)"
    echo -e "  URL:    http://localhost:5173"
    echo -e "  Logs:   tail -f logs/frontend.log"
else
    echo -e "  Status: ${RED}NOT RUNNING${NC}"
    ALL_RUNNING=false
fi

echo ""

# Check Backend Services
echo -e "${BLUE}Backend Services:${NC}"

# Check Redis
REDIS_PID=$(pgrep -f "redis-server" 2>/dev/null || true)
if [ ! -z "$REDIS_PID" ]; then
    echo -e "  Redis:  ${GREEN}RUNNING${NC} (PID: $REDIS_PID)"
else
    echo -e "  Redis:  ${RED}NOT RUNNING${NC}"
    ALL_RUNNING=false
fi

# Check Celery
if [ -f "$BACKEND_DIR/.backend_pids" ]; then
    CELERY_PID=$(grep "celery_pid=" "$BACKEND_DIR/.backend_pids" 2>/dev/null | cut -d'=' -f2)
    if [ ! -z "$CELERY_PID" ] && ps -p $CELERY_PID > /dev/null 2>&1; then
        echo -e "  Celery: ${GREEN}RUNNING${NC} (PID: $CELERY_PID)"
    else
        echo -e "  Celery: ${RED}NOT RUNNING${NC}"
        ALL_RUNNING=false
    fi
else
    echo -e "  Celery: ${RED}NOT RUNNING${NC}"
    ALL_RUNNING=false
fi

# Check FastAPI
API_PORT_PID=$(lsof -ti:8000 2>/dev/null || true)
if [ ! -z "$API_PORT_PID" ]; then
    echo -e "  API:    ${GREEN}RUNNING${NC} (PID: $API_PORT_PID)"
    echo -e "  URL:    http://localhost:8000"
    echo -e "  Docs:   http://localhost:8000/api/docs"
    echo -e "  Logs:   tail -f backend/logs/api.log"
else
    echo -e "  API:    ${RED}NOT RUNNING${NC}"
    ALL_RUNNING=false
fi

echo ""

# Check Backend Logs Location
if [ -d "$BACKEND_DIR/logs" ]; then
    echo -e "${BLUE}Backend Logs:${NC}"
    echo "  tail -f backend/logs/api.log"
    echo "  tail -f backend/logs/celery.log"
    echo ""
fi

# Summary
echo "=================================="
if [ "$ALL_RUNNING" = true ]; then
    echo -e "${GREEN}All Services Running ✓${NC}"
else
    echo -e "${YELLOW}Some Services Not Running${NC}"
    echo ""
    echo "To start all services:"
    echo "  ./start_all.sh"
fi
echo "=================================="

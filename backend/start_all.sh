#!/bin/bash

# Start All Backend Services
# Usage: ./start_all.sh

set -e

cd "$(dirname "$0")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# PID file to track processes
PID_FILE=".backend_pids"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Starting Marketing AI Backend Services${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
    echo -e "${GREEN}✓ Environment variables loaded${NC}"
else
    echo -e "${RED}✗ Warning: .env file not found${NC}"
    echo -e "${YELLOW}  Copy .env.example to .env and configure it${NC}"
    exit 1
fi

# Cleanup function
cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down services...${NC}"

    if [ -f "$PID_FILE" ]; then
        while read pid; do
            if ps -p $pid > /dev/null 2>&1; then
                echo -e "${YELLOW}Stopping process $pid${NC}"
                kill $pid 2>/dev/null || true
            fi
        done < "$PID_FILE"
        rm -f "$PID_FILE"
    fi

    echo -e "${GREEN}✓ All services stopped${NC}"
    exit 0
}

# Trap CTRL+C and cleanup
trap cleanup SIGINT SIGTERM

# Clear old PID file
rm -f "$PID_FILE"

# Check if Redis is already running
if pgrep -x "redis-server" > /dev/null; then
    echo -e "${GREEN}✓ Redis is already running${NC}"
else
    # Start Redis
    echo -e "${YELLOW}Starting Redis...${NC}"
    redis-server --daemonize yes --port 6379

    # Wait for Redis to start
    sleep 2

    if pgrep -x "redis-server" > /dev/null; then
        echo -e "${GREEN}✓ Redis started successfully${NC}"
        # Store Redis PID
        pgrep -x "redis-server" >> "$PID_FILE"
    else
        echo -e "${RED}✗ Failed to start Redis${NC}"
        exit 1
    fi
fi

# Start Celery Worker
echo -e "${YELLOW}Starting Celery worker...${NC}"
PYTHONPATH="${PWD}:${PYTHONPATH}" celery -A celery_app.celery worker --loglevel=info --concurrency=2 > logs/celery.log 2>&1 &
CELERY_PID=$!
echo $CELERY_PID >> "$PID_FILE"

# Wait for Celery to initialize
sleep 3

if ps -p $CELERY_PID > /dev/null; then
    echo -e "${GREEN}✓ Celery worker started (PID: $CELERY_PID)${NC}"
else
    echo -e "${RED}✗ Failed to start Celery worker${NC}"
    cleanup
    exit 1
fi

# Start FastAPI Server
echo -e "${YELLOW}Starting FastAPI server...${NC}"
PYTHONPATH="${PWD}:${PYTHONPATH}" python3 -m uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload > logs/api.log 2>&1 &
API_PID=$!
echo $API_PID >> "$PID_FILE"

# Wait for API to start
sleep 3

if ps -p $API_PID > /dev/null; then
    echo -e "${GREEN}✓ FastAPI server started (PID: $API_PID)${NC}"
else
    echo -e "${RED}✗ Failed to start FastAPI server${NC}"
    cleanup
    exit 1
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}All services started successfully! 🚀${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}Service Status:${NC}"
echo -e "  ${GREEN}✓${NC} Redis:   Running"
echo -e "  ${GREEN}✓${NC} Celery:  Running (PID: $CELERY_PID)"
echo -e "  ${GREEN}✓${NC} FastAPI: Running (PID: $API_PID)"
echo ""
echo -e "${BLUE}Access Points:${NC}"
echo -e "  API Server:    ${YELLOW}http://localhost:8000${NC}"
echo -e "  API Docs:      ${YELLOW}http://localhost:8000/api/docs${NC}"
echo -e "  Health Check:  ${YELLOW}http://localhost:8000/api/health${NC}"
echo ""
echo -e "${BLUE}Logs:${NC}"
echo -e "  Celery:  ${YELLOW}tail -f logs/celery.log${NC}"
echo -e "  API:     ${YELLOW}tail -f logs/api.log${NC}"
echo ""
echo -e "${YELLOW}Press CTRL+C to stop all services${NC}"
echo ""

# Follow API logs in foreground
tail -f logs/api.log

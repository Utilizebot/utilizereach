#!/bin/bash

# Stop All Backend Services
# Usage: ./stop_all.sh

cd "$(dirname "$0")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PID_FILE=".backend_pids"

echo -e "${YELLOW}Stopping Marketing AI Backend Services...${NC}"
echo ""

# Stop processes from PID file
if [ -f "$PID_FILE" ]; then
    while read pid; do
        if ps -p $pid > /dev/null 2>&1; then
            echo -e "${YELLOW}Stopping process $pid...${NC}"
            kill $pid 2>/dev/null || true
            # Wait a bit for graceful shutdown
            sleep 1
            # Force kill if still running
            if ps -p $pid > /dev/null 2>&1; then
                kill -9 $pid 2>/dev/null || true
            fi
            echo -e "${GREEN}✓ Process $pid stopped${NC}"
        fi
    done < "$PID_FILE"
    rm -f "$PID_FILE"
fi

# Stop Redis if it was started by us
echo -e "${YELLOW}Stopping Redis...${NC}"
redis-cli shutdown 2>/dev/null || true
echo -e "${GREEN}✓ Redis stopped${NC}"

# Kill any remaining celery or uvicorn processes
pkill -f "celery.*worker" 2>/dev/null || true
pkill -f "uvicorn.*api.main" 2>/dev/null || true

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}All services stopped successfully! ✓${NC}"
echo -e "${GREEN}========================================${NC}"

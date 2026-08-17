#!/bin/bash

# Check Status of Backend Services
# Usage: ./status.sh

cd "$(dirname "$0")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Backend Services Status${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check Redis
echo -n "Redis:         "
if pgrep -x "redis-server" > /dev/null; then
    REDIS_PID=$(pgrep -x "redis-server")
    echo -e "${GREEN}✓ Running${NC} (PID: $REDIS_PID)"
    # Test connection
    if redis-cli ping > /dev/null 2>&1; then
        echo -e "               ${GREEN}✓ Responding to ping${NC}"
    else
        echo -e "               ${RED}✗ Not responding${NC}"
    fi
else
    echo -e "${RED}✗ Not running${NC}"
fi

echo ""

# Check Celery
echo -n "Celery Worker: "
if pgrep -f "celery.*worker" > /dev/null; then
    CELERY_PID=$(pgrep -f "celery.*worker")
    echo -e "${GREEN}✓ Running${NC} (PID: $CELERY_PID)"
    # Check log file
    if [ -f logs/celery.log ]; then
        CELERY_LINES=$(wc -l < logs/celery.log)
        echo -e "               ${BLUE}Log:${NC} logs/celery.log ($CELERY_LINES lines)"
    fi
else
    echo -e "${RED}✗ Not running${NC}"
fi

echo ""

# Check FastAPI
echo -n "FastAPI:       "
if pgrep -f "uvicorn.*api.main" > /dev/null; then
    API_PID=$(pgrep -f "uvicorn.*api.main")
    echo -e "${GREEN}✓ Running${NC} (PID: $API_PID)"
    # Test HTTP endpoint
    if curl -s http://localhost:8000/api/health > /dev/null 2>&1; then
        echo -e "               ${GREEN}✓ Responding at http://localhost:8000${NC}"
    else
        echo -e "               ${YELLOW}⚠ Running but not responding${NC}"
    fi
    # Check log file
    if [ -f logs/api.log ]; then
        API_LINES=$(wc -l < logs/api.log)
        echo -e "               ${BLUE}Log:${NC} logs/api.log ($API_LINES lines)"
    fi
else
    echo -e "${RED}✗ Not running${NC}"
fi

echo ""
echo -e "${BLUE}========================================${NC}"

# Show recent errors if any
if [ -f logs/celery.log ]; then
    CELERY_ERRORS=$(grep -i "error\|exception" logs/celery.log 2>/dev/null | tail -3)
    if [ ! -z "$CELERY_ERRORS" ]; then
        echo -e "${YELLOW}Recent Celery Errors:${NC}"
        echo "$CELERY_ERRORS"
        echo ""
    fi
fi

if [ -f logs/api.log ]; then
    API_ERRORS=$(grep -i "error\|exception" logs/api.log 2>/dev/null | tail -3)
    if [ ! -z "$API_ERRORS" ]; then
        echo -e "${YELLOW}Recent API Errors:${NC}"
        echo "$API_ERRORS"
        echo ""
    fi
fi

echo ""
echo -e "${BLUE}Quick Commands:${NC}"
echo -e "  Start all:  ${YELLOW}./start_all.sh${NC}"
echo -e "  Stop all:   ${YELLOW}./stop_all.sh${NC}"
echo -e "  View logs:  ${YELLOW}tail -f logs/api.log${NC} or ${YELLOW}tail -f logs/celery.log${NC}"
echo ""

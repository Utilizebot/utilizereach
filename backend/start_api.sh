#!/bin/bash

# Start FastAPI Server
# Usage: ./start_api.sh

echo "Starting FastAPI server..."
echo "API will be available at: http://localhost:8000"
echo "API Documentation: http://localhost:8000/api/docs"
echo ""

cd "$(dirname "$0")"

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Start server with auto-reload
PYTHONPATH="${PWD}:${PYTHONPATH}" python3 -m uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload

#!/bin/bash

# Start Celery Worker
# Usage: ./start_celery.sh

echo "Starting Celery worker..."
echo "Worker will process scraping tasks in the background"
echo ""

cd "$(dirname "$0")"

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Start Celery worker with auto-reload
PYTHONPATH="${PWD}:${PYTHONPATH}" celery -A celery_app.celery worker --loglevel=info --concurrency=2

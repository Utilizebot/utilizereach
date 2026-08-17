"""
Celery Configuration

Configures Celery for async task processing and scheduled campaigns
"""

import os
from pathlib import Path
from celery import Celery
from celery.schedules import crontab
from dotenv import load_dotenv

# Load environment variables from Docker config volume if available
config_env = Path("/app/config/.env")
if config_env.exists():
    load_dotenv(config_env)
else:
    load_dotenv()

# Celery configuration (fall back to REDIS_URL so worker/backend containers
# that only define REDIS_URL still reach the right broker)
_REDIS_URL = os.getenv("REDIS_URL") or "redis://localhost:6379/0"
CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL") or _REDIS_URL
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND") or _REDIS_URL

# Create Celery app
celery_app = Celery(
    "marketing_ai",
    broker=CELERY_BROKER_URL,
    backend=CELERY_RESULT_BACKEND,
    include=["celery_app.tasks"],
)

# Configuration
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Kuala_Lumpur",  # Malaysia timezone for scheduler
    enable_utc=True,
    task_track_started=True,
    task_time_limit=7200,  # 2 hours max per task (for scheduled campaigns)
    task_soft_time_limit=7000,  # ~1h 56min soft limit
    worker_prefetch_multiplier=1,  # Process one task at a time
    worker_max_tasks_per_child=50,  # Restart worker after 50 tasks (prevent memory leaks)

    # Beat schedule for automated daily campaigns
    beat_schedule={
        'send-daily-campaign-10am': {
            'task': 'celery_app.tasks.send_daily_campaign',
            'schedule': crontab(hour=10, minute=0),  # 10:00 AM Malaysia time
            'options': {'expires': 3600}  # Task expires after 1 hour if not picked up
        },
    },
    beat_scheduler='celery.beat:PersistentScheduler',
    beat_schedule_filename='celerybeat-schedule',
)

if __name__ == "__main__":
    celery_app.start()

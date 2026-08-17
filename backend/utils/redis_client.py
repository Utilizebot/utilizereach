"""
Redis Client

For pub/sub and caching
"""

import os
import json
import redis
from dotenv import load_dotenv

load_dotenv()

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# Create Redis client
redis_client = redis.from_url(REDIS_URL, decode_responses=True)


def publish_progress(job_id: str, progress: int, current_step: str, total_leads_found: int = 0):
    """
    Publish progress update to Redis channel

    Args:
        job_id: Job UUID
        progress: Progress percentage (0-100)
        current_step: Current step description
        total_leads_found: Total leads found so far
    """
    channel = f"scraping_job:{job_id}:progress"

    message = {
        "progress": progress,
        "current_step": current_step,
        "total_leads_found": total_leads_found,
    }

    redis_client.publish(channel, json.dumps(message))


def subscribe_to_progress(job_id: str):
    """
    Subscribe to progress updates for a job

    Args:
        job_id: Job UUID

    Returns:
        Redis pubsub object
    """
    channel = f"scraping_job:{job_id}:progress"
    pubsub = redis_client.pubsub()
    pubsub.subscribe(channel)
    return pubsub


def get_redis_client():
    """Get Redis client"""
    return redis_client

"""
Analytics Router

Serves the dashboard's analytics data in one call. Replaces the five
direct Supabase table/view reads useAnalytics.ts used to do.
"""

from fastapi import APIRouter, Depends, HTTPException
import sys
import os

# Add parent directory to import path
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from api.dependencies import get_current_user
from database.client import get_supabase_client
from database.pg import execute_sql

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

MAX_ROWS = 5000


@router.get("/overview")
async def analytics_overview(current_user: dict = Depends(get_current_user)):
    """
    All analytics source data in one response:
    sessions, responses (analytics_overview view), steps,
    page-visit events and website-click events. Newest first,
    capped at 5000 rows each.
    """
    try:
        client = get_supabase_client()

        sessions = (
            client.table("form_sessions")
            .select("*")
            .order("created_at", desc=True)
            .limit(MAX_ROWS)
            .execute()
        ).data

        responses = execute_sql(
            "SELECT * FROM analytics_overview "
            "WHERE response_id IS NOT NULL "
            "ORDER BY created_at DESC LIMIT %s",
            [MAX_ROWS],
        )

        steps = (
            client.table("form_steps")
            .select("*")
            .order("entered_at", desc=True)
            .limit(MAX_ROWS)
            .execute()
        ).data

        page_visits = (
            client.table("tracking_events")
            .select("*")
            .eq("event_type", "page_visit")
            .order("timestamp", desc=True)
            .limit(MAX_ROWS)
            .execute()
        ).data

        website_clicks = (
            client.table("tracking_events")
            .select("*")
            .eq("event_type", "website_click")
            .order("timestamp", desc=True)
            .limit(MAX_ROWS)
            .execute()
        ).data

        return {
            "sessions": sessions,
            "responses": responses,
            "steps": steps,
            "pageVisits": page_visits,
            "websiteClicks": website_clicks,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load analytics: {str(e)}")

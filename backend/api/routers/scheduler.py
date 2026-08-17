"""
Scheduler Router
API endpoints for automated campaign scheduler settings and control
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta
import pytz

from database.client import get_supabase_admin_client

router = APIRouter(prefix="/api/scheduler", tags=["Scheduler"])


def get_supabase():
    """Get database client"""
    return get_supabase_admin_client()


class SchedulerSettingsUpdate(BaseModel):
    is_enabled: Optional[bool] = None
    daily_limit: Optional[int] = None
    send_hour: Optional[int] = None
    send_minute: Optional[int] = None
    delay_between_emails: Optional[int] = None


@router.get("/settings")
async def get_scheduler_settings():
    """
    Get current scheduler settings

    Returns all scheduler configuration including:
    - is_enabled: Whether automatic campaigns are active
    - daily_limit: Max emails per day
    - send_hour/send_minute: Scheduled time (Malaysia timezone)
    - last_run_at: When the scheduler last ran
    - next_run_at: When the scheduler will run next
    - Statistics: total_runs, total_emails_sent
    """
    try:
        supabase = get_supabase()
        result = supabase.table('scheduler_settings').select('*').limit(1).execute()

        if not result.data:
            # Create default settings if none exist
            default_settings = {
                'is_enabled': False,
                'daily_limit': 30,
                'send_hour': 10,
                'send_minute': 0,
                'timezone': 'Asia/Kuala_Lumpur',
                'delay_between_emails': 60,
                'total_runs': 0,
                'total_emails_sent': 0
            }
            supabase.table('scheduler_settings').insert(default_settings).execute()
            return default_settings

        return result.data[0]

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get settings: {str(e)}")


@router.put("/settings")
async def update_scheduler_settings(settings: SchedulerSettingsUpdate):
    """
    Update scheduler settings

    Allowed updates:
    - is_enabled: Turn scheduler on/off
    - daily_limit: 1-100 emails per day
    - send_hour: 0-23
    - send_minute: 0-59
    - delay_between_emails: seconds between each email (minimum 30)
    """
    try:
        supabase = get_supabase()

        # Get current settings
        current = supabase.table('scheduler_settings').select('*').limit(1).execute()

        if not current.data:
            raise HTTPException(status_code=404, detail="Scheduler settings not found")

        config = current.data[0]

        # Build update data
        update_data = {'updated_at': datetime.utcnow().isoformat()}

        if settings.is_enabled is not None:
            update_data['is_enabled'] = settings.is_enabled

        if settings.daily_limit is not None:
            if settings.daily_limit < 1 or settings.daily_limit > 100:
                raise HTTPException(status_code=400, detail="daily_limit must be between 1 and 100")
            update_data['daily_limit'] = settings.daily_limit

        if settings.send_hour is not None:
            if settings.send_hour < 0 or settings.send_hour > 23:
                raise HTTPException(status_code=400, detail="send_hour must be between 0 and 23")
            update_data['send_hour'] = settings.send_hour

        if settings.send_minute is not None:
            if settings.send_minute < 0 or settings.send_minute > 59:
                raise HTTPException(status_code=400, detail="send_minute must be between 0 and 59")
            update_data['send_minute'] = settings.send_minute

        if settings.delay_between_emails is not None:
            if settings.delay_between_emails < 30:
                raise HTTPException(status_code=400, detail="delay_between_emails must be at least 30 seconds")
            update_data['delay_between_emails'] = settings.delay_between_emails

        # Calculate next run time if enabling or changing time
        if settings.is_enabled or settings.send_hour is not None or settings.send_minute is not None:
            timezone = config.get('timezone', 'Asia/Kuala_Lumpur')
            myt = pytz.timezone(timezone)
            now = datetime.now(myt)

            send_hour = settings.send_hour if settings.send_hour is not None else config.get('send_hour', 10)
            send_minute = settings.send_minute if settings.send_minute is not None else config.get('send_minute', 0)

            next_run = now.replace(hour=send_hour, minute=send_minute, second=0, microsecond=0)

            # If the time has passed today, schedule for tomorrow
            if next_run <= now:
                next_run = next_run + timedelta(days=1)

            # Only set next_run if scheduler is/will be enabled
            is_enabled = settings.is_enabled if settings.is_enabled is not None else config.get('is_enabled')
            if is_enabled:
                update_data['next_run_at'] = next_run.isoformat()
            else:
                update_data['next_run_at'] = None

        # Update settings
        result = supabase.table('scheduler_settings').update(update_data).eq('id', config['id']).execute()

        return {
            'success': True,
            'message': 'Settings updated successfully',
            'settings': result.data[0] if result.data else update_data
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update settings: {str(e)}")


@router.post("/toggle")
async def toggle_scheduler(enable: bool):
    """
    Quick toggle to enable/disable the scheduler

    Args:
        enable: true to enable, false to disable
    """
    try:
        supabase = get_supabase()

        # Get current settings
        current = supabase.table('scheduler_settings').select('*').limit(1).execute()

        if not current.data:
            raise HTTPException(status_code=404, detail="Scheduler settings not found")

        config = current.data[0]

        update_data = {
            'is_enabled': enable,
            'updated_at': datetime.utcnow().isoformat()
        }

        # Calculate next run time if enabling
        if enable:
            timezone = config.get('timezone', 'Asia/Kuala_Lumpur')
            myt = pytz.timezone(timezone)
            now = datetime.now(myt)

            send_hour = config.get('send_hour', 10)
            send_minute = config.get('send_minute', 0)

            next_run = now.replace(hour=send_hour, minute=send_minute, second=0, microsecond=0)
            if next_run <= now:
                next_run = next_run + timedelta(days=1)

            update_data['next_run_at'] = next_run.isoformat()
        else:
            update_data['next_run_at'] = None

        supabase.table('scheduler_settings').update(update_data).eq('id', config['id']).execute()

        return {
            'success': True,
            'is_enabled': enable,
            'message': f"Scheduler {'enabled' if enable else 'disabled'}"
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to toggle scheduler: {str(e)}")


@router.post("/run-now")
async def trigger_manual_run():
    """
    Manually trigger the scheduled campaign immediately

    Useful for testing or running campaign outside scheduled time.
    The scheduler must be enabled for this to work.
    """
    try:
        from celery_app.tasks import send_daily_campaign

        supabase = get_supabase()

        # Check if enabled
        settings = supabase.table('scheduler_settings').select('is_enabled').limit(1).execute()

        if not settings.data or not settings.data[0].get('is_enabled'):
            raise HTTPException(
                status_code=400,
                detail="Scheduler is disabled. Enable it first to run manually."
            )

        # Trigger task asynchronously
        task = send_daily_campaign.delay()

        return {
            'success': True,
            'task_id': task.id,
            'message': 'Campaign triggered! Check run history for results.'
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to trigger campaign: {str(e)}")


@router.get("/history")
async def get_run_history(limit: int = 10):
    """
    Get recent scheduler run history

    Args:
        limit: Number of records to return (default: 10, max: 50)

    Returns list of runs with:
    - started_at, completed_at
    - status (running, success, partial, failed)
    - leads_attempted, emails_sent, emails_failed
    - error_message (if failed)
    """
    try:
        supabase = get_supabase()

        if limit > 50:
            limit = 50

        result = supabase.table('scheduler_run_history')\
            .select('*')\
            .order('created_at', desc=True)\
            .limit(limit)\
            .execute()

        return {
            'runs': result.data or [],
            'total': len(result.data) if result.data else 0
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get history: {str(e)}")


@router.get("/status")
async def get_scheduler_status():
    """
    Get current scheduler status summary

    Returns:
    - is_enabled: Whether scheduler is active
    - next_run_at: When next campaign will run
    - last_run_at: When last campaign ran
    - last_run_status: Result of last run
    - pending_leads: Number of new leads available
    - daily_limit: Current daily email limit
    """
    try:
        supabase = get_supabase()

        # Get settings
        settings = supabase.table('scheduler_settings').select('*').limit(1).execute()
        config = settings.data[0] if settings.data else {}

        # Get pending leads count (status='new')
        leads_result = supabase.table('scraped_leads')\
            .select('id', count='exact')\
            .eq('status', 'new')\
            .execute()

        pending_leads = leads_result.count if hasattr(leads_result, 'count') else 0

        # Get today's sent count
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        today_sent = supabase.table('scheduler_run_history')\
            .select('emails_sent')\
            .gte('started_at', today_start.isoformat())\
            .execute()

        today_sent_count = sum(r.get('emails_sent', 0) for r in (today_sent.data or []))

        return {
            'is_enabled': config.get('is_enabled', False),
            'next_run_at': config.get('next_run_at'),
            'last_run_at': config.get('last_run_at'),
            'last_run_status': config.get('last_run_status'),
            'last_run_sent_count': config.get('last_run_sent_count', 0),
            'pending_leads': pending_leads,
            'daily_limit': config.get('daily_limit', 30),
            'send_time': f"{config.get('send_hour', 10):02d}:{config.get('send_minute', 0):02d}",
            'timezone': config.get('timezone', 'Asia/Kuala_Lumpur'),
            'today_sent': today_sent_count,
            'total_runs': config.get('total_runs', 0),
            'total_emails_sent': config.get('total_emails_sent', 0)
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get status: {str(e)}")


@router.delete("/history/{run_id}")
async def delete_run_history(run_id: str):
    """Delete a specific run history record"""
    try:
        supabase = get_supabase()
        supabase.table('scheduler_run_history').delete().eq('id', run_id).execute()

        return {'success': True, 'message': 'Run history deleted'}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete history: {str(e)}")


@router.delete("/history")
async def clear_run_history():
    """Clear all run history records"""
    try:
        supabase = get_supabase()

        # Delete all records (Supabase requires a filter, so we use a condition that's always true)
        result = supabase.table('scheduler_run_history')\
            .delete()\
            .neq('id', '00000000-0000-0000-0000-000000000000')\
            .execute()

        return {
            'success': True,
            'message': 'All run history cleared',
            'deleted_count': len(result.data) if result.data else 0
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to clear history: {str(e)}")

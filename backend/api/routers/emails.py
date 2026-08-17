"""
Emails Router
API endpoints for email management and tracking
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from datetime import datetime, timedelta

from database.client import get_supabase_admin_client
from database.pg import execute_sql

router = APIRouter(prefix="/api/emails", tags=["Emails"])


def get_supabase():
    """Get database client"""
    return get_supabase_admin_client()


def _attach_sent_emails(supabase, replies):
    """Attach the parent sent_emails row to each reply dict (replaces the
    old PostgREST embedded select '*, sent_emails(*)')."""
    sent_ids = list({r['sent_email_id'] for r in replies if r.get('sent_email_id')})
    sent_map = {}
    if sent_ids:
        sent_rows = supabase.table('sent_emails').select('*').in_('id', sent_ids).execute()
        sent_map = {row['id']: row for row in (sent_rows.data or [])}
    for r in replies:
        r['sent_emails'] = sent_map.get(r.get('sent_email_id'))
    return replies


@router.get("/stats")
async def get_email_stats(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None)
):
    """
    Get email performance statistics

    Returns:
    - Sent today count
    - Open rate, click rate, reply rate
    - Bounce rate, unsubscribe count
    - Total sent in period
    - AI cost per email
    """
    try:
        supabase = get_supabase()

        # Default to last 30 days
        if not date_to:
            date_to = datetime.utcnow().isoformat()
        if not date_from:
            date_from = (datetime.utcnow() - timedelta(days=30)).isoformat()

        # Get today's stats
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
        today_emails = supabase.table('sent_emails')\
            .select('*')\
            .gte('sent_at', today_start)\
            .execute()

        sent_today = len(today_emails.data) if today_emails.data else 0

        # Get period stats
        period_emails = supabase.table('sent_emails')\
            .select('*')\
            .gte('sent_at', date_from)\
            .lte('sent_at', date_to)\
            .execute()

        emails = period_emails.data or []
        total_sent = len(emails)

        def _is_bounced(e):
            return bool(e.get('bounced_at')) or e.get('status') == 'bounced'

        bounced_count = len([e for e in emails if _is_bounced(e)])
        opened_count = len([
            e for e in emails
            if (e.get('opened_at') or e.get('status') in ('opened', 'clicked', 'replied'))
            and not _is_bounced(e)
        ])
        clicked_count = len([
            e for e in emails
            if (e.get('clicked_at') or e.get('status') == 'clicked')
            and not _is_bounced(e)
        ])
        replied_count = len([
            e for e in emails
            if (e.get('replied_at') or e.get('status') == 'replied')
            and not _is_bounced(e)
        ])

        # Get pre-send rejected/undeliverable addresses (email_exclusions),
        # excluding hard-bounce reasons which are already covered by bounced_count.
        try:
            rejected_rows = execute_sql(
                "SELECT count(*) n FROM email_exclusions "
                "WHERE reason ILIKE '%%reject%%' OR reason ILIKE '%%no mail server%%'"
            )
            rejected_count = int(rejected_rows[0]['n']) if rejected_rows else 0
        except Exception:
            rejected_count = 0

        failed_total = bounced_count + rejected_count
        delivered_count = total_sent - bounced_count

        # Get unsubscribes
        unsubscribes = supabase.table('email_unsubscribes')\
            .select('id')\
            .gte('unsubscribed_at', date_from)\
            .lte('unsubscribed_at', date_to)\
            .execute()
        unsubscribed_count = len(unsubscribes.data) if unsubscribes.data else 0

        # Calculate rates (all as a percentage of total_sent)
        open_rate = (opened_count / total_sent * 100) if total_sent > 0 else 0
        click_rate = (clicked_count / total_sent * 100) if total_sent > 0 else 0
        reply_rate = (replied_count / total_sent * 100) if total_sent > 0 else 0
        bounce_rate = (bounced_count / total_sent * 100) if total_sent > 0 else 0

        # Estimate AI cost (assuming $0.000114 per email average)
        avg_cost_per_email = 0.000114
        total_cost = total_sent * avg_cost_per_email

        return {
            "sent_today": sent_today,
            "total_sent": total_sent,
            "open_rate": round(open_rate, 1),
            "click_rate": round(click_rate, 1),
            "reply_rate": round(reply_rate, 1),
            "bounce_rate": round(bounce_rate, 1),
            "bounced_count": bounced_count,
            "rejected_count": rejected_count,
            "failed_total": failed_total,
            "delivered_count": delivered_count,
            "unsubscribe_count": unsubscribed_count,
            "ai_cost_per_email": avg_cost_per_email,
            "total_cost": round(total_cost, 4),
            "date_range": {
                "from": date_from,
                "to": date_to
            }
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get email stats: {str(e)}")


@router.get("/sent")
async def get_sent_emails(
    status: Optional[str] = Query(None),
    campaign_id: Optional[str] = Query(None),
    account_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(50),
    offset: int = Query(0)
):
    """
    Get list of sent emails with filters
    """
    try:
        supabase = get_supabase()

        # Build query
        query = supabase.table('sent_emails').select('*')

        # Apply filters
        if status:
            query = query.eq('status', status)
        if campaign_id:
            query = query.eq('campaign_id', campaign_id)
        if account_id:
            query = query.eq('email_account_id', account_id)
        if search:
            query = query.or_(f'recipient_email.ilike.%{search}%,recipient_name.ilike.%{search}%,subject.ilike.%{search}%')

        # Order and paginate
        query = query.order('sent_at', desc=True).range(offset, offset + limit - 1)

        result = query.execute()

        # Enrich with tracking data
        emails = []
        for email in (result.data or []):
            # Opens are tracked via opened_at field in sent_emails
            opens_count = 1 if email.get('opened_at') else 0

            # Clicks are tracked in email_clicks table
            clicks = supabase.table('email_clicks')\
                .select('id')\
                .eq('sent_email_id', email['id'])\
                .execute()

            clicks_count = len(clicks.data) if clicks.data else 0

            emails.append({
                **email,
                "opens": opens_count,
                "clicks": clicks_count
            })

        return {
            "emails": emails,
            "total": len(result.data) if result.data else 0,
            "limit": limit,
            "offset": offset
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get sent emails: {str(e)}")


@router.get("/sent/{email_id}")
async def get_email_details(email_id: str):
    """
    Get detailed information about a sent email
    """
    try:
        supabase = get_supabase()

        # Get email
        email = supabase.table('sent_emails').select('*').eq('id', email_id).execute()

        if not email.data or len(email.data) == 0:
            raise HTTPException(status_code=404, detail="Email not found")

        email_data = email.data[0]

        # Get click tracking events
        clicks_tracking = supabase.table('email_clicks')\
            .select('*')\
            .eq('sent_email_id', email_id)\
            .order('clicked_at', desc=False)\
            .execute()

        # Opens are tracked via opened_at in sent_emails table
        opens = [{"opened_at": email_data['opened_at']}] if email_data.get('opened_at') else []
        clicks = clicks_tracking.data if clicks_tracking.data else []

        # Get replies
        replies = supabase.table('email_replies')\
            .select('*')\
            .eq('sent_email_id', email_id)\
            .execute()

        # Get bounces
        bounces = supabase.table('email_bounces')\
            .select('*')\
            .eq('sent_email_id', email_id)\
            .execute()

        return {
            "email": email_data,
            "tracking": {
                "opens": opens,
                "clicks": clicks,
                "replies": replies.data if replies.data else [],
                "bounces": bounces.data if bounces.data else []
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get email details: {str(e)}")


@router.get("/replies")
async def get_replies(
    is_reviewed: Optional[bool] = Query(None),
    limit: int = Query(50),
    offset: int = Query(0)
):
    """
    Get email replies
    """
    try:
        supabase = get_supabase()

        query = supabase.table('email_replies').select('*')

        if is_reviewed is not None:
            query = query.eq('reviewed', is_reviewed)

        query = query.order('received_at', desc=True).range(offset, offset + limit - 1)

        result = query.execute()

        replies = _attach_sent_emails(supabase, result.data or [])

        return {
            "replies": replies,
            "total": len(replies),
            "limit": limit,
            "offset": offset
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get replies: {str(e)}")


@router.get("/replies/{reply_id}")
async def get_reply_details(reply_id: str):
    """
    Get detailed information about a reply
    """
    try:
        supabase = get_supabase()

        reply = supabase.table('email_replies')\
            .select('*')\
            .eq('id', reply_id)\
            .execute()

        if not reply.data or len(reply.data) == 0:
            raise HTTPException(status_code=404, detail="Reply not found")

        return _attach_sent_emails(supabase, reply.data)[0]

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get reply details: {str(e)}")


@router.put("/replies/{reply_id}/status")
async def update_reply_status(reply_id: str, status_data: dict):
    """
    Mark reply as reviewed or update status
    """
    try:
        supabase = get_supabase()

        is_reviewed = status_data.get('is_reviewed', True)

        result = supabase.table('email_replies')\
            .update({"reviewed": is_reviewed})\
            .eq('id', reply_id)\
            .execute()

        return {
            "success": True,
            "reply_id": reply_id,
            "is_reviewed": is_reviewed
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update reply status: {str(e)}")


@router.get("/performance")
async def get_email_performance(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    granularity: str = Query("day", description="day, week, or month")
):
    """
    Get email performance over time for charts
    """
    try:
        supabase = get_supabase()

        # Default to last 7 days
        if not date_to:
            date_to = datetime.utcnow().isoformat()
        if not date_from:
            date_from = (datetime.utcnow() - timedelta(days=7)).isoformat()

        # Get all emails in range
        emails = supabase.table('sent_emails')\
            .select('sent_at, opened_at, status')\
            .gte('sent_at', date_from)\
            .lte('sent_at', date_to)\
            .execute()

        # Group by date
        performance_by_date = {}
        for email in (emails.data or []):
            date_key = email['sent_at'][:10]  # Extract YYYY-MM-DD

            if date_key not in performance_by_date:
                performance_by_date[date_key] = {
                    "date": date_key,
                    "sent": 0,
                    "opened": 0,
                    "clicked": 0
                }

            performance_by_date[date_key]["sent"] += 1
            if email.get('opened_at'):
                performance_by_date[date_key]["opened"] += 1
            if email.get('status') == 'clicked':
                performance_by_date[date_key]["clicked"] += 1

        # Convert to list and sort
        performance_data = sorted(performance_by_date.values(), key=lambda x: x['date'])

        return {
            "data": performance_data,
            "date_range": {
                "from": date_from,
                "to": date_to
            }
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get performance data: {str(e)}")


@router.post("/send-to-lead")
async def send_email_to_lead(request_data: dict):
    """
    Send a single AI-generated email to a specific lead

    Requires:
    - lead_id: The ID of the lead to email
    - email_account_id: The ID of the email account to send from
    """
    try:
        from celery_app.tasks import send_single_email_task

        lead_id = request_data.get('lead_id')
        email_account_id = request_data.get('email_account_id')

        if not lead_id:
            raise HTTPException(status_code=400, detail="lead_id is required")
        if not email_account_id:
            raise HTTPException(status_code=400, detail="email_account_id is required")

        supabase = get_supabase()

        # Get the lead
        lead = supabase.table('scraped_leads').select('*').eq('id', lead_id).execute()
        if not lead.data or len(lead.data) == 0:
            raise HTTPException(status_code=404, detail="Lead not found")

        lead_data = lead.data[0]

        # Get the email account
        account = supabase.table('email_accounts').select('*').eq('id', email_account_id).execute()
        if not account.data or len(account.data) == 0:
            raise HTTPException(status_code=404, detail="Email account not found")

        account_data = account.data[0]

        if account_data.get('status') != 'active':
            raise HTTPException(status_code=400, detail="Email account is not active")

        # Queue the email task
        send_single_email_task.delay(
            lead_id=lead_id,
            email_account_id=email_account_id
        )

        # Note: Lead status will be updated to 'contacted' by the celery task after email is sent

        return {
            "success": True,
            "message": f"Email queued for {lead_data.get('email')}",
            "lead_id": lead_id,
            "email_account_id": email_account_id
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to queue email: {str(e)}")

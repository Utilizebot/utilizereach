"""
Leads Router
API endpoints for lead management and funnel tracking
"""

from fastapi import APIRouter, HTTPException, Query, UploadFile, File
from fastapi.responses import StreamingResponse
import sys
import pandas as pd
import io
import json
import asyncio
from typing import Optional, List
from datetime import datetime, timedelta
from pathlib import Path

# Add parent directory to path to import email verifier
sys.path.append(str(Path(__file__).parent.parent.parent))
from integrations.email_verifier import EmailVerifier
from integrations.gmail_client import GmailClient
from database.client import get_supabase_admin_client
from database.pg import execute_sql

router = APIRouter(prefix="/api/leads", tags=["Leads"])

# SQL equivalents of the derived per-email status computed in
# get_sent_emails_with_engagement() (derivation order:
# replied -> clicked -> opened -> bounced -> sent), so COUNT(*) queries
# can apply the same status filter the endpoint applies in Python.
_SENT_STATUS_SQL = {
    'replied': "status = 'replied'",
    'clicked': "status = 'clicked'",
    'opened': "opened_at IS NOT NULL AND (status IS NULL OR status NOT IN ('replied', 'clicked'))",
    'bounced': "status = 'bounced' AND opened_at IS NULL",
    'sent': "opened_at IS NULL AND (status IS NULL OR status NOT IN ('replied', 'clicked', 'bounced'))",
}

# Same idea for get_sent_emails(), whose derivation uses the
# email_replies / email_clicks tables (order: replied -> clicked ->
# opened -> bounced -> sent).
_HAS_REPLY_SQL = "EXISTS (SELECT 1 FROM email_replies er WHERE er.sent_email_id = sent_emails.id)"
_HAS_CLICK_SQL = "EXISTS (SELECT 1 FROM email_clicks ec WHERE ec.sent_email_id = sent_emails.id)"
_SENT_ENGAGEMENT_STATUS_SQL = {
    'replied': _HAS_REPLY_SQL,
    'clicked': f"NOT {_HAS_REPLY_SQL} AND {_HAS_CLICK_SQL}",
    'opened': f"NOT {_HAS_REPLY_SQL} AND NOT {_HAS_CLICK_SQL} AND opened_at IS NOT NULL",
    'bounced': f"NOT {_HAS_REPLY_SQL} AND NOT {_HAS_CLICK_SQL} AND opened_at IS NULL AND status = 'bounced'",
    'sent': f"NOT {_HAS_REPLY_SQL} AND NOT {_HAS_CLICK_SQL} AND opened_at IS NULL AND (status IS NULL OR status <> 'bounced')",
}


def get_supabase():
    """Get database client"""
    return get_supabase_admin_client()


@router.get("/stats")
async def get_lead_funnel_stats(
    date_from: Optional[str] = Query(None, description="Start date (ISO format)"),
    date_to: Optional[str] = Query(None, description="End date (ISO format)")
):
    """
    Get lead funnel statistics

    Returns metrics for:
    - Total leads
    - Contacted count
    - Opened count
    - Clicked count
    - Replied count
    - Conversion rates
    """
    try:
        supabase = get_supabase()

        # Default to last 30 days if no dates provided
        if not date_to:
            date_to = datetime.utcnow().isoformat()
        if not date_from:
            date_from = (datetime.utcnow() - timedelta(days=30)).isoformat()

        # Get all sent emails in date range
        sent_emails = supabase.table('sent_emails')\
            .select('*')\
            .gte('sent_at', date_from)\
            .lte('sent_at', date_to)\
            .execute()

        total_sent = len(sent_emails.data) if sent_emails.data else 0

        # Count by status — all derived from sent_emails rows already fetched
        emails = sent_emails.data or []
        opened_count  = len([e for e in emails if e.get('opened_at')])
        clicked_count = len([e for e in emails if e.get('status') == 'clicked'])
        replied_count = len([e for e in emails if e.get('status') == 'replied' or e.get('replied_at')])

        # Get bounces count
        bounces = supabase.table('email_bounces')\
            .select('id')\
            .gte('bounced_at', date_from)\
            .lte('bounced_at', date_to)\
            .execute()
        bounced_count = len(bounces.data) if bounces.data else 0

        # Get unsubscribes count
        unsubscribes = supabase.table('email_unsubscribes')\
            .select('id')\
            .gte('unsubscribed_at', date_from)\
            .lte('unsubscribed_at', date_to)\
            .execute()
        unsubscribed_count = len(unsubscribes.data) if unsubscribes.data else 0

        # Calculate rates
        open_rate = (opened_count / total_sent * 100) if total_sent > 0 else 0
        click_rate = (clicked_count / opened_count * 100) if opened_count > 0 else 0
        reply_rate = (replied_count / total_sent * 100) if total_sent > 0 else 0
        bounce_rate = (bounced_count / total_sent * 100) if total_sent > 0 else 0

        return {
            "total_leads": total_sent,  # Using sent emails as leads for now
            "contacted": total_sent,
            "opened": opened_count,
            "clicked": clicked_count,
            "replied": replied_count,
            "bounced": bounced_count,
            "unsubscribed": unsubscribed_count,
            "rates": {
                "open_rate": round(open_rate, 1),
                "click_rate": round(click_rate, 1),
                "reply_rate": round(reply_rate, 1),
                "bounce_rate": round(bounce_rate, 1)
            },
            "date_range": {
                "from": date_from,
                "to": date_to
            }
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get stats: {str(e)}")


@router.get("/")
async def get_leads(
    status: Optional[str] = Query(None, description="Filter by status (new, contacted, etc)"),
    search: Optional[str] = Query(None, description="Search by name/email/company"),
    segment: Optional[str] = Query(None, description="Filter by segment key (shareholders, government, ...)"),
    limit: int = Query(100, description="Number of results"),
    offset: int = Query(0, description="Pagination offset")
):
    """
    Get list of leads with filters

    Returns combined list from scraped_leads and sent_emails tables
    """
    try:
        supabase = get_supabase()

        # Fetch scraped leads in batches to bypass Supabase 1000 row limit
        scraped_data = []
        batch_size = 1000
        batch_num = 0
        max_batches = (limit // batch_size) + 1

        while batch_num < max_batches:
            query = supabase.table('scraped_leads').select('*')
            if status:
                query = query.eq('status', status)
            if segment:
                query = query.eq('segment', segment)
            if search:
                query = query.or_(f'email.ilike.%{search}%,decision_maker_name.ilike.%{search}%,company_name.ilike.%{search}%')

            start = batch_num * batch_size
            end = start + batch_size
            batch = query.order('created_at', desc=True).range(start, end).execute()

            if not batch.data:
                break
            scraped_data.extend(batch.data)
            # If we got less than batch_size rows, we've fetched everything
            if len(batch.data) < batch_size:
                break
            batch_num += 1

        # Fetch sent emails in batches
        sent_data = []
        batch_num = 0

        while batch_num < max_batches:
            query = supabase.table('sent_emails').select('*')
            if search:
                query = query.or_(f'recipient_email.ilike.%{search}%,recipient_name.ilike.%{search}%')

            start = batch_num * batch_size
            end = start + batch_size
            batch = query.order('sent_at', desc=True).range(start, end).execute()

            if not batch.data:
                break
            sent_data.extend(batch.data)
            # If we got less than batch_size rows, we've fetched everything
            if len(batch.data) < batch_size:
                break
            batch_num += 1

        # Combine and normalize the data, de-duplicating by email address so a
        # person who was imported AND emailed (or emailed several times) shows
        # up as ONE lead, not one row per sent email.
        leads = []
        seen_emails = set()

        # Add scraped leads (the canonical lead source)
        for lead in (scraped_data or []):
            addr = (lead.get('email') or '').strip().lower()
            if addr and addr in seen_emails:
                continue  # same email imported more than once — show once
            leads.append({
                "id": lead.get('id'),
                "email": lead.get('email'),
                "name": lead.get('decision_maker_name'),
                "company": lead.get('company_name'),
                "title": lead.get('decision_maker_title'),
                "phone": lead.get('phone'),
                "industry": lead.get('industry'),
                "location": lead.get('location'),
                "status": lead.get('status', 'new'),
                "segment": lead.get('segment'),
                "created_at": lead.get('created_at'),
                "source": "scraped"
            })
            if addr:
                seen_emails.add(addr)

        # When filtering by segment, sent-email-derived leads (which have no
        # segment) are not part of that segment — skip them entirely.
        sent_iter = [] if segment else (sent_data or [])

        # Add sent-email recipients only if that email isn't already a lead
        for email in sent_iter:
            addr = (email.get('recipient_email') or '').strip().lower()
            if addr and addr in seen_emails:
                continue  # already represented — don't add a duplicate lead

            # Determine status based on engagement
            if email.get('replied'):
                email_status = 'replied'
            elif email.get('clicked'):
                email_status = 'clicked'
            elif email.get('opened'):
                email_status = 'opened'
            else:
                email_status = 'sent'

            leads.append({
                "id": email.get('id'),
                "email": email.get('recipient_email'),
                "name": email.get('recipient_name'),
                "company": None,
                "title": None,
                "phone": None,
                "industry": None,
                "location": None,
                "status": email_status,
                "segment": None,
                "created_at": email.get('sent_at'),
                "source": "campaign"
            })
            if addr:
                seen_emails.add(addr)

        # Apply status filter if specified
        if status:
            leads = [l for l in leads if l['status'] == status]

        # Sort by created_at
        leads.sort(key=lambda x: x.get('created_at', ''), reverse=True)

        # Apply pagination
        paginated_leads = leads[offset:offset + limit]

        # Compute the TRUE total with COUNT(*) queries using the same filters
        # as the data queries above — the fetched list is capped by batching,
        # so len(leads) only reflects the fetched page, not the real total.
        scraped_count_query = supabase.table('scraped_leads').select('id', count='exact')
        if status:
            scraped_count_query = scraped_count_query.eq('status', status)
        if segment:
            scraped_count_query = scraped_count_query.eq('segment', segment)
        if search:
            scraped_count_query = scraped_count_query.or_(f'email.ilike.%{search}%,decision_maker_name.ilike.%{search}%,company_name.ilike.%{search}%')
        scraped_total = scraped_count_query.limit(1).execute().count or 0

        # Sent emails are normalized above with a derived status; the
        # sent_emails schema has no replied/clicked/opened columns, so the
        # derivation always yields 'sent'. They therefore only count toward
        # the total when no status filter is set or the filter is 'sent'.
        # Count only DISTINCT sent-email recipients that are NOT already a
        # scraped lead, so emailing the same person repeatedly doesn't inflate
        # the total (matches the de-duplicated list above).
        sent_total = 0
        if not segment and (not status or status == 'sent'):
            from database.pg import execute_sql
            base = (
                "SELECT COUNT(*) AS n FROM ("
                "SELECT DISTINCT lower(recipient_email) AS e FROM sent_emails s "
                "WHERE recipient_email IS NOT NULL "
                "AND NOT EXISTS (SELECT 1 FROM scraped_leads sl "
                "WHERE lower(sl.email) = lower(s.recipient_email))"
            )
            if search:
                like = f"%{search}%"
                rows = execute_sql(
                    base + " AND (recipient_email ILIKE %s OR recipient_name ILIKE %s)) t",
                    [like, like],
                )
            else:
                rows = execute_sql(base + ") t", [])
            sent_total = (rows[0]['n'] if rows else 0) or 0

        return {
            "leads": paginated_leads,
            "total": scraped_total + sent_total,
            "limit": limit,
            "offset": offset
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get leads: {str(e)}")


@router.post("/")
async def create_lead(lead_data: dict):
    """
    Create a single lead manually

    Required: email
    Optional: name, company, title, phone, industry, location, source
    """
    try:
        supabase = get_supabase()

        email = lead_data.get('email')
        if not email or '@' not in email:
            raise HTTPException(status_code=400, detail="Valid email is required")

        # Check if email already exists
        existing = supabase.table('scraped_leads')\
            .select('id')\
            .eq('email', email)\
            .execute()

        if existing.data and len(existing.data) > 0:
            raise HTTPException(status_code=400, detail="A lead with this email already exists")

        # Create the lead
        new_lead = {
            'email': email,
            'decision_maker_name': lead_data.get('name'),
            'company_name': lead_data.get('company'),
            'decision_maker_title': lead_data.get('title'),
            'phone': lead_data.get('phone'),
            'industry': lead_data.get('industry'),
            'location': lead_data.get('location'),
            'segment': lead_data.get('segment'),
            'status': 'new',
            'created_at': datetime.utcnow().isoformat()
        }

        # Remove None values
        new_lead = {k: v for k, v in new_lead.items() if v is not None}

        result = supabase.table('scraped_leads').insert(new_lead).execute()

        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to create lead")

        return {
            "success": True,
            "lead": result.data[0],
            "message": f"Lead {email} created successfully"
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create lead: {str(e)}")


@router.get("/sent-emails")
async def get_sent_emails_with_engagement(
    status: Optional[str] = Query(None, description="Filter by status"),
    search: Optional[str] = Query(None, description="Search by name/email/subject"),
    limit: int = Query(100, description="Number of results"),
    offset: int = Query(0, description="Pagination offset")
):
    """
    Get sent emails with engagement tracking data

    Returns list of sent emails with:
    - Contact info
    - Subject
    - Sent date
    - Status (sent, opened, clicked, replied)
    - Engagement counts (opens, clicks, replies)
    """
    try:
        supabase = get_supabase()

        # Get sent emails
        query = supabase.table('sent_emails').select('*')

        if search:
            query = query.or_(f'recipient_email.ilike.%{search}%,recipient_name.ilike.%{search}%,subject.ilike.%{search}%')

        sent_result = query.order('sent_at', desc=True).limit(limit).offset(offset).execute()

        # Get engagement data
        leads = []
        for email in (sent_result.data or []):
            email_id = email.get('id')

            # Determine status based on engagement
            if email.get('status') == 'replied' or email.get('replied'):
                email_status = 'replied'
            elif email.get('status') == 'clicked' or email.get('clicked'):
                email_status = 'clicked'
            elif email.get('opened_at') or email.get('opened'):
                email_status = 'opened'
            elif email.get('status') == 'bounced':
                email_status = 'bounced'
            else:
                email_status = 'sent'

            # Apply status filter
            if status and status != 'all' and email_status != status:
                continue

            # Count engagement (simplified - you could query click/reply tables for more accuracy)
            opens_count = 1 if email.get('opened_at') else 0
            clicks_count = 1 if email.get('clicked') else 0
            replies_count = 1 if email.get('replied') else 0

            leads.append({
                "id": email_id,
                "recipient_name": email.get('recipient_name'),
                "recipient_email": email.get('recipient_email'),
                "subject": email.get('subject'),
                "sent_at": email.get('sent_at'),
                "status": email_status,
                "opens_count": opens_count,
                "clicks_count": clicks_count,
                "replies_count": replies_count,
                "campaign_id": email.get('campaign_id'),
                "sender_email": email.get('from_email')
            })

        # Compute the TRUE total with a COUNT(*) query using the same filters
        # as above (len(leads) is just the returned/filtered page). The status
        # filter is applied to a derived status in Python, so mirror that
        # derivation in SQL when it is active.
        if status and status != 'all':
            count_where = [_SENT_STATUS_SQL.get(status, 'FALSE')]
            count_params = []
            if search:
                pattern = f'%{search}%'
                count_where.append('(recipient_email ILIKE %s OR recipient_name ILIKE %s OR subject ILIKE %s)')
                count_params = [pattern, pattern, pattern]
            count_rows = execute_sql(
                'SELECT COUNT(*) AS n FROM sent_emails WHERE ' + ' AND '.join(count_where),
                count_params
            )
            total = count_rows[0]['n'] if count_rows else 0
        else:
            count_query = supabase.table('sent_emails').select('id', count='exact')
            if search:
                count_query = count_query.or_(f'recipient_email.ilike.%{search}%,recipient_name.ilike.%{search}%,subject.ilike.%{search}%')
            total = count_query.limit(1).execute().count or 0

        return {
            "leads": leads,
            "total": total,
            "limit": limit,
            "offset": offset
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get sent emails: {str(e)}")


@router.get("/{lead_id}")
async def get_lead_details(lead_id: str):
    """
    Get detailed information about a specific lead

    Includes:
    - Lead info
    - Engagement timeline
    - All tracking events
    """
    try:
        supabase = get_supabase()

        # Get lead (sent email)
        lead = supabase.table('sent_emails').select('*').eq('id', lead_id).execute()

        if not lead.data or len(lead.data) == 0:
            raise HTTPException(status_code=404, detail="Lead not found")

        lead_data = lead.data[0]

        # Get all tracking events
        # Opens are tracked via opened_at in sent_emails table
        opens_count = 1 if lead_data.get('opened_at') else 0

        # Get all clicks
        clicks = supabase.table('email_clicks')\
            .select('*')\
            .eq('sent_email_id', lead_id)\
            .order('clicked_at', desc=False)\
            .execute()

        replies = supabase.table('email_replies')\
            .select('*')\
            .eq('sent_email_id', lead_id)\
            .order('received_at', desc=False)\
            .execute()

        bounces = supabase.table('email_bounces')\
            .select('*')\
            .eq('sent_email_id', lead_id)\
            .execute()

        # Build timeline
        timeline = []

        # Sent event
        timeline.append({
            "type": "sent",
            "timestamp": lead_data['sent_at'],
            "data": {
                "subject": lead_data['subject'],
                "campaign_id": lead_data.get('campaign_id')
            }
        })

        # Open event (if opened)
        if lead_data.get('opened_at'):
            timeline.append({
                "type": "opened",
                "timestamp": lead_data['opened_at'],
                "data": {}
            })

        # Click events
        for click_event in (clicks.data or []):
            timeline.append({
                "type": "clicked",
                "timestamp": click_event['clicked_at'],
                "data": {
                    "link_url": click_event.get('link_url'),
                    "user_agent": click_event.get('user_agent')
                }
            })

        # Reply events
        for reply_event in (replies.data or []):
            timeline.append({
                "type": "replied",
                "timestamp": reply_event['received_at'],
                "data": {
                    "reply_body": reply_event.get('reply_body_preview'),
                    "is_reviewed": reply_event.get('is_reviewed')
                }
            })

        # Bounce events
        for bounce_event in (bounces.data or []):
            timeline.append({
                "type": "bounced",
                "timestamp": bounce_event['bounced_at'],
                "data": {
                    "bounce_type": bounce_event.get('bounce_type'),
                    "error_message": bounce_event.get('error_message')
                }
            })

        # Sort timeline by timestamp
        timeline.sort(key=lambda x: x['timestamp'])

        return {
            "lead": lead_data,
            "timeline": timeline,
            "stats": {
                "opens": opens_count,
                "clicks": len(clicks.data) if clicks.data else 0,
                "replies": len(replies.data) if replies.data else 0,
                "bounced": len(bounces.data) if bounces.data else 0
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get lead details: {str(e)}")


@router.post("/{lead_id}/note")
async def add_lead_note(lead_id: str, note: dict):
    """
    Add a note to a lead

    Body: {"note": "text content"}
    """
    try:
        # For now, we'll store notes in a JSON field or create a notes table later
        # This is a placeholder endpoint
        return {
            "success": True,
            "message": "Note functionality coming soon"
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to add note: {str(e)}")


@router.put("/{lead_id}/status")
async def update_lead_status(lead_id: str, status_data: dict):
    """
    Update lead status

    Body: {"status": "qualified" | "converted" | etc}
    """
    try:
        supabase = get_supabase()

        new_status = status_data.get('status')
        if not new_status:
            raise HTTPException(status_code=400, detail="Status is required")

        # Update sent_email status
        result = supabase.table('sent_emails')\
            .update({"status": new_status})\
            .eq('id', lead_id)\
            .execute()

        return {
            "success": True,
            "lead_id": lead_id,
            "new_status": new_status
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update status: {str(e)}")


@router.post("/preview")
async def preview_import(file: UploadFile = File(...)):
    """
    Preview file columns before importing

    Returns file columns and suggested mappings for user to review
    """
    try:
        # Validate file type
        filename = file.filename.lower()
        if not (filename.endswith('.xlsx') or filename.endswith('.xls') or filename.endswith('.csv')):
            raise HTTPException(
                status_code=400,
                detail="Invalid file type. Please upload .xlsx, .xls, or .csv file"
            )

        # Read file content
        contents = await file.read()

        # Parse file
        try:
            if filename.endswith('.csv'):
                df = pd.read_csv(io.BytesIO(contents))
            else:
                df = pd.read_excel(io.BytesIO(contents))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to read file: {str(e)}")

        # Get original columns
        original_columns = df.columns.tolist()

        # Normalize for matching
        df.columns = df.columns.str.lower().str.strip().str.replace(' ', '_')

        # Helper function to suggest mapping
        def suggest_mapping(field_options):
            for option in field_options:
                matches = [col for col in df.columns if option in col]
                if matches:
                    return matches[0]
            return None

        # Suggest mappings
        suggested_mappings = {
            'email': suggest_mapping(['email', 'e-mail', 'mail']),
            'name': suggest_mapping(['name', 'full_name', 'contact_name', 'decision_maker']),
            'company': suggest_mapping(['company', 'company_name', 'organization', 'business']),
            'title': suggest_mapping(['title', 'job_title', 'position', 'role', 'designation']),
            'phone': suggest_mapping(['phone', 'phone_number', 'mobile', 'telephone']),
            'industry': suggest_mapping(['industry', 'sector', 'vertical']),
            'location': suggest_mapping(['location', 'city', 'country', 'address', 'region']),
            'notes': suggest_mapping(['notes', 'description', 'comments', 'memo'])
        }

        # Get sample data (first 3 rows)
        sample_data = []
        for idx, row in df.head(3).iterrows():
            sample_data.append({col: str(row[col]) if pd.notna(row[col]) else '' for col in df.columns})

        return {
            "success": True,
            "filename": file.filename,
            "columns": original_columns,
            "suggested_mappings": suggested_mappings,
            "sample_data": sample_data,
            "total_rows": len(df)
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to preview file: {str(e)}")


@router.post("/import")
async def import_leads_from_file(
    file: UploadFile = File(...),
    column_mappings: Optional[str] = None,
    segment: Optional[str] = None
):
    """
    Import leads from uploaded Excel or CSV file

    Expected columns (case-insensitive, flexible):
    - email (REQUIRED)
    - name, company, title, phone, website, industry, location, notes (optional)

    column_mappings: JSON string mapping file columns to database fields
    Example: {"email": "Email Address", "name": "Full Name", "title": "Designation"}

    Returns:
    - imported: count of successfully imported leads
    - skipped: count of skipped leads (duplicates/invalid)
    - errors: count of errors
    - total: total rows in file
    """
    try:
        # Validate file type
        filename = file.filename.lower()
        if not (filename.endswith('.xlsx') or filename.endswith('.xls') or filename.endswith('.csv')):
            raise HTTPException(
                status_code=400,
                detail="Invalid file type. Please upload .xlsx, .xls, or .csv file"
            )

        # Read file content
        contents = await file.read()

        # Parse file
        try:
            if filename.endswith('.csv'):
                df = pd.read_csv(io.BytesIO(contents))
            else:
                df = pd.read_excel(io.BytesIO(contents))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to read file: {str(e)}")

        # Normalize column names
        original_columns = df.columns.tolist()
        df.columns = df.columns.str.lower().str.strip().str.replace(' ', '_')

        # Parse custom column mappings if provided
        import json
        custom_mappings = {}
        if column_mappings:
            try:
                custom_mappings = json.loads(column_mappings)
            except:
                pass

        # If custom mappings provided, use them
        if custom_mappings:
            email_col = custom_mappings.get('email')
            name_col = custom_mappings.get('name')
            company_col = custom_mappings.get('company')
            title_col = custom_mappings.get('title')
            phone_col = custom_mappings.get('phone')
            industry_col = custom_mappings.get('industry')
            location_col = custom_mappings.get('location')
            notes_col = custom_mappings.get('notes')
            first_name_col = None
            last_name_col = None
            website_col = None

            # Normalize custom mapping column names
            if email_col:
                email_col = email_col.lower().strip().replace(' ', '_')
            if name_col:
                name_col = name_col.lower().strip().replace(' ', '_')
            if company_col:
                company_col = company_col.lower().strip().replace(' ', '_')
            if title_col:
                title_col = title_col.lower().strip().replace(' ', '_')
            if phone_col:
                phone_col = phone_col.lower().strip().replace(' ', '_')
            if industry_col:
                industry_col = industry_col.lower().strip().replace(' ', '_')
            if location_col:
                location_col = location_col.lower().strip().replace(' ', '_')
            if notes_col:
                notes_col = notes_col.lower().strip().replace(' ', '_')
        else:
            # Auto-detect columns (original logic)
            # Helper function to find column
            def get_column(names):
                for name in names:
                    matches = [col for col in df.columns if name in col]
                    if matches:
                        return matches[0]
                return None

            email_col = get_column(['email', 'e-mail', 'mail'])
            name_col = get_column(['name', 'full_name', 'contact_name', 'decision_maker'])
            first_name_col = get_column(['first_name', 'firstname'])
            last_name_col = get_column(['last_name', 'lastname'])
            company_col = get_column(['company', 'company_name', 'organization', 'business'])
            title_col = get_column(['title', 'job_title', 'position', 'role', 'designation'])
            phone_col = get_column(['phone', 'phone_number', 'mobile', 'telephone'])
            website_col = get_column(['website', 'company_website', 'url', 'site'])
            industry_col = get_column(['industry', 'sector', 'vertical'])
            location_col = get_column(['location', 'city', 'country', 'address', 'region'])
            notes_col = get_column(['notes', 'description', 'comments', 'memo'])

        # Check for email column (REQUIRED)
        if not email_col or email_col not in df.columns:
            error_msg = (
                f"❌ Missing required column: 'email'\n\n"
                f"Found columns: {', '.join(original_columns)}\n"
                f"Required: Email\n"
                f"Optional: Name, Company, Title, Phone, Industry, Location, Notes\n\n"
                f"💡 Your file must have an 'Email' column"
            )
            raise HTTPException(status_code=400, detail=error_msg)

        # Build column mapping report
        column_mapping = {
            "found": {
                "email": email_col,
                "name": name_col or first_name_col or "Not found",
                "company": company_col or "Not found",
                "title": title_col or "Not found",
                "phone": phone_col or "Not found",
                "industry": industry_col or "Not found",
                "location": location_col or "Not found",
                "notes": notes_col or "Not found"
            },
            "unmatched_columns": [col for col in original_columns if col.lower().replace(' ', '_') not in [
                email_col, name_col, first_name_col, last_name_col, company_col,
                title_col, phone_col, website_col, industry_col, location_col, notes_col
            ]]
        }

        # Warnings for missing important columns
        warnings = []
        if not name_col and not first_name_col:
            warnings.append("No 'name' column found - contacts will be imported without names")
        if not company_col:
            warnings.append("No 'company' column found - missing company information")
        if not title_col:
            warnings.append("No 'title' column found - missing job titles")
        if column_mapping["unmatched_columns"]:
            warnings.append(f"Unmatched columns will be ignored: {', '.join(column_mapping['unmatched_columns'])}")

        # Get existing emails to check for duplicates
        supabase = get_supabase()
        existing = supabase.table('scraped_leads').select('email').execute()
        existing_emails = {lead['email'].lower() for lead in existing.data if lead.get('email')}

        # Import leads with email verification
        verifier = EmailVerifier()
        imported = 0
        skipped = 0
        errors = 0
        invalid_emails = 0
        error_details = []
        invalid_email_list = []

        # Normalize the target segment and register it if it's new, so importing
        # a file into a brand-new segment "just works" without a code change.
        seg_key = None
        if segment and str(segment).strip():
            import re as _re
            seg_key = _re.sub(r'[^a-z0-9]+', '_', str(segment).strip().lower()).strip('_') or None
        if seg_key:
            try:
                existing_seg = supabase.table('segments').select('id').eq('key', seg_key).execute()
                if not existing_seg.data:
                    supabase.table('segments').insert({
                        'key': seg_key,
                        'label': str(segment).strip().title(),
                    }).execute()
            except Exception as _e:
                print(f"Warning: could not register segment '{seg_key}': {_e}")

        for idx, row in df.iterrows():
            try:
                # Get email
                email = str(row[email_col]).strip().lower() if pd.notna(row[email_col]) else None

                if not email or email == 'nan' or '@' not in email:
                    skipped += 1
                    continue

                # Check for duplicate
                if email in existing_emails:
                    skipped += 1
                    continue

                # VERIFY EMAIL before importing (prevents bounces)
                verification = verifier.verify_email(email, check_smtp=False)
                if not verification['is_valid']:
                    invalid_emails += 1
                    invalid_email_list.append({
                        'email': email,
                        'reason': verification['recommendation']
                    })
                    error_details.append(f"Row {idx + 2}: Invalid email {email} - {verification['recommendation']}")
                    continue

                # Build name
                name = None
                if name_col and pd.notna(row[name_col]):
                    name = str(row[name_col]).strip()
                elif first_name_col and last_name_col:
                    first = str(row[first_name_col]).strip() if pd.notna(row[first_name_col]) else ''
                    last = str(row[last_name_col]).strip() if pd.notna(row[last_name_col]) else ''
                    name = f"{first} {last}".strip()
                elif first_name_col and pd.notna(row[first_name_col]):
                    name = str(row[first_name_col]).strip()

                # Get other fields
                company = str(row[company_col]).strip() if company_col and pd.notna(row[company_col]) else None
                title = str(row[title_col]).strip() if title_col and pd.notna(row[title_col]) else None
                phone = str(row[phone_col]).strip() if phone_col and pd.notna(row[phone_col]) else None
                website = str(row[website_col]).strip() if website_col and pd.notna(row[website_col]) else None
                industry = str(row[industry_col]).strip() if industry_col and pd.notna(row[industry_col]) else None
                location = str(row[location_col]).strip() if location_col and pd.notna(row[location_col]) else None
                notes = str(row[notes_col]).strip() if notes_col and pd.notna(row[notes_col]) else None

                # Insert lead into scraped_leads table
                lead_data = {
                    'email': email,
                    'decision_maker_name': name,
                    'company_name': company,
                    'decision_maker_title': title,
                    'phone': phone,
                    'industry': industry,
                    'location': location,
                    'notes': notes,
                    'segment': seg_key,
                    'status': 'new',
                    'created_at': datetime.utcnow().isoformat(),
                    'source_url': 'file_import',
                    'is_executive': True if title and any(x in title.lower() for x in ['ceo', 'cto', 'cfo', 'vp', 'director', 'chief']) else False
                }

                result = supabase.table('scraped_leads').insert(lead_data).execute()

                if result.data:
                    imported += 1
                    existing_emails.add(email)
                else:
                    errors += 1
                    error_details.append(f"Row {idx + 2}: Failed to insert {email}")

            except Exception as e:
                errors += 1
                error_details.append(f"Row {idx + 2}: {str(e)}")

        # Add warning about invalid emails
        if invalid_emails > 0:
            warnings.append(f"⚠️ {invalid_emails} emails rejected (invalid domain/no mail server) - protects your sender reputation")

        return {
            "success": True,
            "imported": imported,
            "skipped": skipped,
            "errors": errors,
            "invalid_emails": invalid_emails,
            "total": len(df),
            "error_details": error_details[:10] if error_details else [],
            "invalid_email_list": invalid_email_list[:10] if invalid_email_list else [],
            "column_mapping": column_mapping,
            "warnings": warnings
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to import leads: {str(e)}")


@router.delete("/{lead_id}")
async def delete_lead(lead_id: str):
    """
    Delete a lead from scraped_leads table

    This permanently removes the lead from the database
    """
    try:
        supabase = get_supabase()

        # Check if lead exists
        lead = supabase.table('scraped_leads').select('*').eq('id', lead_id).execute()

        if not lead.data or len(lead.data) == 0:
            raise HTTPException(status_code=404, detail="Lead not found")

        # Delete the lead
        supabase.table('scraped_leads').delete().eq('id', lead_id).execute()

        return {
            "success": True,
            "message": f"Lead deleted successfully",
            "deleted_email": lead.data[0].get('email')
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete lead: {str(e)}")


@router.post("/bulk-delete")
async def bulk_delete_leads(lead_ids: List[str]):
    """
    Delete multiple leads at once

    Useful for cleaning up duplicate imports or removing multiple test leads
    """
    try:
        supabase = get_supabase()

        deleted = 0
        errors = []

        for lead_id in lead_ids:
            try:
                result = supabase.table('scraped_leads').delete().eq('id', lead_id).execute()
                if result.data:
                    deleted += 1
            except Exception as e:
                errors.append(f"Failed to delete {lead_id}: {str(e)}")

        return {
            "success": True,
            "deleted": deleted,
            "total": len(lead_ids),
            "errors": errors if errors else []
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to bulk delete: {str(e)}")


@router.delete("/by-email/{email}")
async def delete_lead_by_email(email: str):
    """
    Delete a lead by email address

    Useful when you know the email but not the ID
    """
    try:
        supabase = get_supabase()

        # Find and delete by email
        result = supabase.table('scraped_leads').delete().eq('email', email.lower()).execute()

        if not result.data or len(result.data) == 0:
            raise HTTPException(status_code=404, detail=f"No lead found with email: {email}")

        return {
            "success": True,
            "message": f"Lead with email {email} deleted successfully",
            "deleted_count": len(result.data)
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete lead: {str(e)}")


@router.get("/sent-emails")
async def get_sent_emails(
    status: Optional[str] = Query(None, description="Filter by status"),
    search: Optional[str] = Query(None, description="Search by email/name/subject"),
    limit: int = Query(100, description="Number of results"),
    offset: int = Query(0, description="Pagination offset")
):
    """
    Get sent emails with engagement tracking for Lead Funnel page

    Returns emails with opens, clicks, replies counts
    """
    try:
        supabase = get_supabase()

        # Build query
        query = supabase.table('sent_emails').select('*')

        if search:
            query = query.or_(f'recipient_email.ilike.%{search}%,recipient_name.ilike.%{search}%,subject.ilike.%{search}%')

        result = query.order('sent_at', desc=True).limit(limit).offset(offset).execute()

        # Compute the TRUE total with a COUNT(*) query using the same filters
        # as the data query (len(leads) is just the returned/filtered page).
        # The status filter is applied to a derived status in Python, so
        # mirror that derivation in SQL when it is active.
        if status and status != 'all':
            count_where = [_SENT_ENGAGEMENT_STATUS_SQL.get(status, 'FALSE')]
            count_params = []
            if search:
                pattern = f'%{search}%'
                count_where.append('(recipient_email ILIKE %s OR recipient_name ILIKE %s OR subject ILIKE %s)')
                count_params = [pattern, pattern, pattern]
            count_rows = execute_sql(
                'SELECT COUNT(*) AS n FROM sent_emails WHERE ' + ' AND '.join(count_where),
                count_params
            )
            total = count_rows[0]['n'] if count_rows else 0
        else:
            count_query = supabase.table('sent_emails').select('id', count='exact')
            if search:
                count_query = count_query.or_(f'recipient_email.ilike.%{search}%,recipient_name.ilike.%{search}%,subject.ilike.%{search}%')
            total = count_query.limit(1).execute().count or 0

        if not result.data:
            return {"leads": [], "total": total}

        # Get engagement data for each email
        leads = []
        for email in result.data:
            email_id = email.get('id')

            # Count opens (from opened_at field)
            opens_count = 1 if email.get('opened_at') else 0

            # Count clicks
            clicks = supabase.table('email_clicks').select('id').eq('sent_email_id', email_id).execute()
            clicks_count = len(clicks.data) if clicks.data else 0

            # Count replies
            replies = supabase.table('email_replies').select('id').eq('sent_email_id', email_id).execute()
            replies_count = len(replies.data) if replies.data else 0

            # Determine status based on engagement
            if replies_count > 0:
                email_status = 'replied'
            elif clicks_count > 0:
                email_status = 'clicked'
            elif opens_count > 0:
                email_status = 'opened'
            elif email.get('status') == 'bounced':
                email_status = 'bounced'
            else:
                email_status = 'sent'

            # Filter by status if specified
            if status and status != 'all' and email_status != status:
                continue

            leads.append({
                "id": email_id,
                "recipient_name": email.get('recipient_name'),
                "recipient_email": email.get('recipient_email'),
                "subject": email.get('subject'),
                "sent_at": email.get('sent_at'),
                "status": email_status,
                "opens_count": opens_count,
                "clicks_count": clicks_count,
                "replies_count": replies_count,
                "sender_email": email.get('sender_email'),
                "campaign_id": email.get('campaign_id')
            })

        return {
            "leads": leads,
            "total": total
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get sent emails: {str(e)}")


@router.get("/template")
async def download_template():
    """
    Download a CSV template for importing leads

    Returns a CSV file with all the required and optional column headers
    """
    # Create sample data
    template_data = {
        'Email': ['john.doe@example.com', 'jane.smith@company.com'],
        'Name': ['John Doe', 'Jane Smith'],
        'Company': ['Example Corp', 'Company Inc'],
        'Title': ['CEO', 'Marketing Director'],
        'Phone': ['+1-555-0123', '+1-555-0456'],
        'Industry': ['Technology', 'Marketing'],
        'Location': ['San Francisco, CA', 'New York, NY'],
        'Notes': ['Interested in AI solutions', 'Follow up next quarter']
    }

    df = pd.DataFrame(template_data)

    # Create CSV in memory
    output = io.BytesIO()
    df.to_csv(output, index=False)
    output.seek(0)

    # Return as downloadable file
    return StreamingResponse(
        output,
        media_type="text/csv",
        headers={
            "Content-Disposition": "attachment; filename=leads_import_template.csv"
        }
    )


@router.patch("/sent-emails/{email_id}/mark-replied")
async def mark_email_replied(email_id: str):
    """Manually mark a sent email as replied and create an email_replies record."""
    try:
        supabase = get_supabase()
        now = datetime.utcnow().isoformat()

        # Update sent_emails
        result = supabase.table('sent_emails').update({
            'status': 'replied',
            'replied_at': now
        }).eq('id', email_id).execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Email not found")

        email = result.data[0]

        # Insert into email_replies if not already there
        existing = supabase.table('email_replies').select('id').eq('sent_email_id', email_id).execute()
        if not existing.data:
            supabase.table('email_replies').insert({
                'sent_email_id': email_id,
                'campaign_id': email.get('campaign_id'),
                'lead_id': email.get('lead_id'),
                'gmail_message_id': f"manual-{email_id}",
                'gmail_thread_id': email.get('gmail_thread_id'),
                'from_email': email.get('recipient_email', ''),
                'from_name': email.get('recipient_name', ''),
                'subject': f"Re: {email.get('subject', '')}",
                'body_text': '(Manually recorded reply)',
                'received_at': now,
            }).execute()

        return {"status": "replied", "email_id": email_id}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to mark replied: {str(e)}")


@router.post("/sync-replies")
async def sync_replies():
    """
    Poll Gmail threads for replies and update sent_emails + email_replies tables.
    Uses the active email account credentials to check each stored gmail_thread_id.
    """
    try:
        supabase = get_supabase()

        # Get active account credentials
        accounts = supabase.table('email_accounts').select('*').eq('is_active', True).execute()
        if not accounts.data:
            raise HTTPException(status_code=400, detail="No active email accounts found")

        # Get all sent emails that have a thread ID and are not yet replied
        pending_rows = execute_sql(
            """SELECT id, gmail_thread_id, gmail_message_id, recipient_email,
                      recipient_name, campaign_id, lead_id
               FROM sent_emails
               WHERE gmail_thread_id IS NOT NULL
                 AND (status IS NULL OR status <> 'replied')""",
            []
        )

        if not pending_rows:
            return {"checked": 0, "replies_found": 0}

        # Convert to list of dicts
        cols = ['id', 'gmail_thread_id', 'gmail_message_id', 'recipient_email',
                'recipient_name', 'campaign_id', 'lead_id']
        pending_emails = [dict(zip(cols, row)) for row in pending_rows]
        replies_found = 0

        for account in accounts.data:
            if not account.get('refresh_token'):
                continue
            try:
                gmail = GmailClient(
                    email=account['email'],
                    refresh_token=account['refresh_token'],
                    access_token=account.get('access_token')
                )

                for email in pending_emails:
                    thread_id = email.get('gmail_thread_id')
                    if not thread_id:
                        continue
                    try:
                        messages = gmail.get_thread_messages(thread_id)
                        # messages[0] is the original sent email; anything after is a reply
                        reply_messages = [m for m in messages if m.get('message_id') != email.get('gmail_message_id')]
                        if not reply_messages:
                            continue

                        first_reply = reply_messages[0]
                        reply_ts = datetime.utcnow().isoformat()

                        # Update sent_emails to replied
                        supabase.table('sent_emails').update({
                            'status': 'replied',
                            'replied_at': reply_ts
                        }).eq('id', email['id']).execute()

                        # Insert each reply message (unique on gmail_message_id)
                        for msg in reply_messages:
                            mid = msg.get('message_id', '')
                            if not mid:
                                continue
                            # Skip if already recorded (unique constraint)
                            existing = supabase.table('email_replies')\
                                .select('id').eq('gmail_message_id', mid).execute()
                            if existing.data:
                                continue
                            supabase.table('email_replies').insert({
                                'sent_email_id': email['id'],
                                'campaign_id': email.get('campaign_id'),
                                'lead_id': email.get('lead_id'),
                                'gmail_message_id': mid,
                                'gmail_thread_id': thread_id,
                                'from_email': msg.get('from', email.get('recipient_email', '')),
                                'subject': msg.get('subject', ''),
                                'body_text': msg.get('body_text', ''),
                                'body_html': msg.get('body_html', ''),
                                'received_at': reply_ts,
                            }).execute()

                        replies_found += 1

                    except Exception:
                        # Can't access this thread — skip silently
                        continue

                break  # Successfully used this account; no need to try others

            except Exception:
                continue

        return {"checked": len(pending_emails), "replies_found": replies_found}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sync failed: {str(e)}")


# ---------------------------------------------------------------------------
# Real-time agent activity stream (SSE)
# ---------------------------------------------------------------------------

def _fetch_agent_events(since: datetime) -> list:
    """Query DB for agent activity events since the given timestamp."""
    events = []
    since_str = since.isoformat()

    # ── Sent emails / opens / replies ──────────────────────────────────────
    rows = execute_sql("""
        SELECT from_email, recipient_email, recipient_name,
               subject, status, sent_at, opened_at, replied_at, bounced_at
        FROM sent_emails
        WHERE sent_at    >= %s
           OR opened_at  >= %s
           OR replied_at >= %s
           OR bounced_at >= %s
        ORDER BY GREATEST(
            sent_at,
            COALESCE(opened_at,  '1970-01-01'::timestamptz),
            COALESCE(replied_at, '1970-01-01'::timestamptz),
            COALESCE(bounced_at, '1970-01-01'::timestamptz)
        ) DESC
        LIMIT 50
    """, [since_str, since_str, since_str, since_str])

    for row in (rows or []):
        from_email, to_email, to_name, subject, status, sent_at, opened_at, replied_at, bounced_at = row
        agent = (from_email or '').split('@')[0].capitalize() or 'System'
        contact = to_name or to_email or 'unknown'
        subj = (subject or '')[:60]

        # Emit the most recent transition for this row
        ts_action = []
        if bounced_at and bounced_at >= since:
            ts_action.append((bounced_at, 'EMAIL_BOUNCED', f"{contact} — email bounced", 'error'))
        if replied_at and replied_at >= since:
            ts_action.append((replied_at, 'REPLY_RECEIVED', f"{contact} replied", 'success'))
        if opened_at and opened_at >= since:
            ts_action.append((opened_at, 'EMAIL_OPENED', f"{contact} opened: {subj}", 'info'))
        if sent_at and sent_at >= since:
            ts_action.append((sent_at, 'EMAIL_SENT', f"To {contact}: {subj}", 'default'))

        for ts, action, detail, level in ts_action:
            events.append({
                'id': f"{action}-{to_email}-{ts.isoformat()}",
                'agent': agent,
                'action': action,
                'detail': detail,
                'level': level,
                'timestamp': ts.isoformat(),
            })

    # ── Scraping jobs ───────────────────────────────────────────────────────
    job_rows = execute_sql("""
        SELECT search_query, location, status, progress,
               leads_found, started_at, completed_at
        FROM scraping_jobs
        WHERE started_at   >= %s
           OR completed_at >= %s
        ORDER BY GREATEST(started_at, COALESCE(completed_at, '1970-01-01'::timestamptz)) DESC
        LIMIT 10
    """, [since_str, since_str])

    for row in (job_rows or []):
        query, location, status, progress, leads_found, started_at, completed_at = row
        ts = completed_at or started_at
        if not ts:
            continue
        action_map = {
            'completed': ('SCRAPE_COMPLETE',  f"{leads_found} leads found — \"{query}\" in {location}", 'success'),
            'running':   ('SCRAPING',         f"\"{query}\" — {progress}% done",                       'info'),
            'failed':    ('SCRAPE_FAILED',    f"\"{query}\" failed",                                    'error'),
            'pending':   ('SCRAPE_QUEUED',    f"\"{query}\" queued",                                    'default'),
        }
        action, detail, level = action_map.get(status, ('SCRAPE_STARTED', f"\"{query}\"", 'default'))
        events.append({
            'id': f"scrape-{query}-{ts.isoformat()}",
            'agent': 'Scraper',
            'action': action,
            'detail': detail,
            'level': level,
            'timestamp': ts.isoformat(),
        })

    # ── Scheduler / campaign runs ───────────────────────────────────────────
    sched_rows = execute_sql("""
        SELECT status, emails_sent, emails_failed, started_at, completed_at
        FROM scheduler_run_history
        WHERE started_at >= %s
        ORDER BY started_at DESC
        LIMIT 5
    """, [since_str])

    for row in (sched_rows or []):
        status, sent, failed, started_at, completed_at = row
        ts = completed_at or started_at
        if not ts:
            continue
        level = 'success' if status == 'completed' else ('error' if status == 'failed' else 'info')
        events.append({
            'id': f"sched-{started_at.isoformat()}",
            'agent': 'Scheduler',
            'action': 'CAMPAIGN_RUN',
            'detail': f"Campaign: {sent or 0} sent, {failed or 0} failed",
            'level': level,
            'timestamp': ts.isoformat(),
        })

    # Deduplicate by id, sort newest first
    seen = set()
    unique = []
    for e in sorted(events, key=lambda x: x['timestamp'], reverse=True):
        if e['id'] not in seen:
            seen.add(e['id'])
            unique.append(e)
    return unique


@router.get("/agent-stream")
async def agent_activity_stream():
    """
    SSE endpoint for real-time agent activity.
    Emits DB-sourced events every 3 s; clients reconnect automatically.
    """
    async def generate():
        # On first connect send the last 24 hours of activity
        since = datetime.utcnow() - timedelta(hours=24)
        first_tick = True

        while True:
            try:
                events = await asyncio.to_thread(_fetch_agent_events, since)
                if events:
                    for ev in events:
                        yield f"data: {json.dumps(ev)}\n\n"
                else:
                    # Heartbeat so the connection stays alive
                    yield f"data: {json.dumps({'type': 'heartbeat', 'timestamp': datetime.utcnow().isoformat()})}\n\n"
            except Exception as exc:
                yield f"data: {json.dumps({'type': 'error', 'detail': str(exc), 'timestamp': datetime.utcnow().isoformat()})}\n\n"

            # After first tick only look at the last 4 s (slight overlap to avoid gaps)
            if first_tick:
                first_tick = False
                since = datetime.utcnow() - timedelta(seconds=4)
            else:
                since = datetime.utcnow() - timedelta(seconds=4)

            await asyncio.sleep(3)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )

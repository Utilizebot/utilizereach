"""
Real-time agent activity stream (SSE)
Serves live DB events to the Agent Stream dashboard page.
"""

import json
import asyncio
from datetime import datetime, timedelta
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from database.pg import execute_sql

router = APIRouter(prefix="/api/stream", tags=["Stream"])


def _parse_ts(val) -> datetime | None:
    """Normalise DB timestamp to an aware datetime or None."""
    if val is None:
        return None
    if isinstance(val, datetime):
        return val if val.tzinfo else val.replace(tzinfo=__import__('datetime').timezone.utc)
    try:
        from datetime import timezone
        s = str(val)
        # strip microseconds beyond 6 digits
        dt = datetime.fromisoformat(s.replace(' ', 'T').rstrip('Z'))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _fetch_events(since: datetime) -> list:
    """Pull recent agent activity from the DB."""
    events = []
    s = since.isoformat()

    # ── Sent emails, opens, replies, bounces ──────────────────────────────
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
    """, [s, s, s, s])

    for row in (rows or []):
        from_email = row.get('from_email', '')
        to_email   = row.get('recipient_email', '')
        to_name    = row.get('recipient_name', '')
        subject    = row.get('subject', '')
        agent   = (from_email or '').split('@')[0].capitalize() or 'System'
        contact = to_name or to_email or 'unknown'
        subj    = (subject or '')[:60]

        sent_at    = _parse_ts(row.get('sent_at'))
        opened_at  = _parse_ts(row.get('opened_at'))
        replied_at = _parse_ts(row.get('replied_at'))
        bounced_at = _parse_ts(row.get('bounced_at'))

        candidates = []
        if bounced_at and bounced_at >= since:
            candidates.append((bounced_at, 'EMAIL_BOUNCED',   f"{contact} — bounced",      'error'))
        if replied_at and replied_at >= since:
            candidates.append((replied_at, 'REPLY_RECEIVED',  f"{contact} replied",        'success'))
        if opened_at and opened_at >= since:
            candidates.append((opened_at,  'EMAIL_OPENED',    f"{contact} opened: {subj}", 'info'))
        if sent_at and sent_at >= since:
            candidates.append((sent_at,    'EMAIL_SENT',      f"To {contact}: {subj}",     'default'))

        for ts, action, detail, level in candidates:
            events.append({
                'id':        f"{action}-{to_email}-{ts.isoformat()}",
                'agent':     agent,
                'action':    action,
                'detail':    detail,
                'level':     level,
                'timestamp': ts.isoformat(),
            })

    # ── Scraping jobs ─────────────────────────────────────────────────────
    job_rows = execute_sql("""
        SELECT search_query, location, status, progress,
               leads_found, started_at, completed_at
        FROM scraping_jobs
        WHERE started_at   >= %s
           OR completed_at >= %s
        ORDER BY GREATEST(started_at, COALESCE(completed_at, '1970-01-01'::timestamptz)) DESC
        LIMIT 10
    """, [s, s])

    for row in (job_rows or []):
        query        = row.get('search_query', '')
        location     = row.get('location', '')
        status       = row.get('status', '')
        progress     = row.get('progress', 0)
        leads_found  = row.get('leads_found', 0)
        started_at   = _parse_ts(row.get('started_at'))
        completed_at = _parse_ts(row.get('completed_at'))
        ts = completed_at or started_at
        if not ts:
            continue
        action_map = {
            'completed': ('SCRAPE_COMPLETE', f"{leads_found} leads — \"{query}\" in {location}", 'success'),
            'running':   ('SCRAPING',        f"\"{query}\" — {progress}% done",                  'info'),
            'failed':    ('SCRAPE_FAILED',   f"\"{query}\" failed",                               'error'),
            'pending':   ('SCRAPE_QUEUED',   f"\"{query}\" queued",                               'default'),
        }
        action, detail, level = action_map.get(status, ('SCRAPE_STARTED', f"\"{query}\"", 'default'))
        events.append({
            'id':        f"scrape-{query}-{ts.isoformat()}",
            'agent':     'Scraper',
            'action':    action,
            'detail':    detail,
            'level':     level,
            'timestamp': ts.isoformat(),
        })

    # ── Scheduler / campaign runs ─────────────────────────────────────────
    sched_rows = execute_sql("""
        SELECT status, emails_sent, emails_failed, started_at, completed_at
        FROM scheduler_run_history
        WHERE started_at >= %s
        ORDER BY started_at DESC
        LIMIT 5
    """, [s])

    for row in (sched_rows or []):
        status       = row.get('status', '')
        sent         = row.get('emails_sent', 0)
        failed       = row.get('emails_failed', 0)
        started_at   = _parse_ts(row.get('started_at'))
        completed_at = _parse_ts(row.get('completed_at'))
        ts = completed_at or started_at
        if not ts:
            continue
        level = 'success' if status == 'completed' else ('error' if status == 'failed' else 'info')
        events.append({
            'id':        f"sched-{started_at.isoformat()}",
            'agent':     'Scheduler',
            'action':    'CAMPAIGN_RUN',
            'detail':    f"Campaign: {sent or 0} sent, {failed or 0} failed",
            'level':     level,
            'timestamp': ts.isoformat(),
        })

    # Deduplicate and sort newest-first
    seen, unique = set(), []
    for e in sorted(events, key=lambda x: x['timestamp'], reverse=True):
        if e['id'] not in seen:
            seen.add(e['id'])
            unique.append(e)
    return unique


@router.get("/agents")
async def agent_activity_stream():
    """
    SSE stream of real agent activity (emails, scraping, campaigns).
    On connect: last 24 h of history.  Then: new events every 3 s.
    """
    async def generate():
        from datetime import timezone
        now       = lambda: datetime.now(timezone.utc)
        since     = now() - timedelta(hours=24)
        first_tick = True
        while True:
            try:
                evs = await asyncio.to_thread(_fetch_events, since)
                if evs:
                    for ev in evs:
                        yield f"data: {json.dumps(ev)}\n\n"
                else:
                    yield f"data: {json.dumps({'type':'heartbeat','timestamp':now().isoformat()})}\n\n"
            except Exception as exc:
                yield f"data: {json.dumps({'type':'error','detail':str(exc),'timestamp':now().isoformat()})}\n\n"

            if first_tick:
                first_tick = False
            since = now() - timedelta(seconds=4)
            await asyncio.sleep(3)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )

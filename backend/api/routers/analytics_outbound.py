"""
Outbound email analytics — real reporting for the cold-outreach engine
(replaces the legacy website-form "Analytics" for utilizereach).

All numbers are computed live from sent_emails (+ email_replies via replied_at,
+ scraped_leads for segment, + campaigns for campaign name). Engagement is
bounce-exclusive: a bounced email is NOT counted as opened/clicked (any "open"
on an undelivered message is an automated scanner, not a human).
"""
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from database.pg import execute_sql

router = APIRouter(prefix="/api/analytics-outbound", tags=["analytics-outbound"])

# opened/clicked only count when NOT bounced
OPENED = "opened_at IS NOT NULL AND bounced_at IS NULL"
CLICKED = "clicked_at IS NOT NULL AND bounced_at IS NULL"
REPLIED = "replied_at IS NOT NULL"
BOUNCED = "bounced_at IS NOT NULL"


def _rate(n, d):
    return round((n or 0) / d * 100, 1) if d else 0.0


def _window(days: Optional[int], col="sent_at"):
    """Return (sql_fragment, params) for a rolling-day window; days<=0 = all."""
    if days and days > 0:
        return f" WHERE {col} >= now() - make_interval(days => %s)", [days]
    return "", []


@router.get("/summary")
async def summary(days: int = Query(30, description="rolling window in days; 0 = all time")):
    try:
        w, p = _window(days)

        # headline overview
        ov = execute_sql(
            f"SELECT count(*) sent, "
            f"count(*) FILTER (WHERE {OPENED}) opened, "
            f"count(*) FILTER (WHERE {CLICKED}) clicked, "
            f"count(*) FILTER (WHERE {REPLIED}) replied, "
            f"count(*) FILTER (WHERE {BOUNCED}) bounced "
            f"FROM sent_emails{w}", p)
        o = ov[0] if ov else {}
        sent = o.get("sent", 0) or 0
        overview = {
            "sent": sent, "opened": o.get("opened", 0) or 0, "clicked": o.get("clicked", 0) or 0,
            "replied": o.get("replied", 0) or 0, "bounced": o.get("bounced", 0) or 0,
            "open_rate": _rate(o.get("opened"), sent), "click_rate": _rate(o.get("clicked"), sent),
            "reply_rate": _rate(o.get("replied"), sent), "bounce_rate": _rate(o.get("bounced"), sent),
            "days": days,
        }

        # daily timeseries
        ts = execute_sql(
            f"SELECT to_char(sent_at::date,'YYYY-MM-DD') d, count(*) sent, "
            f"count(*) FILTER (WHERE {OPENED}) opened, "
            f"count(*) FILTER (WHERE {CLICKED}) clicked, "
            f"count(*) FILTER (WHERE {REPLIED}) replied "
            f"FROM sent_emails{w} GROUP BY 1 ORDER BY 1", p)
        timeseries = [{"date": r["d"], "sent": r["sent"], "opened": r["opened"],
                       "clicked": r["clicked"], "replied": r["replied"]} for r in (ts or [])]

        # per persona (all time — small set)
        pr = execute_sql(
            f"SELECT from_email, count(*) sent, count(*) FILTER (WHERE {OPENED}) opened, "
            f"count(*) FILTER (WHERE {REPLIED}) replied FROM sent_emails "
            f"WHERE from_email IS NOT NULL GROUP BY 1 ORDER BY sent DESC")
        personas = [{"from_email": r["from_email"], "name": (r["from_email"] or "").split("@")[0],
                     "sent": r["sent"], "opened": r["opened"], "replied": r["replied"],
                     "open_rate": _rate(r["opened"], r["sent"]), "reply_rate": _rate(r["replied"], r["sent"])}
                    for r in (pr or [])]

        # per segment (join leads)
        sr = execute_sql(
            f"SELECT COALESCE(sl.segment,'(unsegmented)') segment, count(*) sent, "
            f"count(*) FILTER (WHERE {OPENED.replace('opened_at','se.opened_at').replace('bounced_at','se.bounced_at')}) opened, "
            f"count(*) FILTER (WHERE se.replied_at IS NOT NULL) replied "
            f"FROM sent_emails se JOIN scraped_leads sl ON lower(sl.email)=lower(se.recipient_email) "
            f"GROUP BY 1 ORDER BY sent DESC LIMIT 30")
        segments = [{"segment": r["segment"], "sent": r["sent"], "opened": r["opened"], "replied": r["replied"],
                     "open_rate": _rate(r["opened"], r["sent"]), "reply_rate": _rate(r["replied"], r["sent"])}
                    for r in (sr or [])]

        # per campaign
        cr = execute_sql(
            f"SELECT c.name, count(*) sent, "
            f"count(*) FILTER (WHERE se.opened_at IS NOT NULL AND se.bounced_at IS NULL) opened, "
            f"count(*) FILTER (WHERE se.replied_at IS NOT NULL) replied "
            f"FROM sent_emails se JOIN campaigns c ON c.id=se.campaign_id "
            f"GROUP BY c.name ORDER BY sent DESC")
        campaigns = [{"name": r["name"], "sent": r["sent"], "opened": r["opened"], "replied": r["replied"],
                      "open_rate": _rate(r["opened"], r["sent"]), "reply_rate": _rate(r["replied"], r["sent"])}
                     for r in (cr or [])]

        return {"overview": overview, "timeseries": timeseries, "personas": personas,
                "segments": segments, "campaigns": campaigns}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to build analytics: {e}")

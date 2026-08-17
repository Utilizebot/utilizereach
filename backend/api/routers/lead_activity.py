"""Lead activity timeline — every email + engagement + reply for one lead.

Registered BEFORE the leads router so /api/leads/activity is not shadowed by
the leads router's /{lead_id} route.
"""
from fastapi import APIRouter, HTTPException, Query
from database.pg import execute_sql

router = APIRouter(prefix="/api/leads", tags=["lead-activity"])


@router.get("/activity")
async def lead_activity(email: str = Query(...)):
    em = (email or "").strip().lower()
    if not em:
        raise HTTPException(status_code=400, detail="email is required")
    try:
        lr = execute_sql(
            "SELECT decision_maker_name AS name, email, company_name AS company, "
            "decision_maker_title AS title, segment, status FROM scraped_leads "
            "WHERE lower(email)=%s LIMIT 1", [em])
        lead = lr[0] if lr else None

        emails = execute_sql(
            "SELECT id, from_email, subject, sent_at, opened_at, clicked_at, replied_at, "
            "bounced_at, campaign_id, variant FROM sent_emails "
            "WHERE lower(recipient_email)=%s ORDER BY sent_at ASC", [em])

        if lead is None and emails:
            lead = {"name": None, "email": em, "company": None, "title": None,
                    "segment": None, "status": "contacted"}

        reps = execute_sql(
            "SELECT er.from_email, er.subject, er.body_text, er.received_at "
            "FROM email_replies er JOIN sent_emails se ON se.id=er.sent_email_id "
            "WHERE lower(se.recipient_email)=%s ORDER BY er.received_at ASC", [em])

        timeline = []
        for e in emails:
            persona = (e.get("from_email") or "").split("@")[0]
            subj = e.get("subject") or ""
            timeline.append({"type": "sent", "at": e.get("sent_at"), "persona": persona, "subject": subj, "detail": None})
            if e.get("bounced_at"):
                timeline.append({"type": "bounced", "at": e.get("bounced_at"), "persona": persona, "subject": subj, "detail": None})
            else:
                if e.get("opened_at"):
                    timeline.append({"type": "opened", "at": e.get("opened_at"), "persona": persona, "subject": subj, "detail": None})
                if e.get("clicked_at"):
                    timeline.append({"type": "clicked", "at": e.get("clicked_at"), "persona": persona, "subject": subj, "detail": None})
        for r in reps:
            timeline.append({"type": "replied", "at": r.get("received_at"),
                             "persona": (r.get("from_email") or "").split("@")[0],
                             "subject": r.get("subject") or "", "detail": (r.get("body_text") or "")[:400]})

        timeline = [t for t in timeline if t.get("at")]
        timeline.sort(key=lambda t: str(t["at"]))

        stats = {
            "emails": len(emails),
            "opens": sum(1 for e in emails if e.get("opened_at") and not e.get("bounced_at")),
            "clicks": sum(1 for e in emails if e.get("clicked_at") and not e.get("bounced_at")),
            "replies": len(reps),
            "bounces": sum(1 for e in emails if e.get("bounced_at")),
        }
        return {"lead": lead, "stats": stats, "timeline": timeline}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load activity: {e}")

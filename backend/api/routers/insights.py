"""
Outbound performance insights + AI-generated recommendations.

/api/insights/performance      — live breakdowns (AI vs template, best account,
                                  best subjects, best segment) computed from sent_emails.
/api/insights/recommendations  — feeds those breakdowns to the configured LLM and
                                  returns concrete, data-grounded suggestions.
"""
import json
import re
from fastapi import APIRouter, HTTPException

from database.pg import execute_sql

router = APIRouter(prefix="/api/insights", tags=["insights"])


def _perf() -> dict:
    ai_vs_template = execute_sql(
        "SELECT CASE WHEN variant='AI' THEN 'AI intro' WHEN variant LIKE 'F%%' THEN 'AI follow-up' "
        "WHEN campaign_id IS NULL THEN 'Template drip' WHEN variant IN ('A','B') THEN 'Template A/B' ELSE 'Other' END kind, "
        "count(*) sent, round(count(opened_at)*100.0/count(*),1) open_rate, "
        "round(count(replied_at)*100.0/count(*),1) reply_rate, round(count(bounced_at)*100.0/count(*),1) bounce_rate "
        "FROM sent_emails GROUP BY 1 ORDER BY open_rate DESC") or []
    accounts = execute_sql(
        "SELECT from_email, count(*) sent, round(count(opened_at)*100.0/count(*),1) open_rate, "
        "round(count(replied_at)*100.0/count(*),1) reply_rate FROM sent_emails "
        "WHERE campaign_id IS NOT NULL AND from_email IS NOT NULL "
        "GROUP BY from_email HAVING count(*)>=5 ORDER BY open_rate DESC") or []
    subjects = execute_sql(
        "SELECT subject, count(*) sent, round(count(opened_at)*100.0/count(*),1) open_rate FROM sent_emails "
        "WHERE subject IS NOT NULL AND subject<>'' GROUP BY subject HAVING count(*)>=8 ORDER BY open_rate DESC LIMIT 12") or []
    segments = execute_sql(
        "SELECT c.segment, count(*) sent, round(count(se.opened_at)*100.0/count(*),1) open_rate, "
        "round(count(se.replied_at)*100.0/count(*),1) reply_rate FROM sent_emails se JOIN campaigns c ON c.id=se.campaign_id "
        "WHERE c.segment IS NOT NULL GROUP BY c.segment ORDER BY open_rate DESC") or []
    overall = execute_sql(
        "SELECT count(*) sent, round(count(opened_at)*100.0/NULLIF(count(*),0),1) open_rate, "
        "round(count(replied_at)*100.0/NULLIF(count(*),0),1) reply_rate, "
        "round(count(bounced_at)*100.0/NULLIF(count(*),0),1) bounce_rate FROM sent_emails")
    return {
        "ai_vs_template": ai_vs_template, "accounts": accounts, "subjects": subjects,
        "segments": segments, "overall": (overall[0] if overall else {}),
    }


@router.get("/performance")
async def performance():
    try:
        return _perf()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load performance: {e}")


def _prompt(d: dict) -> str:
    return (
        "You are a senior B2B cold-email deliverability and outreach strategist.\n"
        "The campaign is cold B2B outreach sent from multiple sender personas on one mailbox.\n\n"
        "Analyse this LIVE performance data and recommend how to improve results.\n\n"
        f"PERFORMANCE DATA (JSON):\n{json.dumps(d, default=str)}\n\n"
        "Rules:\n"
        "- Ground EVERY recommendation in the actual numbers above and cite them.\n"
        "- Optimise for open rate, reply rate, and deliverability (bounce rate).\n"
        "- Be specific and concrete: name the persona, subject angle, segment, or email type.\n"
        "- Open rate is the reliable signal at this volume; reply data is still thin — don't over-index on it.\n"
        "- Return ONLY a JSON array (no prose, no markdown fences) of 4 to 6 objects, each exactly:\n"
        '  {"title": "6 words max", "detail": "1-2 sentences citing the numbers", "impact": "high" | "medium" | "low"}'
    )


def _parse(text: str) -> list:
    t = (text or "").strip()
    t = re.sub(r"```(?:json)?", "", t).replace("```", "").strip()
    m = re.search(r"\[.*\]", t, re.DOTALL)
    if m:
        t = m.group(0)
    try:
        arr = json.loads(t)
    except Exception:
        return []
    out = []
    for x in arr if isinstance(arr, list) else []:
        if isinstance(x, dict) and x.get("title"):
            imp = str(x.get("impact", "medium")).lower()
            out.append({
                "title": str(x.get("title", ""))[:80],
                "detail": str(x.get("detail", "")),
                "impact": imp if imp in ("high", "medium", "low") else "medium",
            })
    return out


@router.get("/recommendations")
async def recommendations():
    try:
        data = _perf()
        from integrations.llm_client import get_llm_client
        client = get_llm_client()
        text, _ = client._complete(_prompt(data), max_tokens=1500)
        recs = _parse(text)
        if not recs:
            raise HTTPException(status_code=502, detail="The AI returned no parseable recommendations — try again.")
        return {"recommendations": recs, "based_on_sent": (data.get("overall") or {}).get("sent")}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate recommendations: {e}")


_EXPLAIN = {
    "AI intro": "The first email of an AI campaign — written fresh for each lead by the AI from the campaign brief (not a fixed template). It infers the recipient's likely industry from their company name and adapts the copy per person.",
    "Template A/B": "Two hand-written template emails, variant A and B — the SAME body with two different subject lines, split evenly to A/B-test the subject. Not AI-generated: the same copy goes to everyone in the campaign.",
    "AI follow-up": "AI-written follow-up emails (F1 / F2 / F3), sent a few days after the intro when the contact hasn't replied — now gated to contacts who opened or clicked.",
    "Template drip": "The old generic template blast — sent by the now-disabled background scheduler to the shareholder list, bypassing the AI campaigns and pacing. Shown here for comparison.",
}


def _sample_filter(dim: str, value: str):
    if dim == "type":
        return {
            "AI intro": ("variant = %s", ["AI"]),
            "Template A/B": ("variant IN ('A','B')", []),
            "AI follow-up": ("variant LIKE 'F%%'", []),
            "Template drip": ("campaign_id IS NULL", []),
        }.get(value, ("1=1", []))
    if dim == "account":
        return ("from_email = %s AND campaign_id IS NOT NULL", [value])
    if dim == "subject":
        return ("subject = %s", [value])
    if dim == "segment":
        return ("campaign_id IN (SELECT id FROM campaigns WHERE segment = %s)", [value])
    if dim == "status":
        return {
            "opened": ("opened_at IS NOT NULL", []),
            "clicked": ("clicked_at IS NOT NULL", []),
            "replied": ("replied_at IS NOT NULL", []),
            "bounced": ("bounced_at IS NOT NULL", []),
            "sent": ("1=1", []),
        }.get(value, ("1=1", []))
    return ("1=1", [])


@router.get("/samples")
async def samples(dim: str, value: str, limit: int = 6):
    """Drill-down: a plain-English explanation + a few real sample emails for one
    slice of the report (a type / persona / subject / segment)."""
    try:
        where, params = _sample_filter(dim, value)
        lim = max(1, min(limit, 12))
        rows = execute_sql(
            "SELECT recipient_name, recipient_email, from_email, subject, variant, sent_at, "
            "left(regexp_replace(regexp_replace(COALESCE(body_html, body_text, ''),'<[^>]+>',' ','g'),'[[:space:]]+',' ','g'),260) preview, "
            "opened_at, clicked_at, replied_at, bounced_at "
            f"FROM sent_emails WHERE {where} "
            "ORDER BY (replied_at IS NOT NULL) DESC, (opened_at IS NOT NULL) DESC, sent_at DESC LIMIT %s",
            params + [lim]) or []
        st = execute_sql(
            "SELECT count(*) sent, round(count(opened_at)*100.0/NULLIF(count(*),0),1) open_rate, "
            "round(count(replied_at)*100.0/NULLIF(count(*),0),1) reply_rate, "
            "round(count(bounced_at)*100.0/NULLIF(count(*),0),1) bounce_rate "
            f"FROM sent_emails WHERE {where}", params)
        if dim == "type":
            explain = _EXPLAIN.get(value, "")
        elif dim == "account":
            explain = f"Emails sent from the {value.split('@')[0].title()} persona (alias {value})."
        elif dim == "subject":
            explain = "Every send that used this exact subject line."
        elif dim == "segment":
            explain = f"Emails sent to leads in the '{value}' segment."
        elif dim == "status":
            explain = {
                "opened": "Emails that were opened (the tracking pixel loaded).",
                "clicked": "Emails where the recipient clicked a link.",
                "replied": "Emails that received a reply.",
                "bounced": "Emails that hard-bounced — the address rejected them.",
                "sent": "All emails sent.",
            }.get(value, "")
        else:
            explain = ""
        out = [{
            "recipient_name": r.get("recipient_name"), "recipient_email": r.get("recipient_email"),
            "from_email": r.get("from_email"), "subject": r.get("subject"),
            "preview": (r.get("preview") or "").strip(), "variant": r.get("variant"), "sent_at": r.get("sent_at"),
            "opened": bool(r.get("opened_at")), "clicked": bool(r.get("clicked_at")),
            "replied": bool(r.get("replied_at")), "bounced": bool(r.get("bounced_at")),
        } for r in rows]
        return {"dim": dim, "value": value, "explain": explain, "stats": (st[0] if st else {}), "samples": out}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load samples: {e}")

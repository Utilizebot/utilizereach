"""
Outbound performance insights + AI-generated recommendations.

/api/insights/performance      — live breakdowns (AI vs template, best account,
                                  best subjects, best segment) computed from sent_emails.
/api/insights/recommendations  — feeds those breakdowns to the configured LLM and
                                  returns concrete, data-grounded suggestions.
"""
import json
import re
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from database.pg import execute_sql
from database import tenancy
from database import brands as brand_catalog
from api.dependencies import require_permission

router = APIRouter(prefix="/api/insights", tags=["insights"])

# Every raw query below is scoped to the ACTIVE brand explicitly (brand_id = %s
# on every tenant table), per docs/MULTIBRAND.md rule 2.


def _perf() -> dict:
    b = tenancy.require_brand()
    ai_vs_template = execute_sql(
        "SELECT CASE WHEN variant='AI' THEN 'AI intro' WHEN variant LIKE 'F%%' THEN 'AI follow-up' "
        "WHEN campaign_id IS NULL THEN 'Template drip' WHEN variant IN ('A','B') THEN 'Template A/B' ELSE 'Other' END kind, "
        "count(*) sent, round(count(opened_at)*100.0/count(*),1) open_rate, "
        "round(count(replied_at)*100.0/count(*),1) reply_rate, round(count(bounced_at)*100.0/count(*),1) bounce_rate "
        "FROM sent_emails WHERE brand_id = %s GROUP BY 1 ORDER BY open_rate DESC", [b]) or []
    accounts = execute_sql(
        "SELECT from_email, count(*) sent, round(count(opened_at)*100.0/count(*),1) open_rate, "
        "round(count(replied_at)*100.0/count(*),1) reply_rate FROM sent_emails "
        "WHERE brand_id = %s AND campaign_id IS NOT NULL AND from_email IS NOT NULL "
        "GROUP BY from_email HAVING count(*)>=5 ORDER BY open_rate DESC", [b]) or []
    subjects = execute_sql(
        "SELECT subject, count(*) sent, round(count(opened_at)*100.0/count(*),1) open_rate FROM sent_emails "
        "WHERE brand_id = %s AND subject IS NOT NULL AND subject<>'' "
        "GROUP BY subject HAVING count(*)>=8 ORDER BY open_rate DESC LIMIT 12", [b]) or []
    segments = execute_sql(
        "SELECT c.segment, count(*) sent, round(count(se.opened_at)*100.0/count(*),1) open_rate, "
        "round(count(se.replied_at)*100.0/count(*),1) reply_rate FROM sent_emails se "
        "JOIN campaigns c ON c.id=se.campaign_id AND c.brand_id=se.brand_id "
        "WHERE se.brand_id = %s AND c.brand_id = %s AND c.segment IS NOT NULL "
        "GROUP BY c.segment ORDER BY open_rate DESC", [b, b]) or []
    overall = execute_sql(
        "SELECT count(*) sent, round(count(opened_at)*100.0/NULLIF(count(*),0),1) open_rate, "
        "round(count(replied_at)*100.0/NULLIF(count(*),0),1) reply_rate, "
        "round(count(bounced_at)*100.0/NULLIF(count(*),0),1) bounce_rate FROM sent_emails WHERE brand_id = %s", [b])
    by_owner = execute_sql(
        "SELECT owner, count(*) sent, round(count(opened_at)*100.0/count(*),1) open_rate, "
        "round(count(replied_at)*100.0/count(*),1) reply_rate FROM sent_emails "
        "WHERE brand_id = %s AND owner IS NOT NULL AND owner<>'' "
        "GROUP BY owner ORDER BY open_rate DESC, sent DESC LIMIT 15", [b]) or []
    by_account_manager = execute_sql(
        "SELECT account_manager, count(*) sent, round(count(opened_at)*100.0/count(*),1) open_rate, "
        "round(count(replied_at)*100.0/count(*),1) reply_rate FROM sent_emails "
        "WHERE brand_id = %s AND account_manager IS NOT NULL AND account_manager<>'' "
        "GROUP BY account_manager ORDER BY open_rate DESC, sent DESC LIMIT 15", [b]) or []
    return {
        "ai_vs_template": ai_vs_template, "accounts": accounts, "subjects": subjects,
        "segments": segments, "by_owner": by_owner, "by_account_manager": by_account_manager,
        "overall": (overall[0] if overall else {}),
    }


@router.get("/performance")
async def performance():
    try:
        return _perf()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load performance: {e}")


# Used when the active brand has not described its company yet (the original
# single-brand wording).
_GENERIC_CONTEXT = (
    "The campaign is cold B2B outreach sent from multiple sender personas on one mailbox.\n\n"
)


def _one_line(text: Optional[str], limit: int = 600) -> str:
    t = re.sub(r"\s+", " ", str(text or "")).strip()
    return t[:limit]


def _product_context() -> str:
    """What the active brand sells / how it sends, for the recommendations prompt.

    Every brand (including the default one) is described from its own
    email_ai_settings company fields (auto-scoped to the active brand) and
    its brand catalog row. A brand with no company info yet gets a generic
    one-liner - never another brand's description.
    """
    brand_id = tenancy.require_brand()
    brand = brand_catalog.get_brand(brand_id) or {}
    branding = brand.get("branding") or {}
    company_cfg = branding.get("company") or {}
    settings = {}
    try:
        from database.client import get_supabase_admin_client
        res = get_supabase_admin_client().table("email_ai_settings").select("*").limit(1).execute()
        settings = (res.data or [{}])[0] or {}
    except Exception as e:
        print(f"[insights] could not load email_ai_settings for brand {brand_id}: {e}")

    placeholder_names = {"your company", "your company name", "default brand", "default"}
    name = _one_line(settings.get("company_name"), 120)
    if not name or name.lower() in placeholder_names:
        name = _one_line(company_cfg.get("name") or brand.get("display_name") or "", 120)
    if name.lower() in placeholder_names:
        name = ""
    tagline = _one_line(settings.get("company_tagline"), 300)
    if tagline.lower() in ("your company tagline", "your company tagline here"):
        tagline = ""
    services = _one_line((settings.get("company_services") or "").replace("\n", "; ").lstrip("-; "), 600)
    if services.lower().startswith(("service 1", "your service or product 1")):
        services = ""
    industry = _one_line(company_cfg.get("industry"), 120)
    website = _one_line(brand.get("website_domain") or company_cfg.get("website"), 200)

    if not (name or tagline or services):
        return _GENERIC_CONTEXT

    first = name or "The company"
    if website and website.lower() not in name.lower():
        first += f" ({website})"
    first += f" — {tagline}" if tagline else (f" — {industry}" if industry else "")
    parts = [first.rstrip(". ") + "."]
    if services:
        parts.append(f"Offering: {services.rstrip('. ')}.")
    team = (branding.get("emailTeam") or []) if isinstance(branding.get("emailTeam"), list) else []
    if team:
        parts.append(f"The outreach is sent from {len(team)} persona aliases.")
    return " ".join(parts) + "\n\n"


def _prompt(d: dict, context: Optional[str] = None) -> str:
    return (
        "You are a senior B2B cold-email deliverability and outreach strategist.\n"
        + (context if context is not None else _product_context())
        + "Analyse this LIVE performance data and recommend how to improve results.\n\n"
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
        # sub-select scoped to the active brand too (rule 2: every tenant table)
        return ("campaign_id IN (SELECT id FROM campaigns WHERE segment = %s AND brand_id = %s)",
                [value, tenancy.require_brand()])
    if dim == "owner":
        return ("owner = %s", [value])
    if dim == "am":
        return ("account_manager = %s", [value])
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
        b = tenancy.require_brand()
        where, params = _sample_filter(dim, value)
        lim = max(1, min(limit, 12))
        rows = execute_sql(
            "SELECT recipient_name, recipient_email, from_email, subject, variant, sent_at, "
            "left(regexp_replace(regexp_replace(COALESCE(body_html, body_text, ''),'<[^>]+>',' ','g'),'[[:space:]]+',' ','g'),260) preview, "
            "opened_at, clicked_at, replied_at, bounced_at "
            f"FROM sent_emails WHERE brand_id = %s AND ({where}) "
            "ORDER BY (replied_at IS NOT NULL) DESC, (opened_at IS NOT NULL) DESC, sent_at DESC LIMIT %s",
            [b] + params + [lim]) or []
        st = execute_sql(
            "SELECT count(*) sent, round(count(opened_at)*100.0/NULLIF(count(*),0),1) open_rate, "
            "round(count(replied_at)*100.0/NULLIF(count(*),0),1) reply_rate, "
            "round(count(bounced_at)*100.0/NULLIF(count(*),0),1) bounce_rate "
            f"FROM sent_emails WHERE brand_id = %s AND ({where})", [b] + params)
        if dim == "type":
            explain = _EXPLAIN.get(value, "")
        elif dim == "account":
            explain = f"Emails sent from the {value.split('@')[0].title()} persona (alias {value})."
        elif dim == "subject":
            explain = "Every send that used this exact subject line."
        elif dim == "segment":
            explain = f"Emails sent to leads in the '{value}' segment."
        elif dim == "owner":
            explain = f"Emails to leads owned by '{value}' (the person/collector who contributed them)."
        elif dim == "am":
            explain = f"Emails on campaigns run by account manager '{value}'."
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


class OwnerAssign(BaseModel):
    owner: str
    segment: Optional[str] = None
    lead_ids: List[str] = []


@router.post("/assign-owner")
async def assign_owner(payload: OwnerAssign,
                       _perm: dict = Depends(require_permission("leads.assign"))):
    """Assign a lead owner — by segment (bulk) and/or explicit lead ids."""
    try:
        owner = (payload.owner or "").strip()
        if not owner:
            raise HTTPException(status_code=400, detail="owner is required")
        b = tenancy.require_brand()
        n = 0
        if payload.segment:
            r = execute_sql("UPDATE scraped_leads SET owner=%s WHERE segment=%s AND brand_id=%s RETURNING id",
                            [owner, payload.segment, b])
            n += len(r or [])
        if payload.lead_ids:
            ph = ",".join(["%s"] * len(payload.lead_ids))
            r = execute_sql(f"UPDATE scraped_leads SET owner=%s WHERE id IN ({ph}) AND brand_id=%s RETURNING id",
                            [owner] + payload.lead_ids + [b])
            n += len(r or [])
        return {"success": True, "updated": n, "owner": owner}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to assign owner: {e}")


@router.get("/segments")
async def segment_list():
    """Distinct lead segments + their current owner, for the assign-owner picker."""
    try:
        rows = execute_sql(
            "SELECT segment, max(owner) owner, count(*) leads FROM scraped_leads "
            "WHERE brand_id = %s AND segment IS NOT NULL AND segment<>'' "
            "GROUP BY segment ORDER BY leads DESC", [tenancy.require_brand()]) or []
        return {"segments": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list segments: {e}")

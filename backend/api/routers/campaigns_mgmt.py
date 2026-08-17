"""
Campaign management + monitoring (A/B).

A campaign targets a segment, carries A/B email variants, and is sent by the
paced warmup sender (which tags each send with campaign_id + variant). All
stats here are computed live from sent_emails so they are always accurate.

Routes use explicit sub-paths (/list, /create, /detail/{id}) so they never
clash with the existing campaigns router (/start, /status).
"""
import re
from typing import Optional, List
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from database.client import get_supabase_admin_client
from database.pg import execute_sql

router = APIRouter(prefix="/api/campaigns", tags=["campaigns-mgmt"])


class Variant(BaseModel):
    label: str                 # "A", "B", ...
    subject: str
    body: str                  # HTML; {first_name} / {company} placeholders allowed


class Followup(BaseModel):
    after_days: int = 4
    subject: str
    body: str


class CampaignCreate(BaseModel):
    name: str
    description: Optional[str] = None
    segment: Optional[str] = None       # target segment key
    target_count: int = 100
    daily_cap: int = 20
    variants: List[Variant] = []
    followups: List[Followup] = []
    status: str = "active"              # active | draft | paused


def _stats_row(cid: str) -> dict:
    rows = execute_sql(
        "SELECT count(*) sent, "
        "count(opened_at) opened, count(clicked_at) clicked, count(replied_at) replied, "
        "count(bounced_at) bounced "
        "FROM sent_emails WHERE campaign_id = %s", [cid])
    r = rows[0] if rows else {}
    sent = r.get("sent", 0) or 0
    def pct(n): return round((n or 0) / sent * 100, 1) if sent else 0.0
    return {
        "sent": sent, "opened": r.get("opened", 0) or 0, "clicked": r.get("clicked", 0) or 0,
        "replied": r.get("replied", 0) or 0, "bounced": r.get("bounced", 0) or 0,
        "open_rate": pct(r.get("opened")), "click_rate": pct(r.get("clicked")),
        "reply_rate": pct(r.get("replied")),
    }


@router.get("/list")
async def list_campaigns():
    """All campaigns with live headline stats + progress."""
    try:
        sb = get_supabase_admin_client()
        res = sb.table("campaigns").select("*").order("created_at", desc=True).execute()
        out = []
        for c in (res.data or []):
            s = _stats_row(c["id"])
            target = c.get("target_count") or 0
            out.append({
                "id": c["id"], "name": c["name"], "description": c.get("description"),
                "segment": c.get("segment"), "status": c.get("status", "draft"),
                "target_count": target, "daily_cap": c.get("daily_cap"),
                "variant_count": len(c.get("variants") or []),
                "created_at": c.get("created_at"),
                "progress": round(s["sent"] / target * 100, 1) if target else 0.0,
                **s,
            })
        return {"campaigns": out, "total": len(out)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list campaigns: {e}")


@router.get("/detail/{cid}")
async def campaign_detail(cid: str):
    """One campaign: headline stats + per-variant A/B + per-persona + recent sends."""
    try:
        sb = get_supabase_admin_client()
        res = sb.table("campaigns").select("*").eq("id", cid).execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Campaign not found")
        c = res.data[0]

        # per-variant A/B
        vrows = execute_sql(
            "SELECT COALESCE(variant,'(none)') variant, count(*) sent, "
            "count(opened_at) opened, count(clicked_at) clicked, count(replied_at) replied "
            "FROM sent_emails WHERE campaign_id=%s GROUP BY 1 ORDER BY 1", [cid])
        def pct(n, d): return round((n or 0) / d * 100, 1) if d else 0.0
        variants_stats = [{
            "variant": r["variant"], "sent": r["sent"], "opened": r["opened"],
            "clicked": r["clicked"], "replied": r["replied"],
            "open_rate": pct(r["opened"], r["sent"]), "click_rate": pct(r["clicked"], r["sent"]),
            "reply_rate": pct(r["replied"], r["sent"]),
        } for r in (vrows or [])]

        # per-persona
        prows = execute_sql(
            "SELECT from_email, count(*) sent, count(opened_at) opened, count(replied_at) replied "
            "FROM sent_emails WHERE campaign_id=%s GROUP BY 1 ORDER BY 2 DESC", [cid])
        personas = [{
            "from_email": r["from_email"], "sent": r["sent"], "opened": r["opened"],
            "replied": r["replied"], "open_rate": pct(r["opened"], r["sent"]),
        } for r in (prows or [])]

        # recent sends
        recent = execute_sql(
            "SELECT id, recipient_name, recipient_email, from_email, subject, variant, status, "
            "sent_at, opened_at, clicked_at, replied_at FROM sent_emails "
            "WHERE campaign_id=%s ORDER BY sent_at DESC LIMIT 50", [cid])

        # follow-up sends (variant starts with 'F')
        fu = execute_sql("SELECT count(*) n FROM sent_emails WHERE campaign_id=%s AND variant LIKE 'F%%'", [cid])
        followup_sent = (fu[0]["n"] if fu else 0) or 0

        return {
            "campaign": {
                "id": c["id"], "name": c["name"], "description": c.get("description"),
                "segment": c.get("segment"), "status": c.get("status"),
                "target_count": c.get("target_count"), "daily_cap": c.get("daily_cap"),
                "variants": c.get("variants") or [], "followups": c.get("followups") or [],
                "created_at": c.get("created_at"),
            },
            "stats": _stats_row(cid),
            "variants_stats": variants_stats,
            "personas": personas,
            "followup_sent": followup_sent,
            "recent": recent or [],
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load campaign: {e}")


@router.post("/create")
async def create_campaign(payload: CampaignCreate):
    try:
        sb = get_supabase_admin_client()
        # normalize variant labels A, B, C...
        variants = []
        for i, v in enumerate(payload.variants):
            variants.append({"label": v.label or chr(65 + i), "subject": v.subject, "body": v.body})
        row = {
            "name": payload.name.strip(),
            "description": payload.description,
            "segment": payload.segment,
            "target_count": payload.target_count,
            "daily_cap": payload.daily_cap,
            "variants": variants,
            "followups": [f.dict() for f in payload.followups],
            "status": payload.status,
        }
        row = {k: v for k, v in row.items() if v is not None}
        created = sb.table("campaigns").insert(row).execute()
        return {"success": True, "campaign": created.data[0]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create campaign: {e}")


@router.post("/{cid}/set-status")
async def set_status(cid: str, body: dict):
    status = (body or {}).get("status")
    if status not in ("active", "paused", "draft", "completed"):
        raise HTTPException(status_code=400, detail="Invalid status")
    try:
        sb = get_supabase_admin_client()
        res = sb.table("campaigns").update({"status": status}).eq("id", cid).execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Campaign not found")
        return {"success": True, "campaign": res.data[0]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to set status: {e}")


@router.delete("/remove/{cid}")
async def remove_campaign(cid: str):
    try:
        sb = get_supabase_admin_client()
        # detach sends (keep them, just clear the link)
        execute_sql("UPDATE sent_emails SET campaign_id=NULL WHERE campaign_id=%s", [cid])
        sb.table("campaigns").delete().eq("id", cid).execute()
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete campaign: {e}")

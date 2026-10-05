"""
Tracking Router (PUBLIC — no auth)

Form-funnel tracking endpoints used by anonymous visitors on the public
form pages. Mirrors the direct Supabase writes the browser used to do
(form_sessions / tracking_events / form_steps / form_responses).

Multi-brand: every endpoint depends on public_brand_scope, which binds the
brand that owns the request Host (else brand 1) - never a brand from the
body. Inserts are therefore stamped with that brand and lookups by
session_id only ever see that brand's rows (the composite
(session_id, brand_id) foreign keys reject events/steps/responses that point
at another brand's session).
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Any, Dict, List, Optional
import sys
import os

# Add parent directory to import path
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from database.client import get_supabase_client
from database.pg import execute_sql
from database.tenancy import system_scope
from api.dependencies import public_brand_scope

router = APIRouter(prefix="/api/tracking", tags=["tracking"])


def _session_owner(session_id: str):
    """brand_id that owns `session_id` (session ids are globally unique), or None.

    Trusted existence check only (system scope); nothing from another brand is
    ever returned to the caller.
    """
    with system_scope():
        rows = execute_sql(
            "SELECT brand_id FROM form_sessions WHERE session_id = %s LIMIT 1", [session_id]
        )
    return str(rows[0]["brand_id"]) if rows else None


class SessionUpsert(BaseModel):
    session_id: str
    utm_source: Optional[str] = None
    utm_medium: Optional[str] = None
    utm_campaign: Optional[str] = None
    utm_content: Optional[str] = None
    sales_rep_name: Optional[str] = None
    sales_rep_id: Optional[str] = None
    user_agent: Optional[str] = None
    ip_address: Optional[str] = None
    referrer: Optional[str] = None
    landing_page: Optional[str] = None
    device_type: Optional[str] = None
    browser: Optional[str] = None
    os: Optional[str] = None
    screen_resolution: Optional[str] = None
    viewport_size: Optional[str] = None
    timezone: Optional[str] = None
    language: Optional[str] = None
    country: Optional[str] = None
    status: Optional[str] = None
    completed_at: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class SessionPatch(BaseModel):
    status: Optional[str] = None
    completed_at: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class EventCreate(BaseModel):
    session_id: str
    event_type: str
    event_data: Optional[Dict[str, Any]] = None
    step_number: Optional[int] = None
    time_since_start: Optional[int] = None


class StepEntry(BaseModel):
    session_id: str
    step_number: int
    step_name: Optional[str] = None
    answers: Optional[Dict[str, Any]] = None


class StepExit(BaseModel):
    session_id: str
    step_number: int
    answers: Optional[Dict[str, Any]] = None


class ResponseCreate(BaseModel):
    session_id: str
    industry: Optional[str] = None
    challenge: Optional[str] = None
    automation_level: Optional[str] = None
    facility_size: Optional[str] = None
    solutions_interest: Optional[List[str]] = None
    timeline: Optional[str] = None
    full_name: Optional[str] = None
    organization: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    contact_method: Optional[str] = None
    notes: Optional[str] = None


@router.post("/sessions")
async def upsert_session(request: SessionUpsert, brand: dict = Depends(public_brand_scope)):
    """
    Create or update a form session (UPSERT ON CONFLICT session_id).
    Only fields present in the request are written, so partial upserts
    (e.g. per-step progress from ExecutiveForm) don't wipe other columns.
    """
    payload = {k: v for k, v in request.model_dump().items() if v is not None}
    try:
        # session_id is globally unique: never let one brand's site overwrite
        # (or take over) a session that belongs to another brand.
        owner = _session_owner(request.session_id)
        if owner and owner != str(brand["id"]):
            raise HTTPException(status_code=409, detail="Session id already in use")
        client = get_supabase_client()
        result = (
            client.table("form_sessions")
            .upsert(payload, on_conflict="session_id")
            .execute()
        )
        return result.data[0] if result.data else {}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upsert session: {str(e)}")


@router.patch("/sessions/{session_id}")
async def update_session(session_id: str, request: SessionPatch,
                         brand: dict = Depends(public_brand_scope)):
    """Update session status/completed_at/metadata"""
    updates = {k: v for k, v in request.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    try:
        client = get_supabase_client()
        result = (
            client.table("form_sessions")
            .update(updates)
            .eq("session_id", session_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update session: {str(e)}")
    if not result.data:
        raise HTTPException(status_code=404, detail="Session not found")
    return result.data[0]


@router.post("/events")
async def create_event(request: EventCreate, brand: dict = Depends(public_brand_scope)):
    """Insert a tracking event (clicks, tab switches, website_click...)"""
    payload = {k: v for k, v in request.model_dump().items() if v is not None}
    try:
        client = get_supabase_client()
        result = client.table("tracking_events").insert(payload).execute()
        return result.data[0] if result.data else {}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to track event: {str(e)}")


@router.post("/steps")
async def create_step(request: StepEntry, brand: dict = Depends(public_brand_scope)):
    """Track a form step entry (entered_at defaults to now())"""
    payload = {k: v for k, v in request.model_dump().items() if v is not None}
    try:
        client = get_supabase_client()
        result = client.table("form_steps").insert(payload).execute()
        return result.data[0] if result.data else {}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to track step entry: {str(e)}")


@router.post("/steps/exit")
async def exit_step(request: StepExit, brand: dict = Depends(public_brand_scope)):
    """
    Close the latest open form_steps row for this session+step:
    sets exited_at, time_spent (seconds) and optionally answers.
    """
    try:
        client = get_supabase_client()
        found = (
            client.table("form_steps")
            .select("*")
            .eq("session_id", request.session_id)
            .eq("step_number", request.step_number)
            .is_("exited_at", None)
            .order("entered_at", desc=True)
            .limit(1)
            .execute()
        )
        if not found.data:
            return {"found": False}

        step = found.data[0]
        exited_at = datetime.now(timezone.utc)
        entered_at = datetime.fromisoformat(step["entered_at"])
        if entered_at.tzinfo is None:
            entered_at = entered_at.replace(tzinfo=timezone.utc)
        time_spent = int((exited_at - entered_at).total_seconds())

        updates = {
            "exited_at": exited_at.isoformat(),
            "time_spent": time_spent,
        }
        if request.answers is not None:
            updates["answers"] = request.answers

        result = (
            client.table("form_steps")
            .update(updates)
            .eq("id", step["id"])
            .execute()
        )
        return result.data[0] if result.data else {"found": False}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to track step exit: {str(e)}")


@router.post("/responses")
async def create_response(request: ResponseCreate, brand: dict = Depends(public_brand_scope)):
    """
    Insert a form response. A DB trigger marks the matching
    form_sessions row as completed.
    """
    payload = {k: v for k, v in request.model_dump().items() if v is not None}
    try:
        client = get_supabase_client()
        result = client.table("form_responses").insert(payload).execute()
        return result.data[0] if result.data else {}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to submit response: {str(e)}")

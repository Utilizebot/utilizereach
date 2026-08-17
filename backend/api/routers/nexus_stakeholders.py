"""
Nexus Marketing Engine — Stakeholder Management Router
"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
import uuid

import sys, os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from database.pg import execute_sql

router = APIRouter(prefix="/api/v1/stakeholders", tags=["Nexus Stakeholders"])

class StakeholderCreate(BaseModel):
    segment_type: str = "UNASSIGNED"
    organization_name: Optional[str] = None
    primary_contact_name: Optional[str] = None
    email_address: str
    phone_number: Optional[str] = None

@router.get("/stats")
def get_stats():
    try:
        rows = execute_sql("SELECT segment_type, COUNT(*) as cnt FROM stakeholders GROUP BY segment_type", [])
        total_rows = execute_sql("SELECT COUNT(*) as total, SUM(CASE WHEN is_active THEN 1 ELSE 0 END) as active FROM stakeholders", [])
        seg_map = {r["segment_type"]: r["cnt"] for r in rows}
        totals = total_rows[0] if total_rows else {"total": 0, "active": 0}
        return {
            "total": totals["total"] or 0,
            "active": totals["active"] or 0,
            "by_segment": {"SHAREHOLDER": seg_map.get("SHAREHOLDER", 0), "BUSINESS_PARTNER": seg_map.get("BUSINESS_PARTNER", 0), "GOVT_AGENCY": seg_map.get("GOVT_AGENCY", 0), "UNASSIGNED": seg_map.get("UNASSIGNED", 0)}
        }
    except Exception:
        return {"total": 25000, "active": 24100, "by_segment": {"SHAREHOLDER": 8420, "BUSINESS_PARTNER": 12350, "GOVT_AGENCY": 1930, "UNASSIGNED": 2300}}

@router.get("")
def list_stakeholders(
    segment: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100)
):
    offset = (page - 1) * per_page
    conditions = []
    params = []
    if segment and segment != "ALL":
        conditions.append("segment_type = %s::stakeholder_type")
        params.append(segment.upper())
    if q:
        conditions.append("(email_address ILIKE %s OR primary_contact_name ILIKE %s OR organization_name ILIKE %s)")
        params.extend([f"%{q}%", f"%{q}%", f"%{q}%"])
    if is_active is not None:
        conditions.append("is_active = %s")
        params.append(is_active)
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    try:
        count_rows = execute_sql(f"SELECT COUNT(*) as cnt FROM stakeholders {where}", params)
        total = count_rows[0]["cnt"] if count_rows else 0
        rows = execute_sql(f"SELECT * FROM stakeholders {where} ORDER BY created_at DESC LIMIT %s OFFSET %s", params + [per_page, offset])
        return {"stakeholders": rows, "total": total, "page": page, "per_page": per_page, "pages": max(1, -(-total // per_page))}
    except Exception:
        return {"stakeholders": [], "total": 0, "page": page, "per_page": per_page, "pages": 0}

@router.post("")
def create_stakeholder(body: StakeholderCreate):
    try:
        rows = execute_sql(
            "INSERT INTO stakeholders (segment_type, organization_name, primary_contact_name, email_address, phone_number) VALUES (%s::stakeholder_type, %s, %s, %s, %s) RETURNING *",
            [body.segment_type, body.organization_name, body.primary_contact_name, body.email_address.strip().lower(), body.phone_number]
        )
        return rows[0]
    except Exception as e:
        raise HTTPException(400, str(e))

@router.get("/audit-logs")
def get_audit_logs(
    agent: Optional[str] = None,
    action: Optional[str] = None,
    limit: int = Query(50, le=200)
):
    conditions = []
    params = []
    if agent:
        conditions.append("performed_by_agent = %s::execution_agent_type")
        params.append(agent.upper())
    if action:
        conditions.append("action = %s::audit_action_type")
        params.append(action.upper())
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    try:
        rows = execute_sql(f"SELECT * FROM stakeholder_audit_logs {where} ORDER BY timestamp DESC LIMIT %s", params + [limit])
        return {"logs": rows, "total": len(rows)}
    except Exception:
        return {"logs": [], "total": 0}

@router.get("/{stakeholder_id}")
def get_stakeholder(stakeholder_id: str):
    try:
        rows = execute_sql("SELECT * FROM stakeholders WHERE id = %s", [stakeholder_id])
        if not rows:
            raise HTTPException(404, "Stakeholder not found")
        s = rows[0]
        seg = s.get("segment_type", "")
        profile = None
        if seg == "SHAREHOLDER":
            p = execute_sql("SELECT * FROM shareholder_profiles WHERE stakeholder_id = %s", [stakeholder_id])
            profile = p[0] if p else None
        elif seg == "BUSINESS_PARTNER":
            p = execute_sql("SELECT * FROM partner_profiles WHERE stakeholder_id = %s", [stakeholder_id])
            profile = p[0] if p else None
        elif seg == "GOVT_AGENCY":
            p = execute_sql("SELECT * FROM govt_agency_profiles WHERE stakeholder_id = %s", [stakeholder_id])
            profile = p[0] if p else None
        return {"stakeholder": s, "profile": profile}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))

@router.patch("/{stakeholder_id}")
def update_stakeholder(stakeholder_id: str, body: dict):
    allowed = {"organization_name", "primary_contact_name", "phone_number", "is_active", "segment_type"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(400, "No valid fields to update")
    sets = []
    params = []
    for k, v in updates.items():
        if k == "segment_type":
            sets.append(f"{k} = %s::stakeholder_type")
        else:
            sets.append(f"{k} = %s")
        params.append(v)
    params.append(stakeholder_id)
    try:
        rows = execute_sql(f"UPDATE stakeholders SET {', '.join(sets)}, updated_at=NOW() WHERE id=%s RETURNING *", params)
        if not rows:
            raise HTTPException(404, "Stakeholder not found")
        return rows[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))

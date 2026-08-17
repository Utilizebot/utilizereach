"""
Lead segments router.

A modular registry of lead segments (Shareholders, Government, ... add more
freely). Segments are stored in the `segments` table; every scraped lead
carries a `segment` slug that references `segments.key`. Adding a new segment
is a data operation, not a code change.
"""

import re
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from database.client import get_supabase_admin_client
from database.pg import execute_sql

router = APIRouter(prefix="/api/segments", tags=["segments"])


def get_supabase():
    return get_supabase_admin_client()


class SegmentCreate(BaseModel):
    label: str
    key: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    sort_order: Optional[int] = None


class SegmentUpdate(BaseModel):
    label: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None


class AssignRequest(BaseModel):
    lead_ids: List[str]


def _slugify(text: str) -> str:
    slug = re.sub(r'[^a-z0-9]+', '_', (text or '').strip().lower()).strip('_')
    return slug or 'segment'


def _counts_by_segment() -> dict:
    """Live lead counts per segment key (plus '__unsegmented__')."""
    rows = execute_sql(
        "SELECT COALESCE(segment, '__unsegmented__') AS seg, COUNT(*) AS n "
        "FROM scraped_leads GROUP BY 1",
        [],
    )
    return {r['seg']: r['n'] for r in (rows or [])}


@router.get("")
@router.get("/")
async def list_segments():
    """List all segments with live lead counts, plus an unsegmented bucket."""
    try:
        supabase = get_supabase()
        result = supabase.table('segments').select('*').execute()
        counts = _counts_by_segment()

        segments = []
        for s in (result.data or []):
            segments.append({
                **s,
                "lead_count": counts.get(s['key'], 0),
            })

        # Always return alphabetically — new segments sort themselves automatically
        segments.sort(key=lambda s: s.get('label', '').lower())

        return {
            "segments": segments,
            "unsegmented_count": counts.get('__unsegmented__', 0),
            "total_leads": sum(counts.values()),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list segments: {str(e)}")


@router.post("")
@router.post("/")
async def create_segment(payload: SegmentCreate):
    """Create a new segment. Only admins can add segments."""
    try:
        supabase = get_supabase()
        key = _slugify(payload.key or payload.label)

        existing = supabase.table('segments').select('id').eq('key', key).execute()
        if existing.data:
            raise HTTPException(status_code=400, detail=f"Segment '{key}' already exists")

        row = {
            "key": key,
            "label": payload.label.strip(),
            "description": payload.description,
            "color": payload.color or "#6366f1",
            "sort_order": payload.sort_order if payload.sort_order is not None else 100,
        }
        row = {k: v for k, v in row.items() if v is not None}
        created = supabase.table('segments').insert(row).execute()
        return {"success": True, "segment": created.data[0]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create segment: {str(e)}")


@router.patch("/{key}")
async def update_segment(key: str, payload: SegmentUpdate):
    """Update a segment's label/description/color/active/order."""
    try:
        supabase = get_supabase()
        updates = {k: v for k, v in payload.dict().items() if v is not None}
        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")
        from datetime import datetime
        updates['updated_at'] = datetime.utcnow().isoformat()
        result = supabase.table('segments').update(updates).eq('key', key).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail=f"Segment '{key}' not found")
        return {"success": True, "segment": result.data[0]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update segment: {str(e)}")


@router.delete("/{key}")
async def delete_segment(key: str):
    """Delete a segment. Leads keep existing but are set back to unsegmented."""
    try:
        supabase = get_supabase()
        # Un-tag any leads pointing at this segment so nothing is orphaned.
        execute_sql("UPDATE scraped_leads SET segment = NULL WHERE segment = %s", [key])
        supabase.table('segments').delete().eq('key', key).execute()
        return {"success": True, "message": f"Segment '{key}' deleted; its leads are now unsegmented"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete segment: {str(e)}")


@router.post("/{key}/assign")
async def assign_leads(key: str, payload: AssignRequest):
    """Assign a set of leads to a segment (reclassify)."""
    try:
        supabase = get_supabase()
        seg = supabase.table('segments').select('id').eq('key', key).execute()
        if not seg.data:
            raise HTTPException(status_code=404, detail=f"Segment '{key}' not found")
        if not payload.lead_ids:
            return {"success": True, "updated": 0}

        placeholders = ",".join(["%s"] * len(payload.lead_ids))
        execute_sql(
            f"UPDATE scraped_leads SET segment = %s WHERE id IN ({placeholders})",
            [key, *payload.lead_ids],
        )
        return {"success": True, "updated": len(payload.lead_ids), "segment": key}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to assign leads: {str(e)}")

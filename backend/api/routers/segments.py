"""
Lead segments router.

A modular registry of lead segments (Shareholders, Government, ... add more
freely). Segments are stored in the `segments` table; every scraped lead
carries a `segment` slug that references `segments.key`. Adding a new segment
is a data operation, not a code change.

Multi-brand: segments are per brand (unique (brand_id, key)). Every endpoint
runs inside an authenticated request whose brand is bound by
api.dependencies.get_current_user; query-builder calls are auto-scoped and
every raw execute_sql filters scraped_leads by the active brand explicitly.
"""

import re
import html
import uuid
import os
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from database.client import get_supabase_admin_client
from database.pg import execute_sql
from database import tenancy
from database import brands as brand_catalog
from api.dependencies import require_permission

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


class AlertSendRequest(BaseModel):
    to_email: str
    to_name: Optional[str] = ""
    cc_email: Optional[str] = ""


def _slugify(text: str) -> str:
    slug = re.sub(r'[^a-z0-9]+', '_', (text or '').strip().lower()).strip('_')
    return slug or 'segment'


# Defaults of the low-lead-count alert. Each brand configures its own values
# in brands.sender (see _alert_identity).
_DEFAULT_ALERT_APP_NAME = "UtilizeReach"


def _alert_identity() -> dict:
    """Branding for the segment alert email, from the ACTIVE brand.

    brands.sender keys (all optional):
      segment_alert_app_name  - product name in the header/footer
                                (default "UtilizeReach")
      segment_alert_reply_to  - address the footer asks recipients to reply to.
                                Fallbacks: env SEGMENT_ALERT_REPLY_TO (default
                                brand only), then the brand's own
                                sender.alert_to; otherwise the reply line is
                                omitted. There is no built-in address.
      segment_alert_from      - mailbox (one of the brand's connected accounts)
                                that sends the alert (default: first active
                                connected account)
    Only the default brand may read environment values, so another brand can't
    inherit the deployment's addresses.
    """
    brand_id = tenancy.require_brand()
    brand = brand_catalog.get_brand(brand_id) or {"id": brand_id, "sender": {}}
    reply_default = brand_catalog.sender_value(brand, "alert_to", default=None)
    reply_to = brand_catalog.sender_value(brand, "segment_alert_reply_to", env="SEGMENT_ALERT_REPLY_TO",
                                          default=reply_default, env_for_all_brands=False)
    app_name = brand_catalog.sender_value(brand, "segment_alert_app_name", default=_DEFAULT_ALERT_APP_NAME)
    from_mailbox = brand_catalog.sender_value(brand, "segment_alert_from", default=None)
    return {
        "app_name": str(app_name),
        "reply_to": str(reply_to).strip() if reply_to else None,
        "from_mailbox": str(from_mailbox).strip().lower() if from_mailbox else None,
    }


def _counts_by_segment() -> dict:
    """Live lead counts per segment key (plus '__unsegmented__')."""
    rows = execute_sql(
        "SELECT COALESCE(segment, '__unsegmented__') AS seg, COUNT(*) AS n "
        "FROM scraped_leads WHERE brand_id = %s GROUP BY 1",
        [tenancy.require_brand()],
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
async def create_segment(payload: SegmentCreate, _perm: dict = Depends(require_permission("segments.manage"))):
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
async def update_segment(key: str, payload: SegmentUpdate, _perm: dict = Depends(require_permission("segments.manage"))):
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
async def delete_segment(key: str, _perm: dict = Depends(require_permission("segments.manage"))):
    """Delete a segment. Leads keep existing but are set back to unsegmented."""
    try:
        supabase = get_supabase()
        # The segment must exist in the ACTIVE brand (auto-scoped lookup).
        seg = supabase.table('segments').select('id').eq('key', key).execute()
        if not seg.data:
            raise HTTPException(status_code=404, detail=f"Segment '{key}' not found")
        # Un-tag any leads pointing at this segment so nothing is orphaned.
        execute_sql(
            "UPDATE scraped_leads SET segment = NULL WHERE brand_id = %s AND segment = %s",
            [tenancy.require_brand(), key],
        )
        supabase.table('segments').delete().eq('key', key).execute()
        return {"success": True, "message": f"Segment '{key}' deleted; its leads are now unsegmented"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete segment: {str(e)}")


@router.post("/{key}/assign")
async def assign_leads(key: str, payload: AssignRequest, _perm: dict = Depends(require_permission("leads.assign"))):
    """Assign a set of leads to a segment (reclassify)."""
    try:
        supabase = get_supabase()
        seg = supabase.table('segments').select('id').eq('key', key).execute()
        if not seg.data:
            raise HTTPException(status_code=404, detail=f"Segment '{key}' not found")
        if not payload.lead_ids:
            return {"success": True, "updated": 0}

        # Only the active brand's leads can be reclassified: ids belonging to
        # another brand simply match nothing.
        placeholders = ",".join(["%s"] * len(payload.lead_ids))
        updated = execute_sql(
            f"UPDATE scraped_leads SET segment = %s WHERE brand_id = %s AND id IN ({placeholders}) RETURNING id",
            [key, tenancy.require_brand(), *payload.lead_ids],
        ) or []
        return {"success": True, "updated": len(updated), "segment": key}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to assign leads: {str(e)}")


@router.get("/{key}/alert")
async def get_segment_alert_preview(key: str):
    """Return subject + HTML preview for a low-lead-count alert email."""
    try:
        supabase = get_supabase()
        seg_result = supabase.table('segments').select('*').eq('key', key).execute()
        if not seg_result.data:
            raise HTTPException(status_code=404, detail=f"Segment '{key}' not found")
        seg = seg_result.data[0]

        leads = execute_sql(
            "SELECT decision_maker_name AS name, email, company_name AS company FROM scraped_leads "
            "WHERE brand_id = %s AND segment = %s ORDER BY created_at DESC LIMIT 50",
            [tenancy.require_brand(), key],
        ) or []
        lead_count = len(leads)
        label = seg.get('label', key)
        plural = 's' if lead_count != 1 else ''
        subject = f"⚠️ Low Business Contact: {label} has only {lead_count} contact{plural}"

        rows_html = ""
        for i, lead in enumerate(leads[:20]):
            bg = '#f9fafb' if i % 2 == 0 else '#ffffff'
            rows_html += (
                f'<tr style="background:{bg}">'
                f'<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#9ca3af;font-size:12px;">{i + 1}</td>'
                f'<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">{lead.get("name") or "&mdash;"}</td>'
                f'<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">{lead.get("email") or "&mdash;"}</td>'
                f'<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">{lead.get("company") or "&mdash;"}</td>'
                f'</tr>'
            )
        if not rows_html:
            rows_html = '<tr><td colspan="3" style="padding:12px;color:#9ca3af;text-align:center;">No contacts found</td></tr>'

        overflow_note = f'<p style="font-size:12px;color:#9ca3af;margin:8px 0 0;">Showing first 20 of {lead_count} contacts.</p>' if lead_count > 20 else ''

        ident = _alert_identity()
        app_name = html.escape(ident["app_name"])
        if ident["reply_to"]:
            reply_addr = html.escape(ident["reply_to"], quote=True)
            reply_line = (
                f'\n    <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">Please address your reply to '
                f'<a href="mailto:{reply_addr}" style="color:#7c3aed;font-weight:600;">{reply_addr}</a>.</p>'
            )
        else:
            reply_line = ''

        body_html = f"""<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
  <div style="background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:32px 24px;border-radius:12px 12px 0 0;">
    <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;">&#9888; Low Business Contact</h1>
    <p style="color:#e0d9ff;margin:8px 0 0;font-size:14px;">{app_name} &mdash; Segment Monitor</p>
  </div>
  <div style="padding:24px;background:#fff9ed;border:1px solid #fbbf24;border-top:none;">
    <p style="margin:0;font-size:14px;color:#b45309;">Current count: <strong>{lead_count} contact{plural}</strong> &mdash; below the 20-contact threshold.</p>
  </div>
  <div style="padding:24px;">
    <p style="font-size:14px;color:#374151;margin:0 0 16px;">Leads currently in this segment:</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:#f3f4f6;">
          <th style="padding:10px 12px;text-align:left;font-weight:600;color:#6b7280;border-bottom:2px solid #e5e7eb;width:36px;">#</th>
          <th style="padding:10px 12px;text-align:left;font-weight:600;color:#6b7280;border-bottom:2px solid #e5e7eb;">Name</th>
          <th style="padding:10px 12px;text-align:left;font-weight:600;color:#6b7280;border-bottom:2px solid #e5e7eb;">Email</th>
          <th style="padding:10px 12px;text-align:left;font-weight:600;color:#6b7280;border-bottom:2px solid #e5e7eb;">Company</th>
        </tr>
      </thead>
      <tbody>{rows_html}</tbody>
    </table>
    {overflow_note}
  </div>
  <div style="padding:20px 24px;background:#eef2ff;border:1px solid #c7d2fe;border-top:none;">
    <p style="margin:0;font-size:14px;color:#3730a3;line-height:1.6;">We encourage you to <strong>explore more business engagement opportunities</strong> to grow your contact base in the <strong>{label}</strong> segment. Reaching out to new prospects, attending industry events, and expanding your network are great ways to increase your business contacts immediately.</p>
  </div>
  <div style="padding:16px 24px;background:#f3f4f6;border-radius:0 0 12px 12px;border-top:1px solid #e5e7eb;">
    <p style="margin:0;font-size:12px;color:#6b7280;">This alert was sent by {app_name}. Import more contacts into the <strong>{label}</strong> segment to dismiss future alerts.</p>{reply_line}
  </div>
</div>"""

        body_text = (
            f"Low Business Contact: The {label} segment has only {lead_count} contact{plural} "
            f"— below the 20-contact threshold. Please add more contacts to this segment."
        )

        return {
            "success": True,
            "segment_label": label,
            "lead_count": lead_count,
            "subject": subject,
            "body_html": body_html,
            "body_text": body_text,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate alert preview: {str(e)}")


@router.post("/{key}/alert")
async def send_segment_alert(key: str, payload: AlertSendRequest, _perm: dict = Depends(require_permission("segments.manage"))):
    """Send the low-lead-count alert email for a segment to a given address."""
    try:
        preview = await get_segment_alert_preview(key)

        from database.client import get_supabase_client
        from integrations.gmail_client import GmailClient

        supabase_client = get_supabase_client()
        acc_result = supabase_client.table("email_accounts") \
            .select("*").eq("is_active", True).execute()
        # email_accounts is auto-scoped: only the active brand's mailboxes.
        accounts = [a for a in (acc_result.data or []) if a.get("refresh_token")]
        if not accounts:
            raise HTTPException(
                status_code=400,
                detail="No Gmail account connected. Go to Email Accounts and connect one first.",
            )
        account = accounts[0]
        preferred = _alert_identity()["from_mailbox"]
        if preferred:
            account = next(
                (a for a in accounts if (a.get("email") or "").strip().lower() == preferred),
                account,
            )

        gmail = GmailClient(
            email=account["email"],
            refresh_token=account["refresh_token"],
            access_token=account.get("access_token"),
        )
        to_name = payload.to_name or payload.to_email.split("@")[0].title()
        send_result = gmail.send_email(
            to_email=payload.to_email,
            to_name=to_name,
            subject=preview["subject"],
            body_html=preview["body_html"],
            body_text=preview["body_text"],
            tracking_token=str(uuid.uuid4()),
            backend_url=os.getenv("BACKEND_URL", "http://localhost:8000"),
            save_to_db=False,
            cc=payload.cc_email or None,
        )

        return {
            "success": True,
            "message": f"Alert sent to {payload.to_email} from {account['email']}",
            "gmail_message_id": send_result.get("gmail_message_id"),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send alert: {str(e)}")

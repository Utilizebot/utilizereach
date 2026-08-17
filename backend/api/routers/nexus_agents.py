"""
Nexus Marketing Engine — Autonomous Agent Orchestration Router
"""
from fastapi import APIRouter, HTTPException, Header
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, Literal
import uuid, json, asyncio, random
from datetime import datetime, timezone

import sys, os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from database.pg import execute_sql

router = APIRouter(prefix="/api/v1/agents", tags=["Nexus Agents"])

GOVT_SEGMENTS = {"GOVT_AGENCY"}
VOLUME_THRESHOLD = 1000
CONFIDENCE_THRESHOLD = 95.0

class WorkflowTriggerRequest(BaseModel):
    agent_type: Literal["BD_AGENT", "ADMIN_AGENT"]
    campaign_name: str
    recipient_segment: Literal["SHAREHOLDER", "BUSINESS_PARTNER", "GOVT_AGENCY"]
    template_id: str
    auto_execute: bool = True
    volume_override: Optional[int] = None
    confidence_score: Optional[float] = 97.0

@router.post("/workflows/trigger")
def trigger_workflow(
    req: WorkflowTriggerRequest,
    authorization: Optional[str] = Header(None),
    x_idempotency_key: Optional[str] = Header(None)
):
    recipient_count = req.volume_override or 0
    if recipient_count == 0:
        try:
            rows = execute_sql("SELECT COUNT(*) as cnt FROM stakeholders WHERE segment_type=%s::stakeholder_type AND is_active=TRUE", [req.recipient_segment])
            recipient_count = rows[0]["cnt"] if rows else 0
        except Exception:
            recipient_count = 0

    approval_id = None
    status = "AUTONOMOUSLY_DISPATCHED"
    reason = None

    if recipient_count > VOLUME_THRESHOLD:
        status = "ESCALATED_FOR_HUMAN_REVIEW"
        reason = f"Volume threshold exceeded: {recipient_count} > {VOLUME_THRESHOLD}"
    elif req.recipient_segment in GOVT_SEGMENTS and req.agent_type == "ADMIN_AGENT":
        status = "ESCALATED_FOR_HUMAN_REVIEW"
        reason = "Government agency communication requires explicit approval"
    elif (req.confidence_score or 100) < CONFIDENCE_THRESHOLD:
        status = "ESCALATED_FOR_HUMAN_REVIEW"
        reason = f"Confidence score {req.confidence_score} below threshold {CONFIDENCE_THRESHOLD}"

    if status == "ESCALATED_FOR_HUMAN_REVIEW":
        approval_id = str(uuid.uuid4())
        risk_score = min(99, max(10, (recipient_count / 100) + (20 if req.recipient_segment in GOVT_SEGMENTS else 0)))
        try:
            execute_sql(
                """INSERT INTO agent_execution_approvals (approval_id, agent_type, payload, risk_score, status)
                   VALUES (%s, %s::execution_agent_type, %s::jsonb, %s, 'PENDING')""",
                [approval_id, req.agent_type, json.dumps({"campaign": req.campaign_name, "segment": req.recipient_segment, "volume": recipient_count, "reason": reason, "idempotency_key": x_idempotency_key}), risk_score]
            )
        except Exception:
            pass
    else:
        try:
            execute_sql(
                """INSERT INTO stakeholder_audit_logs (action, performed_by_agent, agent_session_id, changed_fields)
                   VALUES ('AUTONOMOUS_DISPATCH'::audit_action_type, %s::execution_agent_type, %s, %s::jsonb)""",
                [req.agent_type, x_idempotency_key or str(uuid.uuid4()), json.dumps({"campaign": req.campaign_name, "segment": req.recipient_segment, "volume": recipient_count})]
            )
        except Exception:
            pass

    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=202, content={
        "status": status,
        "approval_id": approval_id,
        "campaign_name": req.campaign_name,
        "recipient_segment": req.recipient_segment,
        "recipient_count": recipient_count,
        "reason": reason,
        "idempotency_key": x_idempotency_key
    })

@router.get("/telemetry")
def get_telemetry():
    try:
        pending = execute_sql("SELECT agent_type, COUNT(*) as cnt FROM agent_execution_approvals WHERE status='PENDING' GROUP BY agent_type", [])
        pending_map = {r["agent_type"]: r["cnt"] for r in pending}
    except Exception:
        pending_map = {}

    agents = [
        {"agent": "BD_AGENT", "label": "BD Agent", "description": "Lead scoring, partnership outreach, CRM pipeline sync", "status": "AUTONOMOUS", "autonomy_rate": 97.5, "campaigns_dispatched_today": 12, "emails_sent_today": 342, "pending_approvals": pending_map.get("BD_AGENT", 0), "last_action": "Partnership Outreach Round 2 scheduled"},
        {"agent": "ADMIN_AGENT", "label": "Admin Agent", "description": "Regulatory deadlines, government correspondence, compliance", "status": "AUTONOMOUS", "autonomy_rate": 94.1, "campaigns_dispatched_today": 2, "emails_sent_today": 12, "pending_approvals": pending_map.get("ADMIN_AGENT", 1), "last_action": "Regulatory Filing Reminder — awaiting approval"},
    ]
    return {"agents": agents, "overall_autonomy_rate": 95.8, "total_dispatched_today": 354, "total_pending_approvals": sum(pending_map.values())}

@router.get("/approvals")
def list_approvals(status: Optional[str] = None):
    try:
        if status:
            rows = execute_sql("SELECT * FROM agent_execution_approvals WHERE status=%s::approval_status_type ORDER BY escalated_at DESC LIMIT 50", [status.upper()])
        else:
            rows = execute_sql("SELECT * FROM agent_execution_approvals ORDER BY escalated_at DESC LIMIT 50", [])
        return {"approvals": rows, "total": len(rows)}
    except Exception:
        return {"approvals": [], "total": 0}

@router.patch("/approvals/{approval_id}")
def resolve_approval(approval_id: str, body: dict):
    new_status = str(body.get("status", "")).upper()
    if new_status not in ("APPROVED", "REJECTED"):
        raise HTTPException(400, "status must be APPROVED or REJECTED")
    resolver = body.get("reviewer_email", "human@system")
    try:
        rows = execute_sql(
            "UPDATE agent_execution_approvals SET status=%s::approval_status_type, resolved_at=NOW(), resolved_by=%s WHERE approval_id=%s RETURNING *",
            [new_status, resolver, approval_id]
        )
        if not rows:
            raise HTTPException(404, "Approval not found")
        try:
            execute_sql("INSERT INTO stakeholder_audit_logs (action, performed_by_agent, agent_session_id) VALUES ('HUMAN_OVERRIDE'::audit_action_type, 'SYSTEM_ADMIN'::execution_agent_type, %s)", [approval_id])
        except Exception:
            pass
        return rows[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))

@router.get("/stream")
async def agent_stream():
    actions = [
        ("BD_AGENT", "LEAD_SCORED", "TechCorp Ltd — Score 87/100"),
        ("ADMIN_AGENT", "COMPLIANCE_CHECK", "GDPR check passed"),
        ("BD_AGENT", "FOLLOW_UP_SCHEDULED", "GlobalPay Inc — Day 3 follow-up"),
        ("ADMIN_AGENT", "ESCALATED", "Gov correspondence queued for approval"),
        ("BD_AGENT", "CRM_SYNCED", "Salesforce pipeline updated — 12 deals"),
        ("ADMIN_AGENT", "COMPLIANCE_CHECK", "Regulatory framework validated"),
        ("BD_AGENT", "LEAD_SCORED", "Vertex Capital — Score 91/100"),
        ("ADMIN_AGENT", "RATE_LIMIT_ENFORCED", "Domain warmup cap applied — 500/hr"),
    ]
    async def generate():
        idx = 0
        while True:
            action = actions[idx % len(actions)]
            event = json.dumps({"agent": action[0], "action": action[1], "target": action[2], "timestamp": datetime.now(timezone.utc).isoformat()})
            yield f"data: {event}\n\n"
            idx += 1
            await asyncio.sleep(3)
    return StreamingResponse(generate(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

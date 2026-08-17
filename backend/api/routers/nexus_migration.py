"""
Nexus Marketing Engine — Legacy Data Ingestion Router
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr
from typing import Optional, Any
import re
import uuid
from datetime import datetime, timezone

import sys, os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from database.pg import execute_sql

router = APIRouter(prefix="/api/v1/migration", tags=["Nexus Migration"])

GOVT_KEYWORDS = ["gov", "government", "ministry", "agency", "department", "bureau", "authority", "municipality", "federal", "state", "official"]
SHAREHOLDER_KEYWORDS = ["investor", "shareholder", "equity", "capital", "fund", "venture", "holdings", "asset", "portfolio", "dividend"]

def classify_contact(raw: dict) -> str:
    email = str(raw.get("email", "")).lower()
    org = str(raw.get("organization", raw.get("company", ""))).lower()
    tags = str(raw.get("tags", "")).lower()
    combined = email + " " + org + " " + tags
    if ".gov." in email or email.endswith(".gov") or any(k in combined for k in GOVT_KEYWORDS):
        return "GOVT_AGENCY"
    if any(k in combined for k in SHAREHOLDER_KEYWORDS):
        return "SHAREHOLDER"
    if "@" in email and email.split("@")[1].count(".") >= 1:
        return "BUSINESS_PARTNER"
    return "UNASSIGNED"

def is_valid_email(email: str) -> bool:
    return bool(re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email))

class IngestRequest(BaseModel):
    contacts: list[dict[str, Any]]
    source_system: Optional[str] = "LEGACY_IMPORT"

class BatchStatusResponse(BaseModel):
    batch_id: str
    status: str
    total: int
    valid: int
    invalid: int
    classifications: dict[str, int]

@router.post("/ingest-legacy", response_model=BatchStatusResponse)
def ingest_legacy(req: IngestRequest):
    if len(req.contacts) > 5000:
        raise HTTPException(422, f"Batch exceeds maximum of 5,000 records (got {len(req.contacts)})")

    batch_id = str(uuid.uuid4())
    valid, invalid = 0, 0
    classifications: dict[str, int] = {"SHAREHOLDER": 0, "BUSINESS_PARTNER": 0, "GOVT_AGENCY": 0, "UNASSIGNED": 0}

    for raw in req.contacts:
        email = str(raw.get("email", "")).strip()
        if not email or not is_valid_email(email):
            invalid += 1
            continue
        segment = classify_contact(raw)
        classifications[segment] += 1
        raw["_batch_id"] = batch_id
        raw["_source"] = req.source_system
        try:
            execute_sql(
                "INSERT INTO staging_legacy_contacts (raw_data, migration_status, assigned_segment) VALUES (%s::jsonb, %s, %s::stakeholder_type)",
                [__import__("json").dumps(raw), "PENDING", segment]
            )
            valid += 1
        except Exception:
            invalid += 1

    return BatchStatusResponse(batch_id=batch_id, status="QUEUED", total=len(req.contacts), valid=valid, invalid=invalid, classifications=classifications)

@router.get("/status/{batch_id}")
def get_batch_status(batch_id: str):
    rows = execute_sql(
        "SELECT migration_status, COUNT(*) as cnt FROM staging_legacy_contacts WHERE raw_data->>'_batch_id' = %s GROUP BY migration_status",
        [batch_id]
    )
    return {"batch_id": batch_id, "breakdown": rows}

@router.post("/promote/{batch_id}")
def promote_batch(batch_id: str):
    pending = execute_sql(
        "SELECT raw_id, raw_data, assigned_segment FROM staging_legacy_contacts WHERE raw_data->>'_batch_id' = %s AND migration_status = 'PENDING'",
        [batch_id]
    )
    promoted, skipped = 0, 0
    for row in pending:
        raw = row["raw_data"]
        email = str(raw.get("email", "")).strip().lower()
        if not email:
            skipped += 1
            continue
        try:
            execute_sql(
                """INSERT INTO stakeholders (segment_type, organization_name, primary_contact_name, email_address, phone_number, legacy_id_ref)
                   VALUES (%s::stakeholder_type, %s, %s, %s, %s, %s)
                   ON CONFLICT (email_address) DO NOTHING""",
                [row["assigned_segment"], raw.get("organization") or raw.get("company"), raw.get("name") or raw.get("contact_name"), email, raw.get("phone"), str(row["raw_id"])]
            )
            execute_sql("UPDATE staging_legacy_contacts SET migration_status='PROMOTED', processed_at=NOW() WHERE raw_id=%s", [row["raw_id"]])
            promoted += 1
        except Exception:
            skipped += 1
    return {"batch_id": batch_id, "promoted": promoted, "skipped": skipped}

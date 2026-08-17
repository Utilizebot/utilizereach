"""
Email Exclusions Router
Manage emails that should be excluded from campaigns
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr
from typing import List, Optional

from database.client import get_supabase_admin_client

router = APIRouter(prefix="/api/exclusions", tags=["Exclusions"])


class ExclusionCreate(BaseModel):
    email: EmailStr
    reason: Optional[str] = None


class Exclusion(BaseModel):
    id: str
    email: str
    reason: Optional[str]
    excluded_by: Optional[str]
    created_at: str


def get_supabase():
    """Get database client"""
    return get_supabase_admin_client()


@router.get("/")
async def get_exclusions():
    """
    Get all excluded emails

    Returns list of emails that are excluded from campaigns
    """
    try:
        supabase = get_supabase()
        result = supabase.table('email_exclusions').select('*').order('created_at', desc=True).execute()

        return {
            "exclusions": result.data or [],
            "total": len(result.data) if result.data else 0
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get exclusions: {str(e)}")


@router.post("/")
async def add_exclusion(exclusion: ExclusionCreate):
    """
    Add an email to the exclusion list

    Excluded emails will not receive campaign emails
    """
    try:
        supabase = get_supabase()

        # Check if already excluded
        existing = supabase.table('email_exclusions')\
            .select('id')\
            .eq('email', exclusion.email.lower())\
            .execute()

        if existing.data and len(existing.data) > 0:
            raise HTTPException(status_code=400, detail=f"Email {exclusion.email} is already excluded")

        # Add to exclusion list
        result = supabase.table('email_exclusions').insert({
            'email': exclusion.email.lower(),
            'reason': exclusion.reason,
            'excluded_by': 'user'
        }).execute()

        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to add exclusion")

        return {
            "success": True,
            "message": f"Email {exclusion.email} added to exclusion list",
            "exclusion": result.data[0]
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to add exclusion: {str(e)}")


@router.delete("/{exclusion_id}")
async def remove_exclusion(exclusion_id: str):
    """
    Remove an email from the exclusion list

    The email will be able to receive campaign emails again
    """
    try:
        supabase = get_supabase()

        # Get exclusion first to return the email
        exclusion = supabase.table('email_exclusions')\
            .select('*')\
            .eq('id', exclusion_id)\
            .execute()

        if not exclusion.data or len(exclusion.data) == 0:
            raise HTTPException(status_code=404, detail="Exclusion not found")

        # Delete
        supabase.table('email_exclusions').delete().eq('id', exclusion_id).execute()

        return {
            "success": True,
            "message": f"Email {exclusion.data[0]['email']} removed from exclusion list"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to remove exclusion: {str(e)}")


@router.post("/bulk")
async def add_bulk_exclusions(emails: List[str], reason: Optional[str] = None):
    """
    Add multiple emails to exclusion list at once

    Useful for bulk excluding test accounts or team members
    """
    try:
        supabase = get_supabase()

        added = 0
        skipped = 0
        errors = []

        for email in emails:
            try:
                email_lower = email.lower().strip()

                # Check if already excluded
                existing = supabase.table('email_exclusions')\
                    .select('id')\
                    .eq('email', email_lower)\
                    .execute()

                if existing.data and len(existing.data) > 0:
                    skipped += 1
                    continue

                # Add to exclusion list
                result = supabase.table('email_exclusions').insert({
                    'email': email_lower,
                    'reason': reason or 'Bulk exclusion',
                    'excluded_by': 'user'
                }).execute()

                if result.data:
                    added += 1
                else:
                    errors.append(f"Failed to add {email}")

            except Exception as e:
                errors.append(f"{email}: {str(e)}")

        return {
            "success": True,
            "added": added,
            "skipped": skipped,
            "errors": errors,
            "total": len(emails)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to add bulk exclusions: {str(e)}")


@router.get("/check/{email}")
async def check_exclusion(email: str):
    """
    Check if an email is excluded

    Returns whether the email is in the exclusion list
    """
    try:
        supabase = get_supabase()

        result = supabase.table('email_exclusions')\
            .select('*')\
            .eq('email', email.lower())\
            .execute()

        is_excluded = result.data and len(result.data) > 0

        return {
            "email": email,
            "is_excluded": is_excluded,
            "exclusion": result.data[0] if is_excluded else None
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to check exclusion: {str(e)}")

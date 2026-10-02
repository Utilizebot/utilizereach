"""
FastAPI Dependencies

Authentication and common dependencies.
Verifies locally-issued JWTs (see api/security.py) and loads the
matching sales_reps row from Postgres.
"""

from fastapi import HTTPException, Header, Depends
from typing import Optional
import sys
import os

# Add parent directory to import path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import jwt as pyjwt

from api.security import decode_access_token
from api.permissions import has_permission, canonical_role
from database.client import get_supabase_admin_client


async def get_current_user(authorization: Optional[str] = Header(None)):
    """
    Get current authenticated user from JWT token

    Args:
        authorization: Bearer token from header

    Returns:
        Sales rep dict with user info (password_hash stripped)

    Raises:
        HTTPException: If not authenticated
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="Not authenticated - No authorization header")

    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header format")

    token = authorization.replace("Bearer ", "")

    try:
        payload = decode_access_token(token)
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except pyjwt.PyJWTError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token - no subject")

    try:
        client = get_supabase_admin_client()
        result = (
            client.table("sales_reps")
            .select("*")
            .eq("id", user_id)
            .execute()
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Authentication failed: {type(e).__name__}: {str(e)}")

    if not result.data:
        raise HTTPException(status_code=404, detail=f"Sales rep not found for user {user_id}")

    sales_rep = result.data[0]
    # Deactivated accounts are rejected even with an otherwise-valid token.
    if sales_rep.get("is_active") is False:
        raise HTTPException(status_code=403, detail="Account is deactivated")
    sales_rep.pop("password_hash", None)
    return sales_rep


def require_permission(permission: str):
    """Dependency factory: require the current user's role to grant `permission`.

    Usage in a router endpoint:
        @router.post("/create")
        async def create(..., _user: dict = Depends(require_permission("campaigns.create"))):
            ...

    Returns the authenticated user dict (same shape as get_current_user) so the
    endpoint can also use it. Raises 401 if unauthenticated, 403 if the role
    lacks the permission.
    """
    async def _dep(current_user: dict = Depends(get_current_user)) -> dict:
        if not has_permission(current_user.get("role"), permission):
            raise HTTPException(
                status_code=403,
                detail=f"Permission denied — '{permission}' is required for this action.",
            )
        return current_user

    return _dep


def require_role(*roles: str):
    """Dependency factory: require the current user to hold one of `roles`.

    Admins always pass. Prefer require_permission() for action-gating; use this
    only when a whole surface is role-scoped rather than permission-scoped.
    """
    allowed = {canonical_role(r) for r in roles}

    async def _dep(current_user: dict = Depends(get_current_user)) -> dict:
        role = canonical_role(current_user.get("role"))
        if role != "admin" and role not in allowed:
            raise HTTPException(status_code=403, detail="Insufficient role for this action.")
        return current_user

    return _dep

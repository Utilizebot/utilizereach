"""
FastAPI Dependencies

Authentication and common dependencies.
Verifies locally-issued JWTs (see api/security.py) and loads the
matching sales_reps row from Postgres.
"""

from fastapi import HTTPException, Header
from typing import Optional
import sys
import os

# Add parent directory to import path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import jwt as pyjwt

from api.security import decode_access_token
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
    sales_rep.pop("password_hash", None)
    return sales_rep

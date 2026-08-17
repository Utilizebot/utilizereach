"""
API Keys Router

SerpAPI key CRUD per sales rep. Replaces the direct Supabase api_keys
table access from ApiKeysSettings.tsx. Admins see/manage all keys,
sales reps only their own.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import sys
import os

# Add parent directory to import path
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from api.dependencies import get_current_user
from database.client import get_supabase_admin_client

router = APIRouter(prefix="/api/api-keys", tags=["api-keys"])


class ApiKeyCreate(BaseModel):
    key_name: str
    api_key: str
    provider: Optional[str] = "serpapi"
    usage_limit: Optional[int] = None


class ApiKeyUpdate(BaseModel):
    key_name: Optional[str] = None
    api_key: Optional[str] = None
    is_active: Optional[bool] = None
    usage_limit: Optional[int] = None


def _is_admin(user: dict) -> bool:
    return user.get("role") == "admin"


def _get_owned_key(client, key_id: str, current_user: dict) -> dict:
    result = client.table("api_keys").select("*").eq("id", key_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="API key not found")
    row = result.data[0]
    if not _is_admin(current_user) and row.get("assigned_to") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not allowed to modify this API key")
    return row


@router.get("/")
async def list_api_keys(current_user: dict = Depends(get_current_user)):
    """List API keys (admins: all, sales reps: own), newest first"""
    try:
        client = get_supabase_admin_client()
        query = client.table("api_keys").select("*")
        if not _is_admin(current_user):
            query = query.eq("assigned_to", current_user["id"])
        result = query.order("created_at", desc=True).execute()
        return result.data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list API keys: {str(e)}")


@router.post("/")
async def create_api_key(request: ApiKeyCreate, current_user: dict = Depends(get_current_user)):
    """Create an API key assigned to the current user"""
    payload = {
        "key_name": request.key_name,
        "api_key_encrypted": request.api_key,
        "provider": request.provider or "serpapi",
        "assigned_to": current_user["id"],
        "is_active": True,
    }
    if request.usage_limit is not None:
        payload["usage_limit"] = request.usage_limit
    try:
        client = get_supabase_admin_client()
        result = client.table("api_keys").insert(payload).execute()
        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to create API key")
        return result.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create API key: {str(e)}")


@router.put("/{key_id}")
async def update_api_key(key_id: str, request: ApiKeyUpdate, current_user: dict = Depends(get_current_user)):
    """Update an API key (name/key/active/limit)"""
    updates = {}
    if request.key_name is not None:
        updates["key_name"] = request.key_name
    if request.api_key is not None:
        updates["api_key_encrypted"] = request.api_key
    if request.is_active is not None:
        updates["is_active"] = request.is_active
    if request.usage_limit is not None:
        updates["usage_limit"] = request.usage_limit
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    try:
        client = get_supabase_admin_client()
        _get_owned_key(client, key_id, current_user)
        result = client.table("api_keys").update(updates).eq("id", key_id).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="API key not found")
        return result.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update API key: {str(e)}")


@router.delete("/{key_id}")
async def delete_api_key(key_id: str, current_user: dict = Depends(get_current_user)):
    """Delete an API key"""
    try:
        client = get_supabase_admin_client()
        _get_owned_key(client, key_id, current_user)
        client.table("api_keys").delete().eq("id", key_id).execute()
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete API key: {str(e)}")

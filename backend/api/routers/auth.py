"""
Auth Router

Local email/password authentication backed by the sales_reps table.
Issues HS256 JWTs (see api/security.py). Replaces Supabase Auth.
"""

from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
from typing import Optional
import sys
import os

# Add parent directory to import path
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from api.dependencies import get_current_user
from api.security import create_access_token, hash_password, verify_password
from database.client import get_supabase_admin_client
from database.pg import execute_sql

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email: str
    password: str
    full_name: str
    role: Optional[str] = None


class ProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    utm_source: Optional[str] = None
    utm_medium: Optional[str] = None
    utm_default_campaign: Optional[str] = None
    email: Optional[str] = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


def _public_user(row: dict) -> dict:
    row = dict(row)
    row.pop("password_hash", None)
    return row


def _admin_exists() -> bool:
    rows = execute_sql("SELECT 1 FROM sales_reps WHERE password_hash IS NOT NULL LIMIT 1")
    return bool(rows)


def _token_response(row: dict) -> dict:
    token = create_access_token(row["id"], row["email"], row.get("role", "sales_rep"))
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": _public_user(row),
    }


@router.post("/login")
async def login(request: LoginRequest):
    """Login with email/password, returns a JWT + the sales rep profile"""
    email = request.email.strip().lower()
    client = get_supabase_admin_client()

    result = client.table("sales_reps").select("*").eq("email", email).execute()
    if not result.data:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    row = result.data[0]
    if not verify_password(request.password, row.get("password_hash") or ""):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Update last_login server-side (used to be a fire-and-forget from the browser)
    updated = execute_sql(
        "UPDATE sales_reps SET last_login = NOW() WHERE id = %s RETURNING *",
        [row["id"]],
    )
    if updated:
        row = updated[0]

    return _token_response(row)


@router.post("/register")
async def register(request: RegisterRequest, authorization: Optional[str] = Header(None)):
    """
    Register a new user.

    If no user with a password exists yet, this is the unauthenticated
    bootstrap path (setup wizard) and the new user becomes admin.
    Otherwise an admin Bearer token is required.
    """
    email = request.email.strip().lower()
    if not email or not request.password:
        raise HTTPException(status_code=400, detail="Email and password are required")
    if len(request.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    if not _admin_exists():
        role = "admin"
    else:
        current = await get_current_user(authorization)
        if current.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Only admins can register new users")
        role = request.role or "sales_rep"

    if role not in ("admin", "sales_rep"):
        raise HTTPException(status_code=400, detail=f"Invalid role: {role}")

    client = get_supabase_admin_client()
    existing = client.table("sales_reps").select("*").eq("email", email).execute()

    if existing.data:
        row = existing.data[0]
        if row.get("password_hash"):
            raise HTTPException(status_code=400, detail="A user with this email already exists")
        # Legacy profile without a password — claim it
        updated = (
            client.table("sales_reps")
            .update({
                "password_hash": hash_password(request.password),
                "full_name": request.full_name,
                "role": role,
                "is_active": True,
            })
            .eq("id", row["id"])
            .execute()
        )
        return _token_response(updated.data[0])

    created = (
        client.table("sales_reps")
        .insert({
            "email": email,
            "full_name": request.full_name,
            "password_hash": hash_password(request.password),
            "role": role,
            "is_active": True,
        })
        .execute()
    )
    return _token_response(created.data[0])


@router.get("/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    """Current user's sales rep profile"""
    return _public_user(current_user)


@router.patch("/me")
async def update_me(request: ProfileUpdate, current_user: dict = Depends(get_current_user)):
    """Update the current user's profile (partial update)"""
    updates = {k: v for k, v in request.model_dump().items() if v is not None}
    if not updates:
        return _public_user(current_user)

    if "email" in updates:
        updates["email"] = updates["email"].strip().lower()

    client = get_supabase_admin_client()
    try:
        result = (
            client.table("sales_reps")
            .update(updates)
            .eq("id", current_user["id"])
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to update profile: {str(e)}")

    if not result.data:
        raise HTTPException(status_code=404, detail="Sales rep not found")
    return _public_user(result.data[0])


@router.post("/change-password")
async def change_password(request: ChangePasswordRequest, current_user: dict = Depends(get_current_user)):
    """Change the current user's password"""
    if len(request.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    rows = execute_sql(
        "SELECT password_hash FROM sales_reps WHERE id = %s",
        [current_user["id"]],
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Sales rep not found")

    if not verify_password(request.current_password, rows[0].get("password_hash") or ""):
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    execute_sql(
        "UPDATE sales_reps SET password_hash = %s WHERE id = %s RETURNING id",
        [hash_password(request.new_password), current_user["id"]],
    )
    return {"success": True}


@router.get("/status")
async def auth_status():
    """Whether an admin account exists yet (setup wizard bootstrap check)"""
    return {"adminExists": _admin_exists()}


# ============================================================================
# ADMIN USER MANAGEMENT (admin-gated)
# ============================================================================
class AdminCreateUser(BaseModel):
    email: str
    full_name: str
    password: str
    role: Optional[str] = "sales_rep"


class AdminResetPassword(BaseModel):
    new_password: str


class AdminUpdateUser(BaseModel):
    full_name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None


def _ensure_admin(current_user: dict):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")


@router.get("/users")
async def list_users(current_user: dict = Depends(get_current_user)):
    """List all users (admins only)."""
    _ensure_admin(current_user)
    rows = execute_sql(
        "SELECT id, email, full_name, role, is_active, last_login, created_at "
        "FROM sales_reps ORDER BY created_at DESC"
    )
    return {"users": rows or []}


@router.post("/users")
async def admin_create_user(request: AdminCreateUser, current_user: dict = Depends(get_current_user)):
    """Create a user (admins only)."""
    _ensure_admin(current_user)
    email = request.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="A valid email is required")
    if len(request.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    role = request.role or "sales_rep"
    if role not in ("admin", "sales_rep"):
        raise HTTPException(status_code=400, detail=f"Invalid role: {role}")
    client = get_supabase_admin_client()
    existing = client.table("sales_reps").select("*").eq("email", email).execute()
    if existing.data:
        row = existing.data[0]
        if row.get("password_hash"):
            raise HTTPException(status_code=400, detail="A user with this email already exists")
        updated = client.table("sales_reps").update({
            "full_name": request.full_name,
            "password_hash": hash_password(request.password),
            "role": role, "is_active": True,
        }).eq("id", row["id"]).execute()
        return {"success": True, "user": _public_user(updated.data[0])}
    created = client.table("sales_reps").insert({
        "email": email, "full_name": request.full_name,
        "password_hash": hash_password(request.password), "role": role, "is_active": True,
    }).execute()
    return {"success": True, "user": _public_user(created.data[0])}


@router.post("/users/{user_id}/reset-password")
async def admin_reset_password(user_id: str, request: AdminResetPassword,
                               current_user: dict = Depends(get_current_user)):
    """Set a new password for any user (admins only)."""
    _ensure_admin(current_user)
    if len(request.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    rows = execute_sql(
        "UPDATE sales_reps SET password_hash = %s WHERE id = %s RETURNING id, email",
        [hash_password(request.new_password), user_id],
    )
    if not rows:
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True, "email": rows[0]["email"]}


@router.patch("/users/{user_id}")
async def admin_update_user(user_id: str, request: AdminUpdateUser,
                            current_user: dict = Depends(get_current_user)):
    """Update a user's name / role / active status (admins only)."""
    _ensure_admin(current_user)
    updates = {k: v for k, v in request.dict().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    if "role" in updates and updates["role"] not in ("admin", "sales_rep"):
        raise HTTPException(status_code=400, detail="Invalid role")
    if user_id == current_user["id"] and (updates.get("role") == "sales_rep" or updates.get("is_active") is False):
        raise HTTPException(status_code=400, detail="You cannot demote or deactivate your own account")
    client = get_supabase_admin_client()
    res = client.table("sales_reps").update(updates).eq("id", user_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True, "user": _public_user(res.data[0])}


@router.delete("/users/{user_id}")
async def admin_delete_user(user_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a user (admins only). Guards against self-delete and last-admin."""
    _ensure_admin(current_user)
    if user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    target = execute_sql("SELECT role FROM sales_reps WHERE id = %s", [user_id])
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target[0]["role"] == "admin":
        admins = execute_sql("SELECT id FROM sales_reps WHERE role = 'admin'")
        if len(admins) <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the last admin")
    get_supabase_admin_client().table("sales_reps").delete().eq("id", user_id).execute()
    return {"success": True}

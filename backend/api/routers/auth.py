"""
Auth Router

Local email/password authentication backed by the sales_reps table (global
login identities). Issues HS256 JWTs (see api/security.py) that also carry the
brand the session acts in; brand membership + role are re-checked on every
request by api/dependencies.get_current_user.

The legacy /api/auth/users endpoints are kept for the existing UI but now
manage MEMBERS OF THE ACTIVE BRAND (see api/membership.py).
"""

from fastapi import APIRouter, Depends, HTTPException, Header, Request
from pydantic import BaseModel
from typing import Optional
import sys
import os

# Add parent directory to import path
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from api import membership
from api.dependencies import (
    get_current_user, require_permission, resolve_user_brand, _request_host,
)
from api.permissions import ROLE_LABELS, canonical_role, permissions_for_user, role_catalog
from api.security import create_access_token, hash_password, verify_password
from database.client import get_supabase_admin_client
from database.pg import execute_sql
from database.tenancy import DEFAULT_BRAND_ID

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str
    password: str
    brand: Optional[str] = None      # optional brand id or slug to start in


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


def public_user(user: dict) -> dict:
    """The user payload returned to the frontend (no secrets, with brand context)."""
    row = dict(user)
    row.pop("password_hash", None)
    role = canonical_role(row.get("brand_role") or row.get("role"))
    row["role"] = role
    row["brand_role"] = role
    row["role_label"] = ROLE_LABELS.get(role, role.title())
    row["permissions"] = permissions_for_user(row)
    row["is_platform_admin"] = bool(row.get("is_platform_admin"))
    return row


def _admin_exists() -> bool:
    rows = execute_sql("SELECT 1 FROM sales_reps WHERE password_hash IS NOT NULL LIMIT 1")
    return bool(rows)


def session_for(user_row: dict, requested_brand: Optional[str], host: Optional[str]) -> dict:
    """Resolve the brand for a fresh session and mint its token."""
    user = dict(user_row)
    user.pop("password_hash", None)
    resolved = resolve_user_brand(user, requested_brand, host)
    brand = resolved["brand"]
    user["global_role"] = user.get("role")
    user["brand_id"] = brand["id"]
    user["brand_slug"] = brand["slug"]
    user["brand_name"] = brand["display_name"]
    user["brand_role"] = resolved["role"]
    user["role"] = resolved["role"]
    user["brands"] = resolved["brands"]
    token = create_access_token(user["id"], user["email"], resolved["role"], brand["id"])
    return {"access_token": token, "token_type": "bearer", "user": public_user(user)}


@router.post("/login")
async def login(request: LoginRequest, http_request: Request):
    """Login with email/password, returns a JWT (bound to a brand) + the profile."""
    email = request.email.strip().lower()
    client = get_supabase_admin_client()

    result = client.table("sales_reps").select("*").eq("email", email).execute()
    if not result.data:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    row = result.data[0]
    if not verify_password(request.password, row.get("password_hash") or ""):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if row.get("is_active") is False:
        raise HTTPException(status_code=403, detail="This account has been deactivated. Contact an administrator.")

    updated = execute_sql(
        "UPDATE sales_reps SET last_login = NOW() WHERE id = %s RETURNING *",
        [row["id"]],
    )
    if updated:
        row = updated[0]

    return session_for(row, request.brand, _request_host(http_request))


@router.post("/register")
async def register(request: RegisterRequest, http_request: Request,
                   authorization: Optional[str] = Header(None)):
    """
    Register a user.

    Bootstrap (no account with a password exists yet - setup wizard): the new
    user becomes a PLATFORM ADMIN and admin of the default brand.
    Otherwise an authenticated admin of the active brand adds the user to that
    brand (same as POST /api/brands/current/members).
    """
    email = request.email.strip().lower()
    if not email or not request.password:
        raise HTTPException(status_code=400, detail="Email and password are required")
    if len(request.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    if not _admin_exists():
        existing = execute_sql("SELECT id FROM sales_reps WHERE lower(email) = %s", [email])
        if existing:
            rows = execute_sql(
                "UPDATE sales_reps SET password_hash = %s, full_name = %s, role = 'admin', "
                "is_active = TRUE, is_platform_admin = TRUE WHERE id = %s RETURNING *",
                [hash_password(request.password), request.full_name, existing[0]["id"]],
            )
        else:
            rows = execute_sql(
                "INSERT INTO sales_reps (email, full_name, password_hash, role, is_active, is_platform_admin) "
                "VALUES (%s, %s, %s, 'admin', TRUE, TRUE) RETURNING *",
                [email, request.full_name, hash_password(request.password)],
            )
        user = rows[0]
        execute_sql(
            "INSERT INTO brand_members (brand_id, sales_rep_id, role, is_default) VALUES (%s, %s, 'admin', TRUE) "
            "ON CONFLICT (brand_id, sales_rep_id) DO UPDATE SET role = 'admin'",
            [DEFAULT_BRAND_ID, user["id"]],
        )
        return session_for(user, None, _request_host(http_request))

    current = await get_current_user(http_request, authorization)
    if not (current.get("is_platform_admin") or current.get("brand_role") == "admin"):
        raise HTTPException(status_code=403, detail="Only brand admins can register new users")
    membership.add_member(current["brand_id"], current, email, request.role,
                          request.full_name, request.password)
    rows = execute_sql("SELECT * FROM sales_reps WHERE lower(email) = %s", [email])
    return {"success": True, "user": public_user({**rows[0], "brand_role": canonical_role(request.role or "member")})}


@router.get("/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    """Current user's profile, active brand, brands and permissions."""
    return public_user(current_user)


@router.patch("/me")
async def update_me(request: ProfileUpdate, current_user: dict = Depends(get_current_user)):
    """Update the current user's profile (partial update)"""
    updates = {k: v for k, v in request.model_dump().items() if v is not None}
    if not updates:
        return public_user(current_user)

    if "email" in updates:
        updates["email"] = updates["email"].strip().lower()

    client = get_supabase_admin_client()
    try:
        result = client.table("sales_reps").update(updates).eq("id", current_user["id"]).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to update profile: {str(e)}")

    if not result.data:
        raise HTTPException(status_code=404, detail="Sales rep not found")
    merged = {**current_user, **result.data[0]}
    return public_user(merged)


@router.post("/change-password")
async def change_password(request: ChangePasswordRequest, current_user: dict = Depends(get_current_user)):
    """Change the current user's password"""
    if len(request.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    rows = execute_sql("SELECT password_hash FROM sales_reps WHERE id = %s", [current_user["id"]])
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


@router.get("/roles")
async def list_roles(current_user: dict = Depends(get_current_user)):
    """Role catalog (value, label, description, permissions) for role pickers."""
    return {"roles": role_catalog()}


# ============================================================================
# LEGACY USER MANAGEMENT - now scoped to the ACTIVE BRAND's members
# ============================================================================
class AdminCreateUser(BaseModel):
    email: str
    full_name: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = "member"


class AdminResetPassword(BaseModel):
    new_password: str


class AdminUpdateUser(BaseModel):
    full_name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("/users")
async def list_users(current_user: dict = Depends(require_permission("users.view"))):
    """Members of the active brand."""
    return {"users": membership.list_members(current_user["brand_id"]),
            "brand": {"id": current_user["brand_id"], "display_name": current_user["brand_name"]}}


@router.post("/users")
async def admin_create_user(request: AdminCreateUser,
                            current_user: dict = Depends(require_permission("users.manage"))):
    """Add a person to the active brand (creating the account if needed)."""
    res = membership.add_member(current_user["brand_id"], current_user, request.email,
                                request.role, request.full_name, request.password)
    rows = execute_sql("SELECT id, email, full_name, is_active, last_login, created_at FROM sales_reps WHERE id = %s",
                       [res["user_id"]])
    user = {**(rows[0] if rows else {}), "role": res["role"], "role_label": ROLE_LABELS.get(res["role"])}
    return {"success": True, "user": user, "created": res["created"]}


@router.post("/users/{user_id}/reset-password")
async def admin_reset_password(user_id: str, request: AdminResetPassword,
                               current_user: dict = Depends(require_permission("users.manage"))):
    res = membership.reset_member_password(current_user["brand_id"], current_user, user_id, request.new_password)
    return {"success": True, "email": res["email"]}


@router.patch("/users/{user_id}")
async def admin_update_user(user_id: str, request: AdminUpdateUser,
                            current_user: dict = Depends(require_permission("users.manage"))):
    """Change a member's role in the active brand (name / activation: see rules)."""
    if not execute_sql("SELECT 1 FROM brand_members WHERE brand_id = %s AND sales_rep_id = %s",
                       [current_user["brand_id"], user_id]):
        raise HTTPException(status_code=404, detail="User not found in this brand")
    if request.role is not None:
        membership.update_member_role(current_user["brand_id"], current_user, user_id, request.role)
    if request.is_active is not None:
        membership.set_account_active(current_user, user_id, request.is_active)
    if request.full_name:
        membership.guard_global_account_change(current_user["brand_id"], current_user, user_id)
        execute_sql("UPDATE sales_reps SET full_name = %s WHERE id = %s", [request.full_name, user_id])
    members = [m for m in membership.list_members(current_user["brand_id"]) if str(m["id"]) == str(user_id)]
    return {"success": True, "user": members[0] if members else None}


@router.delete("/users/{user_id}")
async def admin_delete_user(user_id: str, current_user: dict = Depends(require_permission("users.manage"))):
    """Remove a person from the active brand (their account and other brands are untouched)."""
    membership.remove_member(current_user["brand_id"], current_user, user_id)
    return {"success": True}

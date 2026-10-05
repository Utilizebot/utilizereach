"""
FastAPI Dependencies

Authentication, brand (tenant) resolution and permission checks.

get_current_user() verifies the locally-issued JWT (api/security.py), loads
the global sales_reps identity, then resolves the brand this request acts in
and BINDS it for the database layer (database/tenancy.py) so every query in
the request is scoped to that brand:

  * brand-dedicated host (brands.hostnames) -> that brand, the caller must be
    a member (or a platform admin);
  * otherwise the token's `brand` claim (set at login / brand switch);
  * otherwise the caller's default membership.

Membership is re-checked on EVERY request: a token naming a brand the user
no longer belongs to is rejected. A client-supplied brand header is never
trusted. The returned user dict carries:

    brand_id, brand_slug, brand_name   - the active brand
    brand_role                         - the caller's role in it
    role                               - same as brand_role (legacy call sites
                                         compare current_user["role"] == "admin")
    global_role                        - the old global sales_reps.role
    is_platform_admin                  - may create brands / act in any brand
    brands                             - [{id, slug, display_name, role, is_default}]
"""

from fastapi import Depends, HTTPException, Header, Request
from typing import Optional
import sys
import os

# Add parent directory to import path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import jwt as pyjwt

from api.security import decode_access_token
from api.permissions import canonical_role, has_permission_for
from database.client import get_supabase_admin_client
from database.pg import execute_sql
from database import brands as brand_catalog
from database import tenancy


def _request_host(request: Optional[Request]) -> Optional[str]:
    if request is None:
        return None
    # The frontend nginx forwards the visitor's Host (proxy_set_header Host $host).
    # X-Forwarded-Host is client-controlled there, so it is not trusted.
    return request.headers.get("host")


def _memberships(user_id: str) -> list:
    return execute_sql(
        "SELECT bm.brand_id, bm.role, bm.is_default, b.slug, b.display_name, b.is_active "
        "FROM brand_members bm JOIN brands b ON b.id = bm.brand_id "
        "WHERE bm.sales_rep_id = %s ORDER BY bm.is_default DESC, b.created_at",
        [user_id],
    )


def resolve_user_brand(user: dict, requested_brand: Optional[str], host: Optional[str]) -> dict:
    """Decide which brand `user` acts in. Raises HTTPException(403) when none.

    Returns {"brand": <brand row>, "role": <canonical role>, "brands": [...]}.
    """
    is_platform = bool(user.get("is_platform_admin"))
    members = [m for m in _memberships(user["id"]) if m.get("is_active")]
    by_id = {m["brand_id"]: m for m in members}

    host_brand = brand_catalog.brand_for_host(host)
    if host_brand:
        requested_brand = host_brand["id"]

    brand = None
    role = None
    if requested_brand:
        target = brand_catalog.get_brand(requested_brand)
        if target and target.get("is_active"):
            if target["id"] in by_id:
                brand, role = target, by_id[target["id"]]["role"]
            elif is_platform:
                brand, role = target, "admin"
        if brand is None and host_brand:
            raise HTTPException(status_code=403, detail="You don't have access to this brand.")
    if brand is None:
        # fall back to the default membership (stale or missing brand claim)
        if members:
            first = members[0]
            brand, role = brand_catalog.get_brand(first["brand_id"]), first["role"]
        elif is_platform:
            brand, role = brand_catalog.default_brand(), "admin"
    if brand is None:
        raise HTTPException(status_code=403, detail="Your account is not a member of any active brand.")

    visible = [
        {"id": m["brand_id"], "slug": m["slug"], "display_name": m["display_name"],
         "role": canonical_role(m["role"]), "is_default": m["is_default"]}
        for m in members
    ]
    if is_platform:
        known = {b["id"] for b in visible}
        for b in brand_catalog.list_brands(active_only=True):
            if b["id"] not in known:
                visible.append({"id": b["id"], "slug": b["slug"], "display_name": b["display_name"],
                                "role": "admin", "is_default": False})
    return {"brand": brand, "role": canonical_role(role), "brands": visible}


def _decode(authorization: Optional[str]) -> dict:
    if not authorization:
        raise HTTPException(status_code=401, detail="Not authenticated - No authorization header")
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header format")
    token = authorization.replace("Bearer ", "", 1)
    try:
        return decode_access_token(token)
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except pyjwt.PyJWTError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")


def _load_user(payload: dict) -> dict:
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token - no subject")
    try:
        client = get_supabase_admin_client()
        result = client.table("sales_reps").select("*").eq("id", user_id).execute()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Authentication failed: {type(e).__name__}: {str(e)}")
    if not result.data:
        raise HTTPException(status_code=401, detail="Account not found")
    user = result.data[0]
    user.pop("password_hash", None)
    if user.get("is_active") is False:
        raise HTTPException(status_code=403, detail="Account is deactivated")
    return user


def _bind_user(user: dict, payload: dict, host: Optional[str]) -> dict:
    resolved = resolve_user_brand(user, payload.get("brand"), host)
    brand = resolved["brand"]
    user["global_role"] = user.get("role")
    user["brand_id"] = brand["id"]
    user["brand_slug"] = brand["slug"]
    user["brand_name"] = brand["display_name"]
    user["brand_role"] = resolved["role"]
    user["role"] = resolved["role"]
    user["brands"] = resolved["brands"]
    user["is_platform_admin"] = bool(user.get("is_platform_admin"))
    tenancy.set_current_brand(brand["id"])
    return user


async def get_current_user(request: Request, authorization: Optional[str] = Header(None)) -> dict:
    """Authenticate the caller and bind the brand this request acts in.

    MUST stay `async def`: the brand ContextVar set here then flows into the
    endpoint (async endpoints run in this task; sync ones get a copy of this
    context in the threadpool).
    """
    payload = _decode(authorization)
    user = _load_user(payload)
    return _bind_user(user, payload, _request_host(request))


async def get_current_user_from_query(request: Request, token: Optional[str] = None,
                                      authorization: Optional[str] = Header(None)) -> dict:
    """Same as get_current_user, but also accepts ?token=<jwt>.

    Only for Server-Sent-Events endpoints: the browser EventSource API cannot
    send an Authorization header.
    """
    header = authorization or (f"Bearer {token}" if token else None)
    payload = _decode(header)
    user = _load_user(payload)
    return _bind_user(user, payload, _request_host(request))


def require_permission(permission: str):
    """Dependency factory: the caller's role IN THE ACTIVE BRAND must grant `permission`.

        @router.post("/create")
        async def create(..., current_user: dict = Depends(require_permission("campaigns.create"))):
    """
    async def _dep(current_user: dict = Depends(get_current_user)) -> dict:
        if not has_permission_for(current_user, permission):
            raise HTTPException(
                status_code=403,
                detail=f"Permission denied - '{permission}' is required for this action.",
            )
        return current_user

    return _dep


def require_role(*roles: str):
    """Dependency factory: caller's brand role must be one of `roles` (admins always pass)."""
    allowed = {canonical_role(r) for r in roles}

    async def _dep(current_user: dict = Depends(get_current_user)) -> dict:
        role = canonical_role(current_user.get("brand_role"))
        if not current_user.get("is_platform_admin") and role != "admin" and role not in allowed:
            raise HTTPException(status_code=403, detail="Insufficient role for this action.")
        return current_user

    return _dep


async def require_platform_admin(current_user: dict = Depends(get_current_user)) -> dict:
    if not current_user.get("is_platform_admin"):
        raise HTTPException(status_code=403, detail="Platform admin access required.")
    return current_user


# ---------------------------------------------------------------------------
# Public (unauthenticated) endpoints
# ---------------------------------------------------------------------------

def public_brand(request: Optional[Request]) -> dict:
    """Brand for a public request: the brand that owns the Host, else brand 1.

    Never derived from the request body or a client header.
    """
    return brand_catalog.brand_for_host(_request_host(request)) or brand_catalog.default_brand()


async def public_brand_scope(request: Request) -> dict:
    """Dependency for public endpoints that write tenant data (forms, chat):
    binds the Host-resolved brand for the rest of the request."""
    brand = public_brand(request)
    tenancy.set_current_brand(brand["id"])
    return brand

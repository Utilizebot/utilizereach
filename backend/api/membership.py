"""
Brand membership management (shared by api/routers/brands.py and the legacy
/api/auth/users endpoints).

Users (sales_reps) are global login identities; access to a brand is a row in
brand_members with a per-brand role. Everything here operates on ONE brand.

Escalation guards:
  * a brand admin can only act on members of THEIR brand;
  * nobody removes or demotes themselves, and a brand never loses its last admin;
  * adding an existing account never changes its password or other memberships;
  * resetting a password - which hands over the WHOLE account - is only allowed
    by a brand admin when the target belongs to this brand alone and is not a
    platform admin; anything else needs a platform admin;
  * deactivating an account (global) is platform-admin only.
"""

from __future__ import annotations

from typing import Optional

from fastapi import HTTPException

from api.permissions import ROLES, ROLE_LABELS, canonical_role
from api.security import hash_password
from database.pg import execute_sql


def _brand_member_ids(brand_id: str) -> set:
    rows = execute_sql("SELECT sales_rep_id FROM brand_members WHERE brand_id = %s", [brand_id])
    return {r["sales_rep_id"] for r in rows}


def _membership(brand_id: str, user_id: str) -> Optional[dict]:
    rows = execute_sql(
        "SELECT role, is_default FROM brand_members WHERE brand_id = %s AND sales_rep_id = %s",
        [brand_id, user_id],
    )
    return rows[0] if rows else None


def _belongs_elsewhere(user_id: str, brand_id: str) -> bool:
    """True if the account is a platform admin or a member of any OTHER brand."""
    target = execute_sql("SELECT is_platform_admin FROM sales_reps WHERE id = %s", [user_id])
    if target and target[0].get("is_platform_admin"):
        return True
    other = execute_sql(
        "SELECT 1 FROM brand_members WHERE sales_rep_id = %s AND brand_id <> %s LIMIT 1",
        [user_id, brand_id],
    )
    return bool(other)


def guard_global_account_change(brand_id: str, actor: dict, user_id: str) -> None:
    """Changing a global account field (name, password...) affects every brand the
    person belongs to: only a platform admin may do it for multi-brand accounts."""
    if not actor.get("is_platform_admin") and _belongs_elsewhere(user_id, brand_id):
        raise HTTPException(
            status_code=403,
            detail="This account also belongs to another brand - only a platform admin can change it.",
        )


def _admin_count(brand_id: str) -> int:
    rows = execute_sql(
        "SELECT count(*) AS n FROM brand_members bm JOIN sales_reps s ON s.id = bm.sales_rep_id "
        "WHERE bm.brand_id = %s AND bm.role = 'admin' AND s.is_active IS NOT FALSE",
        [brand_id],
    )
    return int(rows[0]["n"]) if rows else 0


def _validate_role(role: Optional[str]) -> str:
    r = canonical_role(role) if role else "member"
    if r not in ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role: {role}")
    return r


def list_members(brand_id: str) -> list:
    rows = execute_sql(
        "SELECT s.id, s.email, s.full_name, s.is_active, s.last_login, s.created_at, "
        "s.is_platform_admin, bm.role, bm.is_default "
        "FROM brand_members bm JOIN sales_reps s ON s.id = bm.sales_rep_id "
        "WHERE bm.brand_id = %s ORDER BY s.created_at DESC",
        [brand_id],
    )
    for r in rows:
        r["role"] = canonical_role(r.get("role"))
        r["role_label"] = ROLE_LABELS.get(r["role"], r["role"].title())
    return rows


def add_member(brand_id: str, actor: dict, email: str, role: Optional[str] = None,
               full_name: Optional[str] = None, password: Optional[str] = None) -> dict:
    """Add an existing account to the brand, or create a new account in it."""
    email = (email or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="A valid email is required")
    role = _validate_role(role)
    existing = execute_sql("SELECT id, password_hash FROM sales_reps WHERE lower(email) = %s", [email])
    created = False
    if existing:
        user_id = existing[0]["id"]
        if not existing[0].get("password_hash"):
            # legacy profile with no password: claim it only when a password is
            # supplied, and only when that can't hand over another brand's account
            if password and not actor.get("is_platform_admin") and _belongs_elsewhere(user_id, brand_id):
                raise HTTPException(
                    status_code=403,
                    detail="This account also belongs to another brand - only a platform admin can set its password.",
                )
            if password:
                if len(password) < 6:
                    raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
                execute_sql("UPDATE sales_reps SET password_hash = %s, is_active = TRUE WHERE id = %s",
                            [hash_password(password), user_id])
    else:
        if not password or len(password) < 6:
            raise HTTPException(status_code=400, detail="New accounts need a password of at least 6 characters")
        name = (full_name or "").strip() or email.split("@")[0]
        if len(name) < 2:          # sales_reps requires >= 2 chars
            name = email
        rows = execute_sql(
            "INSERT INTO sales_reps (email, full_name, password_hash, role, is_active) "
            "VALUES (%s, %s, %s, %s, TRUE) RETURNING id",
            [email, name, hash_password(password), "admin" if role == "admin" else "sales_rep"],
        )
        user_id = rows[0]["id"]
        created = True
    if _membership(brand_id, user_id):
        raise HTTPException(status_code=400, detail="This person is already a member of this brand")
    has_default = execute_sql("SELECT 1 FROM brand_members WHERE sales_rep_id = %s AND is_default", [user_id])
    execute_sql(
        "INSERT INTO brand_members (brand_id, sales_rep_id, role, is_default) VALUES (%s, %s, %s, %s)",
        [brand_id, user_id, role, not has_default],
    )
    return {"user_id": user_id, "created": created, "role": role}


def update_member_role(brand_id: str, actor: dict, user_id: str, role: str) -> dict:
    role = _validate_role(role)
    current = _membership(brand_id, user_id)
    if not current:
        raise HTTPException(status_code=404, detail="Not a member of this brand")
    if str(user_id) == str(actor.get("id")) and role != "admin" and not actor.get("is_platform_admin"):
        raise HTTPException(status_code=400, detail="You cannot demote yourself")
    if canonical_role(current["role"]) == "admin" and role != "admin" and _admin_count(brand_id) <= 1:
        raise HTTPException(status_code=400, detail="A brand needs at least one admin")
    execute_sql("UPDATE brand_members SET role = %s WHERE brand_id = %s AND sales_rep_id = %s",
                [role, brand_id, user_id])
    return {"user_id": user_id, "role": role}


def remove_member(brand_id: str, actor: dict, user_id: str) -> dict:
    current = _membership(brand_id, user_id)
    if not current:
        raise HTTPException(status_code=404, detail="Not a member of this brand")
    if str(user_id) == str(actor.get("id")):
        raise HTTPException(status_code=400, detail="You cannot remove yourself from the brand")
    if canonical_role(current["role"]) == "admin" and _admin_count(brand_id) <= 1:
        raise HTTPException(status_code=400, detail="A brand needs at least one admin")
    execute_sql("DELETE FROM brand_members WHERE brand_id = %s AND sales_rep_id = %s", [brand_id, user_id])
    if current.get("is_default"):
        # promote another membership to default so the user still lands somewhere
        execute_sql(
            "UPDATE brand_members SET is_default = TRUE WHERE (brand_id, sales_rep_id) = ("
            "SELECT brand_id, sales_rep_id FROM brand_members WHERE sales_rep_id = %s "
            "ORDER BY created_at LIMIT 1)",
            [user_id],
        )
    return {"user_id": user_id, "removed": True}


def reset_member_password(brand_id: str, actor: dict, user_id: str, new_password: str) -> dict:
    if not new_password or len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    if not _membership(brand_id, user_id):
        raise HTTPException(status_code=404, detail="Not a member of this brand")
    if not actor.get("is_platform_admin") and _belongs_elsewhere(user_id, brand_id):
        raise HTTPException(
            status_code=403,
            detail="This account also belongs to another brand - only a platform admin can reset its password.",
        )
    rows = execute_sql("UPDATE sales_reps SET password_hash = %s WHERE id = %s RETURNING email",
                       [hash_password(new_password), user_id])
    return {"user_id": user_id, "email": rows[0]["email"] if rows else None}


def set_account_active(actor: dict, user_id: str, active: bool) -> None:
    if not actor.get("is_platform_admin"):
        raise HTTPException(status_code=403, detail="Only a platform admin can (de)activate accounts")
    if str(user_id) == str(actor.get("id")) and not active:
        raise HTTPException(status_code=400, detail="You cannot deactivate your own account")
    execute_sql("UPDATE sales_reps SET is_active = %s WHERE id = %s", [bool(active), user_id])

"""
Role-Based Access Control (RBAC)

Single source of truth for roles and their permissions.

Roles are PER BRAND: a user's role comes from brand_members.role for the
brand they are acting in (see api/dependencies.get_current_user), so the same
person can be admin of one brand and viewer of another. Platform admins
(sales_reps.is_platform_admin) act as admin in every brand and additionally
hold PLATFORM_PERMISSIONS (creating and configuring brands).

Design (v1):
  * Roles are FIXED and defined here in code (not editable at runtime).
  * Each role maps to a FIXED set of permissions ("<resource>.<action>").
  * Model is ACTION-GATING only: every authenticated user can read all data;
    permissions decide who may create / edit / delete / manage.
  * Enforced centrally via api.dependencies.require_permission().

To add a capability: add the permission string below, grant it to the roles
that should have it, then depend on it in the relevant router endpoint. The
frontend mirrors this via the `permissions` list returned by /api/auth/me.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Roles
# ---------------------------------------------------------------------------
ADMIN = "admin"
MANAGER = "manager"
MEMBER = "member"
VIEWER = "viewer"

ROLES = (ADMIN, MANAGER, MEMBER, VIEWER)

# Legacy stored role value -> canonical role.
# Installs predating RBAC used "sales_rep" for what is now "member".
_ROLE_ALIASES = {"sales_rep": MEMBER}

ROLE_LABELS = {
    ADMIN: "Admin",
    MANAGER: "Manager",
    MEMBER: "Member",
    VIEWER: "Viewer",
}

ROLE_DESCRIPTIONS = {
    ADMIN: "Full control, including team, mailboxes, API keys and system settings.",
    MANAGER: "Runs the whole outreach operation — campaigns, leads, sending, "
             "analytics. Cannot manage users, credentials or system settings.",
    MEMBER: "Creates and runs campaigns, imports and works leads, sends email. "
            "Cannot delete campaigns/leads or change team and configuration.",
    VIEWER: "Read-only access to dashboards, campaigns, leads and analytics.",
}

# ---------------------------------------------------------------------------
# Permissions  ("<resource>.<action>")
# ---------------------------------------------------------------------------
_ALL = [
    "users.view", "users.manage",
    "campaigns.view", "campaigns.create", "campaigns.edit", "campaigns.delete",
    "leads.view", "leads.edit", "leads.delete", "leads.import", "leads.assign",
    "emails.view", "emails.send",
    "accounts.view", "accounts.manage",
    "segments.view", "segments.manage",
    "scraper.view", "scraper.run",
    "exclusions.view", "exclusions.manage",
    "social.view", "social.manage",
    "analytics.view",
    "settings.view", "settings.manage",
    "apikeys.manage",
]
ALL_PERMISSIONS = frozenset(_ALL)

# Views every authenticated role gets EXCEPT the team list (users.view),
# which is reserved for managers and admins.
_BASE_VIEWS = frozenset({
    "campaigns.view", "leads.view", "emails.view", "accounts.view",
    "segments.view", "scraper.view", "exclusions.view", "social.view",
    "analytics.view", "settings.view",
})

_VIEWER_PERMS = _BASE_VIEWS

_MEMBER_PERMS = _BASE_VIEWS | frozenset({
    "campaigns.create", "campaigns.edit",
    "leads.edit", "leads.import", "leads.assign",
    "emails.send",
    "scraper.run",
    "social.manage",
})

_MANAGER_PERMS = _MEMBER_PERMS | frozenset({
    "users.view",
    "campaigns.delete",
    "leads.delete",
    "segments.manage",
    "exclusions.manage",
})

ROLE_PERMISSIONS = {
    ADMIN: ALL_PERMISSIONS,
    MANAGER: _MANAGER_PERMS,
    MEMBER: _MEMBER_PERMS,
    VIEWER: _VIEWER_PERMS,
}


def canonical_role(role: str | None) -> str:
    """Normalise a stored role value to a canonical role.

    Unknown / missing roles fail closed to VIEWER (least privilege), so a
    corrupted or unexpected role value can never grant write access.
    """
    r = (role or "").strip().lower()
    r = _ROLE_ALIASES.get(r, r)
    return r if r in ROLE_PERMISSIONS else VIEWER


def has_permission(role: str | None, permission: str) -> bool:
    """True if the (canonicalised) role grants the given permission."""
    return permission in ROLE_PERMISSIONS.get(canonical_role(role), frozenset())


def permissions_for(role: str | None) -> list[str]:
    """Sorted list of permissions a role holds (for the frontend)."""
    return sorted(ROLE_PERMISSIONS.get(canonical_role(role), frozenset()))


def role_catalog() -> list[dict]:
    """Role metadata for admin UIs (role picker, docs)."""
    return [
        {
            "value": r,
            "label": ROLE_LABELS[r],
            "description": ROLE_DESCRIPTIONS[r],
            "permissions": sorted(ROLE_PERMISSIONS[r]),
        }
        for r in ROLES
    ]


# ---------------------------------------------------------------------------
# Platform-level permissions (not part of any brand role): held only by
# platform admins (sales_reps.is_platform_admin).
# ---------------------------------------------------------------------------
PLATFORM_PERMISSIONS = frozenset({
    "brands.manage",     # create / configure / deactivate brands
    "brands.view_all",   # see every brand and cross-brand totals
})


def has_permission_for(user: dict, permission: str) -> bool:
    """Permission check for a user dict produced by get_current_user()."""
    if user.get("is_platform_admin"):
        return True
    if permission in PLATFORM_PERMISSIONS:
        return False
    return has_permission(user.get("brand_role") or user.get("role"), permission)


def permissions_for_user(user: dict) -> list[str]:
    if user.get("is_platform_admin"):
        return sorted(ALL_PERMISSIONS | PLATFORM_PERMISSIONS)
    return permissions_for(user.get("brand_role") or user.get("role"))

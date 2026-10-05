"""Per-brand Gmail mailbox resolution (multi-brand).

Every brand sends from, and reads bounces/replies in, its own BASE mailbox:

* Brand 1 (the default brand / pre-existing deployment) keeps the exact legacy
  behaviour: when ``backend/.gmail_tokens`` exists it is used, constructed
  exactly as ``api/routers/campaigns.load_gmail_tokens`` + the sender did.
* Otherwise (any other brand, or brand 1 without the tokens file) the brand's
  base mailbox is its ``email_accounts`` row that holds a ``refresh_token``
  (persona aliases are rows without one). The lookup is filtered by brand_id
  and runs inside ``brand_scope(brand_id)``.

    get_brand_base_mailbox(brand_id=None)  -> dict | None   (no secrets logged)
    describe_brand_mailbox(brand_id=None)  -> (source, email) | (None, None)
    get_brand_gmail_client(brand_id=None)  -> GmailClient   (raises if none)

``brand_id`` defaults to the active brand (tenancy.require_brand()).
Nothing here runs at import time and nothing is cached across brands.
"""

from __future__ import annotations

from pathlib import Path
from typing import Dict, Optional, Tuple

from database import tenancy
from database.pg import execute_sql
from database.tenancy import brand_scope

# Same file api/routers/campaigns.load_gmail_tokens reads: <backend>/.gmail_tokens
# (in the container: /app/.gmail_tokens).
GMAIL_TOKENS_FILE = Path(__file__).resolve().parent.parent / ".gmail_tokens"


class NoBrandMailboxError(RuntimeError):
    """The brand has no usable sending mailbox configured."""


def _brand_id(brand_id: Optional[str]) -> str:
    return str(brand_id) if brand_id else tenancy.require_brand()


def load_legacy_gmail_tokens() -> Dict[str, str]:
    """Parse backend/.gmail_tokens exactly like campaigns.load_gmail_tokens."""
    if not GMAIL_TOKENS_FILE.exists():
        raise FileNotFoundError(".gmail_tokens file not found!")
    tokens: Dict[str, str] = {}
    with open(GMAIL_TOKENS_FILE) as f:
        for line in f:
            line = line.strip()
            if line and "=" in line:
                key, value = line.split("=", 1)
                tokens[key] = value
    return tokens


def _legacy_tokens_available(brand_id: str) -> bool:
    return tenancy.DEFAULT_BRAND_ID == brand_id and GMAIL_TOKENS_FILE.is_file()


def get_brand_base_mailbox(brand_id: Optional[str] = None) -> Optional[dict]:
    """The brand's base mailbox row (the email_accounts row holding a
    refresh_token), or None. Active rows first, then oldest first."""
    bid = _brand_id(brand_id)
    with brand_scope(bid):
        rows = execute_sql(
            "SELECT id, email, display_name, sender_name, refresh_token, access_token, "
            "is_active, status "
            "FROM email_accounts "
            "WHERE brand_id = %s AND refresh_token IS NOT NULL AND refresh_token <> '' "
            "ORDER BY (COALESCE(is_active, true) AND COALESCE(status, 'active') = 'active') DESC, "
            "created_at ASC "
            "LIMIT 1",
            [bid],
        ) or []
    return rows[0] if rows else None


def describe_brand_mailbox(brand_id: Optional[str] = None) -> Tuple[Optional[str], Optional[str]]:
    """(source, email) of the mailbox the brand would use, without building a
    client or touching Gmail. source is 'tokens_file' or 'email_accounts'."""
    bid = _brand_id(brand_id)
    if _legacy_tokens_available(bid):
        try:
            return "tokens_file", load_legacy_gmail_tokens().get("GMAIL_EMAIL")
        except Exception:
            pass
    row = get_brand_base_mailbox(bid)
    if row:
        return "email_accounts", row.get("email")
    return None, None


def get_brand_gmail_client(brand_id: Optional[str] = None):
    """GmailClient for the brand's base mailbox.

    Brand 1 + tokens file present -> exactly the legacy construction.
    Otherwise the brand's base mailbox row. Raises NoBrandMailboxError when
    the brand has none.
    """
    from integrations.gmail_client import GmailClient

    bid = _brand_id(brand_id)
    if _legacy_tokens_available(bid):
        tokens = load_legacy_gmail_tokens()
        return GmailClient(email=tokens.get("GMAIL_EMAIL"), refresh_token=tokens.get("GMAIL_REFRESH_TOKEN"),
                           access_token=tokens.get("GMAIL_ACCESS_TOKEN"))
    row = get_brand_base_mailbox(bid)
    if not row:
        raise NoBrandMailboxError(
            f"brand {bid} has no base mailbox (an email_accounts row with a refresh_token)")
    return GmailClient(email=row["email"], refresh_token=row["refresh_token"],
                       access_token=row.get("access_token"))

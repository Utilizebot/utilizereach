"""One-click unsubscribe / opt-out for cold outreach (PUBLIC - no login).

Campaign emails carry a link to /api/unsubscribe?e=<email>&t=<token>[&b=<brand_id>].
Clicking it records the opt-out in THAT brand's email_exclusions (so the brand
never emails the address again) and email_unsubscribes, marks the brand's
matching new leads unqualified, and shows a small confirmation page.

Token = sha256(email + brand.unsub_salt)[:12] - a lightweight signature so
people can only opt themselves out. Brand 1 (the default brand) keeps the
original single-brand salt, so every link already sitting in inboxes keeps
working:

  * `b` present  -> the token is validated against that brand's salt only;
  * `b` absent   -> legacy link: every active brand's salt is tried, brand 1
                    first, and the first match decides the brand.

The opt-out is recorded in the matching brand only (see docs/MULTIBRAND.md,
"Unsubscribe links").
"""
import hashlib
import hmac
import html
import logging
from typing import Optional

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

from database import brands as brand_catalog
from database.pg import execute_sql
from database.tenancy import DEFAULT_BRAND_ID, DEFAULT_BRAND_SLUG, brand_scope

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["unsubscribe"])

# Brand 1's salt (also stored as brands.unsub_salt for brand 1) - the original
# single-brand salt, shared with ops/smart_sender.py. Only used as a fallback
# when the brand catalog cannot be read, so legacy links still validate
# exactly as before.
UNSUB_SALT = "utilizereach-unsub-v1"


def unsub_token(email: str, salt: str = UNSUB_SALT) -> str:
    return hashlib.sha256(((email or "").strip().lower() + (salt or "")).encode()).hexdigest()[:12]


def _token_ok(email: str, token: str, salt: Optional[str]) -> bool:
    if not salt or not token:
        return False
    return hmac.compare_digest(str(token), unsub_token(email, salt))


def _match_brand(email: str, token: str, brand_ref: str) -> Optional[dict]:
    """The brand whose salt signs (email, token), or None."""
    if brand_ref:
        # New links name their brand: validate against that brand ONLY.
        # (Inactive brands still honour opt-outs.)
        brand = brand_catalog.get_brand(brand_ref)
        if brand and _token_ok(email, token, brand.get("unsub_salt")):
            return brand
        return None
    # Legacy links (no brand): try every active brand, brand 1 first.
    candidates = sorted(brand_catalog.list_brands(active_only=True),
                        key=lambda b: 0 if b["id"] == DEFAULT_BRAND_ID else 1)
    for brand in candidates:
        if _token_ok(email, token, brand.get("unsub_salt")):
            return brand
    return None


def _brand_label(brand: Optional[dict]) -> str:
    """Display name for a brand's confirmation page."""
    if not brand:
        return ""
    company = ((brand.get("branding") or {}).get("company") or {})
    return (company.get("name") or brand.get("display_name") or brand.get("website_domain") or "").strip()


def _brand_footer(brand: Optional[dict]) -> str:
    if not brand:
        return ""
    company = ((brand.get("branding") or {}).get("company") or {})
    name = _brand_label(brand)
    tagline = (company.get("tagline") or "").strip()
    parts = [p for p in (name, tagline) if p]
    return html.escape(" · ".join(parts))


def _page(title: str, msg: str, brand: Optional[dict] = None) -> str:
    return f"""<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title></head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7fb;margin:0;
display:flex;align-items:center;justify-content:center;min-height:100vh">
<div style="background:#fff;border:1px solid #eceef3;border-radius:16px;padding:40px;max-width:440px;
text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.05)">
<div style="font-size:40px">✅</div>
<h1 style="font-size:20px;color:#111;margin:12px 0 6px">{title}</h1>
<p style="color:#666;font-size:15px;line-height:1.5">{msg}</p>
<p style="color:#aaa;font-size:12px;margin-top:20px">{_brand_footer(brand)}</p>
</div></body></html>"""


def _record_opt_out(brand_id: str, email: str) -> None:
    """Record the opt-out in this brand only (idempotent)."""
    with brand_scope(brand_id):
        execute_sql(
            "INSERT INTO email_exclusions (brand_id, email, reason, excluded_by) "
            "VALUES (%s, %s, %s, %s) ON CONFLICT (brand_id, email) DO NOTHING",
            [brand_id, email, "Unsubscribed via email link", "unsubscribe"],
        )
        execute_sql(
            "INSERT INTO email_unsubscribes (brand_id, email, source, reason) "
            "VALUES (%s, %s, %s, %s) ON CONFLICT (brand_id, email) DO NOTHING",
            [brand_id, email, "link", "Unsubscribed via email link"],
        )
        execute_sql(
            "UPDATE scraped_leads SET status='unqualified' "
            "WHERE brand_id = %s AND lower(email)=%s AND status='new'",
            [brand_id, email],
        )


@router.get("/unsubscribe", response_class=HTMLResponse)
async def unsubscribe(e: str = "", t: str = "", b: str = ""):
    email = (e or "").strip().lower()
    brand_ref = (b or "").strip()
    if not email or "@" not in email:
        return HTMLResponse(_page("Invalid link", "This unsubscribe link is not valid."), status_code=400)

    try:
        brand = _match_brand(email, t, brand_ref)
    except Exception as exc:  # brand catalog unreadable (DB down)
        logger.warning("unsubscribe: brand catalog unavailable: %s", exc)
        # Legacy brand-1 links still validate with the original salt.
        brand = None
        if (not brand_ref or brand_ref.lower() in (DEFAULT_BRAND_ID, DEFAULT_BRAND_SLUG)) and _token_ok(email, t, UNSUB_SALT):
            brand = {"id": DEFAULT_BRAND_ID}

    if not brand:
        return HTMLResponse(_page("Invalid link", "This unsubscribe link is not valid or has expired."), status_code=400)

    try:
        _record_opt_out(brand["id"], email)
    except Exception as exc:
        # never show an error to the recipient; opt-out is best-effort but idempotent
        logger.warning("unsubscribe: failed to record opt-out for brand %s: %s", brand.get("id"), exc)

    if brand_catalog.is_default_brand(brand):
        sender_phrase = "from us"
    else:
        label = _brand_label(brand)
        sender_phrase = f"from {html.escape(label)}" if label else "from us"
    return HTMLResponse(_page("You're unsubscribed",
                              f"<b>{html.escape(email)}</b> won't receive any further emails {sender_phrase}. "
                              f"Sorry for the interruption.",
                              brand))

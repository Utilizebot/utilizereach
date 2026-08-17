"""One-click unsubscribe / opt-out for cold outreach.

Campaign emails carry a link to /api/unsubscribe?e=<email>&t=<token>. Clicking
it adds the address to email_exclusions (so it's never emailed again) and marks
the lead unqualified, then shows a small confirmation page. The token is a
lightweight signature so people can only opt themselves out.
"""
import hashlib
from fastapi import APIRouter
from fastapi.responses import HTMLResponse
from database.client import get_supabase_admin_client
from database.pg import execute_sql

router = APIRouter(prefix="/api", tags=["unsubscribe"])

# shared with ops/smart_sender.py — keep in sync
UNSUB_SALT = "utilizereach-unsub-v1"


def unsub_token(email: str) -> str:
    return hashlib.sha256(((email or "").strip().lower() + UNSUB_SALT).encode()).hexdigest()[:12]


def _page(title: str, msg: str) -> str:
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
<p style="color:#aaa;font-size:12px;margin-top:20px">example.com · AI meeting intelligence for Malay and English</p>
</div></body></html>"""


@router.get("/unsubscribe", response_class=HTMLResponse)
async def unsubscribe(e: str = "", t: str = ""):
    email = (e or "").strip().lower()
    if not email or "@" not in email:
        return HTMLResponse(_page("Invalid link", "This unsubscribe link is not valid."), status_code=400)
    if t != unsub_token(email):
        return HTMLResponse(_page("Invalid link", "This unsubscribe link is not valid or has expired."), status_code=400)
    try:
        sb = get_supabase_admin_client()
        existing = sb.table("email_exclusions").select("id").eq("email", email).execute()
        if not existing.data:
            sb.table("email_exclusions").insert({
                "email": email, "reason": "Unsubscribed via email link", "excluded_by": "unsubscribe",
            }).execute()
        execute_sql("UPDATE scraped_leads SET status='unqualified' WHERE lower(email)=%s AND status='new'", [email])
    except Exception:
        pass  # never show an error to the recipient; opt-out is best-effort but idempotent
    return HTMLResponse(_page("You're unsubscribed",
                              f"<b>{email}</b> won't receive any further emails from us. Sorry for the interruption."))

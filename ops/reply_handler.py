"""Detect replies to our outreach and record them.

Scans the outreach@ INBOX, matches each inbound message to a sent_email by
gmail_thread_id, and (APPLY=1) inserts an email_replies row + marks the
sent_email replied_at/status='replied'. Skips our own addresses and
mailer-daemon/bounce senders. Idempotent (email_replies.gmail_message_id is
unique; sent_emails only updated when not already replied).

Multi-brand: runs once per ACTIVE brand that has a mailbox, inside
brand_scope(brand), against THAT brand's inbox (integrations/brand_mail: brand 1
= the legacy .gmail_tokens mailbox) and THAT brand's sent threads only.
Brands without a mailbox are skipped. New-reply notifications go to
brands.sender.reply_notify_to, else (brand 1 only) env NOTIFY_TO, else
brands.sender.alert_to, else the brand's own mailbox.

Env: APPLY=1 to write (default 0 = detect only), DAYS=180 lookback,
     NOTIFY_TO (brand-1 notification recipient), DASHBOARD_URL (link base).
     BRAND_ID=<id|slug> to process a single brand (default: all active brands).
"""
import os, sys, re, base64, traceback
from datetime import datetime, timezone
sys.path.insert(0, "/app")
from database.client import get_supabase_admin_client
from database.pg import execute_sql
from database import tenancy
from database import brands as brandcat
from database.tenancy import brand_scope
from integrations.brand_mail import get_brand_gmail_client, describe_brand_mailbox

APPLY = os.getenv("APPLY", "0") == "1"
NOTIFY_TO = os.getenv("NOTIFY_TO") or None          # env only; no hard-coded recipient
DASHBOARD_URL = os.getenv("DASHBOARD_URL", "https://utilizereach.example.com").rstrip("/")


def brand_notify_settings(brand, mailbox):
    """(notify_to, label, replies_url) for a brand."""
    to = (brandcat.sender_value(brand, "reply_notify_to", "NOTIFY_TO", None, env_for_all_brands=False)
          or brandcat.sender_value(brand, "alert_to", None, None) or mailbox)
    if brandcat.is_default_brand(brand):
        base = brandcat.sender_value(brand, "dashboard_url", None, DASHBOARD_URL).rstrip("/")
        return to, "utilizereach", f"{base}/replies"
    host = (brand.get("hostnames") or [None])[0]
    base = brandcat.sender_value(brand, "dashboard_url", None,
                                 f"https://{host}" if host else DASHBOARD_URL).rstrip("/")
    return to, (brand.get("display_name") or brand["slug"]), f"{base}/replies"


def notify_team(g, items, notify_to=None, label="utilizereach", replies_url=None):
    """Email the team a summary of newly-detected replies."""
    if not items:
        return
    notify_to = notify_to or NOTIFY_TO or g.email
    if not notify_to:
        print("notify skipped: no recipient (set NOTIFY_TO or brands.sender.reply_notify_to)")
        return
    replies_url = replies_url or f"{DASHBOARD_URL}/replies"
    from email.mime.text import MIMEText
    li = "".join(
        f"<li style='margin-bottom:8px'><b>{i['from']}</b> replied to <b>{i['persona']}</b>"
        f"<br><span style='color:#555'>{(i['subject'] or '(no subject)')}</span>"
        f"<br><span style='color:#888;font-size:13px'>{(i['snippet'] or '')[:180]}</span></li>"
        for i in items)
    n = len(items)
    html = (f"<p>You have <b>{n}</b> new repl{'y' if n == 1 else 'ies'} to your {label} outreach:</p>"
            f"<ul>{li}</ul>"
            f"<p><a href='{replies_url}'>Open the Replies inbox →</a></p>")
    msg = MIMEText(html, "html")
    msg["To"] = notify_to
    msg["From"] = g.email or notify_to
    msg["Subject"] = f"🔔 {n} new repl{'y' if n == 1 else 'ies'} to {label} outreach"
    import base64 as _b64
    raw = _b64.urlsafe_b64encode(msg.as_bytes()).decode()
    try:
        g.service.users().messages().send(userId="me", body={"raw": raw}).execute()
        print(f"notified {notify_to} of {n} new replies")
    except Exception as e:
        print(f"notify failed: {e}")
DAYS = int(os.getenv("DAYS", "180"))
OURS = {f"{p}@example.com" for p in ["outreach", "nancy", "suzie", "julia", "claudia", "fatima", "noura", "reem"]}
SKIP_SENDERS = ("mailer-daemon", "postmaster", "no-reply", "noreply", "notifications@")
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


def hdr(headers, name):
    for h in headers:
        if h.get("name", "").lower() == name.lower():
            return h.get("value", "")
    return ""


def decode_body(payload):
    txt = ""
    def walk(p):
        nonlocal txt
        if p.get("mimeType") == "text/plain":
            data = p.get("body", {}).get("data")
            if data:
                try: txt += base64.urlsafe_b64decode(data + "===").decode("utf-8", "ignore")
                except Exception: pass
        for sub in p.get("parts", []) or []:
            walk(sub)
    walk(payload)
    if not txt:  # fallback to snippet-less html strip
        data = payload.get("body", {}).get("data")
        if data:
            try: txt = re.sub("<[^>]+>", " ", base64.urlsafe_b64decode(data + "===").decode("utf-8", "ignore"))
            except Exception: pass
    return txt.strip()[:4000]


def our_addresses(brand, g):
    """Addresses that are US for this brand (never counted as replies)."""
    bid = tenancy.require_brand()
    ours = set(OURS) if brandcat.is_default_brand(brand) else set()
    rows = execute_sql("SELECT lower(email) e FROM email_accounts WHERE brand_id=%s", [bid]) or []
    ours |= {r["e"] for r in rows if r.get("e")}
    if g.email:
        ours.add(g.email.lower())
    return ours


def run_brand(brand, mailbox=None):
    """Detect (and with APPLY=1 record) replies for the ACTIVE brand."""
    bid = tenancy.require_brand()
    sb = get_supabase_admin_client()
    # thread_id -> sent_email row
    rows = execute_sql("SELECT id, recipient_email, from_email, campaign_id, lead_id, gmail_thread_id, replied_at "
                       "FROM sent_emails WHERE brand_id=%s AND gmail_thread_id IS NOT NULL", [bid])
    by_thread = {}
    for r in rows:
        by_thread.setdefault(r["gmail_thread_id"], r)  # first (any) sent in the thread
    print(f"sent threads tracked: {len(by_thread)}")

    g = get_brand_gmail_client(bid)
    ours = our_addresses(brand, g)

    # list INBOX message ids + threadIds (paginate)
    inbox = []
    tok = None
    while True:
        resp = g.service.users().messages().list(
            userId="me", q=f"in:inbox newer_than:{DAYS}d", maxResults=200, pageToken=tok).execute()
        inbox.extend(resp.get("messages", []))
        tok = resp.get("nextPageToken")
        if not tok:
            break
    print(f"inbox messages scanned: {len(inbox)}")

    candidates = [m for m in inbox if m.get("threadId") in by_thread]
    print(f"inbox messages in our sent threads: {len(candidates)}")

    detected = 0; new_replies = 0; newly_marked = 0
    notify_items = []
    for m in candidates:
        full = g.service.users().messages().get(userId="me", id=m["id"], format="full").execute()
        payload = full.get("payload", {})
        headers = payload.get("headers", [])
        frm = hdr(headers, "From")
        frm_email = (EMAIL_RE.search(frm) or [None])[0] if EMAIL_RE.search(frm) else None
        frm_email = frm_email.lower() if frm_email else ""
        if not frm_email or frm_email in ours or any(s in frm_email for s in SKIP_SENDERS):
            continue
        detected += 1
        sent = by_thread[m["threadId"]]
        try:
            received = datetime.fromtimestamp(int(full.get("internalDate", "0")) / 1000, timezone.utc).isoformat()
        except Exception:
            received = datetime.now(timezone.utc).isoformat()
        subject = hdr(headers, "Subject")
        frm_name = re.sub(r"<[^>]+>", "", frm).strip().strip('"') or None
        body_text = decode_body(payload)
        if not APPLY:
            print(f"  REPLY from {frm_email} -> sent {sent['recipient_email']} | {subject[:50]}")
            continue
        # insert email_replies (dedup on gmail_message_id)
        try:
            ex = sb.table("email_replies").select("id").eq("gmail_message_id", m["id"]).execute()
            if not ex.data:
                sb.table("email_replies").insert({
                    "sent_email_id": sent["id"], "campaign_id": sent.get("campaign_id"),
                    "lead_id": sent.get("lead_id"), "gmail_message_id": m["id"],
                    "gmail_thread_id": m["threadId"], "from_email": frm_email, "from_name": frm_name,
                    "subject": subject, "body_text": body_text, "received_at": received,
                }).execute()
                new_replies += 1
                notify_items.append({
                    "from": frm_name or frm_email,
                    "persona": (sent.get("from_email") or "").split("@")[0] or "your team",
                    "subject": subject, "snippet": body_text,
                })
        except Exception as e:
            print(f"  reply insert warn {frm_email}: {e}")
        # mark the sent email replied
        if not sent.get("replied_at"):
            execute_sql("UPDATE sent_emails SET replied_at=%s, status='replied' "
                        "WHERE id=%s AND brand_id=%s AND replied_at IS NULL",
                        [received, sent["id"], bid])
            newly_marked += 1

    print(f"detected replies: {detected}")
    if APPLY:
        print(f"email_replies inserted: {new_replies} | sent_emails newly marked replied: {newly_marked}")
        if notify_items:
            to, label, url = brand_notify_settings(brand, mailbox or g.email)
            notify_team(g, notify_items, notify_to=to, label=label, replies_url=url)


def selected_brands():
    ref = (os.getenv("BRAND_ID") or "").strip()
    if ref:
        b = brandcat.get_brand(ref)
        if not b:
            raise SystemExit(f"reply_handler: unknown BRAND_ID {ref!r}")
        return [b]
    return brandcat.list_brands(active_only=True)


def main():
    failed = []
    for brand in selected_brands():
        with brand_scope(brand["id"]):
            src, mbox = describe_brand_mailbox(brand["id"])
            if not mbox:
                print(f"--- brand {brand['slug']}: no mailbox — skipped", flush=True)
                continue
            print(f"--- brand {brand['slug']} ({mbox}) ---", flush=True)
            try:
                run_brand(brand, mbox)
            except Exception:
                failed.append(brand["slug"])
                print(f"ERROR brand {brand['slug']}:\n{traceback.format_exc()}", flush=True)
    if failed:
        raise SystemExit(f"reply_handler failed for: {', '.join(failed)}")


if __name__ == "__main__":
    main()

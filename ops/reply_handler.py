"""Detect replies to our outreach and record them.

Scans the outreach@ INBOX, matches each inbound message to a sent_email by
gmail_thread_id, and (APPLY=1) inserts an email_replies row + marks the
sent_email replied_at/status='replied'. Skips our own addresses and
mailer-daemon/bounce senders. Idempotent (email_replies.gmail_message_id is
unique; sent_emails only updated when not already replied).

Env: APPLY=1 to write (default 0 = detect only), DAYS=180 lookback.
"""
import os, sys, re, base64
from datetime import datetime, timezone
sys.path.insert(0, "/app")
from database.client import get_supabase_admin_client
from database.pg import execute_sql
from api.routers.campaigns import load_gmail_tokens
from integrations.gmail_client import GmailClient

APPLY = os.getenv("APPLY", "0") == "1"
NOTIFY_TO = os.getenv("NOTIFY_TO", "alerts@example.com")


def notify_team(g, items):
    """Email the team a summary of newly-detected replies."""
    if not items:
        return
    from email.mime.text import MIMEText
    li = "".join(
        f"<li style='margin-bottom:8px'><b>{i['from']}</b> replied to <b>{i['persona']}</b>"
        f"<br><span style='color:#555'>{(i['subject'] or '(no subject)')}</span>"
        f"<br><span style='color:#888;font-size:13px'>{(i['snippet'] or '')[:180]}</span></li>"
        for i in items)
    n = len(items)
    html = (f"<p>You have <b>{n}</b> new repl{'y' if n == 1 else 'ies'} to your utilizereach outreach:</p>"
            f"<ul>{li}</ul>"
            f"<p><a href='https://utilizereach.example.com/replies'>Open the Replies inbox →</a></p>")
    msg = MIMEText(html, "html")
    msg["To"] = NOTIFY_TO
    msg["From"] = g.email or "outreach@example.com"
    msg["Subject"] = f"🔔 {n} new repl{'y' if n == 1 else 'ies'} to utilizereach outreach"
    import base64 as _b64
    raw = _b64.urlsafe_b64encode(msg.as_bytes()).decode()
    try:
        g.service.users().messages().send(userId="me", body={"raw": raw}).execute()
        print(f"notified {NOTIFY_TO} of {n} new replies")
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


def main():
    sb = get_supabase_admin_client()
    # thread_id -> sent_email row
    rows = execute_sql("SELECT id, recipient_email, from_email, campaign_id, lead_id, gmail_thread_id, replied_at "
                       "FROM sent_emails WHERE gmail_thread_id IS NOT NULL")
    by_thread = {}
    for r in rows:
        by_thread.setdefault(r["gmail_thread_id"], r)  # first (any) sent in the thread
    print(f"sent threads tracked: {len(by_thread)}")

    t = load_gmail_tokens()
    g = GmailClient(email=t.get("GMAIL_EMAIL"), refresh_token=t.get("GMAIL_REFRESH_TOKEN"),
                    access_token=t.get("GMAIL_ACCESS_TOKEN"))

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
        if not frm_email or frm_email in OURS or any(s in frm_email for s in SKIP_SENDERS):
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
            execute_sql("UPDATE sent_emails SET replied_at=%s, status='replied' WHERE id=%s AND replied_at IS NULL",
                        [received, sent["id"]])
            newly_marked += 1

    print(f"detected replies: {detected}")
    if APPLY:
        print(f"email_replies inserted: {new_replies} | sent_emails newly marked replied: {newly_marked}")
        if notify_items:
            notify_team(g, notify_items)


if __name__ == "__main__":
    main()

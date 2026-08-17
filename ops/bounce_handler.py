"""Find hard bounces in the outreach@ inbox and (optionally) quarantine them.

Scans recent Delivery Status Notification / mailer-daemon messages, extracts
the failed recipient addresses that match our own sent recipients, and with
APPLY=1: marks sent_emails bounced, adds email_exclusions, and sets the lead
status to 'invalid' so the sender never retries them.

Env: APPLY=1 to write changes (default 0 = detect only).
"""
import os, sys, re, base64
sys.path.insert(0, "/app")
from database.client import get_supabase_admin_client
from database.pg import execute_sql
from api.routers.campaigns import load_gmail_tokens
from integrations.gmail_client import GmailClient

APPLY = os.getenv("APPLY", "0") == "1"
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")

def decode_parts(payload):
    txt = ""
    def walk(p):
        nonlocal txt
        body = p.get("body", {})
        data = body.get("data")
        if data:
            try: txt += base64.urlsafe_b64decode(data + "===").decode("utf-8", "ignore")
            except Exception: pass
        for sub in p.get("parts", []) or []:
            walk(sub)
    walk(payload)
    return txt

def main():
    sb = get_supabase_admin_client()
    t = load_gmail_tokens()
    g = GmailClient(email=t.get("GMAIL_EMAIL"), refresh_token=t.get("GMAIL_REFRESH_TOKEN"),
                    access_token=t.get("GMAIL_ACCESS_TOKEN"))

    # our own sent recipients (lowercased) to match against bounce bodies
    rows = execute_sql("SELECT DISTINCT lower(recipient_email) e FROM sent_emails WHERE recipient_email IS NOT NULL")
    ours = {r["e"] for r in rows if r["e"]}
    print(f"known sent recipients: {len(ours)}")

    q = ('newer_than:5d (from:mailer-daemon OR from:postmaster OR '
         'subject:"Delivery Status Notification" OR subject:"Undeliverable" OR '
         'subject:"Delivery incomplete" OR subject:"Address not found")')
    res = g.service.users().messages().list(userId="me", q=q, maxResults=50).execute()
    msgs = res.get("messages", [])
    print(f"bounce-like messages found: {len(msgs)}")

    bounced = {}   # addr -> reason snippet
    for m in msgs:
        full = g.service.users().messages().get(userId="me", id=m["id"], format="full").execute()
        body = decode_parts(full.get("payload", {}))
        # DSN final recipient is most reliable
        finals = re.findall(r"Final-Recipient:\s*rfc822;\s*([^\s]+)", body, re.I)
        cand = set(a.strip().lower().strip("<>") for a in finals)
        # also any of our recipients mentioned in the body
        for a in EMAIL_RE.findall(body):
            al = a.lower()
            if al in ours:
                cand.add(al)
        # reason
        reason = ""
        mreason = re.search(r"(550[^\n]{0,120}|[Aa]ddress not found|couldn't be found|does not exist|user unknown|mailbox unavailable)", body)
        if mreason: reason = mreason.group(0).strip()[:100]
        for a in cand:
            if a in ours:
                bounced[a] = reason or "hard bounce"

    print(f"\n=== {len(bounced)} bounced recipient(s) matched to our sends ===")
    for a, r in bounced.items():
        print(f"  {a}  |  {r}")

    if not bounced:
        print("nothing to quarantine"); return
    if not APPLY:
        print("\n(dry run — set APPLY=1 to quarantine these)"); return

    for a, r in bounced.items():
        try:
            execute_sql("UPDATE sent_emails SET status='bounced', bounced_at=NOW() "
                        "WHERE lower(recipient_email)=%s AND bounced_at IS NULL", [a])
            execute_sql("UPDATE scraped_leads SET status='invalid' WHERE lower(email)=%s", [a])
            ex = sb.table("email_exclusions").select("id").eq("email", a).execute()
            if not ex.data:
                sb.table("email_exclusions").insert({
                    "email": a, "reason": f"Hard bounce: {r}", "excluded_by": "bounce_handler"}).execute()
            print(f"  quarantined {a}")
        except Exception as e:
            print(f"  ERROR {a}: {e}")
    print("done")

if __name__ == "__main__":
    main()

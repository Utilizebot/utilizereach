"""Smart, paced warmup sender — campaign-aware, with A/B variants.

Each tick it prefers an ACTIVE campaign (status='active', not yet at target,
has variants): pulls one un-emailed lead from the campaign's segment, assigns
an A/B variant (even split), personalizes it, sends it tagged with campaign_id
+ variant + persona, and marks the lead contacted. If no active campaign, it
falls back to a plain segment drip using the built-in persona templates.

Paced: one email every MIN_GAP-MAX_GAP seconds, business hours (MYT) only,
daily cap, self-balancing across the 7 personas. Idempotent (never double
sends). Env: SEND, SEGMENTS, MIN_GAP, MAX_GAP, DAILY_CAP, START_HOUR,
END_HOUR, MAX_TOTAL.
"""
import os, sys, uuid, time, re, random
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse, urlencode, parse_qsl, urlunparse

sys.path.insert(0, "/app")
from database.client import get_supabase_admin_client
from database.pg import execute_sql
from config import get_email_team
from integrations.gmail_client import GmailClient
from api.routers.campaigns import load_gmail_tokens
from integrations.email_verifier import EmailVerifier

_verifier = EmailVerifier()

SEND = os.getenv("SEND", "0") == "1"
FALLBACK_SEGMENTS = [s.strip() for s in os.getenv("SEGMENTS", "shiraz_cards,mii_cards").split(",") if s.strip()]
MIN_GAP = int(os.getenv("MIN_GAP", "720"))
MAX_GAP = int(os.getenv("MAX_GAP", "1200"))
DAILY_CAP = int(os.getenv("DAILY_CAP", "20"))
START_HOUR = int(os.getenv("START_HOUR", "9"))
END_HOUR = int(os.getenv("END_HOUR", "18"))
MAX_TOTAL = int(os.getenv("MAX_TOTAL", "0"))
RAMP = os.getenv("RAMP", "0") == "1"          # auto warmup ramp (ignores DAILY_CAP/MAX_TOTAL)
RAMP_SCHEDULE = [20, 30, 45, 60, 80]          # per-day cap by week since first send
BACKEND_URL = os.getenv("BACKEND_URL", "https://utilizereach.example.com")
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
MYT = timezone(timedelta(hours=8))
CTA = "https://example.com"
UNSUB_SALT = "utilizereach-unsub-v1"  # keep in sync with backend/api/routers/unsubscribe.py

def unsub_footer(email):
    import hashlib
    e = (email or "").strip().lower()
    tok = hashlib.sha256((e + UNSUB_SALT).encode()).hexdigest()[:12]
    link = f"{BACKEND_URL}/api/unsubscribe?e={e}&t={tok}"
    return (f'<p style="color:#9ca3af;font-size:11px;margin-top:18px">'
            f'If you would rather not hear from us, '
            f'<a href="{link}" style="color:#9ca3af">unsubscribe</a>.</p>')

def now_myt(): return datetime.now(timezone.utc).astimezone(MYT)

def first_name(name):
    n = (name or "").strip()
    for h in ["Tan Sri", "Dato' Sri", "Dato'", "Datuk", "Dr.", "Ir.", "Ts.", "Y.B.", "Mr.", "Ms.", "Mrs.", "Prof."]:
        if n.startswith(h): n = n[len(h):].strip()
    return (n.split()[0] if n else "there")

def clean_company(c):
    c = (c or "").strip()
    c = re.sub(r"\s*\([^)]*\d[^)]*\)", "", c)          # drop reg-number parentheticals
    c = re.sub(r"\s+", " ", c).strip().rstrip(".,")
    return c

def co_clause(c): return f" over at {c}" if c else ""

# Built-in persona templates (fallback / no-campaign drip)
def persona_template(persona, fn, company):
    c = company or "your team"
    v = {
        "Nancy": ("A quick idea for your meetings", f"<p>Hi {fn},</p><p>I came across your work{co_clause(company)} and wanted to reach out personally. I lead business development at example.com, and I keep meeting leaders who lose hours every week turning meetings into notes by hand.</p><p>We turn every meeting into an accurate transcript, summary and action list, in Malay and English. I'd love to hear how {c} runs its meetings today.</p><p>Open to a quick chat?</p>"),
        "Suzie": ("Malay + English meeting notes, handled", f"<p>Hi {fn},</p><p>Quick one from the solutions side at example.com. For a team like {c}, here is what we do:</p><p>1. Record or upload a meeting.<br>2. Get an accurate transcript in Malay and English.<br>3. Get a summary and a clear action-item list to share.</p><p>Happy to send a real sample summary so you can judge the quality.</p>"),
        "Julia": ("Getting your team set up with utilizereach", f"<p>Hi {fn},</p><p>I look after customer success at example.com, so my job is making sure teams get value fast. Most are capturing their first meeting within a day: transcript, summary and action items in Malay and English, ready to share.</p><p>I'd be glad to set it up with {c} and walk your team through it. Would a short call work?</p>"),
        "Claudia": ("A partnership angle for your team", f"<p>Hi {fn},</p><p>I handle partnerships at example.com. Your work{co_clause(company)} stood out to me and I think there is a natural fit worth exploring.</p><p>utilizereach turns meetings into accurate transcripts, summaries and action items in Malay and English. Could we find fifteen minutes to compare notes?</p>"),
        "Fatima": ("Cut the meeting admin", f"<p>Hi {fn},</p><p>Straight to it. Meetings eat time. Notes eat more.</p><p>utilizereach gives {c} the transcript, the summary and the action items automatically, in Malay and English. Your people stay in the conversation, not in note-taking.</p><p>Fifteen minutes and I'll show you how.</p>"),
        "Noura": ("How accurate is your meeting transcription?", f"<p>Hi {fn},</p><p>Honest question: when {c} transcribes a mixed Malay and English meeting today, how much do you end up fixing by hand?</p><p>That gap is exactly what we built utilizereach to solve, accurate transcripts, summaries and action items across both languages, without the clean-up. Happy to show the accuracy on a real sample.</p>"),
        "Reem": ("Let's get your first meeting into utilizereach", f"<p>Hi {fn},</p><p>I help new teams get going with example.com, and the first meeting is the fun part. You bring a recording, we hand back a tidy transcript, summary and action list in Malay and English. That is usually the moment it clicks.</p><p>Want me to set {c} up so you can try it on a real meeting?</p>"),
    }
    subj, body = v.get(persona, ("A quick idea for your meetings", f"<p>Hi {fn},</p><p>example.com turns meetings into accurate transcripts, summaries and action items in Malay and English.</p>"))
    return subj, body

def render(subject, body, fn, company, persona, append=True):
    company = company or "your team"
    subject = subject.replace("{first_name}", fn).replace("{company}", company)
    body = body.replace("{first_name}", fn).replace("{company}", company).replace("{persona}", persona)
    if append:  # only for the fallback drip; campaign variants are self-contained
        if "example.com" not in body and CTA not in body:
            body += f'<p><a href="{CTA}">See how utilizereach works</a></p>'
        if f">{persona}<" not in body and f"{persona}</p>" not in body:
            body += f"<p>{persona}</p>"
    return subject, body

def text_of(h): return re.sub("<[^>]+>", " ", h)

def _slug(s): return re.sub(r"[^a-z0-9]+", "_", (s or "").lower()).strip("_")

def add_utms(html, campaign, variant, persona):
    """Append UTM params to any example.com link so GA4 attributes the visit to
    this campaign / A-B variant / persona."""
    utms = {
        "utm_source": "utilizereach-outreach",
        "utm_medium": "email",
        "utm_campaign": _slug(campaign) if campaign else "warmup_drip",
        "utm_content": (variant or "na").lower(),
        "utm_term": _slug(persona),
    }
    def repl(m):
        url = m.group(1)
        if "example.com" not in url:
            return m.group(0)
        p = urlparse(url)
        q = dict(parse_qsl(p.query)); q.update(utms)
        return 'href="' + urlunparse(p._replace(query=urlencode(q))) + '"'
    return re.sub(r'href="([^"]+)"', repl, html)

def active_campaign(sb):
    rows = execute_sql("SELECT * FROM campaigns WHERE status='active' ORDER BY created_at ASC")
    for c in (rows or []):
        variants = c.get("variants") or []
        if not variants or not c.get("segment"):
            continue
        s = execute_sql("SELECT count(*) n FROM sent_emails WHERE campaign_id=%s", [c["id"]])
        sent = (s[0]["n"] if s else 0) or 0
        target = c.get("target_count") or 0
        if target == 0 or sent < target:
            c["_sent"] = sent
            return c
    return None

def next_lead(segs):
    ph = ",".join(["%s"] * len(segs))
    rows = execute_sql(
        f"SELECT id, email, decision_maker_name AS name, company_name AS company FROM scraped_leads "
        f"WHERE segment IN ({ph}) AND status='new' AND email IS NOT NULL "
        f"AND NOT EXISTS (SELECT 1 FROM sent_emails s WHERE lower(s.recipient_email)=lower(scraped_leads.email)) "
        f"ORDER BY created_at ASC LIMIT 25", segs)
    for r in rows:
        email = (r["email"] or "").strip()
        if not EMAIL_RE.match(email):
            continue
        # domain/format verification (MX) — skip dead/typo domains before sending
        try:
            v = _verifier.verify_email(email, check_smtp=False)
            if not v.get("is_valid", True):
                execute_sql("UPDATE scraped_leads SET status='invalid' WHERE id=%s", [r["id"]])
                print(f"    skip invalid domain {email}: {v.get('recommendation')}", flush=True)
                continue
        except Exception:
            pass  # verifier hiccup -> don't block, let it send
        r["name"] = (r["name"] or "").replace(",", "")
        return r
    return None

def pick_persona(team):
    emails = [p["email"] for p in team]
    ph = ",".join(["%s"] * len(emails))
    rows = execute_sql(f"SELECT from_email, count(*) n FROM sent_emails WHERE from_email IN ({ph}) GROUP BY from_email", emails)
    counts = {r["from_email"]: r["n"] for r in rows}
    return sorted(team, key=lambda p: counts.get(p["email"], 0))[0]

def sleep_until_window():
    while True:
        t = now_myt()
        if START_HOUR <= t.hour < END_HOUR: return
        nxt = t.replace(hour=START_HOUR, minute=0, second=0, microsecond=0)
        if t.hour >= END_HOUR: nxt += timedelta(days=1)
        secs = max(60, int((nxt - t).total_seconds()))
        print(f"[{t:%m-%d %H:%M} MYT] outside window, sleeping {secs//60}m", flush=True)
        time.sleep(min(secs, 1800))

def ramp_cap(sb):
    """Warmup ramp: per-day cap grows by week since the first-ever send."""
    r = execute_sql("SELECT min(sent_at) m FROM sent_emails")
    first = r[0]["m"] if r else None
    if not first or not hasattr(first, "tzinfo"):
        return RAMP_SCHEDULE[0]
    weeks = max(0, (datetime.now(timezone.utc) - first).days // 7)
    return RAMP_SCHEDULE[min(weeks, len(RAMP_SCHEDULE) - 1)]


def _fu_campaigns(sb):
    return execute_sql(
        "SELECT id, name, followups FROM campaigns WHERE status IN ('active','completed') "
        "AND jsonb_array_length(COALESCE(followups,'[]'::jsonb)) > 0") or []


def next_followup(sb):
    """Return the single most-due follow-up to send, or None. A follow-up is due
    when a campaign recipient has received touch #k, step k exists, enough days
    have passed, and they haven't replied / bounced / unsubscribed."""
    camps = _fu_campaigns(sb)
    if not camps:
        return None
    fu_by = {c["id"]: (c.get("followups") or []) for c in camps}
    name_by = {c["id"]: c["name"] for c in camps}
    ids = list(fu_by.keys())
    ph = ",".join(["%s"] * len(ids))
    rows = execute_sql(
        f"SELECT recipient_email, recipient_name, campaign_id, count(*) touches, "
        f"max(sent_at) last_sent, bool_or(replied_at IS NOT NULL) replied, "
        f"bool_or(bounced_at IS NOT NULL) bounced, "
        f"(array_agg(from_email ORDER BY sent_at DESC))[1] last_persona "
        f"FROM sent_emails WHERE campaign_id IN ({ph}) AND recipient_email IS NOT NULL "
        f"GROUP BY recipient_email, recipient_name, campaign_id", ids) or []
    exc = {(r["email"] or "").lower() for r in (execute_sql("SELECT email FROM email_exclusions") or []) if r.get("email")}
    now = datetime.now(timezone.utc)
    best = None
    for r in rows:
        if r["replied"] or r["bounced"]:
            continue
        email = (r["recipient_email"] or "").lower()
        if not email or email in exc:
            continue
        fus = fu_by[r["campaign_id"]]
        idx = (r["touches"] or 1) - 1          # touch #1 = initial -> next follow-up index 0
        if idx < 0 or idx >= len(fus):
            continue
        last = r["last_sent"]
        if not hasattr(last, "tzinfo"):
            continue
        after = int(fus[idx].get("after_days", 4) or 4)
        if (now - last).total_seconds() < after * 86400:
            continue
        if best is None or r["last_sent"] < best["last_sent"]:
            best = {"email": email, "name": r["recipient_name"], "campaign_id": r["campaign_id"],
                    "campaign_name": name_by[r["campaign_id"]], "step": fus[idx], "idx": idx,
                    "persona_email": r["last_persona"], "last_sent": r["last_sent"]}
    return best


def do_send(gmail, sb, lead, persona, subj, body, campaign_id, variant_label, line):
    """Send one email, tag its variant precisely (by tracking token), mark the
    lead contacted (only for initial sends that carry a lead id). Returns bool."""
    tok = str(uuid.uuid4())
    try:
        res = gmail.send_email(to_email=lead["email"], to_name=(lead.get("name") or None), subject=subj,
                               body_html=body, body_text=text_of(body), tracking_token=tok,
                               backend_url=BACKEND_URL, save_to_db=True, campaign_id=campaign_id,
                               from_email=persona["email"], from_name=persona["name"])
        if res.get("success"):
            if variant_label:
                execute_sql("UPDATE sent_emails SET variant=%s WHERE tracking_token=%s", [variant_label, tok])
            if lead.get("id"):
                sb.table("scraped_leads").update({"status": "contacted"}).eq("id", lead["id"]).execute()
            print(line + " -> SENT", flush=True)
            return True
        if lead.get("id"):
            sb.table("scraped_leads").update({"status": "invalid"}).eq("id", lead["id"]).execute()
        print(line + f" -> FAIL {res.get('error')}", flush=True)
    except Exception as e:
        if lead.get("id"):
            sb.table("scraped_leads").update({"status": "invalid"}).eq("id", lead["id"]).execute()
        print(line + f" -> ERROR {e}", flush=True)
    return False


def main():
    sb = get_supabase_admin_client()
    team = get_email_team()
    tokens = load_gmail_tokens()
    gmail = GmailClient(email=tokens.get("GMAIL_EMAIL"), refresh_token=tokens.get("GMAIL_REFRESH_TOKEN"),
                        access_token=tokens.get("GMAIL_ACCESS_TOKEN")) if SEND else None
    cap = ramp_cap(sb) if RAMP else DAILY_CAP
    max_total = cap if RAMP else MAX_TOTAL
    print(f"smart sender | gap={MIN_GAP}-{MAX_GAP}s cap={cap}/day (ramp={RAMP}) window={START_HOUR}-{END_HOUR} MYT "
          f"fallback_segments={FALLBACK_SEGMENTS} send={SEND}", flush=True)
    sent_today, day, total = 0, now_myt().date(), 0
    while True:
        if max_total and total >= max_total:
            print("reached daily target, stop", flush=True); break
        if now_myt().date() != day:
            day, sent_today = now_myt().date(), 0
        if sent_today >= cap:
            t = now_myt(); nxt = (t + timedelta(days=1)).replace(hour=START_HOUR, minute=0, second=0, microsecond=0)
            print(f"[{t:%H:%M} MYT] daily cap {cap} hit, sleeping to tomorrow", flush=True)
            time.sleep(min(int((nxt - t).total_seconds()), 3600)); continue
        sleep_until_window()

        # 1) a due follow-up takes priority (time-sensitive)
        fu = next_followup(sb)
        if fu:
            persona = next((p for p in team if p["email"] == fu["persona_email"]), None) or pick_persona(team)
            fn = first_name(fu["name"]); company = ""
            lk = execute_sql("SELECT decision_maker_name name, company_name company "
                             "FROM scraped_leads WHERE lower(email)=%s LIMIT 1", [fu["email"]])
            if lk:
                fn = first_name(lk[0].get("name") or fu["name"]); company = clean_company(lk[0].get("company"))
            lead = {"id": None, "email": fu["email"], "name": fu["name"]}
            campaign_id, variant_label = fu["campaign_id"], f"F{fu['idx'] + 1}"
            src = f"followup#{fu['idx'] + 1} '{fu['campaign_name']}'"
            subj, body = render(fu["step"].get("subject", "Following up"),
                                fu["step"].get("body", "<p>Hi {first_name},</p>"), fn, company, persona["name"], append=True)
            body = add_utms(body, fu["campaign_name"], variant_label, persona["name"])
            body += unsub_footer(fu["email"])
        else:
            # 2) otherwise a new campaign send, else the fallback drip
            camp = active_campaign(sb)
            if camp:
                lead = next_lead([camp["segment"]])
                if not lead:
                    execute_sql("UPDATE campaigns SET status='completed' WHERE id=%s", [camp["id"]])
                    print(f"campaign '{camp['name']}' segment exhausted -> completed", flush=True); continue
                v = camp["variants"][camp["_sent"] % len(camp["variants"])]
                campaign_id, variant_label = camp["id"], v.get("label")
                src = f"campaign '{camp['name']}' [{variant_label}]"
                persona = pick_persona(team)
                fn = first_name(lead.get("name")); company = clean_company(lead.get("company"))
                subj, body = render(v.get("subject", "A quick note"), v.get("body", "<p>Hi {first_name},</p>"),
                                    fn, company, persona["name"], append=False)
                body = add_utms(body, camp["name"], variant_label, persona["name"])
                body += unsub_footer(lead["email"])
            else:
                lead = next_lead(FALLBACK_SEGMENTS)
                if not lead:
                    print("nothing to send (no follow-up, no active campaign, no drip leads) — idle", flush=True); break
                campaign_id, variant_label, src = None, None, "drip"
                persona = pick_persona(team)
                fn = first_name(lead.get("name")); company = clean_company(lead.get("company"))
                ps, pb = persona_template(persona["name"], fn, company)
                subj, body = render(ps, pb, fn, company, persona["name"])
                body = add_utms(body, None, None, persona["name"])
                body += unsub_footer(lead["email"])

        stamp = now_myt().strftime("%m-%d %H:%M")
        line = f"[{stamp} MYT] {src} | {persona['name']:<7} -> {lead.get('name') or '(no name)'} <{lead['email']}> | \"{subj}\""
        if not SEND:
            print("PLAN " + line, flush=True); total += 1; sent_today += 1
            if total >= 8: print("(dry run)"); break
            continue
        if do_send(gmail, sb, lead, persona, subj, body, campaign_id, variant_label, line):
            sent_today += 1; total += 1
        gap = random.randint(MIN_GAP, MAX_GAP)
        print(f"    next in {gap//60}m{gap%60:02d}s", flush=True)
        time.sleep(gap)

if __name__ == "__main__":
    main()

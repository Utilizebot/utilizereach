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

Multi-brand (docs/MULTIBRAND.md): one process sends for ONE brand.
  BRAND_ID   brand id or slug; unset -> brand 1 (the default brand) with a
             warning (legacy cron compatibility). ops/run_senders.py starts one process per
             brand with sending enabled.
The whole run executes inside brand_scope(brand); every SQL statement filters
by brand_id. Pacing comes from brands.sender (daily_cap, min_gap, ...) falling
back to the env vars above; identity values (CTA, alerts, AI brief, unsubscribe
salt, UTM source/domain) come from the brand - brand 1 resolves to exactly the
previous single-brand release's values.
Alerts go to ALERT_TO (brands.sender.alert_to, else env) from ALERT_FROM
(brands.sender.alert_from, else env, else the brand's own sending mailbox);
with no recipient configured, alerts are only logged. Lock file /tmp/smart_sender_<slug>.lock
(brand 1 also holds the legacy /tmp/smart_sender.lock). SEND=0 is a dry run:
no Gmail sends and no DB writes; it prints what would be sent.
"""
import os, sys, uuid, time, re, random, json
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse, urlencode, parse_qsl, urlunparse

sys.path.insert(0, "/app")
from database.client import get_supabase_admin_client
from database.pg import execute_sql
from database import tenancy
from database import brands as brandcat
from database.tenancy import brand_scope
from config import get_email_team
from integrations.brand_mail import get_brand_gmail_client, describe_brand_mailbox
from integrations.email_verifier import EmailVerifier

_verifier = EmailVerifier()

SEND = os.getenv("SEND", "0") == "1"
FALLBACK_SEGMENTS = [s.strip() for s in os.getenv("SEGMENTS", "").split(",") if s.strip()]
MIN_GAP = int(os.getenv("MIN_GAP", "720"))
MAX_GAP = int(os.getenv("MAX_GAP", "1200"))
DAILY_CAP = int(os.getenv("DAILY_CAP", "20"))
START_HOUR = int(os.getenv("START_HOUR", "9"))
END_HOUR = int(os.getenv("END_HOUR", "18"))
MAX_TOTAL = int(os.getenv("MAX_TOTAL", "0"))
RAMP = os.getenv("RAMP", "0") == "1"          # auto warmup ramp (ignores DAILY_CAP/MAX_TOTAL)
RAMP_SCHEDULE = [20, 30, 45, 60, 80]          # per-day cap by week since first send
AI_ONLY = os.getenv("AI_ONLY", "0") == "1"    # 1 = never use the template drip (AI / variant campaigns only)
FOLLOWUP_ENGAGED_ONLY = os.getenv("FOLLOWUP_ENGAGED_ONLY", "0") == "1"  # global: only follow up with contacts who opened/clicked the prior email (per-campaign flag can also enable it)
BACKEND_URL = os.getenv("BACKEND_URL", "https://utilizereach.example.com")
ALERT_TO = os.getenv("ALERT_TO") or None             # who gets failure alerts (env / brand config only)
ALERT_FROM = os.getenv("ALERT_FROM") or None         # else the brand's own sending mailbox
_last_ai_error = ""                                     # last LLM error, for alerts
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
MYT = timezone(timedelta(hours=8))
CTA = "https://example.com"
UNSUB_SALT = "utilizereach-unsub-v1"  # keep in sync with backend/api/routers/unsubscribe.py

# ---------------------------------------------------------------------------
# Active brand. The values below are brand 1's (the previous single-brand defaults);
# configure_brand() re-resolves every brand-specific value from the brand row.
# ---------------------------------------------------------------------------
BRAND = None                                  # brand dict once configured
BRAND_ID = tenancy.DEFAULT_BRAND_ID
BRAND_SLUG = tenancy.DEFAULT_BRAND_SLUG
IS_DEFAULT_BRAND = True
SENDING_ENABLED = True
BRAND_DOMAIN = "example.com"                  # links on this domain get UTMs / count as CTA
CTA_TEXT = "See how utilizereach works"
UTM_SOURCE = "utilizereach-outreach"
UNSUB_ADD_BRAND = False                       # append &b=<brand_id> (every brand except brand 1)
ALERT_TO_NAME = None
ALERT_TAG = "utilizereach"                    # "[<tag> sender] ..." / "<tag> Sender"
TEMPLATES_ENABLED = True                      # built-in persona_template copy: brand 1 only
TZ_SQL = "'Asia/Kuala_Lumpur'"                # SQL time zone matching MYT
AI_COMPANY = "example.com"                    # brand website_domain, else display name
AI_RECIPIENT_NOTE = ""
AI_TONE = "professional"
AI_HOOK = "likely operates"
AI_DEFAULT_SUBJECT = "A quick note"
_RUN_BRAND_ID = None                          # brand resolved for this run (crash alerts)
_LOCKS = []                                   # held lock files (kept open for the run)
# dry run (SEND=0) bookkeeping: nothing is written, so remember what was planned
_DRY_LEADS, _DRY_FOLLOWUPS, _DRY_EXHAUSTED = set(), set(), set()

def unsub_footer(email):
    import hashlib
    e = (email or "").strip().lower()
    tok = hashlib.sha256((e + UNSUB_SALT).encode()).hexdigest()[:12]
    link = f"{BACKEND_URL}/api/unsubscribe?e={e}&t={tok}"
    if UNSUB_ADD_BRAND:
        link += f"&b={BRAND_ID}"
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
        if CTA and (not BRAND_DOMAIN or BRAND_DOMAIN not in body) and CTA not in body:
            body += f'<p><a href="{CTA}">{CTA_TEXT}</a></p>'
        if f">{persona}<" not in body and f"{persona}</p>" not in body:
            body += f"<p>{persona}</p>"
    return subject, body

def text_of(h): return re.sub("<[^>]+>", " ", h)

def _slug(s): return re.sub(r"[^a-z0-9]+", "_", (s or "").lower()).strip("_")

def add_utms(html, campaign, variant, persona, owner=None, account_manager=None):
    """Append UTM params to any link on the brand's domain (website_domain;
    example.com for brand 1 when unset)
    so GA4 attributes the visit to
    this campaign / A-B variant / persona, plus owner + account_manager (custom
    params) so conversions can be attributed to the lead owner and account manager."""
    utms = {
        "utm_source": UTM_SOURCE,
        "utm_medium": "email",
        "utm_campaign": _slug(campaign) if campaign else "warmup_drip",
        "utm_content": (variant or "na").lower(),
        "utm_term": _slug(persona),
    }
    if owner:
        utms["owner"] = _slug(owner)
    if account_manager:
        utms["am"] = _slug(account_manager)
    def repl(m):
        url = m.group(1)
        if not BRAND_DOMAIN or BRAND_DOMAIN not in url:
            return m.group(0)
        p = urlparse(url)
        q = dict(parse_qsl(p.query)); q.update(utms)
        return 'href="' + urlunparse(p._replace(query=urlencode(q))) + '"'
    return re.sub(r'href="([^"]+)"', repl, html)

# ---------------------------------------------------------------------------
# AI personalization: write a bespoke email per lead from a brief + lead data.
# Gated per-campaign by campaigns.ai_brief (NULL/empty -> use fixed variants).
# ---------------------------------------------------------------------------
# Neutral default brief for brand 1 (override per brand with
# brands.sender.ai_brief_default, or per campaign with campaigns.ai_brief).
DEFAULT_AI_BRIEF = (
    "We help businesses save time and work more effectively with a simple, "
    "easy-to-adopt product. Keep the message general: do not invent specific "
    "features, customers, numbers or claims that are not stated here."
)
AI_BRIEF_DEFAULT = DEFAULT_AI_BRIEF          # per brand: brands.sender.ai_brief_default

GENERIC_FOLLOWUP_ANGLES = [
    "a NEW benefit they'll care about, taken from the product context above",
    "removing friction — how quick and easy it is to try",
    "a short, polite break-up — ask if this is a priority this quarter or whether to close the loop",
]
AI_FOLLOWUP_ANGLES = list(GENERIC_FOLLOWUP_ANGLES)

def _extract_json(s):
    s = (s or "").strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[1] if "\n" in s else s[3:]
        if s.endswith("```"): s = s[:-3]
        s = s.strip()
    if s.lower().startswith("json"): s = s[4:].strip()
    i, j = s.find("{"), s.rfind("}")
    if i >= 0 and j > i: s = s[i:j + 1]
    return json.loads(s)

def ai_email(persona_name, lead_name, company, brief, kind="intro", idx=0):
    """Generate a personalized (subject, body_html) for one lead, or (None,None)
    on any failure so the caller falls back to a template. Intro-first strategy,
    short, soft CTA, industry inferred ONLY from the company name (no fabrication)."""
    global _last_ai_error
    fn = first_name(lead_name)
    co = clean_company(company) or "their company"
    brief = (brief or "").strip() or AI_BRIEF_DEFAULT
    if not brief:
        _last_ai_error = "no product brief (campaign ai_brief / brands.sender.ai_brief_default)"
        print(f"    [ai_email fallback: {_last_ai_error}]", flush=True)
        return None, None
    if kind == "intro":
        task = "Write the FIRST cold outreach email — a short introduction, NOT a pitch."
        rules = (
            "- Open with ONE short, specific line connecting the product to how a company like theirs "
            f"{AI_HOOK}. Infer their industry ONLY from the company name; do NOT invent facts, "
            "recent events, names, numbers, or anything you don't actually know.\n"
            "- One line on what the product does.\n"
            "- End with ONE soft, low-pressure question as the CTA (invite a reply — never 'book a demo now').\n"
            f"- Max 80 words. Warm, human, {AI_TONE}. No hard-sell, no pricing, no bullet lists, no links.")
        subj_hint = "a short specific subject, max 6 words, no ALL-CAPS, no 'free'/'guarantee'."
    else:
        angles = AI_FOLLOWUP_ANGLES
        angle = angles[min(idx, len(angles) - 1)]
        task = f"Write a SHORT follow-up email (touch #{idx + 2}). Do NOT repeat the intro. New angle: {angle}."
        rules = ("- Max 45 words. One idea, one soft question CTA. Warm, human. "
                 "No hard-sell, no pricing, no bullet lists, no links.")
        subj_hint = "a very short subject, max 5 words."
    prompt = (
        f"You are {persona_name}, a friendly business-development person at {AI_COMPANY} writing to "
        f"{fn} at \"{co}\"{AI_RECIPIENT_NOTE}.\n\n"
        f"PRODUCT / CONTEXT:\n{brief}\n\n"
        f"TASK: {task}\n\nRULES:\n{rules}\n"
        f"- Address them by first name ({fn}). Sign off with just your first name ({persona_name}).\n"
        f"- Body as simple HTML using only <p>, <strong>, <br>. No <html>/<head>, no styles, no images, no links.\n\n"
        f"Return ONLY valid JSON with keys \"subject\" and \"body_html\". Subject: {subj_hint}\n"
        f"No markdown fences, no commentary.")
    try:
        from integrations.llm_client import get_llm_client
        content, _ = get_llm_client()._complete(prompt, max_tokens=700)
        d = _extract_json(content)
        subj = (d.get("subject") or "").strip().strip('"')
        body = (d.get("body_html") or "").strip()
        wc = len(text_of(body).split())
        if not body or "{" in body or "http" in body.lower() or wc > 130 or wc < 8:
            raise ValueError(f"guardrail wc={wc}")
        return subj, body
    except Exception as e:
        _last_ai_error = str(e)[:240]
        print(f"    [ai_email fallback: {e}]", flush=True)
        return None, None


def _bid():
    """The brand this run sends for (fails closed if none is active)."""
    return tenancy.require_brand()


def _campaign_eligible(c):
    if c.get("id") in _DRY_EXHAUSTED:          # dry run: segment already planned to exhaustion
        return False
    variants = c.get("variants") or []
    if AI_ONLY and not c.get("ai_brief") and not variants:
        return False
    if not c.get("segment") or (not variants and not c.get("ai_brief")):
        return False
    s = execute_sql("SELECT count(*) n FROM sent_emails WHERE campaign_id=%s AND brand_id=%s", [c["id"], _bid()])
    sent = (s[0]["n"] if s else 0) or 0
    target = c.get("target_count") or 0
    if target > 0 and sent >= target:
        return False
    c["_sent"] = sent
    return True

def reserved_persona_emails():
    """Emails of personas locked to a specific active campaign via email_account_id."""
    bid = _bid()
    rows = execute_sql(
        "SELECT ea.email FROM email_accounts ea "
        "JOIN campaigns c ON c.email_account_id = ea.id AND c.brand_id = ea.brand_id "
        "WHERE c.status='active' AND c.email_account_id IS NOT NULL "
        "AND c.brand_id=%s AND ea.brand_id=%s", [bid, bid]
    ) or []
    return {r["email"] for r in rows}

def active_persona_campaign(team, capped):
    """Return (campaign, persona) for a persona-assigned campaign whose persona has daily capacity."""
    rows = execute_sql("SELECT * FROM campaigns WHERE status='active' AND email_account_id IS NOT NULL "
                       "AND brand_id=%s ORDER BY created_at ASC", [_bid()]) or []
    print(f"[persona-camp] found {len(rows)} persona-assigned campaign(s)", flush=True)
    for c in rows:
        eligible = _campaign_eligible(c)
        print(f"[persona-camp] '{c['name']}' eligible={eligible}", flush=True)
        if not eligible:
            continue
        acc = execute_sql("SELECT email FROM email_accounts WHERE id=%s AND brand_id=%s", [c["email_account_id"], _bid()])
        if not acc:
            print(f"[persona-camp] no account found for id={c['email_account_id']}", flush=True)
            continue
        acc_email = acc[0]["email"]
        camp_team = [p for p in team if p["email"] == acc_email]
        persona = pick_persona(camp_team, capped)
        print(f"[persona-camp] acc_email={acc_email} camp_team={len(camp_team)} persona={persona['email'] if persona else None}", flush=True)
        if persona:
            return c, persona
    return None, None

def active_campaign(sb, exclude_reserved=False):
    reserved = reserved_persona_emails() if exclude_reserved else set()
    rows = execute_sql("SELECT * FROM campaigns WHERE status='active' AND email_account_id IS NULL "
                       "AND brand_id=%s ORDER BY created_at ASC", [_bid()])
    for c in (rows or []):
        if not _campaign_eligible(c):
            continue
        c["_reserved_emails"] = reserved
        return c
    return None

def next_lead(segs):
    if not segs:
        return None
    bid = _bid()
    ph = ",".join(["%s"] * len(segs))
    # suppression: this brand's sends / exclusions / unsubscribes + the global
    # (cross-brand) suppression list (hard bounces, complaints).
    rows = execute_sql(
        f"SELECT id, email, decision_maker_name AS name, company_name AS company, owner, account_manager, segment FROM scraped_leads "
        f"WHERE scraped_leads.brand_id=%s AND segment IN ({ph}) AND status='new' AND email IS NOT NULL "
        f"AND NOT EXISTS (SELECT 1 FROM sent_emails s WHERE s.brand_id=%s AND lower(s.recipient_email)=lower(scraped_leads.email)) "
        f"AND NOT EXISTS (SELECT 1 FROM email_exclusions x WHERE x.brand_id=%s AND lower(x.email)=lower(scraped_leads.email)) "
        f"AND NOT EXISTS (SELECT 1 FROM email_unsubscribes u WHERE u.brand_id=%s AND lower(u.email)=lower(scraped_leads.email)) "
        f"AND NOT EXISTS (SELECT 1 FROM global_suppression g WHERE lower(g.email)=lower(scraped_leads.email)) "
        f"ORDER BY created_at ASC, id ASC LIMIT 25", [bid] + list(segs) + [bid, bid, bid])
    for r in rows:
        email = (r["email"] or "").strip()
        if not EMAIL_RE.match(email):
            continue
        if not SEND and email.lower() in _DRY_LEADS:
            continue                            # dry run: already planned this run
        # domain/format verification (MX) — skip dead/typo domains before sending
        try:
            v = _verifier.verify_email(email, check_smtp=False)
            if not v.get("is_valid", True):
                if SEND:
                    execute_sql("UPDATE scraped_leads SET status='invalid' WHERE id=%s AND brand_id=%s", [r["id"], bid])
                else:
                    _DRY_LEADS.add(email.lower())
                    print("    (dry run: would mark lead invalid)", flush=True)
                print(f"    skip invalid domain {email}: {v.get('recommendation')}", flush=True)
                continue
        except Exception:
            pass  # verifier hiccup -> don't block, let it send
        r["name"] = (r["name"] or "").replace(",", "")
        return r
    return None

def pick_persona(team, capped=None, prefer=None):
    """Least-used persona that is (a) not in `capped` (hit a rate error this run)
    and (b) still under its per-account daily_limit (from email_accounts).
    If `prefer` (an email) is still eligible, return it — used to keep a follow-up
    on the same sender as the original touch WITHOUT bypassing the daily_limit.
    Returns None when every account is capped/at-limit."""
    capped = capped or set()
    emails = [p["email"] for p in team]
    if not emails:
        return None
    bid = _bid()
    ph = ",".join(["%s"] * len(emails))
    today = now_myt().date().isoformat()
    rows = execute_sql(
        f"SELECT from_email, count(*) n FROM sent_emails WHERE brand_id=%s AND from_email IN ({ph}) "
        f"AND (sent_at AT TIME ZONE {TZ_SQL})::date = %s::date GROUP BY from_email",
        [bid] + emails + [today]) or []
    used = {r["from_email"]: r["n"] for r in rows}
    lrows = execute_sql(f"SELECT email, daily_limit FROM email_accounts WHERE brand_id=%s AND email IN ({ph})",
                        [bid] + emails) or []
    limits = {r["email"]: (r["daily_limit"] or 9999) for r in lrows}
    avail = [p for p in team
             if p["email"] not in capped and used.get(p["email"], 0) < limits.get(p["email"], 9999)]
    if not avail:
        return None
    if prefer:
        p = next((p for p in avail if p["email"] == prefer), None)
        if p:
            return p
    return sorted(avail, key=lambda p: used.get(p["email"], 0))[0]

def sleep_until_window():
    while True:
        t = now_myt()
        if START_HOUR <= t.hour < END_HOUR: return
        if not SEND:
            print(f"[{t:%m-%d %H:%M} MYT] outside window {START_HOUR}-{END_HOUR} (dry run: not sleeping)", flush=True)
            return
        nxt = t.replace(hour=START_HOUR, minute=0, second=0, microsecond=0)
        if t.hour >= END_HOUR: nxt += timedelta(days=1)
        secs = max(60, int((nxt - t).total_seconds()))
        print(f"[{t:%m-%d %H:%M} MYT] outside window, sleeping {secs//60}m", flush=True)
        time.sleep(min(secs, 1800))

def _as_dt(v):
    """execute_sql jsonifies DB timestamps to ISO strings; parse back to an aware
    datetime (UTC if naive). Returns None on failure."""
    if v is None:
        return None
    if isinstance(v, str):
        try:
            v = datetime.fromisoformat(v)
        except ValueError:
            return None
    if getattr(v, "tzinfo", None) is None:
        v = v.replace(tzinfo=timezone.utc)
    return v


def ramp_cap(sb):
    """Warmup ramp: per-day cap grows by week since the first-ever send."""
    r = execute_sql("SELECT min(sent_at) m FROM sent_emails WHERE brand_id=%s", [_bid()])
    first = _as_dt(r[0]["m"] if r else None)
    if not first:
        return RAMP_SCHEDULE[0]
    weeks = max(0, (datetime.now(timezone.utc) - first).days // 7)
    return RAMP_SCHEDULE[min(weeks, len(RAMP_SCHEDULE) - 1)]


def sent_today_count(sb):
    """Total emails actually sent today (MYT), from the DB. The daily cap is enforced
    against THIS, so the cap holds no matter how many times the sender is invoked."""
    r = execute_sql("SELECT count(*) n FROM sent_emails "
                    f"WHERE brand_id=%s AND (sent_at AT TIME ZONE {TZ_SQL})::date "
                    f"= (now() AT TIME ZONE {TZ_SQL})::date", [_bid()])
    return (r[0]["n"] if r else 0) or 0


def suppressed_emails():
    """Lower-cased addresses this brand must never email: its exclusions and
    unsubscribes, plus the global (cross-brand) suppression list."""
    bid = _bid()
    rows = execute_sql(
        "SELECT lower(email) e FROM email_exclusions WHERE brand_id=%s "
        "UNION SELECT lower(email) FROM email_unsubscribes WHERE brand_id=%s "
        "UNION SELECT lower(email) FROM global_suppression", [bid, bid]) or []
    return {r["e"] for r in rows if r.get("e")}


def _fu_campaigns(sb):
    return execute_sql(
        "SELECT id, name, followups, ai_brief, COALESCE(followup_engaged_only, false) engaged_only, account_manager, created_by "
        "FROM campaigns WHERE brand_id=%s AND status IN ('active','completed') "
        "AND jsonb_array_length(COALESCE(followups,'[]'::jsonb)) > 0", [_bid()]) or []


def next_followup(sb):
    """Return the single most-due follow-up to send, or None. A follow-up is due
    when a campaign recipient has received touch #k, step k exists, enough days
    have passed, and they haven't replied / bounced / unsubscribed."""
    camps = _fu_campaigns(sb)
    if not camps:
        return None
    fu_by = {c["id"]: (c.get("followups") or []) for c in camps}
    name_by = {c["id"]: c["name"] for c in camps}
    brief_by = {c["id"]: c.get("ai_brief") for c in camps}
    gate_by = {c["id"]: bool(c.get("engaged_only")) for c in camps}   # engagement-gate per campaign
    am_by = {c["id"]: (c.get("account_manager") or c.get("created_by")) for c in camps}   # account manager
    ids = list(fu_by.keys())
    ph = ",".join(["%s"] * len(ids))
    rows = execute_sql(
        f"SELECT recipient_email, recipient_name, campaign_id, count(*) touches, "
        f"max(sent_at) last_sent, bool_or(replied_at IS NOT NULL) replied, "
        f"bool_or(bounced_at IS NOT NULL) bounced, "
        f"bool_or(opened_at IS NOT NULL) opened, bool_or(clicked_at IS NOT NULL) clicked, "
        f"(array_agg(from_email ORDER BY sent_at DESC))[1] last_persona "
        f"FROM sent_emails WHERE brand_id=%s AND campaign_id IN ({ph}) AND recipient_email IS NOT NULL "
        f"GROUP BY recipient_email, recipient_name, campaign_id", [_bid()] + ids) or []
    exc = suppressed_emails()
    now = datetime.now(timezone.utc)
    best = None
    for r in rows:
        if r["replied"] or r["bounced"]:
            continue
        email = (r["recipient_email"] or "").lower()
        if not email or email in exc:
            continue
        if not SEND and (email, r["campaign_id"]) in _DRY_FOLLOWUPS:
            continue                                   # dry run: already planned this run
        if (FOLLOWUP_ENGAGED_ONLY or gate_by.get(r["campaign_id"], False)) and not (r["opened"] or r["clicked"]):
            continue                                   # engagement-gated: only follow up with openers/clickers
        fus = fu_by[r["campaign_id"]]
        idx = (r["touches"] or 1) - 1          # touch #1 = initial -> next follow-up index 0
        if idx < 0 or idx >= len(fus):
            continue
        last = _as_dt(r["last_sent"])            # jsonified to an ISO string — parse back
        if last is None:
            continue
        after = int(fus[idx].get("after_days", 4) or 4)
        if (now - last).total_seconds() < after * 86400:
            continue
        if best is None or last < best["last_sent"]:
            best = {"email": email, "name": r["recipient_name"], "campaign_id": r["campaign_id"],
                    "campaign_name": name_by[r["campaign_id"]], "step": fus[idx], "idx": idx,
                    "ai_brief": brief_by[r["campaign_id"]], "account_manager": am_by[r["campaign_id"]],
                    "persona_email": r["last_persona"], "last_sent": last}
    return best


RATE_KEYS = ("quota", "rate limit", "ratelimit", "user-rate", "userratelimit", "429",
             "too many", "limit exceeded", "sending limit", "daily limit", "exceeded")
TRANSIENT_KEYS = ("network is unreachable", "timed out", "timeout", "connection reset",
                  "connection aborted", "temporarily", "503", "500", "unavailable", "econnreset")

def do_send(gmail, sb, lead, persona, subj, body, campaign_id, variant_label, line, owner=None, account_manager=None):
    """Send one email. Returns a status string:
      'sent'      — delivered; lead marked contacted, variant tagged.
      'rate'      — account hit a Gmail rate/quota limit (lead NOT discarded — try another account).
      'transient' — network/temporary error (lead NOT discarded — retry later).
      'fail'      — permanent/recipient error (bad address); lead marked invalid.
    """
    tok = str(uuid.uuid4())
    err = ""
    try:
        res = gmail.send_email(to_email=lead["email"], to_name=(lead.get("name") or None), subject=subj,
                               body_html=body, body_text=text_of(body), tracking_token=tok,
                               backend_url=BACKEND_URL, save_to_db=True, campaign_id=campaign_id,
                               from_email=persona["email"], from_name=persona["name"])
        if res.get("success"):
            execute_sql("UPDATE sent_emails SET variant=%s, owner=%s, account_manager=%s "
                        "WHERE tracking_token=%s AND brand_id=%s",
                        [variant_label, owner, account_manager, tok, _bid()])
            if lead.get("id"):
                sb.table("scraped_leads").update({"status": "contacted"}).eq("id", lead["id"]).execute()
            print(line + " -> SENT", flush=True)
            return "sent"
        err = str(res.get("error") or "unknown error")
    except Exception as e:
        err = str(e)
    low = err.lower()
    if any(k in low for k in RATE_KEYS):
        print(line + f" -> RATE/LIMIT {err[:140]}", flush=True); return "rate"
    if any(k in low for k in TRANSIENT_KEYS):
        print(line + f" -> TRANSIENT {err[:140]}", flush=True); return "transient"
    if lead.get("id"):
        sb.table("scraped_leads").update({"status": "invalid"}).eq("id", lead["id"]).execute()
    print(line + f" -> FAIL {err[:140]}", flush=True)
    return "fail"


def notify(gmail, subject, body_html):
    """Best-effort failure alert to ALERT_TO. Never raises."""
    if not gmail:
        print(f"    [alert (no gmail): {subject}]", flush=True); return
    if not ALERT_TO:
        print(f"    [alert (no ALERT_TO for brand {BRAND_SLUG}): {subject}]", flush=True); return
    try:
        gmail.send_email(to_email=ALERT_TO, to_name=ALERT_TO_NAME, subject=f"[{ALERT_TAG} sender] {subject}",
                         body_html=body_html, body_text=text_of(body_html),
                         tracking_token=str(uuid.uuid4()), backend_url=BACKEND_URL,
                         save_to_db=False, from_email=ALERT_FROM, from_name=f"{ALERT_TAG} Sender")
        print(f"    [alert sent to {ALERT_TO}: {subject}]", flush=True)
    except Exception as e:
        print(f"    [alert FAILED ({subject}): {e}]", flush=True)


# ---------------------------------------------------------------------------
# Brand resolution / configuration
# ---------------------------------------------------------------------------
def _truthy(v):
    return v if isinstance(v, bool) else str(v).strip().lower() in ("1", "true", "yes", "on")


def _setting(key, env=None, default=None, all_brands=True):
    """brands.sender[key] -> env (brand 1 only unless all_brands) -> default."""
    return brandcat.sender_value(BRAND, key, env, default, env_for_all_brands=all_brands)


def _int_setting(key, env, default):
    v = _setting(key, env, None)
    return int(v) if v not in (None, "") else int(default)


def _flag_setting(key, env, default_on):
    """brands.sender[key] (bool or "1"/"true") -> env == "1" (legacy parsing) -> default."""
    cfg = (BRAND or {}).get("sender") or {}
    if cfg.get(key) not in (None, ""):
        return _truthy(cfg[key])
    return os.getenv(env, "1" if default_on else "0") == "1"


def resolve_brand():
    """The brand to send for: BRAND_ID env (id or slug); unset -> brand 1."""
    ref = (os.getenv("BRAND_ID") or "").strip()
    if not ref:
        print("WARNING: BRAND_ID not set — sending for brand 1 (default brand) for legacy cron compatibility "
              "(use run_senders.py to run every brand)", flush=True)
        return brandcat.default_brand()
    brand = brandcat.get_brand(ref)
    if not brand:
        raise SystemExit(f"smart_sender: unknown BRAND_ID {ref!r}")
    return brand


def configure_brand(brand):
    """Resolve every brand-specific setting for this run (inside brand_scope).
    Brand 1 resolves to exactly the legacy constants/env behaviour."""
    global BRAND, BRAND_ID, BRAND_SLUG, IS_DEFAULT_BRAND, SENDING_ENABLED
    global FALLBACK_SEGMENTS, MIN_GAP, MAX_GAP, DAILY_CAP, START_HOUR, END_HOUR, MAX_TOTAL
    global RAMP, AI_ONLY, FOLLOWUP_ENGAGED_ONLY, MYT, TZ_SQL
    global ALERT_TO, ALERT_FROM, ALERT_TO_NAME, ALERT_TAG, CTA, CTA_TEXT, UNSUB_SALT, UNSUB_ADD_BRAND
    global BRAND_DOMAIN, UTM_SOURCE, AI_BRIEF_DEFAULT, TEMPLATES_ENABLED
    global AI_COMPANY, AI_RECIPIENT_NOTE, AI_TONE, AI_HOOK, AI_FOLLOWUP_ANGLES, AI_DEFAULT_SUBJECT
    BRAND = brand
    BRAND_ID = str(brand["id"])
    BRAND_SLUG = brand["slug"]
    IS_DEFAULT_BRAND = brandcat.is_default_brand(brand)
    if tenancy.current_brand() != BRAND_ID:
        raise tenancy.TenancyError(f"configure_brand({BRAND_SLUG}) must run inside its brand_scope")
    d = IS_DEFAULT_BRAND
    name = (brand.get("display_name") or BRAND_SLUG).strip()

    SENDING_ENABLED = _truthy(_setting("sending_enabled", None, d))

    # pacing: brands.sender -> env (all brands) -> legacy constants
    segs = _setting("segments", "SEGMENTS", "", all_brands=False)
    if isinstance(segs, (list, tuple)):
        segs = ",".join(str(x) for x in segs)
    FALLBACK_SEGMENTS = [x.strip() for x in str(segs or "").split(",") if x.strip()]
    MIN_GAP = _int_setting("min_gap", "MIN_GAP", 720)
    MAX_GAP = _int_setting("max_gap", "MAX_GAP", 1200)
    DAILY_CAP = _int_setting("daily_cap", "DAILY_CAP", 20)
    START_HOUR = _int_setting("start_hour", "START_HOUR", 9)
    END_HOUR = _int_setting("end_hour", "END_HOUR", 18)
    MAX_TOTAL = _int_setting("max_total", "MAX_TOTAL", 0)
    RAMP = _flag_setting("ramp", "RAMP", False)
    AI_ONLY = _flag_setting("ai_only", "AI_ONLY", False)
    FOLLOWUP_ENGAGED_ONLY = _flag_setting("followup_engaged_only", "FOLLOWUP_ENGAGED_ONLY", False)
    off = float(_setting("tz_offset_hours", "TZ_OFFSET_HOURS", 8))
    if not -12 <= off <= 14:
        raise ValueError(f"tz_offset_hours out of range: {off}")
    MYT = timezone(timedelta(hours=off))
    TZ_SQL = "'Asia/Kuala_Lumpur'" if off == 8 else f"INTERVAL '{off:g} hours'"

    # identity: brands.sender -> (brand 1 only) env -> brand-1 constants / brand defaults
    BRAND_DOMAIN = (brand.get("website_domain") or "").strip().lower() or ("example.com" if d else "")
    CTA = _setting("cta_url", None, "https://example.com" if d else (f"https://{BRAND_DOMAIN}" if BRAND_DOMAIN else ""),
                   all_brands=False)
    CTA_TEXT = _setting("cta_text", None, "See how utilizereach works" if d else f"See how {name} works", all_brands=False)
    UTM_SOURCE = _setting("utm_source", None, "utilizereach-outreach" if d else BRAND_SLUG, all_brands=False)
    UNSUB_SALT = brand.get("unsub_salt") or ("utilizereach-unsub-v1" if d else "")
    if not UNSUB_SALT:
        raise RuntimeError(f"brand {BRAND_SLUG} has no unsub_salt")
    UNSUB_ADD_BRAND = not d
    # alerts: brand config -> env -> the brand's own sending mailbox (filled in
    # run()). No hard-coded recipients: without one, alerts are only logged.
    ALERT_TO = _setting("alert_to", "ALERT_TO", None)
    ALERT_FROM = _setting("alert_from", "ALERT_FROM", None, all_brands=False)
    ALERT_TO_NAME = _setting("alert_to_name", None, None, all_brands=False)
    ALERT_TAG = "utilizereach" if d else name
    AI_BRIEF_DEFAULT = _setting("ai_brief_default", None, DEFAULT_AI_BRIEF if d else "", all_brands=False)
    TEMPLATES_ENABLED = d                       # other brands are AI/variant-only
    # AI prompt identity (every brand, brand 1 included): "at <company>"
    AI_COMPANY = _setting("ai_company", None, BRAND_DOMAIN or name, all_brands=False)
    note = (_setting("ai_recipient_note", None, "", all_brands=False) or "").strip()
    AI_RECIPIENT_NOTE = f" ({note})" if note else ""
    AI_TONE = _setting("ai_tone", None, "professional", all_brands=False)
    AI_HOOK = "likely operates"
    AI_FOLLOWUP_ANGLES = list(GENERIC_FOLLOWUP_ANGLES)
    AI_DEFAULT_SUBJECT = "A quick note"


def _acquire_locks(brand):
    """Per-brand single-run lock (+ the legacy lock for brand 1, so an old and
    a new sender can never both send for brand 1). Returns False if held."""
    import fcntl
    paths = [f"/tmp/smart_sender_{brand['slug']}.lock"]
    if brandcat.is_default_brand(brand):
        paths.insert(0, "/tmp/smart_sender.lock")
    for path in paths:
        f = open(path, "w")
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (BlockingIOError, OSError):
            f.close()
            return False
        _LOCKS.append(f)
    return True


def main():
    # single-run lock: if another sender process is active, exit (no double-sends).
    global _RUN_BRAND_ID
    brand = resolve_brand()
    _RUN_BRAND_ID = str(brand["id"])
    if not _acquire_locks(brand):
        print("another sender run is already active — exiting to avoid double-send", flush=True)
        return
    if not brand.get("is_active"):
        print(f"brand '{brand['slug']}' is inactive — not sending", flush=True)
        return
    with brand_scope(brand["id"]):
        configure_brand(brand)
        return run()


def run():
    global ALERT_TO, ALERT_FROM
    sb = get_supabase_admin_client()
    team = get_email_team()
    if not team:
        raise RuntimeError(f"no sending personas configured for brand '{BRAND_SLUG}'")
    mbox_src, mbox = describe_brand_mailbox(BRAND_ID)
    ALERT_FROM = ALERT_FROM or mbox
    ALERT_TO = ALERT_TO or mbox
    print(f"brand {BRAND_SLUG} ({BRAND_ID}) | mailbox {mbox or 'NONE'} [{mbox_src or '-'}] "
          f"| {len(team)} persona(s) | sending_enabled={SENDING_ENABLED}", flush=True)
    if SEND and not SENDING_ENABLED:
        print(f"sending is disabled for brand '{BRAND_SLUG}' (brands.sender.sending_enabled) — exiting", flush=True)
        return
    if SEND and not mbox:
        print(f"brand '{BRAND_SLUG}' has no sending mailbox (connect one in Settings) — exiting", flush=True)
        return 1
    gmail = get_brand_gmail_client(BRAND_ID) if SEND else None
    cap = ramp_cap(sb) if RAMP else DAILY_CAP
    print(f"smart sender | AI_ONLY={AI_ONLY} cap={cap}/day (global, from DB) gap={MIN_GAP}-{MAX_GAP}s "
          f"window={START_HOUR}-{END_HOUR} MYT send={SEND}", flush=True)
    ai_skips, dry_total, run_sent = 0, 0, 0
    capped, alerted_rate, transient_fails = set(), set(), 0   # per-account failover + alert state
    while True:
        done = sent_today_count(sb)              # HARD cap, enforced from the DB across all runs
        if done >= cap:
            print(f"daily cap {cap} reached ({done} sent today, MYT) — stopping", flush=True); break
        if MAX_TOTAL and run_sent >= MAX_TOTAL:
            print(f"MAX_TOTAL {MAX_TOTAL} reached this run — stopping", flush=True); break
        sleep_until_window()
        owner = am = None   # attribution: lead owner + account manager, set per send branch

        # 1) a due follow-up takes priority (time-sensitive)
        fu = next_followup(sb)
        if fu:
            persona = pick_persona(team, capped, prefer=fu["persona_email"])
            if persona is None:
                notify(gmail, "All sending accounts hit their daily limit",
                       "<p>Every persona/alias is capped or rate-limited for today — sending is paused until tomorrow.</p>")
                print("all accounts capped — stopping run", flush=True); break
            fn = first_name(fu["name"]); company = ""
            lk = execute_sql("SELECT decision_maker_name name, company_name company, owner, segment "
                             "FROM scraped_leads WHERE brand_id=%s AND lower(email)=%s LIMIT 1", [_bid(), fu["email"]])
            if lk:
                fn = first_name(lk[0].get("name") or fu["name"]); company = clean_company(lk[0].get("company"))
            lead = {"id": None, "email": fu["email"], "name": fu["name"]}
            owner = (lk[0].get("owner") or lk[0].get("segment")) if lk else None
            am = fu.get("account_manager")
            campaign_id, variant_label = fu["campaign_id"], f"F{fu['idx'] + 1}"
            src = f"followup#{fu['idx'] + 1} '{fu['campaign_name']}'"
            asubj = abody = None
            if fu.get("ai_brief"):
                asubj, abody = ai_email(persona["name"], fn, company, fu["ai_brief"], kind="followup", idx=fu["idx"])
                src += " [AI]"
            if abody:
                subj, body = render(asubj or fu["step"].get("subject", "Following up"), abody,
                                    fn, company, persona["name"], append=True)
            elif fu.get("ai_brief"):
                ai_skips += 1
                print(f"    [AI follow-up unavailable — skip, no template fallback (streak {ai_skips})]", flush=True)
                if ai_skips >= 5:
                    notify(gmail, "AI generation is DOWN — personalized sends paused",
                           f"<p>The AI (LLM) failed {ai_skips}x in a row, so AI campaigns cannot generate personalized emails and sending is paused (no template fallback).</p>"
                           f"<p><b>Likely cause:</b> the server's Claude Code login expired, or the LLM provider is unreachable.</p>"
                           f"<p><b>Last error:</b> {_last_ai_error or 'n/a'}</p>"
                           "<p>Re-authenticate claude on the server (or set an API key in Settings &rarr; Email AI); it resumes automatically once the LLM works.</p>")
                    print("AI generation down repeatedly — stopping run", flush=True); break
                time.sleep(20); continue
            else:
                subj, body = render(fu["step"].get("subject", "Following up"),
                                    fu["step"].get("body", "<p>Hi {first_name},</p>"), fn, company, persona["name"], append=True)
            body = add_utms(body, fu["campaign_name"], variant_label, persona["name"], owner, am)
            body += unsub_footer(fu["email"])
        else:
            # 2) persona-assigned campaigns run independently (reserved persona only)
            camp, persona = active_persona_campaign(team, capped)
            if not camp:
                # 3) general campaigns — never use reserved personas
                camp = active_campaign(sb, exclude_reserved=True)
                if camp:
                    reserved = camp.get("_reserved_emails", set())
                    free_team = [p for p in team if p["email"] not in reserved]
                    persona = pick_persona(free_team or team, capped)
            if camp:
                lead = next_lead([s.strip() for s in camp["segment"].split(",")])
                if not lead:
                    if SEND:
                        execute_sql("UPDATE campaigns SET status='completed' WHERE id=%s AND brand_id=%s",
                                    [camp["id"], _bid()])
                    else:
                        _DRY_EXHAUSTED.add(camp["id"])
                        print("    (dry run: would mark campaign completed)", flush=True)
                    print(f"campaign '{camp['name']}' segment exhausted -> completed", flush=True); continue
                if persona is None:
                    notify(gmail, "All sending accounts hit their daily limit",
                           "<p>Every persona/alias is capped or rate-limited for today — sending is paused until tomorrow.</p>")
                    print("all accounts capped — stopping run", flush=True); break
                fn = first_name(lead.get("name")); company = clean_company(lead.get("company"))
                owner = (lead.get("owner") or lead.get("segment"))
                am = camp.get("account_manager") or camp.get("created_by")
                asubj = abody = None
                if camp.get("ai_brief"):
                    asubj, abody = ai_email(persona["name"], lead.get("name"), lead.get("company"),
                                            camp["ai_brief"], kind="intro")
                if abody:
                    campaign_id, variant_label = camp["id"], "AI"
                    src = f"campaign '{camp['name']}' [AI]"
                    subj, body = render(asubj or AI_DEFAULT_SUBJECT, abody,
                                        fn, company, persona["name"], append=False)
                elif camp.get("ai_brief"):
                    ai_skips += 1
                    print(f"    [AI unavailable for '{camp['name']}' — skip, NO template fallback (streak {ai_skips})]", flush=True)
                    if ai_skips >= 5:
                        notify(gmail, "AI generation is DOWN — personalized sends paused",
                               f"<p>The AI (LLM) failed {ai_skips}x in a row, so AI campaigns cannot generate personalized emails and sending is paused (no template fallback).</p>"
                               f"<p><b>Likely cause:</b> the server's Claude Code login expired, or the LLM provider is unreachable.</p>"
                               f"<p><b>Last error:</b> {_last_ai_error or 'n/a'}</p>"
                               "<p>Re-authenticate claude on the server (or set an API key in Settings &rarr; Email AI); it resumes automatically once the LLM works.</p>")
                        print("AI generation down repeatedly — stopping run", flush=True); break
                    time.sleep(20); continue
                else:
                    variants = camp.get("variants") or ([
                        {"label": "A", "subject": persona_template(persona["name"], "{first_name}", "{company}")[0],
                         "body": persona_template(persona["name"], "{first_name}", "{company}")[1]}]
                        if TEMPLATES_ENABLED else [])
                    if not variants:
                        print(f"campaign '{camp['name']}' has no variants and no AI brief — stopping run", flush=True); break
                    v = variants[camp["_sent"] % len(variants)]
                    campaign_id, variant_label = camp["id"], v.get("label")
                    src = f"campaign '{camp['name']}' [{variant_label}]"
                    subj, body = render(v.get("subject", "A quick note"), v.get("body", "<p>Hi {first_name},</p>"),
                                        fn, company, persona["name"], append=False)
                body = add_utms(body, camp["name"], variant_label, persona["name"], owner, am)
                body += unsub_footer(lead["email"])
            elif AI_ONLY or not TEMPLATES_ENABLED:
                print("no active AI campaign and nothing due — idle (AI-only mode; template drip disabled)", flush=True); break
            else:
                lead = next_lead(FALLBACK_SEGMENTS)
                if not lead:
                    print("nothing to send — idle", flush=True); break
                campaign_id, variant_label, src = None, None, "drip"
                persona = pick_persona(team, capped)
                if persona is None:
                    notify(gmail, "All sending accounts hit their daily limit",
                           "<p>Every persona/alias is capped or rate-limited for today — sending is paused until tomorrow.</p>")
                    print("all accounts capped — stopping run", flush=True); break
                fn = first_name(lead.get("name")); company = clean_company(lead.get("company"))
                owner = (lead.get("owner") or lead.get("segment"))
                am = None
                ps, pb = persona_template(persona["name"], fn, company)
                subj, body = render(ps, pb, fn, company, persona["name"])
                body = add_utms(body, None, None, persona["name"], owner, am)
                body += unsub_footer(lead["email"])

        stamp = now_myt().strftime("%m-%d %H:%M")
        line = f"[{stamp} MYT] {src} | {persona['name']:<7} -> {lead.get('name') or '(no name)'} <{lead['email']}> | \"{subj}\""
        if not SEND:
            if fu:
                _DRY_FOLLOWUPS.add((fu["email"], fu["campaign_id"]))
            else:
                _DRY_LEADS.add((lead.get("email") or "").strip().lower())
            print("PLAN " + line, flush=True); dry_total += 1
            if dry_total >= 8: print("(dry run)"); break
            continue
        st = do_send(gmail, sb, lead, persona, subj, body, campaign_id, variant_label, line, owner, am)
        if st == "sent":
            ai_skips = 0; transient_fails = 0; run_sent += 1
        elif st == "rate":
            capped.add(persona["email"])              # this account is done for today
            if persona["email"] not in alerted_rate:
                alerted_rate.add(persona["email"])
                notify(gmail, f"Account rate/limit hit: {persona['email']}",
                       f"<p><b>{persona['email']}</b> hit a Gmail rate/quota limit — rotating to another account.</p>"
                       f"<p><small>{line}</small></p>")
            continue                                  # retry the same work on another account, no long gap
        elif st == "transient":
            transient_fails += 1
            if transient_fails >= 3:
                notify(gmail, "Repeated transient send failures",
                       "<p>3+ consecutive network/temporary send failures — stopping this run; it retries on the next cron.</p>")
                print("too many transient failures — stopping run", flush=True); break
            time.sleep(30); continue
        # st == 'fail' -> recipient/permanent error; lead already marked invalid; move on
        gap = random.randint(MIN_GAP, MAX_GAP)
        print(f"    next in {gap//60}m{gap%60:02d}s", flush=True)
        time.sleep(gap)

if __name__ == "__main__":
    try:
        rc = main()
    except Exception:
        import traceback
        tb = traceback.format_exc()[-1600:]
        print("FATAL:", tb, flush=True)
        try:
            # alert from the crashed brand's own mailbox; brand 1 (or an
            # unresolved legacy run) uses the legacy .gmail_tokens client.
            bid = _RUN_BRAND_ID or (tenancy.DEFAULT_BRAND_ID if not (os.getenv("BRAND_ID") or "").strip() else None)
            if not bid:
                raise RuntimeError("brand unknown")
            if bid != tenancy.DEFAULT_BRAND_ID and BRAND_ID != bid:
                raise RuntimeError("brand not configured yet")
            if not ALERT_TO:
                raise RuntimeError("no alert recipient for this brand")
            with brand_scope(bid):
                g = get_brand_gmail_client(bid)
                notify(g, "smart_sender CRASHED", f"<p>The email sender crashed mid-run and stopped.</p><pre>{tb}</pre>")
        except Exception as ee:
            print("crash-alert also failed:", ee, flush=True)
        raise
    sys.exit(rc or 0)

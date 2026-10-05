"""Preview AI-personalized intro emails for a segment — generates, does NOT send.
Env: SEGMENT (required), N (default 8), PERSONA (default Nancy), BRIEF (optional),
BRAND_ID (id or slug; unset -> brand 1, the default brand). For another brand, PERSONA
defaults to that brand's first persona and BRIEF to its ai_brief_default."""
import os, sys
sys.path.insert(0, "/app")
from database.pg import execute_sql
from database.tenancy import brand_scope
import smart_sender as ss
from smart_sender import ai_email, text_of

SEG = os.getenv("SEGMENT", "")
N = int(os.getenv("N", "8"))


def main():
    brand = ss.resolve_brand()
    with brand_scope(brand["id"]):
        ss.configure_brand(brand)
        default_persona = "Nancy"
        if not ss.IS_DEFAULT_BRAND:
            team = ss.get_email_team()
            default_persona = team[0]["name"] if team else "Team"
        PERSONA = os.getenv("PERSONA", default_persona)
        BRIEF = os.getenv("BRIEF", "") or ss.AI_BRIEF_DEFAULT

        rows = execute_sql(
            "SELECT decision_maker_name name, company_name company, email FROM scraped_leads "
            "WHERE brand_id=%s AND segment=%s AND email IS NOT NULL AND status='new' ORDER BY random() LIMIT %s",
            [ss.BRAND_ID, SEG, N]) or []
        print(f"### AI intro preview — segment '{SEG}', persona {PERSONA}, {len(rows)} leads ###\n", flush=True)
        ok = 0
        for i, r in enumerate(rows, 1):
            s, b = ai_email(PERSONA, r["name"], r["company"], BRIEF, kind="intro")
            print(f"===== {i}. {r['name']} | {r['company']} <{r['email']}> =====", flush=True)
            if not b:
                print("  [guardrail/fail -> would fall back to template]\n", flush=True); continue
            ok += 1
            print(f"SUBJECT: {s}", flush=True)
            print(text_of(b).strip() + "\n", flush=True)
        print(f"### generated {ok}/{len(rows)} cleanly ###", flush=True)


if __name__ == "__main__":
    main()

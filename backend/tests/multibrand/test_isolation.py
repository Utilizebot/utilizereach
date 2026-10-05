"""
Cross-brand isolation tests. Run against a LIVE backend + a disposable/staging DB:

    python -m pytest tests/multibrand -q            (see README.md / run.sh)

Order matters (pytest runs them top to bottom): sanity first, because if the
fixtures are not visible to their own brand every later "no leak" is vacuous.
Each test records detailed rows in the shared report; the summary table is
printed at the end of the run and saved as JSON.
"""

from isolation_checks import (
    check_byid, check_members, check_public, check_rbac, check_rls, check_sanity, check_secrets, check_sweep,
    check_switch, check_unauth,
)


def test_01_sanity_fixtures_visible_to_own_brand(ctx):
    check_sanity(ctx)


def test_02_public_endpoints(ctx):
    check_public(ctx)


def test_03_unauthenticated_access_refused(ctx):
    check_unauth(ctx)


def test_04_rls_and_db_backstops(ctx):
    check_rls(ctx)


def test_05_generic_get_leak_sweep(ctx):
    check_sweep(ctx)


def test_06_by_id_attacks(ctx):
    check_byid(ctx)


def test_07_membership_and_account_attacks(ctx):
    check_members(ctx)


def test_08_rbac_viewer_and_non_platform_admin(ctx):
    check_rbac(ctx)


def test_09_brand_switching_hosts_tokens(ctx):
    check_switch(ctx)


def test_10_secrets_tokens_and_ai_key_masking(ctx):
    check_secrets(ctx)

-- ============================================================================
-- MULTI-BRAND (multi-tenant) schema
--
-- Idempotent. Runs on every backend startup AFTER schema.sql, nexus_schema.sql
-- and seed.sql (see database/migrate.py), on the OWNER connection.
--
-- Model: shared-database, row-level tenancy. Every tenant table carries a
-- NOT NULL brand_id. The active brand for a transaction is passed through the
-- Postgres setting app.brand_id (set by database/pg.py from the ContextVar in
-- database/tenancy.py). That setting:
--   * fills brand_id on INSERT (the column DEFAULT below), and
--   * drives the row-level-security policies below, which are enforced for the
--     non-owner app_rw role the API, Celery and the sender connect as.
-- Trusted system code paths (migrations, tracking-token lookups, cross-brand
-- jobs) set app.tenancy_bypass = 'on' explicitly.
--
-- Isolation layers:
--   1. app layer   - pg.py auto-scopes query-builder calls on tenant tables
--   2. data layer  - composite (id, brand_id) foreign keys: a child row can
--                    only reference a parent of the SAME brand
--   3. RLS         - fail-closed policies on every tenant table
--
-- Brand 1 is the pre-existing deployment (slug "default") with a fixed UUID;
-- every existing row is backfilled to it.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tenant catalog
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS brands (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
    display_name    TEXT NOT NULL,
    website_domain  TEXT,                                   -- CTA + UTM rewrite target, e.g. example.com
    hostnames       TEXT[] NOT NULL DEFAULT '{}',           -- brand-dedicated hosts (public pages / dashboard)
    unsub_salt      TEXT NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    branding        JSONB NOT NULL DEFAULT '{}'::jsonb,     -- config.json shape: company / branding / form / dashboard / features
    sender          JSONB NOT NULL DEFAULT '{}'::jsonb,     -- per-brand sender overrides (keys: docs/MULTIBRAND.md)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Brand 1 = the existing deployment. The legacy (single-brand) unsubscribe
-- salt is kept so every unsubscribe link already in recipients' inboxes keeps
-- validating. display_name is replaced on first run by the company name from
-- the deployment's config.json (database/migrate.py); website_domain is left
-- NULL until configured from the Brands page.
INSERT INTO brands (id, slug, display_name, website_domain, unsub_salt)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'default', 'Default brand', NULL, 'utilizereach-unsub-v1')
ON CONFLICT (id) DO NOTHING;

-- Who belongs to which brand, and their role THERE. A person can be admin of
-- brand A and viewer of brand B. sales_reps stays the global login identity.
CREATE TABLE IF NOT EXISTS brand_members (
    brand_id      UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    sales_rep_id  UUID NOT NULL REFERENCES sales_reps(id) ON DELETE CASCADE,
    role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'manager', 'member', 'viewer')),
    is_default    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (brand_id, sales_rep_id)
);
CREATE INDEX IF NOT EXISTS idx_brand_members_rep ON brand_members(sales_rep_id);

-- Platform admins create brands and may act in any brand.
ALTER TABLE sales_reps ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Deployment-wide hard blocklist (hard bounces, spam traps, complaints).
-- Per-brand opt-outs live in email_exclusions / email_unsubscribes.
CREATE TABLE IF NOT EXISTS global_suppression (
    email            TEXT PRIMARY KEY,
    reason           TEXT,
    source_brand_id  UUID REFERENCES brands(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One-time step markers.
CREATE TABLE IF NOT EXISTS tenancy_migrations (
    key         TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tables that used to be created at request time by the social routers. They
-- live here now so the app can run as a role without DDL rights.
CREATE TABLE IF NOT EXISTS social_media_accounts (
    id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    platform     TEXT NOT NULL,
    credentials  JSONB DEFAULT '{}',
    is_connected BOOLEAN DEFAULT FALSE,
    handle       TEXT,
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS social_media_posts (
    id          TEXT PRIMARY KEY,
    platform    TEXT NOT NULL,
    content     TEXT NOT NULL,
    topic       TEXT,
    tone        TEXT,
    post_type   TEXT,
    status      TEXT DEFAULT 'draft',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 2. brand_id on every tenant table
--    First run: add column, backfill to brand 1, then default + NOT NULL.
--    Later runs: no-ops (guarded on the column's current state).
--    KEEP IN SYNC with TENANT_TABLES in database/tenancy.py.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    t text;
    brand1 constant uuid := '00000000-0000-0000-0000-0000000000a1';
    tenant_tables constant text[] := ARRAY[
        'scraped_leads', 'scraping_jobs', 'scraping_logs',
        'campaigns', 'sent_emails', 'email_queue',
        'email_clicks', 'email_replies', 'email_bounces', 'email_unsubscribes',
        'email_exclusions', 'email_accounts', 'segments',
        'email_ai_settings', 'scheduler_settings', 'scheduler_run_history',
        'form_sessions', 'form_responses', 'form_steps', 'tracking_events',
        'api_keys', 'social_media_accounts', 'social_media_posts',
        'stakeholders', 'shareholder_profiles', 'partner_profiles', 'govt_agency_profiles',
        'staging_legacy_contacts', 'stakeholder_audit_logs', 'agent_execution_approvals'
    ];
BEGIN
    FOREACH t IN ARRAY tenant_tables LOOP
        IF to_regclass('public.' || t) IS NULL THEN
            CONTINUE;
        END IF;

        EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS brand_id uuid', t);

        IF EXISTS (
            SELECT 1 FROM pg_attribute
            WHERE attrelid = ('public.' || t)::regclass AND attname = 'brand_id' AND NOT attnotnull
        ) THEN
            EXECUTE format('UPDATE %I SET brand_id = %L WHERE brand_id IS NULL', t, brand1);
            EXECUTE format(
                'ALTER TABLE %I ALTER COLUMN brand_id SET DEFAULT NULLIF(current_setting(''app.brand_id'', true), '''')::uuid',
                t);
            EXECUTE format('ALTER TABLE %I ALTER COLUMN brand_id SET NOT NULL', t);
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_brand_fk') THEN
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (brand_id) REFERENCES brands(id)',
                           t, t || '_brand_fk');
        END IF;

        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (brand_id)', 'idx_' || t || '_brand', t);
    END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 3. Uniqueness becomes per brand where two brands may legitimately share a
--    value (segment keys, suppression entries, social platforms, stakeholder
--    emails) and one-row-per-brand for the former singletons.
--    Globally-unique public routing tokens (click/unsubscribe/session tokens,
--    gmail message ids) and mailbox addresses stay global.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    -- segments.key -> (brand_id, key)
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'segments_key_key') THEN
        ALTER TABLE segments DROP CONSTRAINT segments_key_key;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_segments_brand_key') THEN
        ALTER TABLE segments ADD CONSTRAINT uq_segments_brand_key UNIQUE (brand_id, key);
    END IF;

    -- email_exclusions.email -> (brand_id, email)
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_exclusions_email_key') THEN
        ALTER TABLE email_exclusions DROP CONSTRAINT email_exclusions_email_key;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_email_exclusions_brand_email') THEN
        ALTER TABLE email_exclusions ADD CONSTRAINT uq_email_exclusions_brand_email UNIQUE (brand_id, email);
    END IF;

    -- email_unsubscribes.email -> (brand_id, email); unsubscribe_token stays global
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_unsubscribes_email_key') THEN
        ALTER TABLE email_unsubscribes DROP CONSTRAINT email_unsubscribes_email_key;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_email_unsubscribes_brand_email') THEN
        ALTER TABLE email_unsubscribes ADD CONSTRAINT uq_email_unsubscribes_brand_email UNIQUE (brand_id, email);
    END IF;

    -- social_media_accounts.platform -> (brand_id, platform)
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_media_accounts_platform_key') THEN
        ALTER TABLE social_media_accounts DROP CONSTRAINT social_media_accounts_platform_key;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_social_accounts_brand_platform') THEN
        ALTER TABLE social_media_accounts ADD CONSTRAINT uq_social_accounts_brand_platform UNIQUE (brand_id, platform);
    END IF;

    -- stakeholders.email_address -> (brand_id, email_address)
    IF to_regclass('public.stakeholders') IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stakeholders_email_address_key') THEN
            ALTER TABLE stakeholders DROP CONSTRAINT stakeholders_email_address_key;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_stakeholders_brand_email') THEN
            ALTER TABLE stakeholders ADD CONSTRAINT uq_stakeholders_brand_email UNIQUE (brand_id, email_address);
        END IF;
    END IF;

    -- former singletons: one row per brand
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_email_ai_settings_brand') THEN
        ALTER TABLE email_ai_settings ADD CONSTRAINT uq_email_ai_settings_brand UNIQUE (brand_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_scheduler_settings_brand') THEN
        ALTER TABLE scheduler_settings ADD CONSTRAINT uq_scheduler_settings_brand UNIQUE (brand_id);
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4. Composite keys: a child row may only point at a parent of its own brand.
--    The original single-column FKs stay and keep their delete behaviour; these
--    add the brand guarantee (MATCH SIMPLE: skipped while the child FK is NULL).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    r record;
BEGIN
    -- parents: (id, brand_id) must be referenceable
    FOR r IN SELECT * FROM (VALUES
        ('campaigns',      'id',         'uq_campaigns_id_brand'),
        ('email_accounts', 'id',         'uq_email_accounts_id_brand'),
        ('sent_emails',    'id',         'uq_sent_emails_id_brand'),
        ('scraped_leads',  'id',         'uq_scraped_leads_id_brand'),
        ('scraping_jobs',  'id',         'uq_scraping_jobs_id_brand'),
        ('form_sessions',  'session_id', 'uq_form_sessions_session_brand'),
        ('stakeholders',   'id',         'uq_stakeholders_id_brand')
    ) AS p(tbl, col, cname) LOOP
        IF to_regclass('public.' || r.tbl) IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.cname) THEN
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I UNIQUE (%I, brand_id)', r.tbl, r.cname, r.col);
        END IF;
    END LOOP;

    -- children: (fk_col, brand_id) -> parent (pk_col, brand_id)
    FOR r IN SELECT * FROM (VALUES
        ('sent_emails',          'campaign_id',      'campaigns',      'id',         'fk_sent_emails_campaign_brand',      'SET NULL (campaign_id)'),
        ('sent_emails',          'email_account_id', 'email_accounts', 'id',         'fk_sent_emails_account_brand',       'SET NULL (email_account_id)'),
        ('campaigns',            'email_account_id', 'email_accounts', 'id',         'fk_campaigns_account_brand',         'NO ACTION'),
        ('email_queue',          'campaign_id',      'campaigns',      'id',         'fk_email_queue_campaign_brand',      'CASCADE'),
        ('email_queue',          'email_account_id', 'email_accounts', 'id',         'fk_email_queue_account_brand',       'SET NULL (email_account_id)'),
        ('email_queue',          'sent_email_id',    'sent_emails',    'id',         'fk_email_queue_sent_brand',          'NO ACTION'),
        ('email_clicks',         'sent_email_id',    'sent_emails',    'id',         'fk_email_clicks_sent_brand',         'CASCADE'),
        ('email_clicks',         'campaign_id',      'campaigns',      'id',         'fk_email_clicks_campaign_brand',     'SET NULL (campaign_id)'),
        ('email_replies',        'sent_email_id',    'sent_emails',    'id',         'fk_email_replies_sent_brand',        'CASCADE'),
        ('email_replies',        'campaign_id',      'campaigns',      'id',         'fk_email_replies_campaign_brand',    'SET NULL (campaign_id)'),
        ('email_bounces',        'sent_email_id',    'sent_emails',    'id',         'fk_email_bounces_sent_brand',        'CASCADE'),
        ('email_bounces',        'email_account_id', 'email_accounts', 'id',         'fk_email_bounces_account_brand',     'CASCADE'),
        ('email_unsubscribes',   'sent_email_id',    'sent_emails',    'id',         'fk_email_unsubs_sent_brand',         'SET NULL (sent_email_id)'),
        ('email_unsubscribes',   'campaign_id',      'campaigns',      'id',         'fk_email_unsubs_campaign_brand',     'SET NULL (campaign_id)'),
        ('scraped_leads',        'job_id',           'scraping_jobs',  'id',         'fk_scraped_leads_job_brand',         'CASCADE'),
        ('scraping_logs',        'job_id',           'scraping_jobs',  'id',         'fk_scraping_logs_job_brand',         'CASCADE'),
        ('form_responses',       'session_id',       'form_sessions',  'session_id', 'fk_form_responses_session_brand',    'CASCADE'),
        ('form_steps',           'session_id',       'form_sessions',  'session_id', 'fk_form_steps_session_brand',        'CASCADE'),
        ('tracking_events',      'session_id',       'form_sessions',  'session_id', 'fk_tracking_events_session_brand',   'CASCADE'),
        ('shareholder_profiles', 'stakeholder_id',   'stakeholders',   'id',         'fk_shareholder_profiles_brand',      'CASCADE'),
        ('partner_profiles',     'stakeholder_id',   'stakeholders',   'id',         'fk_partner_profiles_brand',          'CASCADE'),
        ('govt_agency_profiles', 'stakeholder_id',   'stakeholders',   'id',         'fk_govt_agency_profiles_brand',      'CASCADE'),
        ('stakeholder_audit_logs','stakeholder_id',  'stakeholders',   'id',         'fk_stakeholder_audit_brand',         'NO ACTION')
    ) AS c(tbl, col, ptbl, pcol, cname, ondelete) LOOP
        IF to_regclass('public.' || r.tbl) IS NOT NULL
           AND to_regclass('public.' || r.ptbl) IS NOT NULL
           AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = ('public.' || r.tbl)::regclass AND attname = r.col)
           AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.cname) THEN
            EXECUTE format(
                'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I, brand_id) REFERENCES %I (%I, brand_id) ON DELETE %s',
                r.tbl, r.cname, r.col, r.ptbl, r.pcol, r.ondelete);
        END IF;
    END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 5. Analytics view: carries brand_id, and runs with the CALLER's rights so
--    row-level security applies through it (a plain view would run as its
--    owner and see every brand).
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS analytics_overview;
CREATE VIEW analytics_overview WITH (security_invoker = true) AS
SELECT
    fs.brand_id,
    fs.session_id,
    fs.created_at as session_created_at,
    fs.completed_at,
    fs.status,
    fs.utm_source,
    fs.utm_medium,
    fs.utm_campaign,
    fs.utm_content,
    fs.sales_rep_name,
    fs.sales_rep_id,
    fs.device_type,
    fs.browser,
    fs.os,
    fs.screen_resolution,
    fs.viewport_size,
    fs.timezone,
    fs.language,
    fs.country,
    fs.user_agent,
    fs.referrer,
    fs.landing_page,
    fs.metadata,
    fr.id as response_id,
    fr.created_at,
    fr.industry,
    fr.challenge,
    fr.automation_level,
    fr.facility_size,
    fr.solutions_interest,
    fr.timeline,
    fr.full_name,
    fr.organization,
    fr.email,
    fr.phone,
    fr.contact_method,
    fr.notes,
    fr.lead_score,
    EXTRACT(EPOCH FROM (COALESCE(fs.completed_at, NOW()) - fs.created_at)) as session_duration_seconds,
    (SELECT COUNT(*) FROM tracking_events te WHERE te.session_id = fs.session_id) as total_events,
    (SELECT MAX(step_number) FROM form_steps st WHERE st.session_id = fs.session_id) as max_step_reached
FROM form_sessions fs
LEFT JOIN form_responses fr ON fs.session_id = fr.session_id;

-- ----------------------------------------------------------------------------
-- 6. Least-privilege application role. The API, Celery and the sender connect
--    as app_rw (APP_DATABASE_URL); migrations keep using the owner. The owner
--    is a superuser and bypasses RLS - which is exactly why the app must not
--    connect as it. Password/LOGIN is set from env by database/migrate.py.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
        CREATE ROLE app_rw NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE INHERIT;
    END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rw;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_rw;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO app_rw;

-- ----------------------------------------------------------------------------
-- 7. Row-level security on every tenant table (fail closed: with no brand set
--    and no bypass, a query sees nothing and can write nothing).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    t text;
    tenant_tables constant text[] := ARRAY[
        'scraped_leads', 'scraping_jobs', 'scraping_logs',
        'campaigns', 'sent_emails', 'email_queue',
        'email_clicks', 'email_replies', 'email_bounces', 'email_unsubscribes',
        'email_exclusions', 'email_accounts', 'segments',
        'email_ai_settings', 'scheduler_settings', 'scheduler_run_history',
        'form_sessions', 'form_responses', 'form_steps', 'tracking_events',
        'api_keys', 'social_media_accounts', 'social_media_posts',
        'stakeholders', 'shareholder_profiles', 'partner_profiles', 'govt_agency_profiles',
        'staging_legacy_contacts', 'stakeholder_audit_logs', 'agent_execution_approvals'
    ];
BEGIN
    FOREACH t IN ARRAY tenant_tables LOOP
        IF to_regclass('public.' || t) IS NULL THEN
            CONTINUE;
        END IF;
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t
                       AND policyname = 'brand_isolation_v1') THEN
            EXECUTE format($p$
                CREATE POLICY brand_isolation_v1 ON %I
                USING (
                    current_setting('app.tenancy_bypass', true) = 'on'
                    OR brand_id = NULLIF(current_setting('app.brand_id', true), '')::uuid
                )
                WITH CHECK (
                    current_setting('app.tenancy_bypass', true) = 'on'
                    OR brand_id = NULLIF(current_setting('app.brand_id', true), '')::uuid
                )$p$, t);
        END IF;
    END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 8. One-time bootstrap: every existing user becomes a member of brand 1 with
--    their current access. Every existing 'admin' becomes a platform admin
--    (on a single-brand install they already had full control). On a fresh
--    install there are no users yet: the first registered account becomes
--    platform admin (api/routers/auth.py register).
--    Guarded so a later revoke is never silently re-granted on restart.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM tenancy_migrations WHERE key = 'bootstrap_v1') THEN
        INSERT INTO brand_members (brand_id, sales_rep_id, role, is_default)
        SELECT '00000000-0000-0000-0000-0000000000a1', id,
               CASE WHEN role = 'admin' THEN 'admin' ELSE 'member' END, TRUE
        FROM sales_reps
        ON CONFLICT DO NOTHING;

        UPDATE sales_reps SET is_platform_admin = TRUE
        WHERE role = 'admin';

        INSERT INTO tenancy_migrations (key) VALUES ('bootstrap_v1');
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 9. Nexus audit trigger: stamp the audit row with the stakeholder's own
--    brand explicitly (nexus_schema.sql defines the original; this runs after
--    it on every startup and replaces it).
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('public.stakeholder_audit_logs') IS NOT NULL THEN
        CREATE OR REPLACE FUNCTION log_stakeholder_mutation()
        RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $fn$
        DECLARE
          _changed JSONB;
        BEGIN
          IF TG_OP = 'DELETE' THEN
            _changed := to_jsonb(OLD);
            INSERT INTO stakeholder_audit_logs(brand_id, stakeholder_id, action, performed_by_agent, changed_fields)
            VALUES (OLD.brand_id, OLD.id, 'DELETE', 'SYSTEM_ADMIN', _changed);
            RETURN OLD;
          ELSIF TG_OP = 'UPDATE' THEN
            _changed := jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW));
            INSERT INTO stakeholder_audit_logs(brand_id, stakeholder_id, action, performed_by_agent, changed_fields)
            VALUES (NEW.brand_id, NEW.id, 'UPDATE', 'SYSTEM_ADMIN', _changed);
            RETURN NEW;
          ELSE
            INSERT INTO stakeholder_audit_logs(brand_id, stakeholder_id, action, performed_by_agent, changed_fields)
            VALUES (NEW.brand_id, NEW.id, 'INSERT', 'SYSTEM_ADMIN', to_jsonb(NEW));
            RETURN NEW;
          END IF;
        END;
        $fn$;
    END IF;
END $$;

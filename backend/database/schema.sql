-- ============================================================================
-- Consolidated database schema — vanilla PostgreSQL 16
-- ============================================================================
-- Single source of truth for the whole app (replaces all Supabase migrations
-- in supabase/migrations/, backend/migrations/ and the root-level fix files).
--
-- IDEMPOTENT: safe to run on every backend startup.
--   - CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
--   - CREATE OR REPLACE FUNCTION / VIEW
--   - DROP TRIGGER IF EXISTS + CREATE TRIGGER
--   - ADD COLUMN IF NOT EXISTS guards for columns added over time
--
-- No RLS, no policies, no grants to anon/authenticated, no auth schema.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Types
-- ----------------------------------------------------------------------------

DO $$
BEGIN
    CREATE TYPE session_status AS ENUM ('started', 'in_progress', 'completed', 'abandoned', 'page_visit');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- upgrade guard for databases created before 'page_visit' existed
ALTER TYPE session_status ADD VALUE IF NOT EXISTS 'page_visit';

-- ----------------------------------------------------------------------------
-- 2. Form tracking tables (001 + 004)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS form_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID UNIQUE NOT NULL,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    utm_content TEXT,
    sales_rep_name TEXT,
    sales_rep_id TEXT,
    user_agent TEXT,
    ip_address TEXT,
    referrer TEXT,
    landing_page TEXT,
    device_type TEXT,
    browser TEXT,
    country TEXT,
    -- enhanced tracking (004)
    os TEXT,
    screen_resolution TEXT,
    viewport_size TEXT,
    timezone TEXT,
    language TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status session_status DEFAULT 'started'
);

CREATE INDEX IF NOT EXISTS idx_form_sessions_session_id ON form_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_form_sessions_status ON form_sessions(status);
CREATE INDEX IF NOT EXISTS idx_form_sessions_created_at ON form_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_form_sessions_utm_source ON form_sessions(utm_source);
CREATE INDEX IF NOT EXISTS idx_form_sessions_sales_rep_id ON form_sessions(sales_rep_id);
CREATE INDEX IF NOT EXISTS idx_form_sessions_metadata ON form_sessions USING gin(metadata);

CREATE TABLE IF NOT EXISTS form_responses (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES form_sessions(session_id) ON DELETE CASCADE,
    -- Step 1
    industry TEXT,
    challenge TEXT,
    -- Step 2
    automation_level TEXT,
    facility_size TEXT,
    -- Step 3
    solutions_interest TEXT[],
    timeline TEXT,
    -- Step 4 (contact info)
    full_name TEXT,
    organization TEXT,
    email TEXT,
    phone TEXT,
    contact_method TEXT,
    notes TEXT,
    -- Lead scoring
    lead_score INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_session_response UNIQUE (session_id)
);

CREATE INDEX IF NOT EXISTS idx_form_responses_session_id ON form_responses(session_id);
CREATE INDEX IF NOT EXISTS idx_form_responses_email ON form_responses(email);
CREATE INDEX IF NOT EXISTS idx_form_responses_created_at ON form_responses(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_form_responses_lead_score ON form_responses(lead_score DESC);

CREATE TABLE IF NOT EXISTS tracking_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES form_sessions(session_id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    event_data JSONB,
    step_number INTEGER,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    time_since_start INTEGER, -- milliseconds since session start
    CONSTRAINT valid_event_type CHECK (event_type != '')
);

CREATE INDEX IF NOT EXISTS idx_tracking_events_session_id ON tracking_events(session_id);
CREATE INDEX IF NOT EXISTS idx_tracking_events_event_type ON tracking_events(event_type);
CREATE INDEX IF NOT EXISTS idx_tracking_events_timestamp ON tracking_events(timestamp DESC);

CREATE TABLE IF NOT EXISTS form_steps (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES form_sessions(session_id) ON DELETE CASCADE,
    step_number INTEGER NOT NULL,
    step_name TEXT NOT NULL,
    entered_at TIMESTAMPTZ DEFAULT NOW(),
    exited_at TIMESTAMPTZ,
    time_spent INTEGER, -- seconds spent on this step
    answers JSONB,
    CONSTRAINT valid_step_number CHECK (step_number BETWEEN 1 AND 20)
);

-- upgrade guard: widen the step range for multi-step forms beyond 4 steps
ALTER TABLE form_steps DROP CONSTRAINT IF EXISTS valid_step_number;
ALTER TABLE form_steps ADD CONSTRAINT valid_step_number CHECK (step_number BETWEEN 1 AND 20);

CREATE INDEX IF NOT EXISTS idx_form_steps_session_id ON form_steps(session_id);
CREATE INDEX IF NOT EXISTS idx_form_steps_step_number ON form_steps(step_number);

-- ----------------------------------------------------------------------------
-- 3. Users (sales_reps) + API keys (006 + 007, minus Supabase auth)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sales_reps (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    -- plain UUID for legacy compat (was FK to auth.users on Supabase)
    auth_user_id UUID DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'sales_rep' CHECK (role IN ('admin', 'sales_rep')),
    -- UTM defaults for campaign tracking
    utm_source TEXT DEFAULT 'email',
    utm_medium TEXT DEFAULT 'campaign',
    utm_default_campaign TEXT,
    phone TEXT,
    -- local auth
    password_hash TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    CONSTRAINT valid_email CHECK (email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$'),
    CONSTRAINT valid_full_name CHECK (char_length(full_name) >= 2)
);

-- Upgrade guards for databases created before local auth existed
ALTER TABLE sales_reps ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE sales_reps ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ;
ALTER TABLE sales_reps ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE sales_reps ADD COLUMN IF NOT EXISTS auth_user_id UUID DEFAULT gen_random_uuid();

CREATE INDEX IF NOT EXISTS idx_sales_reps_email ON sales_reps(email);
CREATE INDEX IF NOT EXISTS idx_sales_reps_auth_user_id ON sales_reps(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_sales_reps_role ON sales_reps(role);
CREATE INDEX IF NOT EXISTS idx_sales_reps_is_active ON sales_reps(is_active);

CREATE TABLE IF NOT EXISTS api_keys (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    key_name TEXT NOT NULL,
    api_key_encrypted TEXT NOT NULL, -- encrypted/handled at application level
    provider TEXT DEFAULT 'serpapi' CHECK (provider IN ('serpapi')),
    assigned_to UUID REFERENCES sales_reps(id) ON DELETE SET NULL,
    -- 007: SerpAPI handles real limits; keep counters informational only
    usage_count INTEGER DEFAULT 0 CHECK (usage_count >= 0),
    usage_limit INTEGER DEFAULT 999999 CHECK (usage_limit > 0),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_used TIMESTAMPTZ,
    CONSTRAINT valid_key_name CHECK (char_length(key_name) >= 3)
);

CREATE INDEX IF NOT EXISTS idx_api_keys_assigned_to ON api_keys(assigned_to);
CREATE INDEX IF NOT EXISTS idx_api_keys_is_active ON api_keys(is_active);
CREATE INDEX IF NOT EXISTS idx_api_keys_usage_limit ON api_keys(usage_count, usage_limit);

-- ----------------------------------------------------------------------------
-- 4. Lead scraper tables (006 + 008 + 009 + 011)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS scraping_jobs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    job_name TEXT NOT NULL,
    search_query TEXT NOT NULL, -- single query or JSON array for batch
    industry TEXT,
    location TEXT DEFAULT 'Malaysia',
    num_queries INTEGER DEFAULT 5 CHECK (num_queries BETWEEN 1 AND 20),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    progress INTEGER DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    current_step TEXT,
    celery_task_id VARCHAR(255) UNIQUE,
    started_by UUID REFERENCES sales_reps(id) ON DELETE SET NULL,
    api_key_used UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    leads_found INTEGER DEFAULT 0 CHECK (leads_found >= 0),
    csv_file_path TEXT,
    -- Brevo export (011)
    brevo_ready_count INTEGER DEFAULT 0,
    brevo_csv_file_path TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    error_message TEXT,
    config JSONB DEFAULT '{}'::jsonb,
    CONSTRAINT valid_job_name CHECK (char_length(job_name) >= 3),
    CONSTRAINT valid_search_query CHECK (char_length(search_query) >= 3),
    CONSTRAINT valid_completed_at CHECK (completed_at IS NULL OR completed_at >= started_at)
);

ALTER TABLE scraping_jobs ADD COLUMN IF NOT EXISTS brevo_ready_count INTEGER DEFAULT 0;
ALTER TABLE scraping_jobs ADD COLUMN IF NOT EXISTS brevo_csv_file_path TEXT;

CREATE INDEX IF NOT EXISTS idx_scraping_jobs_started_by ON scraping_jobs(started_by);
CREATE INDEX IF NOT EXISTS idx_scraping_jobs_status ON scraping_jobs(status);
CREATE INDEX IF NOT EXISTS idx_scraping_jobs_started_at ON scraping_jobs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_scraping_jobs_api_key_used ON scraping_jobs(api_key_used);
CREATE INDEX IF NOT EXISTS idx_scraping_jobs_industry ON scraping_jobs(industry);
CREATE INDEX IF NOT EXISTS idx_scraping_jobs_celery_task ON scraping_jobs(celery_task_id) WHERE celery_task_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS scraped_leads (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    job_id UUID REFERENCES scraping_jobs(id) ON DELETE CASCADE,
    -- contact info
    email TEXT,
    phone TEXT,
    decision_maker_name TEXT,
    decision_maker_title TEXT,
    is_executive BOOLEAN DEFAULT FALSE,
    company_name TEXT,
    -- source info
    source_url TEXT,
    page_title TEXT,
    search_query TEXT,
    url_score INTEGER CHECK (url_score BETWEEN 0 AND 10),
    -- categorization
    industry TEXT,
    location TEXT,
    -- lead management ('invalid'/'failed' added: backend writes them during email verification)
    status TEXT DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'unqualified', 'archived', 'invalid', 'failed')),
    assigned_to UUID REFERENCES sales_reps(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_email CHECK (email IS NULL OR email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$'),
    CONSTRAINT has_contact_info CHECK (email IS NOT NULL OR phone IS NOT NULL OR decision_maker_name IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_scraped_leads_job_id ON scraped_leads(job_id);
CREATE INDEX IF NOT EXISTS idx_scraped_leads_email ON scraped_leads(email);
CREATE INDEX IF NOT EXISTS idx_scraped_leads_is_executive ON scraped_leads(is_executive);
CREATE INDEX IF NOT EXISTS idx_scraped_leads_status ON scraped_leads(status);
CREATE INDEX IF NOT EXISTS idx_scraped_leads_assigned_to ON scraped_leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_scraped_leads_industry ON scraped_leads(industry);
CREATE INDEX IF NOT EXISTS idx_scraped_leads_created_at ON scraped_leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scraped_leads_company_name ON scraped_leads(company_name);
CREATE INDEX IF NOT EXISTS idx_scraped_leads_search ON scraped_leads USING gin(
    to_tsvector('english',
        COALESCE(decision_maker_name, '') || ' ' ||
        COALESCE(company_name, '') || ' ' ||
        COALESCE(email, '') || ' ' ||
        COALESCE(decision_maker_title, '')
    )
);

CREATE TABLE IF NOT EXISTS scraping_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    job_id UUID REFERENCES scraping_jobs(id) ON DELETE CASCADE,
    log_level TEXT NOT NULL CHECK (log_level IN ('debug', 'info', 'warning', 'error')),
    message TEXT NOT NULL,
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_message CHECK (char_length(message) >= 1)
);

CREATE INDEX IF NOT EXISTS idx_scraping_logs_job_id ON scraping_logs(job_id);
CREATE INDEX IF NOT EXISTS idx_scraping_logs_level ON scraping_logs(log_level);
CREATE INDEX IF NOT EXISTS idx_scraping_logs_created_at ON scraping_logs(created_at DESC);

-- ----------------------------------------------------------------------------
-- 5. Email accounts (FIX_EMAIL_ACCOUNTS_TABLE version + AI personas)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS email_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    display_name VARCHAR(255),
    provider VARCHAR(50) DEFAULT 'gmail',
    -- sending limits
    daily_limit INTEGER DEFAULT 50,
    hourly_limit INTEGER DEFAULT 20,
    sent_today INTEGER DEFAULT 0,
    sent_this_hour INTEGER DEFAULT 0,
    last_sent_date DATE,
    last_sent_time TIMESTAMPTZ,
    -- health metrics
    total_sent INTEGER DEFAULT 0,
    total_opened INTEGER DEFAULT 0,
    total_clicked INTEGER DEFAULT 0,
    total_replied INTEGER DEFAULT 0,
    total_bounced INTEGER DEFAULT 0,
    total_unsubscribed INTEGER DEFAULT 0,
    -- calculated rates
    open_rate DECIMAL(5,2) DEFAULT 0,
    bounce_rate DECIMAL(5,2) DEFAULT 0,
    reply_rate DECIMAL(5,2) DEFAULT 0,
    health_score INTEGER DEFAULT 100, -- 0-100
    -- account status
    is_active BOOLEAN DEFAULT true,
    is_warmed_up BOOLEAN DEFAULT false,
    warmup_day INTEGER DEFAULT 1,
    status VARCHAR(50) DEFAULT 'active',
    status_reason TEXT,
    -- OAuth tokens
    refresh_token TEXT,
    access_token TEXT,
    token_expires_at TIMESTAMPTZ,
    -- AI sender persona (ADD_AI_PERSONAS_TO_DB)
    sender_name VARCHAR(100),
    sender_title VARCHAR(200),
    persona TEXT,
    focus_area TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS display_name VARCHAR(255);
ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS sender_name VARCHAR(100);
ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS sender_title VARCHAR(200);
ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS persona TEXT;
ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS focus_area TEXT;

CREATE INDEX IF NOT EXISTS idx_email_accounts_email ON email_accounts(email);
CREATE INDEX IF NOT EXISTS idx_email_accounts_active ON email_accounts(is_active);

-- ----------------------------------------------------------------------------
-- 6. Campaigns (canonical table; email_campaigns/campaign_recipients dropped)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    email_account_id UUID REFERENCES email_accounts(id),
    user_prompt TEXT,
    cta_links JSONB,
    target_count INTEGER DEFAULT 0,
    queued_count INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    opened_count INTEGER DEFAULT 0,
    clicked_count INTEGER DEFAULT 0,
    replied_count INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'draft',
    delay_between_emails INTEGER DEFAULT 180, -- seconds
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    paused_at TIMESTAMPTZ,
    created_by VARCHAR(255),
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_created_at ON campaigns(created_at DESC);

-- ----------------------------------------------------------------------------
-- 7. Sent emails (merged final shape: 012 base + ADD_SENT_EMAILS_COLUMNS +
--    ADD_FROM_EMAIL_COLUMN, constraints per FINAL_FIX_ALL_CONSTRAINTS /
--    PRODUCTION_FIX_SENT_EMAILS: only campaign_id and email_account_id FKs,
--    both nullable; recipient_id / lead_id are bare UUIDs)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sent_emails (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    -- relationships (nullable; only two real FKs survive)
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    email_account_id UUID REFERENCES email_accounts(id) ON DELETE SET NULL,
    recipient_id UUID, -- bare UUID, no FK (campaign_recipients abandoned)
    lead_id UUID,      -- bare UUID, no FK
    -- sender / recipient
    from_email VARCHAR(255),
    recipient_email VARCHAR(255),
    recipient_name VARCHAR(255),
    -- content
    subject VARCHAR(500),
    body_html TEXT,
    body_text TEXT,
    -- tracking
    tracking_token VARCHAR(255) DEFAULT gen_random_uuid()::text,
    gmail_message_id VARCHAR(255),
    gmail_thread_id VARCHAR(255),
    -- event timestamps (canonical tracking model)
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    opened_at TIMESTAMPTZ,
    clicked_at TIMESTAMPTZ,
    replied_at TIMESTAMPTZ,
    bounced_at TIMESTAMPTZ,
    status VARCHAR(50) DEFAULT 'sent',
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE sent_emails ADD COLUMN IF NOT EXISTS from_email VARCHAR(255);
ALTER TABLE sent_emails ADD COLUMN IF NOT EXISTS error_message TEXT;

CREATE INDEX IF NOT EXISTS idx_sent_emails_campaign ON sent_emails(campaign_id);
CREATE INDEX IF NOT EXISTS idx_sent_emails_account ON sent_emails(email_account_id);
CREATE INDEX IF NOT EXISTS idx_sent_emails_lead ON sent_emails(lead_id);
CREATE INDEX IF NOT EXISTS idx_sent_emails_recipient_email ON sent_emails(recipient_email);
CREATE INDEX IF NOT EXISTS idx_sent_emails_sent_at ON sent_emails(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_sent_emails_tracking_token ON sent_emails(tracking_token);
CREATE INDEX IF NOT EXISTS idx_sent_emails_from_email ON sent_emails(from_email);
CREATE INDEX IF NOT EXISTS idx_sent_emails_status ON sent_emails(status);
CREATE INDEX IF NOT EXISTS idx_sent_emails_created_at ON sent_emails(created_at DESC);

-- ----------------------------------------------------------------------------
-- 8. Email queue (FIX_EMAIL_ACCOUNTS shape + FINAL_FIX FKs: lead_id bare UUID)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS email_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    lead_id UUID, -- bare UUID, no FK
    email_account_id UUID REFERENCES email_accounts(id) ON DELETE SET NULL,
    -- recipient info (denormalized for performance)
    recipient_email VARCHAR(255) NOT NULL,
    recipient_name VARCHAR(255),
    recipient_company VARCHAR(255),
    recipient_title VARCHAR(255),
    -- scheduling
    scheduled_for TIMESTAMPTZ NOT NULL,
    priority INTEGER DEFAULT 0,
    -- status tracking
    status VARCHAR(50) DEFAULT 'pending', -- pending, sending, sent, failed, cancelled
    sent_at TIMESTAMPTZ,
    sent_email_id UUID REFERENCES sent_emails(id),
    -- error handling
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    last_retry_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_queue(status);
CREATE INDEX IF NOT EXISTS idx_email_queue_scheduled ON email_queue(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_email_queue_campaign ON email_queue(campaign_id);

-- ----------------------------------------------------------------------------
-- 9. Email event tables (012, FKs rebuilt against surviving tables only)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS email_clicks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    sent_email_id UUID NOT NULL REFERENCES sent_emails(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    lead_id UUID, -- bare UUID for consistency with sent_emails
    -- click details
    link_url TEXT NOT NULL,
    link_position INTEGER,
    click_token VARCHAR(100) UNIQUE DEFAULT gen_random_uuid()::text,
    -- user agent data
    user_agent TEXT,
    ip_address INET,
    device_type VARCHAR(50),
    browser VARCHAR(50),
    os VARCHAR(50),
    -- location data
    country VARCHAR(100),
    city VARCHAR(100),
    timezone VARCHAR(100),
    clicked_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_clicks_sent_email ON email_clicks(sent_email_id);
CREATE INDEX IF NOT EXISTS idx_email_clicks_campaign ON email_clicks(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_clicks_lead ON email_clicks(lead_id);
CREATE INDEX IF NOT EXISTS idx_email_clicks_clicked_at ON email_clicks(clicked_at DESC);

CREATE TABLE IF NOT EXISTS email_replies (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    sent_email_id UUID NOT NULL REFERENCES sent_emails(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    lead_id UUID, -- bare UUID
    -- gmail details
    gmail_message_id VARCHAR(255) UNIQUE NOT NULL,
    gmail_thread_id VARCHAR(255),
    -- reply content
    from_email VARCHAR(255) NOT NULL,
    from_name VARCHAR(255),
    subject VARCHAR(500),
    body_html TEXT,
    body_text TEXT,
    received_at TIMESTAMPTZ NOT NULL,
    -- manual review
    reviewed BOOLEAN DEFAULT false,
    reviewed_by UUID REFERENCES sales_reps(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,
    -- AI analysis (future feature)
    sentiment VARCHAR(50),
    intent VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_replies_sent_email ON email_replies(sent_email_id);
CREATE INDEX IF NOT EXISTS idx_email_replies_campaign ON email_replies(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_replies_lead ON email_replies(lead_id);
CREATE INDEX IF NOT EXISTS idx_email_replies_reviewed ON email_replies(reviewed);
CREATE INDEX IF NOT EXISTS idx_email_replies_received_at ON email_replies(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_replies_gmail_message_id ON email_replies(gmail_message_id);

CREATE TABLE IF NOT EXISTS email_bounces (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    sent_email_id UUID NOT NULL REFERENCES sent_emails(id) ON DELETE CASCADE,
    email_account_id UUID REFERENCES email_accounts(id) ON DELETE CASCADE,
    lead_id UUID, -- bare UUID
    -- bounce details
    bounce_type VARCHAR(50) NOT NULL CHECK (bounce_type IN ('hard', 'soft', 'complaint')),
    bounce_subtype VARCHAR(100),
    bounce_reason TEXT,
    -- gmail API response
    gmail_error_code VARCHAR(50),
    gmail_error_message TEXT,
    -- auto-handling
    auto_handled BOOLEAN DEFAULT false,
    action_taken VARCHAR(100),
    bounced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_bounces_sent_email ON email_bounces(sent_email_id);
CREATE INDEX IF NOT EXISTS idx_email_bounces_account ON email_bounces(email_account_id);
CREATE INDEX IF NOT EXISTS idx_email_bounces_lead ON email_bounces(lead_id);
CREATE INDEX IF NOT EXISTS idx_email_bounces_type ON email_bounces(bounce_type);
CREATE INDEX IF NOT EXISTS idx_email_bounces_bounced_at ON email_bounces(bounced_at DESC);

CREATE TABLE IF NOT EXISTS email_unsubscribes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    lead_id UUID, -- bare UUID (tracking router inserts without one)
    sent_email_id UUID REFERENCES sent_emails(id) ON DELETE SET NULL,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    email VARCHAR(255) NOT NULL,
    unsubscribe_token VARCHAR(100) UNIQUE DEFAULT gen_random_uuid()::text,
    source VARCHAR(50) DEFAULT 'link' CHECK (source IN ('link', 'reply', 'manual', 'bounce')),
    reason TEXT, -- written by /track/unsubscribe endpoint
    unsubscribed_at TIMESTAMPTZ DEFAULT NOW(),
    ip_address INET,
    user_agent TEXT,
    UNIQUE(email)
);

ALTER TABLE email_unsubscribes ADD COLUMN IF NOT EXISTS reason TEXT;

CREATE INDEX IF NOT EXISTS idx_email_unsubscribes_lead ON email_unsubscribes(lead_id);
CREATE INDEX IF NOT EXISTS idx_email_unsubscribes_email ON email_unsubscribes(email);
CREATE INDEX IF NOT EXISTS idx_email_unsubscribes_unsubscribed_at ON email_unsubscribes(unsubscribed_at DESC);

-- ----------------------------------------------------------------------------
-- 10. Scheduler (backend/003_scheduler_settings.sql)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS scheduler_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_enabled BOOLEAN DEFAULT FALSE,
    daily_limit INTEGER DEFAULT 30,
    send_hour INTEGER DEFAULT 10,   -- 0-23
    send_minute INTEGER DEFAULT 0,  -- 0-59
    timezone VARCHAR(50) DEFAULT 'Asia/Kuala_Lumpur',
    delay_between_emails INTEGER DEFAULT 60, -- seconds
    last_run_at TIMESTAMPTZ,
    last_run_status VARCHAR(20), -- 'success', 'failed', 'partial'
    last_run_sent_count INTEGER DEFAULT 0,
    last_run_error TEXT,
    next_run_at TIMESTAMPTZ,
    total_runs INTEGER DEFAULT 0,
    total_emails_sent INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scheduler_run_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status VARCHAR(20), -- 'running', 'success', 'failed', 'partial'
    leads_attempted INTEGER DEFAULT 0,
    emails_sent INTEGER DEFAULT 0,
    emails_failed INTEGER DEFAULT 0,
    error_message TEXT,
    error_details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduler_run_history_created_at ON scheduler_run_history(created_at DESC);

-- ----------------------------------------------------------------------------
-- 11. Email AI settings (backend/add_email_ai_settings.sql)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS email_ai_settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    -- company information
    company_name VARCHAR(255) NOT NULL DEFAULT 'Your Company Name',
    company_tagline TEXT DEFAULT 'Your company tagline',
    company_services TEXT DEFAULT E'Service 1\nService 2\nService 3',
    -- CTA links (fixed 2 links)
    cta_link_1_label VARCHAR(100) DEFAULT 'Schedule a Call',
    cta_link_1_url VARCHAR(500) DEFAULT 'https://calendly.com/your-link',
    cta_link_2_label VARCHAR(100) DEFAULT 'Learn More',
    cta_link_2_url VARCHAR(500) DEFAULT 'https://www.your-website.com',
    -- email generation settings
    email_word_limit INTEGER DEFAULT 150,
    email_tone VARCHAR(100) DEFAULT 'professional but conversational',
    -- full AI prompt template (placeholders: {company_name}, {company_tagline},
    -- {company_services}, {sender_name}, {sender_title}, {sender_persona},
    -- {sender_focus}, {lead_name}, {lead_company}, {lead_title}, {lead_industry})
    ai_prompt_template TEXT DEFAULT 'You are {sender_name}, {sender_title} at {company_name} - {company_tagline}.

Your personality: {sender_persona}
Your focus: {sender_focus}

ABOUT {company_name} (CRITICAL - ONLY WRITE ABOUT THIS):
{company_name} specializes in:
{company_services}

Write a personalized cold outreach email to:
- Name: {lead_name}
- Company: {lead_company}
- Title: {lead_title}
- Industry: {lead_industry}

STRICT REQUIREMENTS:
1. ONLY discuss {company_name}''s services (listed above)
2. Focus on how {lead_company} in {lead_industry} industry could benefit
3. Reference specific pain points in {lead_industry} that your services can solve
4. Mention CONCRETE benefits: cost reduction, efficiency gains, ROI
5. Professional but conversational tone - like a human consultant reaching out
6. Show you researched their company/industry (mention {lead_title} role specifically)
7. Focus on YOUR specialty: {sender_focus}
8. Keep it under {word_limit} words (3-4 short paragraphs)
9. Sign as {sender_name}, {sender_title} at {company_name}
10. Include clear call-to-action with the CTA links provided

NEVER:
- Mention you are an AI or this is automated
- Talk about services outside what is listed above
- Use generic "solutions" language without specifics
- Write about other companies or industries
- Use salesy buzzwords

Write as if you personally researched {lead_company} and are genuinely reaching out to help.',
    -- AI provider selection (gemini | claude | claude-cli | openai | custom)
    ai_provider VARCHAR(20) DEFAULT 'gemini',
    ai_model VARCHAR(100) DEFAULT '',
    ai_api_key TEXT DEFAULT '',
    ai_base_url VARCHAR(500) DEFAULT '',
    -- metadata
    last_updated_by UUID REFERENCES sales_reps(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_ai_settings_updated_at ON email_ai_settings(updated_at DESC);

-- upgrade guards: AI provider columns for databases created before multi-provider support
ALTER TABLE email_ai_settings ADD COLUMN IF NOT EXISTS ai_provider VARCHAR(20) DEFAULT 'gemini';
ALTER TABLE email_ai_settings ADD COLUMN IF NOT EXISTS ai_model VARCHAR(100) DEFAULT '';
ALTER TABLE email_ai_settings ADD COLUMN IF NOT EXISTS ai_api_key TEXT DEFAULT '';
ALTER TABLE email_ai_settings ADD COLUMN IF NOT EXISTS ai_base_url VARCHAR(500) DEFAULT '';

-- ----------------------------------------------------------------------------
-- 12. Email exclusions (backend/add_email_exclusions.sql, gen_random_uuid())
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS email_exclusions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    reason TEXT,
    excluded_by VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_exclusions_email ON email_exclusions(email);

-- ----------------------------------------------------------------------------
-- 13. Functions
-- ----------------------------------------------------------------------------

-- Lead score calculation (001)
CREATE OR REPLACE FUNCTION calculate_lead_score(
    p_industry TEXT,
    p_timeline TEXT,
    p_automation_level TEXT,
    p_facility_size TEXT
) RETURNS INTEGER AS $$
DECLARE
    score INTEGER := 0;
BEGIN
    -- Industry scoring
    IF p_industry IN ('Manufacturing & Production', 'Logistics & Distribution', 'Warehousing & Storage') THEN
        score := score + 30;
    ELSIF p_industry IN ('Healthcare & Pharmaceuticals') THEN
        score := score + 25;
    ELSE
        score := score + 15;
    END IF;

    -- Timeline scoring
    CASE p_timeline
        WHEN 'Immediate (0-3 months)' THEN score := score + 35;
        WHEN 'Short-term (3-6 months)' THEN score := score + 25;
        WHEN 'Mid-term (6-12 months)' THEN score := score + 15;
        WHEN 'Long-term (12+ months)' THEN score := score + 5;
        ELSE score := score + 5;
    END CASE;

    -- Automation level scoring (sweet spot: some automation)
    CASE p_automation_level
        WHEN 'Some automation - looking to expand' THEN score := score + 25;
        WHEN 'Moderate automation - need optimization' THEN score := score + 20;
        WHEN 'No automation - fully manual operations' THEN score := score + 15;
        WHEN 'Highly automated - seeking advanced solutions' THEN score := score + 10;
        ELSE score := score + 5;
    END CASE;

    -- Facility size scoring
    CASE p_facility_size
        WHEN 'Very Large (50,000+ sq ft)' THEN score := score + 10;
        WHEN 'Large (20,000 - 50,000 sq ft)' THEN score := score + 8;
        WHEN 'Medium (5,000 - 20,000 sq ft)' THEN score := score + 6;
        WHEN 'Small (< 5,000 sq ft)' THEN score := score + 3;
        ELSE score := score + 2;
    END CASE;

    RETURN score;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Auto-populate lead_score on form_responses (001)
CREATE OR REPLACE FUNCTION update_lead_score()
RETURNS TRIGGER AS $$
BEGIN
    NEW.lead_score := calculate_lead_score(
        NEW.industry,
        NEW.timeline,
        NEW.automation_level,
        NEW.facility_size
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Mark session completed when a form response arrives (001)
CREATE OR REPLACE FUNCTION update_session_status()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE form_sessions
    SET status = 'completed',
        completed_at = NOW()
    WHERE session_id = NEW.session_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recount scraping_jobs.leads_found on new scraped lead (006)
CREATE OR REPLACE FUNCTION update_job_leads_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE scraping_jobs
    SET leads_found = (
        SELECT COUNT(*)
        FROM scraped_leads
        WHERE job_id = NEW.job_id
    )
    WHERE id = NEW.job_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Generic updated_at maintainer (006; also used for email_accounts)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Bump API key usage counter (006, semantics per 007: informational only)
CREATE OR REPLACE FUNCTION increment_api_key_usage(key_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE api_keys
    SET
        usage_count = usage_count + 1,
        last_used = NOW()
    WHERE id = key_id;

    UPDATE api_keys
    SET is_active = FALSE
    WHERE id = key_id AND usage_count >= usage_limit;
END;
$$ LANGUAGE plpgsql;

-- Campaign counters — CORRECTED version (CHECK_AND_FIX_TRIGGERS.sql):
-- sent_count on INSERT, opened_count on opened_at NULL -> NOT NULL transition.
CREATE OR REPLACE FUNCTION update_campaign_stats()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.campaign_id IS NOT NULL THEN
        UPDATE campaigns
        SET sent_count = sent_count + 1
        WHERE id = NEW.campaign_id;
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.opened_at IS NOT NULL AND OLD.opened_at IS NULL AND NEW.campaign_id IS NOT NULL THEN
        UPDATE campaigns
        SET opened_count = opened_count + 1
        WHERE id = NEW.campaign_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 14. Triggers (drop + recreate for idempotency)
-- ----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trigger_update_lead_score ON form_responses;
CREATE TRIGGER trigger_update_lead_score
    BEFORE INSERT OR UPDATE ON form_responses
    FOR EACH ROW
    EXECUTE FUNCTION update_lead_score();

DROP TRIGGER IF EXISTS trigger_complete_session ON form_responses;
CREATE TRIGGER trigger_complete_session
    AFTER INSERT ON form_responses
    FOR EACH ROW
    EXECUTE FUNCTION update_session_status();

DROP TRIGGER IF EXISTS trigger_update_leads_count ON scraped_leads;
CREATE TRIGGER trigger_update_leads_count
    AFTER INSERT ON scraped_leads
    FOR EACH ROW
    EXECUTE FUNCTION update_job_leads_count();

DROP TRIGGER IF EXISTS trigger_update_scraped_leads_timestamp ON scraped_leads;
CREATE TRIGGER trigger_update_scraped_leads_timestamp
    BEFORE UPDATE ON scraped_leads
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_email_accounts_updated_at ON email_accounts;
CREATE TRIGGER trigger_email_accounts_updated_at
    BEFORE UPDATE ON email_accounts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_update_campaign_stats ON sent_emails;
CREATE TRIGGER trigger_update_campaign_stats
    AFTER INSERT OR UPDATE ON sent_emails
    FOR EACH ROW
    EXECUTE FUNCTION update_campaign_stats();

-- ----------------------------------------------------------------------------
-- 15. Analytics view (005 definition)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW analytics_overview AS
SELECT
    -- Session info
    fs.session_id,
    fs.created_at as session_created_at,
    fs.completed_at,
    fs.status,

    -- UTM parameters
    fs.utm_source,
    fs.utm_medium,
    fs.utm_campaign,
    fs.utm_content,

    -- Sales attribution
    fs.sales_rep_name,
    fs.sales_rep_id,

    -- Device & browser info
    fs.device_type,
    fs.browser,
    fs.os,
    fs.screen_resolution,
    fs.viewport_size,

    -- Location & preferences
    fs.timezone,
    fs.language,
    fs.country,

    -- Technical details
    fs.user_agent,
    fs.referrer,
    fs.landing_page,
    fs.metadata,

    -- Form response data
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

    -- Calculated fields
    EXTRACT(EPOCH FROM (COALESCE(fs.completed_at, NOW()) - fs.created_at)) as session_duration_seconds,
    (SELECT COUNT(*) FROM tracking_events WHERE session_id = fs.session_id) as total_events,
    (SELECT MAX(step_number) FROM form_steps WHERE session_id = fs.session_id) as max_step_reached

FROM form_sessions fs
LEFT JOIN form_responses fr ON fs.session_id = fr.session_id;


-- ============================================================================
-- LEAD SEGMENTS (modular)
-- A registry of lead segments (Shareholders, Government, ... add more freely)
-- plus a segment tag on every scraped lead. Everything below is idempotent so
-- it is safe to run on every startup.
-- ============================================================================

CREATE TABLE IF NOT EXISTS segments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,               -- slug stored on scraped_leads.segment
    label TEXT NOT NULL,                    -- human-readable display name
    description TEXT,
    color TEXT DEFAULT '#6366f1',           -- hex used for UI chips
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 100,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tag column on leads (nullable = unsegmented). Indexed for fast filtering.
ALTER TABLE scraped_leads ADD COLUMN IF NOT EXISTS segment TEXT;
CREATE INDEX IF NOT EXISTS idx_scraped_leads_segment ON scraped_leads(segment);

-- Seed the two segments we already have data for (idempotent).
INSERT INTO segments (key, label, description, color, sort_order) VALUES
  ('shareholders', 'Shareholders', 'Demo investor register — individual and nominee shareholders', '#8b5cf6', 10),
  ('government',   'Government',    'Malaysian government agencies and ministries',                    '#0ea5e9', 20)
ON CONFLICT (key) DO NOTHING;

-- Backfill existing leads from their import search_query tag. Only touches
-- rows that are not yet segmented, so it is a no-op after the first run.
UPDATE scraped_leads SET segment = 'shareholders'
  WHERE segment IS NULL AND search_query = 'demo_investor_list_2026-04';
UPDATE scraped_leads SET segment = 'government'
  WHERE segment IS NULL AND search_query = 'demo_govt_accounts_v2';


-- ============================================================================
-- CAMPAIGN A/B + TARGETING (additive, idempotent)
-- Extends the existing campaigns table so a campaign targets a segment, carries
-- A/B email variants, and paces its own daily volume. sent_emails.variant tags
-- which variant each send used, for A/B analytics.
-- ============================================================================
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS segment TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS variants JSONB DEFAULT '[]'::jsonb;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS daily_cap INTEGER DEFAULT 20;
ALTER TABLE sent_emails ADD COLUMN IF NOT EXISTS variant TEXT;
CREATE INDEX IF NOT EXISTS idx_sent_emails_variant ON sent_emails(campaign_id, variant);


-- Follow-up sequence steps per campaign: [{after_days, subject, body}, ...]
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS followups JSONB DEFAULT '[]'::jsonb;

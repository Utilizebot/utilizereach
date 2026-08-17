-- ============================================================================
-- Seed data — idempotent (safe to run on every backend startup)
-- ============================================================================

-- Default scheduler settings (singleton; from backend/003_scheduler_settings.sql)
INSERT INTO scheduler_settings (
    is_enabled,
    daily_limit,
    send_hour,
    send_minute,
    timezone,
    delay_between_emails
)
SELECT
    FALSE,                  -- disabled by default
    30,                     -- 30 emails per day
    10,                     -- 10 AM
    0,                      -- :00
    'Asia/Kuala_Lumpur',
    60                      -- 60 seconds between emails
WHERE NOT EXISTS (SELECT 1 FROM scheduler_settings);

-- Default AI email settings (singleton; from backend/add_email_ai_settings.sql)
-- ai_prompt_template comes from the column DEFAULT.
INSERT INTO email_ai_settings (
    company_name,
    company_tagline,
    company_services,
    cta_link_1_label,
    cta_link_1_url,
    cta_link_2_label,
    cta_link_2_url,
    email_word_limit,
    email_tone
)
SELECT
    'Your Company Name',
    'Your company tagline here',
    E'- Your service or product 1\n- Your service or product 2\n- Your service or product 3\n- Your service or product 4',
    'Schedule a Call',
    'https://calendly.com/your-link',
    'Learn More',
    'https://www.your-website.com',
    150,
    'professional but conversational'
WHERE NOT EXISTS (SELECT 1 FROM email_ai_settings);

-- Do-not-email seeds (from backend/add_email_exclusions.sql)
INSERT INTO email_exclusions (email, reason, excluded_by) VALUES
('demo.com', 'Internal test account', 'system'),
('demo.com', 'Team member', 'system')
ON CONFLICT (email) DO NOTHING;

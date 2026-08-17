-- ============================================================================
-- MIGRATION: Add Email AI Settings Table
-- ============================================================================
-- This table stores global company-level settings for AI email generation
-- Only ONE row should exist (singleton pattern like scheduler_settings)
-- ============================================================================

-- Create the email_ai_settings table
CREATE TABLE IF NOT EXISTS email_ai_settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

    -- Company Information
    company_name VARCHAR(255) NOT NULL DEFAULT 'Your Company Name',
    company_tagline TEXT DEFAULT 'Your company tagline',
    company_services TEXT DEFAULT 'Service 1
Service 2
Service 3',

    -- CTA Links (Fixed 2 links)
    cta_link_1_label VARCHAR(100) DEFAULT 'Schedule a Call',
    cta_link_1_url VARCHAR(500) DEFAULT 'https://calendly.com/your-link',
    cta_link_2_label VARCHAR(100) DEFAULT 'Learn More',
    cta_link_2_url VARCHAR(500) DEFAULT 'https://www.your-website.com',

    -- Email Generation Settings
    email_word_limit INTEGER DEFAULT 150,
    email_tone VARCHAR(100) DEFAULT 'professional but conversational',

    -- Full AI Prompt Template (Advanced)
    -- Users can customize the entire prompt
    -- Placeholders available: {company_name}, {company_tagline}, {company_services},
    -- {sender_name}, {sender_title}, {sender_persona}, {sender_focus},
    -- {lead_name}, {lead_company}, {lead_title}, {lead_industry}
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

    -- Metadata
    last_updated_by UUID REFERENCES sales_reps(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE email_ai_settings ENABLE ROW LEVEL SECURITY;

-- Policy: All authenticated users can read
CREATE POLICY "auth_read_email_ai_settings" ON email_ai_settings
    FOR SELECT TO authenticated USING (true);

-- Policy: Only admins can update (checked in application layer, but RLS allows authenticated)
CREATE POLICY "auth_update_email_ai_settings" ON email_ai_settings
    FOR UPDATE TO authenticated USING (true);

-- Policy: Only admins can insert (checked in application layer)
CREATE POLICY "auth_insert_email_ai_settings" ON email_ai_settings
    FOR INSERT TO authenticated WITH CHECK (true);

-- Insert default settings if none exist
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
    '- Your service or product 1
- Your service or product 2
- Your service or product 3
- Your service or product 4',
    'Schedule a Call',
    'https://calendly.com/your-link',
    'Learn More',
    'https://www.your-website.com',
    150,
    'professional but conversational'
WHERE NOT EXISTS (SELECT 1 FROM email_ai_settings);

-- Create index
CREATE INDEX IF NOT EXISTS idx_email_ai_settings_updated_at ON email_ai_settings(updated_at DESC);

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
    RAISE NOTICE '============================================================';
    RAISE NOTICE 'Migration: email_ai_settings table created successfully';
    RAISE NOTICE '============================================================';
    RAISE NOTICE '';
    RAISE NOTICE 'Table: email_ai_settings';
    RAISE NOTICE 'Purpose: Store global AI email generation settings';
    RAISE NOTICE '';
    RAISE NOTICE 'Go to Settings > AI Email Settings in your dashboard to configure.';
    RAISE NOTICE '============================================================';
END $$;

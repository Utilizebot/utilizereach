-- Migration 013: Campaign Safety System
-- Adds campaign management, account health tracking, and safety features

-- ============================================================================
-- 1. EMAIL ACCOUNTS TABLE
-- ============================================================================
-- Track email sending accounts and their health metrics

CREATE TABLE IF NOT EXISTS email_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    provider VARCHAR(50) DEFAULT 'gmail', -- gmail, google-workspace, outlook, etc.

    -- Sending limits
    daily_limit INTEGER DEFAULT 50, -- Conservative start, increase gradually
    hourly_limit INTEGER DEFAULT 20, -- Prevent bursts
    sent_today INTEGER DEFAULT 0,
    sent_this_hour INTEGER DEFAULT 0,
    last_sent_date DATE,
    last_sent_time TIMESTAMP,

    -- Health metrics
    total_sent INTEGER DEFAULT 0,
    total_opened INTEGER DEFAULT 0,
    total_clicked INTEGER DEFAULT 0,
    total_replied INTEGER DEFAULT 0,
    total_bounced INTEGER DEFAULT 0,
    total_unsubscribed INTEGER DEFAULT 0,

    -- Calculated rates (updated periodically)
    open_rate DECIMAL(5,2) DEFAULT 0, -- Percentage
    bounce_rate DECIMAL(5,2) DEFAULT 0, -- Percentage
    reply_rate DECIMAL(5,2) DEFAULT 0, -- Percentage
    health_score INTEGER DEFAULT 100, -- 0-100 score

    -- Account status
    is_active BOOLEAN DEFAULT true,
    is_warmed_up BOOLEAN DEFAULT false, -- Indicates if account went through warm-up
    warmup_day INTEGER DEFAULT 1, -- Day in warm-up sequence
    status VARCHAR(50) DEFAULT 'active', -- active, paused, blocked, warming-up
    status_reason TEXT, -- Why account was paused/blocked

    -- OAuth tokens (encrypted in production)
    refresh_token TEXT,
    access_token TEXT,
    token_expires_at TIMESTAMP,

    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_email_accounts_email ON email_accounts(email);
CREATE INDEX IF NOT EXISTS idx_email_accounts_active ON email_accounts(is_active);


-- ============================================================================
-- 2. CAMPAIGNS TABLE
-- ============================================================================
-- Organize emails into campaigns for tracking and management

CREATE TABLE IF NOT EXISTS campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,

    -- Campaign settings
    email_account_id UUID REFERENCES email_accounts(id),
    user_prompt TEXT, -- The pitch/message template
    cta_links JSONB, -- Call-to-action links

    -- Target audience
    target_count INTEGER DEFAULT 0, -- How many leads to email

    -- Progress tracking
    queued_count INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    opened_count INTEGER DEFAULT 0,
    clicked_count INTEGER DEFAULT 0,
    replied_count INTEGER DEFAULT 0,

    -- Campaign status
    status VARCHAR(50) DEFAULT 'draft', -- draft, queued, active, paused, completed, cancelled

    -- Timing
    delay_between_emails INTEGER DEFAULT 180, -- Seconds (default 3 min)
    created_at TIMESTAMP DEFAULT NOW(),
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    paused_at TIMESTAMP,

    -- Metadata
    created_by VARCHAR(255),
    notes TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_created_at ON campaigns(created_at DESC);


-- ============================================================================
-- 3. UPDATE SENT_EMAILS TABLE
-- ============================================================================
-- Add campaign tracking to existing sent_emails

ALTER TABLE sent_emails
ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES campaigns(id),
ADD COLUMN IF NOT EXISTS email_account_id UUID REFERENCES email_accounts(id),
ADD COLUMN IF NOT EXISTS lead_id UUID; -- Reference to scraped_leads

-- Add index for campaign queries
CREATE INDEX IF NOT EXISTS idx_sent_emails_campaign ON sent_emails(campaign_id);
CREATE INDEX IF NOT EXISTS idx_sent_emails_account ON sent_emails(email_account_id);
CREATE INDEX IF NOT EXISTS idx_sent_emails_lead ON sent_emails(lead_id);


-- ============================================================================
-- 4. CAMPAIGN QUEUE TABLE (Optional - for advanced scheduling)
-- ============================================================================
-- Track which emails are queued to be sent

CREATE TABLE IF NOT EXISTS email_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    lead_id UUID REFERENCES scraped_leads(id),
    email_account_id UUID REFERENCES email_accounts(id),

    -- Recipient info (denormalized for performance)
    recipient_email VARCHAR(255) NOT NULL,
    recipient_name VARCHAR(255),
    recipient_company VARCHAR(255),
    recipient_title VARCHAR(255),

    -- Scheduling
    scheduled_for TIMESTAMP NOT NULL, -- When to send
    priority INTEGER DEFAULT 0, -- Higher = send first

    -- Status tracking
    status VARCHAR(50) DEFAULT 'pending', -- pending, sending, sent, failed, cancelled
    sent_at TIMESTAMP,
    sent_email_id UUID REFERENCES sent_emails(id), -- Link to sent email after sending

    -- Error handling
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    last_retry_at TIMESTAMP,

    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for queue processing
CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_queue(status);
CREATE INDEX IF NOT EXISTS idx_email_queue_scheduled ON email_queue(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_email_queue_campaign ON email_queue(campaign_id);


-- ============================================================================
-- 5. HELPER FUNCTIONS
-- ============================================================================

-- Function to update email account stats
CREATE OR REPLACE FUNCTION update_email_account_stats()
RETURNS TRIGGER AS $$
BEGIN
    -- Update account stats when email is sent
    IF TG_OP = 'INSERT' THEN
        UPDATE email_accounts
        SET
            total_sent = total_sent + 1,
            sent_today = CASE
                WHEN last_sent_date = CURRENT_DATE THEN sent_today + 1
                ELSE 1
            END,
            last_sent_date = CURRENT_DATE,
            last_sent_time = NEW.sent_at,
            updated_at = NOW()
        WHERE id = NEW.email_account_id;
    END IF;

    -- Update opened count
    IF TG_OP = 'UPDATE' AND NEW.opened_at IS NOT NULL AND OLD.opened_at IS NULL THEN
        UPDATE email_accounts
        SET
            total_opened = total_opened + 1,
            open_rate = CASE
                WHEN total_sent > 0 THEN (total_opened + 1.0) / total_sent * 100
                ELSE 0
            END,
            updated_at = NOW()
        WHERE id = NEW.email_account_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update account stats automatically
DROP TRIGGER IF EXISTS trigger_update_account_stats ON sent_emails;
CREATE TRIGGER trigger_update_account_stats
AFTER INSERT OR UPDATE ON sent_emails
FOR EACH ROW
EXECUTE FUNCTION update_email_account_stats();


-- Function to update campaign stats
CREATE OR REPLACE FUNCTION update_campaign_stats()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE campaigns
        SET
            sent_count = sent_count + 1,
            updated_at = NOW()
        WHERE id = NEW.campaign_id;
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.opened_at IS NOT NULL AND OLD.opened_at IS NULL THEN
        UPDATE campaigns
        SET
            opened_count = opened_count + 1,
            updated_at = NOW()
        WHERE id = NEW.campaign_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update campaign stats automatically
DROP TRIGGER IF EXISTS trigger_update_campaign_stats ON sent_emails;
CREATE TRIGGER trigger_update_campaign_stats
AFTER INSERT OR UPDATE ON sent_emails
FOR EACH ROW
EXECUTE FUNCTION update_campaign_stats();


-- ============================================================================
-- 6. INITIAL DATA
-- ============================================================================

-- Insert default email account (will be populated from .gmail_tokens)
-- This is a placeholder - actual script will populate it

COMMENT ON TABLE email_accounts IS 'Email sending accounts with health tracking and rate limits';
COMMENT ON TABLE campaigns IS 'Email campaigns for organizing and tracking outreach';
COMMENT ON TABLE email_queue IS 'Queue for scheduled email sending with retry logic';

-- Migration complete
SELECT 'Migration 013: Campaign Safety System completed successfully' AS status;

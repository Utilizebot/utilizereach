-- Migration: Create scheduler settings tables
-- Date: 2025-11-27
-- Description: Tables for automated daily email campaign scheduler

-- ============================================
-- Table: scheduler_settings
-- Stores configuration for the automated scheduler
-- ============================================
CREATE TABLE IF NOT EXISTS scheduler_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Toggle
    is_enabled BOOLEAN DEFAULT FALSE,

    -- Schedule Configuration
    daily_limit INTEGER DEFAULT 30,
    send_hour INTEGER DEFAULT 10,              -- 0-23 (10 = 10 AM)
    send_minute INTEGER DEFAULT 0,             -- 0-59
    timezone VARCHAR(50) DEFAULT 'Asia/Kuala_Lumpur',
    delay_between_emails INTEGER DEFAULT 60,   -- seconds between each email

    -- Run History (last run info)
    last_run_at TIMESTAMP WITH TIME ZONE,
    last_run_status VARCHAR(20),               -- 'success', 'failed', 'partial'
    last_run_sent_count INTEGER DEFAULT 0,
    last_run_error TEXT,
    next_run_at TIMESTAMP WITH TIME ZONE,

    -- Statistics
    total_runs INTEGER DEFAULT 0,
    total_emails_sent INTEGER DEFAULT 0,

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- Table: scheduler_run_history
-- Stores history of all scheduler runs
-- ============================================
CREATE TABLE IF NOT EXISTS scheduler_run_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Run Details
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20),                        -- 'running', 'success', 'failed', 'partial'

    -- Results
    leads_attempted INTEGER DEFAULT 0,
    emails_sent INTEGER DEFAULT 0,
    emails_failed INTEGER DEFAULT 0,

    -- Error Tracking
    error_message TEXT,
    error_details JSONB,

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for recent history queries
CREATE INDEX IF NOT EXISTS idx_scheduler_run_history_created_at
ON scheduler_run_history(created_at DESC);

-- ============================================
-- Insert default settings (only if table is empty)
-- ============================================
INSERT INTO scheduler_settings (
    is_enabled,
    daily_limit,
    send_hour,
    send_minute,
    timezone,
    delay_between_emails
)
SELECT
    FALSE,      -- disabled by default
    30,         -- 30 emails per day
    10,         -- 10 AM
    0,          -- :00
    'Asia/Kuala_Lumpur',
    60          -- 60 seconds delay
WHERE NOT EXISTS (SELECT 1 FROM scheduler_settings);

-- ============================================
-- Enable RLS (Row Level Security)
-- ============================================
ALTER TABLE scheduler_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduler_run_history ENABLE ROW LEVEL SECURITY;

-- Policy: Allow service role full access
CREATE POLICY "Service role has full access to scheduler_settings"
ON scheduler_settings FOR ALL
USING (true)
WITH CHECK (true);

CREATE POLICY "Service role has full access to scheduler_run_history"
ON scheduler_run_history FOR ALL
USING (true)
WITH CHECK (true);

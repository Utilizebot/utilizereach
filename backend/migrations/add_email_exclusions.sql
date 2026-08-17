-- Email Exclusion List
-- Add this table to exclude certain emails from campaigns

CREATE TABLE IF NOT EXISTS email_exclusions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    reason TEXT,
    excluded_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_email_exclusions_email ON email_exclusions(email);

-- Add some common test emails to exclusion list
INSERT INTO email_exclusions (email, reason, excluded_by) VALUES
('demo.com', 'Internal test account', 'system'),
('demo.com', 'Team member', 'system')
ON CONFLICT (email) DO NOTHING;

-- Add RLS policies (if using Row Level Security)
ALTER TABLE email_exclusions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on email_exclusions" ON email_exclusions
    FOR ALL USING (true);

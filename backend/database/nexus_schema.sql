-- Nexus Marketing Engine — Stakeholder Schema
-- Idempotent: safe to run multiple times

-- Enums
DO $$ BEGIN
  CREATE TYPE stakeholder_type AS ENUM ('SHAREHOLDER','BUSINESS_PARTNER','GOVT_AGENCY','UNASSIGNED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE audit_action_type AS ENUM ('INSERT','UPDATE','DELETE','ACCESS','EXPORT','AUTONOMOUS_DISPATCH','HUMAN_OVERRIDE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE execution_agent_type AS ENUM ('SYSTEM_ADMIN','MIGRATION_AGENT','ACCOUNTING_AGENT','BD_AGENT','ADMIN_AGENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE approval_status_type AS ENUM ('PENDING','APPROVED','REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Raw import buffer
CREATE TABLE IF NOT EXISTS staging_legacy_contacts (
  raw_id          SERIAL PRIMARY KEY,
  raw_data        JSONB NOT NULL,
  migration_status VARCHAR(50) DEFAULT 'PENDING',
  assigned_segment stakeholder_type,
  processed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Master stakeholder table
CREATE TABLE IF NOT EXISTS stakeholders (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_type         stakeholder_type NOT NULL DEFAULT 'UNASSIGNED',
  organization_name    VARCHAR(255),
  primary_contact_name VARCHAR(255),
  email_address        VARCHAR(255) UNIQUE NOT NULL,
  phone_number         VARCHAR(50),
  legacy_id_ref        VARCHAR(100),
  is_active            BOOLEAN DEFAULT TRUE,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stakeholders_segment ON stakeholders(segment_type);
CREATE INDEX IF NOT EXISTS idx_stakeholders_email   ON stakeholders(email_address);
CREATE INDEX IF NOT EXISTS idx_stakeholders_active  ON stakeholders(is_active);

-- Shareholder partition
CREATE TABLE IF NOT EXISTS shareholder_profiles (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stakeholder_id           UUID UNIQUE REFERENCES stakeholders(id) ON DELETE CASCADE,
  shareholder_reference_no VARCHAR(100),
  share_class              VARCHAR(50),
  holding_qty              NUMERIC(20,4),
  dividend_account_masked  VARCHAR(50),
  tax_residency_id         VARCHAR(100)
);

-- Business partner partition
CREATE TABLE IF NOT EXISTS partner_profiles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stakeholder_id    UUID UNIQUE REFERENCES stakeholders(id) ON DELETE CASCADE,
  partner_code      VARCHAR(100),
  contract_status   VARCHAR(50),
  account_owner_agent execution_agent_type,
  nda_executed      BOOLEAN DEFAULT FALSE,
  commercial_tier   VARCHAR(50)
);

-- Government agency partition
CREATE TABLE IF NOT EXISTS govt_agency_profiles (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stakeholder_id         UUID UNIQUE REFERENCES stakeholders(id) ON DELETE CASCADE,
  agency_code            VARCHAR(100),
  jurisdiction_level     VARCHAR(100),
  regulatory_framework   VARCHAR(255),
  official_designation   VARCHAR(255),
  clearance_level_required INTEGER DEFAULT 1
);

-- Approval queue for agent escalations
CREATE TABLE IF NOT EXISTS agent_execution_approvals (
  approval_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_type    execution_agent_type NOT NULL,
  payload       JSONB NOT NULL,
  risk_score    NUMERIC(5,2),
  status        approval_status_type DEFAULT 'PENDING',
  escalated_at  TIMESTAMPTZ DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ,
  resolved_by   VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_approvals_status ON agent_execution_approvals(status);
CREATE INDEX IF NOT EXISTS idx_approvals_agent  ON agent_execution_approvals(agent_type);

-- Immutable audit trail
CREATE TABLE IF NOT EXISTS stakeholder_audit_logs (
  log_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stakeholder_id    UUID REFERENCES stakeholders(id),
  action            audit_action_type NOT NULL,
  performed_by_agent execution_agent_type,
  agent_session_id  VARCHAR(255),
  ip_address        VARCHAR(45),
  changed_fields    JSONB,
  timestamp         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_stakeholder ON stakeholder_audit_logs(stakeholder_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp   ON stakeholder_audit_logs(timestamp DESC);

-- Audit trigger function
CREATE OR REPLACE FUNCTION log_stakeholder_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _changed JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _changed := to_jsonb(OLD);
    INSERT INTO stakeholder_audit_logs(stakeholder_id, action, performed_by_agent, changed_fields)
    VALUES (OLD.id, 'DELETE', 'SYSTEM_ADMIN', _changed);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    _changed := jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW));
    INSERT INTO stakeholder_audit_logs(stakeholder_id, action, performed_by_agent, changed_fields)
    VALUES (NEW.id, 'UPDATE', 'SYSTEM_ADMIN', _changed);
    RETURN NEW;
  ELSE
    INSERT INTO stakeholder_audit_logs(stakeholder_id, action, performed_by_agent, changed_fields)
    VALUES (NEW.id, 'INSERT', 'SYSTEM_ADMIN', to_jsonb(NEW));
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_stakeholder_audit ON stakeholders;
CREATE TRIGGER trg_stakeholder_audit
  AFTER INSERT OR UPDATE OR DELETE ON stakeholders
  FOR EACH ROW EXECUTE FUNCTION log_stakeholder_mutation();

-- RLS Policies (documented; enable when roles are provisioned)
-- ACCOUNTING_AGENT role: SELECT/INSERT on stakeholders WHERE segment_type = 'SHAREHOLDER'
-- BD_AGENT role:         SELECT/INSERT on stakeholders WHERE segment_type = 'BUSINESS_PARTNER'
-- ADMIN_AGENT role:      SELECT/INSERT on stakeholders WHERE segment_type = 'GOVT_AGENCY'
-- MIGRATION_AGENT role:  INSERT on staging_legacy_contacts, INSERT on stakeholders (all segments)

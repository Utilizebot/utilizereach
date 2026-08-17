/**
 * TypeScript Type Definitions for Lead Scraper System
 *
 * This file contains interfaces for all scraper-related database tables
 * and utility types for the lead scraper integration.
 *
 * Created: 2025-10-16
 * Phase: 1.2 - Type Definitions
 */

// ============================================================================
// Enums and Constants
// ============================================================================

export type UserRole = 'admin' | 'sales_rep';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'unqualified' | 'archived';

export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

export type ApiKeyProvider = 'serpapi';

// ============================================================================
// Table Interfaces
// ============================================================================

/**
 * Sales Rep (User Account)
 *
 * Represents a sales team member with UTM tracking defaults
 */
export interface SalesRep {
  // Primary key
  id: string; // UUID

  // Authentication
  auth_user_id?: string; // UUID - legacy auth identifier (plain column, no FK)
  email: string;
  full_name: string;

  // Role
  role: UserRole;

  // UTM defaults for campaign tracking
  utm_source: string;
  utm_medium: string;
  utm_default_campaign: string | null;

  // Metadata
  created_at: string; // ISO timestamp
  last_login: string | null; // ISO timestamp
  is_active: boolean;
}

/**
 * API Key
 *
 * Stores SerpAPI keys with encryption and usage tracking
 */
export interface ApiKey {
  // Primary key
  id: string; // UUID

  // Key information
  key_name: string;
  api_key_encrypted: string; // Stored server-side (encryption TODO)
  provider: ApiKeyProvider;

  // Ownership
  assigned_to: string | null; // UUID - references sales_reps.id

  // Usage tracking
  usage_count: number;
  usage_limit: number;

  // Status
  is_active: boolean;

  // Metadata
  created_at: string; // ISO timestamp
  last_used: string | null; // ISO timestamp
}

/**
 * Scraping Job Configuration
 *
 * JSON configuration object stored in scraping_jobs.config
 */
export interface ScrapingJobConfig {
  // Scraper settings
  min_url_score?: number; // Default: 6
  max_urls_per_query?: number; // Default: 100
  target_executive_pages?: boolean; // Default: true
  include_generic_emails?: boolean; // Default: false

  // Batch settings (for batch mode)
  batch_mode?: boolean;
  batch_queries?: string[]; // Array of queries for batch processing
  run_mode?: 'sequential' | 'parallel';

  // Advanced settings
  request_timeout?: number; // Seconds
  user_agent?: string;
}

/**
 * Scraping Job
 *
 * Tracks a scraping job's status, configuration, and results
 */
export interface ScrapingJob {
  // Primary key
  id: string; // UUID

  // Job information
  job_name: string;
  search_query: string; // Single query or JSON array for batch
  industry: string | null;
  location: string;
  num_queries: number; // 1-10

  // Status tracking
  status: JobStatus;
  progress: number; // 0-100

  // Relationships
  started_by: string | null; // UUID - references sales_reps.id
  api_key_used: string | null; // UUID - references api_keys.id

  // Results summary
  leads_found: number;

  // Timestamps
  started_at: string; // ISO timestamp
  completed_at: string | null; // ISO timestamp

  // Error handling
  error_message: string | null;

  // Configuration
  config: ScrapingJobConfig;
}

/**
 * Scraped Lead
 *
 * Represents a single lead extracted from a scraping job
 */
export interface ScrapedLead {
  // Primary key
  id: string; // UUID

  // Relationship
  job_id: string; // UUID - references scraping_jobs.id

  // Contact information
  email: string | null;
  phone: string | null;
  decision_maker_name: string | null;
  decision_maker_title: string | null;
  is_executive: boolean;
  company_name: string | null;

  // Source information
  source_url: string | null;
  page_title: string | null;
  search_query: string | null;
  url_score: number | null; // 0-10

  // Categorization
  industry: string | null;
  location: string | null;

  // Lead management
  status: LeadStatus;
  assigned_to: string | null; // UUID - references sales_reps.id
  notes: string | null;

  // Timestamps
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
}

/**
 * Scraping Log
 *
 * Debug and progress log entry for a scraping job
 */
export interface ScrapingLog {
  // Primary key
  id: string; // UUID

  // Relationship
  job_id: string; // UUID - references scraping_jobs.id

  // Log data
  log_level: LogLevel;
  message: string;
  details: Record<string, any>; // JSONB

  // Timestamp
  created_at: string; // ISO timestamp
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * API Key with usage percentage
 */
export interface ApiKeyWithUsage extends ApiKey {
  usage_percentage: number; // Calculated: (usage_count / usage_limit) * 100
  is_near_limit: boolean; // True if usage_percentage >= 80
}

/**
 * Job with related data for display
 */
export interface ScrapingJobWithDetails extends ScrapingJob {
  // Related data
  started_by_rep?: SalesRep;
  api_key?: ApiKey;
  leads?: ScrapedLead[];
  logs?: ScrapingLog[];

  // Computed fields
  duration?: number; // Milliseconds
  duration_formatted?: string; // "5m 23s"
}

/**
 * Lead with job information
 */
export interface ScrapedLeadWithJob extends ScrapedLead {
  job?: ScrapingJob;
  assigned_to_rep?: SalesRep;
}

/**
 * Job statistics
 */
export interface JobStatistics {
  total_jobs: number;
  pending_jobs: number;
  running_jobs: number;
  completed_jobs: number;
  failed_jobs: number;
  total_leads_found: number;
  total_executives_found: number;
}

/**
 * Lead statistics
 */
export interface LeadStatistics {
  total_leads: number;
  new_leads: number;
  contacted_leads: number;
  qualified_leads: number;
  executive_leads: number;
  leads_with_email: number;
  leads_with_phone: number;
}

/**
 * API Key statistics
 */
export interface ApiKeyStatistics {
  total_keys: number;
  active_keys: number;
  total_usage: number;
  total_limit: number;
  average_usage_percentage: number;
}

// ============================================================================
// Filter and Search Types
// ============================================================================

/**
 * Filters for scraping jobs list
 */
export interface ScrapingJobFilters {
  status?: JobStatus[];
  industry?: string[];
  started_by?: string; // UUID
  date_range?: {
    start: string; // ISO timestamp
    end: string; // ISO timestamp
  };
  search?: string; // Search in job_name or search_query
}

/**
 * Filters for scraped leads list
 */
export interface ScrapedLeadFilters {
  status?: LeadStatus[];
  is_executive?: boolean;
  industry?: string[];
  has_email?: boolean;
  has_phone?: boolean;
  job_id?: string; // UUID
  assigned_to?: string; // UUID
  date_range?: {
    start: string; // ISO timestamp
    end: string; // ISO timestamp
  };
  search?: string; // Search in name, email, company
}

/**
 * Sort options
 */
export interface SortOptions {
  field: string;
  direction: 'asc' | 'desc';
}

/**
 * Pagination options
 */
export interface PaginationOptions {
  page: number; // 1-indexed
  per_page: number; // 25, 50, or 100
}

// ============================================================================
// API Request/Response Types
// ============================================================================

/**
 * Request to create a new scraping job
 */
export interface CreateScrapingJobRequest {
  job_name: string;
  search_query: string | string[]; // Single or array for batch
  industry?: string;
  location?: string;
  num_queries?: number; // Default: 5
  api_key_id?: string; // UUID - if not provided, auto-select
  config?: Partial<ScrapingJobConfig>;
}

/**
 * Response after creating a scraping job
 */
export interface CreateScrapingJobResponse {
  job_id: string; // UUID
  status: JobStatus;
  message: string;
}

/**
 * Request to update a lead's status
 */
export interface UpdateLeadRequest {
  status?: LeadStatus;
  assigned_to?: string | null; // UUID
  notes?: string;
}

/**
 * Export format options
 */
export type ExportFormat = 'excel' | 'csv' | 'brevo' | 'json';

/**
 * Request to export leads
 */
export interface ExportLeadsRequest {
  format: ExportFormat;
  lead_ids?: string[]; // If not provided, export all filtered leads
  filters?: ScrapedLeadFilters;
  include_job_info?: boolean; // Default: true
}

/**
 * Bulk action on leads
 */
export interface BulkLeadAction {
  lead_ids: string[];
  action: 'mark_contacted' | 'assign' | 'archive' | 'delete';
  data?: {
    assigned_to?: string; // For assign action
  };
}

// ============================================================================
// WebSocket Message Types
// ============================================================================

/**
 * WebSocket message for job progress updates
 */
export interface JobProgressMessage {
  type: 'job_progress';
  job_id: string;
  status: JobStatus;
  progress: number; // 0-100
  current_step?: string; // "Fetching URLs", "Scraping websites", etc.
  leads_found?: number;
  message?: string;
}

/**
 * WebSocket message for job completion
 */
export interface JobCompletedMessage {
  type: 'job_completed';
  job_id: string;
  status: 'completed' | 'failed';
  leads_found: number;
  error_message?: string;
}

/**
 * WebSocket message for new log entry
 */
export interface JobLogMessage {
  type: 'job_log';
  job_id: string;
  log: ScrapingLog;
}

/**
 * Union type for all WebSocket messages
 */
export type WebSocketMessage =
  | JobProgressMessage
  | JobCompletedMessage
  | JobLogMessage;

// ============================================================================
// Form Validation Schemas
// ============================================================================

/**
 * Schema for validating new job form
 */
export interface NewJobFormData {
  job_name: string;
  search_mode: 'custom' | 'batch';
  search_query: string; // For custom mode
  batch_queries?: string[]; // For batch mode
  industry?: string;
  location: string;
  num_queries: number;
  api_key_id?: string;
  min_url_score: number;
  max_urls_per_query: number;
  target_executive_pages: boolean;
  include_generic_emails: boolean;
}

/**
 * Schema for API key form
 */
export interface ApiKeyFormData {
  key_name: string;
  api_key: string; // Plain text, will be encrypted
  provider: ApiKeyProvider;
  usage_limit: number;
}

/**
 * Schema for user profile form
 */
export interface ProfileFormData {
  full_name: string;
  email: string;
  utm_source: string;
  utm_medium: string;
  utm_default_campaign: string;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * API error response
 */
export interface ApiError {
  error: string;
  message: string;
  details?: Record<string, any>;
}

/**
 * Validation error
 */
export interface ValidationError {
  field: string;
  message: string;
}

// ============================================================================
// Export all types
// ============================================================================

export type {
  // Add any additional exports here if needed
};

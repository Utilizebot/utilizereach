/**
 * Backend API Client
 *
 * Handles all communication with FastAPI backend
 * Uses relative URLs - nginx proxies /api/* to backend automatically
 */

// API Configuration - use relative URLs (nginx reverse proxy handles routing)
// This works on ANY domain without configuration!
const API_BASE_URL = '';

/**
 * Get authentication token from localStorage (set by lib/auth login())
 */
async function getAuthToken(): Promise<string> {
  const token = localStorage.getItem('auth_token');

  if (!token) {
    throw new Error('Not authenticated');
  }

  return token;
}

/**
 * Make authenticated API request
 */
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getAuthToken();

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      detail: response.statusText,
    }));
    throw new Error(error.detail || `Request failed: ${response.status}`);
  }

  return response.json();
}

// ============================================================
// Types
// ============================================================

export interface StartScrapingJobRequest {
  search_query: string;
  location: string;
  num_queries: number;
  industry?: string;
}

export interface StartJobResponse {
  job_id: string;
  status: string;
  message: string;
}

export interface ScrapingJob {
  id: string;
  job_name: string;
  search_query: string;
  location: string;
  num_queries: number;
  industry?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  current_step?: string;
  leads_found: number;  // Total raw leads
  brevo_ready_count: number;  // Brevo-ready leads (filtered)
  csv_file_path?: string;  // Raw CSV path
  brevo_csv_file_path?: string;  // Brevo CSV path
  error_message?: string;
  started_at?: string;
  completed_at?: string;
  created_at?: string;
  celery_task_id?: string;
}

export interface JobListResponse {
  jobs: ScrapingJob[];
  total: number;
  limit: number;
  offset: number;
}

export interface LeadResult {
  id: string;
  company_name?: string;
  decision_maker_name?: string;
  decision_maker_title?: string;
  email?: string;
  phone?: string;
  source_url?: string;
  url_score?: number;
  is_executive: boolean;
  created_at: string;
}

export interface ProgressUpdate {
  progress: number;
  current_step: string;
  leads_found: number;  // Database column name
}

// ============================================================
// API Methods
// ============================================================

/**
 * Start a new scraping job
 */
export async function startScrapingJob(
  request: StartScrapingJobRequest
): Promise<StartJobResponse> {
  return apiRequest<StartJobResponse>('/api/scraper/start-job', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

/**
 * Get list of scraping jobs
 */
export async function getJobs(params?: {
  limit?: number;
  offset?: number;
  status?: string;
}): Promise<JobListResponse> {
  const queryParams = new URLSearchParams();

  if (params?.limit) queryParams.set('limit', params.limit.toString());
  if (params?.offset) queryParams.set('offset', params.offset.toString());
  if (params?.status) queryParams.set('status', params.status);

  const query = queryParams.toString();
  const endpoint = `/api/scraper/jobs${query ? `?${query}` : ''}`;

  return apiRequest<JobListResponse>(endpoint);
}

/**
 * Get details of a specific job
 */
export async function getJobDetails(jobId: string): Promise<ScrapingJob> {
  return apiRequest<ScrapingJob>(`/api/scraper/jobs/${jobId}`);
}

/**
 * Get results for a specific job
 */
export async function getJobResults(jobId: string): Promise<LeadResult[]> {
  return apiRequest<LeadResult[]>(`/api/scraper/jobs/${jobId}/results`);
}

/**
 * Download Raw CSV for a completed job
 */
export async function downloadJobCSV(jobId: string): Promise<void> {
  const token = await getAuthToken();

  const response = await fetch(
    `${API_BASE_URL}/api/scraper/jobs/${jobId}/download`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      detail: response.statusText,
    }));
    throw new Error(error.detail || 'Failed to download CSV');
  }

  // Trigger download in browser
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `leads_${jobId}.csv`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

/**
 * Download Brevo-ready CSV for a completed job
 */
export async function downloadBrevoCSV(jobId: string): Promise<void> {
  const token = await getAuthToken();

  const response = await fetch(
    `${API_BASE_URL}/api/scraper/jobs/${jobId}/download-brevo`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      detail: response.statusText,
    }));
    throw new Error(error.detail || 'Failed to download Brevo CSV');
  }

  // Trigger download in browser
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `brevo_leads_${jobId}.csv`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

/**
 * Connect to WebSocket for real-time progress updates
 */
export function connectToJobProgress(
  jobId: string,
  onProgress: (update: ProgressUpdate) => void,
  onError?: (error: Event) => void
): WebSocket {
  // Build WebSocket URL from current page origin
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  const ws = new WebSocket(`${wsUrl}/ws/progress/${jobId}`);

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      // Handle different message types
      if (data.type === 'connected') {
        console.log('Connected to job progress:', data.message);
      } else if (data.progress !== undefined) {
        onProgress({
          progress: data.progress,
          current_step: data.current_step || '',
          leads_found: data.leads_found || 0,
        });
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    if (onError) onError(error);
  };

  ws.onclose = () => {
    console.log('WebSocket connection closed');
  };

  // Send ping every 30 seconds to keep connection alive
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send('ping');
    } else {
      clearInterval(pingInterval);
    }
  }, 30000);

  return ws;
}

/**
 * Health check
 */
export async function healthCheck(): Promise<{ status: string }> {
  const response = await fetch(`${API_BASE_URL}/api/health`);
  return response.json();
}

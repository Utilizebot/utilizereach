import type { UTMParams } from '../types/form';

/**
 * Fire-and-forget POST to the public tracking API.
 * Tracking must never break the form UX — all errors are logged and swallowed.
 */
async function trackingPost(endpoint: string, body: Record<string, any>): Promise<any | null> {
  try {
    const response = await fetch(`/api/tracking${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      console.error(`Tracking request failed: ${endpoint} (${response.status})`);
      return null;
    }
    return await response.json().catch(() => null);
  } catch (err) {
    console.error(`Tracking request error: ${endpoint}`, err);
    return null;
  }
}

/**
 * Collect the standard device/browser payload sent with new sessions
 */
function buildSessionPayload(sessionId: string, utmParams: UTMParams, status: string) {
  return {
    session_id: sessionId,
    ...utmParams,
    user_agent: navigator.userAgent,
    referrer: document.referrer || null,
    landing_page: window.location.href,
    device_type: getDeviceType(),
    browser: getBrowser(),
    os: getOS(),
    screen_resolution: getScreenResolution(),
    viewport_size: getViewportSize(),
    timezone: getTimezone(),
    language: getLanguage(),
    status,
    metadata: {
      connection_type: (navigator as any).connection?.effectiveType || 'unknown',
      memory: (navigator as any).deviceMemory || 'unknown',
      cores: navigator.hardwareConcurrency || 'unknown',
    },
  };
}

/**
 * Generate UUID that works in both HTTP and HTTPS contexts
 * crypto.randomUUID() only works in secure contexts (HTTPS)
 */
function generateUUID(): string {
  // Try native crypto.randomUUID first (HTTPS only)
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Fallback for HTTP contexts
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Extract UTM parameters from URL search params
 */
export function extractUTMParams(searchParams: URLSearchParams): UTMParams {
  return {
    utm_source: searchParams.get('utm_source') || undefined,
    utm_medium: searchParams.get('utm_medium') || undefined,
    utm_campaign: searchParams.get('utm_campaign') || undefined,
    utm_content: searchParams.get('utm_content') || undefined,
    sales_rep_name: searchParams.get('sales_rep') || undefined,
    sales_rep_id: searchParams.get('sales_rep_id') || undefined,
  };
}

/**
 * Detect device type from user agent
 */
export function getDeviceType(): string {
  const ua = navigator.userAgent;
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
    return 'tablet';
  }
  if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(ua)) {
    return 'mobile';
  }
  return 'desktop';
}

/**
 * Extract browser name and version from user agent
 */
export function getBrowser(): string {
  const ua = navigator.userAgent;
  let browser = 'Unknown';

  if (ua.includes('Firefox')) {
    const version = ua.match(/Firefox\/(\d+)/)?.[1];
    browser = version ? `Firefox ${version}` : 'Firefox';
  } else if (ua.includes('Edg')) {
    const version = ua.match(/Edg\/(\d+)/)?.[1];
    browser = version ? `Edge ${version}` : 'Edge';
  } else if (ua.includes('Chrome')) {
    const version = ua.match(/Chrome\/(\d+)/)?.[1];
    browser = version ? `Chrome ${version}` : 'Chrome';
  } else if (ua.includes('Safari')) {
    const version = ua.match(/Version\/(\d+)/)?.[1];
    browser = version ? `Safari ${version}` : 'Safari';
  } else if (ua.includes('Opera') || ua.includes('OPR')) {
    browser = 'Opera';
  }

  return browser;
}

/**
 * Get operating system from user agent
 */
export function getOS(): string {
  const ua = navigator.userAgent;

  if (ua.includes('Windows NT 10.0')) return 'Windows 10';
  if (ua.includes('Windows NT 6.3')) return 'Windows 8.1';
  if (ua.includes('Windows NT 6.2')) return 'Windows 8';
  if (ua.includes('Windows NT 6.1')) return 'Windows 7';
  if (ua.includes('Windows NT')) return 'Windows';

  if (ua.includes('Mac OS X')) {
    const version = ua.match(/Mac OS X (\d+[._]\d+)/)?.[1];
    return version ? `Mac OS X ${version.replace('_', '.')}` : 'Mac OS X';
  }

  if (ua.includes('Android')) {
    const version = ua.match(/Android (\d+)/)?.[1];
    return version ? `Android ${version}` : 'Android';
  }

  if (ua.includes('iPhone') || ua.includes('iPad')) {
    const version = ua.match(/OS (\d+_\d+)/)?.[1];
    return version ? `iOS ${version.replace('_', '.')}` : 'iOS';
  }

  if (ua.includes('Linux')) return 'Linux';

  return 'Unknown';
}

/**
 * Get screen resolution
 */
export function getScreenResolution(): string {
  return `${window.screen.width}x${window.screen.height}`;
}

/**
 * Get viewport size
 */
export function getViewportSize(): string {
  return `${window.innerWidth}x${window.innerHeight}`;
}

/**
 * Get timezone
 */
export function getTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Get language
 */
export function getLanguage(): string {
  return navigator.language || 'en-US';
}

/**
 * Create a new form session
 */
export async function createFormSession(utmParams: UTMParams) {
  const sessionId = generateUUID();

  // Store session ID in sessionStorage for tracking (even if the API call fails)
  sessionStorage.setItem('form_session_id', sessionId);
  sessionStorage.setItem('form_session_start', Date.now().toString());

  const data = await trackingPost('/sessions', buildSessionPayload(sessionId, utmParams, 'started'));

  return { sessionId, data };
}

/**
 * Get the current session ID from storage
 */
export function getCurrentSessionId(): string | null {
  return sessionStorage.getItem('form_session_id');
}

/**
 * Get time since session start in milliseconds
 */
export function getTimeSinceStart(): number {
  const startTime = sessionStorage.getItem('form_session_start');
  if (!startTime) return 0;
  return Date.now() - parseInt(startTime, 10);
}

/**
 * Track a custom event
 */
export async function trackEvent(
  sessionId: string,
  eventType: string,
  eventData?: Record<string, any>,
  stepNumber?: number
) {
  await trackingPost('/events', {
    session_id: sessionId,
    event_type: eventType,
    event_data: eventData || null,
    step_number: stepNumber,
    time_since_start: getTimeSinceStart(),
  });
}

/**
 * Track form step entry
 */
export async function trackStepEntry(
  sessionId: string,
  stepNumber: number,
  stepName: string,
  answers?: Record<string, any>
) {
  await trackingPost('/steps', {
    session_id: sessionId,
    step_number: stepNumber,
    step_name: stepName,
    answers: answers || null,
  });
}

/**
 * Track form step exit and calculate time spent
 */
export async function trackStepExit(
  sessionId: string,
  stepNumber: number,
  answers?: Record<string, any>
) {
  // Backend finds the latest un-exited form_steps row for this session+step
  // and sets exited_at / time_spent / answers.
  await trackingPost('/steps/exit', {
    session_id: sessionId,
    step_number: stepNumber,
    answers: answers || null,
  });
}

/**
 * Update session status
 */
export async function updateSessionStatus(
  sessionId: string,
  status: 'started' | 'in_progress' | 'completed' | 'abandoned'
) {
  try {
    const updates: any = { status };

    if (status === 'completed') {
      updates.completed_at = new Date().toISOString();
    }

    // keepalive:true so the request survives page unload (abandonment tracking)
    const response = await fetch(`/api/tracking/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
      keepalive: true,
    });

    if (!response.ok) {
      console.error('Error updating session status:', response.status);
    }
  } catch (err) {
    console.error('Error updating session status:', err);
  }
}

/**
 * Submit form response
 */
export async function submitFormResponse(
  sessionId: string,
  formData: Record<string, any>
) {
  try {
    const response = await fetch('/api/tracking/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        ...formData,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || `Failed to submit form response: ${response.status}`);
    }

    // Session status will be auto-updated by the DB trigger
    return await response.json();
  } catch (err) {
    console.error('Error submitting form response:', err);
    throw err;
  }
}

/**
 * Track page visibility changes (tab switching)
 */
export function trackVisibilityChanges(sessionId: string) {
  let hiddenTime: number | null = null;

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenTime = Date.now();
      trackEvent(sessionId, 'tab_hidden');
    } else {
      if (hiddenTime) {
        const timeAway = Date.now() - hiddenTime;
        trackEvent(sessionId, 'tab_visible', { time_away_ms: timeAway });
        hiddenTime = null;
      }
    }
  });
}

/**
 * Track form abandonment on page unload
 */
export function trackAbandonment(sessionId: string, _currentStep: number) {
  window.addEventListener('beforeunload', () => {
    // Update session status on page unload
    updateSessionStatus(sessionId, 'abandoned');
  });
}

/**
 * Track page visit (when someone lands on the form)
 * This tracks RAW traffic before they even start the form
 * Creates a session in form_sessions with status "page_visit"
 */
export async function trackPageVisit(utmParams: UTMParams) {
  try {
    // Check if this visit was already tracked (avoid duplicates)
    const visitTracked = sessionStorage.getItem('page_visit_tracked');
    if (visitTracked === 'true') {
      return; // Already tracked this page visit
    }

    const visitId = generateUUID();

    // Track the page visit in form_sessions (not tracking_events to avoid FK constraint)
    // status 'page_visit' marks a landing that hasn't started the form yet
    const data = await trackingPost('/sessions', buildSessionPayload(visitId, utmParams, 'page_visit'));

    if (data) {
      // Mark this visit as tracked
      sessionStorage.setItem('page_visit_tracked', 'true');
      sessionStorage.setItem('page_visit_id', visitId);
    }
  } catch (err) {
    console.error('Error tracking page visit:', err);
  }
}

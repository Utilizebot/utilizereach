/**
 * Shared brand form helpers for BrandSettings (active brand) and
 * BrandsSettings (platform-admin brand catalog).
 *
 * Saving rules (keep the default brand byte-identical unless an admin
 * deliberately edits a field):
 *   * only fields the user actually changed are written;
 *   * `branding` / `sender` are sent as the FULL existing object with the
 *     changes applied, so the result is the same whether the backend merges
 *     or replaces those JSON columns;
 *   * a cleared sender value is sent as null (= "not set", the backend then
 *     falls back to its defaults); a cleared branding value is removed.
 */

export const API_BASE = import.meta.env.VITE_API_URL || '';

/** The default brand (slug "default"). Mirrors backend tenancy.DEFAULT_BRAND_ID. */
export const DEFAULT_BRAND_ID = '00000000-0000-0000-0000-0000000000a1';

// Brand JSON columns are free-form objects.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JsonObject = Record<string, any>;

export interface BrandRow {
  id: string;
  slug: string;
  display_name: string;
  website_domain?: string | null;
  hostnames?: string[] | null;
  is_active?: boolean;
  branding?: JsonObject | null;
  sender?: JsonObject | null;
  created_at?: string;
  updated_at?: string;
  member_count?: number;
  lead_count?: number;
  campaign_count?: number;
  sent_count?: number;
}

export interface BrandFormState {
  slug: string;
  display_name: string;
  website_domain: string;
  hostnames: string; // comma separated
  company_name: string;
  company_tagline: string;
  company_logo: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  form_title: string;
  form_subtitle: string;
  sending_enabled: boolean;
  cta_url: string;
  alert_from: string;
  alert_to: string;
  daily_cap: string;
  start_hour: string;
  end_hour: string;
}

type TextKey = Exclude<keyof BrandFormState, 'sending_enabled'>;

/** form field -> path inside brands.branding */
const BRANDING_PATHS: Partial<Record<TextKey, [string, string]>> = {
  company_name: ['company', 'name'],
  company_tagline: ['company', 'tagline'],
  company_logo: ['company', 'logo'],
  primary_color: ['branding', 'primaryColor'],
  secondary_color: ['branding', 'secondaryColor'],
  accent_color: ['branding', 'accentColor'],
  form_title: ['form', 'title'],
  form_subtitle: ['form', 'subtitle'],
};

/** form field -> key inside brands.sender (numeric ones flagged) */
const SENDER_KEYS: Partial<Record<TextKey, { key: string; numeric?: boolean }>> = {
  cta_url: { key: 'cta_url' },
  alert_from: { key: 'alert_from' },
  alert_to: { key: 'alert_to' },
  daily_cap: { key: 'daily_cap', numeric: true },
  start_hour: { key: 'start_hour', numeric: true },
  end_hour: { key: 'end_hour', numeric: true },
};

export const isDefaultBrand = (id?: string | null) => id === DEFAULT_BRAND_ID;

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

const truthy = (v: unknown) => v === true || v === 'true' || v === 1 || v === '1';

/** Effective "launcher sends for this brand" flag (mirrors docs/MULTIBRAND.md). */
export function effectiveSendingEnabled(brand: Pick<BrandRow, 'id' | 'sender'> | null | undefined): boolean {
  const s = brand?.sender || {};
  if (s.sending_enabled === undefined || s.sending_enabled === null || s.sending_enabled === '') {
    return isDefaultBrand(brand?.id); // the default brand sends by default, new brands do not
  }
  return truthy(s.sending_enabled);
}

export function emptyBrandForm(): BrandFormState {
  return {
    slug: '', display_name: '', website_domain: '', hostnames: '',
    company_name: '', company_tagline: '', company_logo: '',
    primary_color: '', secondary_color: '', accent_color: '',
    form_title: '', form_subtitle: '',
    sending_enabled: false, // new brands start with sending OFF
    cta_url: '', alert_from: '', alert_to: '', daily_cap: '', start_hour: '', end_hour: '',
  };
}

export function formFromBrand(b: BrandRow): BrandFormState {
  const f = emptyBrandForm();
  f.slug = b.slug || '';
  f.display_name = b.display_name || '';
  f.website_domain = b.website_domain || '';
  f.hostnames = (b.hostnames || []).join(', ');
  const branding = b.branding || {};
  (Object.keys(BRANDING_PATHS) as TextKey[]).forEach((k) => {
    const [sec, key] = BRANDING_PATHS[k]!;
    f[k] = str(branding?.[sec]?.[key]);
  });
  const sender = b.sender || {};
  (Object.keys(SENDER_KEYS) as TextKey[]).forEach((k) => {
    f[k] = str(sender[SENDER_KEYS[k]!.key]);
  });
  f.sending_enabled = effectiveSendingEnabled(b);
  return f;
}

export const parseHostnames = (s: string) =>
  Array.from(new Set(
    s.split(/[,\s]+/).map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean),
  ));

export const normalizeDomain = (s: string) =>
  s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

/** Client-side validation; returns an error message or ''. */
export function validateBrandForm(f: BrandFormState, opts: { requireSlug?: boolean } = {}): string {
  if (opts.requireSlug && !/^[a-z0-9][a-z0-9-]{1,39}$/.test(f.slug.trim())) {
    return 'Slug must be 2-40 characters: lowercase letters, digits and dashes (e.g. "acme").';
  }
  if (!f.display_name.trim()) return 'Display name is required.';
  for (const k of ['daily_cap', 'start_hour', 'end_hour'] as const) {
    const v = f[k].trim();
    if (!v) continue;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) return `${LABELS[k]} must be a whole number.`;
    if ((k === 'start_hour' || k === 'end_hour') && n > 23) return `${LABELS[k]} must be between 0 and 23.`;
  }
  for (const k of ['primary_color', 'secondary_color', 'accent_color'] as const) {
    const v = f[k].trim();
    if (v && !/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(v)) return `${LABELS[k]} must be a hex color like #2563eb.`;
  }
  for (const k of ['alert_from', 'alert_to'] as const) {
    const v = f[k].trim();
    if (v && !v.split(',').every((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim()))) {
      return `${LABELS[k]} must be an email address.`;
    }
  }
  return '';
}

const LABELS: Record<TextKey, string> = {
  slug: 'Slug', display_name: 'Display name', website_domain: 'Website domain', hostnames: 'Hostnames',
  company_name: 'Company name', company_tagline: 'Tagline', company_logo: 'Logo URL',
  primary_color: 'Primary color', secondary_color: 'Secondary color', accent_color: 'Accent color',
  form_title: 'Form title', form_subtitle: 'Form subtitle',
  cta_url: 'CTA URL', alert_from: 'Alert sender', alert_to: 'Alert recipient',
  daily_cap: 'Daily cap', start_hour: 'Start hour', end_hour: 'End hour',
};

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o ?? {}));

/**
 * Build the PATCH body from the original brand + initial/current form.
 * Only changed fields are included; returns {} when nothing changed.
 */
export function buildBrandPatch(
  brand: BrandRow | null,
  initial: BrandFormState,
  current: BrandFormState,
  opts: { includeHostnames?: boolean; forceSendingEnabled?: boolean } = {},
): JsonObject {
  const body: JsonObject = {};

  if (current.display_name.trim() !== initial.display_name.trim()) body.display_name = current.display_name.trim();
  if (normalizeDomain(current.website_domain) !== normalizeDomain(initial.website_domain)) {
    body.website_domain = normalizeDomain(current.website_domain) || null;
  }
  if (opts.includeHostnames && parseHostnames(current.hostnames).join(',') !== parseHostnames(initial.hostnames).join(',')) {
    body.hostnames = parseHostnames(current.hostnames);
  }

  // branding: full existing object with changed leaves applied
  const branding = clone(brand?.branding || {});
  let brandingChanged = false;
  (Object.keys(BRANDING_PATHS) as TextKey[]).forEach((k) => {
    const next = current[k].trim();
    if (next === initial[k].trim()) return;
    brandingChanged = true;
    const [sec, key] = BRANDING_PATHS[k]!;
    if (next) {
      if (!branding[sec] || typeof branding[sec] !== 'object') branding[sec] = {};
      branding[sec][key] = next;
    } else if (branding[sec] && typeof branding[sec] === 'object') {
      delete branding[sec][key];
    }
  });
  if (brandingChanged) body.branding = branding;

  // sender: full existing object with changed keys applied
  const sender = clone(brand?.sender || {});
  let senderChanged = false;
  (Object.keys(SENDER_KEYS) as TextKey[]).forEach((k) => {
    const next = current[k].trim();
    if (next === initial[k].trim()) return;
    senderChanged = true;
    const { key, numeric } = SENDER_KEYS[k]!;
    sender[key] = next ? (numeric ? Number(next) : next) : null;
  });
  if (opts.forceSendingEnabled || current.sending_enabled !== initial.sending_enabled) {
    senderChanged = true;
    sender.sending_enabled = current.sending_enabled;
  }
  if (senderChanged) body.sender = sender;

  return body;
}

/** Read an error message from a failed fetch Response. */
export async function errorDetail(res: Response, fallback = 'Request failed'): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.detail === 'string') return body.detail;
    if (Array.isArray(body?.detail)) return body.detail.map((d: { msg?: string }) => d?.msg || String(d)).join('; ');
    return fallback;
  } catch {
    return `${fallback} (${res.status})`;
  }
}

/** Escape a value for interpolation into SweetAlert `html`. */
export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

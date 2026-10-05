/**
 * Application Configuration
 *
 * Multi-brand: the PUBLIC config is resolved per host (a brand-dedicated
 * hostname gets that brand's config) from GET /api/brands/public-config, with
 * the legacy /api/setup/config and /config.json as fallbacks. Inside the
 * dashboard the logged-in user's ACTIVE brand (GET /api/brands/current) is
 * overlaid on top - see ConfigContext.
 */

export interface EmailTeamMember {
  email: string;
  name: string;
  title: string;
  persona: string;
}

// Form field configuration
export interface FormFieldOption {
  value: string;
  label: string;
  icon?: string;
  description?: string;
}

export interface FormField {
  id: string;
  type: 'text' | 'email' | 'phone' | 'select' | 'radio' | 'checkbox' | 'textarea';
  label: string;
  placeholder?: string;
  required: boolean;
  enabled: boolean;
  options?: FormFieldOption[];
  gridCols?: 1 | 2 | 3 | 4; // For card-style options
}

export interface FormStep {
  id: string;
  title: string;
  subtitle?: string;
  fields: string[]; // Field IDs
}

export interface TrustBadge {
  icon: string;
  text: string;
}

export interface FormConfig {
  // Form type: single-page (compact) or multi-step (wizard)
  type: 'single-page' | 'multi-step';

  // Visual theme
  theme: 'modern' | 'minimal' | 'gradient' | 'glass';

  // Hero section
  hero: {
    headline: string;
    subheadline: string;
    showImage: boolean;
    imageUrl?: string;
  };

  // Trust badges (shown below form)
  trustBadges: TrustBadge[];

  // Key benefits (shown as bullet points or cards)
  benefits: string[];

  // Form fields configuration
  fields: FormField[];

  // Steps (for multi-step forms)
  steps?: FormStep[];

  // Call-to-action button
  submitButton: {
    text: string;
    loadingText: string;
  };

  // Success page customization
  successPage: {
    headline: string;
    message: string;
    showConfetti: boolean;
  };
}

export interface SetupConfig {
  completed: boolean;
  apiUrl: string;
}

export interface AppConfig {
  setup: SetupConfig;
  company: {
    name: string;
    tagline: string;
    logo: string;
    website: string;
    email: string;
    phone: string;
  };
  branding: {
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
  };
  form: {
    title: string;
    subtitle: string;
    successMessage: string;
  };
  // New modular form configuration
  formConfig?: FormConfig;
  dashboard: {
    title: string;
    subtitle: string;
  };
  emailTeam: EmailTeamMember[];
  features: {
    enableScraper: boolean;
    enableScheduler: boolean;
    enableEmailTracking: boolean;
    enableAIEmails: boolean;
  };
}

// Default AI Training form configuration (example - customize in config.json)
const defaultFormConfig: FormConfig = {
  type: 'single-page',
  theme: 'glass',
  hero: {
    headline: 'Transform Into an AI Expert',
    subheadline: 'Join Malaysia\'s premier AI certification program. From fundamentals to automation mastery.',
    showImage: false,
  },
  trustBadges: [
    { icon: '🏆', text: 'MDEC Approved' },
    { icon: '✅', text: 'HRD Corp Claimable' },
    { icon: '🎓', text: 'UTM Certified' },
    { icon: '💯', text: '14-Day Guarantee' },
  ],
  benefits: [
    'Master AI tools & prompt engineering in just 16 hours',
    'Get hands-on with real automation projects (30-40% practical)',
    'Receive industry-recognized certification',
    'Lifetime access to course materials & updates',
  ],
  fields: [
    { id: 'full_name', type: 'text', label: 'Full Name', placeholder: 'Your full name', required: true, enabled: true },
    { id: 'email', type: 'email', label: 'Work Email', placeholder: 'you@company.com', required: true, enabled: true },
    { id: 'phone', type: 'phone', label: 'Phone Number', placeholder: '+60 12-345 6789', required: true, enabled: true },
    { id: 'organization', type: 'text', label: 'Company/Organization', placeholder: 'Your company name', required: false, enabled: true },
    {
      id: 'role',
      type: 'select',
      label: 'Your Role',
      placeholder: 'Select your department',
      required: true,
      enabled: true,
      options: [
        { value: 'sales', label: 'Sales & Business Development' },
        { value: 'marketing', label: 'Marketing & Communications' },
        { value: 'hr', label: 'Human Resources' },
        { value: 'it', label: 'IT & Software Development' },
        { value: 'operations', label: 'Operations & Management' },
        { value: 'finance', label: 'Finance & Accounting' },
        { value: 'other', label: 'Other' },
      ],
    },
    {
      id: 'experience',
      type: 'radio',
      label: 'AI Experience Level',
      required: true,
      enabled: true,
      gridCols: 3,
      options: [
        { value: 'beginner', label: 'Beginner', icon: '🌱', description: 'New to AI' },
        { value: 'intermediate', label: 'Intermediate', icon: '📈', description: 'Used ChatGPT' },
        { value: 'advanced', label: 'Advanced', icon: '🚀', description: 'Built automations' },
      ],
    },
    {
      id: 'interest',
      type: 'radio',
      label: 'Which program interests you?',
      required: true,
      enabled: true,
      gridCols: 3,
      options: [
        { value: 'foundations', label: 'AI Foundations', icon: '📚', description: '16 hours' },
        { value: 'specialist', label: 'Department Specialist', icon: '🎯', description: '24 hours' },
        { value: 'expert', label: 'Automation Expert', icon: '⚡', description: '32 hours' },
      ],
    },
  ],
  submitButton: {
    text: 'Get Free Consultation',
    loadingText: 'Submitting...',
  },
  successPage: {
    headline: 'You\'re One Step Closer to AI Mastery!',
    message: 'Our training specialists will contact you within 24 hours to discuss your personalized learning path.',
    showConfetti: true,
  },
};

// Default config (fallback if config.json fails to load)
const defaultConfig: AppConfig = {
  setup: {
    completed: false,
    apiUrl: ''
  },
  company: {
    name: "Your Company",
    tagline: "Your Company Tagline",
    logo: "/logo.png",
    website: "https://www.yourcompany.com",
    email: "hello@yourcompany.com",
    phone: "+1234567890"
  },
  branding: {
    primaryColor: "#6366f1",
    secondaryColor: "#8b5cf6",
    accentColor: "#06b6d4"
  },
  form: {
    title: "Start Your AI Journey",
    subtitle: "Get personalized training recommendations",
    successMessage: "Thank you! Our team will contact you within 24 hours."
  },
  formConfig: defaultFormConfig,
  dashboard: {
    title: "Lead Generation Analytics",
    subtitle: "Track and analyze your lead performance"
  },
  emailTeam: [],
  features: {
    enableScraper: true,
    enableScheduler: true,
    enableEmailTracking: true,
    enableAIEmails: true
  }
};

// ============================================================================
// Loading - public (host-resolved) config, cached PER HOST
// ============================================================================

/** The default brand (slug "default"). Mirrors backend tenancy.DEFAULT_BRAND_ID. */
export const DEFAULT_BRAND_ID = '00000000-0000-0000-0000-0000000000a1';

/** `brand` part of GET /api/brands/public-config. */
export interface PublicBrandInfo {
  id: string;
  slug: string;
  display_name: string;
  website_domain?: string | null;
}

interface HostConfigEntry {
  config: AppConfig;
  brand: PublicBrandInfo | null;
}

// One entry per host: a brand-dedicated hostname resolves to its own brand.
const hostCache = new Map<string, HostConfigEntry>();
const hostInflight = new Map<string, Promise<HostConfigEntry>>();

function hostKey(): string {
  try {
    return window.location.host || '_';
  } catch {
    return '_';
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Same (shallow) merge semantics the app has always used. */
function mergeWithDefaults(config: Partial<AppConfig>): AppConfig {
  return { ...defaultConfig, ...config } as AppConfig;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status}`);
  }
  return response.json();
}

async function loadHostEntry(): Promise<HostConfigEntry> {
  // 1. Brand-aware public config (Host-resolved brand on the backend)
  try {
    const body = await fetchJson('/api/brands/public-config');
    if (isPlainObject(body) && isPlainObject(body.config)) {
      const config = { ...(body.config as Partial<AppConfig>) };
      if (!isPlainObject(config.setup)) {
        // Never let a missing `setup` block flip a configured install back to
        // the Setup Wizard: take it from the legacy endpoint.
        try {
          const legacy = await fetchJson('/api/setup/config');
          if (isPlainObject(legacy) && isPlainObject(legacy.setup)) {
            config.setup = legacy.setup as unknown as SetupConfig;
          }
        } catch {
          /* fall through to defaults */
        }
      }
      const brand = isPlainObject(body.brand) ? (body.brand as unknown as PublicBrandInfo) : null;
      return { config: mergeWithDefaults(config), brand };
    }
    throw new Error('unexpected public-config shape');
  } catch {
    /* fall back to the single-brand sources */
  }

  // 2. Backend endpoint (reads the actual config file on disk) - lets Setup
  //    Wizard updates take effect without rebuilding
  try {
    const config = await fetchJson('/api/setup/config');
    if (isPlainObject(config)) {
      return { config: mergeWithDefaults(config as Partial<AppConfig>), brand: null };
    }
  } catch {
    console.warn('API config failed, trying static config.json');
  }

  // 3. Static config.json (baked into the image)
  try {
    const config = await fetchJson('/config.json');
    if (isPlainObject(config)) {
      return { config: mergeWithDefaults(config as Partial<AppConfig>), brand: null };
    }
  } catch {
    /* ignore */
  }

  console.warn('Failed to load config, using defaults');
  return { config: defaultConfig, brand: null };
}

/**
 * Load the PUBLIC configuration for the current host:
 *   GET /api/brands/public-config (uses `.config`)
 *   -> GET /api/setup/config -> /config.json -> built-in defaults.
 * Cached per host for subsequent calls.
 */
export async function loadConfig(): Promise<AppConfig> {
  const key = hostKey();
  const cached = hostCache.get(key);
  if (cached) return cached.config;

  let pending = hostInflight.get(key);
  if (!pending) {
    pending = loadHostEntry()
      .then((entry) => {
        hostCache.set(key, entry);
        return entry;
      })
      .finally(() => {
        hostInflight.delete(key);
      });
    hostInflight.set(key, pending);
  }
  return (await pending).config;
}

/**
 * Get the cached PUBLIC (host) config synchronously (must call loadConfig first).
 * Public pages (landing, forms, login, success) use this.
 */
export function getConfig(): AppConfig {
  return hostCache.get(hostKey())?.config || defaultConfig;
}

/** Brand the current host resolved to (null when unknown / legacy backend). */
export function getPublicBrand(): PublicBrandInfo | null {
  return hostCache.get(hostKey())?.brand ?? null;
}

/**
 * Reset cached config (useful for testing or hot reload): the next
 * loadConfig() refetches.
 */
export function resetConfig(): void {
  hostCache.delete(hostKey());
  activeBrand = null;
}

// ============================================================================
// Active brand (logged-in dashboard) - GET /api/brands/current
// ============================================================================

/** Brand row as returned by GET /api/brands/current (fields we use). */
export interface BrandRow {
  id: string;
  slug: string;
  display_name: string;
  website_domain?: string | null;
  branding?: {
    company?: Partial<AppConfig['company']>;
    branding?: Partial<AppConfig['branding']>;
    form?: Partial<AppConfig['form']>;
    formConfig?: FormConfig;
    dashboard?: Partial<AppConfig['dashboard']>;
    features?: Partial<AppConfig['features']>;
    emailTeam?: EmailTeamMember[];
  } | null;
}

let activeBrand: { row: BrandRow; config: AppConfig } | null = null;

/** Only keep values that are actually set (null / '' never wipe a base value). */
function definedOnly<T extends object>(obj: Partial<T> | null | undefined): Partial<T> {
  const out: Partial<T> = {};
  if (!isPlainObject(obj)) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

/**
 * Build the dashboard config for a brand row on top of the public config.
 *
 * Default brand: its row's branding is overlaid on the public
 * config - an empty row (today's state) yields the public config unchanged.
 * Any other brand: identity fields never inherit the default brand's values (name,
 * logo, contact, AI email team); unset ones fall back to the brand's own
 * display name / domain or neutral defaults.
 */
export function buildBrandConfig(base: AppConfig, row: BrandRow): AppConfig {
  const b = isPlainObject(row.branding) ? row.branding : {};
  const isDefault = row.id === DEFAULT_BRAND_ID;

  const companyBase: AppConfig['company'] = isDefault
    ? base.company
    : {
        name: row.display_name || '',
        tagline: '',
        logo: '',
        website: row.website_domain ? `https://${row.website_domain}` : '',
        email: '',
        phone: '',
      };

  return {
    ...base,
    company: { ...companyBase, ...definedOnly(b.company) },
    branding: { ...base.branding, ...definedOnly(b.branding) },
    form: { ...(isDefault ? base.form : defaultConfig.form), ...definedOnly(b.form) },
    formConfig: b.formConfig ?? (isDefault ? base.formConfig : defaultConfig.formConfig),
    dashboard: { ...(isDefault ? base.dashboard : defaultConfig.dashboard), ...definedOnly(b.dashboard) },
    features: { ...base.features, ...definedOnly(b.features) },
    emailTeam: Array.isArray(b.emailTeam) ? b.emailTeam : isDefault ? base.emailTeam : [],
  };
}

/**
 * Fetch the active brand (GET /api/brands/current) for the logged-in user and
 * build its dashboard config. Returns null when not logged in / unavailable.
 * `fetcher` lets the caller pick a fetch that does not trigger the global
 * 401 -> /login redirect.
 */
export async function loadActiveBrandConfig(
  fetcher: (url: string) => Promise<Response>
): Promise<{ row: BrandRow; config: AppConfig } | null> {
  const base = await loadConfig();
  try {
    const response = await fetcher('/api/brands/current');
    if (!response.ok) return null;
    const body: unknown = await response.json();
    // Accept either the bare row or {brand: row}
    const row = (isPlainObject(body) && isPlainObject(body.brand) && (body.brand as { id?: unknown }).id
      ? body.brand
      : body) as BrandRow;
    if (!isPlainObject(row) || typeof row.id !== 'string') return null;
    activeBrand = { row, config: buildBrandConfig(base, row) };
    return activeBrand;
  } catch {
    return null;
  }
}

/** Dashboard config for the active brand (falls back to the public config). */
export function getActiveConfig(): AppConfig {
  return activeBrand?.config || getConfig();
}

/** The active brand row loaded by loadActiveBrandConfig (or null). */
export function getActiveBrandRow(): BrandRow | null {
  return activeBrand?.row ?? null;
}

/**
 * Public (unauthenticated) routes: these always show the HOST brand's config,
 * never the logged-in user's active brand.
 */
const PUBLIC_EXACT_PATHS = new Set(['/', '/login', '/setup', '/success']);
export function isPublicPath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, '') || '/';
  return PUBLIC_EXACT_PATHS.has(p) || p === '/form' || p.startsWith('/form-');
}

// ============================================================================
// Runtime brand theming
// ============================================================================
//
// tailwind.config.js reads the brand scales from CSS variables
// (rgb(var(--brand-600) / <alpha-value>)); src/index.css holds the DEFAULT
// values, which are exactly the stock UtilizeReach palette (Tailwind blue for
// `brand`/`blue`, Tailwind indigo for `brand-deep`/`indigo`, plus the
// primary/accent colours). A brand that sets branding.branding.primaryColor
// in its OWN row gets a ramp generated from that colour; everyone else keeps
// the defaults untouched, so the app renders exactly as before.

/** The default brand anchor (blue-600). A brand colour equal to this is "default". */
export const DEFAULT_BRAND_ANCHOR = '#2563eb';

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
// mix-with-white amount for lighter shades, mix-with-black for darker ones
const LIGHTEN: Record<number, number> = { 50: 0.95, 100: 0.9, 200: 0.77, 300: 0.6, 400: 0.38, 500: 0.16 };
const DARKEN: Record<number, number> = { 700: 0.17, 800: 0.35, 900: 0.5, 950: 0.7 };

type RGB = [number, number, number];

function parseHex(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function mix(a: RGB, b: RGB, amount: number): RGB {
  return [0, 1, 2].map((i) => Math.round(a[i] * (1 - amount) + b[i] * amount)) as RGB;
}

function luminance([r, g, b]: RGB): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ramp(anchor: RGB): Record<number, RGB> {
  const out: Record<number, RGB> = {};
  for (const s of SHADES) {
    if (s === 600) out[s] = anchor;
    else if (s < 600) out[s] = mix(anchor, [255, 255, 255], LIGHTEN[s]);
    else out[s] = mix(anchor, [0, 0, 0], DARKEN[s]);
  }
  return out;
}

const triplet = (c: RGB) => `${c[0]} ${c[1]} ${c[2]}`;
const hexOf = (c: RGB) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

/** The brand colour a brand row explicitly sets (normalised #rrggbb), or null. */
export function brandPrimaryColor(row: BrandRow | null | undefined): string | null {
  const raw = row?.branding?.branding?.primaryColor;
  const rgb = typeof raw === 'string' ? parseHex(raw) : null;
  return rgb ? hexOf(rgb) : null;
}

/**
 * CSS custom properties for a brand colour, or null when the colour is the
 * default (or invalid) - in which case nothing must be overridden.
 */
export function brandThemeVars(primaryHex: string | null | undefined): Record<string, string> | null {
  const parsed = primaryHex ? parseHex(primaryHex) : null;
  if (!parsed) return null;
  if (hexOf(parsed) === DEFAULT_BRAND_ANCHOR) return null;

  // Keep white text on the top bar readable: darken very light colours.
  let anchor: RGB = parsed;
  for (let i = 0; i < 20 && (1.05 / (luminance(anchor) + 0.05)) < 3; i++) {
    anchor = mix(anchor, [0, 0, 0], 0.08);
  }
  const main = ramp(anchor);
  const deep = ramp(mix(anchor, [0, 0, 0], 0.12));

  const vars: Record<string, string> = {};
  for (const s of SHADES) {
    vars[`--brand-${s}`] = triplet(main[s]);
    vars[`--brand-deep-${s}`] = triplet(deep[s]);
  }
  // Single-colour roles (tailwind `primary` / `accent`)
  vars['--brand-primary'] = triplet(main[600]);
  vars['--brand-primary-dark'] = triplet(main[800]);
  vars['--brand-primary-light'] = triplet(main[500]);
  vars['--brand-accent'] = triplet(main[500]);
  vars['--brand-accent-light'] = triplet(main[400]);
  return vars;
}

const appliedThemeVars = new Set<string>();

/**
 * Apply (or clear, with null) a runtime brand theme on <html>. Clearing
 * removes only what was set here, restoring the stylesheet defaults.
 */
export function applyBrandTheme(vars: Record<string, string> | null): void {
  try {
    const root = document.documentElement;
    for (const name of appliedThemeVars) root.style.removeProperty(name);
    appliedThemeVars.clear();
    if (!vars) return;
    for (const [name, value] of Object.entries(vars)) {
      root.style.setProperty(name, value);
      appliedThemeVars.add(name);
    }
  } catch {
    /* no DOM */
  }
}

/**
 * Check if setup is complete
 * ONLY checks config.setup.completed flag (set by Setup Wizard)
 *
 * NOTE: We intentionally DON'T check env vars here because:
 * 1. In Docker, env vars are baked into JS at build time
 * 2. Stale/test values from .env files cause false positives
 * 3. The Setup Wizard properly sets config.setup.completed = true
 */
export function isSetupComplete(config: AppConfig): boolean {
  // Development mode: bypass the wizard for local dev
  if (import.meta.env.DEV) {
    return true;
  }

  // Production: ONLY trust the config.json completed flag
  // This is set by the Setup Wizard when configuration is saved
  return config.setup?.completed === true;
}

/**
 * Get API URL - from config or env
 */
export function getApiUrl(config: AppConfig): string {
  return config.setup?.apiUrl || import.meta.env.VITE_API_URL || '';
}

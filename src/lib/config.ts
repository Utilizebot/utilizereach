/**
 * Application Configuration
 * Loads runtime config from /config.json for easy customization
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

// Cached config
let cachedConfig: AppConfig | null = null;

/**
 * Load configuration from /config.json
 * Caches the result for subsequent calls
 */
export async function loadConfig(): Promise<AppConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    // First try the backend API endpoint (reads from actual config file on disk)
    // This allows the Setup Wizard updates to take effect without rebuilding
    const response = await fetch('/api/setup/config');
    if (!response.ok) {
      // Fallback to static config.json (baked into Docker image)
      console.warn('API config failed, trying static config.json');
      const staticResponse = await fetch('/config.json');
      if (!staticResponse.ok) {
        console.warn('Failed to load config, using defaults');
        cachedConfig = defaultConfig;
        return defaultConfig;
      }
      const config = await staticResponse.json();
      const mergedConfig: AppConfig = { ...defaultConfig, ...config };
      cachedConfig = mergedConfig;
      return mergedConfig;
    }

    const config = await response.json();
    const mergedConfig: AppConfig = { ...defaultConfig, ...config };
    cachedConfig = mergedConfig;
    return mergedConfig;
  } catch (error) {
    console.warn('Error loading config, using defaults:', error);
    cachedConfig = defaultConfig;
    return defaultConfig;
  }
}

/**
 * Get cached config synchronously (must call loadConfig first)
 */
export function getConfig(): AppConfig {
  return cachedConfig || defaultConfig;
}

/**
 * Reset cached config (useful for testing or hot reload)
 */
export function resetConfig(): void {
  cachedConfig = defaultConfig;
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

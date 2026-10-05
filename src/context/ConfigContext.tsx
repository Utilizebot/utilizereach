/**
 * Config Context Provider
 * Makes app configuration available throughout the React component tree.
 *
 * Multi-brand:
 *   - publicConfig: the HOST's config (GET /api/brands/public-config with
 *     legacy fallbacks) - what anonymous visitors, the login page and public
 *     forms see.
 *   - config: inside the dashboard, the logged-in user's ACTIVE brand
 *     (GET /api/brands/current) overlaid on the public config, so the
 *     dashboard shows that brand's name / logo / colours. Equal to
 *     publicConfig when nobody is logged in.
 *   - The brand colour scale (Tailwind `brand` / `blue` / `indigo` /
 *     `primary` / `accent`, backed by the --brand-* CSS variables) is themed
 *     at runtime ONLY when the active brand's own row sets
 *     branding.primaryColor to something other than the default blue. A brand
 *     without one renders exactly with the stock UtilizeReach palette.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  loadConfig,
  getConfig,
  getActiveConfig,
  loadActiveBrandConfig,
  isSetupComplete as checkSetupComplete,
  isPublicPath,
  brandPrimaryColor,
  brandThemeVars,
  applyBrandTheme,
} from '../lib/config';
import type { AppConfig, BrandRow } from '../lib/config';
import { AUTH_TOKEN_EVENT, fetchWithoutAuthRedirect, getStoredToken } from '../lib/auth';

interface ConfigContextType {
  /** Active-brand config in the dashboard (public config when logged out). */
  config: AppConfig | null;
  /** Host-resolved public config. */
  publicConfig: AppConfig | null;
  /** Active brand row from GET /api/brands/current (null when logged out). */
  activeBrandRow: BrandRow | null;
  loading: boolean;
  error: Error | null;
  isSetupComplete: boolean;
  /** Re-fetch the active brand (e.g. after editing its branding). */
  refreshBrandConfig: () => Promise<void>;
}

const ConfigContext = createContext<ConfigContextType>({
  config: null,
  publicConfig: null,
  activeBrandRow: null,
  loading: true,
  error: null,
  isSetupComplete: false,
  refreshBrandConfig: async () => {},
});

interface ConfigProviderProps {
  children: ReactNode;
}

export function ConfigProvider({ children }: ConfigProviderProps) {
  const [publicConfig, setPublicConfig] = useState<AppConfig | null>(null);
  const [brandConfig, setBrandConfig] = useState<AppConfig | null>(null);
  const [activeBrandRow, setActiveBrandRow] = useState<BrandRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [setupComplete, setSetupComplete] = useState(false);

  useEffect(() => {
    loadConfig()
      .then((loadedConfig) => {
        setPublicConfig(loadedConfig);
        setSetupComplete(checkSetupComplete(loadedConfig));
        setLoading(false);
      })
      .catch((err) => {
        setError(err);
        setLoading(false);
      });
  }, []);

  // Active brand: load when a session exists, again whenever the token
  // changes in this tab (login / logout), and clear on logout.
  const brandRequestSeq = useRef(0);
  const refreshBrandConfig = useCallback(async () => {
    const seq = ++brandRequestSeq.current;
    if (!getStoredToken()) {
      setBrandConfig(null);
      setActiveBrandRow(null);
      applyBrandTheme(null);
      return;
    }
    const result = await loadActiveBrandConfig((url) => fetchWithoutAuthRedirect(url));
    if (seq !== brandRequestSeq.current) return; // superseded by a newer refresh
    if (!getStoredToken()) return; // logged out meanwhile
    if (!result) {
      // Unavailable (older backend, transient error): keep the public look.
      setBrandConfig(null);
      setActiveBrandRow(null);
      applyBrandTheme(null);
      return;
    }
    setBrandConfig(result.config);
    setActiveBrandRow(result.row);
    applyBrandTheme(brandThemeVars(brandPrimaryColor(result.row)));
  }, []);

  useEffect(() => {
    void refreshBrandConfig();
    const onTokenChanged = () => {
      void refreshBrandConfig();
    };
    window.addEventListener(AUTH_TOKEN_EVENT, onTokenChanged);
    return () => window.removeEventListener(AUTH_TOKEN_EVENT, onTokenChanged);
  }, [refreshBrandConfig]);

  const config = brandConfig ?? publicConfig;

  return (
    <ConfigContext.Provider
      value={{
        config,
        publicConfig,
        activeBrandRow,
        loading,
        error,
        isSetupComplete: setupComplete,
        refreshBrandConfig,
      }}
    >
      {children}
    </ConfigContext.Provider>
  );
}

/**
 * Hook to access app configuration
 * Returns config object with company, branding, form settings, etc.
 *
 * On public routes (landing, forms, login, success) this is always the HOST
 * brand's config; elsewhere (dashboard) it is the active brand's.
 */
export function useConfig(): AppConfig {
  const { config, publicConfig, loading } = useContext(ConfigContext);
  const onPublicPage = typeof window !== 'undefined' && isPublicPath(window.location.pathname);

  if (onPublicPage) {
    return loading || !publicConfig ? getConfig() : publicConfig;
  }

  // Return cached/default config while loading
  if (loading || !config) {
    return getActiveConfig();
  }

  return config;
}

/**
 * Hook to access the host-resolved PUBLIC config regardless of login state
 * (public form header, landing pages).
 */
export function usePublicConfig(): AppConfig {
  const { publicConfig, loading } = useContext(ConfigContext);
  return loading || !publicConfig ? getConfig() : publicConfig;
}

/**
 * Hook to check if config is still loading
 */
export function useConfigLoading(): boolean {
  const { loading } = useContext(ConfigContext);
  return loading;
}

/**
 * Hook to check if setup is complete
 */
export function useSetupComplete(): boolean {
  const { isSetupComplete } = useContext(ConfigContext);
  return isSetupComplete;
}

/**
 * Hook to get full config context
 */
export function useConfigContext(): ConfigContextType {
  return useContext(ConfigContext);
}

/**
 * Config Context Provider
 * Makes app configuration available throughout the React component tree
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { loadConfig, getConfig, isSetupComplete as checkSetupComplete } from '../lib/config';
import type { AppConfig } from '../lib/config';

interface ConfigContextType {
  config: AppConfig | null;
  loading: boolean;
  error: Error | null;
  isSetupComplete: boolean;
}

const ConfigContext = createContext<ConfigContextType>({
  config: null,
  loading: true,
  error: null,
  isSetupComplete: false
});

interface ConfigProviderProps {
  children: ReactNode;
}

export function ConfigProvider({ children }: ConfigProviderProps) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [setupComplete, setSetupComplete] = useState(false);

  useEffect(() => {
    loadConfig()
      .then((loadedConfig) => {
        setConfig(loadedConfig);
        setSetupComplete(checkSetupComplete(loadedConfig));
        setLoading(false);
      })
      .catch((err) => {
        setError(err);
        setLoading(false);
      });
  }, []);

  return (
    <ConfigContext.Provider value={{ config, loading, error, isSetupComplete: setupComplete }}>
      {children}
    </ConfigContext.Provider>
  );
}

/**
 * Hook to access app configuration
 * Returns config object with company, branding, form settings, etc.
 */
export function useConfig(): AppConfig {
  const { config, loading } = useContext(ConfigContext);

  // Return cached/default config while loading
  if (loading || !config) {
    return getConfig();
  }

  return config;
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

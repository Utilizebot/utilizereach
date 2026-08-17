/**
 * Setup Wizard Component
 * First-run setup experience for configuring the application
 * Saves configuration by calling backend API via nginx reverse proxy
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Server,
  UserPlus,
  Key,
  Building2,
  Save,
  CheckCircle,
  XCircle,
  ChevronRight,
  ChevronLeft,
  AlertCircle,
  Loader2,
  RefreshCw,
  LogIn,
  Eye,
  EyeOff,
  PlugZap
} from 'lucide-react';
import {
  AI_PROVIDERS,
  getProviderMeta,
  testAIProvider,
  type AIProviderId,
  type TestProviderResult
} from '../lib/aiProviders';

interface SetupStatus {
  isComplete: boolean;
  hasEnvFile: boolean;
  hasConfigFile: boolean;
  backendReady: boolean;
  databaseConnected: boolean;
  adminExists: boolean;
}

interface SetupData {
  // Admin account
  adminEmail: string;
  adminPassword: string;
  adminFullName: string;
  // AI provider
  aiProvider: AIProviderId;
  aiModel: string;
  aiApiKey: string;
  aiBaseUrl: string;
  // Other APIs
  serpApiKey: string;
  googleClientId: string;
  googleClientSecret: string;
  // Company
  companyName: string;
  companyEmail: string;
  companyPhone: string;
  companyWebsite: string;
}

const initialData: SetupData = {
  adminEmail: '',
  adminPassword: '',
  adminFullName: '',
  aiProvider: 'gemini',
  aiModel: 'gemini-flash-latest',
  aiApiKey: '',
  aiBaseUrl: '',
  serpApiKey: '',
  googleClientId: '',
  googleClientSecret: '',
  companyName: '',
  companyEmail: '',
  companyPhone: '',
  companyWebsite: '',
};

export function SetupWizard() {
  const [currentStep, setCurrentStep] = useState(1);
  const [data, setData] = useState<SetupData>(initialData);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // System status (step 1)
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);

  // Admin account (step 2)
  const [adminCreated, setAdminCreated] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  // AI provider (step 3)
  const [aiTesting, setAiTesting] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<TestProviderResult | null>(null);
  const [showAiKey, setShowAiKey] = useState(false);
  const [aiCustomModel, setAiCustomModel] = useState(false);

  // Auto-detect the current URL for display purposes
  const currentUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const steps = [
    { num: 1, label: 'System', icon: Server },
    { num: 2, label: 'Admin', icon: UserPlus },
    { num: 3, label: 'API Keys', icon: Key },
    { num: 4, label: 'Company', icon: Building2 },
  ];

  const fetchStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const response = await fetch('/api/setup/status');
      if (!response.ok) {
        throw new Error(`Backend returned ${response.status}`);
      }
      const result: SetupStatus = await response.json();
      setStatus(result);
    } catch (error) {
      console.error('Status check error:', error);
      setStatus(null);
      setStatusError(error instanceof Error ? error.message : 'Could not reach the backend');
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const updateData = (field: Exclude<keyof SetupData, 'aiProvider'>, value: string) => {
    setData(prev => ({ ...prev, [field]: value }));
  };

  const providerMeta = getProviderMeta(data.aiProvider);

  const updateAIField = (field: 'aiModel' | 'aiApiKey' | 'aiBaseUrl', value: string) => {
    setAiTestResult(null);
    updateData(field, value);
  };

  const selectAIProvider = (id: AIProviderId) => {
    if (id === data.aiProvider) return;
    const meta = getProviderMeta(id);
    setAiTestResult(null);
    setAiCustomModel(false);
    setData(prev => ({ ...prev, aiProvider: id, aiModel: meta.defaultModel }));
  };

  const handleModelSelect = (value: string) => {
    if (value === '__custom__') {
      setAiCustomModel(true);
      updateAIField('aiModel', '');
    } else {
      setAiCustomModel(false);
      updateAIField('aiModel', value);
    }
  };

  const handleTestProvider = async () => {
    setAiTesting(true);
    setAiTestResult(null);
    const result = await testAIProvider({
      ai_provider: data.aiProvider,
      ai_model: data.aiModel,
      ai_api_key: data.aiApiKey,
      ai_base_url: data.aiBaseUrl,
    });
    setAiTestResult(result);
    setAiTesting(false);
  };

  const adminReady = adminCreated || !!status?.adminExists;

  const validateStep = (step: number): boolean => {
    switch (step) {
      case 1:
        return !!(status?.databaseConnected && status?.backendReady);
      case 2:
        return adminReady;
      case 3: {
        // claude-cli needs no input at all; custom needs a model (key optional);
        // gemini/claude/openai need an API key
        const meta = getProviderMeta(data.aiProvider);
        if (meta.apiKey === 'required' && !data.aiApiKey.trim()) return false;
        if (meta.modelRequired && !data.aiModel.trim()) return false;
        return true;
      }
      case 4:
        return true; // Company info is optional
      default:
        return true;
    }
  };

  const nextStep = () => {
    if (validateStep(currentStep) && currentStep < 4) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const createAdminAccount = async () => {
    setRegistering(true);
    setRegisterError(null);

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: data.adminEmail,
          password: data.adminPassword,
          full_name: data.adminFullName,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || 'Failed to create admin account');
      }

      const result = await response.json();
      if (result.access_token) {
        localStorage.setItem('auth_token', result.access_token);
      }
      setAdminCreated(true);
      setStatus(prev => (prev ? { ...prev, adminExists: true } : prev));
    } catch (error) {
      console.error('Register error:', error);
      setRegisterError(error instanceof Error ? error.message : 'Failed to create admin account');
    } finally {
      setRegistering(false);
    }
  };

  const saveConfiguration = async () => {
    setSaving(true);
    setSaveError(null);

    try {
      // Use relative URL - nginx proxies to backend automatically
      // This works on ANY domain without configuration!
      console.log('Saving configuration via /api/setup/save');

      const response = await fetch('/api/setup/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          aiProvider: data.aiProvider,
          aiModel: data.aiModel,
          aiApiKey: data.aiApiKey,
          aiBaseUrl: data.aiBaseUrl,
          // Legacy field kept for backward compat
          geminiApiKey: data.aiProvider === 'gemini' ? data.aiApiKey : '',
          serpApiKey: data.serpApiKey,
          googleClientId: data.googleClientId,
          googleClientSecret: data.googleClientSecret,
          // Auto-detect URLs from current browser location
          frontendUrl: window.location.origin,
          backendUrl: window.location.origin, // Same origin via nginx proxy
          redisUrl: 'redis://redis:6379/0', // Docker internal
          companyName: data.companyName,
          companyEmail: data.companyEmail,
          companyPhone: data.companyPhone,
          companyWebsite: data.companyWebsite,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to save configuration');
      }

      const result = await response.json();
      console.log('Setup saved:', result);
      setSaveSuccess(true);
    } catch (error) {
      console.error('Setup error:', error);
      setSaveError(error instanceof Error ? error.message : 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const StatusRow = ({ ok, label, detail }: { ok: boolean; label: string; detail: string }) => (
    <div className="flex items-center gap-3 bg-slate-900/50 rounded-lg p-4">
      {ok ? (
        <CheckCircle className="w-6 h-6 text-green-400 flex-shrink-0" />
      ) : (
        <XCircle className="w-6 h-6 text-red-400 flex-shrink-0" />
      )}
      <div>
        <p className="text-white font-medium">{label}</p>
        <p className="text-sm text-slate-400">{detail}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="max-w-4xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent mb-3">
            Marketing AI Setup Wizard
          </h1>
          <p className="text-slate-400 text-lg">
            Configure your application in a few simple steps
          </p>
        </div>

        {/* Progress Steps */}
        <div className="flex justify-center mb-12">
          {steps.map((step, idx) => (
            <div key={step.num} className="flex items-center">
              <div className="flex flex-col items-center">
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                    currentStep === step.num
                      ? 'bg-gradient-to-r from-blue-500 to-purple-500 shadow-lg shadow-purple-500/30'
                      : currentStep > step.num
                      ? 'bg-green-500'
                      : 'bg-slate-700'
                  }`}
                >
                  {currentStep > step.num ? (
                    <CheckCircle className="w-6 h-6 text-white" />
                  ) : (
                    <step.icon className="w-5 h-5 text-white" />
                  )}
                </div>
                <span className={`mt-2 text-sm ${currentStep >= step.num ? 'text-white' : 'text-slate-500'}`}>
                  {step.label}
                </span>
              </div>
              {idx < steps.length - 1 && (
                <div className={`w-16 h-0.5 mx-2 ${currentStep > step.num ? 'bg-green-500' : 'bg-slate-700'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700 rounded-2xl p-8 shadow-2xl">

          {/* Step 1: System Check */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-semibold text-white mb-2">System Check</h2>
                <p className="text-slate-400">Verifying that all services are up and running</p>
              </div>

              {statusLoading ? (
                <div className="flex items-center justify-center gap-3 py-12 text-slate-300">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  Checking system status...
                </div>
              ) : (
                <div className="space-y-4">
                  <StatusRow
                    ok={!!status}
                    label="Backend API"
                    detail={status ? 'Backend is reachable' : statusError || 'Backend is not reachable'}
                  />
                  <StatusRow
                    ok={!!status?.databaseConnected}
                    label="PostgreSQL Database"
                    detail={
                      status?.databaseConnected
                        ? 'Database connected - schema is applied automatically at startup'
                        : 'Database not connected. If containers just started, wait a few seconds and retry.'
                    }
                  />
                </div>
              )}

              {!statusLoading && !validateStep(1) && (
                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
                  <div className="flex gap-3">
                    <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-yellow-300 font-medium">System not ready yet</p>
                      <p className="text-sm text-slate-300 mt-1">
                        Make sure all containers are running: <code className="bg-slate-800 px-2 py-0.5 rounded text-cyan-400">docker compose ps</code>
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={fetchStatus}
                disabled={statusLoading}
                className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${statusLoading ? 'animate-spin' : ''}`} />
                Retry Check
              </button>
            </div>
          )}

          {/* Step 2: Admin Account */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-semibold text-white mb-2">Admin Account</h2>
                <p className="text-slate-400">Create the administrator account for the dashboard</p>
              </div>

              {adminReady ? (
                <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                  <div className="flex gap-3">
                    <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-green-300 font-medium">
                        {adminCreated ? 'Admin account created!' : 'Admin account already exists'}
                      </p>
                      <p className="text-sm text-slate-300 mt-1">
                        {adminCreated
                          ? 'You are now signed in as the administrator. Continue to the next step.'
                          : 'An administrator account was already created. Continue to the next step.'}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Full Name <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={data.adminFullName}
                      onChange={(e) => updateData('adminFullName', e.target.value)}
                      placeholder="Jane Doe"
                      className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Email <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="email"
                      value={data.adminEmail}
                      onChange={(e) => updateData('adminEmail', e.target.value)}
                      placeholder="admin@yourcompany.com"
                      className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Password <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="password"
                      value={data.adminPassword}
                      onChange={(e) => updateData('adminPassword', e.target.value)}
                      placeholder="Choose a strong password"
                      className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                    <p className="mt-1 text-sm text-slate-500">
                      At least 8 characters recommended
                    </p>
                  </div>

                  {registerError && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
                      <div className="flex gap-3">
                        <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-red-300 font-medium">Error Creating Account</p>
                          <p className="text-sm text-red-200 mt-1">{registerError}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={createAdminAccount}
                    disabled={registering || !data.adminEmail || !data.adminPassword || !data.adminFullName}
                    className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-400 hover:to-purple-400 text-white rounded-lg transition-all shadow-lg hover:shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {registering ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Creating Account...
                      </>
                    ) : (
                      <>
                        <UserPlus className="w-5 h-5" />
                        Create Admin Account
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Step 3: API Keys */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-semibold text-white mb-2">AI Provider &amp; API Keys</h2>
                <p className="text-slate-400">Choose the AI service that generates your emails</p>
              </div>

              <div className="space-y-4">
                {/* Provider picker */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {AI_PROVIDERS.map((p) => {
                    const selected = data.aiProvider === p.id;
                    const Icon = p.icon;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => selectAIProvider(p.id)}
                        className={`flex items-start gap-3 p-4 rounded-lg border text-left transition-all ${
                          selected
                            ? 'border-purple-500 bg-purple-500/10 ring-1 ring-purple-500'
                            : 'border-slate-600 bg-slate-900/50 hover:border-slate-500'
                        }`}
                      >
                        <Icon
                          className={`w-5 h-5 flex-shrink-0 mt-0.5 ${
                            selected ? 'text-purple-400' : 'text-slate-400'
                          }`}
                        />
                        <div className="min-w-0">
                          <p className={`text-sm font-medium ${selected ? 'text-purple-300' : 'text-white'}`}>
                            {p.label}
                          </p>
                          <p className="text-xs text-slate-400 mt-0.5">{p.description}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Model */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Model{' '}
                    {providerMeta.modelRequired ? (
                      <span className="text-red-400">*</span>
                    ) : (
                      <span className="text-slate-500 font-normal">(Optional)</span>
                    )}
                  </label>
                  {providerMeta.modelSuggestions.length > 0 ? (
                    <div className="space-y-2">
                      <select
                        value={aiCustomModel ? '__custom__' : data.aiModel}
                        onChange={(e) => handleModelSelect(e.target.value)}
                        className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      >
                        {providerMeta.modelSuggestions.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                        <option value="__custom__">Custom…</option>
                      </select>
                      {aiCustomModel && (
                        <input
                          type="text"
                          value={data.aiModel}
                          onChange={(e) => updateAIField('aiModel', e.target.value)}
                          placeholder="Enter model name"
                          className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        />
                      )}
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={data.aiModel}
                      onChange={(e) => updateAIField('aiModel', e.target.value)}
                      placeholder={providerMeta.modelPlaceholder}
                      className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                  )}
                </div>

                {/* API key */}
                {providerMeta.apiKey !== 'none' && (
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      API Key{' '}
                      {providerMeta.apiKey === 'required' ? (
                        <span className="text-red-400">*</span>
                      ) : (
                        <span className="text-slate-500 font-normal">(Optional)</span>
                      )}
                    </label>
                    <div className="relative">
                      <input
                        type={showAiKey ? 'text' : 'password'}
                        value={data.aiApiKey}
                        onChange={(e) => updateAIField('aiApiKey', e.target.value)}
                        placeholder={providerMeta.keyPlaceholder}
                        className="w-full px-4 py-3 pr-12 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                      <button
                        type="button"
                        onClick={() => setShowAiKey(v => !v)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                        aria-label={showAiKey ? 'Hide API key' : 'Show API key'}
                      >
                        {showAiKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>
                )}

                {/* Base URL (custom only) */}
                {providerMeta.showBaseUrl && (
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Base URL <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="url"
                      value={data.aiBaseUrl}
                      onChange={(e) => updateAIField('aiBaseUrl', e.target.value)}
                      placeholder="http://host.docker.internal:11434/v1"
                      className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                  </div>
                )}

                <p className="text-sm text-slate-500">{providerMeta.note}</p>

                {/* Test connection */}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleTestProvider}
                    disabled={aiTesting}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {aiTesting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <PlugZap className="w-4 h-4" />
                    )}
                    {aiTesting ? 'Testing...' : 'Test connection'}
                  </button>

                  {aiTestResult && aiTestResult.success && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 border border-green-500/20 text-green-300 rounded-full text-sm font-medium">
                      <CheckCircle className="w-4 h-4" />
                      Connected
                      {aiTestResult.model ? ` · ${aiTestResult.model}` : ''}
                      {typeof aiTestResult.latency_ms === 'number' ? ` · ${aiTestResult.latency_ms}ms` : ''}
                    </span>
                  )}
                  {aiTestResult && !aiTestResult.success && (
                    <span className="inline-flex items-center gap-1.5 text-sm text-red-300">
                      <XCircle className="w-4 h-4 flex-shrink-0" />
                      {aiTestResult.message}
                    </span>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    SerpAPI Key <span className="text-slate-500 font-normal">(Optional - for lead scraping)</span>
                  </label>
                  <input
                    type="password"
                    value={data.serpApiKey}
                    onChange={(e) => updateData('serpApiKey', e.target.value)}
                    placeholder="Your SerpAPI key"
                    className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                  <p className="mt-1 text-sm text-slate-500">
                    Get from{' '}
                    <a href="https://serpapi.com" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300">
                      serpapi.com
                    </a>
                  </p>
                </div>

                <div className="border-t border-slate-700 pt-4 mt-6">
                  <p className="text-sm text-slate-400 mb-4">Google OAuth (for Gmail sending)</p>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        Google Client ID <span className="text-slate-500 font-normal">(Optional)</span>
                      </label>
                      <input
                        type="text"
                        value={data.googleClientId}
                        onChange={(e) => updateData('googleClientId', e.target.value)}
                        placeholder="xxxxx.apps.googleusercontent.com"
                        className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        Google Client Secret <span className="text-slate-500 font-normal">(Optional)</span>
                      </label>
                      <input
                        type="password"
                        value={data.googleClientSecret}
                        onChange={(e) => updateData('googleClientSecret', e.target.value)}
                        placeholder="GOCSPX-..."
                        className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Company Info + Save */}
          {currentStep === 4 && (
            <div className="space-y-6">
              {!saveSuccess ? (
                <>
                  <div>
                    <h2 className="text-2xl font-semibold text-white mb-2">Company Information</h2>
                    <p className="text-slate-400">Customize branding, then save to complete setup</p>
                  </div>

                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">Company Name</label>
                        <input
                          type="text"
                          value={data.companyName}
                          onChange={(e) => updateData('companyName', e.target.value)}
                          placeholder="Your Company"
                          className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">Contact Email</label>
                        <input
                          type="email"
                          value={data.companyEmail}
                          onChange={(e) => updateData('companyEmail', e.target.value)}
                          placeholder="sales@company.com"
                          className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">Phone Number</label>
                        <input
                          type="tel"
                          value={data.companyPhone}
                          onChange={(e) => updateData('companyPhone', e.target.value)}
                          placeholder="+1 234 567 8900"
                          className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">Website</label>
                        <input
                          type="url"
                          value={data.companyWebsite}
                          onChange={(e) => updateData('companyWebsite', e.target.value)}
                          placeholder="https://www.company.com"
                          className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Auto-detected info */}
                  <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                    <div className="flex gap-3">
                      <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-green-300 font-medium">Server URLs Auto-Detected</p>
                        <p className="text-sm text-slate-300 mt-1">
                          Your application URL: <code className="bg-slate-800 px-2 py-0.5 rounded text-cyan-400">{currentUrl}</code>
                        </p>
                        <p className="text-sm text-slate-400 mt-1">
                          No manual server configuration needed!
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Error message */}
                  {saveError && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
                      <div className="flex gap-3">
                        <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-red-300 font-medium">Error Saving Configuration</p>
                          <p className="text-sm text-red-200 mt-1">{saveError}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                /* Success State */
                <div className="text-center py-8">
                  <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                    <CheckCircle className="w-10 h-10 text-green-400" />
                  </div>
                  <h2 className="text-2xl font-semibold text-white mb-2">Setup Complete!</h2>
                  <p className="text-slate-400 mb-8">Your application is configured and ready to use</p>

                  {/* Next Steps */}
                  <div className="bg-slate-900/50 rounded-lg p-6 text-left max-w-lg mx-auto">
                    <h3 className="text-lg font-medium text-white mb-4">Next Steps</h3>
                    <ol className="space-y-4">
                      <li className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center text-sm font-medium">1</span>
                        <div>
                          <p className="text-white font-medium">Log in to your dashboard</p>
                          <p className="text-sm text-slate-400 mt-1">
                            Use the admin email and password you created in step 2
                          </p>
                        </div>
                      </li>
                      <li className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center text-sm font-medium">2</span>
                        <div>
                          <p className="text-white font-medium">Restart the backend (recommended)</p>
                          <p className="text-sm text-slate-400 mt-1">
                            Background email workers pick up new API keys after a restart:{' '}
                            <code className="bg-slate-800 px-2 py-1 rounded text-cyan-400">docker compose restart backend celery_worker celery_beat</code>
                          </p>
                        </div>
                      </li>
                    </ol>
                  </div>

                  <a
                    href="/login"
                    className="mt-8 inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-400 hover:to-purple-400 text-white rounded-lg transition-all shadow-lg hover:shadow-purple-500/25"
                  >
                    <LogIn className="w-5 h-5" />
                    Go to Login
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Navigation Buttons */}
          {!saveSuccess && (
            <div className="flex justify-between mt-8 pt-6 border-t border-slate-700">
              <button
                onClick={prevStep}
                disabled={currentStep === 1}
                className={`flex items-center gap-2 px-6 py-3 rounded-lg transition-colors ${
                  currentStep === 1
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    : 'bg-slate-700 hover:bg-slate-600 text-white'
                }`}
              >
                <ChevronLeft className="w-5 h-5" />
                Back
              </button>

              {currentStep < 4 ? (
                <button
                  onClick={nextStep}
                  disabled={!validateStep(currentStep)}
                  className={`flex items-center gap-2 px-6 py-3 rounded-lg transition-all ${
                    validateStep(currentStep)
                      ? 'bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-400 hover:to-purple-400 text-white shadow-lg hover:shadow-purple-500/25'
                      : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  Next
                  <ChevronRight className="w-5 h-5" />
                </button>
              ) : (
                <button
                  onClick={saveConfiguration}
                  disabled={saving}
                  className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-400 hover:to-emerald-400 text-white rounded-lg transition-all shadow-lg hover:shadow-green-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-5 h-5" />
                      Save Configuration
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-slate-500 text-sm mt-8">
          Marketing AI Setup Wizard &bull; Need help? Check the documentation
        </p>
      </div>
    </div>
  );
}

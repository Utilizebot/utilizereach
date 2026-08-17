/**
 * Email AI Settings Component
 *
 * Settings page for configuring AI email generation
 * - Company information
 * - CTA links
 * - AI prompt template
 *
 * Admin only access
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Sparkles,
  Building2,
  Link,
  FileText,
  Save,
  RotateCcw,
  Eye,
  EyeOff,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
  Copy,
  Info,
  Cpu,
  PlugZap
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import {
  AI_PROVIDERS,
  getProviderMeta,
  testAIProvider,
  type AIProviderId,
  type TestProviderResult
} from '../../lib/aiProviders';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface EmailAISettings {
  id: string | null;
  company_name: string;
  company_tagline: string;
  company_services: string;
  cta_link_1_label: string;
  cta_link_1_url: string;
  cta_link_2_label: string;
  cta_link_2_url: string;
  email_word_limit: number;
  email_tone: string;
  ai_prompt_template: string;
  ai_provider: string;
  ai_model: string;
  ai_api_key: string;
  ai_base_url: string;
  created_at: string | null;
  updated_at: string | null;
  error?: string;
}

const DEFAULT_PROMPT = `You are {sender_name}, {sender_title} at {company_name} - {company_tagline}.

Your personality: {sender_persona}
Your focus: {sender_focus}

ABOUT {company_name} (CRITICAL - ONLY WRITE ABOUT THIS):
{company_name} specializes in:
{company_services}

Write a personalized cold outreach email to:
- Name: {lead_name}
- Company: {lead_company}
- Title: {lead_title}
- Industry: {lead_industry}

STRICT REQUIREMENTS:
1. ONLY discuss {company_name}'s services (listed above)
2. Focus on how {lead_company} in {lead_industry} industry could benefit
3. Reference specific pain points in {lead_industry} that your services can solve
4. Mention CONCRETE benefits: cost reduction, efficiency gains, ROI
5. Professional but conversational tone - like a human consultant reaching out
6. Show you researched their company/industry (mention {lead_title} role specifically)
7. Focus on YOUR specialty: {sender_focus}
8. Keep it under {word_limit} words (3-4 short paragraphs)
9. Sign as {sender_name}, {sender_title} at {company_name}
10. Include clear call-to-action with the CTA links provided

NEVER:
- Mention you are an AI or this is automated
- Talk about services outside what is listed above
- Use generic "solutions" language without specifics
- Write about other companies or industries
- Use salesy buzzwords

Write as if you personally researched {lead_company} and are genuinely reaching out to help.`;

export function EmailAISettings() {
  const { isAdmin } = useAuth();

  const [settings, setSettings] = useState<EmailAISettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'company' | 'cta' | 'prompt'>('company');

  // AI provider UI state
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestProviderResult | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [customModel, setCustomModel] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    company_name: '',
    company_tagline: '',
    company_services: '',
    cta_link_1_label: '',
    cta_link_1_url: '',
    cta_link_2_label: '',
    cta_link_2_url: '',
    email_word_limit: 150,
    email_tone: 'professional but conversational',
    ai_prompt_template: DEFAULT_PROMPT,
    ai_provider: 'gemini',
    ai_model: 'gemini-flash-latest',
    ai_api_key: '',
    ai_base_url: ''
  });

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/email-ai-settings`);
      const data = await response.json();

      setSettings(data);
      setFormData({
        company_name: data.company_name || '',
        company_tagline: data.company_tagline || '',
        company_services: data.company_services || '',
        cta_link_1_label: data.cta_link_1_label || '',
        cta_link_1_url: data.cta_link_1_url || '',
        cta_link_2_label: data.cta_link_2_label || '',
        cta_link_2_url: data.cta_link_2_url || '',
        email_word_limit: data.email_word_limit || 150,
        email_tone: data.email_tone || 'professional but conversational',
        ai_prompt_template: data.ai_prompt_template || DEFAULT_PROMPT,
        ai_provider: data.ai_provider || 'gemini',
        ai_model: data.ai_model || getProviderMeta(data.ai_provider || 'gemini').defaultModel,
        ai_api_key: data.ai_api_key || '',
        ai_base_url: data.ai_base_url || ''
      });

      const loadedMeta = getProviderMeta(data.ai_provider || 'gemini');
      const loadedModel = data.ai_model || loadedMeta.defaultModel;
      setCustomModel(
        loadedMeta.modelSuggestions.length > 0 &&
        !!loadedModel &&
        !loadedMeta.modelSuggestions.includes(loadedModel)
      );

      if (data.error) {
        setError(data.error);
      }
    } catch (err) {
      setError('Failed to load settings. Please check if the migration has been run.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch(`${API_BASE}/api/email-ai-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to save settings');
      }

      setSuccessMessage('Settings saved successfully!');
      await fetchSettings();

      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!confirm('Are you sure you want to reset all settings to defaults? This cannot be undone.')) {
      return;
    }

    setResetting(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/email-ai-settings/reset`, {
        method: 'POST'
      });

      if (!response.ok) {
        throw new Error('Failed to reset settings');
      }

      setSuccessMessage('Settings reset to defaults!');
      await fetchSettings();

      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setResetting(false);
    }
  };

  const handlePreview = async () => {
    setPreviewing(true);
    setError(null);
    setPreviewResult(null);

    try {
      // First save current settings
      await fetch(`${API_BASE}/api/email-ai-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      // Then get preview
      const response = await fetch(`${API_BASE}/api/email-ai-settings/preview`);
      const data = await response.json();

      if (data.success) {
        setPreviewResult(data.preview);
      } else {
        setError(data.error || 'Failed to generate preview');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPreviewing(false);
    }
  };

  const providerMeta = getProviderMeta(formData.ai_provider);

  const updateAIField = (field: 'ai_model' | 'ai_api_key' | 'ai_base_url', value: string) => {
    setTestResult(null);
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const selectProvider = (id: AIProviderId) => {
    if (id === formData.ai_provider) return;
    const meta = getProviderMeta(id);
    setTestResult(null);
    setCustomModel(false);
    setFormData(prev => ({ ...prev, ai_provider: id, ai_model: meta.defaultModel }));
  };

  const handleModelSelect = (value: string) => {
    if (value === '__custom__') {
      setCustomModel(true);
      updateAIField('ai_model', '');
    } else {
      setCustomModel(false);
      updateAIField('ai_model', value);
    }
  };

  const handleTestProvider = async () => {
    setTesting(true);
    setTestResult(null);
    const result = await testAIProvider({
      ai_provider: formData.ai_provider,
      ai_model: formData.ai_model,
      ai_api_key: formData.ai_api_key,
      ai_base_url: formData.ai_base_url
    });
    setTestResult(result);
    setTesting(false);
  };

  const copyPlaceholder = (placeholder: string) => {
    navigator.clipboard.writeText(placeholder);
    setSuccessMessage(`Copied: ${placeholder}`);
    setTimeout(() => setSuccessMessage(null), 2000);
  };

  // Available placeholders for the prompt
  const placeholders = [
    { key: '{company_name}', desc: 'Your company name' },
    { key: '{company_tagline}', desc: 'Your company tagline' },
    { key: '{company_services}', desc: 'List of services' },
    { key: '{sender_name}', desc: 'Email sender name' },
    { key: '{sender_title}', desc: 'Sender job title' },
    { key: '{sender_persona}', desc: 'Sender personality' },
    { key: '{sender_focus}', desc: 'Sender focus area' },
    { key: '{lead_name}', desc: 'Lead contact name' },
    { key: '{lead_company}', desc: 'Lead company name' },
    { key: '{lead_title}', desc: 'Lead job title' },
    { key: '{lead_industry}', desc: 'Lead industry' },
    { key: '{word_limit}', desc: 'Target word count' }
  ];

  // Check if user is admin
  if (!isAdmin) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
        <div className="text-center">
          <div className="text-red-500 text-5xl mb-4">&#128274;</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Admin Access Required</h2>
          <p className="text-gray-600">
            Only administrators can modify AI email settings.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">AI Email Settings</h2>
          <p className="text-gray-600 mt-1">
            Configure how AI generates personalized emails
          </p>
        </div>
        <button
          onClick={fetchSettings}
          className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <RefreshCw size={20} />
        </button>
      </div>

      {/* Messages */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3"
        >
          <XCircle className="text-red-500 flex-shrink-0 mt-0.5" size={20} />
          <div>
            <p className="text-red-700 font-medium">Error</p>
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        </motion.div>
      )}

      {successMessage && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3"
        >
          <CheckCircle className="text-green-500" size={20} />
          <p className="text-green-700">{successMessage}</p>
        </motion.div>
      )}

      {/* Migration Warning */}
      {settings?.error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-yellow-50 border border-yellow-200 rounded-lg p-4"
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="text-yellow-500 flex-shrink-0 mt-0.5" size={20} />
            <div>
              <p className="text-yellow-800 font-medium">Database Setup Required</p>
              <p className="text-yellow-700 text-sm mt-1">
                The email_ai_settings table doesn't exist yet. Run the migration:
              </p>
              <code className="block mt-2 bg-yellow-100 p-2 rounded text-xs text-yellow-800">
                backend/migrations/add_email_ai_settings.sql
              </code>
            </div>
          </div>
        </motion.div>
      )}

      {/* AI Provider Section */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-6 space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-indigo-100">
              <Cpu className="text-indigo-600" size={24} />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">AI Provider</h3>
              <p className="text-sm text-gray-600">Choose which AI service generates your emails</p>
            </div>
          </div>

          {/* Provider cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {AI_PROVIDERS.map((p) => {
              const selected = formData.ai_provider === p.id;
              const Icon = p.icon;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectProvider(p.id)}
                  className={`flex items-start gap-3 p-4 rounded-xl border text-left transition-colors ${
                    selected
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'border-gray-200 hover:border-primary/50 hover:bg-gray-50'
                  }`}
                >
                  <Icon
                    size={20}
                    className={`flex-shrink-0 mt-0.5 ${selected ? 'text-primary' : 'text-gray-400'}`}
                  />
                  <div className="min-w-0">
                    <p className={`text-sm font-medium ${selected ? 'text-primary' : 'text-gray-900'}`}>
                      {p.label}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">{p.description}</p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Conditional fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Model */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Model{providerMeta.id === 'claude-cli' && ' (optional)'}
                {providerMeta.modelRequired && ' *'}
              </label>
              {providerMeta.modelSuggestions.length > 0 ? (
                <div className="space-y-2">
                  <select
                    value={customModel ? '__custom__' : formData.ai_model}
                    onChange={(e) => handleModelSelect(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent bg-white"
                  >
                    {providerMeta.modelSuggestions.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                    <option value="__custom__">Custom…</option>
                  </select>
                  {customModel && (
                    <input
                      type="text"
                      value={formData.ai_model}
                      onChange={(e) => updateAIField('ai_model', e.target.value)}
                      placeholder="Enter model name"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                  )}
                </div>
              ) : (
                <input
                  type="text"
                  value={formData.ai_model}
                  onChange={(e) => updateAIField('ai_model', e.target.value)}
                  placeholder={providerMeta.modelPlaceholder}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                />
              )}
            </div>

            {/* API key */}
            {providerMeta.apiKey !== 'none' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  API Key{providerMeta.apiKey === 'optional' ? ' (optional)' : ' *'}
                </label>
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={formData.ai_api_key}
                    onChange={(e) => updateAIField('ai_api_key', e.target.value)}
                    placeholder={providerMeta.keyPlaceholder}
                    className="w-full px-4 py-2 pr-11 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                  >
                    {showApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            )}

            {/* Base URL (custom only) */}
            {providerMeta.showBaseUrl && (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Base URL *
                </label>
                <input
                  type="url"
                  value={formData.ai_base_url}
                  onChange={(e) => updateAIField('ai_base_url', e.target.value)}
                  placeholder="http://host.docker.internal:11434/v1"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                />
              </div>
            )}
          </div>

          <p className="text-xs text-gray-500">{providerMeta.note}</p>

          {/* Test connection */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleTestProvider}
              disabled={testing}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {testing ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <PlugZap size={18} />
              )}
              {testing ? 'Testing...' : 'Test connection'}
            </button>

            {testResult && testResult.success && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-50 border border-green-200 text-green-700 rounded-full text-sm font-medium">
                <CheckCircle size={14} />
                Connected
                {testResult.model ? ` · ${testResult.model}` : ''}
                {typeof testResult.latency_ms === 'number' ? ` · ${testResult.latency_ms}ms` : ''}
              </span>
            )}
            {testResult && !testResult.success && (
              <span className="inline-flex items-center gap-1.5 text-sm text-red-600">
                <XCircle size={14} className="flex-shrink-0" />
                {testResult.message}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="border-b border-gray-200">
          <nav className="flex">
            <button
              onClick={() => setActiveTab('company')}
              className={`flex items-center gap-2 px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'company'
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <Building2 size={18} />
              Company Info
            </button>
            <button
              onClick={() => setActiveTab('cta')}
              className={`flex items-center gap-2 px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'cta'
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <Link size={18} />
              CTA Links
            </button>
            <button
              onClick={() => setActiveTab('prompt')}
              className={`flex items-center gap-2 px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'prompt'
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <Sparkles size={18} />
              AI Prompt Template
            </button>
          </nav>
        </div>

        <div className="p-6">
          {/* Company Info Tab */}
          {activeTab === 'company' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-6"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 rounded-xl bg-blue-100">
                  <Building2 className="text-blue-600" size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Company Information</h3>
                  <p className="text-sm text-gray-600">Basic details about your company</p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Company Name *
                </label>
                <input
                  type="text"
                  value={formData.company_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, company_name: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                  placeholder="Your Company Name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Company Tagline
                </label>
                <input
                  type="text"
                  value={formData.company_tagline}
                  onChange={(e) => setFormData(prev => ({ ...prev, company_tagline: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                  placeholder="A short description of what you do"
                />
                <p className="text-xs text-gray-500 mt-1">
                  e.g., "Leading provider of automation solutions"
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Services / Products
                </label>
                <textarea
                  value={formData.company_services}
                  onChange={(e) => setFormData(prev => ({ ...prev, company_services: e.target.value }))}
                  rows={6}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent font-mono text-sm"
                  placeholder="- Service 1
- Service 2
- Service 3"
                />
                <p className="text-xs text-gray-500 mt-1">
                  List your main services or products, one per line. Use "-" prefix for bullet points.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Email Word Limit
                  </label>
                  <input
                    type="number"
                    value={formData.email_word_limit}
                    onChange={(e) => setFormData(prev => ({ ...prev, email_word_limit: parseInt(e.target.value) || 150 }))}
                    min={50}
                    max={500}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                  />
                  <p className="text-xs text-gray-500 mt-1">50-500 words</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Email Tone
                  </label>
                  <input
                    type="text"
                    value={formData.email_tone}
                    onChange={(e) => setFormData(prev => ({ ...prev, email_tone: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                    placeholder="professional but conversational"
                  />
                </div>
              </div>
            </motion.div>
          )}

          {/* CTA Links Tab */}
          {activeTab === 'cta' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-6"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 rounded-xl bg-green-100">
                  <Link className="text-green-600" size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Call-to-Action Links</h3>
                  <p className="text-sm text-gray-600">Links included in generated emails</p>
                </div>
              </div>

              {/* CTA Link 1 */}
              <div className="bg-gray-50 rounded-xl p-4">
                <h4 className="font-medium text-gray-900 mb-4">Primary CTA Link</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Button Label
                    </label>
                    <input
                      type="text"
                      value={formData.cta_link_1_label}
                      onChange={(e) => setFormData(prev => ({ ...prev, cta_link_1_label: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                      placeholder="Schedule a Call"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      URL
                    </label>
                    <input
                      type="url"
                      value={formData.cta_link_1_url}
                      onChange={(e) => setFormData(prev => ({ ...prev, cta_link_1_url: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                      placeholder="https://calendly.com/your-link"
                    />
                  </div>
                </div>
              </div>

              {/* CTA Link 2 */}
              <div className="bg-gray-50 rounded-xl p-4">
                <h4 className="font-medium text-gray-900 mb-4">Secondary CTA Link</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Button Label
                    </label>
                    <input
                      type="text"
                      value={formData.cta_link_2_label}
                      onChange={(e) => setFormData(prev => ({ ...prev, cta_link_2_label: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                      placeholder="Learn More"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      URL
                    </label>
                    <input
                      type="url"
                      value={formData.cta_link_2_url}
                      onChange={(e) => setFormData(prev => ({ ...prev, cta_link_2_url: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                      placeholder="https://www.your-website.com"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Info className="text-blue-500 flex-shrink-0 mt-0.5" size={18} />
                  <p className="text-sm text-blue-700">
                    These links will be included in the AI-generated emails. The primary CTA is typically a meeting booking link (Calendly, Cal.com, etc.), and the secondary is usually your website.
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {/* AI Prompt Template Tab */}
          {activeTab === 'prompt' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-6"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 rounded-xl bg-purple-100">
                  <Sparkles className="text-purple-600" size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">AI Prompt Template</h3>
                  <p className="text-sm text-gray-600">Advanced customization of the AI prompt</p>
                </div>
              </div>

              {/* Placeholders Reference */}
              <div className="bg-gray-50 rounded-xl p-4">
                <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                  <FileText size={16} />
                  Available Placeholders
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {placeholders.map((p) => (
                    <button
                      key={p.key}
                      onClick={() => copyPlaceholder(p.key)}
                      className="flex items-center justify-between gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg hover:border-primary hover:bg-primary/5 transition-colors text-left"
                    >
                      <div>
                        <code className="text-xs text-primary font-mono">{p.key}</code>
                        <p className="text-xs text-gray-500">{p.desc}</p>
                      </div>
                      <Copy size={14} className="text-gray-400" />
                    </button>
                  ))}
                </div>
              </div>

              {/* Template Editor */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Prompt Template
                </label>
                <textarea
                  value={formData.ai_prompt_template}
                  onChange={(e) => setFormData(prev => ({ ...prev, ai_prompt_template: e.target.value }))}
                  rows={20}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent font-mono text-sm leading-relaxed"
                  placeholder="Enter your AI prompt template..."
                />
                <p className="text-xs text-gray-500 mt-1">
                  Use the placeholders above to personalize emails. The AI will replace them with actual values.
                </p>
              </div>

              {/* Preview Section */}
              {previewResult && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                  <h4 className="font-medium text-green-800 mb-3 flex items-center gap-2">
                    <Eye size={16} />
                    Preview (with sample data)
                  </h4>
                  <pre className="whitespace-pre-wrap text-sm text-green-700 font-mono bg-white p-4 rounded-lg border border-green-200">
                    {previewResult}
                  </pre>
                </div>
              )}

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="text-yellow-500 flex-shrink-0 mt-0.5" size={18} />
                  <div>
                    <p className="text-sm text-yellow-800 font-medium">Advanced Feature</p>
                    <p className="text-sm text-yellow-700 mt-1">
                      Modifying the prompt template affects how AI generates all emails. Test thoroughly before using in production.
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="p-6 bg-gray-50 border-t border-gray-200">
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary flex items-center gap-2"
            >
              {saving ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Save size={18} />
              )}
              {saving ? 'Saving...' : 'Save Settings'}
            </button>

            {activeTab === 'prompt' && (
              <button
                onClick={handlePreview}
                disabled={previewing}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 transition-colors"
              >
                {previewing ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Eye size={18} />
                )}
                {previewing ? 'Generating...' : 'Preview Prompt'}
              </button>
            )}

            <button
              onClick={handleReset}
              disabled={resetting}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-100 transition-colors"
            >
              {resetting ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <RotateCcw size={18} />
              )}
              {resetting ? 'Resetting...' : 'Reset to Defaults'}
            </button>
          </div>
        </div>
      </div>

      {/* Last Updated Info */}
      {settings?.updated_at && (
        <p className="text-sm text-gray-500 text-center">
          Last updated: {new Date(settings.updated_at).toLocaleString()}
        </p>
      )}
    </div>
  );
}

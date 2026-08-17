/**
 * AI Provider metadata shared by the Settings page and the Setup Wizard.
 *
 * Backend contract:
 * - GET/PUT /api/email-ai-settings         -> ai_provider, ai_model, ai_api_key, ai_base_url
 * - POST /api/email-ai-settings/test-provider
 * - POST /api/setup/save                   -> aiProvider, aiModel, aiApiKey, aiBaseUrl
 */

import type { LucideIcon } from 'lucide-react';
import { Sparkles, Bot, Terminal, MessageSquare, Server } from 'lucide-react';

export type AIProviderId = 'gemini' | 'claude' | 'claude-cli' | 'openai' | 'custom';

export interface AIProviderMeta {
  id: AIProviderId;
  label: string;
  /** One-line description shown on the provider card */
  description: string;
  icon: LucideIcon;
  /** Whether the API key field is required, optional, or hidden */
  apiKey: 'required' | 'optional' | 'none';
  /** Model suggestions rendered as a select; empty = free-text input only */
  modelSuggestions: string[];
  /** Pre-selected model when this provider is chosen ('' = none/CLI default) */
  defaultModel: string;
  /** Whether a model value is required to proceed/save */
  modelRequired: boolean;
  /** Whether the Base URL field is shown */
  showBaseUrl: boolean;
  /** Helper note shown under the fields */
  note: string;
  keyPlaceholder: string;
  modelPlaceholder: string;
}

export const AI_PROVIDERS: AIProviderMeta[] = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    description: "Google's Gemini models via API key",
    icon: Sparkles,
    apiKey: 'required',
    modelSuggestions: ['gemini-flash-latest', 'gemini-pro-latest'],
    defaultModel: 'gemini-flash-latest',
    modelRequired: false,
    showBaseUrl: false,
    note: 'Get a free key at aistudio.google.com/apikey',
    keyPlaceholder: 'AIzaSy...',
    modelPlaceholder: 'gemini-flash-latest',
  },
  {
    id: 'claude',
    label: 'Claude (Anthropic API)',
    description: "Anthropic's Claude models via API key",
    icon: Bot,
    apiKey: 'required',
    modelSuggestions: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
    defaultModel: 'claude-opus-5',
    modelRequired: false,
    showBaseUrl: false,
    note: 'Get a key at platform.claude.com',
    keyPlaceholder: 'sk-ant-...',
    modelPlaceholder: 'claude-opus-5',
  },
  {
    id: 'claude-cli',
    label: 'Claude Code (local CLI)',
    description: 'Local claude CLI - no API key needed',
    icon: Terminal,
    apiKey: 'none',
    modelSuggestions: [],
    defaultModel: '',
    modelRequired: false,
    showBaseUrl: false,
    note: 'Uses the `claude` CLI on the backend machine — no API key needed. Works when the backend runs locally with Claude Code installed; NOT available inside Docker containers.',
    keyPlaceholder: '',
    modelPlaceholder: 'Leave blank for CLI default model',
  },
  {
    id: 'openai',
    label: 'ChatGPT (OpenAI)',
    description: 'OpenAI GPT models via API key',
    icon: MessageSquare,
    apiKey: 'required',
    modelSuggestions: ['gpt-4o'],
    defaultModel: 'gpt-4o',
    modelRequired: false,
    showBaseUrl: false,
    note: 'Get a key at platform.openai.com',
    keyPlaceholder: 'sk-...',
    modelPlaceholder: 'gpt-4o',
  },
  {
    id: 'custom',
    label: 'Custom / Local server',
    description: 'Any OpenAI-compatible endpoint',
    icon: Server,
    apiKey: 'optional',
    modelSuggestions: [],
    defaultModel: '',
    modelRequired: true,
    showBaseUrl: true,
    note: 'Any OpenAI-compatible endpoint: Ollama, LM Studio, open-webui, vLLM… Base URL example: http://host.docker.internal:11434/v1',
    keyPlaceholder: 'API key (if your server requires one)',
    modelPlaceholder: 'e.g. llama3.1:8b',
  },
];

export function getProviderMeta(id: string): AIProviderMeta {
  return AI_PROVIDERS.find((p) => p.id === id) ?? AI_PROVIDERS[0];
}

export interface TestProviderResult {
  success: boolean;
  message: string;
  provider?: string;
  model?: string;
  latency_ms?: number;
}

export interface TestProviderPayload {
  ai_provider: string;
  ai_model: string;
  ai_api_key: string;
  ai_base_url: string;
}

/**
 * Tests a provider configuration against the backend.
 * Never throws — errors are returned as { success: false, message }.
 */
export async function testAIProvider(payload: TestProviderPayload): Promise<TestProviderResult> {
  const apiBase: string = import.meta.env.VITE_API_URL || '';
  try {
    const response = await fetch(`${apiBase}/api/email-ai-settings/test-provider`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data: TestProviderResult & { detail?: string } = await response.json();
    if (!response.ok) {
      return {
        success: false,
        message: data.detail || data.message || `Request failed (${response.status})`,
      };
    }
    return data;
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : 'Could not reach the backend',
    };
  }
}

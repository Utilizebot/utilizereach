"""
Multi-provider LLM client for AI email generation.

Supported providers:
  - gemini      Google Gemini (existing GeminiClient)
  - claude      Anthropic Claude API (official anthropic SDK)
  - claude-cli  Local Claude Code CLI (`claude -p ...`) — no API key needed;
                great for local testing. Only works where the CLI is installed
                (not inside Docker containers).
  - openai      OpenAI ChatGPT (chat completions API)
  - custom      Any OpenAI-compatible endpoint (Ollama, LM Studio, open-webui,
                vLLM, ...) via base_url

Provider/model/key are configured in the email_ai_settings table (Settings →
Email AI in the UI, or the Setup Wizard), with environment variables as
fallback. All providers expose the same generate_email() contract the rest of
the backend already uses.
"""

import os
import json
import shutil
import subprocess
from typing import Dict, Optional, Tuple

import httpx

from .gemini_client import GeminiClient

PROVIDERS = ("gemini", "claude", "claude-cli", "openai", "custom")

DEFAULT_MODELS = {
    "gemini": "gemini-flash-latest",
    "claude": "claude-opus-5",
    "claude-cli": "",  # CLI default (user's configured model)
    "openai": "gpt-4o",
    "custom": "",  # must be supplied by the user
}

# USD per 1M tokens (input, output) for cost estimates; unknown models -> 0
CLAUDE_PRICES = {
    "claude-fable-5": (10.0, 50.0),
    "claude-opus-5": (5.0, 25.0),
    "claude-opus-4-8": (5.0, 25.0),
    "claude-opus-4-7": (5.0, 25.0),
    "claude-opus-4-6": (5.0, 25.0),
    "claude-sonnet-5": (3.0, 15.0),
    "claude-sonnet-4-6": (3.0, 15.0),
    "claude-haiku-4-5": (1.0, 5.0),
}

ENV_KEYS = {
    "gemini": "GEMINI_API_KEY",
    "claude": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
    "custom": "CUSTOM_LLM_API_KEY",
}


class LLMClient:
    """Provider-agnostic email generation client."""

    def __init__(
        self,
        provider: str = "gemini",
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        base_url: Optional[str] = None,
    ):
        provider = (provider or "gemini").strip().lower()
        if provider not in PROVIDERS:
            raise ValueError(f"Unknown AI provider: {provider!r}. Valid: {', '.join(PROVIDERS)}")

        self.provider = provider
        self.model = (model or "").strip() or DEFAULT_MODELS[provider]
        self.base_url = (base_url or "").strip().rstrip("/")
        self.api_key = (api_key or "").strip() or os.getenv(ENV_KEYS.get(provider, ""), "")

        if provider == "gemini":
            self._gemini = GeminiClient(api_key=self.api_key or None)
        elif provider == "claude":
            if not self.api_key:
                raise ValueError("Claude provider needs an API key (settings or ANTHROPIC_API_KEY)")
            import anthropic
            self._anthropic = anthropic.Anthropic(api_key=self.api_key)
        elif provider == "claude-cli":
            self._claude_bin = shutil.which("claude")
            if not self._claude_bin:
                raise ValueError(
                    "Claude Code CLI not found on this machine. The 'claude-cli' provider "
                    "only works when the backend runs where Claude Code is installed "
                    "(e.g. local dev, not Docker). Use 'claude' with an API key instead."
                )
        elif provider == "custom":
            if not self.base_url:
                raise ValueError("Custom provider needs a Base URL (OpenAI-compatible endpoint)")
            if not self.model:
                raise ValueError("Custom provider needs a model name")
        elif provider == "openai":
            if not self.api_key:
                raise ValueError("OpenAI provider needs an API key (settings or OPENAI_API_KEY)")

    # ------------------------------------------------------------------
    # Raw completion per provider
    # ------------------------------------------------------------------

    def _complete(self, prompt: str, max_tokens: int = 4096) -> Tuple[str, Dict]:
        """Run one prompt, return (text, {'input': n, 'output': n})."""
        if self.provider == "gemini":
            response = self._gemini.model.generate_content(prompt)
            usage = {"input": 0, "output": 0}
            try:
                usage = {
                    "input": response.usage_metadata.prompt_token_count,
                    "output": response.usage_metadata.candidates_token_count,
                }
            except Exception:
                pass
            return response.text, usage

        if self.provider == "claude":
            # Server-side refusal fallback enabled by default: if Claude's safety
            # classifiers decline a request, the API retries it on the recommended
            # fallback model in the same call instead of returning an empty result.
            response = self._anthropic.beta.messages.create(
                model=self.model,
                max_tokens=max_tokens,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                messages=[{"role": "user", "content": prompt}],
            )
            if response.stop_reason == "refusal":
                detail = ""
                if getattr(response, "stop_details", None):
                    detail = f" ({response.stop_details.category})"
                raise Exception(f"Claude declined this request{detail}")
            text = "".join(b.text for b in response.content if b.type == "text")
            return text, {
                "input": response.usage.input_tokens,
                "output": response.usage.output_tokens,
            }

        if self.provider == "claude-cli":
            cmd = [self._claude_bin, "-p", prompt, "--output-format", "text"]
            if self.model:
                cmd += ["--model", self.model]
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=300,
                env={**os.environ, "CLAUDE_CODE_NONINTERACTIVE": "1"},
            )
            if result.returncode != 0:
                raise Exception(f"claude CLI failed: {(result.stderr or result.stdout)[:500]}")
            return result.stdout.strip(), {"input": 0, "output": 0}

        # openai / custom: OpenAI-compatible chat completions
        url = (self.base_url or "https://api.openai.com/v1") + "/chat/completions"
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "max_completion_tokens": max_tokens,
        }
        with httpx.Client(timeout=180) as client:
            resp = client.post(url, headers=headers, json=payload)
            if resp.status_code == 400 and "max_completion_tokens" in resp.text:
                # older OpenAI-compatible servers only know max_tokens
                payload.pop("max_completion_tokens")
                payload["max_tokens"] = max_tokens
                resp = client.post(url, headers=headers, json=payload)
            if resp.status_code != 200:
                raise Exception(f"LLM API error {resp.status_code}: {resp.text[:500]}")
            data = resp.json()
        text = data["choices"][0]["message"]["content"] or ""
        usage_raw = data.get("usage") or {}
        return text, {
            "input": usage_raw.get("prompt_tokens", 0),
            "output": usage_raw.get("completion_tokens", 0),
        }

    def _estimate_cost(self, usage: Dict) -> float:
        if self.provider == "gemini":
            prices = (0.075, 0.30)
        elif self.provider == "claude":
            prices = CLAUDE_PRICES.get(self.model, (0.0, 0.0))
        else:
            return 0.0
        return round(
            usage.get("input", 0) / 1_000_000 * prices[0]
            + usage.get("output", 0) / 1_000_000 * prices[1],
            6,
        )

    # ------------------------------------------------------------------
    # Public interface (same contract the backend already uses)
    # ------------------------------------------------------------------

    def generate_email(
        self,
        user_prompt: str,
        lead_data: Dict,
        company_research: Optional[str] = None,
        cta_links: Optional[Dict[str, str]] = None,
        sender_name: Optional[str] = None,
    ) -> Dict:
        """Generate a personalized email. Returns the same dict shape as
        GeminiClient.generate_email (subject, body_html, body_text,
        generation_cost, tokens_used)."""
        if self.provider == "gemini":
            return self._gemini.generate_email(
                user_prompt, lead_data, company_research, cta_links, sender_name
            )

        prompt = GeminiClient._build_email_prompt(
            user_prompt, lead_data, company_research, cta_links, sender_name
        )
        try:
            text, usage = self._complete(prompt)
            email_content = GeminiClient._parse_email_response(text)
        except Exception as e:
            raise Exception(f"Failed to generate email ({self.provider}): {e}")

        return {
            "subject": email_content["subject"],
            "body_html": email_content["body_html"],
            "body_text": email_content["body_text"],
            "generation_cost": self._estimate_cost(usage),
            "tokens_used": {
                "input": usage.get("input", 0),
                "output": usage.get("output", 0),
                "total": usage.get("input", 0) + usage.get("output", 0),
            },
        }

    def test_connection(self) -> Tuple[bool, str]:
        """Cheap round-trip to verify the provider works."""
        try:
            text, _ = self._complete("Reply with exactly: OK", max_tokens=1100)
            if "OK" in text.upper():
                return True, f"{self.provider} connection OK (model: {self.model or 'default'})"
            return True, f"{self.provider} responded (model: {self.model or 'default'}): {text[:80]}"
        except Exception as e:
            return False, str(e)


def get_llm_client() -> LLMClient:
    """Build an LLMClient from email_ai_settings (DB), falling back to env.

    Env fallbacks: AI_PROVIDER, AI_MODEL, AI_BASE_URL, plus the per-provider
    key vars (GEMINI_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY).
    """
    provider = os.getenv("AI_PROVIDER", "")
    model = os.getenv("AI_MODEL", "")
    api_key = ""
    base_url = os.getenv("AI_BASE_URL", "")

    try:
        from database.client import get_supabase_admin_client
        row = (
            get_supabase_admin_client()
            .table("email_ai_settings")
            .select("*")
            .limit(1)
            .execute()
        )
        if row.data:
            settings = row.data[0]
            provider = settings.get("ai_provider") or provider
            model = settings.get("ai_model") or model
            api_key = settings.get("ai_api_key") or api_key
            base_url = settings.get("ai_base_url") or base_url
    except Exception as e:
        print(f"[llm_client] Could not read email_ai_settings, using env: {e}")

    return LLMClient(
        provider=provider or "gemini",
        api_key=api_key or None,
        model=model or None,
        base_url=base_url or None,
    )

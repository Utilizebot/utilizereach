# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

## [1.0.0] - 2026-08-18

Initial public, source-available release of UtilizeReach.

### Added

- Search-driven lead scraper (SerpAPI) plus CSV/Excel import for building lead lists.
- Modular lead segments for organizing and targeting contacts.
- AI-written, personalized emails with a choice of LLM provider (Claude, Gemini, OpenAI, or any OpenAI-compatible endpoint such as Ollama).
- Multi-persona sending through the Gmail API using send-as aliases.
- Paced warm-up sender with optional automatic ramp-up.
- Campaigns with A/B variants and multi-step follow-up sequences.
- Open, click, and thread-based reply tracking, with automatic bounce quarantine so undelivered mail never counts as engagement.
- One-click unsubscribe and exclusion lists for compliant, permission-based outreach.
- Period-aware analytics covering deliverability, the engagement funnel, and per-persona, per-segment, and per-campaign breakdowns.
- Config-driven public lead-capture forms with UTM attribution.
- Multi-user support with a guided setup wizard.
- Docker Compose deployment for self-hosting the full stack.

[Unreleased]: https://github.com/Utilizebot/utilizereach/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Utilizebot/utilizereach/releases/tag/v1.0.0

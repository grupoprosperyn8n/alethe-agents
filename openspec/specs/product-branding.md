# product-branding

- **id**: product-branding
- **title**: User-visible rebranding from "Alethe" to "SO Multi Agente"
- **status**: draft

## Purpose

Remove all user-visible "Alethe" naming and replace it with "SO Multi Agente" across the UI, remote web surface, i18n locales, backend user-facing strings, release workflow, and docs — without altering persistence contracts or internal protocols.

## Requirements

### REQ-BRAND-1: UI product naming

User-visible UI elements MUST display "SO Multi Agente": the App.tsx wordmark, the PRODUCT_NAME constant in WelcomeModal, the OnboardingModal logo and alt text, and the backup file name in ProfilesModal.

#### Scenario: Wordmark and product name render

- GIVEN the app is launched with the new branding
- WHEN the user views the main window, welcome, onboarding, and profiles UI
- THEN every visible "Alethe" product-name occurrence reads "SO Multi Agente"

#### Scenario: No UI residue

- WHEN the UI layer is scanned for "Alethe"
- THEN zero user-visible product-name hits remain

### REQ-BRAND-2: i18n strings across all locales

Every i18n string containing "Alethe" MUST use "SO Multi Agente" in all three locales (en, es, pt-BR), preserving each locale's language and phrasing.

#### Scenario: All locales updated

- GIVEN the i18n message files for en, es, and pt-BR
- WHEN each file is scanned for "Alethe"
- THEN all product-name strings (~40 per locale) read "SO Multi Agente" and no locale is left behind

#### Scenario: Locale language preserved

- GIVEN the es locale string "Trabajando con Alethe" (discord.workingWithAlethe)
- WHEN the string is updated
- THEN it reads "Trabajando con SO Multi Agente" in Spanish, not an English replacement

### REQ-BRAND-3: Remote web surface

The remote companion surface MUST present "SO Multi Agente": index.html title, manifest.webmanifest name/short_name, and the app.js strings "Alethe remoto" and "Conectando con Alethe".

#### Scenario: Remote page renders new name

- GIVEN a remote session serving index.html, manifest.webmanifest, and app.js
- WHEN the page and manifest are inspected
- THEN title, manifest entries, and connection-status strings use "SO Multi Agente"

### REQ-BRAND-4: Backend user-visible strings

Rust-side user-visible strings MUST use "SO Multi Agente": the window title in lib.rs, GIST_DESCRIPTION and USER_AGENT in github_sync.rs, Discord presence large_text in discord_presence.rs, the cloned briefing in projects.rs, and the strings in spotify.rs, codex_app_server.rs, codex_usage.rs, antigravity_usage.rs, and the TODO template in filesystem.rs.

#### Scenario: Backend strings branded

- WHEN the listed Rust modules are scanned for "Alethe"
- THEN all user-visible occurrences read "SO Multi Agente"

### REQ-BRAND-5: Release workflow naming

The GitHub release workflow MUST publish releases named "SO Multi Agente": releaseName and releaseBody in release.yml.

#### Scenario: Release naming

- GIVEN the release workflow file
- WHEN release metadata is generated
- THEN releaseName and releaseBody reference "SO Multi Agente"

### REQ-BRAND-6: Documentation branding

User-facing docs MUST use "SO Multi Agente": README, CONTRIBUTING, SHOWCASE, and docs/*.md (OVERVIEW, FEATURES, THEMES, BRAND, HANDOFF, DIAGNOSTICO).

#### Scenario: Docs updated

- GIVEN the repository documentation
- WHEN the listed docs are scanned for product-name "Alethe"
- THEN all user-facing references read "SO Multi Agente"

## Non-Goals

- Updater endpoints (alethe-agents repo) and the CLI command/shim "alethe"
- Persistence contracts: .alethe/ directory, alethe/* branches, GSD plugin paths and markers, themeIcons persisted values, telemetry keys, ALETHE_* env vars, ghostty FFI symbols
- Custom internal events (alethe:*) and the internal crate rename (alethe_lib) — pending owner decision
- TRADEMARK.md, historical CHANGELOG, discord-notify webhooks
- themeIcons/AppearancePage label renaming — pending owner confirmation

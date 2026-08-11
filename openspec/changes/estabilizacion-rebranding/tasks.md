# Tasks: estabilizacion-rebranding (Alethe → SO Multi Agente)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~530 (480–580) |
| 400-line budget risk | High |
| 800-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (tooling TDD) → PR 2 (rebranding) → PR 3 (verify) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High
800-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | T1+T2 tooling fixes with tests | PR 1 | ~320 lines; base = main or feature branch; npm test + test:rust green |
| 2 | T3–T7 rebranding layers | PR 2 | ~200 lines; stacked on PR 1 or independent |
| 3 | T8 verification | PR 3 | report-only; grep + checklist |

## Phase 1 — Tooling (TDD)

### 1.1 (T1) — Extract pure release lib + vitest tests

**Description**: Create `scripts/release-lib.mjs` (pure ESM, no side effects): `CRATE_RE = /name = "so-multi-agente"\r?\nversion = "(\d+\.\d+\.\d+)"/`, `findCrateVersion(lockContent)`, `computeNextVersion(current, bump)` (throws on invalid), `validateSources({pkg,tauri,cargo,lock})` (throws per-file before any write). RED first: `scripts/release-lib.test.mjs` (vitest). Adapt `scripts/release.mjs:47-82` to use the lib; drop inline regex `name = "alethe"` (line 80) and update comment (line 77). Extend `vitest.config.ts:9` include with `scripts/**/*.test.mjs`.

**Definition of done**: `npm test` green with new cases — crate match, null on legacy `alethe` block, computeNextVersion (patch/minor/major/explicit/invalid), validateSources fails on missing crate (REQ-REL-1); `node scripts/release.mjs --dry-run` on clean tree completes and tree stays clean (REQ-REL-2/3).

**estimated_lines**: ~210

### 1.2 (T2) — stats.rs pure classifier + Rust tests

**Description**: In `src-tauri/src/stats.rs`: add `enum ProcessClass {App, Webview, Pty}` and pure `fn classify_process(pid, root_pid, name, own_names) -> ProcessClass`; add `fn own_process_names() -> Vec<String>` from `std::env::current_exe()` file_name+stem (lowercased); replace inline filter at `stats.rs:66` (`name.contains("alethe")`) with the classifier, keeping `*pid == root_pid` and `contains("ensemble")` (D9/D10). RED first: `mod tests` in-module (repo pattern). Enumeration-failure path unchanged (Option + `continue`, lines 61-63).

**Definition of done**: `npm run test:rust` green — root→App; `so-multi-agente`→App; legacy `alethe`→Pty (REQ-STATS-1); `msedgewebview2`→Webview; CLI shim→Pty; `own_process_names()` non-empty (REQ-STATS-2).

**estimated_lines**: ~110

## Phase 2 — Rebranding by layer

### 2.1 (T3) — i18n values (en/es/pt-BR)

**Description**: `src/lib/i18n/messages/{en,es,pt-BR}.ts`: replace `Alethe`→`SO Multi Agente` in VALUES only (37/36/37 hits), keys untouched; preserve each locale's phrasing incl. pt-BR articles ("A Alethe"→"O SO Multi Agente", REQ-BRAND-2). DO NOT touch `home.quickTerminalTitle` (stays `alethe@workspace:~`).

**Definition of done**: `grep -c "Alethe"` = 0 in the 3 files; i18n key-parity tests pass; `npm run build` OK.

**estimated_lines**: ~110

### 2.2 (T4) — UI wordmark, modals, assets

**Description**: `src/App.tsx:101` loadingWordmark → "SO Multi Agente"; `src/components/modals/WelcomeModal.tsx:11` `PRODUCT_NAME`; rename `src/assets/alethe-logo.png` → `so-multi-agente-logo.png` + import/alt in `OnboardingModal.tsx:5` (D2); `ProfilesModal.tsx:215` backup `defaultPath` → `so-multi-agente-${name}-backup.zip`; `AppearancePage.tsx:63-64` labels → "Blue Gradient"/"Pink Gradient" (persisted VALUES `alethe-blue-gradient`/`alethe-pink-gradient` unchanged, D3).

**Definition of done**: `npm run build` OK; `grep -rn "Alethe"` = 0 in the 5 files; no persisted-value changes (`types.ts:67` intact); `alethe-mark.svg`/`alethe-loading-mark.png` untouched (0 refs).

**estimated_lines**: ~25

### 2.3 (T5) — Remote web surface

**Description**: `src-tauri/remote/index.html` title (2 hits), `manifest.webmanifest` name/short_name/description (3), `app.js` "Alethe remoto" + "Conectando con Alethe" (3) → "SO Multi Agente" (REQ-BRAND-3).

**Definition of done**: `grep -c "Alethe"` = 0 in the 3 files.

**estimated_lines**: ~12

### 2.4 (T6) — Rust backend user-visible strings

**Description**: `src-tauri/src/lib.rs` window title (3 hits; internal comments/`expect` at 158/203/420 only if user-visible — check); `github_sync.rs` GIST_DESCRIPTION + USER_AGENT (2); `discord_presence.rs` large_text (1); `projects.rs` `join("Alethe")` → `join("SO Multi Agente")` + comment (4 hits, D11 — absolute paths, no migration); `spotify.rs` (1); `codex_app_server.rs` (1); `codex_usage.rs:92` clientInfo.name "alethe" → "so-multi-agente"; `antigravity_usage.rs:99` User-Agent; `filesystem.rs` TODO template CONTENT only — `TODO_TEMPLATE_FILE` name (line 9) NOT renamed (D12). Verify `remote.rs` has 0 hits.

**Definition of done**: `npm run test:rust` green; grep "Alethe" = 0 in listed modules (user-visible); non-goals untouched: events `alethe:*`, `from_alethe`, `.alethe/`, `ALETHE_*`, template filename (D4/D13).

**estimated_lines**: ~20

### 2.5 (T7) — Workflow + docs

**Description**: `.github/workflows/release.yml:73-74` releaseName/releaseBody → "SO Multi Agente" (REQ-BRAND-5); README.md (2), CONTRIBUTING.md (8), SHOWCASE.md (5), docs/OVERVIEW.md (4), docs/FEATURES.md (3), docs/THEMES.md (3), docs/BRAND.md (2), docs/HANDOFF_SESSAO_ATUAL.md, docs/DIAGNOSTICO_MATURIDADE_TECNICA.md (mechanical, REQ-BRAND-6). EXCLUDE TRADEMARK.md; `docs/CHANGELOG.md` only add entry under [Não lançado] (19 historical hits stay).

**Definition of done**: grep "Alethe" = 0 in listed files (except TRADEMARK.md + CHANGELOG histórico); CHANGELOG entry added.

**estimated_lines**: ~35

## Phase 3 — Verification

### 3.1 (T8) — Full verification + residual grep

**Description**: Run `npm run build`; `npm test` (148 FE); `npm run test:rust` (121 BE); `node scripts/release.mjs --dry-run`; residual grep for `Alethe|freebuff|mimo` in user-visible code/docs with the design exclusion checklist (design §Migration): persistence contracts, TRADEMARK.md, raster assets/screenshots, CHANGELOG histórico, events `alethe:*`, `from_alethe`, `.alethe/`, test fixtures (paths.test.ts:59, agentLibrary.test.ts:5), quickTerminalTitle.

**Definition of done**: all suites green; dry-run passes on clean tree; 0 un-excluded grep hits; mark task checkboxes; report for verify phase.

**estimated_lines**: ~5

## Status (updated by sdd-apply)

All 8 tasks complete — 2026-08-11:

- [x] 1.1 (T1) — Extract pure release lib + vitest tests
- [x] 1.2 (T2) — stats.rs pure classifier + Rust tests
- [x] 2.1 (T3) — i18n values (en/es/pt-BR)
- [x] 2.2 (T4) — UI wordmark, modals, assets
- [x] 2.3 (T5) — Remote web surface
- [x] 2.4 (T6) — Rust backend user-visible strings
- [x] 2.5 (T7) — Workflow + docs
- [x] 3.1 (T8) — Full verification + residual grep

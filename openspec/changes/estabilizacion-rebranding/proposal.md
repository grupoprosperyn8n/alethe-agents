# Propuesta: estabilizacion-rebranding (Alethe → SO Multi Agente)

## Intent

El producto ya se llama "SO Multi Agente" (ff96020 + i18n ES en 8e0f05b), pero persisten restos user-visible de "Alethe" (UI, remote/, i18n, docs) y dos bugs rompen el flujo de release: release.mjs no matchea el crate renombrado en Cargo.lock, y stats.rs no cuenta el proceso propio en app_bytes. Objetivo: completar el rebranding sin tocar contratos de persistencia y estabilizar build/release.

## Scope

### In Scope
- Fix scripts/release.mjs: regex `name = "alethe"` → `so-multi-agente` + verificación
- Fix src-tauri/src/stats.rs:66: app_bytes debe incluir el binario propio
- Rebranding user-visible: src/App.tsx (wordmark), WelcomeModal.tsx, OnboardingModal.tsx, ProfilesModal.tsx, src-tauri/remote/ (index.html, manifest.webmanifest, app.js), src-tauri/src/lib.rs (título ventana), release.yml (releaseName), módulos Rust (github_sync, discord_presence, projects, spotify, codex_app_server, codex_usage, antigravity_usage, filesystem), docs (README, CONTRIBUTING, SHOWCASE, docs/*)
- i18n es/en/pt-BR: ~40 strings/locale con "Alethe"

### Out of Scope
- Updater endpoints (alethe-agents); comando CLI 'alethe' y home.quickTerminalTitle; contratos de persistencia (.alethe/, branches alethe/*, plugin GSD, themeIcons values, telemetry keys, FFI ghostty, env ALETHE_*); TRADEMARK.md; freebuff/mimo (ya eliminado en 4932821)

## Capabilities

### New Capabilities
- product-branding: naming user-visible sin "Alethe" (UI, remote, i18n, docs)
- release-process: release.mjs parsea `so-multi-agente` y pasa dry-run
- system-stats: app_bytes incluye el proceso propio

### Modified Capabilities
None — openspec/specs/ está vacío; no hay capabilities existentes que modificar.

## Approach

Tres frentes: (1) fixes de tooling con verificación (dry-run de release.mjs, test para stats.rs); (2) rebranding por capas — frontend/i18n, remote/, backend Rust, workflows y docs — solo strings user-visible, respetando exclusiones; (3) verificación final: build, 148 tests FE, cargo test y grep residual de "Alethe" con checklist de exclusión. Renombrar alethe-todo.template.jsonc solo tras chequear referencias.

## Impact

| Área | Impacto | Descripción |
|------|---------|-------------|
| scripts/release.mjs | Mod | regex Cargo.lock → so-multi-agente |
| src-tauri/src/stats.rs | Mod | app_bytes incluye binario propio |
| src/App.tsx, modals/ | Mod | wordmark, PRODUCT_NAME, logo/alt, backup name |
| src-tauri/remote/ | Mod | título, manifest, strings app.js |
| src/lib/i18n/messages/* | Mod | ~40 strings/locale |
| src-tauri/src/lib.rs + 8 módulos | Mod | título ventana, GIST, UA, briefings, template |
| .github/workflows/release.yml | Mod | releaseName |
| docs/* | Mod | README, CONTRIBUTING, SHOWCASE, docs/*.md |

## Risks

| Riesgo | Prob. | Mitigación |
|--------|-------|------------|
| Renombrar contratos por error | Med | checklist de exclusión + grep dirigido |
| stats.rs altera medición | Baja | test unitario del conteo |
| i18n incompleta en algún locale | Baja | revisión por locale + build |

## Rollback Plan

Git revert de los commits del change. Sin migraciones ni cambios de contrato, el rollback es total y seguro; release.mjs/stats.rs son cambios locales sin datos.

## Dependencies

Base limpia ya commiteada (8e0f05b, 4932821, 5d5f597). Decisiones del dueño ya fijadas (alcance/exclusiones).

## Success Criteria

- [ ] npm run build + npm test (148) + npm run test:rust OK
- [ ] release.mjs --dry-run OK con Cargo.lock so-multi-agente
- [ ] 0 hits "Alethe" user-visible (grep excluyendo contratos/TRADEMARK)
- [ ] stats.rs: app_bytes incluye el proceso propio

## Decisiones pendientes

- Labels de themeIcons.ts/AppearancePage: explore lo propuso, fuera del alcance acordado → confirmar
- Renombrado interno alethe_lib (Cargo.toml): mecánico, no acordado
- Chequear referencias de alethe-todo.template.jsonc antes de renombrar

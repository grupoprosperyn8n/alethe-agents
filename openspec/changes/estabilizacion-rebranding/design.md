# Design: estabilizacion-rebranding (Alethe → SO Multi Agente)

## Technical Approach

Tres frentes mecánicos, sin refactors de oportunidad: (1) **product-branding** — reemplazo de strings user-visible `Alethe` → `SO Multi Agente` en i18n (3 locales), UI, remote/, backend Rust y docs, respetando contratos de persistencia y protocolos internos; (2) **release-process** — regex de Cargo.lock corregido + validación temprana antes de escribir; (3) **system-stats** — clasificador de procesos extraído a función pura testeable, con nombre propio derivado de `current_exe()` en runtime (no constante hardcodeada). Verificación final: build, 148 tests FE, `cargo test --lib`, `release.mjs --dry-run`, grep residual con checklist de exclusión.

## Architecture Decisions

| # | Decisión | Opciones | Elección / Rationale |
|---|----------|----------|----------------------|
| D1 | **Estrategia i18n** | (a) reemplazo en valores, (b) renombrar keys | **(a)** — reemplazar `Alethe`→`SO Multi Agente` en los VALORES de en/es/pt-BR (~40/locale). Las keys NO cambian (son referenciadas por `t()`; renombrarlas rompe tipado y tests de paridad). Preservar la lengua de cada locale (REQ-BRAND-2): atención a artículos gramaticales en pt-BR ("A Alethe" → "O SO Multi Agente"). `home.quickTerminalTitle` NO se toca (decisión del dueño: queda `alethe@workspace:~`). |
| D2 | **Asset OnboardingModal** | (a) renombrar archivo, (b) solo alt | **(a) renombrar** `src/assets/alethe-logo.png` → `so-multi-agente-logo.png` + import y `alt="Alethe"`→`alt="SO Multi Agente"`. Verificado: el archivo solo se referencia desde OnboardingModal.tsx:5 y NO está persistido (el default de foto es `theme-icons/dark.png`, profile.ts:2). `alethe-mark.svg` y `alethe-loading-mark.png` tienen 0 referencias en src → no renombrar (cero impacto, sin uso). |
| D3 | **themeIcons labels** | (a) cambiar labels visibles, (b) non-goal | **(a) cambiar SOLO los labels** de AppearancePage.tsx:63-64 → "Blue Gradient"/"Pink Gradient". Los VALUES `alethe-blue-gradient`/`alethe-pink-gradient` están persistidos en prefs (types.ts:67) y NO cambian — tampoco los archivos `.png` ni el map de themeIcons.ts. Trivial (2 literales), sin migración, sin tests afectados. |
| D4 | **Eventos `alethe:`** | (a) renombrar, (b) non-goal | **(b) NON-GOAL, documentado**. 4 eventos custom FE + 2 canales IPC (`alethe://open-path` cli.ts/cli_launch.rs, `alethe://event-bus` event_bus.rs) + `from_alethe` (serializado en metadata de agentes = contrato). Cero impacto user-visible, renombrado requiere front+back sincronizados sin tests que lo cubran; un miss rompe IPC en silencio. Diferir a un change de limpieza de protocolo. |
| D5 | **Docs** | — | README.md, CONTRIBUTING.md, SHOWCASE.md + docs/{OVERVIEW,FEATURES,THEMES,BRAND,HANDOFF,DIAGNOSTICO}.md → reemplazo mecánico. EXCLUIDOS: TRADEMARK.md (spec), docs/CHANGELOG.md (solo AGREGAR entrada en [Não lançado], histórico intacto — 29 hits históricos quedan), screenshots/assets raster (no editables mecánicamente). |
| D6 | **release.mjs regex** | — | Línea 80: `/name = "alethe"\r?\nversion = .../` → `/name = "so-multi-agente"\r?\nversion = .../` + comentario línea 77. Cargo.lock ya tiene el entry (línea 4382). |
| D7 | **release.mjs abort temprano** | (a) validar antes de escribir, (b) status quo | **(a)** — hoy `bumpFile` escribe PKG/TAURI/CARGO y recién después falla en LOCK (estado parcial en run real). REQ-REL-1 exige abort ANTES de reescribir. Diseño: fase de validación pura (extraer versión de los 4 archivos con sus regex) que falla con mensaje explícito por archivo, luego fase de escritura. |
| D8 | **release.mjs testeable** | (a) extraer lib pura + vitest, (b) node --test, (c) solo dry-run manual | **(a)** — extraer `computeNextVersion`, `findCrateVersion`, `validateSources` a `scripts/release-lib.mjs` (sin side effects) + `scripts/release-lib.test.mjs` con vitest, ampliando `include` de vitest.config.ts (1 línea). Mantiene UN runner (`npm test`, strict TDD). El CLI (git/write/push) queda en release.mjs y se verifica con `--dry-run` (REQ-REL-2/3). |
| D9 | **stats.rs filtro** | (a) constante `"so-multi-agente"`, (b) `std::env::current_exe()` | **(b) runtime-derived** — nombre esperado = file_name (+stem) de `current_exe()`, match EXACTO case-insensitive. Robusto ante futuros renames, y por ser exacto NO cuenta procesos legacy `alethe` (REQ-STATS-1) ni el shim CLI. Se conserva `*pid == root_pid` (garantiza app_bytes > 0, REQ-STATS-2) y `contains("ensemble")` (ajeno al rename). |
| D10 | **Clasificador testeable** | — | Extraer `classify_process(pid, root_pid, name, own_names) -> App|Webview|Pty` como función pura; `collect_memory_stats()` la usa. Tests unitarios in-module (patrón del repo). El manejo de fallo de enumeración ya es no-pánico (Option + `continue`, línea 61-63) — sin cambio de API. |
| D11 | **projects.rs dir clonado** | (a) cambiar `join("Alethe")`, (b) dejar | **(a) cambiar** → `join("SO Multi Agente")`: es user-visible (path de clones NUEVOS); projects.json guarda rutas absolutas → cero migración, proyectos existentes intactos. Comentario línea 177 se actualiza. |
| D12 | **TODO template file** | (a) renombrar, (b) solo contenido | **(b)** — `TODO_TEMPLATE_FILE = "alethe-todo.template.jsonc"` (filesystem.rs:9) es un archivo ESCRITO en el data dir del usuario: renombrarlo orfana templates existentes sin migración. Solo cambia el contenido `"// Alethe Todo template"` → `"// SO Multi Agente Todo template"`. |
| D13 | **Identificadores internos** | — | NON-GOAL: `id="alethe-todo-sidebar"` (App.tsx:430 + CSS), `alethe_lib` (Cargo.toml [lib], decisión pendiente del dueño), ghostty FFI, GSD markers, telemetry keys, `ALETHE_*` env, CLI shim `alethe` — contratos/out-of-scope ya fijados. |

## Data Flow

**release.mjs (flujo nuevo):**
```
parse args → git-clean check → validateSources(PKG,TAURI,CARGO,LOCK) ──✗→ fail() sin escribir
                                          │ ✓
                                          ▼
                  computeNextVersion → bumpFile×4 (escribe) → commit/tag/push (skip en dry-run)
```

**stats.rs (clasificación por proceso del subtree):**
```
visited (BFS desde root_pid) → por pid: classify_process(pid, root_pid, name, own_names)
   pid==root ─┐
   name ∈ own_names (current_exe) ─┴→ App      msedgewebview2 → Webview      resto → Pty
```

## File Changes

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `src/lib/i18n/messages/{en,es,pt-BR}.ts` | Mod | Valores `Alethe`→`SO Multi Agente` (~40/locale), keys intactas |
| `src/components/modals/OnboardingModal.tsx` | Mod | Import + alt del logo |
| `src/assets/alethe-logo.png` | Rename | → `so-multi-agente-logo.png` |
| `src/App.tsx` | Mod | `loadingWordmark` (línea 101) |
| `src/components/modals/WelcomeModal.tsx` | Mod | `PRODUCT_NAME` (línea 11) |
| `src/components/modals/preferences/AppearancePage.tsx` | Mod | Labels 63-64 sin "Alethe" |
| `src-tauri/remote/{index.html,manifest.webmanifest,app.js}` | Mod | Título, name/short_name/description, 4 strings |
| `src-tauri/src/{lib.rs,github_sync.rs,discord_presence.rs,projects.rs,spotify.rs,codex_app_server.rs,codex_usage.rs,antigravity_usage.rs,filesystem.rs,remote.rs}` | Mod | Strings user-visible (título ventana, GIST_DESCRIPTION, USER_AGENT, large_text, briefing, `join("Alethe")`, clientInfo.title, TODO content, etc.) |
| `scripts/release.mjs` | Mod | Regex crate + pre-flight validation |
| `scripts/release-lib.mjs` | Create | Funciones puras extraídas |
| `scripts/release-lib.test.mjs` | Create | Tests vitest |
| `vitest.config.ts` | Mod | include + `scripts/**/*.test.mjs` |
| `src-tauri/src/stats.rs` | Mod | `classify_process` + own_names desde `current_exe()` + `mod tests` |
| `.github/workflows/release.yml` | Mod | `releaseName`/`releaseBody` (73-74) |
| `README.md`, `CONTRIBUTING.md`, `SHOWCASE.md`, `docs/{OVERVIEW,FEATURES,THEMES,BRAND,HANDOFF,DIAGNOSTICO}.md` | Mod | Rebranding |
| `docs/CHANGELOG.md` | Mod | Entrada [Não lançado] |

## Interfaces / Contracts

```ts
// scripts/release-lib.mjs (pure ESM)
export const CRATE_RE = /name = "so-multi-agente"\r?\nversion = "(\d+\.\d+\.\d+)"/;
export function findCrateVersion(lockContent: string): string | null;
export function computeNextVersion(current: string, bump: string): string; // throws on invalid
export function validateSources(sources: {pkg: string; tauri: string; cargo: string; lock: string}): void; // throws con mensaje por archivo
```

```rust
// stats.rs — clasificador puro (sin sysinfo)
enum ProcessClass { App, Webview, Pty }
fn classify_process(pid: usize, root_pid: usize, name: &str, own_names: &[String]) -> ProcessClass;
fn own_process_names() -> Vec<String>; // file_name + stem de std::env::current_exe()
```
Sin cambios en contratos de persistencia: prefs (themeIcons values, profileImageUrl), `.alethe/`, events `alethe:*`, `from_alethe`, template file name — intactos.

## Testing Strategy

| Capa | Qué | Cómo |
|------|-----|------|
| Unit (FE) | `release-lib`: match crate nuevo, null con bloque `alethe` legacy, computeNextVersion (patch/minor/major/explicita, bump inválido), validateSources falla si falta el crate | `scripts/release-lib.test.mjs` (vitest) |
| Unit (BE) | `classify_process`: root→App; `so-multi-agente`→App; legacy `alethe`→**Pty** (REQ-STATS-1); `msedgewebview2`→Webview; agente CLI→Pty; `own_process_names()` no vacío | `mod tests` in stats.rs, `npm run test:rust` |
| Manual | `node scripts/release.mjs --dry-run` en árbol limpio: éxito E2E + árbol intacto (REQ-REL-2/3) | Paso de verify |
| E2E | Build + 148 tests FE + grep residual `Alethe` con checklist de exclusión | Verify final |

## Migration / Rollout

Sin migraciones: cero cambios de contrato de persistencia. Rollback = git revert (propuesta). Exclusión documentada para el grep final: TRADEMARK.md, CHANGELOG histórico, `alethe_lib`, eventos/URI IPC `alethe:*`/`alethe://`, `from_alethe`, `.alethe/`, `~/Alethe`→no aplica (se cambia), CLI shim, ghostty FFI, GSD markers, telemetry/`ALETHE_*`, fixtures de tests (paths.test.ts:59, agentLibrary.test.ts:5), quickTerminalTitle.

## Open Questions

- [ ] `alethe_lib` (Cargo.toml [lib]): decisión del dueño — este change no lo toca.
- [ ] Shots/docs raster con el nombre viejo: se aceptan como residuo conocido (no editables mecánicamente).

# SO Multi Agente — agent working guide

> Content identical to [`CLAUDE.md`](CLAUDE.md) in this directory. Keep both in sync.
> Contributing from outside? Start at [`CONTRIBUTING.md`](CONTRIBUTING.md) — setup, project
> layout, house rules, and PR conventions.

## 1. What it is

**SO Multi Agente** is a desktop app (fork of Alethe) that organizes, operates, and resumes
multiple coding agents (Claude Code, Codex, OpenCode, Hermes, Antigravity, Pi) and shells in
parallel, inside a persistent workspace with real terminals (PTYs), layouts, themes, history,
RAM control, GSD task scheduling, merge center, and multi-agent orchestration features.

> Tagline: orchestrate every agent, shell, and project.
> Status: v0.1.0. Identifier: `com.kc1t.alethe` (legacy upstream id).

## 2. Where you are

At the repository root — the app directory. Here you will find:

- `src/` — React frontend (components, stores, lib, hooks).
- `src-tauri/` — Rust/Tauri backend (60 modules under `src-tauri/src/`).
- `openspec/` — SDD artifact store (changes, specs) used by the SDD workflow.
- `docs/` — versioned docs (`FEATURES.md`, `CHANGELOG.md`, `OVERVIEW.md`, `BRAND.md`,
  `DIAGNOSTICO_MATURIDADE_TECNICA.md`).
- `package.json`, `vite.config.ts`, `tsconfig.json`.

## 3. Stack

- **Frontend:** React 18.3 · TypeScript 5.6 · Vite 6 · Zustand 5 · xterm.js 5.5
  (`@xterm/addon-fit`, `-search`, `-webgl`, `-canvas`, `-unicode11`) · `react-resizable-panels` ·
  `@dnd-kit/core` · `@radix-ui/react-dialog` · `lucide-react` · `nanoid`.
- **Backend:** Rust (edition 2021) · Tauri 2 · `portable-pty` · `tokio` · `reqwest` (rustls) ·
  `keyring` (per-platform secure store) · `serde` · `rusqlite` (read-only Claude DB).
- **Style:** CSS Modules + CSS custom properties (no Tailwind, no styled-components).

## 4. Commands (from `package.json`)

```bash
npm install
npm run app          # = tauri dev — runs the full app with hot reload (RECOMMENDED)
npm run dev          # frontend Vite only at http://localhost:1422 (strictPort)
npm run build        # tsc + vite build — typecheck and VALIDATES i18n (see §5)
npm test             # vitest run over src/**/*.test.ts (148 tests)
npm run test:rust    # cargo test --lib (121 tests)
npm run lint         # eslint (also enforced in CI)
npm run format:check # prettier --check
```

Strict TDD is active for this project: write/update tests with the code, run
`npm test` (frontend) and `npm run test:rust` (backend) before finishing a task.

## 5. Non-negotiable rules

1. **Do NOT close or restart the app or dev server** (`tauri dev` / Vite). Do not kill the
   process, do not run `npm run app` "to test" if it is already running. Apply changes via
   **HMR** and trust the reload.
2. **Do NOT commit / push / tag / release without explicit owner permission at the time.**
   Make changes **only in the working tree** and stop — the owner decides when to commit. When
   the owner authorizes a commit, **do NOT add co-author** (`Co-Authored-By: …`) or any tool
   signature to the message — the author is the owner only.
3. **Strict design system — no gradients, no "vibecoded" UI.** No generic template UI.
   Dashboards and widgets show **real data**, never placeholder/mock. Style via CSS Modules +
   tokens from `src/styles/theme.css`; **never** hardcode colors — use the variables
   (`--bg`, `--fg`, `--accent`, `--agent-*`, `--status-*`, etc.).
4. **i18n mandatory.** Every visible string goes through `t()`/`useT()`. The source of truth is
   `src/lib/i18n/messages/es.ts` (default locale is `es`). Adding a key requires adding it in
   **all three** locale files (`es.ts`, `en.ts`, `pt-BR.ts`) — `pt-BR.ts` is typed as
   `Record<MessageKey, string>`, so `npm run build` **fails** if a translation is missing.
5. **Changelog mandatory for features.** Every feature addition, change, or removal must update
   [`docs/CHANGELOG.md`](docs/CHANGELOG.md) in the same task, under the **`[Unreleased]`**
   section (top of file), with a short, objective, user-facing description. Never skip this
   step — the changelog is the release-notes source.

## 6. Quick architecture

**Frontend (`src/`)**
- `components/` — UI by feature (`HomeView/`, `WorkspaceView/`, `XTermView/`, `ProjectSidebar/`,
  `TitleBar/`, `modals/`…). One `.module.css` per component.
- `stores/` — Zustand: `projectsStore` (projects/groups/terminals/preferences, **persisted** in
  `projects.json`, split into slices) plus domain stores (`uiStore`, `terminalsStore`,
  `schedulerStore`, `mergeStore`, `agentCanvasStore`, `agentSandboxStore`, `graphifyStore`…).
- `lib/tauri/` — `invoke` wrapper, split by domain (`git`, `pty`, `agents`, `usage`…), with
  `index.ts` re-exporting everything — call sites keep importing from `lib/tauri`. ESLint
  forbids raw `invoke()` outside `lib/tauri/**`.
- `lib/i18n/` — i18n system (`index.ts` + `messages/es.ts` + `messages/en.ts` + `messages/pt-BR.ts`).
- `lib/types.ts` — domain types (`AgentType`, `Terminal`, `Project`, `Group`, `GridLayout`…).
- `styles/theme.css` + `styles/reset.css` — tokens and reset.

**Backend (`src-tauri/src/`)**
- `lib.rs` — `invoke_handler` (registration of all `#[tauri::command]`) + app setup.
- `pty.rs` — spawn/attach/write/resize/restart/kill of PTYs + on-disk scrollback.
- `projects.rs` — atomic load/save of `projects.json` (monotonic write sequence).
- `cli_resolver.rs` — discovers CLIs (pwsh/powershell, Node managers, VS Code, agents).
- `remote.rs` — LAN remote control (HTTP + WebSocket with pairing token/QR).
- `scheduler.rs` / `supervisor.rs` / `agent_events.rs` — GSD task scheduling, supervision,
  agent event hooks. `opencode_gsd_plugin.rs` — deterministic `.planning/` writer plugin.
- `git_control.rs` / `worktrees.rs` / `merge_analyzer.rs` / `conflict_resolution.rs` — git.
- `claude_sessions.rs` / `codex_sessions.rs` / `agent_cost.rs` — session/usage reads.

**Communication:** frontend calls `invoke(...)` via `lib/tauri/`; the terminal receives
streaming via Tauri events `pty://data/{id}` and `pty://exit/{id}`.

## 7. Conventions

- One `.module.css` per component; color/spacing always via tokens, never literals.
- New domain types go into `src/lib/types.ts`; reuse existing ones.
- Keep Zustand selectors narrow to avoid rerender loops; `projects.json` saves with debounce
  and atomic write (tmp → rename) — preserve that pattern.
- `projects.json` schema is versioned with migration/backfill — when changing shape, keep the
  migration.
- Spanish is the UI language (default locale `es`, neutral professional Spanish). Locale files
  are the only place user-facing translations live.
- New code comments, JSDoc, changelog entries: keep them concise; English or Spanish is
  acceptable, but do not mix within one file without reason.

## 8. Gotchas / security

- `csp: null` in `tauri.conf.json` → the webview has full IPC access. Treat any rendered input
  as untrusted. (Planned: enforce a strict CSP.)
- `spawn_pty` executes a shell with commands/args from the frontend — validate input on the
  frontend before spawning.
- OAuth tokens (Spotify, GitHub) are currently stored in plaintext app data; do not log or
  expose them. (Planned: move to keyring.)
- Local data: `~/.local/share/…` / `%APPDATA%` (profiles, `projects.json`, scrollback `*.bin`,
  `spawn.log`). Remote pairing token is memory-only, regenerated each boot.
- `profile.release` uses `panic = "abort"` — avoid `unwrap()` on background threads.

## 9. Dig deeper

Versioned in this repo:

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — per-OS setup, layout, house rules, commit/PR convention.
- [`docs/FEATURES.md`](docs/FEATURES.md) — features in detail.
- [`docs/CHANGELOG.md`](docs/CHANGELOG.md) — user-facing history.
- [`docs/OVERVIEW.md`](docs/OVERVIEW.md) — domain model (Group, Project, Container, Pane,
  Terminal, Sub-tab, PTY), stack, and persistence.
- [`docs/BRAND.md`](docs/BRAND.md).
- [`docs/DIAGNOSTICO_MATURIDADE_TECNICA.md`](docs/DIAGNOSTICO_MATURIDADE_TECNICA.md) — code
  organization/duplication/performance diagnosis with prioritized recommendations.

## graphify

## Language and comment rules

- Write user-facing strings in Spanish (neutral/professional) via the i18n locale files.
- Keep comments concise. Add them only when they explain non-obvious behavior, constraints, or decisions.

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Universal across the agent providers the app spawns (Claude Code, Codex, OpenCode) when the project has Graphify enabled: each gets the Graphify MCP server wired into its session automatically (Claude via `--mcp-config`; Codex/OpenCode via `.codex/config.toml`/`opencode.json` in the project root — see `graphify_codex_config_write`/`graphify_opencode_config_write` in `src-tauri/src/graphify.rs`).

Rules:
- If a Graphify MCP tool (e.g. `graphify_query`/similar) is available in this session, prefer calling it directly over shelling out — same scoped-subgraph result, no extra process spawn.
- Otherwise, for codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

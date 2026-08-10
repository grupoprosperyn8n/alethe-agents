# SO Multi Agente

Workspace de escritorio local-first para coordinar múltiples agentes de código y terminales reales en paralelo.

Basado en [Alethe](https://github.com/Kc1t/alethe-agents) de Kauã Miguel.

## Agentes soportados

- **Claude Code** — Anthropic CLI
- **Codex** — OpenAI CLI
- **OpenCode** — open source
- **Antigravity** — Google Antigravity CLI
- **Hermes** — puente de mensajería multiplataforma
- **Pi CLI** — utilidades de búsqueda y análisis
- **Shell** — PowerShell / cmd / bash

## Stack

- **Frontend:** React 18 + TypeScript + Vite
- **Backend:** Rust + Tauri 2
- **Terminales:** xterm.js + portable-pty
- **Estado:** Zustand

## Desarrollo

```bash
npm install
npm run app      # app completo con hot reload
npm run dev      # solo frontend Vite
npm run build    # typecheck + build
npm test         # tests unitarios
```

## Créditos

Fork y adaptación de [Alethe](https://github.com/Kc1t/alethe-agents) por Kauã Miguel.

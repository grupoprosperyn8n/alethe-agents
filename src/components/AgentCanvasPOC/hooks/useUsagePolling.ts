import { type MutableRefObject, useCallback, useEffect, useRef, useState } from 'react'

import { USAGE_FALLBACK_THRESHOLD, USAGE_POLL_MS } from '../../../lib/agentCanvasConfig'
import { formatReset } from '../../../lib/agentCanvasUtils'
import { getCachedClaudeUsage } from '../../../lib/claudeUsageCache'
import { getCachedCodexUsage } from '../../../lib/codexUsageCache'
import { type ClaudeUsage, type CodexUsage, writePty } from '../../../lib/tauri'

type Session = { folder: string; ptyId: string }

/**
 * Monitor de usage do Claude/Codex: relê a janela de 5h em intervalo, liga o
 * fallback codex acima do threshold e avisa o lead (uma vez) pra despachar
 * trabalho pesado pro terminal codex. Owner do estado de usage/fallback.
 */
export function useUsagePolling(
  session: Session | null,
  sessionRef: MutableRefObject<Session | null>,
  hooksEndpoint: string | null,
) {
  const [usage, setUsage] = useState<ClaudeUsage | null>(null)
  const [codexUsage, setCodexUsage] = useState<CodexUsage | null>(null)
  const [fallbackActive, setFallbackActive] = useState(false)
  const fallbackActiveRef = useRef(false)
  const leadNotifiedRef = useRef(false)

  // Liga o fallback codex: avisa o lead pra DESPACHAR trabalho pesado pro
  // terminal codex via a ponte /codex. NÃO cria codex vazio — o worker nasce
  // quando o lead despacha (dispatchToCodex), aí já com tarefa rodando.
  // Idempotente (fallbackActiveRef). Também chamável pelo chip de usage pra
  // testar sem chegar a 80% de verdade.
  const activateFallback = useCallback(
    (u: ClaudeUsage | null, forced = false) => {
      if (fallbackActiveRef.current) return
      fallbackActiveRef.current = true
      setFallbackActive(true)
      const pct = u ? Math.round(u.five_hour.utilization) : 0
      console.log(`[AgentCanvasPOC] FALLBACK codex ON${forced ? ' (forçado)' : ''} — 5h ${pct}%`)
      if (!leadNotifiedRef.current && sessionRef.current) {
        leadNotifiedRef.current = true
        const reset = u ? formatReset(u.five_hour.resets_at) : '—'
        // Instrução acionável e sem ambiguidade: despache via a ponte HTTP. Sem
        // \r — o usuário confirma. (Requer sessão iniciada após esta regra existir.)
        const endpoint = hooksEndpoint ?? 'http://127.0.0.1:9123'
        const note = `[SO Multi Agente] Claude 5h usage at ${pct}% (resets in ${reset}). Conserve Claude tokens: from now on, offload heavy/long/mechanical work to the codex terminal by running: curl -s -X POST ${endpoint}/codex -d "<task as one self-contained English instruction>". It runs in the codex terminal worker shown in the canvas. `
        void writePty(sessionRef.current.ptyId, note).catch(() => {})
      }
    },
    [hooksEndpoint, sessionRef],
  )

  // Monitor de usage do Claude — lê a janela de 5h e liga/desliga o fallback.
  useEffect(() => {
    if (!session) return
    let cancelled = false

    const check = async () => {
      try {
        const u = await getCachedClaudeUsage()
        if (cancelled) return
        setUsage(u)
        const util = u.five_hour.utilization
        if (util >= USAGE_FALLBACK_THRESHOLD) {
          activateFallback(u)
        } else if (fallbackActiveRef.current) {
          // Reset aconteceu — desliga o fallback (o aviso ao lead não repete).
          fallbackActiveRef.current = false
          setFallbackActive(false)
          console.log('[AgentCanvasPOC] fallback codex OFF — usage voltou a', util)
        }
      } catch (err) {
        console.warn('[AgentCanvasPOC] usage indisponível (sem token?):', err)
      }
      // Codex em separado (pode não estar logado — não derruba o do Claude).
      try {
        const cu = await getCachedCodexUsage()
        if (!cancelled) setCodexUsage(cu)
      } catch {
        if (!cancelled) setCodexUsage(null)
      }
    }

    void check()
    const timer = window.setInterval(check, USAGE_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [session, activateFallback])

  return { usage, codexUsage, fallbackActive, activateFallback }
}

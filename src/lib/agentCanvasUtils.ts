/** Pure Agent Canvas helpers and types. */
import {
  Bot,
  LayoutTemplate,
  type LucideIcon,
  Paintbrush,
  PenLine,
  Server,
  ShieldCheck,
  TerminalSquare,
} from 'lucide-react'

import type { AgentNode } from '../stores/agentCanvasStore'
import { AGENT_COLORS, FAMILY_RANK } from './agentCanvasConfig'
import { costLevel, shortModel } from './costFormat'
import type { ModelRate, SessionCost } from './tauri'
import type { AgentType } from './types'

/** CSS module class map. */
export type CanvasStyleMap = Readonly<Record<string, string>>

/** SVG edge connecting the control plane to a card or task. */
export type Edge = { id: string; x1: number; y1: number; x2: number; y2: number; done: boolean }

/** Real PTY worker managed by the canvas and expandable into a full terminal. */
export type CodexWorker = {
  ptyId: string
  /** Process agent (claude, codex, or opencode). */
  agent: AgentType
  /** Worker task or origin. */
  title: string
  cwd: string
  startedAt: number
  exitedCode: number | null
  /** One-shot agent arguments; undefined for interactive mode. */
  args?: string[]
  /** Tail summary of the worker output. */
  result?: string
}

/** Format the time until a usage window resets. */
export function formatReset(resetsAt: string, nowLabel = 'ahora'): string {
  if (!resetsAt) return '—'
  const diff = new Date(resetsAt).getTime() - Date.now()
  if (Number.isNaN(diff)) return '—'
  if (diff <= 0) return nowLabel
  const h = Math.floor(diff / 3_600_000)
  const m = Math.floor((diff % 3_600_000) / 60_000)
  return h > 0 ? `${h}h${m}m` : `${m}m`
}

/** Build the single-line orchestration prompt for the lead session. */
// Keep this argument free of quotes, backticks, and newlines for Windows batch parsing.
export function orchestrationRules(agentEndpoint: string, budgetUsd?: number | null) {
  const budget =
    budgetUsd && budgetUsd > 0
      ? ` Tope de presupuesto para esta sesión: unos ${budgetUsd} dólares; prioriza el enrutamiento barato y pausa para preguntar al usuario antes de superarlo.`
      : ''
  return (
    'Eres el control plane autónomo y el cerebro de una sesión de agent canvas de SO Multi Agente. El usuario te da una meta de alto nivel en este terminal y tú la llevas a término distribuyendo el trabajo entre las IAs, observando sus resultados y decidiendo tú mismo cada siguiente acción. Trabaja de forma autónoma pero con checkpoints. Reglas: ' +
    '(1) Para una tarea pequeña, hazla tú solo; spawnear agentes tiene overhead. ' +
    '(2) Para una meta grande (construir una feature o una app pequeña), PRIMERO consulta al agente orchestrator si existe (herramienta Agent, subagent_type orchestrator) para obtener un plan: streams paralelas para front, back, qa y docs, más una lista de tasks con dependencias y un agente sugerido por task; si no hay agente orchestrator disponible, redacta ese plan tú mismo. Presenta el plan al usuario y espera su aprobación antes de ejecutar. ' +
    '(3) Tras la aprobación, crea un equipo pequeño de agentes (2 a 4 teammates, nunca más) y dale a cada teammate rutas de archivos distintas para que dos nunca editen el mismo archivo; pon contexto completo en cada prompt de spawn; divide el trabajo en tasks con dependencias; luego coordina y espera a tus teammates en lugar de implementarlo todo tú mismo. ' +
    '(4) Enruta por costo: si existen workers baratos en .claude/agents, usa haiku-resumidor para lectura y resumen en masa, haiku-mecanico para ediciones mecánicas bien especificadas, codex-executor para ejecución larga y ruidosa; reserva la arquitectura y el trabajo ambiguo para modelos capaces; nunca enrutes trabajo ambiguo a workers baratos; prefiere descargar trabajo a un worker codex cuando el uso de Claude sea alto. ' +
    '(5) Checkpoints: pausa y pregunta al usuario en los hitos grandes (fin de un epic), antes de pasos destructivos o irreversibles, y siempre que el gasto se acerque al tope de presupuesto; nunca superes el tope sin preguntar. Integra los streams y ejecuta qa antes de declarar terminado. ' +
    `(6) Los workers reales son CAROS: cada spawn es un proceso separado completo que usa cientos de megabytes de RAM, así que prefiere subagentes y teammates en proceso para casi todo, spawna COMO MÁXIMO dos workers reales a la vez, reutilízalos en lugar de volver a spawnearlos, y prefiere un worker codex sobre uno claude porque codex es mucho más liviano. Para spawnear uno, haz POST JSON a ${agentEndpoint}/spawn con el body {agent, task, mode}: agent es claude, codex u opencode; task es una instrucción autocontenida en español; mode es exec para un disparo único fire-and-forget o interactive. Usa curl -s -X POST con la flag -d y JSON entre comillas simples. Es fire and forget: no recibes la salida, así que úsalo solo para trabajo descargable, no para resultados que debas leer.` +
    budget
  )
}

/** Return a stable color for an agent type. */
export function colorFor(agentType: string): string {
  const known = AGENT_COLORS[agentType.toLowerCase()]
  if (known) return known
  // Custom agents and teammates use a stable name hash.
  let h = 0
  for (const ch of agentType) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return `hsl(${h % 360} 55% 62%)`
}

/** Format a completed node duration; return null while it is running. */
export function durationLabel(node: { startedAt: number; endedAt: number | null }): string | null {
  if (node.endedAt === null) return null
  const s = Math.round((node.endedAt - node.startedAt) / 1000)
  return s >= 60 ? `${Math.floor(s / 60)}m${s % 60}s` : `${s}s`
}

/** Strip terminal control sequences and return the tail of a worker's output. */
export function tailSummary(raw: string, max = 320): string {
  const clean = raw
    // CSI: ESC [ ... letra final
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    // OSC: ESC ] ... (BEL ou ESC backslash)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    // outros escapes ESC de 1 char
    .replace(/\x1b[@-Z\\-_]/g, '')
    // bytes de controle restantes (preserva \n e \t)
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
  return clean.length > max ? `…${clean.slice(-max)}` : clean
}

/** Monta os extraArgs one-shot por agente pra rodar uma task sem depender da TUI. */
export function execArgsFor(agent: AgentType, task: string): string[] | undefined {
  switch (agent) {
    case 'codex':
      return ['exec', '--skip-git-repo-check', task]
    case 'claude':
      // headless: -p roda a task e sai; sem permissões pra não travar no prompt.
      return ['-p', task, '--dangerously-skip-permissions']
    case 'opencode':
      return ['run', task]
    default:
      return undefined
  }
}

/** Classe de status do badge de um nó (tokens do tema). */
export function statusBadgeClass(status: AgentNode['status'], styles: CanvasStyleMap): string {
  if (status === 'running') return styles.statusRunning
  if (status === 'idle') return styles.statusIdle
  return styles.statusDone
}

/** Faixa de gasto (USD) → classe de cor do canvas (tokens do tema). */
export function costClassFor(usd: number, styles: CanvasStyleMap): string {
  const level = costLevel(usd)
  if (level === 'high') return styles.costHigh
  if (level === 'mid') return styles.costMid
  return styles.costLow
}

/** Custo hipotético de um nó se tivesse rodado num modelo (rate) diferente. */
export function costAtRate(c: SessionCost, rate: ModelRate): number {
  return (
    (c.input * rate.input +
      c.output * rate.output +
      c.cache_read * rate.cache_read +
      c.cache_write_5m * rate.cache_write_5m +
      c.cache_write_1h * rate.cache_write_1h) /
    1_000_000
  )
}

/**
 * Economia estimada (USD) por ter roteado nós pra modelos mais baratos que o
 * lead: para cada nó com custo conhecido e família mais barata, soma
 * (custo no modelo do lead − custo real). Estimativa honesta, baseada em tokens
 * reais — não conta nós sem preço (codex) nem os no mesmo nível do lead.
 */
export function estimateRoutingSavings(
  nodeCosts: Record<string, SessionCost>,
  leadModel: string | null,
  pricing: ModelRate[],
): number {
  const leadFamily = shortModel(leadModel)
  if (!leadFamily) return 0
  const leadRate = pricing.find((r) => r.family === leadFamily) ?? null
  const leadRank = FAMILY_RANK[leadFamily] ?? 0
  if (!leadRate || leadRank === 0) return 0
  let saved = 0
  for (const c of Object.values(nodeCosts)) {
    if (c.cost_usd == null) continue
    const fam = shortModel(c.model)
    const rank = fam ? (FAMILY_RANK[fam] ?? 0) : 0
    if (rank === 0 || rank >= leadRank) continue
    const delta = costAtRate(c, leadRate) - c.cost_usd
    if (delta > 0) saved += delta
  }
  return saved
}

/** Ícone de persona por heurística de nome do agente. */
export function personaIconFor(agentName: string): LucideIcon {
  const name = agentName.toLowerCase()
  if (name.includes('orchestr') || name.includes('tech-lead')) return LayoutTemplate
  if (name.includes('frontend')) return Paintbrush
  if (name.includes('backend')) return Server
  if (name.includes('qa') || name.includes('review')) return ShieldCheck
  if (name.includes('docs') || name.includes('writer')) return PenLine
  if (name.includes('codex') || name.includes('executor')) return TerminalSquare
  if (name.includes('plan')) return LayoutTemplate
  return Bot
}

import type { AgentType } from '../types'
import { useProjectsStore } from '../../stores/projectsStore'
import { es, type MessageKey } from './messages/es'
import { ptBR } from './messages/pt-BR'
import { en } from './messages/en'

export type { MessageKey }

/** Idiomas soportados. `es` es el default y fuente de verdad de las claves. */
export type Locale = 'es' | 'en' | 'pt-BR'

export const DEFAULT_LOCALE: Locale = 'es'

export type LocaleMeta = {
  id: Locale
  /** Nome no próprio idioma, pra mostrar no seletor. */
  nativeName: string
  /** Locale BCP-47 pra Intl (datas/números). */
  intl: string
}

export const LOCALES: LocaleMeta[] = [
  { id: 'es', nativeName: 'Español', intl: 'es-AR' },
  { id: 'en', nativeName: 'English', intl: 'en-US' },
  { id: 'pt-BR', nativeName: 'Português', intl: 'pt-BR' },
]

const DICTIONARIES: Record<Locale, Record<string, string>> = {
  es,
  en,
  'pt-BR': ptBR,
}

export function intlLocale(locale: Locale): string {
  return LOCALES.find((l) => l.id === locale)?.intl ?? 'en-US'
}

type Params = Record<string, string | number>

function interpolate(message: string, params?: Params): string {
  if (!params) return message
  return message.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in params ? String(params[key]) : `{${key}}`,
  )
}

/**
 * Tradução pura (sem hook). Usa o dicionário do `locale`, com fallback pra
 * `en` e, em último caso, pra própria chave. Interpola `{placeholder}`.
 */
export function translate(locale: Locale, key: MessageKey, params?: Params): string {
  const dict = DICTIONARIES[locale] ?? en
  const message = dict[key] ?? en[key] ?? key
  return interpolate(message, params)
}

/** Locale atual lido direto do store — pra uso fora de componentes React. */
export function getLocale(): Locale {
  return useProjectsStore.getState().preferences.language
}

export type TFunction = (key: MessageKey, params?: Params) => string

/**
 * Hook de tradução. Re-renderiza o componente quando o idioma muda.
 */
export function useT(): TFunction {
  const locale = useProjectsStore((s) => s.preferences.language)
  return (key, params) => translate(locale, key, params)
}

const AGENT_LABEL_KEYS: Record<AgentType, MessageKey> = {
  claude: 'agent.claude.label',
  codex: 'agent.codex.label',
  opencode: 'agent.opencode.label',
  antigravity: 'agent.antigravity.label',
  hermes: 'agent.hermes.label',
  pi: 'agent.pi.label',
  shell: 'agent.shell.label',
}

/** Label traduzido de um agente. Nomes próprios de produtos são preservados; `shell` vira "Terminal" no espanhol. */
export function getAgentLabel(locale: Locale, agent: AgentType): string {
  return translate(locale, AGENT_LABEL_KEYS[agent])
}

/** Hook de label de agente. */
export function useAgentLabel(): (agent: AgentType) => string {
  const locale = useProjectsStore((s) => s.preferences.language)
  return (agent) => translate(locale, AGENT_LABEL_KEYS[agent])
}

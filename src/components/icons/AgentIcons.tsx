import claudeLogo from '../../assets/claude-code.png'
import codexLogo from '../../assets/codex.png'
import antigravityLogo from '../../assets/antigravity.png'
import { iconMap } from '../../assets/icons'
import type { AgentType, Theme } from '../../lib/types'

export function ShellIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M3 5l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 11h5" strokeLinecap="round" />
    </svg>
  )
}

export function ClaudeIcon({ size = 16 }: { size?: number }) {
  return <img src={claudeLogo} alt="" width={size} height={size} draggable={false} />
}

export function CodexIcon({ size = 16 }: { size?: number }) {
  return <img src={codexLogo} alt="" width={size} height={size} draggable={false} />
}

/** Lettermark "H" monocromático (currentColor). Trocar pelo logo oficial. */
export function HermesIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="2" y="2" width="12" height="12" rx="3" />
      <path d="M5 4v8M11 4v8M5 8h6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Lettermark "π" monocromático (currentColor). Trocar pelo logo oficial. */
export function PiIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M3 4h10M6 4v7M10 4v7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function OpenCodeIcon({ size = 16, theme }: { size?: number; theme: Theme }) {
  const lightIcon = theme === 'light' || theme === 'min-light'
  return (
    <img
      src={lightIcon ? iconMap.open : iconMap.openDark}
      alt=""
      width={size}
      height={size}
      draggable={false}
    />
  )
}

export function VSCodeIcon({ size = 14 }: { size?: number }) {
  return <img src={iconMap.vscode} alt="" width={size} height={size} draggable={false} />
}

export function AntigravityIcon({ size = 16 }: { size?: number }) {
  return <img src={antigravityLogo} alt="" width={size} height={size} draggable={false} />
}

export function AgentIcon({
  type,
  size = 16,
  theme,
}: {
  type: AgentType
  size?: number
  theme: Theme
}) {
  if (type === 'shell') return <ShellIcon size={size} />
  if (type === 'claude') return <ClaudeIcon size={size} />
  if (type === 'codex') return <CodexIcon size={size} />
  if (type === 'hermes') return <HermesIcon size={size} />
  if (type === 'pi') return <PiIcon size={size} />
  if (type === 'antigravity') return <AntigravityIcon size={size} />
  return <OpenCodeIcon size={size} theme={theme} />
}

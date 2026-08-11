import { useEffect } from 'react'

import { clearDiscordPresence, setDiscordPresence } from '../lib/tauri'
import { useT } from '../lib/i18n'
import { useProjectsStore } from '../stores/projectsStore'
import { useUiStore } from '../stores/uiStore'

const STARTED_AT = Math.floor(Date.now() / 1000)
const REFRESH_INTERVAL_MS = 30_000

const VIEW_LABEL_KEYS = {
  home: 'discord.viewingDashboard',
  workspace: 'discord.managingTerminals',
  agentCanvas: 'discord.orchestratingAgents',
  agentSandbox: 'discord.testingOrchestration',
} as const

export function useDiscordPresence() {
  const t = useT()
  const hydrated = useProjectsStore((store) => store.hydrated)
  const enabled = useProjectsStore((store) => store.preferences.discordRichPresenceEnabled)
  const activeView = useUiStore((store) => store.activeView)

  useEffect(() => {
    if (!hydrated) return

    if (!enabled) {
      void clearDiscordPresence().catch(() => undefined)
      return
    }

    const update = () => {
      void setDiscordPresence(t('discord.workingWithAlethe'), t(VIEW_LABEL_KEYS[activeView]), STARTED_AT).catch(
        () => undefined,
      )
    }

    update()
    const interval = window.setInterval(update, REFRESH_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [activeView, enabled, hydrated])
}

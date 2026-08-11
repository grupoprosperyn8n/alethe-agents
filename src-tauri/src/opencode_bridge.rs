// Bridge de sinal real de "working"/"idle" do OpenCode via plugin.
//
// A heuristica generica de PTY (agentCompletionMonitor.ts, frontend) nao funciona
// bem pro OpenCode porque ele abre uma TUI de tela cheia com redraw constante —
// o "salto de texto novo apos Enter" que a heuristica espera raramente acontece
// do jeito que ela consegue detectar, entao "tempo e foco" fica sempre em zero
// pro OpenCode mesmo em uso pesado.
//
// Este modulo escreve um plugin real do OpenCode (formato confirmado em
// opencode.ai/docs/plugins/) num diretorio GLOBAL do usuario
// (~/.config/opencode/plugin/alethe-bridge.js) — nao por projeto, pra valer pra
// qualquer terminal opencode que o Alethe spawnar, nao so os com Graphify
// habilitado. O plugin reporta session.idle/tool.execute.before de volta pro
// Alethe via HTTP local, reaproveitando o listener ja existente em
// agent_events.rs (mesmo endpoint que os hooks HTTP do Claude Code ja usam).

use std::path::PathBuf;

const PLUGIN_FILE_NAME: &str = "alethe-bridge.js";

const PLUGIN_SOURCE: &str = r#"// Generado automáticamente por Alethe - no editar a mano (se sobrescribe en el
// próximo arranque del app si el contenido cambia).
//
// Reporta el estado real (working/idle) de sesiones OpenCode de vuelta a Alethe,
// mediante el endpoint local pasado en ALETHE_BRIDGE_ENDPOINT (inyectado como env var
// en el spawn de cada terminal opencode). Best-effort: nunca debe trabar ni
// romper la sesión de OpenCode si Alethe no está corriendo o el puerto cambió.
export const AletheBridgePlugin = async ({ directory }) => {
  const endpoint = process.env.ALETHE_BRIDGE_ENDPOINT
  if (!endpoint) return {}

  const report = async (state) => {
    try {
      await fetch(`${endpoint}/opencode-status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory, state }),
      })
    } catch {
      // best-effort - Alethe offline/puerto cerrado no debe romper nada aquí
    }
  }

  return {
    event: async ({ event }) => {
      if (event.type === "session.idle") await report("idle")
    },
    "tool.execute.before": async () => {
      await report("working")
    },
  }
}
"#;

fn plugin_dir() -> Option<PathBuf> {
    Some(
        dirs_next::home_dir()?
            .join(".config")
            .join("opencode")
            .join("plugin"),
    )
}

/// Escreve o plugin global (idempotente — só regrava se o conteúdo mudou, pra
/// não bagunçar mtime/cache do OpenCode à toa). Best-effort por design: uma
/// falha aqui nunca deve impedir o Alethe de subir — só cai pro fallback de
/// heurística de PTY que já existia antes deste incremento.
pub fn ensure_installed() {
    let Some(dir) = plugin_dir() else {
        eprintln!("[opencode_bridge] não foi possível resolver o diretório home");
        return;
    };
    if let Err(e) = std::fs::create_dir_all(&dir) {
        eprintln!("[opencode_bridge] falha ao criar {dir:?}: {e}");
        return;
    }
    let path = dir.join(PLUGIN_FILE_NAME);
    let needs_write = match std::fs::read_to_string(&path) {
        Ok(existing) => existing != PLUGIN_SOURCE,
        Err(_) => true,
    };
    if !needs_write {
        return;
    }
    if let Err(e) = std::fs::write(&path, PLUGIN_SOURCE) {
        eprintln!("[opencode_bridge] falha ao escrever plugin em {path:?}: {e}");
    } else {
        eprintln!("[opencode_bridge] plugin instalado em {}", path.display());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plugin_source_exports_the_expected_hooks() {
        assert!(PLUGIN_SOURCE.contains("export const AletheBridgePlugin"));
        assert!(PLUGIN_SOURCE.contains("session.idle"));
        assert!(PLUGIN_SOURCE.contains("tool.execute.before"));
        assert!(PLUGIN_SOURCE.contains("ALETHE_BRIDGE_ENDPOINT"));
        assert!(PLUGIN_SOURCE.contains("/opencode-status"));
    }
}

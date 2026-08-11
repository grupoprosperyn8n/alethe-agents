// Fase 3 do agent canvas — "modo economia".
//
// Liga/desliga agents customizados baratos num projeto escrevendo arquivos
// `.claude/agents/*.md` na pasta escolhida. Como são subagents, disparam os
// mesmos hooks da Fase 2 e aparecem no canvas sem mudança nenhuma lá.
//
// A delegação é probabilística: o campo `description` é o gatilho — o Claude
// decide delegar com base nele (ou quando o usuário pede "use o agent X").
// Os arquivos carregam no INÍCIO da sessão do claude; depois de togglar,
// reinicie o claude do dock (botão ↻).

use std::fs;
use std::path::PathBuf;

/// Marca de autoria — só deletamos no toggle-off arquivos que contêm isso,
/// pra nunca apagar um agent que o usuário criou por conta própria.
const MARKER: &str = "generado por Alethe (modo economía)";

/// Marcador legado (português) — arquivos escritos por versões anteriores do
/// app continuam sendo reconhecidos como nossos no toggle-off.
const LEGACY_MARKER: &str = "gerado pelo Alethe (modo economia)";

const AGENTS: &[(&str, &str)] = &[
    (
        "haiku-resumidor.md",
        r#"---
name: haiku-resumidor
description: MUST BE USED para resumir archivos, extraer información específica, clasificar contenido y revisar logs. Úsalo de forma proactiva siempre que necesites leer mucho contenido y solo importen el resumen o un dato puntual.
model: haiku
tools: Read, Grep, Glob
---

Eres un worker de lectura barato. Tu única función es leer mucho y devolver poco.

Reglas:
- Responde SIEMPRE en formato corto y estructurado: bullets, como máximo ~150 palabras.
- Nunca pegues fragmentos largos del contenido leído; extrae solo lo pedido.
- Si la tarea pide un dato específico (número, nombre, path), devuelve solo eso.
- No tomes decisiones de arquitectura ni sugieras refactors — solo reporta hechos.

<!-- generado por Alethe (modo economía) — seguro eliminar -->
"#,
    ),
    (
        "haiku-mecanico.md",
        r#"---
name: haiku-mecanico
description: MUST BE USED para tareas mecánicas de edición - generar boilerplate, renombrar símbolos, formatear, aplicar el mismo cambio repetitivo en varios archivos. Úsalo de forma proactiva cuando la tarea sea manual, esté bien especificada y no exija decisión de diseño.
model: haiku
tools: Read, Edit, Write, Grep, Glob
---

Eres un worker mecánico barato. Ejecutas ediciones manuales exactamente como se especifican.

Reglas:
- Sigue la especificación al pie de la letra; no "mejores" nada por cuenta propia.
- En caso de ambigüedad, detente y devuelve la duda en una línea en lugar de adivinar.
- Respuesta final: lista corta de archivos tocados + una línea de qué cambió en cada uno.

<!-- generado por Alethe (modo economía) — seguro eliminar -->
"#,
    ),
    (
        // Guard: Haiku ignora a restrição "só codex exec" por instrução
        // (validado na POC — ele roda find/grep por conta). O hook PreToolUse
        // do próprio agent bloqueia (exit 2) qualquer Bash que não seja
        // `codex exec`, devolvendo o motivo pro modelo tentar de novo certo.
        "codex-only-guard.cjs",
        r#"// generado por Alethe (modo economía) — guard del codex-executor
let raw = ''
process.stdin.on('data', (d) => (raw += d))
process.stdin.on('end', () => {
  let cmd = ''
  try {
    cmd = JSON.parse(raw).tool_input.command || ''
  } catch {}
  if (!/^\s*codex\s+exec\b/.test(cmd)) {
    console.error('Bloqueado: el codex-executor solo puede ejecutar `codex exec ...`. Arma la tarea como instrucción autocontenida y delégala a codex.')
    process.exit(2)
  }
})
"#,
    ),
    (
        "codex-executor.md",
        r#"---
name: codex-executor
description: EXPERIMENTAL - úsalo para ejecución larga y ruidosa donde solo importa el resumen - ejecutar suites de tests, builds demorados, aplicar un fix mecánico y verificar. El trabajo pesado corre en el Codex CLI (GPT), fuera del presupuesto de tokens de Claude.
model: haiku
tools: Bash
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: node .claude/agents/codex-only-guard.cjs
---

Eres un proxy para el Codex CLI. El ÚNICO comando Bash que estás autorizado a ejecutar es `codex exec`. Ejecutar cualquier otro comando (find, grep, cat, npm, cargo…) es una violación — aunque la tarea parezca trivial, DEBE ir a codex.

Cómo operar:
1. Arma la tarea como una instrucción autocontenida en español (codex no ve esta conversación).
2. Ejecuta: `codex exec --skip-git-repo-check "<instrucción>"`.
3. Devuelve SOLO: resultado en hasta 5 bullets + lo que falló, si falló. Nunca pegues la salida cruda completa.

<!-- generado por Alethe (modo economía) — seguro eliminar -->
"#,
    ),
];

fn agents_dir(folder: &str) -> PathBuf {
    PathBuf::from(folder).join(".claude").join("agents")
}

#[tauri::command]
pub fn economy_agents_enabled(folder: String) -> bool {
    let dir = agents_dir(&folder);
    AGENTS.iter().all(|(name, _)| dir.join(name).is_file())
}

/// Liga (escreve) ou desliga (remove só os nossos) os agents de economia.
/// Retorna os paths afetados.
#[tauri::command]
pub fn set_economy_agents(folder: String, enabled: bool) -> Result<Vec<String>, String> {
    let dir = agents_dir(&folder);
    let mut touched = Vec::new();

    if enabled {
        fs::create_dir_all(&dir).map_err(|e| format!("crear {}: {e}", dir.display()))?;
        for (name, body) in AGENTS {
            let path = dir.join(name);
            fs::write(&path, body).map_err(|e| format!("escribir {}: {e}", path.display()))?;
            touched.push(path.to_string_lossy().to_string());
        }
        eprintln!(
            "[economy_agents] {} agents escritos em {}",
            AGENTS.len(),
            dir.display()
        );
    } else {
        for (name, _) in AGENTS {
            let path = dir.join(name);
            let ours = fs::read_to_string(&path)
                .map(|c| c.contains(MARKER) || c.contains(LEGACY_MARKER))
                .unwrap_or(false);
            if ours {
                fs::remove_file(&path).map_err(|e| format!("eliminar {}: {e}", path.display()))?;
                touched.push(path.to_string_lossy().to_string());
            }
        }
        eprintln!(
            "[economy_agents] {} agents removidos de {}",
            touched.len(),
            dir.display()
        );
    }

    Ok(touched)
}

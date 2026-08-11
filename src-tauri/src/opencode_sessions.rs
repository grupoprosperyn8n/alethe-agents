use serde::Serialize;
use std::path::Path;
use std::process::Command;

#[derive(Serialize)]
pub struct OpenCodeSessionSnapshot {
    pub id: String,
    pub modified_at_ms: u128,
}

/// Normaliza um path pra comparação: separadores unificados e sem separador
/// final. Só uniformiza caixa no Windows (case-insensitive) — em Linux/macOS
/// o filesystem é case-sensitive, então lowercasear incondicionalmente
/// colidiria dois diretórios diferentes (ex.: `/home/u/Project` vs
/// `/home/u/project`).
///
/// Também remove o prefixo verbatim `\\?\` (e `\\?\UNC\`) antes de comparar —
/// o `directory` que o próprio `opencode` reporta na sua lista de sessões
/// nunca vem com esse prefixo, então sem remover aqui um cwd de worktree
/// canonicalizado nunca batia e a sessão nunca era encontrada (mesma raiz do
/// bug já corrigido em `worktrees::git_arg`).
fn normalize_path(path: &str) -> String {
    let trimmed = path.trim().trim_end_matches(|c: char| c == '\\' || c == '/');
    let unprefixed = trimmed
        .strip_prefix(r"\\?\UNC\")
        .map(|rest| format!(r"\\{rest}"))
        .unwrap_or_else(|| trimmed.strip_prefix(r"\\?\").unwrap_or(trimmed).to_string());
    if cfg!(windows) {
        unprefixed.replace('/', "\\").to_ascii_lowercase()
    } else {
        unprefixed
    }
}

/// Executa `opencode session list --format json` NO cwd do projeto e parseia a
/// saída. O OpenCode escopa a listagem pelo diretório atual do processo, e cada
/// entrada traz o campo `directory` — filtramos por ele pra nunca vazar sessão
/// de outro projeto (ex.: `--continue` global pegando a sessão errada).
/// Retorna as sessões ordenadas por data de modificação (mais recente primeiro).
///
/// `async` + `spawn_blocking`: roda um subprocesso (`opencode session list`)
/// de verdade, chamado a cada spawn/validação de resumo de terminal
/// (`XTermView`) — como `fn` síncrona isso travaria a thread de despacho de
/// IPC do Tauri, mesma classe de bug já corrigida em `cli_resolver.rs`.
#[tauri::command]
pub async fn snapshot_opencode_sessions(cwd: String) -> Result<Vec<OpenCodeSessionSnapshot>, String> {
    tokio::task::spawn_blocking(move || snapshot_opencode_sessions_inner(cwd))
        .await
        .map_err(|error| format!("snapshot_opencode_sessions: fallo en la tarea bloqueante: {error}"))?
}

fn snapshot_opencode_sessions_inner(cwd: String) -> Result<Vec<OpenCodeSessionSnapshot>, String> {
    let mut command = Command::new("opencode");
    command.args(["session", "list", "--format", "json", "--max-count", "50"]);
    if !cwd.is_empty() && Path::new(&cwd).is_dir() {
        // `opencode` é resolvido via shim `.cmd` no Windows — o mesmo prefixo
        // `\\?\` que o cmd.exe recusa como diretório atual (ver worktrees::git_arg)
        // se aplica aqui.
        command.current_dir(crate::worktrees::git_arg(Path::new(&cwd)));
    }
    let output = command
        .output()
        .map_err(|e| format!("fallo al ejecutar opencode: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("la lista de sesiones de opencode falló: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    // Sem sessões pro cwd, o CLI devolve stdout vazio (nem `[]`) — trata como
    // lista vazia em vez de erro de parse, senão mascara erros reais (binário
    // não encontrado, etc.) por trás do mesmo sintoma no chamador.
    if stdout.trim().is_empty() {
        return Ok(Vec::new());
    }
    let entries: Vec<serde_json::Value> =
        serde_json::from_str(&stdout).map_err(|e| format!("fallo al analizar JSON: {e}"))?;

    let target = normalize_path(&cwd);
    let mut sessions: Vec<OpenCodeSessionSnapshot> = entries
        .into_iter()
        .filter_map(|entry| {
            let id = entry.get("id")?.as_str()?.to_string();
            let updated = entry.get("updated")?.as_f64()? as u128;
            // `directory` ausente (versões antigas do CLI) não filtra — melhor
            // incluir do que esconder a sessão do próprio projeto.
            if !target.is_empty() {
                if let Some(directory) = entry.get("directory").and_then(|d| d.as_str()) {
                    if normalize_path(directory) != target {
                        return None;
                    }
                }
            }
            Some(OpenCodeSessionSnapshot {
                id,
                modified_at_ms: updated,
            })
        })
        .collect();

    sessions.sort_by(|a, b| b.modified_at_ms.cmp(&a.modified_at_ms));
    Ok(sessions)
}

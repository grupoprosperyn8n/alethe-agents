use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use tauri::AppHandle;
use tokio::sync::Mutex as AsyncMutex;
use serde_json::Value;

use crate::paths::projects_file_path;
use crate::provider_common::now_ms;

/// Serializa gravações de `projects.json` — evita que duas chamadas concorrentes
/// (reload do front, múltiplas abas/telas) façam `rename` fora de ordem.
static SAVE_MUTEX: OnceLock<AsyncMutex<()>> = OnceLock::new();

/// Sequência (timestamp monotônico) da última gravação física bem-sucedida.
/// Só avança após o `fs::rename` confirmar sucesso — uma falha de I/O não
/// avança isto, permitindo retry com a mesma sequência.
static LAST_WRITE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Acima desse atraso (ms) entre `sequence` e o relógio local do backend, uma
/// gravação com `sequence <= LAST_WRITE_SEQUENCE` é tratada como delay de IPC
/// (mensagem antiga que chegou fora de ordem) e descartada. Abaixo disso, é
/// tratada como plausível (ex.: recuo de relógio do SO) e aceita.
const STALE_WRITE_THRESHOLD_MS: i64 = 2000;

fn save_mutex() -> &'static AsyncMutex<()> {
    SAVE_MUTEX.get_or_init(|| AsyncMutex::new(()))
}

fn external_todo_path(content: &str) -> Option<PathBuf> {
    let parsed: Value = serde_json::from_str(content).ok()?;
    let directory = parsed
        .get("preferences")?
        .get("todoStoragePath")?
        .as_str()?
        .trim();
    if directory.is_empty() {
        return None;
    }
    Some(PathBuf::from(directory).join("todos.jsonc"))
}

fn merge_external_todos(content: String) -> String {
    let Some(path) = external_todo_path(&content) else {
        return content;
    };
    let Ok(external) = fs::read_to_string(path) else {
        return content;
    };
    let Ok(external_json) = serde_json::from_str::<Value>(&external) else {
        return content;
    };
    let Some(todos) = external_json.get("todos").filter(|value| value.is_array()) else {
        return content;
    };
    let Ok(mut parsed) = serde_json::from_str::<Value>(&content) else {
        return content;
    };
    parsed["todos"] = todos.clone();
    serde_json::to_string(&parsed).unwrap_or(content)
}

fn save_external_todos(content: &str) -> Result<(), String> {
    let Some(path) = external_todo_path(content) else {
        return Ok(());
    };
    let Some(parent) = path.parent() else {
        return Ok(());
    };
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let parsed: Value = serde_json::from_str(content).map_err(|error| error.to_string())?;
    let external = serde_json::json!({
        "version": 1,
        "todos": parsed.get("todos").cloned().unwrap_or_else(|| Value::Array(Vec::new())),
    });
    let temporary = path.with_extension("jsonc.tmp");
    fs::write(&temporary, serde_json::to_string_pretty(&external).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    fs::rename(&temporary, &path).map_err(|error| error.to_string())
}


/// Lê `projects.json` cru. Retorna None se o arquivo não existir (primeira
/// abertura). Erros de leitura/parse ficam no front pra decidir se reseta ou
/// mostra erro. Mantemos opaque (String) pra schema poder evoluir só no TS
/// durante o MVP, sem recompilar Rust.
#[tauri::command]
pub fn load_projects(app: AppHandle) -> Result<Option<String>, String> {
    let path = projects_file_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(|content| Some(merge_external_todos(content)))
        .map_err(|error| error.to_string())
}

/// Persiste o JSON cru em `projects.json`. Frontend faz debounce 500ms antes
/// de chamar, e envia `sequence` (timestamp monotônico, ver `writeSequence`
/// em `projectsStore.ts`) pra garantir last-write-wins mesmo se duas chamadas
/// chegarem fora de ordem (reload concorrente, IPC atrasado).
///
/// Escrita atômica via tmp + rename pra não corromper o arquivo se o app
/// crashar no meio (perde no máx. a última escrita).
#[tauri::command]
pub async fn save_projects(app: AppHandle, content: String, sequence: u64) -> Result<(), String> {
    let _guard = save_mutex().lock().await;
    // rust_now só é lido depois do lock adquirido, imediatamente antes da
    // comparação — evita que o tempo de espera pelo mutex conte como "atraso
    // de IPC" da própria mensagem.
    let rust_now = now_ms();
    let last = LAST_WRITE_SEQUENCE.load(Ordering::SeqCst);

    if sequence <= last {
        let delay_ms = rust_now as i64 - sequence as i64;
        if delay_ms > STALE_WRITE_THRESHOLD_MS {
            // Mensagem antiga chegando fora de ordem (IPC delay) — descarta
            // silenciosamente, preservando o que já está em disco.
            return Ok(());
        }
        // sequence <= last mas próximo do relógio atual (ex.: recuo de
        // relógio do SO/NTP) — aceita e deixa LAST_WRITE_SEQUENCE regredir.
        eprintln!(
            "[projects] aviso: sequence {sequence} <= last {last}, mas dentro do limiar \
             de {STALE_WRITE_THRESHOLD_MS}ms (possível recuo de relógio) — gravando mesmo assim."
        );
    }

    let path = projects_file_path(&app)?;
    // I/O em spawn_blocking: escrever/renomear em disco lento (rede, AV scan)
    // não pode bloquear sincronamente a worker thread do Tokio enquanto
    // `_guard` está preso — outro `save_projects` concorrente ficaria preso
    // atrás dele. Mesmo padrão já usado em `clone_github_repo` neste arquivo.
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, &content).map_err(|error| error.to_string())?;
        fs::rename(&tmp, &path).map_err(|error| error.to_string())?;
        save_external_todos(&content)?;
        Ok(())
    })
    .await
    .map_err(|error| format!("save_projects: fallo en la tarea bloqueante: {error}"))??;

    // Só avança a sequência após a gravação física confirmar sucesso — uma
    // falha acima (write/rename) retorna Err antes de chegar aqui, e o
    // próximo retry com a mesma `sequence` é aceito normalmente.
    LAST_WRITE_SEQUENCE.store(sequence, Ordering::SeqCst);
    Ok(())
}

/// Normaliza uma URL do GitHub (suporta `https://github.com/usr/repo`, `github.com/usr/repo`, `usr/repo` ou `git@...`).
/// Nome de pasta que o `git clone` usaria: último segmento da URL, sem `.git`.
fn repo_folder_name(normalized_url: &str) -> String {
    let name = normalized_url
        .trim_end_matches('/')
        .rsplit(['/', ':'])
        .next()
        .unwrap_or("repo")
        .trim_end_matches(".git");
    let sanitized: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' { c } else { '_' })
        .collect();
    if sanitized.is_empty() {
        "repo".to_string()
    } else {
        sanitized
    }
}

/// `target_dir` vazio = deixa o app escolher. Antes o frontend montava um
/// `D:\Projetos\<nome>` fixo, que não existe na maioria das máquinas e nem faz
/// sentido fora do Windows. O default agora é `~/SO Multi Agente/<repo>`, e um diretório
/// escolhido pelo usuário é usado como PAI do clone (o `git clone` cria a pasta
/// do repo dentro dele), a menos que já termine no nome do repo.
fn resolve_clone_target(requested: &str, normalized_url: &str) -> Result<String, String> {
    let folder = repo_folder_name(normalized_url);
    let trimmed = requested.trim();
    let base = if trimmed.is_empty() {
        dirs_next::home_dir()
            .ok_or_else(|| "No fue posible localizar la carpeta del usuario".to_string())?
            .join("SO Multi Agente")
    } else {
        std::path::PathBuf::from(trimmed)
    };
    let target = if base.file_name().and_then(|n| n.to_str()) == Some(folder.as_str()) {
        base
    } else {
        base.join(&folder)
    };
    Ok(target.to_string_lossy().to_string())
}

fn normalize_github_url(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") || trimmed.starts_with("git@") {
        trimmed.to_string()
    } else if trimmed.starts_with("github.com/") {
        format!("https://{trimmed}")
    } else if trimmed.contains('/') && !trimmed.contains(' ') {
        format!("https://github.com/{trimmed}")
    } else {
        trimmed.to_string()
    }
}

/// Clona um repositório do GitHub no diretório de destino e gera os arquivos de contexto inicial.
#[tauri::command]
pub async fn clone_github_repo(url: String, target_dir: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let normalized = normalize_github_url(&url);
        let target_dir = resolve_clone_target(&target_dir, &normalized)?;
        let target_path = std::path::PathBuf::from(&target_dir);

        if let Some(parent) = target_path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        // Executa `git clone`
        let mut cmd = std::process::Command::new("git");
        cmd.args(["clone", "--depth", "1", &normalized, &target_dir]);
        crate::git_control::hide_console(&mut cmd);

        let output = cmd.output().map_err(|e| format!("Fallo al ejecutar git clone: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Error al clonar repositorio ({normalized}): {stderr}"));
        }

        // Gera os arquivos de briefing de contexto para os agentes de IA
        let _ = generate_repo_context_files(&target_dir);

        // Auto-wire do Graphify se disponível
        let _ = crate::graphify::graphify_opencode_config_write_inner(target_dir.clone(), None);

        Ok(target_dir)
    })
    .await
    .map_err(|e| format!("Error de concurrencia en la tarea de clonación: {e}"))?
}

/// Analisa o repositório clonado e gera o arquivo `AGENTS.md` e `CLAUDE.md` com briefing inicial.
fn generate_repo_context_files(project_dir: &str) -> Result<(), String> {
    let path = std::path::PathBuf::from(project_dir);
    if !path.exists() {
        return Ok(());
    }

    let readme_content = ["README.md", "README.txt", "readme.md", "README"]
        .iter()
        .find_map(|f| fs::read_to_string(path.join(f)).ok())
        .unwrap_or_else(|| "No se encontró ningún README.".to_string());

    let mut tech_stack = Vec::new();
    if path.join("package.json").exists() { tech_stack.push("Node.js / JavaScript / TypeScript"); }
    if path.join("Cargo.toml").exists() { tech_stack.push("Rust"); }
    if path.join("pyproject.toml").exists() || path.join("requirements.txt").exists() { tech_stack.push("Python"); }
    if path.join("go.mod").exists() { tech_stack.push("Go"); }

    let stack_str = if tech_stack.is_empty() { "No especificada".to_string() } else { tech_stack.join(", ") };

    // Truncar README para os primeiros 1500 caracteres
    let truncated_readme = if readme_content.len() > 1500 {
        format!("{}...", &readme_content[..1500])
    } else {
        readme_content
    };

    let context_markdown = format!(
        "# Contexto Inicial del Proyecto (SO Multi Agente AI Briefing)\n\n\
        > Este repositorio fue clonado con SO Multi Agente. El briefing a continuación describe la aplicación para orientar su asistencia.\n\n\
        ## Tecnologías Detectadas\n- {stack_str}\n\n\
        ## Resumen del Repositorio (README)\n```markdown\n{truncated_readme}\n```\n\n\
        ## Instrucción Importante para el Agente\n\
        Al iniciar la conversación con el usuario en este repositorio, realiza un resumen ejecutivo directo de 2 a 3 frases explicando el propósito de este proyecto.\n"
    );

    let _ = fs::write(path.join("AGENTS.md"), &context_markdown);
    let _ = fs::write(path.join("CLAUDE.md"), &context_markdown);

    Ok(())
}


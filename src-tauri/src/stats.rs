use serde::Serialize;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use sysinfo::System;

#[derive(Serialize, Clone, Debug)]
pub struct MemoryStats {
    pub total_mb: f64,
    pub app_mb: f64,
    pub webview_mb: f64,
    pub ptys_mb: f64,
    pub process_count: usize,
    pub system_total_mb: f64,
    pub system_available_mb: f64,
}

/// Bucket de memória de um processo do subtree do app.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
enum ProcessClass {
    App,
    Webview,
    Pty,
}

/// Classifica um processo do subtree: o próprio app (root ou nome do binário
/// atual, match exato) e os filhos `ensemble` vão pra conta do app; o webview
/// vai pra conta dele; o resto são PTYs. `name` já vem em lowercase.
fn classify_process(pid: usize, root_pid: usize, name: &str, own_names: &[String]) -> ProcessClass {
    if pid == root_pid || own_names.iter().any(|n| n == name) || name.contains("ensemble") {
        ProcessClass::App
    } else if name.contains("msedgewebview2") {
        ProcessClass::Webview
    } else {
        ProcessClass::Pty
    }
}

/// Nomes esperados do binário próprio, derivados em runtime de
/// `std::env::current_exe()` (file_name + stem, lowercase). Match EXATO:
/// processos legacy `alethe` ou o shim CLI não contam como o app.
fn own_process_names() -> Vec<String> {
    let mut names = Vec::new();
    let Ok(exe) = std::env::current_exe() else {
        return names;
    };
    if let Some(file_name) = exe.file_name().and_then(|n| n.to_str()) {
        names.push(file_name.to_ascii_lowercase());
    }
    if let Some(stem) = exe.file_stem().and_then(|n| n.to_str()) {
        let stem = stem.to_ascii_lowercase();
        if !names.contains(&stem) {
            names.push(stem);
        }
    }
    names
}

fn shared_system() -> &'static Mutex<System> {
    static SYS: OnceLock<Mutex<System>> = OnceLock::new();
    SYS.get_or_init(|| Mutex::new(System::new()))
}

pub fn collect_memory_stats() -> MemoryStats {
    use sysinfo::Pid;
    let sys_lock = shared_system();
    let mut sys = sys_lock
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All);
    sys.refresh_memory();

    let system_total_mb = sys.total_memory() as f64 / 1024.0 / 1024.0;
    let system_available_mb = sys.available_memory() as f64 / 1024.0 / 1024.0;

    // BFS no subtree de processos a partir do PID atual.
    let root_pid = std::process::id() as usize;
    let mut visited = std::collections::HashSet::<usize>::new();
    let mut frontier = vec![root_pid];
    while let Some(pid) = frontier.pop() {
        if !visited.insert(pid) {
            continue;
        }
        for (other_pid, process) in sys.processes() {
            // Threads de /proc/<pid>/task/<tid> aparecem como entradas próprias
            // no sysinfo (thread_kind() == Some) — pular, senão cada thread
            // reconta a memória inteira do processo pai.
            if process.thread_kind().is_some() {
                continue;
            }
            if let Some(parent) = process.parent() {
                if parent.as_u32() as usize == pid {
                    frontier.push(other_pid.as_u32() as usize);
                }
            }
        }
    }

    let mut app_bytes: u64 = 0;
    let mut webview_bytes: u64 = 0;
    let mut pty_bytes: u64 = 0;
    let own_names = own_process_names();
    for pid in &visited {
        let Some(process) = sys.process(Pid::from(*pid)) else {
            continue;
        };
        let mem = process.memory();
        let name = process.name().to_string_lossy().to_ascii_lowercase();
        match classify_process(*pid, root_pid, &name, &own_names) {
            ProcessClass::App => app_bytes += mem,
            ProcessClass::Webview => webview_bytes += mem,
            ProcessClass::Pty => pty_bytes += mem,
        }
    }

    let total = app_bytes + webview_bytes + pty_bytes;
    let to_mb = |bytes: u64| (bytes as f64) / 1024.0 / 1024.0;
    MemoryStats {
        total_mb: to_mb(total),
        app_mb: to_mb(app_bytes),
        webview_mb: to_mb(webview_bytes),
        ptys_mb: to_mb(pty_bytes),
        process_count: visited.len(),
        system_total_mb,
        system_available_mb,
    }
}

/// Cache curto (2s): o polling de RAM (a cada 5s) e chamadas próximas não
/// refazem o `refresh_processes(All)`, que varre todos os processos (caro no
/// Windows). O lock do cache serializa chamadas concorrentes.
fn cached_memory_stats() -> MemoryStats {
    static CACHE: OnceLock<Mutex<Option<(Instant, MemoryStats)>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(None));
    let mut guard = cache.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some((at, stats)) = guard.as_ref() {
        if at.elapsed() < Duration::from_secs(2) {
            return stats.clone();
        }
    }
    let fresh = collect_memory_stats();
    *guard = Some((Instant::now(), fresh.clone()));
    fresh
}

#[tauri::command]
pub fn get_memory_stats() -> MemoryStats {
    cached_memory_stats()
}

/// Mesmo sampling cacheado (2s) do comando, pro heartbeat do crash_watch reusar
/// a varredura sem refazer o `refresh_processes(All)` quando o front acabou de pollar.
pub fn memory_stats_cached() -> MemoryStats {
    cached_memory_stats()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn root_pid_is_always_app() {
        assert!(matches!(
            classify_process(42, 42, "anything", &[]),
            ProcessClass::App
        ));
    }

    #[test]
    fn current_binary_name_is_app() {
        let own = vec!["so-multi-agente".to_string()];
        assert!(matches!(
            classify_process(7, 42, "so-multi-agente", &own),
            ProcessClass::App
        ));
    }

    #[test]
    fn legacy_alethe_name_is_not_app() {
        let own = vec!["so-multi-agente".to_string()];
        assert!(matches!(
            classify_process(7, 42, "alethe", &own),
            ProcessClass::Pty
        ));
    }

    #[test]
    fn cli_shim_binary_is_not_app() {
        let own = vec!["so-multi-agente".to_string()];
        assert!(matches!(
            classify_process(7, 42, "so-multi-agente-cli", &own),
            ProcessClass::Pty
        ));
    }

    #[test]
    fn ensemble_children_stay_in_app_bucket() {
        let own = vec!["so-multi-agente".to_string()];
        assert!(matches!(
            classify_process(7, 42, "ensemble", &own),
            ProcessClass::App
        ));
    }

    #[test]
    fn webview_process_is_webview() {
        assert!(matches!(
            classify_process(7, 42, "msedgewebview2", &[]),
            ProcessClass::Webview
        ));
    }

    #[test]
    fn own_process_names_is_not_empty() {
        assert!(!own_process_names().is_empty());
    }
}

//! Starts the Writer service on loopback and stops it gracefully on SIGINT or
//! SIGTERM. Routes and rules live in `writer-api`, and storage in
//! `writer-storage`.

use std::ffi::OsString;
use std::net::{Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use tokio::net::TcpListener;
use tokio::sync::oneshot;
use writer_agent::{
    ChatProvider, DEFAULT_CONVERSATION_MODEL, DEFAULT_OLLAMA_HOST, OllamaConfig, OllamaProvider,
    ScriptedConfig, ScriptedMode, ScriptedProvider, UnconfiguredProvider, normalize_ollama_host,
};
use writer_storage::FilesystemStore;

/// Overrides the loopback port the service listens on.
const PORT_VAR: &str = "WRITER_PORT";
const DEFAULT_PORT: u16 = 8888;
/// Overrides the folder holding Writer's data.
const DATA_DIR_VAR: &str = "WRITER_DATA_DIR";
/// Selects the pair-writer provider (`ollama` by default, `scripted`, or `none`).
const PAIR_WRITER_VAR: &str = "WRITER_PAIR_WRITER";
/// Ollama server address, matching Ollama's own convention and ADR 0010.
const OLLAMA_HOST_VAR: &str = "OLLAMA_HOST";
/// Conversation model name for the Ollama provider.
const CONVERSATION_MODEL_VAR: &str = "WRITER_CONVERSATION_MODEL";
/// Configures the scripted provider's behavior (`ready`, `missing-model`, or `fail-mid-stream`).
const SCRIPTED_MODE_VAR: &str = "WRITER_SCRIPTED_MODE";
const SCRIPTED_FIRST_TOKEN_MS_VAR: &str = "WRITER_SCRIPTED_FIRST_TOKEN_MS";
const SCRIPTED_MS_PER_1000_WORDS_VAR: &str = "WRITER_SCRIPTED_MS_PER_1000_WORDS";
const SCRIPTED_FOLLOWUP_FIRST_TOKEN_MS_VAR: &str = "WRITER_SCRIPTED_FOLLOWUP_FIRST_TOKEN_MS";
const SCRIPTED_TOKENS_PER_SEC_VAR: &str = "WRITER_SCRIPTED_TOKENS_PER_SEC";
const SCRIPTED_REVIEW_MS_VAR: &str = "WRITER_SCRIPTED_REVIEW_MS";
/// How long in-flight requests may run after a shutdown signal.
const DRAIN_DEADLINE: Duration = Duration::from_secs(10);

fn port_from_env() -> Result<u16, String> {
    let invalid = || format!("{PORT_VAR} must be a port number from 1 to 65535");
    match std::env::var(PORT_VAR) {
        Err(std::env::VarError::NotPresent) => Ok(DEFAULT_PORT),
        Ok(value) => match value.parse::<u16>() {
            Ok(port) if port != 0 => Ok(port),
            _ => Err(invalid()),
        },
        Err(std::env::VarError::NotUnicode(_)) => Err(invalid()),
    }
}

/// The data folder from `WRITER_DATA_DIR`, resolved against the working
/// directory, or the build's default.
fn data_dir_from_env() -> Result<PathBuf, String> {
    let invalid = || format!("{DATA_DIR_VAR} must be a non-empty path in valid Unicode");
    let path = match std::env::var(DATA_DIR_VAR) {
        Err(std::env::VarError::NotPresent) => default_data_dir()?,
        Ok(value) if !value.is_empty() => PathBuf::from(value),
        _ => return Err(invalid()),
    };
    std::path::absolute(path).map_err(|_| invalid())
}

/// Debug builds, which `cargo run` produces, keep data in the repository's
/// ignored `.local/data/`; release builds use the per-user data folder.
fn default_data_dir() -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        let repository = Path::new(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(3)
            .unwrap_or(Path::new("."));
        return Ok(repository.join(".local").join("data"));
    }
    platform_data_dir(|name| std::env::var_os(name))
        .ok_or_else(|| format!("cannot find the per-user data folder; set {DATA_DIR_VAR}"))
}

/// The platform's per-user data folder, from the standard environment
/// variables that `var` reads.
fn platform_data_dir(var: impl Fn(&str) -> Option<OsString>) -> Option<PathBuf> {
    let var = |name: &str| {
        var(name)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
    };
    if cfg!(target_os = "macos") {
        var("HOME").map(|home| {
            home.join("Library")
                .join("Application Support")
                .join("Writer")
        })
    } else if cfg!(windows) {
        var("LOCALAPPDATA").map(|local| local.join("Writer"))
    } else {
        var("XDG_DATA_HOME")
            .filter(|data| data.is_absolute())
            .map(|data| data.join("writer"))
            .or_else(|| var("HOME").map(|home| home.join(".local").join("share").join("writer")))
    }
}

fn optional_u64_env(var: &str, default: u64) -> Result<u64, String> {
    let invalid = || format!("{var} must be a non-negative integer");
    match std::env::var(var) {
        Err(std::env::VarError::NotPresent) => Ok(default),
        Ok(value) if value.is_empty() => Ok(default),
        Ok(value) => value.parse::<u64>().map_err(|_| invalid()),
        Err(std::env::VarError::NotUnicode(_)) => Err(invalid()),
    }
}

fn optional_u32_env(var: &str, default: u32) -> Result<u32, String> {
    let invalid = || format!("{var} must be a non-negative integer");
    match std::env::var(var) {
        Err(std::env::VarError::NotPresent) => Ok(default),
        Ok(value) if value.is_empty() => Ok(default),
        Ok(value) => value.parse::<u32>().map_err(|_| invalid()),
        Err(std::env::VarError::NotUnicode(_)) => Err(invalid()),
    }
}

fn scripted_mode_from_env() -> Result<ScriptedMode, String> {
    let invalid = || {
        format!("{SCRIPTED_MODE_VAR} must be one of 'ready', 'missing-model', or 'fail-mid-stream'")
    };
    match std::env::var(SCRIPTED_MODE_VAR) {
        Err(std::env::VarError::NotPresent) => Ok(ScriptedMode::Ready),
        Ok(value) if value.is_empty() || value == "ready" => Ok(ScriptedMode::Ready),
        Ok(value) if value == "missing-model" => Ok(ScriptedMode::MissingModel),
        Ok(value) if value == "fail-mid-stream" => Ok(ScriptedMode::FailMidStream),
        _ => Err(invalid()),
    }
}

fn ollama_host_from_env() -> Result<String, String> {
    match std::env::var(OLLAMA_HOST_VAR) {
        Err(std::env::VarError::NotPresent) => Ok(DEFAULT_OLLAMA_HOST.to_owned()),
        Ok(value) => normalize_ollama_host(&value),
        Err(std::env::VarError::NotUnicode(_)) => {
            Err(format!("{OLLAMA_HOST_VAR} must be valid Unicode"))
        }
    }
}

fn conversation_model_from_env() -> Result<String, String> {
    let invalid = || format!("{CONVERSATION_MODEL_VAR} must be a non-empty model name");
    match std::env::var(CONVERSATION_MODEL_VAR) {
        Err(std::env::VarError::NotPresent) => Ok(DEFAULT_CONVERSATION_MODEL.to_owned()),
        Ok(value) if value.is_empty() => Ok(DEFAULT_CONVERSATION_MODEL.to_owned()),
        Ok(value) if !value.trim().is_empty() => Ok(value.trim().to_owned()),
        _ => Err(invalid()),
    }
}

fn agent_from_env() -> Result<(Arc<dyn ChatProvider>, String), String> {
    let invalid = || format!("{PAIR_WRITER_VAR} must be 'ollama', 'scripted', 'none', or unset");
    let provider = match std::env::var(PAIR_WRITER_VAR) {
        Err(std::env::VarError::NotPresent) => "ollama".to_owned(),
        Ok(value) if value.is_empty() => "ollama".to_owned(),
        Ok(value) => value,
        Err(std::env::VarError::NotUnicode(_)) => return Err(invalid()),
    };

    match provider.as_str() {
        "none" => Ok((Arc::new(UnconfiguredProvider), "none".to_owned())),
        "ollama" => {
            let host = ollama_host_from_env()?;
            let model = conversation_model_from_env()?;
            let config = OllamaConfig {
                host: host.clone(),
                model: model.clone(),
                ..OllamaConfig::default()
            };
            let provider = OllamaProvider::new(config)?;
            Ok((
                Arc::new(provider),
                format!("ollama ({host}, model {model})"),
            ))
        }
        "scripted" => {
            let defaults = ScriptedConfig::default();
            let config = ScriptedConfig {
                first_token_delay: Duration::from_millis(optional_u64_env(
                    SCRIPTED_FIRST_TOKEN_MS_VAR,
                    u64::try_from(defaults.first_token_delay.as_millis()).unwrap_or(2_000),
                )?),
                per_1000_words_delay: Duration::from_millis(optional_u64_env(
                    SCRIPTED_MS_PER_1000_WORDS_VAR,
                    u64::try_from(defaults.per_1000_words_delay.as_millis()).unwrap_or(3_000),
                )?),
                followup_first_token_delay: Duration::from_millis(optional_u64_env(
                    SCRIPTED_FOLLOWUP_FIRST_TOKEN_MS_VAR,
                    u64::try_from(defaults.followup_first_token_delay.as_millis()).unwrap_or(450),
                )?),
                tokens_per_second: optional_u32_env(
                    SCRIPTED_TOKENS_PER_SEC_VAR,
                    defaults.tokens_per_second,
                )?,
                review_delay: Duration::from_millis(optional_u64_env(
                    SCRIPTED_REVIEW_MS_VAR,
                    u64::try_from(defaults.review_delay.as_millis()).unwrap_or(1_200),
                )?),
                mode: scripted_mode_from_env()?,
                model: defaults.model,
            };

            Ok((
                Arc::new(ScriptedProvider::new(config)),
                "scripted".to_owned(),
            ))
        }
        _ => Err(invalid()),
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_target(false)
        .init();

    let (port, data_dir, (agent, agent_label)) = match port_from_env()
        .and_then(|port| Ok((port, data_dir_from_env()?)))
        .and_then(|(port, data_dir)| Ok((port, data_dir, agent_from_env()?)))
    {
        Ok(settings) => settings,
        Err(message) => {
            tracing::error!("{message}");
            return ExitCode::from(2);
        }
    };

    // Register signal handlers before accepting connections, so a signal that
    // arrives during startup still shuts down gracefully.
    let shutdown = match shutdown_signal() {
        Ok(shutdown) => shutdown,
        Err(error) => {
            tracing::error!("cannot install signal handlers: {error}");
            return ExitCode::FAILURE;
        }
    };

    // Open storage before listening, so the service never answers without
    // its data folder. The store stays open, and the folder locked, until
    // the service stops.
    let store = match FilesystemStore::open(&data_dir).await {
        Ok(store) => store,
        Err(error) => {
            tracing::error!("{error}");
            return ExitCode::FAILURE;
        }
    };
    tracing::info!("data folder: {}", data_dir.display());
    tracing::info!("pair writer: {agent_label}");

    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let listener = match TcpListener::bind(address).await {
        Ok(listener) => listener,
        Err(error) => {
            tracing::error!("cannot listen on {address}: {error}");
            return ExitCode::FAILURE;
        }
    };
    tracing::info!("listening on http://{address}");

    let (signalled_tx, signalled_rx) = oneshot::channel();
    let router = writer_api::router_with_agent(Arc::new(store.clone()), agent);
    let server = axum::serve(listener, router).with_graceful_shutdown(async move {
        shutdown.await;
        tracing::info!("shutting down");
        let _ = signalled_tx.send(());
    });
    let deadline = async move {
        if signalled_rx.await.is_ok() {
            tokio::time::sleep(DRAIN_DEADLINE).await;
        } else {
            std::future::pending::<()>().await;
        }
    };

    let status = tokio::select! {
        result = server => match result {
            Ok(()) => {
                tracing::info!("stopped");
                ExitCode::SUCCESS
            }
            Err(error) => {
                tracing::error!("server failed: {error}");
                ExitCode::FAILURE
            }
        },
        () = deadline => {
            tracing::warn!("in-flight requests did not finish within {DRAIN_DEADLINE:?}");
            ExitCode::FAILURE
        }
    };
    drop(store);
    status
}

#[cfg(unix)]
fn shutdown_signal() -> std::io::Result<impl Future<Output = ()>> {
    use tokio::signal::unix::{SignalKind, signal};

    let mut interrupt = signal(SignalKind::interrupt())?;
    let mut terminate = signal(SignalKind::terminate())?;
    Ok(async move {
        tokio::select! {
            _ = interrupt.recv() => {}
            _ = terminate.recv() => {}
        }
    })
}

#[cfg(not(unix))]
fn shutdown_signal() -> std::io::Result<impl Future<Output = ()>> {
    Ok(async {
        let _ = tokio::signal::ctrl_c().await;
    })
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;
    use std::path::PathBuf;

    use super::platform_data_dir;

    fn lookup(pairs: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<OsString> {
        move |name| {
            pairs
                .iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| OsString::from(value))
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn defaults_to_application_support_on_macos() {
        assert_eq!(
            platform_data_dir(lookup(&[("HOME", "/Users/synthetic")])),
            Some(PathBuf::from(
                "/Users/synthetic/Library/Application Support/Writer"
            ))
        );
        assert_eq!(platform_data_dir(lookup(&[("HOME", "")])), None);
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn defaults_to_the_xdg_data_folder_elsewhere() {
        assert_eq!(
            platform_data_dir(lookup(&[
                ("XDG_DATA_HOME", "/data/synthetic"),
                ("HOME", "/home/synthetic")
            ])),
            Some(PathBuf::from("/data/synthetic/writer"))
        );
        // The XDG specification ignores relative paths.
        assert_eq!(
            platform_data_dir(lookup(&[
                ("XDG_DATA_HOME", "relative"),
                ("HOME", "/home/synthetic")
            ])),
            Some(PathBuf::from("/home/synthetic/.local/share/writer"))
        );
        assert_eq!(
            platform_data_dir(lookup(&[("HOME", "/home/synthetic")])),
            Some(PathBuf::from("/home/synthetic/.local/share/writer"))
        );
        assert_eq!(platform_data_dir(lookup(&[])), None);
    }
}

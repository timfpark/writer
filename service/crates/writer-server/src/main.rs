//! Starts the Writer service on loopback and stops it gracefully on SIGINT or
//! SIGTERM. Routes and rules live in `writer-api`.

use std::net::{Ipv4Addr, SocketAddr};
use std::process::ExitCode;
use std::time::Duration;

use tokio::net::TcpListener;
use tokio::sync::oneshot;

/// Overrides the loopback port the service listens on.
const PORT_VAR: &str = "WRITER_PORT";
const DEFAULT_PORT: u16 = 8888;
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

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_target(false)
        .init();

    let port = match port_from_env() {
        Ok(port) => port,
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
    let server = axum::serve(listener, writer_api::router()).with_graceful_shutdown(async move {
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

    tokio::select! {
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
    }
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

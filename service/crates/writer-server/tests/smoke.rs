//! Startup and shutdown smoke test of the `writer-server` executable.
#![cfg(unix)]

use std::ffi::OsStr;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

use tempfile::TempDir;

const TIMEOUT: Duration = Duration::from_secs(20);

/// Kills the server if the test fails before it exits.
struct Server(Child);

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

impl Server {
    /// Starts the server with its data in `data_dir`, so no test reaches a
    /// writer's data.
    fn start(port: &str, data_dir: impl AsRef<OsStr>) -> Self {
        let child = Command::new(env!("CARGO_BIN_EXE_writer-server"))
            .env("WRITER_PORT", port)
            .env("WRITER_DATA_DIR", data_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .expect("writer-server starts");
        Self(child)
    }

    fn wait(&mut self) -> (ExitStatus, String) {
        let started = Instant::now();
        let status = loop {
            if let Some(status) = self.0.try_wait().unwrap() {
                break status;
            }
            assert!(started.elapsed() < TIMEOUT, "writer-server did not exit");
            std::thread::sleep(Duration::from_millis(50));
        };
        let mut stderr = String::new();
        self.0
            .stderr
            .take()
            .unwrap()
            .read_to_string(&mut stderr)
            .unwrap();
        (status, stderr)
    }
}

fn unused_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

fn get_health(port: u16) -> std::io::Result<String> {
    let mut stream = TcpStream::connect(("127.0.0.1", port))?;
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.write_all(
        b"GET /api/v1/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    )?;
    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    Ok(response)
}

/// Waits until the server answers the health request.
fn wait_for_health(server: &mut Server, port: u16) -> String {
    let started = Instant::now();
    loop {
        if let Ok(response) = get_health(port) {
            break response;
        }
        if let Some(status) = server.0.try_wait().unwrap() {
            let (_, stderr) = server.wait();
            panic!("writer-server exited early with {status}: {stderr}");
        }
        assert!(
            started.elapsed() < TIMEOUT,
            "writer-server did not answer on port {port}"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn terminate(server: &mut Server) -> (ExitStatus, String) {
    let killed = Command::new("kill")
        .args(["-TERM", &server.0.id().to_string()])
        .status()
        .unwrap();
    assert!(killed.success());
    server.wait()
}

#[test]
fn serves_health_on_the_configured_port_and_exits_cleanly_on_sigterm() {
    let dir = TempDir::new().unwrap();
    let data = dir.path().join("data");
    let port = unused_port();
    let mut server = Server::start(&port.to_string(), &data);

    let response = wait_for_health(&mut server, port);
    assert!(response.starts_with("HTTP/1.1 200 OK\r\n"), "{response}");
    assert!(response.ends_with(r#"{"status":"ok"}"#), "{response}");
    // The data folder is created on first use, before the service listens.
    assert!(data.join("workspace/.writer/workspace.json").is_file());

    let (status, stderr) = terminate(&mut server);
    assert_eq!(status.code(), Some(0), "writer-server stderr: {stderr}");
    assert!(stderr.contains(&data.display().to_string()), "{stderr}");
}

#[test]
fn rejects_an_invalid_port_with_exit_2() {
    let dir = TempDir::new().unwrap();
    let mut server = Server::start("not-a-port", dir.path());
    let (status, stderr) = server.wait();
    assert_eq!(status.code(), Some(2));
    assert!(stderr.contains("WRITER_PORT"), "{stderr}");
}

#[test]
fn rejects_an_empty_data_folder_setting_with_exit_2() {
    let mut server = Server::start(&unused_port().to_string(), "");
    let (status, stderr) = server.wait();
    assert_eq!(status.code(), Some(2));
    assert!(stderr.contains("WRITER_DATA_DIR"), "{stderr}");
}

#[test]
fn exits_1_naming_a_data_folder_another_service_owns() {
    let dir = TempDir::new().unwrap();
    let data = dir.path().join("data");
    let port = unused_port();
    let mut first = Server::start(&port.to_string(), &data);
    wait_for_health(&mut first, port);

    let mut second = Server::start(&unused_port().to_string(), &data);
    let (status, stderr) = second.wait();
    assert_eq!(status.code(), Some(1));
    assert!(stderr.contains(&data.display().to_string()), "{stderr}");

    let (status, stderr) = terminate(&mut first);
    assert_eq!(status.code(), Some(0), "writer-server stderr: {stderr}");
}

#[test]
fn resolves_a_relative_data_folder_against_the_working_directory() {
    let dir = TempDir::new().unwrap();
    let port = unused_port();
    let child = Command::new(env!("CARGO_BIN_EXE_writer-server"))
        .current_dir(dir.path())
        .env("WRITER_PORT", port.to_string())
        .env("WRITER_DATA_DIR", "relative/data")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .expect("writer-server starts");
    let mut server = Server(child);
    wait_for_health(&mut server, port);
    assert!(dir.path().join("relative/data/workspace").is_dir());
    let (status, stderr) = terminate(&mut server);
    assert_eq!(status.code(), Some(0), "writer-server stderr: {stderr}");
}

fn http_request(port: u16, method: &str, path: &str, body: Option<&str>) -> String {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let payload = body.unwrap_or("");
    let request = match body {
        Some(_) => format!(
            "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
            payload.len()
        ),
        None => format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"),
    };
    stream.write_all(request.as_bytes()).unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    response
}

#[test]
fn document_language_survives_a_service_restart() {
    let dir = TempDir::new().unwrap();
    let data = dir.path().join("data");
    let doc_id = "c0f0a000-0000-4000-8000-000000000041";

    let port = unused_port();
    let mut server = Server::start(&port.to_string(), &data);
    wait_for_health(&mut server, port);
    let create = http_request(
        port,
        "POST",
        "/api/v1/documents",
        Some(
            r#"{"documentId":"c0f0a000-0000-4000-8000-000000000041","parentId":null,"beforeId":null,"title":"Relato","markdown":"¿Dónde está el faro?\n"}"#,
        ),
    );
    assert!(create.starts_with("HTTP/1.1 201 Created\r\n"), "{create}");
    let update = http_request(
        port,
        "PUT",
        &format!("/api/v1/documents/{doc_id}/language"),
        Some(r#"{"language":"es"}"#),
    );
    assert!(update.starts_with("HTTP/1.1 200 OK\r\n"), "{update}");
    assert!(update.contains(r#""language":"es""#), "{update}");
    let (status, stderr) = terminate(&mut server);
    assert_eq!(status.code(), Some(0), "writer-server stderr: {stderr}");

    let port = unused_port();
    let mut restarted = Server::start(&port.to_string(), &data);
    wait_for_health(&mut restarted, port);
    let after = http_request(port, "GET", &format!("/api/v1/documents/{doc_id}"), None);
    assert!(after.starts_with("HTTP/1.1 200 OK\r\n"), "{after}");
    assert!(after.contains(r#""language":"es""#), "{after}");
    let (status, stderr) = terminate(&mut restarted);
    assert_eq!(status.code(), Some(0), "writer-server stderr: {stderr}");
}

#[test]
fn starts_unconfigured_by_default_and_supports_scripted_pair_writer_settings() {
    let dir = TempDir::new().unwrap();
    let data = dir.path().join("data");

    // Default: unconfigured pair writer -> service starts, readiness is false.
    let port = unused_port();
    let mut server = Server::start(&port.to_string(), &data);
    wait_for_health(&mut server, port);
    let status = http_request(port, "GET", "/api/v1/pair-writer", None);
    assert!(status.starts_with("HTTP/1.1 200 OK\r\n"), "{status}");
    assert!(status.contains(r#""ready":false"#), "{status}");
    assert!(status.contains(r#""issue":"notConfigured""#), "{status}");
    let (exit, stderr) = terminate(&mut server);
    assert_eq!(exit.code(), Some(0), "writer-server stderr: {stderr}");

    // Configured scripted provider -> readiness is true.
    let port = unused_port();
    let child = Command::new(env!("CARGO_BIN_EXE_writer-server"))
        .env("WRITER_PORT", port.to_string())
        .env("WRITER_DATA_DIR", &data)
        .env("WRITER_PAIR_WRITER", "scripted")
        .env("WRITER_SCRIPTED_FIRST_TOKEN_MS", "5")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .expect("writer-server starts");
    let mut scripted = Server(child);
    wait_for_health(&mut scripted, port);
    let status = http_request(port, "GET", "/api/v1/pair-writer", None);
    assert!(status.contains(r#""ready":true"#), "{status}");
    assert!(status.contains(r#""provider":"scripted""#), "{status}");
    let (exit, stderr) = terminate(&mut scripted);
    assert_eq!(exit.code(), Some(0), "writer-server stderr: {stderr}");

    // Invalid WRITER_PAIR_WRITER -> exit 2 naming the variable.
    let invalid = Command::new(env!("CARGO_BIN_EXE_writer-server"))
        .env("WRITER_PORT", unused_port().to_string())
        .env("WRITER_DATA_DIR", &data)
        .env("WRITER_PAIR_WRITER", "unknown-provider")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .expect("writer-server starts");
    let mut invalid = Server(invalid);
    let (exit, stderr) = invalid.wait();
    assert_eq!(exit.code(), Some(2));
    assert!(stderr.contains("WRITER_PAIR_WRITER"), "{stderr}");
}

//! Startup and shutdown smoke test of the `writer-server` executable.
#![cfg(unix)]

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

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
    fn start(port: &str) -> Self {
        let child = Command::new(env!("CARGO_BIN_EXE_writer-server"))
            .env("WRITER_PORT", port)
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

#[test]
fn serves_health_on_the_configured_port_and_exits_cleanly_on_sigterm() {
    let port = unused_port();
    let mut server = Server::start(&port.to_string());

    let started = Instant::now();
    let response = loop {
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
    };
    assert!(response.starts_with("HTTP/1.1 200 OK\r\n"), "{response}");
    assert!(response.ends_with(r#"{"status":"ok"}"#), "{response}");

    let killed = Command::new("kill")
        .args(["-TERM", &server.0.id().to_string()])
        .status()
        .unwrap();
    assert!(killed.success());

    let (status, stderr) = server.wait();
    assert_eq!(status.code(), Some(0), "writer-server stderr: {stderr}");
}

#[test]
fn rejects_an_invalid_port_with_exit_2() {
    let mut server = Server::start("not-a-port");
    let (status, stderr) = server.wait();
    assert_eq!(status.code(), Some(2));
    assert!(stderr.contains("WRITER_PORT"), "{stderr}");
}

//! Pair-writer readiness and streaming reply operations, exercised through the
//! served router without binding a socket.
//!
//! Messages, titles, and document prose carry a synthetic marker. Every error
//! response and every captured log line is checked to ensure the marker never
//! appears.

use std::io;
use std::sync::{Arc, Mutex, Once};
use std::time::Duration;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode, header};
use serde_json::json;
use tempfile::TempDir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tower::ServiceExt;
use writer_agent::{
    AgentFuture, ChatProvider, ChatTurnRequest, DEFAULT_CONVERSATION_MODEL, DEFAULT_SCRIPTED_MODEL,
    OllamaConfig, OllamaProvider, PairWriterStatus, ReplyError, ReplyEvent, ReplyStream,
    ReviewRequest, ReviewResponse, ScriptedConfig, ScriptedMode, ScriptedProvider,
    UnconfiguredProvider,
};
use writer_api::{
    ChatReplyDelta, ChatReplyDone, PairWriterIssue, PairWriterReviewResponse,
    PairWriterStatus as ApiStatus, Problem, ProblemCode, ReviewAgentKind,
};
use writer_storage::FilesystemStore;

const MARKER: &str = "SYNTHETIC-PAIR-WRITER-MARKER-9b2d4e";

static LOGS: Mutex<Vec<u8>> = Mutex::new(Vec::new());

struct LogWriter;

impl io::Write for LogWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        LOGS.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn capture_logs() {
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        tracing_subscriber::fmt()
            .with_max_level(tracing::Level::TRACE)
            .with_writer(|| LogWriter)
            .init();
    });
}

fn assert_no_marker_in_logs() {
    let logs = String::from_utf8_lossy(&LOGS.lock().unwrap()).into_owned();
    assert!(
        !logs.contains(MARKER),
        "a log line contained the synthetic marker:\n{logs}"
    );
}

async fn router_for(agent: Arc<dyn ChatProvider>) -> (TempDir, Router) {
    capture_logs();
    let dir = tempfile::tempdir().unwrap();
    let store = FilesystemStore::open(dir.path()).await.unwrap();
    let router = writer_api::router_with_agent(Arc::new(store), agent);
    (dir, router)
}

fn fast_scripted(mode: ScriptedMode) -> Arc<dyn ChatProvider> {
    Arc::new(ScriptedProvider::new(ScriptedConfig {
        first_token_delay: Duration::from_millis(1),
        per_1000_words_delay: Duration::ZERO,
        followup_first_token_delay: Duration::from_millis(1),
        tokens_per_second: 0,
        review_delay: Duration::from_millis(1),
        mode,
        model: DEFAULT_SCRIPTED_MODEL.to_owned(),
    }))
}

fn parse_sse(body: &str) -> Vec<(String, String)> {
    let mut events = Vec::new();
    let mut event_name = String::new();
    let mut data_lines = Vec::new();

    for line in body.lines() {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.is_empty() {
            if !event_name.is_empty() || !data_lines.is_empty() {
                events.push((
                    std::mem::take(&mut event_name),
                    std::mem::take(&mut data_lines).join("\n"),
                ));
            }
            continue;
        }
        if line.starts_with(':') {
            continue;
        }
        if let Some(name) = line.strip_prefix("event:") {
            event_name = name.trim().to_owned();
        } else if let Some(data) = line.strip_prefix("data:") {
            data_lines.push(data.trim_start().to_owned());
        }
    }
    if !event_name.is_empty() || !data_lines.is_empty() {
        events.push((event_name, data_lines.join("\n")));
    }
    events
}

fn sample_body() -> String {
    json!({
        "message": format!("Give me some ideas about how I can improve this text ({MARKER})"),
        "document": {
            "documentId": "a0000000-0000-4000-8000-000000000001",
            "title": format!("Chapter 1 {MARKER}"),
            "content": format!("The keeper climbed the stairs twice before lighting the lamp near {MARKER}.\n\nCold rain rattled against the window pane.\n")
        },
        "selection": {
            "text": format!("The keeper climbed the stairs twice before lighting the lamp near {MARKER}.")
        },
        "contextDocuments": [
            {
                "documentId": "a0000000-0000-4000-8000-000000000002",
                "title": format!("Harbor Notes {MARKER}"),
                "content": format!("The tide falls early in November {MARKER}.")
            }
        ],
        "history": [
            { "role": "writer", "text": format!("Earlier note {MARKER}") },
            { "role": "assistant", "text": format!("Earlier reply {MARKER}") }
        ]
    })
    .to_string()
}

#[tokio::test]
async fn unconfigured_pair_writer_reports_not_ready_and_returns_503() {
    let (_dir, router) = router_for(Arc::new(UnconfiguredProvider)).await;

    let response = router
        .clone()
        .oneshot(
            Request::get("/api/v1/pair-writer")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let status: ApiStatus = serde_json::from_slice(&body).unwrap();
    assert!(!status.ready);
    assert_eq!(status.issue, Some(PairWriterIssue::NotConfigured));
    assert!(status.detail.is_some());

    let reply_response = router
        .oneshot(
            Request::post("/api/v1/pair-writer/replies")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(sample_body()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(reply_response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        reply_response.headers()[header::CONTENT_TYPE],
        "application/problem+json"
    );
    let bytes = to_bytes(reply_response.into_body(), usize::MAX)
        .await
        .unwrap();
    let text = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(!text.contains(MARKER), "503 problem echoed marker: {text}");
    let problem: Problem = serde_json::from_str(&text).unwrap();
    assert_eq!(problem.code, ProblemCode::Unavailable);
    assert_no_marker_in_logs();
}

#[tokio::test]
async fn scripted_provider_streams_deltas_and_done_without_logging_prose() {
    let (_dir, router) = router_for(fast_scripted(ScriptedMode::Ready)).await;

    let status_res = router
        .clone()
        .oneshot(
            Request::get("/api/v1/pair-writer")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(status_res.status(), StatusCode::OK);
    let status: ApiStatus =
        serde_json::from_slice(&to_bytes(status_res.into_body(), usize::MAX).await.unwrap())
            .unwrap();
    assert!(status.ready);
    assert_eq!(status.provider.as_deref(), Some("scripted"));
    assert_eq!(status.model.as_deref(), Some(DEFAULT_SCRIPTED_MODEL));

    let response = router
        .oneshot(
            Request::post("/api/v1/pair-writer/replies")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(sample_body()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(
        response.headers()[header::CONTENT_TYPE]
            .to_str()
            .unwrap()
            .starts_with("text/event-stream")
    );

    let body = String::from_utf8(
        to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    let events = parse_sse(&body);
    let mut reply_text = String::new();
    let mut done: Option<ChatReplyDone> = None;

    for (name, data) in events {
        match name.as_str() {
            "delta" => {
                let delta: ChatReplyDelta = serde_json::from_str(&data).unwrap();
                reply_text.push_str(&delta.text);
            }
            "done" => {
                done = Some(serde_json::from_str(&data).unwrap());
            }
            other => panic!("unexpected event {other}: {data}"),
        }
    }

    assert!(
        reply_text.contains(
            "\"The keeper climbed the stairs twice before lighting the lamp near SYNTHETIC-PAIR-WRITER-MARKER-9b2d4e.\""
        ),
        "reply did not quote the selection verbatim: {reply_text}"
    );
    let done = done.expect("done event");
    assert_eq!(done.model, DEFAULT_SCRIPTED_MODEL);
    assert_eq!(done.prompt_version, None);
    assert_eq!(done.sources.len(), 4);
    assert_no_marker_in_logs();
}

#[tokio::test]
async fn scripted_missing_model_reports_missing_model_and_rejects_turn_with_503() {
    let (_dir, router) = router_for(fast_scripted(ScriptedMode::MissingModel)).await;

    let status_res = router
        .clone()
        .oneshot(
            Request::get("/api/v1/pair-writer")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status: ApiStatus =
        serde_json::from_slice(&to_bytes(status_res.into_body(), usize::MAX).await.unwrap())
            .unwrap();
    assert!(!status.ready);
    assert_eq!(status.issue, Some(PairWriterIssue::ModelMissing));
    assert_eq!(status.model.as_deref(), Some(DEFAULT_SCRIPTED_MODEL));

    let response = router
        .oneshot(
            Request::post("/api/v1/pair-writer/replies")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(sample_body()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let text = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(!text.contains(MARKER));
    let problem: Problem = serde_json::from_str(&text).unwrap();
    assert_eq!(problem.code, ProblemCode::Unavailable);
    assert_no_marker_in_logs();
}

#[tokio::test]
async fn scripted_fail_mid_stream_emits_delta_then_error_problem() {
    let (_dir, router) = router_for(fast_scripted(ScriptedMode::FailMidStream)).await;

    let response = router
        .oneshot(
            Request::post("/api/v1/pair-writer/replies")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(sample_body()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = String::from_utf8(
        to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    let events = parse_sse(&body);
    let mut deltas = 0usize;
    let mut error_problem: Option<Problem> = None;

    for (name, data) in events {
        match name.as_str() {
            "delta" => deltas += 1,
            "error" => {
                assert!(!data.contains(MARKER), "SSE error echoed marker: {data}");
                error_problem = Some(serde_json::from_str(&data).unwrap());
            }
            "done" => panic!("unexpected done after mid-stream failure"),
            other => panic!("unexpected event {other}"),
        }
    }

    assert!(deltas >= 1);
    let problem = error_problem.expect("error event");
    assert_eq!(problem.code, ProblemCode::UpstreamFailed);
    assert_eq!(problem.status, 502);
    assert_no_marker_in_logs();
}

#[tokio::test]
async fn invalid_reply_request_returns_422_without_echoing_marker() {
    let (_dir, router) = router_for(fast_scripted(ScriptedMode::Ready)).await;
    let invalid = json!({
        "message": "   ",
        "document": {
            "documentId": "",
            "title": format!("Title {MARKER}"),
            "content": format!("Prose {MARKER}\0null")
        }
    })
    .to_string();

    let response = router
        .oneshot(
            Request::post("/api/v1/pair-writer/replies")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(invalid))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let text = String::from_utf8(
        to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    assert!(!text.contains(MARKER), "422 echoed marker: {text}");
    let problem: Problem = serde_json::from_str(&text).unwrap();
    assert_eq!(problem.code, ProblemCode::ValidationFailed);
    let pointers: Vec<&str> = problem.errors.iter().map(|e| e.pointer.as_str()).collect();
    assert!(pointers.contains(&"/message"));
    assert!(pointers.contains(&"/document/documentId"));
    assert!(pointers.contains(&"/document/content"));
    assert_no_marker_in_logs();
}

struct DisconnectProbeProvider {
    cancelled: Arc<tokio::sync::Notify>,
}

impl ChatProvider for DisconnectProbeProvider {
    fn status(&self) -> AgentFuture<'_, PairWriterStatus> {
        Box::pin(async {
            PairWriterStatus {
                ready: true,
                provider: Some("probe".to_owned()),
                model: Some("probe".to_owned()),
                issue: None,
                detail: None,
            }
        })
    }

    fn reply(&self, _request: ChatTurnRequest) -> AgentFuture<'_, Result<ReplyStream, ReplyError>> {
        let cancelled = Arc::clone(&self.cancelled);
        Box::pin(async move {
            let (tx, rx) = tokio::sync::mpsc::channel(4);
            tokio::spawn(async move {
                let _ = tx.send(ReplyEvent::Delta("start ".to_owned())).await;
                tx.closed().await;
                cancelled.notify_one();
            });
            Ok(ReplyStream::from_receiver(rx))
        })
    }

    fn review(
        &self,
        _request: ReviewRequest,
    ) -> AgentFuture<'_, Result<ReviewResponse, ReplyError>> {
        Box::pin(async {
            Ok(ReviewResponse {
                items: vec![],
                model: "probe".to_owned(),
                prompt_version: None,
            })
        })
    }
}

#[tokio::test]
async fn dropping_sse_response_cancels_provider_generation() {
    let cancelled = Arc::new(tokio::sync::Notify::new());
    let (_dir, router) = router_for(Arc::new(DisconnectProbeProvider {
        cancelled: Arc::clone(&cancelled),
    }))
    .await;
    let response = router
        .oneshot(
            Request::post("/api/v1/pair-writer/replies")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(sample_body()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    drop(response);
    tokio::time::timeout(Duration::from_secs(2), cancelled.notified())
        .await
        .expect("dropping the SSE response should notify the producer to stop");
}

#[derive(Clone)]
enum FakeOllamaMode {
    StreamWithMarker,
    MissingModel,
    FailEchoingMarker,
    StallAfterDelta,
    HoldUntilClosed,
}

async fn read_http_req(stream: &mut TcpStream) -> Option<(String, String)> {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 4096];
    let header_end = loop {
        let n = stream.read(&mut tmp).await.ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&tmp[..n]);
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos + 4;
        }
    };
    let headers = String::from_utf8_lossy(&buf[..header_end]).into_owned();
    let first_line = headers.lines().next()?;
    let mut parts = first_line.split_whitespace();
    let method = parts.next()?.to_owned();
    let path = parts.next()?.to_owned();
    let content_length = headers
        .lines()
        .find_map(|line| {
            let (k, v) = line.split_once(':')?;
            if k.eq_ignore_ascii_case("content-length") {
                v.trim().parse::<usize>().ok()
            } else {
                None
            }
        })
        .unwrap_or(0);
    let mut body_len = buf.len().saturating_sub(header_end);
    while body_len < content_length {
        let n = stream.read(&mut tmp).await.ok()?;
        if n == 0 {
            break;
        }
        body_len += n;
    }
    Some((method, path))
}

async fn write_json(stream: &mut TcpStream, status: &str, body: &str) {
    let resp = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(resp.as_bytes()).await;
    let _ = stream.flush().await;
}

async fn write_chunk(stream: &mut TcpStream, payload: &str) {
    let header = format!("{:x}\r\n", payload.len());
    let _ = stream.write_all(header.as_bytes()).await;
    let _ = stream.write_all(payload.as_bytes()).await;
    let _ = stream.write_all(b"\r\n").await;
    let _ = stream.flush().await;
}

async fn start_fake_ollama(
    mode: FakeOllamaMode,
) -> (String, Arc<tokio::sync::Notify>, Arc<tokio::sync::Notify>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let chat_started = Arc::new(tokio::sync::Notify::new());
    let chat_disconnected = Arc::new(tokio::sync::Notify::new());
    let started_clone = Arc::clone(&chat_started);
    let disconnected_clone = Arc::clone(&chat_disconnected);

    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            let mode = mode.clone();
            let started = Arc::clone(&started_clone);
            let disconnected = Arc::clone(&disconnected_clone);
            tokio::spawn(async move {
                let Some((method, path)) = read_http_req(&mut socket).await else {
                    return;
                };
                match (method.as_str(), path.as_str()) {
                    ("GET", "/api/tags") => {
                        let body = match mode {
                            FakeOllamaMode::MissingModel => json!({ "models": [] }).to_string(),
                            _ => json!({
                                "models": [{ "name": DEFAULT_CONVERSATION_MODEL, "digest": "d1" }]
                            })
                            .to_string(),
                        };
                        write_json(&mut socket, "200 OK", &body).await;
                    }
                    ("POST", "/api/show") => {
                        let body = json!({
                            "capabilities": ["completion", "thinking"],
                            "thinking": { "values": [false, true] }
                        })
                        .to_string();
                        write_json(&mut socket, "200 OK", &body).await;
                    }
                    ("POST", "/api/chat") => {
                        started.notify_one();
                        match mode {
                            FakeOllamaMode::StreamWithMarker => {
                                let _ = socket
                                    .write_all(
                                        b"HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
                                    )
                                    .await;
                                let delta = json!({
                                    "message": {
                                        "role": "assistant",
                                        "content": format!("1. Look at \"The keeper climbed the stairs twice before lighting the lamp near {MARKER}.\"")
                                    },
                                    "done": false
                                })
                                .to_string();
                                write_chunk(&mut socket, &format!("{delta}\n")).await;
                                let done = json!({
                                    "message": { "role": "assistant", "content": "" },
                                    "done": true,
                                    "total_duration": 2_100_000_000u64,
                                    "load_duration": 50_000_000u64,
                                    "prompt_eval_count": 320u64,
                                    "prompt_eval_duration": 1_200_000_000u64,
                                    "eval_count": 42u64,
                                    "eval_duration": 850_000_000u64
                                })
                                .to_string();
                                write_chunk(&mut socket, &format!("{done}\n")).await;
                                let _ = socket.write_all(b"0\r\n\r\n").await;
                                let _ = socket.flush().await;
                            }
                            FakeOllamaMode::FailEchoingMarker => {
                                let _ = socket
                                    .write_all(
                                        b"HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
                                    )
                                    .await;
                                write_chunk(
                                    &mut socket,
                                    "{\"message\":{\"role\":\"assistant\",\"content\":\"Start \"},\"done\":false}\n",
                                )
                                .await;
                                let err_line = json!({
                                    "error": format!("upstream boom echoing {MARKER}")
                                })
                                .to_string();
                                write_chunk(&mut socket, &format!("{err_line}\n")).await;
                                let _ = socket.write_all(b"0\r\n\r\n").await;
                            }
                            FakeOllamaMode::StallAfterDelta => {
                                let _ = socket
                                    .write_all(
                                        b"HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
                                    )
                                    .await;
                                write_chunk(
                                    &mut socket,
                                    "{\"message\":{\"role\":\"assistant\",\"content\":\"Halfway\"},\"done\":false}\n",
                                )
                                .await;
                                let mut buf = [0u8; 64];
                                let _ = socket.read(&mut buf).await;
                            }
                            FakeOllamaMode::HoldUntilClosed => {
                                let mut buf = [0u8; 64];
                                let _ = socket.read(&mut buf).await;
                                disconnected.notify_one();
                            }
                            FakeOllamaMode::MissingModel => {
                                write_json(&mut socket, "404 Not Found", "{}").await;
                            }
                        }
                    }
                    _ => write_json(&mut socket, "404 Not Found", "{}").await,
                }
            });
        }
    });

    (format!("http://{addr}"), chat_started, chat_disconnected)
}

#[tokio::test]
async fn ollama_provider_streams_metrics_and_prompt_version_without_logging_marker() {
    let (host, _, _) = start_fake_ollama(FakeOllamaMode::StreamWithMarker).await;
    let provider = OllamaProvider::new(OllamaConfig {
        host,
        ..OllamaConfig::default()
    })
    .unwrap();
    let (_dir, router) = router_for(Arc::new(provider)).await;

    let status_res = router
        .clone()
        .oneshot(
            Request::get("/api/v1/pair-writer")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status: ApiStatus =
        serde_json::from_slice(&to_bytes(status_res.into_body(), usize::MAX).await.unwrap())
            .unwrap();
    assert!(status.ready);
    assert_eq!(status.provider.as_deref(), Some("ollama"));
    assert_eq!(status.model.as_deref(), Some(DEFAULT_CONVERSATION_MODEL));

    let response = router
        .oneshot(
            Request::post("/api/v1/pair-writer/replies")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(sample_body()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = String::from_utf8(
        to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    let events = parse_sse(&body);
    let mut reply_text = String::new();
    let mut done: Option<ChatReplyDone> = None;
    for (name, data) in events {
        match name.as_str() {
            "delta" => {
                let delta: ChatReplyDelta = serde_json::from_str(&data).unwrap();
                reply_text.push_str(&delta.text);
            }
            "done" => done = Some(serde_json::from_str(&data).unwrap()),
            other => panic!("unexpected event {other}: {data}"),
        }
    }
    assert!(reply_text.contains(MARKER));
    let done = done.expect("done event");
    assert_eq!(done.model, DEFAULT_CONVERSATION_MODEL);
    assert_eq!(
        done.prompt_version.as_deref(),
        Some("conversation-grounded@c0a3c0b9f874")
    );
    let metrics = done.metrics.expect("Ollama metrics in done event");
    assert!(metrics.first_token_ms.is_some());
    assert_eq!(metrics.total_ms, Some(2_100));
    assert_eq!(metrics.load_ms, Some(50));
    assert_eq!(metrics.prompt_eval_ms, Some(1_200));
    assert_eq!(metrics.eval_ms, Some(850));
    assert_eq!(metrics.prompt_tokens, Some(320));
    assert_eq!(metrics.output_tokens, Some(42));
    assert_no_marker_in_logs();
}

#[tokio::test]
async fn ollama_missing_model_and_failures_never_leak_marker() {
    // 1. Missing model -> 503 unavailable before stream.
    let (host, _, _) = start_fake_ollama(FakeOllamaMode::MissingModel).await;
    let provider = OllamaProvider::new(OllamaConfig {
        host,
        ..OllamaConfig::default()
    })
    .unwrap();
    let (_dir, router) = router_for(Arc::new(provider)).await;

    let res = router
        .oneshot(
            Request::post("/api/v1/pair-writer/replies")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(sample_body()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::SERVICE_UNAVAILABLE);
    let text = String::from_utf8(
        to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    assert!(!text.contains(MARKER), "503 leaked marker: {text}");
    let problem: Problem = serde_json::from_str(&text).unwrap();
    assert_eq!(problem.code, ProblemCode::Unavailable);

    // 2. Mid-stream upstream error echoing marker -> SSE error upstreamFailed without marker.
    let (host, _, _) = start_fake_ollama(FakeOllamaMode::FailEchoingMarker).await;
    let provider = OllamaProvider::new(OllamaConfig {
        host,
        ..OllamaConfig::default()
    })
    .unwrap();
    let (_dir, router) = router_for(Arc::new(provider)).await;

    let res = router
        .oneshot(
            Request::post("/api/v1/pair-writer/replies")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(sample_body()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body = String::from_utf8(
        to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    let events = parse_sse(&body);
    let err_data = events
        .into_iter()
        .find_map(|(name, data)| (name == "error").then_some(data))
        .expect("SSE error event");
    assert!(
        !err_data.contains(MARKER),
        "SSE error leaked marker: {err_data}"
    );
    let problem: Problem = serde_json::from_str(&err_data).unwrap();
    assert_eq!(problem.code, ProblemCode::UpstreamFailed);
    assert_eq!(problem.status, 502);

    // 3. Mid-stream timeout -> SSE error upstreamTimeout without marker.
    let (host, _, _) = start_fake_ollama(FakeOllamaMode::StallAfterDelta).await;
    let provider = OllamaProvider::new(OllamaConfig {
        host,
        idle_timeout: Duration::from_millis(120),
        ..OllamaConfig::default()
    })
    .unwrap();
    let (_dir, router) = router_for(Arc::new(provider)).await;

    let res = router
        .oneshot(
            Request::post("/api/v1/pair-writer/replies")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(sample_body()))
                .unwrap(),
        )
        .await
        .unwrap();
    let body = String::from_utf8(
        to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    let events = parse_sse(&body);
    let err_data = events
        .into_iter()
        .find_map(|(name, data)| (name == "error").then_some(data))
        .expect("SSE timeout error event");
    assert!(
        !err_data.contains(MARKER),
        "SSE timeout leaked marker: {err_data}"
    );
    let problem: Problem = serde_json::from_str(&err_data).unwrap();
    assert_eq!(problem.code, ProblemCode::UpstreamTimeout);
    assert_eq!(problem.status, 504);

    assert_no_marker_in_logs();
}

#[tokio::test]
async fn scripted_review_returns_five_agent_kinds_with_anchors_and_audit() {
    let (_dir, router) = router_for(fast_scripted(ScriptedMode::Ready)).await;

    let body = json!({
        "documentId": "a0000000-0000-4000-8000-000000000001",
        "title": format!("Harbor Chapter {MARKER}"),
        "documentWordCount": 60,
        "passages": [
            {
                "passageId": "p-1",
                "index": 0,
                "text": format!("The harbor felt very dark beneath the pier near {MARKER}."),
                "contentHash": "h-1"
            },
            {
                "passageId": "p-2",
                "index": 1,
                "text": "Mara paused at the dock before she told her to wait.",
                "contentHash": "h-2"
            },
            {
                "passageId": "p-3",
                "index": 2,
                "text": "She never told the keeper where the brass key lay.",
                "contentHash": "h-3"
            },
            {
                "passageId": "p-4",
                "index": 3,
                "text": "Tom walked along the seawall and opens the rusted gate.",
                "contentHash": "h-4"
            },
            {
                "passageId": "p-5",
                "index": 4,
                "text": "Cold lantern light spilled from the lantern along the quay.",
                "contentHash": "h-5"
            }
        ]
    })
    .to_string();

    let response = router
        .oneshot(
            Request::post("/api/v1/pair-writer/reviews")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let review: PairWriterReviewResponse = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(review.model, DEFAULT_SCRIPTED_MODEL);
    assert!(review.prompt_version.is_some());

    let agents: Vec<ReviewAgentKind> = review.items.iter().map(|f| f.agent).collect();
    assert!(agents.contains(&ReviewAgentKind::WeakProse));
    assert!(agents.contains(&ReviewAgentKind::Clarity));
    assert!(agents.contains(&ReviewAgentKind::OpenQuestions));
    assert!(agents.contains(&ReviewAgentKind::PovTense));
    assert!(agents.contains(&ReviewAgentKind::Repetition));
    for finding in &review.items {
        assert!(!finding.finding_id.is_empty());
        assert!(!finding.anchor.quote.is_empty());
        assert!(finding.anchor.start_offset < finding.anchor.end_offset);
        assert_eq!(finding.audit.trigger, "Short typing pause");
        assert_eq!(finding.audit.sources.len(), 1);
    }
    assert_no_marker_in_logs();
}

#[tokio::test]
async fn review_validates_and_handles_unavailable_without_leaking_marker() {
    let (_dir, router) = router_for(fast_scripted(ScriptedMode::Ready)).await;

    let invalid = json!({
        "documentId": "",
        "title": format!("Draft {MARKER}"),
        "passages": []
    })
    .to_string();
    let res = router
        .oneshot(
            Request::post("/api/v1/pair-writer/reviews")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(invalid))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let text = String::from_utf8(
        to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    assert!(!text.contains(MARKER), "422 leaked marker: {text}");
    let problem: Problem = serde_json::from_str(&text).unwrap();
    assert_eq!(problem.code, ProblemCode::ValidationFailed);

    let (_dir2, unconfigured) = router_for(Arc::new(UnconfiguredProvider)).await;
    let valid = json!({
        "documentId": "a0000000-0000-4000-8000-000000000001",
        "title": format!("Draft {MARKER}"),
        "passages": [{
            "passageId": "p-1",
            "index": 0,
            "text": format!("The pier felt very dark near {MARKER}."),
            "contentHash": "h-1"
        }]
    })
    .to_string();
    let res = unconfigured
        .oneshot(
            Request::post("/api/v1/pair-writer/reviews")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(valid))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::SERVICE_UNAVAILABLE);
    let text = String::from_utf8(
        to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    assert!(!text.contains(MARKER), "503 leaked marker: {text}");
    let problem: Problem = serde_json::from_str(&text).unwrap();
    assert_eq!(problem.code, ProblemCode::Unavailable);

    assert_no_marker_in_logs();
}

#[tokio::test]
async fn reply_accepts_pinned_finding_and_records_it_in_what_it_read() {
    let (_dir, router) = router_for(fast_scripted(ScriptedMode::Ready)).await;
    let body = json!({
        "message": "How might I tighten this?",
        "document": {
            "documentId": "a0000000-0000-4000-8000-000000000001",
            "title": "Harbor Chapter",
            "content": "The harbor felt very dark beneath the low pier.\n"
        },
        "finding": {
            "agent": "Weak prose",
            "quote": "very dark",
            "note": "The intensifier softens the image."
        }
    })
    .to_string();

    let response = router
        .oneshot(
            Request::post("/api/v1/pair-writer/replies")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let raw = String::from_utf8(
        to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    let events = parse_sse(&raw);
    let mut reply_text = String::new();
    let mut done: Option<ChatReplyDone> = None;
    for (name, data) in events {
        if name == "delta" {
            let delta: ChatReplyDelta = serde_json::from_str(&data).unwrap();
            reply_text.push_str(&delta.text);
        } else if name == "done" {
            done = Some(serde_json::from_str(&data).unwrap());
        }
    }
    assert!(reply_text.contains("\"very dark\""), "reply: {reply_text}");
    let done = done.expect("done event");
    assert!(
        done.sources
            .iter()
            .any(|s| s.kind == writer_api::ChatSourceKind::Finding)
    );
}

#[tokio::test]
async fn dropping_sse_response_cancels_in_flight_ollama_request() {
    let (host, chat_started, chat_disconnected) =
        start_fake_ollama(FakeOllamaMode::HoldUntilClosed).await;
    let provider = OllamaProvider::new(OllamaConfig {
        host,
        ..OllamaConfig::default()
    })
    .unwrap();
    let (_dir, router) = router_for(Arc::new(provider)).await;

    let response = router
        .oneshot(
            Request::post("/api/v1/pair-writer/replies")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(sample_body()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    tokio::time::timeout(Duration::from_secs(2), chat_started.notified())
        .await
        .expect("fake Ollama should receive the chat request");
    drop(response);
    tokio::time::timeout(Duration::from_secs(2), chat_disconnected.notified())
        .await
        .expect("dropping the SSE response should cancel the in-flight Ollama request");
    assert_no_marker_in_logs();
}

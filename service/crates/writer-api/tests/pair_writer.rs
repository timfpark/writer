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
use tower::ServiceExt;
use writer_agent::{
    AgentFuture, ChatProvider, ChatTurnRequest, DEFAULT_SCRIPTED_MODEL, PairWriterStatus,
    ReplyError, ReplyEvent, ReplyStream, ScriptedConfig, ScriptedMode, ScriptedProvider,
    UnconfiguredProvider,
};
use writer_api::{
    ChatReplyDelta, ChatReplyDone, PairWriterIssue, PairWriterStatus as ApiStatus, Problem,
    ProblemCode,
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

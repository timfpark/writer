//! Provisional pair-writer readiness and streamed chat reply endpoints.
//!
//! Follows ADR 0004's SSE framing: pre-stream failures return `Problem`
//! (`application/problem+json`), and in-stream failures emit an `error` event
//! carrying a `Problem` before closing. No message, document, or reply text
//! is ever logged or placed in an error response.

use std::convert::Infallible;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use axum::Json as AxumJson;
use axum::extract::State;
use axum::response::Sse;
use axum::response::sse::{Event, KeepAlive};
use futures_core::Stream;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use writer_agent::{
    self as agent, ChatProvider, ChatTurnRequest, ContextDocument, DocumentInput, HistoryMessage,
    HistoryRole, ReplyError, ReplyErrorKind, ReplyEvent, ReplyStream,
};

use crate::extract::Json;
use crate::problem::{BodyProblems, Problem, ProblemCode, ProblemFieldError};

/// The pair-writer provider shared across handlers.
pub type Agent = Arc<dyn ChatProvider>;

const MAX_MESSAGE_BYTES: usize = 64 * 1024;
const MAX_DOCUMENT_BYTES: usize = 1024 * 1024;
const MAX_TITLE_BYTES: usize = 1024;
const MAX_CONTEXT_DOCUMENTS: usize = 20;
const MAX_HISTORY_MESSAGES: usize = 200;

/// Why the pair writer is not ready to answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum PairWriterIssue {
    NotConfigured,
    RuntimeUnreachable,
    ModelMissing,
}

impl From<agent::PairWriterIssue> for PairWriterIssue {
    fn from(issue: agent::PairWriterIssue) -> Self {
        match issue {
            agent::PairWriterIssue::NotConfigured => Self::NotConfigured,
            agent::PairWriterIssue::RuntimeUnreachable => Self::RuntimeUnreachable,
            agent::PairWriterIssue::ModelMissing => Self::ModelMissing,
        }
    }
}

/// Whether the pair writer can answer and, if not, what is missing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PairWriterStatus {
    pub ready: bool,
    /// Configured provider name, or `null` when none is configured.
    #[schema(required = true)]
    pub provider: Option<String>,
    /// Configured model name, or `null` when none is configured.
    #[schema(required = true)]
    pub model: Option<String>,
    /// Structured reason when `ready` is `false`; otherwise `null`.
    #[schema(required = true)]
    pub issue: Option<PairWriterIssue>,
    /// Short service-authored explanation of what is missing; otherwise `null`.
    #[schema(required = true)]
    pub detail: Option<String>,
}

impl From<agent::PairWriterStatus> for PairWriterStatus {
    fn from(status: agent::PairWriterStatus) -> Self {
        Self {
            ready: status.ready,
            provider: status.provider,
            model: status.model,
            issue: status.issue.map(Into::into),
            detail: status.detail,
        }
    }
}

/// How much of the open document a turn reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum ReadingScope {
    Whole,
    AroundSelection,
    AroundCursor,
}

impl From<ReadingScope> for agent::ReadingScope {
    fn from(scope: ReadingScope) -> Self {
        match scope {
            ReadingScope::Whole => Self::Whole,
            ReadingScope::AroundSelection => Self::AroundSelection,
            ReadingScope::AroundCursor => Self::AroundCursor,
        }
    }
}

impl From<agent::ReadingScope> for ReadingScope {
    fn from(scope: agent::ReadingScope) -> Self {
        match scope {
            agent::ReadingScope::Whole => Self::Whole,
            agent::ReadingScope::AroundSelection => Self::AroundSelection,
            agent::ReadingScope::AroundCursor => Self::AroundCursor,
        }
    }
}

/// Who spoke an earlier turn in a thread.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum ChatHistoryRole {
    Writer,
    Assistant,
}

impl From<ChatHistoryRole> for HistoryRole {
    fn from(role: ChatHistoryRole) -> Self {
        match role {
            ChatHistoryRole::Writer => Self::Writer,
            ChatHistoryRole::Assistant => Self::Assistant,
        }
    }
}

/// One earlier message in the active thread.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatHistoryMessage {
    pub role: ChatHistoryRole,
    pub text: String,
}

/// The open document as it stands when the writer sends, unsaved edits
/// included.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatDocumentInput {
    pub document_id: String,
    pub title: String,
    /// Current Markdown or prose text of the open document (or its window
    /// around the selection or cursor when past the reading limit).
    pub content: String,
    /// Scope used if the caller already windowed a document past the limit.
    #[serde(default)]
    #[schema(nullable = false)]
    pub scope: Option<ReadingScope>,
    /// Approximate character offset of the caret in `content` when no
    /// selection is active.
    #[serde(default)]
    #[schema(nullable = false)]
    pub cursor_offset: Option<u32>,
}

/// The editor's active selection, used as the turn's focus.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatSelectionInput {
    pub text: String,
}

/// Another document added to the turn with `+ Context`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatContextDocument {
    pub document_id: String,
    pub title: String,
    pub content: String,
}

/// A stateless conversation turn sent to the pair writer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreatePairWriterReplyRequest {
    /// The writer's question or prompt for this turn.
    pub message: String,
    /// The open document as it stands.
    pub document: ChatDocumentInput,
    /// Optional active selection in the open document.
    #[serde(default)]
    #[schema(nullable = false)]
    pub selection: Option<ChatSelectionInput>,
    /// Additional documents added with `+ Context`.
    #[serde(default)]
    pub context_documents: Vec<ChatContextDocument>,
    /// Earlier messages in the current thread, oldest first.
    #[serde(default)]
    pub history: Vec<ChatHistoryMessage>,
}

/// The kind of source recorded in `What it read`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum ChatSourceKind {
    Document,
    Selection,
    ContextDocument,
    History,
}

impl From<agent::ReadSourceKind> for ChatSourceKind {
    fn from(kind: agent::ReadSourceKind) -> Self {
        match kind {
            agent::ReadSourceKind::Document => Self::Document,
            agent::ReadSourceKind::Selection => Self::Selection,
            agent::ReadSourceKind::ContextDocument => Self::ContextDocument,
            agent::ReadSourceKind::History => Self::History,
        }
    }
}

/// One source recorded in a reply's `done` event for `What it read`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChatReadSource {
    pub kind: ChatSourceKind,
    #[schema(required = true)]
    pub document_id: Option<String>,
    #[schema(required = true)]
    pub title: Option<String>,
    #[schema(required = true)]
    pub scope: Option<ReadingScope>,
    pub word_count: u32,
    pub label: String,
}

impl From<agent::ReadSource> for ChatReadSource {
    fn from(source: agent::ReadSource) -> Self {
        Self {
            kind: source.kind.into(),
            document_id: source.document_id,
            title: source.title,
            scope: source.scope.map(Into::into),
            word_count: source.word_count,
            label: source.label,
        }
    }
}

/// Payload of a `delta` SSE event carrying streamed reply text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChatReplyDelta {
    pub text: String,
}

/// Payload of a `done` SSE event carrying the facts `What it read` shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChatReplyDone {
    pub model: String,
    /// Prompt name and digest when a prompt is used, or `null` otherwise.
    #[schema(required = true)]
    pub prompt_version: Option<String>,
    pub sources: Vec<ChatReadSource>,
    pub total_words: u32,
    pub dropped_history_turns: u32,
}

impl From<agent::ReplyDone> for ChatReplyDone {
    fn from(done: agent::ReplyDone) -> Self {
        Self {
            model: done.model,
            prompt_version: done.prompt_version,
            sources: done.sources.into_iter().map(Into::into).collect(),
            total_words: done.total_words,
            dropped_history_turns: done.dropped_history_turns,
        }
    }
}

impl From<ReplyError> for Problem {
    fn from(error: ReplyError) -> Self {
        let code = match error.kind {
            ReplyErrorKind::Unavailable => ProblemCode::Unavailable,
            ReplyErrorKind::UpstreamFailed => ProblemCode::UpstreamFailed,
            ReplyErrorKind::UpstreamTimeout => ProblemCode::UpstreamTimeout,
        };
        Self::new(code, error.detail)
    }
}

fn validate_request(body: &CreatePairWriterReplyRequest) -> Result<(), Problem> {
    let mut errors = Vec::new();
    if body.message.trim().is_empty() {
        errors.push(ProblemFieldError {
            pointer: "/message".to_owned(),
            detail: "Must not be empty.".to_owned(),
        });
    } else if body.message.len() > MAX_MESSAGE_BYTES {
        errors.push(ProblemFieldError {
            pointer: "/message".to_owned(),
            detail: "Exceeds the maximum message size.".to_owned(),
        });
    } else if body.message.contains('\0') {
        errors.push(ProblemFieldError {
            pointer: "/message".to_owned(),
            detail: "Must not contain NUL characters.".to_owned(),
        });
    }

    if body.document.document_id.trim().is_empty() {
        errors.push(ProblemFieldError {
            pointer: "/document/documentId".to_owned(),
            detail: "Must not be empty.".to_owned(),
        });
    }
    if body.document.title.trim().is_empty() || body.document.title.len() > MAX_TITLE_BYTES {
        errors.push(ProblemFieldError {
            pointer: "/document/title".to_owned(),
            detail: "Must be between 1 and 1,024 bytes.".to_owned(),
        });
    }
    if body.document.content.len() > MAX_DOCUMENT_BYTES {
        errors.push(ProblemFieldError {
            pointer: "/document/content".to_owned(),
            detail: "Exceeds the 1 MiB document size limit.".to_owned(),
        });
    } else if body.document.content.contains('\0') {
        errors.push(ProblemFieldError {
            pointer: "/document/content".to_owned(),
            detail: "Must not contain NUL characters.".to_owned(),
        });
    }

    if body.context_documents.len() > MAX_CONTEXT_DOCUMENTS {
        errors.push(ProblemFieldError {
            pointer: "/contextDocuments".to_owned(),
            detail: "Exceeds the maximum number of context documents.".to_owned(),
        });
    }
    for (idx, doc) in body.context_documents.iter().enumerate() {
        if doc.document_id.trim().is_empty() {
            errors.push(ProblemFieldError {
                pointer: format!("/contextDocuments/{idx}/documentId"),
                detail: "Must not be empty.".to_owned(),
            });
        }
        if doc.title.trim().is_empty() || doc.title.len() > MAX_TITLE_BYTES {
            errors.push(ProblemFieldError {
                pointer: format!("/contextDocuments/{idx}/title"),
                detail: "Must be between 1 and 1,024 bytes.".to_owned(),
            });
        }
        if doc.content.len() > MAX_DOCUMENT_BYTES || doc.content.contains('\0') {
            errors.push(ProblemFieldError {
                pointer: format!("/contextDocuments/{idx}/content"),
                detail: "Exceeds the 1 MiB limit or contains NUL characters.".to_owned(),
            });
        }
    }

    if body.history.len() > MAX_HISTORY_MESSAGES {
        errors.push(ProblemFieldError {
            pointer: "/history".to_owned(),
            detail: "Exceeds the maximum number of history messages.".to_owned(),
        });
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(Problem::validation_failed(errors))
    }
}

/// Report whether the pair writer is ready to answer and, if not, what is
/// missing.
#[utoipa::path(
    get,
    path = "/pair-writer",
    operation_id = "getPairWriter",
    tag = "pair-writer",
    responses(
        (
            status = 200,
            description = "Whether the pair writer is ready and, if not, what is missing.",
            body = PairWriterStatus
        ),
        (
            status = 500,
            description = "The service failed unexpectedly.",
            body = Problem,
            content_type = "application/problem+json"
        ),
    )
)]
pub(crate) async fn get_pair_writer(State(agent): State<Agent>) -> AxumJson<PairWriterStatus> {
    AxumJson(agent.status().await.into())
}

struct SseReplyStream {
    inner: ReplyStream,
}

impl Stream for SseReplyStream {
    type Item = Result<Event, Infallible>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        match self.inner.poll_recv(cx) {
            Poll::Pending => Poll::Pending,
            Poll::Ready(None) => Poll::Ready(None),
            Poll::Ready(Some(event)) => {
                let sse_event = match event {
                    ReplyEvent::Delta(text) => Event::default()
                        .event("delta")
                        .json_data(ChatReplyDelta { text })
                        .unwrap_or_else(|_| {
                            Event::default().event("delta").data("{\"text\":\"\"}")
                        }),
                    ReplyEvent::Done(done) => Event::default()
                        .event("done")
                        .json_data(ChatReplyDone::from(done))
                        .unwrap_or_else(|_| Event::default().event("done").data("{}")),
                    ReplyEvent::Error(err) => Event::default()
                        .event("error")
                        .json_data(Problem::from(err))
                        .unwrap_or_else(|_| {
                            Event::default()
                                .event("error")
                                .json_data(Problem::internal_error())
                                .expect("Problem serializes to JSON")
                        }),
                };
                Poll::Ready(Some(Ok(sse_event)))
            }
        }
    }
}

/// Stream a pair-writer reply for one conversation turn.
///
/// Streams `text/event-stream` with `delta` (`ChatReplyDelta`) events, ending
/// in either a `done` (`ChatReplyDone`) event or an `error` (`Problem`) event.
#[utoipa::path(
    post,
    path = "/pair-writer/replies",
    operation_id = "createPairWriterReply",
    tag = "pair-writer",
    request_body = CreatePairWriterReplyRequest,
    responses(
        (
            status = 200,
            description = "Server-sent event stream (`text/event-stream`). Events: `delta` (`ChatReplyDelta`), ending with `done` (`ChatReplyDone`) or `error` (`Problem`).",
            content_type = "text/event-stream",
            body = String
        ),
        (
            status = 503,
            description = "The pair writer is not configured or not ready.",
            body = Problem,
            content_type = "application/problem+json"
        ),
        (
            status = 500,
            description = "The service failed unexpectedly.",
            body = Problem,
            content_type = "application/problem+json"
        ),
        BodyProblems,
    )
)]
pub(crate) async fn create_pair_writer_reply(
    State(agent): State<Agent>,
    Json(body): Json<CreatePairWriterReplyRequest>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, Problem> {
    validate_request(&body)?;

    let request = ChatTurnRequest {
        message: body.message,
        document: DocumentInput {
            document_id: body.document.document_id,
            title: body.document.title,
            content: body.document.content,
            scope: body.document.scope.map(Into::into),
            cursor_offset: body.document.cursor_offset.map(|n| n as usize),
        },
        selection: body.selection.map(|s| s.text),
        context_documents: body
            .context_documents
            .into_iter()
            .map(|doc| ContextDocument {
                document_id: doc.document_id,
                title: doc.title,
                content: doc.content,
            })
            .collect(),
        history: body
            .history
            .into_iter()
            .map(|msg| HistoryMessage {
                role: msg.role.into(),
                text: msg.text,
            })
            .collect(),
    };

    let stream = agent.reply(request).await.map_err(Problem::from)?;
    Ok(Sse::new(SseReplyStream { inner: stream }).keep_alive(KeepAlive::default()))
}

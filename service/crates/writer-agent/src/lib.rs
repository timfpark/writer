//! Pair-writer provider interface, reading assembly, and deterministic
//! scripted provider.
//!
//! No type here comes from axum, Tower, or utoipa, and nothing logs request,
//! document, or reply text.

pub mod ollama;
pub mod prompt;
pub mod reading;
pub mod review;
pub mod scripted;

use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};

use tokio::sync::mpsc;

pub use ollama::{
    DEFAULT_CONVERSATION_MODEL, DEFAULT_OLLAMA_HOST, OllamaConfig, OllamaProvider,
    normalize_ollama_host,
};
pub use prompt::{
    CONVERSATION_GROUNDED_NAME, PromptMessage, PromptTemplate, conversation_grounded_prompt,
};
pub use reading::{
    AssembledReading, READING_LIMIT_WORDS, assemble_reading, count_words, strip_markdown_inline,
};
pub use review::{
    FindingAnchor, FindingAudit, FindingCategory, ReviewAgentKind, ReviewFinding,
    ReviewPassageInput, ReviewRequest, ReviewResponse, SCRIPTED_REVIEW_PROMPT_VERSION,
    scripted_review,
};
pub use scripted::{DEFAULT_SCRIPTED_MODEL, ScriptedConfig, ScriptedMode, ScriptedProvider};

/// A boxed future, so [`ChatProvider`] is object-safe.
pub type AgentFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Why the pair writer is not ready to answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PairWriterIssue {
    NotConfigured,
    RuntimeUnreachable,
    ModelMissing,
}

/// Whether the pair writer can answer and, if not, what is missing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairWriterStatus {
    pub ready: bool,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub issue: Option<PairWriterIssue>,
    pub detail: Option<String>,
}

/// How much of the open document a turn reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadingScope {
    Whole,
    AroundSelection,
    AroundCursor,
}

/// Who spoke an earlier turn in a thread.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HistoryRole {
    Writer,
    Assistant,
}

/// One earlier message in the active thread.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistoryMessage {
    pub role: HistoryRole,
    pub text: String,
}

/// The open document as it stands when the writer sends, unsaved edits
/// included.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentInput {
    pub document_id: String,
    pub title: String,
    pub content: String,
    /// When the caller already windowed a document past the reading limit,
    /// the scope it used.
    pub scope: Option<ReadingScope>,
    /// Approximate character offset of the caret inside `content` when no
    /// selection is active and `content` exceeds the reading limit.
    pub cursor_offset: Option<usize>,
}

/// Another document added with `+ Context`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContextDocument {
    pub document_id: String,
    pub title: String,
    pub content: String,
}

/// A pinned finding handed off from the Findings tab to a Chat thread.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FindingContext {
    pub agent: String,
    pub quote: String,
    pub note: String,
}

/// One conversation turn sent to the pair writer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatTurnRequest {
    pub message: String,
    pub document: DocumentInput,
    pub selection: Option<String>,
    pub finding: Option<FindingContext>,
    pub context_documents: Vec<ContextDocument>,
    pub history: Vec<HistoryMessage>,
}

/// What kind of source a turn read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadSourceKind {
    Document,
    Selection,
    Finding,
    ContextDocument,
    History,
}

/// One recorded source for `What it read`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadSource {
    pub kind: ReadSourceKind,
    pub document_id: Option<String>,
    pub title: Option<String>,
    pub scope: Option<ReadingScope>,
    pub word_count: u32,
    pub label: String,
}

/// Timing and token counts reported by the model runtime for one reply.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplyMetrics {
    pub first_token_ms: Option<u64>,
    pub total_ms: Option<u64>,
    pub load_ms: Option<u64>,
    pub prompt_eval_ms: Option<u64>,
    pub eval_ms: Option<u64>,
    pub prompt_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}

/// Facts reported when a streamed reply finishes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplyDone {
    pub model: String,
    pub prompt_version: Option<String>,
    pub sources: Vec<ReadSource>,
    pub total_words: u32,
    pub dropped_history_turns: u32,
    pub metrics: Option<ReplyMetrics>,
}

/// The failure kind for a reply that could not start or failed mid-stream.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplyErrorKind {
    Unavailable,
    UpstreamFailed,
    UpstreamTimeout,
}

/// A service-authored error that never quotes user or document text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplyError {
    pub kind: ReplyErrorKind,
    pub detail: String,
}

/// Events produced by a streaming reply.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReplyEvent {
    Delta(String),
    Done(ReplyDone),
    Error(ReplyError),
}

/// A stream of [`ReplyEvent`] items that cancels generation when dropped.
pub struct ReplyStream {
    rx: mpsc::Receiver<ReplyEvent>,
}

impl ReplyStream {
    /// Creates a stream from a channel receiver; dropping the stream closes
    /// the channel so the producer can cancel immediately.
    pub fn from_receiver(rx: mpsc::Receiver<ReplyEvent>) -> Self {
        Self { rx }
    }

    pub async fn recv(&mut self) -> Option<ReplyEvent> {
        self.rx.recv().await
    }

    pub fn poll_recv(&mut self, cx: &mut Context<'_>) -> Poll<Option<ReplyEvent>> {
        self.rx.poll_recv(cx)
    }
}

/// A pair-writer provider behind the provisional chat and review endpoints.
pub trait ChatProvider: Send + Sync {
    /// Checks whether the provider can answer turns right now.
    fn status(&self) -> AgentFuture<'_, PairWriterStatus>;

    /// Starts streaming a reply for one turn. Errors detected before the
    /// stream starts return `Err`.
    fn reply(&self, request: ChatTurnRequest) -> AgentFuture<'_, Result<ReplyStream, ReplyError>>;

    /// Runs a provisional pause-triggered background review over changed
    /// passages. Dropping the returned future cancels in-flight work.
    fn review(&self, request: ReviewRequest)
    -> AgentFuture<'_, Result<ReviewResponse, ReplyError>>;
}

/// Used when no pair-writer provider is configured; the service starts
/// cleanly and reports the pair writer as not ready.
#[derive(Debug, Default, Clone, Copy)]
pub struct UnconfiguredProvider;

impl ChatProvider for UnconfiguredProvider {
    fn status(&self) -> AgentFuture<'_, PairWriterStatus> {
        Box::pin(async {
            PairWriterStatus {
                ready: false,
                provider: None,
                model: None,
                issue: Some(PairWriterIssue::NotConfigured),
                detail: Some(
                    "No pair-writer provider is configured. Set WRITER_PAIR_WRITER=scripted to try the scripted pair writer."
                        .to_owned(),
                ),
            }
        })
    }

    fn reply(&self, _request: ChatTurnRequest) -> AgentFuture<'_, Result<ReplyStream, ReplyError>> {
        Box::pin(async {
            Err(ReplyError {
                kind: ReplyErrorKind::Unavailable,
                detail: "No pair-writer provider is configured.".to_owned(),
            })
        })
    }

    fn review(
        &self,
        _request: ReviewRequest,
    ) -> AgentFuture<'_, Result<ReviewResponse, ReplyError>> {
        Box::pin(async {
            Err(ReplyError {
                kind: ReplyErrorKind::Unavailable,
                detail: "No pair-writer provider is configured.".to_owned(),
            })
        })
    }
}

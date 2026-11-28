//! Local Ollama pair-writer provider using an async HTTP client on Tokio.
//!
//! Calls Ollama's `/api/tags`, `/api/show`, and streaming `/api/chat` endpoints
//! at `OLLAMA_HOST`, never routing through HTTP proxies and never logging
//! request, document, or reply prose.

use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::sync::{RwLock, mpsc};

use crate::prompt::{PromptMessage, PromptTemplate, conversation_grounded_prompt};
use crate::reading::{assemble_reading, count_words};
use crate::{
    AgentFuture, ChatProvider, ChatTurnRequest, PairWriterIssue, PairWriterStatus, ReplyDone,
    ReplyError, ReplyErrorKind, ReplyEvent, ReplyMetrics, ReplyStream,
};

/// Default Ollama base URL on the writer's machine, per ADR 0010.
pub const DEFAULT_OLLAMA_HOST: &str = "http://127.0.0.1:11434";

/// Default conversation model chosen by ADR 0010.
pub const DEFAULT_CONVERSATION_MODEL: &str = "gemma4:31b-mlx";

const DEFAULT_OLLAMA_PORT: u16 = 11434;
const DEFAULT_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const DEFAULT_READINESS_TIMEOUT: Duration = Duration::from_secs(5);
const DEFAULT_FIRST_CHUNK_TIMEOUT: Duration = Duration::from_secs(180);
const DEFAULT_IDLE_TIMEOUT: Duration = Duration::from_secs(60);
const DEFAULT_KEEP_ALIVE: &str = "30m";
const DEFAULT_NUM_PREDICT: u32 = 2_000;
const CONTEXT_SIZES: [u32; 3] = [8_192, 16_384, 32_768];
const PROMPT_OVERHEAD_TOKENS: usize = 1_500;
const MAX_LINE_BYTES: usize = 4 * 1024 * 1024;

/// Normalizes an `OLLAMA_HOST` value following Ollama's own convention:
/// scheme defaults to `http://`, port defaults to `11434`, and `0.0.0.0`
/// resolves to `127.0.0.1`. Only `http://` URLs are accepted.
pub fn normalize_ollama_host(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(DEFAULT_OLLAMA_HOST.to_owned());
    }

    let with_scheme = if let Some((scheme, _)) = trimmed.split_once("://") {
        if !scheme.eq_ignore_ascii_case("http") {
            return Err(
                "OLLAMA_HOST must use http:// for a local Ollama instance (for example http://127.0.0.1:11434)"
                    .to_owned(),
            );
        }
        trimmed.to_owned()
    } else {
        format!("http://{trimmed}")
    };

    let authority = with_scheme
        .split_once("://")
        .map(|(_, rest)| rest.split('/').next().unwrap_or_default())
        .unwrap_or_default();
    let has_explicit_port = if let Some(after_bracket) = authority.strip_prefix('[') {
        after_bracket
            .split_once(']')
            .is_some_and(|(_, tail)| tail.starts_with(':'))
    } else {
        authority.contains(':')
    };

    let mut url = reqwest::Url::parse(&with_scheme).map_err(|_| {
        "OLLAMA_HOST must be a valid local HTTP host or URL (for example http://127.0.0.1:11434)"
            .to_owned()
    })?;

    if !url.username().is_empty() || url.password().is_some() {
        return Err("OLLAMA_HOST must not contain credentials".to_owned());
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err("OLLAMA_HOST must not contain a query string or fragment".to_owned());
    }
    if url.path() != "/" && !url.path().is_empty() {
        return Err("OLLAMA_HOST must not contain a path".to_owned());
    }

    let Some(host) = url.host_str() else {
        return Err("OLLAMA_HOST must include a host name or address".to_owned());
    };
    if host == "0.0.0.0" {
        url.set_host(Some("127.0.0.1"))
            .map_err(|_| "OLLAMA_HOST could not normalize 0.0.0.0".to_owned())?;
    }
    if !has_explicit_port {
        url.set_port(Some(DEFAULT_OLLAMA_PORT))
            .map_err(|_| "OLLAMA_HOST could not set the default port 11434".to_owned())?;
    }

    Ok(url.as_str().trim_end_matches('/').to_owned())
}

/// Configuration for [`OllamaProvider`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OllamaConfig {
    /// Base URL for Ollama (normalized via [`normalize_ollama_host`]).
    pub host: String,
    /// Conversation model name (default: `gemma4:31b-mlx`).
    pub model: String,
    /// Timeout for establishing a TCP connection to Ollama.
    pub connect_timeout: Duration,
    /// Timeout for `/api/tags` readiness checks and `/api/show` metadata lookups.
    pub readiness_timeout: Duration,
    /// Maximum wait for Ollama's HTTP response and first stream chunk.
    pub first_chunk_timeout: Duration,
    /// Maximum idle time between subsequent stream chunks before `upstreamTimeout`.
    pub idle_timeout: Duration,
    /// Value sent as Ollama's `keep_alive` so the model stays warm across turns.
    pub keep_alive: String,
    /// Maximum output tokens per turn (`options.num_predict`).
    pub num_predict: u32,
}

impl Default for OllamaConfig {
    fn default() -> Self {
        Self {
            host: DEFAULT_OLLAMA_HOST.to_owned(),
            model: DEFAULT_CONVERSATION_MODEL.to_owned(),
            connect_timeout: DEFAULT_CONNECT_TIMEOUT,
            readiness_timeout: DEFAULT_READINESS_TIMEOUT,
            first_chunk_timeout: DEFAULT_FIRST_CHUNK_TIMEOUT,
            idle_timeout: DEFAULT_IDLE_TIMEOUT,
            keep_alive: DEFAULT_KEEP_ALIVE.to_owned(),
            num_predict: DEFAULT_NUM_PREDICT,
        }
    }
}

#[derive(Debug, Clone)]
struct CachedThink {
    digest: String,
    value: Option<serde_json::Value>,
}

/// Streams grounded conversation replies from a local Ollama server.
#[derive(Debug, Clone)]
pub struct OllamaProvider {
    config: OllamaConfig,
    client: reqwest::Client,
    prompt: PromptTemplate,
    think_cache: Arc<RwLock<Option<CachedThink>>>,
}

impl OllamaProvider {
    /// Creates an [`OllamaProvider`] with an async Tokio HTTP client that
    /// bypasses system HTTP proxies so local manuscript prose stays local.
    pub fn new(config: OllamaConfig) -> Result<Self, String> {
        let host = normalize_ollama_host(&config.host)?;
        let model = config.model.trim().to_owned();
        if model.is_empty() {
            return Err("conversation model must not be empty".to_owned());
        }
        let client = reqwest::Client::builder()
            .no_proxy()
            .connect_timeout(config.connect_timeout)
            .build()
            .map_err(|_| "failed to construct HTTP client for Ollama".to_owned())?;

        Ok(Self {
            config: OllamaConfig {
                host,
                model,
                ..config
            },
            client,
            prompt: conversation_grounded_prompt(),
            think_cache: Arc::new(RwLock::new(None)),
        })
    }

    pub fn config(&self) -> &OllamaConfig {
        &self.config
    }

    pub fn prompt(&self) -> &PromptTemplate {
        &self.prompt
    }

    async fn check_tags(&self) -> TagsCheck {
        let url = format!("{}/api/tags", self.config.host);
        let response =
            match tokio::time::timeout(self.config.readiness_timeout, self.client.get(&url).send())
                .await
            {
                Ok(Ok(response)) => response,
                Ok(Err(error)) => {
                    tracing::debug!(
                        connect = error.is_connect(),
                        timeout = error.is_timeout(),
                        "ollama readiness check failed"
                    );
                    return TagsCheck::Unreachable;
                }
                Err(_) => {
                    tracing::debug!("ollama readiness check timed out");
                    return TagsCheck::Unreachable;
                }
            };

        if !response.status().is_success() {
            tracing::debug!(
                status = response.status().as_u16(),
                "ollama /api/tags returned non-success status"
            );
            return TagsCheck::Unreachable;
        }

        let tags: OllamaTagsResponse =
            match tokio::time::timeout(self.config.readiness_timeout, response.json()).await {
                Ok(Ok(tags)) => tags,
                _ => {
                    tracing::debug!("ollama /api/tags returned unreadable JSON");
                    return TagsCheck::Unreachable;
                }
            };

        if let Some(found) = tags
            .models
            .iter()
            .find(|entry| model_matches(&entry.name, &self.config.model))
        {
            TagsCheck::Installed {
                digest: found.digest.clone(),
            }
        } else {
            TagsCheck::ModelMissing
        }
    }

    async fn resolve_think(&self, digest: &str) -> Option<serde_json::Value> {
        {
            let guard = self.think_cache.read().await;
            if let Some(cached) = guard.as_ref()
                && cached.digest == digest
            {
                return cached.value.clone();
            }
        }

        let url = format!("{}/api/show", self.config.host);
        let body = OllamaShowRequest {
            model: self.config.model.clone(),
        };
        let resolved = match tokio::time::timeout(
            self.config.readiness_timeout,
            self.client.post(&url).json(&body).send(),
        )
        .await
        {
            Ok(Ok(response)) if response.status().is_success() => {
                match tokio::time::timeout(
                    self.config.readiness_timeout,
                    response.json::<OllamaShowResponse>(),
                )
                .await
                {
                    Ok(Ok(shown)) => resolve_lowest_think(&shown),
                    _ => None,
                }
            }
            _ => None,
        };

        let mut guard = self.think_cache.write().await;
        *guard = Some(CachedThink {
            digest: digest.to_owned(),
            value: resolved.clone(),
        });
        resolved
    }
}

enum TagsCheck {
    Installed { digest: String },
    ModelMissing,
    Unreachable,
}

impl ChatProvider for OllamaProvider {
    fn status(&self) -> AgentFuture<'_, PairWriterStatus> {
        Box::pin(async move {
            match self.check_tags().await {
                TagsCheck::Installed { .. } => PairWriterStatus {
                    ready: true,
                    provider: Some("ollama".to_owned()),
                    model: Some(self.config.model.clone()),
                    issue: None,
                    detail: None,
                },
                TagsCheck::ModelMissing => PairWriterStatus {
                    ready: false,
                    provider: Some("ollama".to_owned()),
                    model: Some(self.config.model.clone()),
                    issue: Some(PairWriterIssue::ModelMissing),
                    detail: Some(format!(
                        "Model '{}' is not installed in Ollama. Run: ollama pull {}",
                        self.config.model, self.config.model
                    )),
                },
                TagsCheck::Unreachable => PairWriterStatus {
                    ready: false,
                    provider: Some("ollama".to_owned()),
                    model: Some(self.config.model.clone()),
                    issue: Some(PairWriterIssue::RuntimeUnreachable),
                    detail: Some(format!(
                        "Ollama is not reachable at {}. Start Ollama or check OLLAMA_HOST.",
                        self.config.host
                    )),
                },
            }
        })
    }

    fn reply(&self, request: ChatTurnRequest) -> AgentFuture<'_, Result<ReplyStream, ReplyError>> {
        Box::pin(async move {
            let digest = match self.check_tags().await {
                TagsCheck::Installed { digest } => digest,
                TagsCheck::ModelMissing => {
                    return Err(ReplyError {
                        kind: ReplyErrorKind::Unavailable,
                        detail: format!(
                            "Model '{}' is not installed in Ollama. Run: ollama pull {}",
                            self.config.model, self.config.model
                        ),
                    });
                }
                TagsCheck::Unreachable => {
                    return Err(ReplyError {
                        kind: ReplyErrorKind::Unavailable,
                        detail: format!(
                            "Ollama is not reachable at {}. Start Ollama or check OLLAMA_HOST.",
                            self.config.host
                        ),
                    });
                }
            };

            let reading = assemble_reading(&request);
            let messages = self.prompt.render_messages(&reading, &request.message);
            let extra_words =
                count_words(&request.message) + reading.selection.as_deref().map_or(0, count_words);
            let num_ctx = context_for_words(
                reading.total_words.saturating_add(extra_words),
                self.config.num_predict,
            );
            let sources = reading.sources;
            let total_words = u32::try_from(reading.total_words).unwrap_or(u32::MAX);
            let dropped_history_turns =
                u32::try_from(reading.dropped_history_turns).unwrap_or(u32::MAX);

            let provider = self.clone();
            let (tx, rx) = mpsc::channel(32);

            tokio::spawn(async move {
                stream_ollama_reply(
                    provider,
                    digest,
                    messages,
                    num_ctx,
                    sources,
                    total_words,
                    dropped_history_turns,
                    tx,
                )
                .await;
            });

            Ok(ReplyStream::from_receiver(rx))
        })
    }
}

#[allow(clippy::too_many_arguments)]
async fn stream_ollama_reply(
    provider: OllamaProvider,
    digest: String,
    messages: Vec<PromptMessage>,
    num_ctx: u32,
    sources: Vec<crate::ReadSource>,
    total_words: u32,
    dropped_history_turns: u32,
    tx: mpsc::Sender<ReplyEvent>,
) {
    let think = tokio::select! {
        biased;
        () = tx.closed() => return,
        think = provider.resolve_think(&digest) => think,
    };

    let chat_url = format!("{}/api/chat", provider.config.host);
    let body = OllamaChatRequest {
        model: provider.config.model.clone(),
        messages: messages
            .into_iter()
            .map(|msg| OllamaChatMessage {
                role: msg.role.to_owned(),
                content: msg.content,
            })
            .collect(),
        stream: true,
        think,
        keep_alive: provider.config.keep_alive.clone(),
        options: OllamaChatOptions {
            num_ctx,
            num_predict: provider.config.num_predict,
        },
    };

    let started = Instant::now();
    let send_fut = tokio::time::timeout(
        provider.config.first_chunk_timeout,
        provider.client.post(&chat_url).json(&body).send(),
    );

    let mut response = tokio::select! {
        biased;
        () = tx.closed() => return,
        result = send_fut => match result {
            Ok(Ok(response)) => response,
            Ok(Err(error)) => {
                tracing::warn!(
                    connect = error.is_connect(),
                    timeout = error.is_timeout(),
                    "ollama /api/chat request failed"
                );
                let (kind, detail) = if error.is_timeout() {
                    (
                        ReplyErrorKind::UpstreamTimeout,
                        "Ollama timed out before starting the reply.".to_owned(),
                    )
                } else {
                    (
                        ReplyErrorKind::UpstreamFailed,
                        "Ollama failed to answer the chat request.".to_owned(),
                    )
                };
                let _ = tx.send(ReplyEvent::Error(ReplyError { kind, detail })).await;
                return;
            }
            Err(_) => {
                tracing::warn!("ollama /api/chat timed out waiting for response headers");
                let _ = tx
                    .send(ReplyEvent::Error(ReplyError {
                        kind: ReplyErrorKind::UpstreamTimeout,
                        detail: "Ollama timed out before starting the reply.".to_owned(),
                    }))
                    .await;
                return;
            }
        },
    };

    let status = response.status();
    if !status.is_success() {
        tracing::warn!(
            status = status.as_u16(),
            "ollama /api/chat returned error status"
        );
        let (kind, detail) = if status == reqwest::StatusCode::NOT_FOUND {
            (
                ReplyErrorKind::Unavailable,
                format!(
                    "Model '{}' is not installed in Ollama. Run: ollama pull {}",
                    provider.config.model, provider.config.model
                ),
            )
        } else {
            (
                ReplyErrorKind::UpstreamFailed,
                "Ollama returned an error while starting the reply.".to_owned(),
            )
        };
        let _ = tx
            .send(ReplyEvent::Error(ReplyError { kind, detail }))
            .await;
        return;
    }

    let mut buffer: Vec<u8> = Vec::new();
    let mut seen_any_chunk = false;
    let mut first_token_ms: Option<u64> = None;

    loop {
        let timeout = if seen_any_chunk {
            provider.config.idle_timeout
        } else {
            provider.config.first_chunk_timeout
        };
        let next_chunk = tokio::time::timeout(timeout, response.chunk());

        let chunk = tokio::select! {
            biased;
            () = tx.closed() => return,
            result = next_chunk => match result {
                Ok(Ok(Some(bytes))) => bytes,
                Ok(Ok(None)) => break,
                Ok(Err(error)) => {
                    tracing::warn!(
                        timeout = error.is_timeout(),
                        "ollama /api/chat stream read failed"
                    );
                    let (kind, detail) = if error.is_timeout() {
                        (
                            ReplyErrorKind::UpstreamTimeout,
                            "Ollama stopped responding before finishing the reply.".to_owned(),
                        )
                    } else {
                        (
                            ReplyErrorKind::UpstreamFailed,
                            "The connection to Ollama failed before the reply finished.".to_owned(),
                        )
                    };
                    let _ = tx.send(ReplyEvent::Error(ReplyError { kind, detail })).await;
                    return;
                }
                Err(_) => {
                    tracing::warn!("ollama /api/chat stream timed out waiting for next chunk");
                    let _ = tx
                        .send(ReplyEvent::Error(ReplyError {
                            kind: ReplyErrorKind::UpstreamTimeout,
                            detail: "Ollama stopped responding before finishing the reply."
                                .to_owned(),
                        }))
                        .await;
                    return;
                }
            },
        };

        seen_any_chunk = true;
        buffer.extend_from_slice(&chunk);
        if buffer.len() > MAX_LINE_BYTES && !buffer.contains(&b'\n') {
            tracing::warn!("ollama /api/chat emitted an oversized line");
            let _ = tx
                .send(ReplyEvent::Error(ReplyError {
                    kind: ReplyErrorKind::UpstreamFailed,
                    detail: "Ollama returned a malformed streaming response.".to_owned(),
                }))
                .await;
            return;
        }

        while let Some(newline_pos) = buffer.iter().position(|&byte| byte == b'\n') {
            let line: Vec<u8> = buffer.drain(..=newline_pos).collect();
            let line = trim_ascii_line(&line);
            if line.is_empty() {
                continue;
            }
            match process_ndjson_line(
                line,
                started,
                &mut first_token_ms,
                &provider,
                &sources,
                total_words,
                dropped_history_turns,
                &tx,
            )
            .await
            {
                LineOutcome::Continue => {}
                LineOutcome::Finished => return,
            }
        }
    }

    // Handle a trailing JSON line without a final newline if Ollama sent one.
    let trailing = trim_ascii_line(&buffer);
    if !trailing.is_empty() {
        match process_ndjson_line(
            trailing,
            started,
            &mut first_token_ms,
            &provider,
            &sources,
            total_words,
            dropped_history_turns,
            &tx,
        )
        .await
        {
            LineOutcome::Continue => {}
            LineOutcome::Finished => return,
        }
    }

    // Stream closed without a `done: true` chunk.
    tracing::warn!("ollama /api/chat stream ended without a done chunk");
    let _ = tx
        .send(ReplyEvent::Error(ReplyError {
            kind: ReplyErrorKind::UpstreamFailed,
            detail: "Ollama ended the stream before finishing the reply.".to_owned(),
        }))
        .await;
}

enum LineOutcome {
    Continue,
    Finished,
}

#[allow(clippy::too_many_arguments)]
async fn process_ndjson_line(
    line: &[u8],
    started: Instant,
    first_token_ms: &mut Option<u64>,
    provider: &OllamaProvider,
    sources: &[crate::ReadSource],
    total_words: u32,
    dropped_history_turns: u32,
    tx: &mpsc::Sender<ReplyEvent>,
) -> LineOutcome {
    let chunk: OllamaChatChunk = match serde_json::from_slice(line) {
        Ok(chunk) => chunk,
        Err(_) => {
            tracing::warn!("ollama /api/chat emitted invalid JSON");
            let _ = tx
                .send(ReplyEvent::Error(ReplyError {
                    kind: ReplyErrorKind::UpstreamFailed,
                    detail: "Ollama returned a malformed streaming response.".to_owned(),
                }))
                .await;
            return LineOutcome::Finished;
        }
    };

    if chunk.error.is_some() {
        tracing::warn!("ollama /api/chat returned an in-stream error");
        let _ = tx
            .send(ReplyEvent::Error(ReplyError {
                kind: ReplyErrorKind::UpstreamFailed,
                detail: "Ollama failed while generating the reply.".to_owned(),
            }))
            .await;
        return LineOutcome::Finished;
    }

    if let Some(message) = chunk.message
        && !message.content.is_empty()
    {
        if first_token_ms.is_none() {
            *first_token_ms = Some(elapsed_ms(started));
        }
        let send_ok = tokio::select! {
            biased;
            () = tx.closed() => false,
            res = tx.send(ReplyEvent::Delta(message.content)) => res.is_ok(),
        };
        if !send_ok {
            return LineOutcome::Finished;
        }
    }

    if chunk.done {
        let wall_total_ms = elapsed_ms(started);
        let metrics = ReplyMetrics {
            first_token_ms: *first_token_ms,
            total_ms: Some(chunk.total_duration.map_or(wall_total_ms, ns_to_ms)),
            load_ms: chunk.load_duration.map(ns_to_ms),
            prompt_eval_ms: chunk.prompt_eval_duration.map(ns_to_ms),
            eval_ms: chunk.eval_duration.map(ns_to_ms),
            prompt_tokens: chunk.prompt_eval_count,
            output_tokens: chunk.eval_count,
        };
        let done = ReplyDone {
            model: provider.config.model.clone(),
            prompt_version: Some(provider.prompt.version()),
            sources: sources.to_vec(),
            total_words,
            dropped_history_turns,
            metrics: Some(metrics),
        };
        let _ = tx.send(ReplyEvent::Done(done)).await;
        return LineOutcome::Finished;
    }

    LineOutcome::Continue
}

fn trim_ascii_line(bytes: &[u8]) -> &[u8] {
    let start = bytes
        .iter()
        .position(|b| !b.is_ascii_whitespace())
        .unwrap_or(bytes.len());
    let end = bytes
        .iter()
        .rposition(|b| !b.is_ascii_whitespace())
        .map_or(start, |idx| idx + 1);
    &bytes[start..end]
}

fn elapsed_ms(started: Instant) -> u64 {
    u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)
}

fn ns_to_ms(ns: u64) -> u64 {
    ns.saturating_add(500_000) / 1_000_000
}

/// Checks whether an installed Ollama model tag matches `configured`,
/// treating an untagged name like `gemma4` as matching `gemma4:latest`.
pub(crate) fn model_matches(installed: &str, configured: &str) -> bool {
    if installed == configured {
        return true;
    }
    if !configured.contains(':')
        && let Some(stem) = installed.strip_suffix(":latest")
    {
        return stem == configured;
    }
    false
}

/// Picks a context window matching ADR 0010's tiers (`8192`, `16384`, `32768`)
/// so short scenes stay lean and a 19,000-word reading stays within 32k tokens.
fn context_for_words(words: usize, num_predict: u32) -> u32 {
    // 1.5 tokens/word + prompt overhead + reply budget.
    let estimated_words_tokens = words.saturating_mul(3) / 2;
    let needed = estimated_words_tokens
        .saturating_add(PROMPT_OVERHEAD_TOKENS)
        .saturating_add(num_predict as usize);
    for size in CONTEXT_SIZES {
        if (size as usize) >= needed {
            return size;
        }
    }
    *CONTEXT_SIZES.last().expect("non-empty CONTEXT_SIZES")
}

/// Matches `evals/writer_evals/runner.py`'s `resolve_think("lowest", info)`:
/// prefers the lowest named string level (such as `"low"`), otherwise `false`
/// when the model supports boolean thinking, or `None` when unsupported.
fn resolve_lowest_think(shown: &OllamaShowResponse) -> Option<serde_json::Value> {
    if let Some(thinking) = shown.thinking.as_ref()
        && !thinking.values.is_empty()
    {
        if let Some(named) = thinking.values.iter().find_map(|v| v.as_str()) {
            return Some(serde_json::Value::String(named.to_owned()));
        }
        return Some(serde_json::Value::Bool(false));
    }
    if shown
        .capabilities
        .iter()
        .any(|cap| cap.eq_ignore_ascii_case("thinking"))
    {
        return Some(serde_json::Value::Bool(false));
    }
    None
}

#[derive(Debug, Deserialize)]
struct OllamaTagsResponse {
    #[serde(default)]
    models: Vec<OllamaTagEntry>,
}

#[derive(Debug, Deserialize)]
struct OllamaTagEntry {
    name: String,
    #[serde(default)]
    digest: String,
}

#[derive(Debug, Serialize)]
struct OllamaShowRequest {
    model: String,
}

#[derive(Debug, Deserialize)]
struct OllamaShowResponse {
    #[serde(default)]
    capabilities: Vec<String>,
    #[serde(default)]
    thinking: Option<OllamaThinkingInfo>,
}

#[derive(Debug, Deserialize)]
struct OllamaThinkingInfo {
    #[serde(default)]
    values: Vec<serde_json::Value>,
}

#[derive(Debug, Serialize)]
struct OllamaChatRequest {
    model: String,
    messages: Vec<OllamaChatMessage>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    think: Option<serde_json::Value>,
    keep_alive: String,
    options: OllamaChatOptions,
}

#[derive(Debug, Serialize)]
struct OllamaChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct OllamaChatOptions {
    num_ctx: u32,
    num_predict: u32,
}

#[derive(Debug, Deserialize)]
struct OllamaChatChunk {
    #[serde(default)]
    message: Option<OllamaChunkMessage>,
    #[serde(default)]
    done: bool,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    total_duration: Option<u64>,
    #[serde(default)]
    load_duration: Option<u64>,
    #[serde(default)]
    prompt_eval_count: Option<u64>,
    #[serde(default)]
    prompt_eval_duration: Option<u64>,
    #[serde(default)]
    eval_count: Option<u64>,
    #[serde(default)]
    eval_duration: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct OllamaChunkMessage {
    #[serde(default)]
    content: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{DocumentInput, HistoryMessage, HistoryRole};
    use std::sync::Mutex;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream};
    use tokio::sync::Notify;

    #[test]
    fn normalizes_ollama_host_variants() {
        assert_eq!(normalize_ollama_host("").unwrap(), "http://127.0.0.1:11434");
        assert_eq!(
            normalize_ollama_host("  http://127.0.0.1:11434/  ").unwrap(),
            "http://127.0.0.1:11434"
        );
        assert_eq!(
            normalize_ollama_host("http://host.docker.internal:11434").unwrap(),
            "http://host.docker.internal:11434"
        );
        assert_eq!(
            normalize_ollama_host("host.docker.internal").unwrap(),
            "http://host.docker.internal:11434"
        );
        assert_eq!(
            normalize_ollama_host("0.0.0.0:11434").unwrap(),
            "http://127.0.0.1:11434"
        );
        assert_eq!(
            normalize_ollama_host("http://127.0.0.1:80").unwrap(),
            "http://127.0.0.1"
        );
        assert_eq!(
            normalize_ollama_host("[::1]:11434").unwrap(),
            "http://[::1]:11434"
        );
        assert!(normalize_ollama_host("https://example.com:11434").is_err());
        assert!(normalize_ollama_host("http://127.0.0.1:11434/api").is_err());
        assert!(normalize_ollama_host("http://user:pass@127.0.0.1:11434").is_err());
    }

    #[test]
    fn matches_exact_and_implicit_latest_model_tags() {
        assert!(model_matches("gemma4:31b-mlx", "gemma4:31b-mlx"));
        assert!(!model_matches("gemma4:12b-it-q4_K_M", "gemma4:31b-mlx"));
        assert!(model_matches("gemma4:latest", "gemma4"));
        assert!(!model_matches("gemma4:31b-mlx", "gemma4"));
    }

    #[test]
    fn resolves_lowest_thinking_like_evals() {
        let bool_model = OllamaShowResponse {
            capabilities: vec!["completion".to_owned(), "thinking".to_owned()],
            thinking: Some(OllamaThinkingInfo {
                values: vec![serde_json::json!(false), serde_json::json!(true)],
            }),
        };
        assert_eq!(
            resolve_lowest_think(&bool_model),
            Some(serde_json::json!(false))
        );

        let named_model = OllamaShowResponse {
            capabilities: vec!["thinking".to_owned()],
            thinking: Some(OllamaThinkingInfo {
                values: vec![
                    serde_json::json!(false),
                    serde_json::json!("low"),
                    serde_json::json!("high"),
                ],
            }),
        };
        assert_eq!(
            resolve_lowest_think(&named_model),
            Some(serde_json::json!("low"))
        );

        let plain_model = OllamaShowResponse {
            capabilities: vec!["completion".to_owned()],
            thinking: None,
        };
        assert_eq!(resolve_lowest_think(&plain_model), None);
    }

    #[derive(Clone)]
    enum FakeChatBehavior {
        StreamSuccess,
        Http500,
        InStreamError,
        TruncatedNoDone,
        StallAfterFirstChunk,
        HoldHeadersUntilClosed,
        StreamThenHoldUntilClosed,
    }

    #[derive(Clone)]
    struct FakeOllamaState {
        models: Vec<(String, String)>,
        thinking_values: Vec<serde_json::Value>,
        chat_behavior: FakeChatBehavior,
        captured_chat_bodies: Arc<Mutex<Vec<serde_json::Value>>>,
        chat_started: Arc<Notify>,
        chat_disconnected: Arc<Notify>,
    }

    impl FakeOllamaState {
        fn new(behavior: FakeChatBehavior) -> Self {
            Self {
                models: vec![("gemma4:31b-mlx".to_owned(), "digest-1".to_owned())],
                thinking_values: vec![serde_json::json!(false), serde_json::json!(true)],
                chat_behavior: behavior,
                captured_chat_bodies: Arc::new(Mutex::new(Vec::new())),
                chat_started: Arc::new(Notify::new()),
                chat_disconnected: Arc::new(Notify::new()),
            }
        }
    }

    async fn read_http_request(stream: &mut TcpStream) -> Option<(String, String, Vec<u8>)> {
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
        let header_text = String::from_utf8_lossy(&buf[..header_end]).into_owned();
        let first_line = header_text.lines().next()?;
        let mut parts = first_line.split_whitespace();
        let method = parts.next()?.to_owned();
        let path = parts.next()?.to_owned();
        let content_length = header_text
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

        let mut body = buf[header_end..].to_vec();
        while body.len() < content_length {
            let n = stream.read(&mut tmp).await.ok()?;
            if n == 0 {
                break;
            }
            body.extend_from_slice(&tmp[..n]);
        }
        body.truncate(content_length);
        Some((method, path, body))
    }

    async fn write_json_response(stream: &mut TcpStream, status: &str, body: &str) {
        let resp = format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let _ = stream.write_all(resp.as_bytes()).await;
        let _ = stream.flush().await;
    }

    async fn write_chunk(stream: &mut TcpStream, payload: &str) -> std::io::Result<()> {
        let header = format!("{:x}\r\n", payload.len());
        stream.write_all(header.as_bytes()).await?;
        stream.write_all(payload.as_bytes()).await?;
        stream.write_all(b"\r\n").await?;
        stream.flush().await
    }

    async fn spawn_fake_ollama(state: FakeOllamaState) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                let state = state.clone();
                tokio::spawn(async move {
                    let Some((method, path, body)) = read_http_request(&mut socket).await else {
                        return;
                    };
                    match (method.as_str(), path.as_str()) {
                        ("GET", "/api/tags") => {
                            let models: Vec<serde_json::Value> = state
                                .models
                                .iter()
                                .map(|(name, digest)| {
                                    serde_json::json!({ "name": name, "digest": digest })
                                })
                                .collect();
                            let payload = serde_json::json!({ "models": models }).to_string();
                            write_json_response(&mut socket, "200 OK", &payload).await;
                        }
                        ("POST", "/api/show") => {
                            let payload = serde_json::json!({
                                "capabilities": ["completion", "thinking"],
                                "thinking": { "values": state.thinking_values }
                            })
                            .to_string();
                            write_json_response(&mut socket, "200 OK", &payload).await;
                        }
                        ("POST", "/api/chat") => {
                            if let Ok(parsed) = serde_json::from_slice::<serde_json::Value>(&body) {
                                state.captured_chat_bodies.lock().unwrap().push(parsed);
                            }
                            state.chat_started.notify_one();
                            match state.chat_behavior {
                                FakeChatBehavior::StreamSuccess => {
                                    let _ = socket
                                        .write_all(
                                            b"HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
                                        )
                                        .await;
                                    // Thinking chunk (must not be emitted as Delta).
                                    let _ = write_chunk(
                                        &mut socket,
                                        "{\"message\":{\"role\":\"assistant\",\"content\":\"\",\"thinking\":\"considering...\"},\"done\":false}\n",
                                    )
                                    .await;
                                    // Split one JSON line across two TCP chunks to test line buffering.
                                    let _ = write_chunk(
                                        &mut socket,
                                        "{\"message\":{\"role\":\"assistant\",\"content\":\"1. Tighten ",
                                    )
                                    .await;
                                    let _ = write_chunk(
                                        &mut socket,
                                        "\\\"The lantern swayed.\\\"\"},\"done\":false}\n",
                                    )
                                    .await;
                                    let _ = write_chunk(
                                        &mut socket,
                                        "{\"message\":{\"role\":\"assistant\",\"content\":\"\"},\"done\":true,\"total_duration\":2500000000,\"load_duration\":100000000,\"prompt_eval_count\":120,\"prompt_eval_duration\":1800000000,\"eval_count\":18,\"eval_duration\":600000000}\n",
                                    )
                                    .await;
                                    let _ = socket.write_all(b"0\r\n\r\n").await;
                                    let _ = socket.flush().await;
                                }
                                FakeChatBehavior::Http500 => {
                                    write_json_response(
                                        &mut socket,
                                        "500 Internal Server Error",
                                        r#"{"error":"runner crashed"}"#,
                                    )
                                    .await;
                                }
                                FakeChatBehavior::InStreamError => {
                                    let _ = socket
                                        .write_all(
                                            b"HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
                                        )
                                        .await;
                                    let _ = write_chunk(
                                        &mut socket,
                                        "{\"message\":{\"role\":\"assistant\",\"content\":\"Partial \"},\"done\":false}\n",
                                    )
                                    .await;
                                    let _ = write_chunk(
                                        &mut socket,
                                        "{\"error\":\"model failed mid-reply\"}\n",
                                    )
                                    .await;
                                    let _ = socket.write_all(b"0\r\n\r\n").await;
                                }
                                FakeChatBehavior::TruncatedNoDone => {
                                    let _ = socket
                                        .write_all(
                                            b"HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
                                        )
                                        .await;
                                    let _ = write_chunk(
                                        &mut socket,
                                        "{\"message\":{\"role\":\"assistant\",\"content\":\"Cut off\"},\"done\":false}\n",
                                    )
                                    .await;
                                    let _ = socket.write_all(b"0\r\n\r\n").await;
                                }
                                FakeChatBehavior::StallAfterFirstChunk => {
                                    let _ = socket
                                        .write_all(
                                            b"HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
                                        )
                                        .await;
                                    let _ = write_chunk(
                                        &mut socket,
                                        "{\"message\":{\"role\":\"assistant\",\"content\":\"Waiting...\"},\"done\":false}\n",
                                    )
                                    .await;
                                    let mut buf = [0u8; 64];
                                    let _ = socket.read(&mut buf).await;
                                }
                                FakeChatBehavior::HoldHeadersUntilClosed => {
                                    let mut buf = [0u8; 64];
                                    let _ = socket.read(&mut buf).await;
                                    state.chat_disconnected.notify_one();
                                }
                                FakeChatBehavior::StreamThenHoldUntilClosed => {
                                    let _ = socket
                                        .write_all(
                                            b"HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
                                        )
                                        .await;
                                    let _ = write_chunk(
                                        &mut socket,
                                        "{\"message\":{\"role\":\"assistant\",\"content\":\"First \"},\"done\":false}\n",
                                    )
                                    .await;
                                    let mut buf = [0u8; 64];
                                    let _ = socket.read(&mut buf).await;
                                    state.chat_disconnected.notify_one();
                                }
                            }
                        }
                        _ => {
                            write_json_response(&mut socket, "404 Not Found", "{}").await;
                        }
                    }
                });
            }
        });
        format!("http://{addr}")
    }

    fn sample_request(history: Vec<HistoryMessage>) -> ChatTurnRequest {
        ChatTurnRequest {
            message: "Give me some ideas about how I can improve this text".to_owned(),
            document: DocumentInput {
                document_id: "doc-1".to_owned(),
                title: "Chapter 1".to_owned(),
                content: "The lantern swayed above the harbor stones.".to_owned(),
                scope: None,
                cursor_offset: None,
            },
            selection: None,
            context_documents: vec![],
            history,
        }
    }

    #[tokio::test]
    async fn streams_deltas_prompt_version_and_ollama_metrics() {
        let state = FakeOllamaState::new(FakeChatBehavior::StreamSuccess);
        let host = spawn_fake_ollama(state.clone()).await;
        let provider = OllamaProvider::new(OllamaConfig {
            host,
            ..OllamaConfig::default()
        })
        .unwrap();

        let status = provider.status().await;
        assert!(status.ready);
        assert_eq!(status.provider.as_deref(), Some("ollama"));
        assert_eq!(status.model.as_deref(), Some("gemma4:31b-mlx"));
        assert_eq!(status.issue, None);

        let mut stream = provider.reply(sample_request(vec![])).await.unwrap();
        let mut text = String::new();
        let mut done: Option<ReplyDone> = None;
        while let Some(event) = stream.recv().await {
            match event {
                ReplyEvent::Delta(chunk) => text.push_str(&chunk),
                ReplyEvent::Done(d) => done = Some(d),
                ReplyEvent::Error(err) => panic!("unexpected error: {err:?}"),
            }
        }

        assert_eq!(text, "1. Tighten \"The lantern swayed.\"");
        let done = done.expect("done event");
        assert_eq!(done.model, "gemma4:31b-mlx");
        assert_eq!(
            done.prompt_version.as_deref(),
            Some("conversation-grounded@c0a3c0b9f874")
        );
        let metrics = done.metrics.expect("metrics from Ollama");
        assert!(metrics.first_token_ms.is_some());
        assert_eq!(metrics.total_ms, Some(2_500));
        assert_eq!(metrics.load_ms, Some(100));
        assert_eq!(metrics.prompt_eval_ms, Some(1_800));
        assert_eq!(metrics.eval_ms, Some(600));
        assert_eq!(metrics.prompt_tokens, Some(120));
        assert_eq!(metrics.output_tokens, Some(18));

        let sent = state.captured_chat_bodies.lock().unwrap();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0]["think"], serde_json::json!(false));
        assert_eq!(sent[0]["options"]["num_ctx"], serde_json::json!(8192));
    }

    #[tokio::test]
    async fn followup_preserves_document_prefix_in_ollama_messages() {
        let state = FakeOllamaState::new(FakeChatBehavior::StreamSuccess);
        let host = spawn_fake_ollama(state.clone()).await;
        let provider = OllamaProvider::new(OllamaConfig {
            host,
            ..OllamaConfig::default()
        })
        .unwrap();

        let mut first = provider.reply(sample_request(vec![])).await.unwrap();
        while first.recv().await.is_some() {}

        let mut followup = provider
            .reply(sample_request(vec![
                HistoryMessage {
                    role: HistoryRole::Writer,
                    text: "Give me some ideas about how I can improve this text".to_owned(),
                },
                HistoryMessage {
                    role: HistoryRole::Assistant,
                    text: "1. Tighten \"The lantern swayed.\"".to_owned(),
                },
            ]))
            .await
            .unwrap();
        while followup.recv().await.is_some() {}

        let sent = state.captured_chat_bodies.lock().unwrap();
        assert_eq!(sent.len(), 2);
        assert_eq!(sent[0]["messages"][0], sent[1]["messages"][0]);
        assert_eq!(sent[0]["messages"][1], sent[1]["messages"][1]);
        assert_eq!(sent[1]["messages"].as_array().unwrap().len(), 4);
    }

    #[tokio::test]
    async fn reports_unreachable_and_missing_model_and_rejects_turns_with_unavailable() {
        // Closed port -> RuntimeUnreachable + Unavailable.
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let closed_port = listener.local_addr().unwrap().port();
        drop(listener);

        let unreachable = OllamaProvider::new(OllamaConfig {
            host: format!("http://127.0.0.1:{closed_port}"),
            connect_timeout: Duration::from_millis(500),
            readiness_timeout: Duration::from_millis(500),
            ..OllamaConfig::default()
        })
        .unwrap();
        let status = unreachable.status().await;
        assert!(!status.ready);
        assert_eq!(status.issue, Some(PairWriterIssue::RuntimeUnreachable));
        let err = match unreachable.reply(sample_request(vec![])).await {
            Err(err) => err,
            Ok(_) => panic!("expected Unavailable when Ollama is unreachable"),
        };
        assert_eq!(err.kind, ReplyErrorKind::Unavailable);

        // Reachable server without configured model -> ModelMissing + Unavailable.
        let mut state = FakeOllamaState::new(FakeChatBehavior::StreamSuccess);
        state.models = vec![("other:7b".to_owned(), "digest-other".to_owned())];
        let host = spawn_fake_ollama(state).await;
        let missing = OllamaProvider::new(OllamaConfig {
            host,
            ..OllamaConfig::default()
        })
        .unwrap();
        let status = missing.status().await;
        assert!(!status.ready);
        assert_eq!(status.issue, Some(PairWriterIssue::ModelMissing));
        let err = match missing.reply(sample_request(vec![])).await {
            Err(err) => err,
            Ok(_) => panic!("expected Unavailable when model is missing"),
        };
        assert_eq!(err.kind, ReplyErrorKind::Unavailable);
    }

    #[tokio::test]
    async fn maps_in_stream_errors_truncation_and_http_errors_to_upstream_failed() {
        for behavior in [
            FakeChatBehavior::Http500,
            FakeChatBehavior::InStreamError,
            FakeChatBehavior::TruncatedNoDone,
        ] {
            let state = FakeOllamaState::new(behavior);
            let host = spawn_fake_ollama(state).await;
            let provider = OllamaProvider::new(OllamaConfig {
                host,
                ..OllamaConfig::default()
            })
            .unwrap();
            let mut stream = provider.reply(sample_request(vec![])).await.unwrap();
            let mut saw_error = None;
            while let Some(event) = stream.recv().await {
                if let ReplyEvent::Error(err) = event {
                    saw_error = Some(err);
                }
            }
            let err = saw_error.expect("expected in-stream error event");
            assert_eq!(err.kind, ReplyErrorKind::UpstreamFailed);
        }
    }

    #[tokio::test]
    async fn emits_upstream_timeout_when_ollama_stops_sending() {
        let state = FakeOllamaState::new(FakeChatBehavior::StallAfterFirstChunk);
        let host = spawn_fake_ollama(state).await;
        let provider = OllamaProvider::new(OllamaConfig {
            host,
            idle_timeout: Duration::from_millis(120),
            ..OllamaConfig::default()
        })
        .unwrap();

        let mut stream = provider.reply(sample_request(vec![])).await.unwrap();
        let first = stream.recv().await;
        assert!(matches!(first, Some(ReplyEvent::Delta(_))));
        let second = stream.recv().await;
        match second {
            Some(ReplyEvent::Error(err)) => {
                assert_eq!(err.kind, ReplyErrorKind::UpstreamTimeout);
            }
            other => panic!("expected UpstreamTimeout error, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn dropping_stream_cancels_ollama_request_before_and_during_streaming() {
        // 1. Cancel before the first token arrives (while Ollama evaluates prompt).
        let state = FakeOllamaState::new(FakeChatBehavior::HoldHeadersUntilClosed);
        let host = spawn_fake_ollama(state.clone()).await;
        let provider = OllamaProvider::new(OllamaConfig {
            host,
            ..OllamaConfig::default()
        })
        .unwrap();

        let stream = provider.reply(sample_request(vec![])).await.unwrap();
        tokio::time::timeout(Duration::from_secs(2), state.chat_started.notified())
            .await
            .expect("fake Ollama should receive /api/chat");
        drop(stream);
        tokio::time::timeout(Duration::from_secs(2), state.chat_disconnected.notified())
            .await
            .expect("dropping stream before first token should close Ollama TCP request");

        // 2. Cancel mid-stream after the first delta arrives.
        let state = FakeOllamaState::new(FakeChatBehavior::StreamThenHoldUntilClosed);
        let host = spawn_fake_ollama(state.clone()).await;
        let provider = OllamaProvider::new(OllamaConfig {
            host,
            ..OllamaConfig::default()
        })
        .unwrap();

        let mut stream = provider.reply(sample_request(vec![])).await.unwrap();
        let first = stream.recv().await;
        assert!(matches!(first, Some(ReplyEvent::Delta(_))));
        drop(stream);
        tokio::time::timeout(Duration::from_secs(2), state.chat_disconnected.notified())
            .await
            .expect("dropping stream mid-reply should close Ollama TCP request");
    }
}

//! Deterministic scripted pair-writer provider for tests and demonstrations.
//!
//! Derives advice-only numbered notes from the request, quoting verbatim
//! sentences from the document or selection with brief italicized
//! alternatives, paced like ADR 0010's local model by default.

use std::time::Duration;

use tokio::sync::mpsc;

use crate::reading::{AssembledReading, assemble_reading, strip_markdown_inline};
use crate::review::{ReviewRequest, ReviewResponse, scripted_review};
use crate::{
    AgentFuture, ChatProvider, ChatTurnRequest, PairWriterIssue, PairWriterStatus, ReplyDone,
    ReplyError, ReplyErrorKind, ReplyEvent, ReplyStream,
};

/// Default model name reported in `What it read` by the scripted provider.
pub const DEFAULT_SCRIPTED_MODEL: &str = "scripted-pair-writer";

/// Behavior mode for [`ScriptedProvider`], allowing tests to exercise setup
/// and mid-stream failure states.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ScriptedMode {
    #[default]
    Ready,
    MissingModel,
    FailMidStream,
}

/// Pacing and mode configuration for [`ScriptedProvider`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScriptedConfig {
    /// Base delay before the first token on a first read (ADR 0010: ~2 s).
    pub first_token_delay: Duration,
    /// Additional delay per further 1,000 words on a first read (ADR 0010: ~3 s).
    pub per_1000_words_delay: Duration,
    /// Delay before the first token on a follow-up turn (ADR 0010: <1 s).
    pub followup_first_token_delay: Duration,
    /// Streaming rate in tokens per second (ADR 0010: ~30 tokens/s).
    pub tokens_per_second: u32,
    /// Delay before a scripted background review finishes (tests shorten this).
    pub review_delay: Duration,
    pub mode: ScriptedMode,
    pub model: String,
}

impl Default for ScriptedConfig {
    fn default() -> Self {
        Self {
            first_token_delay: Duration::from_millis(2_000),
            per_1000_words_delay: Duration::from_millis(3_000),
            followup_first_token_delay: Duration::from_millis(450),
            tokens_per_second: 30,
            review_delay: Duration::from_millis(1_200),
            mode: ScriptedMode::Ready,
            model: DEFAULT_SCRIPTED_MODEL.to_owned(),
        }
    }
}

impl ScriptedConfig {
    /// Computes the delay before the first token for a reading.
    pub fn first_token_wait(&self, total_words: usize, is_followup: bool) -> Duration {
        if is_followup {
            return self.followup_first_token_delay;
        }
        let extra_words = total_words.saturating_sub(1_000);
        let extra_ms =
            (extra_words as u128).saturating_mul(self.per_1000_words_delay.as_millis()) / 1_000;
        let extra_ms = u64::try_from(extra_ms).unwrap_or(u64::MAX);
        self.first_token_delay
            .saturating_add(Duration::from_millis(extra_ms))
    }

    fn token_interval(&self) -> Duration {
        if self.tokens_per_second == 0 {
            Duration::ZERO
        } else {
            Duration::from_secs_f64(1.0 / f64::from(self.tokens_per_second))
        }
    }
}

/// Deterministic scripted pair-writer provider.
#[derive(Debug, Clone)]
pub struct ScriptedProvider {
    config: ScriptedConfig,
    #[cfg(test)]
    active_generations: std::sync::Arc<std::sync::atomic::AtomicUsize>,
}

impl ScriptedProvider {
    pub fn new(config: ScriptedConfig) -> Self {
        Self {
            config,
            #[cfg(test)]
            active_generations: std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0)),
        }
    }

    pub fn config(&self) -> &ScriptedConfig {
        &self.config
    }

    #[cfg(test)]
    fn active_generations(&self) -> usize {
        self.active_generations
            .load(std::sync::atomic::Ordering::SeqCst)
    }
}

#[cfg(test)]
struct GenerationGuard(std::sync::Arc<std::sync::atomic::AtomicUsize>);

#[cfg(test)]
impl Drop for GenerationGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
    }
}

impl ChatProvider for ScriptedProvider {
    fn status(&self) -> AgentFuture<'_, PairWriterStatus> {
        let config = self.config.clone();
        Box::pin(async move {
            match config.mode {
                ScriptedMode::MissingModel => PairWriterStatus {
                    ready: false,
                    provider: Some("scripted".to_owned()),
                    model: Some(config.model),
                    issue: Some(PairWriterIssue::ModelMissing),
                    detail: Some(
                        "The configured pair-writer model is not installed. See service/README.md to configure the pair writer."
                            .to_owned(),
                    ),
                },
                ScriptedMode::Ready | ScriptedMode::FailMidStream => PairWriterStatus {
                    ready: true,
                    provider: Some("scripted".to_owned()),
                    model: Some(config.model),
                    issue: None,
                    detail: None,
                },
            }
        })
    }

    fn reply(&self, request: ChatTurnRequest) -> AgentFuture<'_, Result<ReplyStream, ReplyError>> {
        let config = self.config.clone();
        #[cfg(test)]
        let active_generations = std::sync::Arc::clone(&self.active_generations);
        Box::pin(async move {
            if config.mode == ScriptedMode::MissingModel {
                return Err(ReplyError {
                    kind: ReplyErrorKind::Unavailable,
                    detail: "The configured pair-writer model is not installed.".to_owned(),
                });
            }

            let reading = assemble_reading(&request);
            let is_followup = !reading.history.is_empty();
            let first_wait = config.first_token_wait(reading.total_words, is_followup);
            let interval = config.token_interval();
            let reply_text = compose_scripted_reply(&request.message, &reading);
            let tokens = tokenize_for_stream(&reply_text);
            let done = ReplyDone {
                model: config.model.clone(),
                prompt_version: None,
                sources: reading.sources,
                total_words: u32::try_from(reading.total_words).unwrap_or(u32::MAX),
                dropped_history_turns: u32::try_from(reading.dropped_history_turns)
                    .unwrap_or(u32::MAX),
                metrics: None,
            };
            let fail_mid_stream = config.mode == ScriptedMode::FailMidStream;

            let (tx, rx) = mpsc::channel(16);
            #[cfg(test)]
            let _guard = {
                active_generations.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                GenerationGuard(active_generations)
            };
            tokio::spawn(async move {
                #[cfg(test)]
                let _task_guard = _guard;
                if !sleep_or_closed(&tx, first_wait).await {
                    return;
                }

                let fail_after = if fail_mid_stream {
                    Some(tokens.len().clamp(1, 4))
                } else {
                    None
                };

                for (index, token) in tokens.into_iter().enumerate() {
                    if tx.send(ReplyEvent::Delta(token)).await.is_err() {
                        return;
                    }
                    if fail_after == Some(index + 1) {
                        if !sleep_or_closed(&tx, interval).await {
                            return;
                        }
                        let _ = tx
                            .send(ReplyEvent::Error(ReplyError {
                                kind: ReplyErrorKind::UpstreamFailed,
                                detail:
                                    "The pair writer stopped responding before the reply finished."
                                        .to_owned(),
                            }))
                            .await;
                        return;
                    }
                    if !sleep_or_closed(&tx, interval).await {
                        return;
                    }
                }

                let _ = tx.send(ReplyEvent::Done(done)).await;
            });

            Ok(ReplyStream::from_receiver(rx))
        })
    }

    fn review(
        &self,
        request: ReviewRequest,
    ) -> AgentFuture<'_, Result<ReviewResponse, ReplyError>> {
        let config = self.config.clone();
        #[cfg(test)]
        let active_generations = std::sync::Arc::clone(&self.active_generations);
        Box::pin(async move {
            if config.mode == ScriptedMode::MissingModel {
                return Err(ReplyError {
                    kind: ReplyErrorKind::Unavailable,
                    detail: "The configured pair-writer model is not installed.".to_owned(),
                });
            }

            #[cfg(test)]
            let _guard = {
                active_generations.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                GenerationGuard(active_generations)
            };

            if !config.review_delay.is_zero() {
                tokio::time::sleep(config.review_delay).await;
            }

            if config.mode == ScriptedMode::FailMidStream {
                return Err(ReplyError {
                    kind: ReplyErrorKind::UpstreamFailed,
                    detail: "The pair writer stopped responding before the review finished."
                        .to_owned(),
                });
            }

            Ok(scripted_review(&request, &config.model))
        })
    }
}

async fn sleep_or_closed(tx: &mpsc::Sender<ReplyEvent>, delay: Duration) -> bool {
    if delay.is_zero() {
        return !tx.is_closed();
    }
    tokio::select! {
        biased;
        () = tx.closed() => false,
        () = tokio::time::sleep(delay) => true,
    }
}

/// Splits `text` into word-sized tokens while preserving exact whitespace and
/// newlines so concatenating every token reproduces `text` verbatim.
fn tokenize_for_stream(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut seen_non_ws = false;

    for ch in text.chars() {
        if ch.is_whitespace() {
            current.push(ch);
            if seen_non_ws {
                tokens.push(std::mem::take(&mut current));
                seen_non_ws = false;
            }
        } else {
            seen_non_ws = true;
            current.push(ch);
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

/// Extracts clean verbatim sentences from Markdown prose, stripping block and
/// inline formatting markers so each quote matches rendered editor text.
fn extract_sentences(markdown: &str) -> Vec<String> {
    let mut sentences = Vec::new();
    let mut in_code_fence = false;

    for raw_line in markdown.lines() {
        let trimmed = raw_line.trim();
        if trimmed.starts_with("```") {
            in_code_fence = !in_code_fence;
            continue;
        }
        if in_code_fence || trimmed.is_empty() || trimmed == "---" || trimmed == "***" {
            continue;
        }
        let cleaned = strip_block_prefix(trimmed);
        let plain = strip_markdown_inline(cleaned).trim().to_owned();
        if plain.is_empty() {
            continue;
        }

        for piece in split_sentences(&plain) {
            let candidate = piece.trim();
            // Skip sentences containing ASCII double quotes so quoting them
            // inside "..." stays unambiguous for quote links.
            if candidate.len() >= 12
                && !candidate.contains('"')
                && !sentences.iter().any(|existing| existing == candidate)
            {
                sentences.push(candidate.to_owned());
            }
        }
    }
    sentences
}

fn strip_block_prefix(line: &str) -> &str {
    let line = line.trim_start_matches('#').trim_start();
    let line = line.strip_prefix("> ").unwrap_or(line);
    let line = line
        .strip_prefix("- ")
        .or_else(|| line.strip_prefix("* "))
        .unwrap_or(line);
    line.trim()
}

fn split_sentences(text: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut start = 0;
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if (b == b'.' || b == b'!' || b == b'?')
            && (i + 1 == bytes.len() || bytes[i + 1].is_ascii_whitespace())
        {
            result.push(text[start..=i].trim().to_owned());
            i += 1;
            while i < bytes.len() && bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            start = i;
            continue;
        }
        i += 1;
    }
    if start < text.len() {
        let tail = text[start..].trim();
        if !tail.is_empty() {
            result.push(tail.to_owned());
        }
    }
    result
}

/// Builds a concise italicized alternative derived deterministically from a
/// quoted sentence without copying verbatim.
fn brief_alternative(sentence: &str, variant: usize) -> String {
    let words: Vec<&str> = sentence.split_whitespace().collect();
    let subject = words
        .iter()
        .take(3)
        .copied()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_end_matches(['.', ',', ';', ':', '!', '?'])
        .to_owned();
    let subject = if subject.is_empty() {
        "the opening beat".to_owned()
    } else {
        subject
    };
    match variant % 3 {
        0 => format!("*{subject}, pared back to one concrete detail*"),
        1 => format!("*{subject}, with the physical pause made explicit*"),
        _ => format!("*{subject}, held a beat longer before the turn*"),
    }
}

/// Derives a deterministic, advice-only numbered reply from the writer's
/// message and the turn's reading.
pub fn compose_scripted_reply(message: &str, reading: &AssembledReading) -> String {
    let lower = message.to_lowercase();
    let selection_sentences = reading
        .selection
        .as_deref()
        .map(extract_sentences)
        .unwrap_or_default();
    let doc_sentences = extract_sentences(&reading.document_text);

    let mut quotes: Vec<String> = Vec::new();
    if let Some(ref sel) = reading.selection {
        let plain_sel = strip_markdown_inline(sel).trim().to_owned();
        if let Some(first) = selection_sentences.first() {
            quotes.push(first.clone());
        } else if !plain_sel.is_empty() && !plain_sel.contains('"') {
            quotes.push(plain_sel);
        }
    }
    for s in &doc_sentences {
        if quotes.len() >= 3 {
            break;
        }
        if !quotes.iter().any(|existing| existing == s) {
            quotes.push(s.clone());
        }
    }

    let mut notes = Vec::new();
    if let Some(ref pinned) = reading.finding {
        let pinned_quote = strip_markdown_inline(&pinned.quote).trim().to_owned();
        if !pinned_quote.is_empty() && !pinned_quote.contains('"') {
            let alt = brief_alternative(&pinned_quote, 0);
            notes.push(format!(
                "1. On the {} note for \"{pinned_quote}\", consider keeping the intent while trying a sharper turn such as {alt}.",
                pinned.agent
            ));
            notes.push(
                "2. Check how the sentence immediately before and after this passage sets up the rhythm before revising."
                    .to_owned(),
            );
        }
    }

    if !notes.is_empty() {
        // Finding-grounded notes already populated.
    } else if quotes.is_empty() {
        notes.push(
            "1. The draft is currently light on prose; try opening on one concrete sensory beat, such as *a door latch clicking shut before anyone speaks*."
                .to_owned(),
        );
        notes.push(
            "2. Once a first paragraph is on the page, select a line or ask again for tighter pacing and phrasing notes."
                .to_owned(),
        );
    } else if reading.selection.is_some() {
        let q1 = &quotes[0];
        let alt1 = brief_alternative(q1, 0);
        notes.push(format!(
            "1. In \"{q1}\", tightening the cadence around the main image keeps the focus sharp; for instance, {alt1}."
        ));
        if let Some(q2) = quotes.get(1) {
            let alt2 = brief_alternative(q2, 1);
            notes.push(format!(
                "2. Looking at how the passage connects to \"{q2}\", echoing one tactile detail across both lines strengthens the transition, such as {alt2}."
            ));
        } else {
            notes.push(
                "2. Check whether the sentence straight after this selection releases the tension too quickly or earns a brief pause."
                    .to_owned(),
            );
        }
    } else if lower.contains("develop") || lower.contains("further") {
        let q1 = &quotes[0];
        let alt1 = brief_alternative(q1, 1);
        notes.push(format!(
            "1. Around \"{q1}\", there is room to show what is at stake in the moment rather than moving past it quickly; consider a beat like {alt1}."
        ));
        if let Some(q2) = quotes.get(1) {
            let alt2 = brief_alternative(q2, 2);
            notes.push(format!(
                "2. Build out the consequence implied by \"{q2}\" so the reader feels the turn before the next paragraph, for example {alt2}."
            ));
        }
    } else if lower.contains("other ideas") || lower.contains("explore") {
        let q1 = &quotes[0];
        let alt1 = brief_alternative(q1, 2);
        notes.push(format!(
            "1. Starting from \"{q1}\", try testing the opposite expectation for what happens next, such as {alt1}."
        ));
        if let Some(q2) = quotes.get(1) {
            let alt2 = brief_alternative(q2, 0);
            notes.push(format!(
                "2. Revisit \"{q2}\" from a slightly tighter point of view to see what details change, for instance {alt2}."
            ));
        }
    } else {
        let q1 = &quotes[0];
        let alt1 = brief_alternative(q1, 0);
        notes.push(format!(
            "1. In \"{q1}\", trimming one modifier and grounding the action in a single physical detail would tighten the line; try {alt1}."
        ));
        if let Some(q2) = quotes.get(1) {
            let alt2 = brief_alternative(q2, 1);
            notes.push(format!(
                "2. Around \"{q2}\", check whether the rhythm speeds up too early; a firmer beat such as {alt2} keeps the scene steady."
            ));
        }
        if let Some(q3) = quotes.get(2) {
            let alt3 = brief_alternative(q3, 2);
            notes.push(format!(
                "3. For \"{q3}\", make sure the closing emphasis lands on the strongest noun, for example {alt3}."
            ));
        }
    }

    if !reading.context_documents.is_empty() {
        let titles: Vec<&str> = reading
            .context_documents
            .iter()
            .map(|doc| doc.title.as_str())
            .collect();
        let next_num = notes.len() + 1;
        notes.push(format!(
            "{next_num}. Comparing against {}, keep the shared details and timeline aligned before revising the transition; try *anchoring one recurring detail between both drafts*.",
            titles.join(", ")
        ));
    }

    notes.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{DocumentInput, HistoryMessage, HistoryRole};

    fn fast_config(mode: ScriptedMode) -> ScriptedConfig {
        ScriptedConfig {
            first_token_delay: Duration::from_millis(1),
            per_1000_words_delay: Duration::ZERO,
            followup_first_token_delay: Duration::from_millis(1),
            tokens_per_second: 0,
            review_delay: Duration::from_millis(1),
            mode,
            model: DEFAULT_SCRIPTED_MODEL.to_owned(),
        }
    }

    fn sample_request() -> ChatTurnRequest {
        ChatTurnRequest {
            message: "Give me some ideas about how I can improve this text".to_owned(),
            document: DocumentInput {
                document_id: "doc-1".to_owned(),
                title: "Chapter 1".to_owned(),
                content: "The keeper climbed the stairs twice before lighting the lamp.\n\nCold rain ticked against the glass while the harbor went dark.\n".to_owned(),
                scope: None,
                cursor_offset: None,
            },
            selection: None,
            finding: None,
            context_documents: vec![],
            history: vec![],
        }
    }

    #[tokio::test]
    async fn streams_deterministic_advice_quoting_the_document() {
        let provider = ScriptedProvider::new(fast_config(ScriptedMode::Ready));
        assert!(provider.status().await.ready);

        let mut stream = provider.reply(sample_request()).await.unwrap();
        let mut text = String::new();
        let mut done = None;
        while let Some(event) = stream.recv().await {
            match event {
                ReplyEvent::Delta(chunk) => text.push_str(&chunk),
                ReplyEvent::Done(summary) => done = Some(summary),
                ReplyEvent::Error(err) => panic!("unexpected error: {err:?}"),
            }
        }

        assert!(
            text.contains("\"The keeper climbed the stairs twice before lighting the lamp.\""),
            "reply: {text}"
        );
        assert!(
            text.contains("\"Cold rain ticked against the glass while the harbor went dark.\""),
            "reply: {text}"
        );
        assert!(
            text.contains('*'),
            "expected italicized alternative: {text}"
        );
        let done = done.expect("done event");
        assert_eq!(done.model, DEFAULT_SCRIPTED_MODEL);
        assert_eq!(done.prompt_version, None);
        assert_eq!(done.sources.len(), 1);
    }

    #[tokio::test]
    async fn missing_model_mode_reports_not_ready_and_rejects_reply() {
        let provider = ScriptedProvider::new(fast_config(ScriptedMode::MissingModel));
        let status = provider.status().await;
        assert!(!status.ready);
        assert_eq!(status.issue, Some(PairWriterIssue::ModelMissing));

        let err = provider.reply(sample_request()).await.err().unwrap();
        assert_eq!(err.kind, ReplyErrorKind::Unavailable);
    }

    #[tokio::test]
    async fn fail_mid_stream_emits_deltas_then_error() {
        let provider = ScriptedProvider::new(fast_config(ScriptedMode::FailMidStream));
        let mut stream = provider.reply(sample_request()).await.unwrap();
        let mut deltas = 0usize;
        let mut error = None;
        while let Some(event) = stream.recv().await {
            match event {
                ReplyEvent::Delta(_) => deltas += 1,
                ReplyEvent::Error(err) => error = Some(err),
                ReplyEvent::Done(_) => panic!("expected error before done"),
            }
        }
        assert!(deltas >= 1);
        assert_eq!(error.unwrap().kind, ReplyErrorKind::UpstreamFailed);
    }

    #[test]
    fn default_pacing_matches_adr_0010_targets() {
        let config = ScriptedConfig::default();
        assert_eq!(
            config.first_token_wait(500, false),
            Duration::from_millis(2_000)
        );
        assert_eq!(
            config.first_token_wait(3_000, false),
            Duration::from_millis(8_000)
        );
        assert!(config.first_token_wait(5_000, true) < Duration::from_secs(1));
        assert_eq!(config.tokens_per_second, 30);
    }

    #[tokio::test]
    async fn dropping_stream_stops_generation_immediately() {
        let provider = ScriptedProvider::new(ScriptedConfig {
            first_token_delay: Duration::from_secs(60),
            ..ScriptedConfig::default()
        });
        let stream = provider.reply(sample_request()).await.unwrap();
        assert_eq!(provider.active_generations(), 1);
        // Dropping the stream closes the channel and wakes the sleeper without
        // waiting 60 seconds.
        drop(stream);
        tokio::time::timeout(Duration::from_millis(500), async {
            while provider.active_generations() > 0 {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("producer task should exit immediately when stream is dropped");

        // Also verify dropping mid-stream cancels immediately between tokens.
        let mid_provider = ScriptedProvider::new(ScriptedConfig {
            first_token_delay: Duration::ZERO,
            per_1000_words_delay: Duration::ZERO,
            tokens_per_second: 1,
            ..ScriptedConfig::default()
        });
        let mut mid_stream = mid_provider.reply(sample_request()).await.unwrap();
        assert!(matches!(
            mid_stream.recv().await,
            Some(ReplyEvent::Delta(_))
        ));
        assert_eq!(mid_provider.active_generations(), 1);
        drop(mid_stream);
        tokio::time::timeout(Duration::from_millis(500), async {
            while mid_provider.active_generations() > 0 {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("producer task should exit immediately when dropped mid-stream");
    }

    #[tokio::test]
    async fn followup_turn_uses_history_and_selection() {
        let provider = ScriptedProvider::new(fast_config(ScriptedMode::Ready));
        let mut req = sample_request();
        req.selection = Some("Cold rain ticked against the glass".to_owned());
        req.history = vec![HistoryMessage {
            role: HistoryRole::Writer,
            text: "Earlier question".to_owned(),
        }];
        let mut stream = provider.reply(req).await.unwrap();
        let mut text = String::new();
        while let Some(event) = stream.recv().await {
            if let ReplyEvent::Delta(chunk) = event {
                text.push_str(&chunk);
            }
        }
        assert!(
            text.contains("\"Cold rain ticked against the glass\""),
            "reply: {text}"
        );
    }

    #[tokio::test]
    async fn review_cancels_when_future_is_dropped_and_returns_findings_when_ready() {
        let slow = std::sync::Arc::new(ScriptedProvider::new(ScriptedConfig {
            review_delay: Duration::from_secs(60),
            ..fast_config(ScriptedMode::Ready)
        }));
        let request = ReviewRequest {
            document_id: "doc-1".to_owned(),
            title: "Chapter 1".to_owned(),
            passages: vec![crate::ReviewPassageInput {
                passage_id: "p1".to_owned(),
                index: 0,
                text: "The harbor felt very dark beneath the low pier.".to_owned(),
                content_hash: "h1".to_owned(),
            }],
            document_word_count: Some(9),
        };
        let slow_task = std::sync::Arc::clone(&slow);
        let req_task = request.clone();
        let handle = tokio::spawn(async move { slow_task.review(req_task).await });
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert_eq!(slow.active_generations(), 1);
        handle.abort();
        tokio::time::timeout(Duration::from_millis(500), async {
            while slow.active_generations() > 0 {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("review task should cancel when aborted");

        let fast = ScriptedProvider::new(fast_config(ScriptedMode::Ready));
        let response = fast.review(request).await.unwrap();
        assert_eq!(response.items.len(), 1);
        assert_eq!(response.items[0].agent, crate::ReviewAgentKind::WeakProse);
    }
}

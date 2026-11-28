//! Assembles one turn's reading within ADR 0012's 19,000-word limit.

use crate::{
    ChatTurnRequest, ContextDocument, FindingContext, HistoryMessage, ReadSource, ReadSourceKind,
    ReadingScope,
};

/// Maximum words read in a single turn, matching ADR 0010's measured context
/// and ADR 0012's reading limit.
pub const READING_LIMIT_WORDS: usize = 19_000;

/// The bounded reading produced from a [`ChatTurnRequest`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssembledReading {
    pub document_id: String,
    pub document_title: String,
    pub document_text: String,
    pub document_scope: ReadingScope,
    pub document_words: usize,
    pub selection: Option<String>,
    pub finding: Option<FindingContext>,
    pub context_documents: Vec<ContextDocument>,
    pub history: Vec<HistoryMessage>,
    pub dropped_history_turns: usize,
    pub sources: Vec<ReadSource>,
    pub total_words: usize,
}

/// Counts whitespace-delimited words in `text`.
pub fn count_words(text: &str) -> usize {
    text.split_whitespace().count()
}

/// Formats an integer with ASCII comma grouping (e.g. `19,000`).
pub fn format_words(count: usize) -> String {
    let digits = count.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (idx, ch) in digits.chars().enumerate() {
        let remaining = digits.len() - idx;
        if idx > 0 && remaining.is_multiple_of(3) {
            out.push(',');
        }
        out.push(ch);
    }
    if count == 1 {
        format!("{out} word")
    } else {
        format!("{out} words")
    }
}

/// Returns a slice of `text` of at most `max_words` words centered around the
/// UTF-8 character offset `focus_char_offset`, aligned to word boundaries.
pub fn window_around_char_offset(text: &str, focus_char_offset: usize, max_words: usize) -> String {
    if max_words == 0 {
        return String::new();
    }
    let spans = word_byte_spans(text);
    if spans.len() <= max_words {
        return text.to_owned();
    }

    let focus_byte = char_offset_to_byte(text, focus_char_offset);
    let focus_word = spans.partition_point(|&(start, _)| start <= focus_byte);
    let focus_word = focus_word.saturating_sub(1).min(spans.len() - 1);

    let half = max_words / 2;
    let mut start_word = focus_word.saturating_sub(half);
    let mut end_word = start_word + max_words;
    if end_word > spans.len() {
        end_word = spans.len();
        start_word = end_word.saturating_sub(max_words);
    }

    let start_byte = spans[start_word].0;
    let end_byte = spans[end_word - 1].1;
    text[start_byte..end_byte].to_owned()
}

fn word_byte_spans(text: &str) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let mut start: Option<usize> = None;
    for (idx, ch) in text.char_indices() {
        if ch.is_whitespace() {
            if let Some(s) = start.take() {
                spans.push((s, idx));
            }
        } else if start.is_none() {
            start = Some(idx);
        }
    }
    if let Some(s) = start {
        spans.push((s, text.len()));
    }
    spans
}

fn char_offset_to_byte(text: &str, char_offset: usize) -> usize {
    match text.char_indices().nth(char_offset) {
        Some((byte_idx, _)) => byte_idx,
        None => text.len(),
    }
}

fn scope_label(scope: ReadingScope) -> &'static str {
    match scope {
        ReadingScope::Whole => "whole",
        ReadingScope::AroundSelection => "around selection",
        ReadingScope::AroundCursor => "around cursor",
    }
}

/// Finds the UTF-8 character offset of the occurrence of `needle` (or its first
/// non-empty line when `needle` spans multiple lines) in `haystack` that is
/// nearest to `hint_char`, or the first occurrence when `hint_char` is `None`.
fn nearest_occurrence_char_offset(
    haystack: &str,
    needle: &str,
    hint_char: Option<usize>,
) -> Option<usize> {
    let find_best = |target: &str| -> Option<usize> {
        if target.is_empty() {
            return None;
        }
        let Some(hint) = hint_char else {
            return haystack
                .find(target)
                .map(|byte_idx| haystack[..byte_idx].chars().count());
        };
        let mut best: Option<(usize, usize)> = None;
        let mut search_from = 0usize;
        let mut prev_byte = 0usize;
        let mut prev_chars = 0usize;
        while let Some(rel) = haystack[search_from..].find(target) {
            let byte_idx = search_from + rel;
            prev_chars += haystack[prev_byte..byte_idx].chars().count();
            prev_byte = byte_idx;
            let distance = prev_chars.abs_diff(hint);
            if best.is_none_or(|(_, best_dist)| distance < best_dist) {
                best = Some((prev_chars, distance));
            }
            let step = haystack[byte_idx..]
                .chars()
                .next()
                .map_or(1, char::len_utf8);
            search_from = byte_idx + step;
        }
        best.map(|(offset, _)| offset)
    };

    find_best(needle).or_else(|| {
        let first_line = needle
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())?;
        if first_line == needle {
            return None;
        }
        find_best(first_line)
    })
}

/// Assembles a turn's reading within [`READING_LIMIT_WORDS`]: the open
/// document (whole up to the limit, or windowed around selection/cursor),
/// added context documents that fit, and the newest thread turns (dropping
/// oldest turns first past the limit).
pub fn assemble_reading(request: &ChatTurnRequest) -> AssembledReading {
    let selection = request
        .selection
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);

    let raw_doc_words = count_words(&request.document.content);
    let (document_text, document_scope) = if raw_doc_words > READING_LIMIT_WORDS {
        if let Some(ref sel) = selection {
            let focus_char = nearest_occurrence_char_offset(
                &request.document.content,
                sel.as_str(),
                request.document.cursor_offset,
            )
            .or(request.document.cursor_offset)
            .unwrap_or(0);
            (
                window_around_char_offset(
                    &request.document.content,
                    focus_char,
                    READING_LIMIT_WORDS,
                ),
                ReadingScope::AroundSelection,
            )
        } else {
            let focus_char = request.document.cursor_offset.unwrap_or(0);
            (
                window_around_char_offset(
                    &request.document.content,
                    focus_char,
                    READING_LIMIT_WORDS,
                ),
                ReadingScope::AroundCursor,
            )
        }
    } else {
        let scope = request.document.scope.unwrap_or(ReadingScope::Whole);
        (request.document.content.clone(), scope)
    };

    let document_words = count_words(&document_text);
    let mut used_words = document_words;

    let mut context_documents = Vec::new();
    for doc in &request.context_documents {
        let words = count_words(&doc.content);
        if used_words.saturating_add(words) <= READING_LIMIT_WORDS {
            used_words += words;
            context_documents.push(doc.clone());
        }
    }

    // Keep the newest history turns within the remaining word budget,
    // dropping the oldest turns first.
    let history_budget = READING_LIMIT_WORDS.saturating_sub(used_words);
    let mut kept_reversed = Vec::new();
    let mut history_words = 0usize;
    for msg in request.history.iter().rev() {
        let words = count_words(&msg.text);
        if history_words.saturating_add(words) <= history_budget {
            history_words += words;
            kept_reversed.push(msg.clone());
        } else {
            break;
        }
    }
    kept_reversed.reverse();
    let dropped_history_turns = request.history.len().saturating_sub(kept_reversed.len());
    used_words += history_words;

    let mut sources = Vec::new();
    sources.push(ReadSource {
        kind: ReadSourceKind::Document,
        document_id: Some(request.document.document_id.clone()),
        title: Some(request.document.title.clone()),
        scope: Some(document_scope),
        word_count: to_u32(document_words),
        label: format!(
            "{} · {} · {}",
            request.document.title,
            scope_label(document_scope),
            format_words(document_words)
        ),
    });

    if let Some(ref sel) = selection {
        let sel_words = count_words(sel);
        sources.push(ReadSource {
            kind: ReadSourceKind::Selection,
            document_id: Some(request.document.document_id.clone()),
            title: Some(request.document.title.clone()),
            scope: None,
            word_count: to_u32(sel_words),
            label: format!("Selection · {}", format_words(sel_words)),
        });
    }

    let finding = request.finding.clone();
    if let Some(ref pinned) = finding {
        let finding_words = count_words(&pinned.quote) + count_words(&pinned.note);
        sources.push(ReadSource {
            kind: ReadSourceKind::Finding,
            document_id: Some(request.document.document_id.clone()),
            title: Some(request.document.title.clone()),
            scope: None,
            word_count: to_u32(finding_words),
            label: format!(
                "Finding ({}) · {}",
                pinned.agent,
                format_words(finding_words)
            ),
        });
    }

    for doc in &context_documents {
        let words = count_words(&doc.content);
        sources.push(ReadSource {
            kind: ReadSourceKind::ContextDocument,
            document_id: Some(doc.document_id.clone()),
            title: Some(doc.title.clone()),
            scope: Some(ReadingScope::Whole),
            word_count: to_u32(words),
            label: format!("{} · added · {}", doc.title, format_words(words)),
        });
    }

    if !kept_reversed.is_empty() {
        let count = kept_reversed.len();
        let noun = if count == 1 { "message" } else { "messages" };
        sources.push(ReadSource {
            kind: ReadSourceKind::History,
            document_id: None,
            title: None,
            scope: None,
            word_count: to_u32(history_words),
            label: format!(
                "Thread history · {count} earlier {noun} · {}",
                format_words(history_words)
            ),
        });
    }

    AssembledReading {
        document_id: request.document.document_id.clone(),
        document_title: request.document.title.clone(),
        document_text,
        document_scope,
        document_words,
        selection,
        finding,
        context_documents,
        history: kept_reversed,
        dropped_history_turns,
        sources,
        total_words: used_words,
    }
}

fn to_u32(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

/// Strips simple inline Markdown syntax (`*`, `_`, `` ` ``, `[label](url)`) so
/// quoted sentences match rendered editor plain text verbatim.
pub fn strip_markdown_inline(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        match chars[i] {
            '[' => {
                // Handle `[label](url)` -> `label`.
                if let Some(close_bracket) = chars[i + 1..].iter().position(|&c| c == ']') {
                    let close_bracket = i + 1 + close_bracket;
                    if chars.get(close_bracket + 1) == Some(&'(')
                        && let Some(close_paren) =
                            chars[close_bracket + 2..].iter().position(|&c| c == ')')
                    {
                        let inner: String = chars[i + 1..close_bracket].iter().collect();
                        out.push_str(&strip_markdown_inline(&inner));
                        i = close_bracket + 2 + close_paren + 1;
                        continue;
                    }
                }
                out.push('[');
                i += 1;
            }
            '*' | '_' | '`' => {
                i += 1;
            }
            '\\' if i + 1 < chars.len() => {
                out.push(chars[i + 1]);
                i += 2;
            }
            ch => {
                out.push(ch);
                i += 1;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{DocumentInput, HistoryRole};

    fn make_words(prefix: &str, count: usize) -> String {
        (0..count)
            .map(|i| format!("{prefix}{i}"))
            .collect::<Vec<_>>()
            .join(" ")
    }

    #[test]
    fn keeps_short_document_whole_and_records_sources() {
        let req = ChatTurnRequest {
            message: "How can I tighten this?".to_owned(),
            document: DocumentInput {
                document_id: "doc-1".to_owned(),
                title: "Chapter 1".to_owned(),
                content: "The lantern swayed above the harbor stones.".to_owned(),
                scope: None,
                cursor_offset: None,
            },
            selection: Some("lantern swayed".to_owned()),
            finding: None,
            context_documents: vec![ContextDocument {
                document_id: "doc-2".to_owned(),
                title: "Notes".to_owned(),
                content: "Harbor tide arrives at dusk.".to_owned(),
            }],
            history: vec![HistoryMessage {
                role: HistoryRole::Writer,
                text: "First question".to_owned(),
            }],
        };

        let reading = assemble_reading(&req);
        assert_eq!(reading.document_scope, ReadingScope::Whole);
        assert_eq!(reading.document_words, 7);
        assert_eq!(reading.context_documents.len(), 1);
        assert_eq!(reading.history.len(), 1);
        assert_eq!(reading.dropped_history_turns, 0);
        assert_eq!(reading.total_words, 7 + 5 + 2);
        assert_eq!(reading.sources.len(), 4);
    }

    #[test]
    fn windows_long_document_around_cursor_or_selection() {
        let text = make_words("word", 22_000);
        let target = "word20000";
        let offset = text.find(target).unwrap();

        let by_cursor = assemble_reading(&ChatTurnRequest {
            message: "Review".to_owned(),
            document: DocumentInput {
                document_id: "doc-long".to_owned(),
                title: "Long Draft".to_owned(),
                content: text.clone(),
                scope: None,
                cursor_offset: Some(offset),
            },
            selection: None,
            finding: None,
            context_documents: vec![],
            history: vec![],
        });
        assert_eq!(by_cursor.document_scope, ReadingScope::AroundCursor);
        assert_eq!(by_cursor.document_words, READING_LIMIT_WORDS);
        assert!(by_cursor.document_text.contains(target));

        let by_selection = assemble_reading(&ChatTurnRequest {
            message: "Review".to_owned(),
            document: DocumentInput {
                document_id: "doc-long".to_owned(),
                title: "Long Draft".to_owned(),
                content: text,
                scope: None,
                cursor_offset: Some(0),
            },
            selection: Some(target.to_owned()),
            finding: None,
            context_documents: vec![],
            history: vec![],
        });
        assert_eq!(by_selection.document_scope, ReadingScope::AroundSelection);
        assert_eq!(by_selection.document_words, READING_LIMIT_WORDS);
        assert!(by_selection.document_text.contains(target));
    }

    #[test]
    fn drops_oldest_history_first_past_the_limit() {
        let doc_text = make_words("doc", 18_993);
        let req = ChatTurnRequest {
            message: "Now what?".to_owned(),
            document: DocumentInput {
                document_id: "doc-1".to_owned(),
                title: "Chapter".to_owned(),
                content: doc_text,
                scope: None,
                cursor_offset: None,
            },
            selection: None,
            finding: None,
            context_documents: vec![],
            history: vec![
                HistoryMessage {
                    role: HistoryRole::Writer,
                    text: "oldest one two three four five six".to_owned(),
                },
                HistoryMessage {
                    role: HistoryRole::Assistant,
                    text: "middle seven eight nine ten eleven".to_owned(),
                },
                HistoryMessage {
                    role: HistoryRole::Writer,
                    text: "newest alpha beta gamma".to_owned(),
                },
            ],
        };

        let reading = assemble_reading(&req);
        assert_eq!(reading.history.len(), 1);
        assert_eq!(reading.history[0].text, "newest alpha beta gamma");
        assert_eq!(reading.dropped_history_turns, 2);
        assert!(reading.total_words <= READING_LIMIT_WORDS);
    }

    #[test]
    fn centers_repeated_and_formatted_selection_near_cursor_offset() {
        let repeated = "She did not answer.";
        let early = format!("{repeated} earlymarker");
        let middle = make_words("mid", 25_000);
        let late = format!("latemarker {repeated}");
        let full = format!("{early} {middle} {late}");
        let late_offset = full.rfind(repeated).unwrap();
        let late_char_offset = full[..late_offset].chars().count();

        let reading = assemble_reading(&ChatTurnRequest {
            message: "Check this beat".to_owned(),
            document: DocumentInput {
                document_id: "doc-long".to_owned(),
                title: "Long Novel".to_owned(),
                content: full,
                scope: None,
                cursor_offset: Some(late_char_offset),
            },
            selection: Some(repeated.to_owned()),
            finding: None,
            context_documents: vec![],
            history: vec![],
        });
        assert_eq!(reading.document_scope, ReadingScope::AroundSelection);
        assert!(reading.document_text.contains("latemarker"));
        assert!(!reading.document_text.contains("earlymarker"));
    }

    #[test]
    fn strips_inline_markdown_cleanly() {
        assert_eq!(
            strip_markdown_inline("The lamp burned *low* in the [harbor](https://example.com)."),
            "The lamp burned low in the harbor."
        );
    }
}

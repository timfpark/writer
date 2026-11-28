//! Deterministic scripted background review for ADR 0011's five
//! pause-triggered agents: `Weak prose`, `Clarity`, `Open questions`,
//! `Point of view and tense`, and `Repetition`.
//!
//! Anchors use UTF-16 code-unit offsets within each passage's plain text
//! alongside exact verbatim quotes so the webapp can resolve them directly to
//! ProseMirror positions without UTF-8/UTF-16 skew.

use std::collections::HashMap;

use sha2::{Digest, Sha256};

use crate::reading::{count_words, format_words};
use crate::{ReadSource, ReadSourceKind};

/// Prompt version reported by the deterministic scripted reviewer in
/// `What it read`.
pub const SCRIPTED_REVIEW_PROMPT_VERSION: &str = "scripted-rules-v1";

/// One changed paragraph or scene sent for pause-triggered background review.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewPassageInput {
    pub passage_id: String,
    pub index: u32,
    pub text: String,
    pub content_hash: String,
}

/// Request to review changed paragraphs or scenes of one document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewRequest {
    pub document_id: String,
    pub title: String,
    pub passages: Vec<ReviewPassageInput>,
    pub document_word_count: Option<u32>,
}

/// The five pause-triggered background agents from ADR 0011.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ReviewAgentKind {
    WeakProse,
    Clarity,
    OpenQuestions,
    PovTense,
    Repetition,
}

impl ReviewAgentKind {
    pub const fn label(self) -> &'static str {
        match self {
            Self::WeakProse => "Weak prose",
            Self::Clarity => "Clarity",
            Self::OpenQuestions => "Open questions",
            Self::PovTense => "Point of view and tense",
            Self::Repetition => "Repetition",
        }
    }

    pub const fn category(self) -> FindingCategory {
        match self {
            Self::WeakProse | Self::Clarity | Self::PovTense | Self::Repetition => {
                FindingCategory::Prose
            }
            Self::OpenQuestions => FindingCategory::Questions,
        }
    }

    const fn key(self) -> &'static str {
        match self {
            Self::WeakProse => "weakProse",
            Self::Clarity => "clarity",
            Self::OpenQuestions => "openQuestions",
            Self::PovTense => "povTense",
            Self::Repetition => "repetition",
        }
    }
}

/// Category filters defined in ADR 0011 for the Findings tab.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FindingCategory {
    Prose,
    Continuity,
    Questions,
    Chapter,
    Rules,
}

/// Provisional passage anchor pointing to an exact substring inside one
/// reviewed passage, using UTF-16 code-unit offsets for JS/ProseMirror.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FindingAnchor {
    pub passage_id: String,
    pub content_hash: String,
    pub start_offset: u32,
    pub end_offset: u32,
    pub quote: String,
}

/// Facts shown in a finding's collapsed `What it read` disclosure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FindingAudit {
    pub model: String,
    pub prompt_version: Option<String>,
    pub trigger: String,
    pub reason: String,
    pub sources: Vec<ReadSource>,
    pub total_words: u32,
}

/// One advice-only finding produced by background review.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewFinding {
    pub finding_id: String,
    pub agent: ReviewAgentKind,
    pub agent_label: String,
    pub category: FindingCategory,
    pub confidence: u32,
    pub note: String,
    pub anchor: FindingAnchor,
    pub audit: FindingAudit,
}

/// Findings returned by one review request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewResponse {
    pub items: Vec<ReviewFinding>,
    pub model: String,
    pub prompt_version: Option<String>,
}

const MIN_PASSAGE_WORDS: usize = 4;

#[derive(Debug, Clone)]
struct Candidate {
    agent: ReviewAgentKind,
    confidence: u32,
    byte_start: usize,
    byte_end: usize,
    note: String,
}

/// Runs deterministic rules for all five pause-triggered agents over the
/// changed passages in `request`.
pub fn scripted_review(request: &ReviewRequest, model: &str) -> ReviewResponse {
    let mut items = Vec::new();
    let total_changed_words: usize = request.passages.iter().map(|p| count_words(&p.text)).sum();
    let passage_count = request.passages.len();

    let mut ordered: Vec<&ReviewPassageInput> = request.passages.iter().collect();
    ordered.sort_by_key(|p| p.index);

    for passage in ordered {
        let passage_words = count_words(&passage.text);
        if passage_words < MIN_PASSAGE_WORDS {
            continue;
        }

        let mut candidates = Vec::new();
        if let Some(c) = detect_weak_prose(&passage.text) {
            candidates.push(c);
        }
        if let Some(c) = detect_pov_tense(&passage.text) {
            candidates.push(c);
        }
        if let Some(c) = detect_clarity(&passage.text) {
            candidates.push(c);
        }
        if let Some(c) = detect_open_question(&passage.text) {
            candidates.push(c);
        }
        if let Some(c) = detect_repetition(&passage.text) {
            candidates.push(c);
        }

        // Keep highest-confidence non-overlapping spans, then order by position.
        candidates.sort_by(|a, b| {
            b.confidence
                .cmp(&a.confidence)
                .then_with(|| a.byte_start.cmp(&b.byte_start))
        });

        let mut accepted: Vec<Candidate> = Vec::new();
        for candidate in candidates {
            if candidate.byte_start >= candidate.byte_end || candidate.byte_end > passage.text.len()
            {
                continue;
            }
            let overlaps = accepted
                .iter()
                .any(|existing| spans_overlap(existing, &candidate));
            if !overlaps {
                accepted.push(candidate);
            }
        }
        accepted.sort_by_key(|c| c.byte_start);

        let scope_phrase = if passage_count == 1 {
            "1 changed paragraph".to_owned()
        } else {
            format!("{passage_count} changed paragraphs")
        };

        for candidate in accepted {
            let quote = passage.text[candidate.byte_start..candidate.byte_end].to_owned();
            if quote.trim().is_empty() {
                continue;
            }
            let start_offset = byte_to_utf16(&passage.text, candidate.byte_start);
            let end_offset = byte_to_utf16(&passage.text, candidate.byte_end);
            let finding_id = deterministic_finding_id(candidate.agent, &passage.passage_id, &quote);

            let source_label = format!(
                "{} · changed paragraph {} · {}",
                request.title,
                passage.index + 1,
                format_words(passage_words)
            );
            let sources = vec![ReadSource {
                kind: ReadSourceKind::Document,
                document_id: Some(request.document_id.clone()),
                title: Some(request.title.clone()),
                scope: None,
                word_count: u32::try_from(passage_words).unwrap_or(u32::MAX),
                label: source_label,
            }];

            let reason = format!(
                "{} checked {} after a short typing pause.",
                candidate.agent.label(),
                scope_phrase
            );

            items.push(ReviewFinding {
                finding_id,
                agent: candidate.agent,
                agent_label: candidate.agent.label().to_owned(),
                category: candidate.agent.category(),
                confidence: candidate.confidence,
                note: candidate.note,
                anchor: FindingAnchor {
                    passage_id: passage.passage_id.clone(),
                    content_hash: passage.content_hash.clone(),
                    start_offset,
                    end_offset,
                    quote,
                },
                audit: FindingAudit {
                    model: model.to_owned(),
                    prompt_version: Some(SCRIPTED_REVIEW_PROMPT_VERSION.to_owned()),
                    trigger: "Short typing pause".to_owned(),
                    reason,
                    sources,
                    total_words: u32::try_from(total_changed_words).unwrap_or(u32::MAX),
                },
            });
        }
    }

    ReviewResponse {
        items,
        model: model.to_owned(),
        prompt_version: Some(SCRIPTED_REVIEW_PROMPT_VERSION.to_owned()),
    }
}

fn spans_overlap(a: &Candidate, b: &Candidate) -> bool {
    a.byte_start < b.byte_end && b.byte_start < a.byte_end
}

fn byte_to_utf16(text: &str, byte_offset: usize) -> u32 {
    let count = text[..byte_offset]
        .chars()
        .map(char::len_utf16)
        .sum::<usize>();
    u32::try_from(count).unwrap_or(u32::MAX)
}

fn deterministic_finding_id(agent: ReviewAgentKind, passage_id: &str, quote: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(agent.key().as_bytes());
    hasher.update([0]);
    hasher.update(passage_id.as_bytes());
    hasher.update([0]);
    hasher.update(quote.as_bytes());
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(16);
    for byte in &digest[..8] {
        use std::fmt::Write;
        let _ = write!(&mut hex, "{byte:02x}");
    }
    format!("f-{hex}")
}

#[derive(Debug, Clone)]
struct WordSpan<'a> {
    raw: &'a str,
    lower: String,
    start: usize,
    end: usize,
}

fn tokenize_words(text: &str) -> Vec<WordSpan<'_>> {
    let mut words = Vec::new();
    let mut start: Option<usize> = None;

    for (idx, ch) in text.char_indices() {
        let is_word_char = ch.is_alphabetic() || ch == '\'' || ch == '\u{2019}';
        if is_word_char {
            if start.is_none() {
                start = Some(idx);
            }
        } else if let Some(s) = start.take() {
            let raw = text[s..idx].trim_matches(['\'', '\u{2019}']);
            if !raw.is_empty() {
                let adj_start = s + (text[s..idx].find(raw).unwrap_or(0));
                let adj_end = adj_start + raw.len();
                words.push(WordSpan {
                    raw,
                    lower: raw.to_lowercase(),
                    start: adj_start,
                    end: adj_end,
                });
            }
        }
    }
    if let Some(s) = start {
        let raw = text[s..].trim_matches(['\'', '\u{2019}']);
        if !raw.is_empty() {
            let adj_start = s + (text[s..].find(raw).unwrap_or(0));
            let adj_end = adj_start + raw.len();
            words.push(WordSpan {
                raw,
                lower: raw.to_lowercase(),
                start: adj_start,
                end: adj_end,
            });
        }
    }
    words
}

fn split_sentence_spans(text: &str) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let mut start = 0;
    let bytes = text.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        let b = bytes[i];
        if (b == b'.' || b == b'!' || b == b'?')
            && (i + 1 == bytes.len() || bytes[i + 1].is_ascii_whitespace())
        {
            let slice = &text[start..=i];
            let trimmed = slice.trim();
            if !trimmed.is_empty() {
                let lead = slice.find(trimmed).unwrap_or(0);
                spans.push((start + lead, start + lead + trimmed.len()));
            }
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
        let slice = &text[start..];
        let trimmed = slice.trim();
        if !trimmed.is_empty() {
            let lead = slice.find(trimmed).unwrap_or(0);
            spans.push((start + lead, start + lead + trimmed.len()));
        }
    }
    spans
}

fn find_phrase_ci(text: &str, phrase: &str) -> Option<(usize, usize)> {
    // Compare ASCII-case-insensitively on word boundaries so byte offsets stay
    // exact in `text` even when `text` contains non-ASCII characters.
    let phrase_bytes = phrase.as_bytes();
    let text_bytes = text.as_bytes();
    if phrase_bytes.is_empty() || phrase_bytes.len() > text_bytes.len() {
        return None;
    }

    for i in 0..=(text_bytes.len() - phrase_bytes.len()) {
        if !text.is_char_boundary(i) || !text.is_char_boundary(i + phrase_bytes.len()) {
            continue;
        }
        if !text_bytes[i..i + phrase_bytes.len()].eq_ignore_ascii_case(phrase_bytes) {
            continue;
        }
        let before_ok = i == 0
            || !text[..i]
                .chars()
                .next_back()
                .is_some_and(char::is_alphanumeric);
        let after_ok = i + phrase_bytes.len() == text_bytes.len()
            || !text[i + phrase_bytes.len()..]
                .chars()
                .next()
                .is_some_and(char::is_alphanumeric);
        if before_ok && after_ok {
            return Some((i, i + phrase_bytes.len()));
        }
    }
    None
}

/// Agent 1: `Weak prose` — intensifiers and filler/hedge phrases.
fn detect_weak_prose(text: &str) -> Option<Candidate> {
    const INTENSIFIERS: &[&str] = &[
        "very",
        "really",
        "quite",
        "extremely",
        "somewhat",
        "rather",
        "totally",
        "completely",
        "literally",
    ];
    const FILLERS: &[&str] = &[
        "began to",
        "started to",
        "in order to",
        "all of a sudden",
        "for a moment",
        "suddenly",
    ];

    let words = tokenize_words(text);
    for pair in words.windows(2) {
        if INTENSIFIERS.contains(&pair[0].lower.as_str()) {
            // Only pair when separated by plain horizontal space (same clause).
            let between = &text[pair[0].end..pair[1].start];
            if between == " " {
                let start = pair[0].start;
                let end = pair[1].end;
                let quote = &text[start..end];
                return Some(Candidate {
                    agent: ReviewAgentKind::WeakProse,
                    confidence: 85,
                    byte_start: start,
                    byte_end: end,
                    note: format!(
                        "The intensifier “{quote}” softens the image; a single sharper word (*carrying the weight on its own*) may land harder."
                    ),
                });
            }
        }
    }

    for filler in FILLERS {
        if let Some((start, end)) = find_phrase_ci(text, filler) {
            let quote = &text[start..end];
            return Some(Candidate {
                agent: ReviewAgentKind::WeakProse,
                confidence: 84,
                byte_start: start,
                byte_end: end,
                note: format!(
                    "“{quote}” adds distance before the action; moving straight into *the concrete verb* could tighten the beat."
                ),
            });
        }
    }

    None
}

/// Agent 2: `Point of view and tense` — tense drift within a passage or
/// head-hopping omniscient cues.
fn detect_pov_tense(text: &str) -> Option<Candidate> {
    const HEAD_HOP_CUES: &[&str] = &[
        "little did",
        "unbeknownst to",
        "she did not know that",
        "he did not know that",
        "meanwhile in another",
    ];
    for cue in HEAD_HOP_CUES {
        if let Some((start, end)) = find_phrase_ci(text, cue) {
            let quote = &text[start..end];
            return Some(Candidate {
                agent: ReviewAgentKind::PovTense,
                confidence: 83,
                byte_start: start,
                byte_end: end,
                note: format!(
                    "“{quote}” steps outside the viewpoint character's awareness; check whether *staying inside their perspective* holds the scene tighter."
                ),
            });
        }
    }

    const PAST_VERBS: &[&str] = &[
        "walked",
        "looked",
        "turned",
        "opened",
        "watched",
        "stood",
        "waited",
        "climbed",
        "whispered",
        "reached",
        "crossed",
        "stepped",
        "carried",
        "paused",
        "pushed",
        "pulled",
        "said",
    ];
    const PRESENT_VERBS: &[&str] = &[
        "walks", "looks", "turns", "opens", "watches", "stands", "waits", "climbs", "whispers",
        "reaches", "crosses", "steps", "carries", "pauses", "pushes", "pulls", "says",
    ];

    let words = tokenize_words(text);
    let past: Vec<&WordSpan<'_>> = words
        .iter()
        .filter(|w| PAST_VERBS.contains(&w.lower.as_str()))
        .collect();
    let present: Vec<&WordSpan<'_>> = words
        .iter()
        .filter(|w| PRESENT_VERBS.contains(&w.lower.as_str()))
        .collect();

    if !past.is_empty() && !present.is_empty() {
        // Anchor on the minority tense's clause (or the later verb on a tie).
        let target = if present.len() <= past.len() {
            present[0]
        } else {
            past[0]
        };
        let (start, end) = sentence_containing(text, target.start, target.end);
        let quote = &text[start..end];
        return Some(Candidate {
            agent: ReviewAgentKind::PovTense,
            confidence: 82,
            byte_start: start,
            byte_end: end,
            note: format!(
                "Verb tense shifts around “{}” in “{quote}”; check whether the passage should stay anchored in *one consistent tense*.",
                target.raw
            ),
        });
    }

    None
}

/// Agent 3: `Clarity` — ambiguous pronoun references or vague blocking.
fn detect_clarity(text: &str) -> Option<Candidate> {
    const AMBIGUOUS_PHRASES: &[&str] = &[
        "she told her",
        "he told him",
        "he looked at him",
        "she watched her",
        "he asked him",
        "she asked her",
        "she handed her",
        "he handed him",
        "it seemed somehow",
        "something about it",
    ];
    for phrase in AMBIGUOUS_PHRASES {
        if let Some((start, end)) = find_phrase_ci(text, phrase) {
            let quote = &text[start..end];
            return Some(Candidate {
                agent: ReviewAgentKind::Clarity,
                confidence: 80,
                byte_start: start,
                byte_end: end,
                note: format!(
                    "The pronouns in “{quote}” could refer to more than one person; *naming the subject directly* would keep the blocking clear."
                ),
            });
        }
    }

    // Check for a follow-up sentence opening with an unanchored pronoun ("It was", "This made", "That was").
    let sentences = split_sentence_spans(text);
    if sentences.len() >= 2 {
        const VAGUE_OPENERS: &[&str] = &["it was ", "this made ", "that made ", "that was "];
        for &(s_start, s_end) in sentences.iter().skip(1) {
            let sentence = &text[s_start..s_end];
            for opener in VAGUE_OPENERS {
                if sentence.len() >= opener.len()
                    && sentence.is_char_boundary(opener.len())
                    && sentence.as_bytes()[..opener.len()].eq_ignore_ascii_case(opener.as_bytes())
                {
                    let end = s_end.min(s_start + 80);
                    let end = floor_char_boundary(text, end);
                    let quote = text[s_start..end].trim_end();
                    let quote_end = s_start + quote.len();
                    return Some(Candidate {
                        agent: ReviewAgentKind::Clarity,
                        confidence: 79,
                        byte_start: s_start,
                        byte_end: quote_end,
                        note: format!(
                            "The opening pronoun in “{quote}” leaves its referent slightly loose; *naming what it refers to* can sharpen the connection."
                        ),
                    });
                }
            }
        }
    }

    None
}

/// Agent 4: `Open questions` — unresolved secrets, promises, or explicit questions.
fn detect_open_question(text: &str) -> Option<Candidate> {
    const QUESTION_CUES: &[&str] = &[
        "never told",
        "kept hidden",
        "no one knew",
        "nobody knew",
        "refused to say",
        "wondered why",
        "locked drawer",
        "sealed letter",
        "never explained",
        "unanswered",
        "secret",
    ];
    for cue in QUESTION_CUES {
        if let Some((cue_start, cue_end)) = find_phrase_ci(text, cue) {
            let (start, end) = sentence_containing(text, cue_start, cue_end);
            let quote = &text[start..end];
            return Some(Candidate {
                agent: ReviewAgentKind::OpenQuestions,
                confidence: 78,
                byte_start: start,
                byte_end: end,
                note: format!(
                    "What is being held back in “{quote}”, and is this the scene where the reader should glimpse *the reason behind it*?"
                ),
            });
        }
    }

    // Explicit interrogative sentence of at least 4 words.
    for (s_start, s_end) in split_sentence_spans(text) {
        let sentence = &text[s_start..s_end];
        if sentence.ends_with('?') && count_words(sentence) >= 4 {
            return Some(Candidate {
                agent: ReviewAgentKind::OpenQuestions,
                confidence: 77,
                byte_start: s_start,
                byte_end: s_end,
                note: format!(
                    "How much of “{sentence}” do you want to leave open for later chapters versus *answering in this scene*?"
                ),
            });
        }
    }

    None
}

/// Agent 5: `Repetition` — significant content word echoed within one passage.
fn detect_repetition(text: &str) -> Option<Candidate> {
    const STOP_WORDS: &[&str] = &[
        "that", "with", "from", "this", "they", "them", "their", "there", "where", "which",
        "would", "could", "should", "about", "after", "before", "while", "through", "under",
        "again", "still", "just", "only", "more", "some", "than", "into", "onto", "like", "back",
        "down", "here", "your", "will", "does", "were", "have", "been", "when", "then", "what",
        "over", "very", "really", "quite", "said", "them", "herself", "himself", "without",
        "because", "around", "against", "between", "though", "other", "another",
    ];

    let words = tokenize_words(text);
    let mut first_seen: HashMap<&str, usize> = HashMap::new();

    for (idx, word) in words.iter().enumerate() {
        if word.lower.len() < 4 || STOP_WORDS.contains(&word.lower.as_str()) {
            continue;
        }
        if let Some(&prev_idx) = first_seen.get(word.lower.as_str()) {
            // Close echo within 30 words.
            if idx - prev_idx <= 30 {
                // Expand to a 2-word phrase around the second occurrence when
                // possible so the quote is distinct from the first occurrence.
                let (start, end) = if idx > 0 && text[words[idx - 1].end..word.start] == *" " {
                    (words[idx - 1].start, word.end)
                } else {
                    (word.start, word.end)
                };
                let quote = &text[start..end];
                return Some(Candidate {
                    agent: ReviewAgentKind::Repetition,
                    confidence: 75,
                    byte_start: start,
                    byte_end: end,
                    note: format!(
                        "The word “{}” echoes closely in “{quote}”; consider *varying the second mention* unless the repetition is intentional.",
                        word.raw
                    ),
                });
            }
        } else {
            first_seen.insert(word.lower.as_str(), idx);
        }
    }

    None
}

fn sentence_containing(text: &str, byte_start: usize, byte_end: usize) -> (usize, usize) {
    for (s_start, s_end) in split_sentence_spans(text) {
        if byte_start >= s_start && byte_end <= s_end {
            // Keep very long sentences trimmed near the matched clause.
            if s_end - s_start <= 140 {
                return (s_start, s_end);
            }
            return (byte_start, byte_end);
        }
    }
    (byte_start, byte_end)
}

fn floor_char_boundary(text: &str, mut index: usize) -> usize {
    index = index.min(text.len());
    while index > 0 && !text.is_char_boundary(index) {
        index -= 1;
    }
    index
}

#[cfg(test)]
mod tests {
    use super::*;

    fn passage(id: &str, index: u32, text: &str) -> ReviewPassageInput {
        ReviewPassageInput {
            passage_id: id.to_owned(),
            index,
            text: text.to_owned(),
            content_hash: format!("h-{index}"),
        }
    }

    fn run(passages: Vec<ReviewPassageInput>) -> ReviewResponse {
        scripted_review(
            &ReviewRequest {
                document_id: "doc-1".to_owned(),
                title: "Chapter 1".to_owned(),
                passages,
                document_word_count: None,
            },
            "scripted-pair-writer",
        )
    }

    #[test]
    fn detects_all_five_pause_triggered_agents() {
        let resp = run(vec![
            passage("p1", 0, "The harbor felt very dark beneath the low pier."),
            passage(
                "p2",
                1,
                "Mara checked the latch before she told her to wait outside.",
            ),
            passage(
                "p3",
                2,
                "She never told the harbor master where the brass key lay.",
            ),
            passage(
                "p4",
                3,
                "Tom walked along the seawall and opens the rusted gate quietly.",
            ),
            passage(
                "p5",
                4,
                "Cold lantern light spilled from the lantern along the stone steps.",
            ),
        ]);

        let agents: Vec<ReviewAgentKind> = resp.items.iter().map(|f| f.agent).collect();
        assert!(agents.contains(&ReviewAgentKind::WeakProse));
        assert!(agents.contains(&ReviewAgentKind::Clarity));
        assert!(agents.contains(&ReviewAgentKind::OpenQuestions));
        assert!(agents.contains(&ReviewAgentKind::PovTense));
        assert!(agents.contains(&ReviewAgentKind::Repetition));

        let open_q = resp
            .items
            .iter()
            .find(|f| f.agent == ReviewAgentKind::OpenQuestions)
            .unwrap();
        assert_eq!(open_q.category, FindingCategory::Questions);
        assert_eq!(open_q.agent_label, "Open questions");
    }

    #[test]
    fn computes_exact_utf16_offsets_with_non_ascii_text() {
        // Contains curly apostrophe and accented letters (multi-byte UTF-8, 1 UTF-16 unit)
        // plus an emoji (4-byte UTF-8, 2 UTF-16 code units).
        let text = "Café’s pier 🌊 looked very cold at dusk.";
        let resp = run(vec![passage("p1", 0, text)]);
        let finding = resp
            .items
            .iter()
            .find(|f| f.agent == ReviewAgentKind::WeakProse)
            .expect("weak prose finding");

        assert_eq!(finding.anchor.quote, "very cold");
        let utf16: Vec<u16> = text.encode_utf16().collect();
        let slice =
            &utf16[finding.anchor.start_offset as usize..finding.anchor.end_offset as usize];
        assert_eq!(String::from_utf16(slice).unwrap(), "very cold");
    }

    #[test]
    fn skips_short_fragments_and_clean_prose() {
        let resp = run(vec![
            passage("p1", 0, "Too short."),
            passage(
                "p2",
                1,
                "Salt spray clung to the iron railing while the ferry cleared the breakwater.",
            ),
        ]);
        assert!(resp.items.is_empty());
    }

    #[test]
    fn never_returns_overlapping_spans_in_one_passage() {
        let resp = run(vec![passage(
            "p1",
            0,
            "The very dark water kept hidden what she never told anyone about the very dark pier.",
        )]);
        for pair in resp.items.windows(2) {
            assert!(
                pair[0].anchor.end_offset <= pair[1].anchor.start_offset,
                "overlapping findings: {:?} vs {:?}",
                pair[0].anchor,
                pair[1].anchor
            );
        }
    }

    #[test]
    fn includes_audit_facts_for_what_it_read() {
        let resp = run(vec![passage(
            "p1",
            0,
            "The harbor felt very dark beneath the low pier.",
        )]);
        let finding = &resp.items[0];
        assert_eq!(finding.audit.model, "scripted-pair-writer");
        assert_eq!(
            finding.audit.prompt_version.as_deref(),
            Some(SCRIPTED_REVIEW_PROMPT_VERSION)
        );
        assert_eq!(finding.audit.trigger, "Short typing pause");
        assert!(finding.audit.reason.contains("Weak prose"));
        assert_eq!(finding.audit.sources.len(), 1);
        assert_eq!(
            finding.audit.sources[0].document_id.as_deref(),
            Some("doc-1")
        );
    }
}

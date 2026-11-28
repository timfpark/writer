//! Product pair-writer prompt templates and prefix-cached message assembly.
//!
//! Prompts live in `service/prompts/` (kept separate from coding-agent files)
//! and follow the `[system]` / `[user]` format used by `evals/prompts/`.

use std::fmt::Write as _;

use sha2::{Digest, Sha256};

use crate::reading::AssembledReading;
use crate::{HistoryRole, reading::strip_markdown_inline};

/// Name of ADR 0010's chosen conversation prompt.
pub const CONVERSATION_GROUNDED_NAME: &str = "conversation-grounded";

const CONVERSATION_GROUNDED_RAW: &str = include_str!("../../../prompts/conversation-grounded.txt");

/// One message in a chat-completion request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromptMessage {
    pub role: &'static str,
    pub content: String,
}

/// A parsed prompt template with its content digest.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromptTemplate {
    pub name: String,
    pub system: String,
    pub user: String,
    /// First 12 lowercase hex characters of the raw template file's SHA-256.
    pub digest: String,
}

impl PromptTemplate {
    /// Parses a `[system]` + `[user]` template file and computes its 12-char
    /// SHA-256 digest over the exact raw UTF-8 bytes, matching `evals/`.
    pub fn parse(name: impl Into<String>, raw: &str) -> Result<Self, String> {
        let rest = raw
            .strip_prefix("[system]\n")
            .ok_or_else(|| "prompt must start with a [system] section".to_owned())?;
        let (system, user) = rest
            .split_once("\n[user]\n")
            .ok_or_else(|| "prompt must contain a [user] section after [system]".to_owned())?;

        let hash = Sha256::digest(raw.as_bytes());
        let mut digest = String::with_capacity(12);
        for byte in &hash[..6] {
            let _ = write!(&mut digest, "{byte:02x}");
        }

        Ok(Self {
            name: name.into(),
            system: system.trim().to_owned(),
            user: user.trim().to_owned(),
            digest,
        })
    }

    /// Name and digest reported in `What it read` (`<name>@<digest>`).
    pub fn version(&self) -> String {
        format!("{}@{}", self.name, self.digest)
    }

    /// Renders `reading` and `request` into chat messages with the documents
    /// placed first so Ollama can reuse its KV cache on follow-up turns.
    pub fn render_messages(&self, reading: &AssembledReading, request: &str) -> Vec<PromptMessage> {
        let documents = render_documents(reading);
        let selection_block =
            render_selection_and_finding(reading.selection.as_deref(), reading.finding.as_ref());
        let trimmed_request = request.trim();

        let mut messages = Vec::with_capacity(reading.history.len() + 2);
        messages.push(PromptMessage {
            role: "system",
            content: self.system.clone(),
        });

        if reading.history.is_empty() {
            messages.push(PromptMessage {
                role: "user",
                content: fill_user_template(
                    &self.user,
                    &documents,
                    &selection_block,
                    trimmed_request,
                ),
            });
            return messages;
        }

        // Place the open and added documents in the first user turn so the
        // entire `[system]` + `<document>` prefix stays byte-identical across
        // follow-up turns over an unchanged draft.
        let mut history = reading.history.iter().peekable();
        if history
            .peek()
            .is_some_and(|msg| msg.role == HistoryRole::Writer)
        {
            let first = history.next().expect("checked peek");
            messages.push(PromptMessage {
                role: "user",
                content: fill_user_template(&self.user, &documents, "", first.text.trim()),
            });
        } else {
            messages.push(PromptMessage {
                role: "user",
                content: format!("The writer is working on these documents:\n\n{documents}"),
            });
        }

        for msg in history {
            match msg.role {
                HistoryRole::Writer => messages.push(PromptMessage {
                    role: "user",
                    content: format!("The writer asks: {}", msg.text.trim()),
                }),
                HistoryRole::Assistant => messages.push(PromptMessage {
                    role: "assistant",
                    content: msg.text.clone(),
                }),
            }
        }

        let final_user = if selection_block.is_empty() {
            format!("The writer asks: {trimmed_request}")
        } else {
            format!(
                "{}\nThe writer asks: {trimmed_request}",
                selection_block.trim_start_matches('\n')
            )
        };
        messages.push(PromptMessage {
            role: "user",
            content: final_user,
        });

        messages
    }
}

/// Loads ADR 0010's built-in `conversation-grounded` prompt template.
pub fn conversation_grounded_prompt() -> PromptTemplate {
    PromptTemplate::parse(CONVERSATION_GROUNDED_NAME, CONVERSATION_GROUNDED_RAW)
        .expect("committed service/prompts/conversation-grounded.txt must be valid")
}

fn fill_user_template(template: &str, documents: &str, selection: &str, request: &str) -> String {
    template
        .replace("{{documents}}", documents)
        .replace("{{selection}}", selection)
        .replace("{{request}}", request)
}

fn render_documents(reading: &AssembledReading) -> String {
    let mut blocks = Vec::with_capacity(1 + reading.context_documents.len());
    blocks.push(render_one_document(
        &reading.document_id,
        &reading.document_title,
        &reading.document_text,
    ));
    for doc in &reading.context_documents {
        blocks.push(render_one_document(
            &doc.document_id,
            &doc.title,
            &doc.content,
        ));
    }
    blocks.join("\n\n")
}

fn render_one_document(id: &str, title: &str, text: &str) -> String {
    let safe_title = title.replace('"', "&quot;");
    let plain_text = strip_markdown_inline(text);
    format!(
        "<document id=\"{id}\" title=\"{safe_title}\">\n{}\n</document>",
        plain_text.trim()
    )
}

fn render_selection_and_finding(
    selection: Option<&str>,
    finding: Option<&crate::FindingContext>,
) -> String {
    let mut out = String::new();
    if let Some(pinned) = finding {
        out.push_str(&format!(
            "\nThe writer is discussing this {} finding:\n<finding>\nPassage: {}\nNote: {}\n</finding>\n",
            pinned.agent.trim(),
            pinned.quote.trim(),
            pinned.note.trim()
        ));
    }
    if let Some(sel) = selection.map(str::trim).filter(|s| !s.is_empty()) {
        out.push_str(&format!(
            "\nThe writer has selected this passage:\n<selection>\n{sel}\n</selection>\n"
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        ChatTurnRequest, ContextDocument, DocumentInput, HistoryMessage, assemble_reading,
    };

    #[test]
    fn conversation_grounded_matches_adr_0010_digest() {
        let prompt = conversation_grounded_prompt();
        assert_eq!(prompt.name, "conversation-grounded");
        assert_eq!(prompt.digest, "c0a3c0b9f874");
        assert_eq!(prompt.version(), "conversation-grounded@c0a3c0b9f874");
        assert!(prompt.system.contains("Anchor every point to the draft"));
    }

    #[test]
    fn first_turn_renders_documents_selection_and_request() {
        let prompt = conversation_grounded_prompt();
        let req = ChatTurnRequest {
            message: "Give me some ideas about how I can improve this text".to_owned(),
            document: DocumentInput {
                document_id: "doc-1".to_owned(),
                title: "Chapter 1".to_owned(),
                content: "The lamp burned *low* above the harbor stones.\n".to_owned(),
                scope: None,
                cursor_offset: None,
            },
            selection: Some("The lamp burned low above the harbor stones.".to_owned()),
            finding: None,
            context_documents: vec![ContextDocument {
                document_id: "doc-2".to_owned(),
                title: "Notes".to_owned(),
                content: "The ferry departs at dawn.".to_owned(),
            }],
            history: vec![],
        };
        let reading = assemble_reading(&req);
        let messages = prompt.render_messages(&reading, &req.message);
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, "system");
        assert_eq!(messages[1].role, "user");
        assert!(
            messages[1]
                .content
                .contains("<document id=\"doc-1\" title=\"Chapter 1\">\nThe lamp burned low above the harbor stones.\n</document>")
        );
        assert!(messages[1].content.contains(
            "<document id=\"doc-2\" title=\"Notes\">\nThe ferry departs at dawn.\n</document>"
        ));
        assert!(
            messages[1].content.contains(
                "<selection>\nThe lamp burned low above the harbor stones.\n</selection>"
            )
        );
        assert!(
            messages[1]
                .content
                .ends_with("The writer asks: Give me some ideas about how I can improve this text")
        );
    }

    #[test]
    fn followup_keeps_exact_first_turn_prefix_for_kv_cache_reuse() {
        let prompt = conversation_grounded_prompt();
        let doc = DocumentInput {
            document_id: "doc-1".to_owned(),
            title: "Chapter 1".to_owned(),
            content: "The lantern swayed above the harbor stones.".to_owned(),
            scope: None,
            cursor_offset: None,
        };

        let first_req = ChatTurnRequest {
            message: "How can I further develop this text?".to_owned(),
            document: doc.clone(),
            selection: None,
            finding: None,
            context_documents: vec![],
            history: vec![],
        };
        let first_reading = assemble_reading(&first_req);
        let first_messages = prompt.render_messages(&first_reading, &first_req.message);

        let followup_req = ChatTurnRequest {
            message: "What other ideas should I explore?".to_owned(),
            document: doc,
            selection: None,
            finding: None,
            context_documents: vec![],
            history: vec![
                HistoryMessage {
                    role: HistoryRole::Writer,
                    text: "How can I further develop this text?".to_owned(),
                },
                HistoryMessage {
                    role: HistoryRole::Assistant,
                    text: "1. Build on \"The lantern swayed above the harbor stones.\"".to_owned(),
                },
            ],
        };
        let followup_reading = assemble_reading(&followup_req);
        let followup_messages = prompt.render_messages(&followup_reading, &followup_req.message);

        assert_eq!(followup_messages.len(), 4);
        // System message and first user turn (holding the documents and first
        // question) are byte-for-byte identical, maximizing Ollama KV cache reuse.
        assert_eq!(followup_messages[0], first_messages[0]);
        assert_eq!(followup_messages[1], first_messages[1]);
        assert_eq!(followup_messages[2].role, "assistant");
        assert_eq!(
            followup_messages[3],
            PromptMessage {
                role: "user",
                content: "The writer asks: What other ideas should I explore?".to_owned(),
            }
        );
    }
}

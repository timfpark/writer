//! Names on disk, derived from titles as ADR 0006 specifies, and titles
//! derived from names for entries added outside Writer. Pure functions, so
//! the rules are tested without a file system.

use std::fmt::Write as _;

use unicase::UniCase;
use unicode_normalization::UnicodeNormalization;
use writer_domain::{ItemKind, MAX_TITLE_CHARS, Title};

/// The most UTF-8 bytes of a name before a suffix and `.md`.
const MAX_STEM_BYTES: usize = 120;
const WINDOWS_RESERVED: [char; 9] = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
const DEVICE_NAMES: [&str; 28] = [
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "COM1",
    "COM2",
    "COM3",
    "COM4",
    "COM5",
    "COM6",
    "COM7",
    "COM8",
    "COM9",
    "COM\u{b9}",
    "COM\u{b2}",
    "COM\u{b3}",
    "LPT1",
    "LPT2",
    "LPT3",
    "LPT4",
    "LPT5",
    "LPT6",
    "LPT7",
    "LPT8",
    "LPT9",
    "LPT\u{b9}",
    "LPT\u{b2}",
    "LPT\u{b3}",
];
const MARKDOWN_EXTENSION: &str = ".md";
const UNTITLED: &str = "Untitled";

/// Steps 1 to 6: the name a title maps to, before any suffix and `.md`.
pub(crate) fn stem(title: &str, kind: ItemKind) -> String {
    let mut name: String = title
        .nfc()
        .map(|c| {
            if WINDOWS_RESERVED.contains(&c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    if name.starts_with('.') {
        name.replace_range(..1, "_");
    }
    let mut end = name.len().min(MAX_STEM_BYTES);
    while !name.is_char_boundary(end) {
        end -= 1;
    }
    name.truncate(end);
    if kind == ItemKind::Folder && (name.ends_with('.') || name.ends_with(' ')) {
        name.pop();
        name.push('_');
    }
    let first_part = name.split('.').next().unwrap_or_default();
    let compared = first_part.trim_end_matches(' ');
    if DEVICE_NAMES
        .iter()
        .any(|device| device.eq_ignore_ascii_case(compared))
    {
        name.insert(first_part.len(), '_');
    }
    name
}

/// Steps 7 and 8: the stem with the `n`th suffix, where 1 means none, and
/// `.md` for a document.
pub(crate) fn file_name(stem: &str, kind: ItemKind, n: usize) -> String {
    let mut name = stem.to_owned();
    if n > 1 {
        let _ = write!(name, " ({n})");
    }
    if kind == ItemKind::Document {
        name.push_str(MARKDOWN_EXTENSION);
    }
    name
}

/// Names whose keys are equal collide: the NFC form under full Unicode case
/// folding, so case and normalization never tell two names apart.
pub(crate) fn collision_key(name: &str) -> String {
    let composed: String = name.nfc().collect();
    UniCase::unicode(composed).to_folded_case().nfc().collect()
}

/// Whether a regular file's name ends in `.md`, compared case-insensitively.
pub(crate) fn is_markdown(name: &str) -> bool {
    let bytes = name.as_bytes();
    bytes.len() > MARKDOWN_EXTENSION.len()
        && bytes[bytes.len() - MARKDOWN_EXTENSION.len()..]
            .eq_ignore_ascii_case(MARKDOWN_EXTENSION.as_bytes())
}

/// The title of an entry added outside Writer: the name without `.md`, with
/// control characters and separators as spaces, at most 200 characters,
/// trimmed, and `Untitled` when nothing is left.
pub(crate) fn title_from_name(name: &str, kind: ItemKind) -> Title {
    let base = match kind {
        ItemKind::Document if is_markdown(name) => &name[..name.len() - MARKDOWN_EXTENSION.len()],
        _ => name,
    };
    let spaced: String = base
        .chars()
        .map(|c| {
            if c.is_control() || c == '\u{2028}' || c == '\u{2029}' {
                ' '
            } else {
                c
            }
        })
        .take(MAX_TITLE_CHARS)
        .collect();
    let trimmed = spaced.trim();
    Title::parse(if trimmed.is_empty() {
        UNTITLED
    } else {
        trimmed
    })
    .unwrap_or_else(|_| Title::parse(UNTITLED).expect("the fallback title is valid"))
}

#[cfg(test)]
mod tests {
    use writer_domain::ItemKind::{Document, Folder};

    use super::*;

    fn document_name(title: &str) -> String {
        file_name(&stem(title, Document), Document, 1)
    }

    fn folder_name(title: &str) -> String {
        file_name(&stem(title, Folder), Folder, 1)
    }

    #[test]
    fn maps_the_adr_examples() {
        assert_eq!(document_name("Act 1: Arrival?"), "Act 1_ Arrival_.md");
        assert_eq!(document_name(".plan"), "_plan.md");
        assert_eq!(document_name("Con"), "Con_.md");
        assert_eq!(folder_name("Part I."), "Part I_");
        assert_eq!(
            file_name(&stem("notes", Document), Document, 2),
            "notes (2).md"
        );
    }

    #[test]
    fn replaces_every_windows_reserved_character() {
        assert_eq!(
            document_name(r#"a<b>c:d"e/f\g|h?i*j"#),
            "a_b_c_d_e_f_g_h_i_j.md"
        );
    }

    #[test]
    fn replaces_only_one_leading_dot() {
        assert_eq!(document_name("..plan"), "_.plan.md");
        assert_eq!(folder_name(".git"), "_git");
    }

    #[test]
    fn keeps_a_document_stem_ending_in_a_dot_or_space_but_not_a_folder_name() {
        assert_eq!(document_name("Part I."), "Part I..md");
        assert_eq!(folder_name("Part I."), "Part I_");
        // A trailing space can only appear after truncation.
        let title = format!("{} b", "a".repeat(119));
        assert_eq!(folder_name(&title), format!("{}_", "a".repeat(119)));
        assert_eq!(document_name(&title), format!("{} .md", "a".repeat(119)));
    }

    #[test]
    fn suffixes_reserved_device_names_in_any_case_and_with_extensions() {
        for (title, name) in [
            ("con", "con_.md"),
            ("PRN", "PRN_.md"),
            ("Aux", "Aux_.md"),
            ("nul.txt", "nul_.txt.md"),
            ("COM1", "COM1_.md"),
            ("lpt9", "lpt9_.md"),
            ("COM\u{b9}", "COM\u{b9}_.md"),
            ("lpt\u{b3}", "lpt\u{b3}_.md"),
            ("con .draft", "con _.draft.md"),
            ("COM0", "COM0.md"),
            ("Console", "Console.md"),
            ("Icon", "Icon.md"),
        ] {
            assert_eq!(document_name(title), name, "{title}");
        }
        assert_eq!(folder_name("aux"), "aux_");
    }

    #[test]
    fn truncates_to_120_bytes_at_a_character_boundary() {
        let ascii = "a".repeat(200);
        assert_eq!(stem(&ascii, Document).len(), 120);
        // Three-byte characters: 40 fit exactly.
        let cjk = "灯".repeat(200);
        assert_eq!(stem(&cjk, Document), "灯".repeat(40));
        // Four-byte characters: 30 fit exactly.
        assert_eq!(stem(&"🌊".repeat(50), Document), "🌊".repeat(30));
        // A boundary inside a character drops it: one byte plus 39 three-byte
        // characters is 118 bytes, and the next would end at 121.
        let offset = format!("a{}", "灯".repeat(50));
        assert_eq!(stem(&offset, Document), format!("a{}", "灯".repeat(39)));
        // Every name fits within 255 bytes with a suffix and `.md`.
        assert!(file_name(&stem(&cjk, Document), Document, 10_000).len() < 255);
    }

    #[test]
    fn normalizes_names_to_nfc() {
        assert_eq!(document_name("Cafe\u{301}"), "Caf\u{e9}.md");
    }

    #[test]
    fn collision_keys_ignore_case_and_normalization() {
        assert_eq!(collision_key("Notes.md"), collision_key("notes.MD"));
        assert_eq!(collision_key("\u{3a3}.md"), collision_key("\u{3c2}.md"));
        assert_eq!(collision_key("Caf\u{e9}"), collision_key("CAFE\u{301}"));
        assert_eq!(collision_key("Stra\u{df}e"), collision_key("STRASSE"));
        assert_ne!(collision_key("Notes.md"), collision_key("Notes (2).md"));
    }

    #[test]
    fn recognizes_markdown_names_in_any_case() {
        assert!(is_markdown("Chapter.md"));
        assert!(is_markdown("Chapter.MD"));
        assert!(is_markdown("灯.Md"));
        assert!(!is_markdown(".md"));
        assert!(!is_markdown("Chapter.markdown"));
        assert!(!is_markdown("Chapter"));
    }

    #[test]
    fn derives_valid_titles_from_names() {
        assert_eq!(
            title_from_name("Act 1_ Arrival_.md", Document).as_str(),
            "Act 1_ Arrival_"
        );
        assert_eq!(title_from_name("Notes.MD", Document).as_str(), "Notes");
        assert_eq!(title_from_name("Drafts.md", Folder).as_str(), "Drafts.md");
        assert_eq!(title_from_name(" padded .md", Document).as_str(), "padded");
        assert_eq!(
            title_from_name("tab\there.md", Document).as_str(),
            "tab here"
        );
        assert_eq!(
            title_from_name("line\u{2028}break.md", Document).as_str(),
            "line break"
        );
        assert_eq!(
            title_from_name("\u{3000}.md", Document).as_str(),
            "Untitled"
        );
        let long = format!("{}.md", "x".repeat(250));
        assert_eq!(title_from_name(&long, Document).as_str(), "x".repeat(200));
        let cut_at_space = format!("{} tail.md", "y".repeat(199));
        assert_eq!(
            title_from_name(&cut_at_space, Document).as_str(),
            "y".repeat(199)
        );
    }
}

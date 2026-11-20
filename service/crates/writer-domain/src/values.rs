use std::fmt;

use crate::{MAX_CONTENT_BYTES, MAX_TITLE_CHARS, Violation};

/// An item's identifier: a UUID in lowercase hyphenated form, of any version.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ItemId(String);

/// A string that is not a lowercase hyphenated UUID.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InvalidId;

impl ItemId {
    /// Accepts exactly the form `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` in
    /// lowercase hexadecimal.
    pub fn parse(value: &str) -> Result<Self, InvalidId> {
        let bytes = value.as_bytes();
        let valid = bytes.len() == 36
            && bytes.iter().enumerate().all(|(index, &byte)| match index {
                8 | 13 | 18 | 23 => byte == b'-',
                _ => matches!(byte, b'0'..=b'9' | b'a'..=b'f'),
            });
        if valid {
            Ok(Self(value.to_owned()))
        } else {
            Err(InvalidId)
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for ItemId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// A title of 1 to 200 Unicode scalar values with no surrounding whitespace,
/// no control characters, and no line or paragraph separators. It is never
/// normalized, so it reads back exactly as sent.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Title(String);

impl Title {
    pub fn parse(value: impl Into<String>) -> Result<Self, Violation> {
        let value = value.into();
        let count = value.chars().count();
        let surrounded =
            value.starts_with(char::is_whitespace) || value.ends_with(char::is_whitespace);
        let forbidden = value
            .chars()
            .any(|c| c.is_control() || c == '\u{2028}' || c == '\u{2029}');
        if (1..=MAX_TITLE_CHARS).contains(&count) && !surrounded && !forbidden {
            Ok(Self(value))
        } else {
            Err(Violation::Title)
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn into_string(self) -> String {
        self.0
    }
}

/// A document's content: UTF-8 Markdown of at most 1 MiB without U+0000,
/// stored and returned byte for byte.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Markdown(String);

impl Markdown {
    pub fn parse(value: impl Into<String>) -> Result<Self, Violation> {
        let value = value.into();
        if value.len() <= MAX_CONTENT_BYTES && !value.contains('\0') {
            Ok(Self(value))
        } else {
            Err(Violation::Content)
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn into_string(self) -> String {
        self.0
    }
}

/// An opaque token naming one version of a document's content. Clients
/// compare revisions only for equality; storage derives them.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Revision(String);

impl Revision {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

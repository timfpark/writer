use std::fmt;

use crate::ItemKind;

/// Why an operation cannot apply to the workspace.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DomainError {
    /// No item of the requested kind has the identifier.
    NotFound,
    /// The request contradicts the current tree.
    Conflict(Conflict),
    /// The request breaks a field rule or a limit.
    Invalid(Violation),
}

impl From<Violation> for DomainError {
    fn from(violation: Violation) -> Self {
        Self::Invalid(violation)
    }
}

impl From<Conflict> for DomainError {
    fn from(conflict: Conflict) -> Self {
        Self::Conflict(conflict)
    }
}

impl fmt::Display for DomainError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound => f.write_str("The requested item does not exist."),
            Self::Conflict(conflict) => f.write_str(conflict.detail()),
            Self::Invalid(violation) => f.write_str(violation.detail()),
        }
    }
}

impl std::error::Error for DomainError {}

/// A request that the workspace contradicts, answered with 409 `conflict`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Conflict {
    /// `parentId` names no folder.
    MissingParent,
    /// `beforeId` names no child of the parent.
    MissingSibling,
    /// A folder would move into itself or one of its descendants.
    Cycle,
    /// The identifier belongs to an item of the other kind.
    OtherKind,
    /// A save's base revision is not the stored content's revision.
    StaleRevision,
}

impl Conflict {
    /// A message for problem details; it never names content or titles.
    pub fn detail(self) -> &'static str {
        match self {
            Self::MissingParent | Self::MissingSibling => {
                "The target position does not exist in the workspace."
            }
            Self::Cycle => "A folder cannot move into itself or a folder it contains.",
            Self::OtherKind => "The identifier belongs to an item of the other kind.",
            Self::StaleRevision => "The document changed after the base revision.",
        }
    }
}

/// A broken field rule or limit, answered with 422 `validationFailed`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Violation {
    /// The workspace already holds [`crate::MAX_ITEMS`] items.
    ItemLimit,
    /// An item would be deeper than [`crate::MAX_DEPTH`].
    DepthLimit,
    /// A title breaks the title rules.
    Title,
    /// Content is too large or contains U+0000.
    Content,
    /// A document language is not a supported BCP 47 tag.
    Language,
    /// A new item's identifier is not a lowercase hyphenated UUID.
    Identifier(ItemKind),
}

impl Violation {
    /// The JSON Pointer of the request field the violation is reported against.
    pub fn pointer(self) -> &'static str {
        match self {
            Self::ItemLimit => "",
            Self::DepthLimit => "/parentId",
            Self::Title => "/title",
            Self::Content => "/markdown",
            Self::Language => "/language",
            Self::Identifier(ItemKind::Folder) => "/folderId",
            Self::Identifier(ItemKind::Document) => "/documentId",
        }
    }

    /// A message for problem details; it never names content or titles.
    pub fn detail(self) -> &'static str {
        match self {
            Self::ItemLimit => "The workspace already holds the maximum of 10000 items.",
            Self::DepthLimit => "The item would be deeper than the maximum depth of 16.",
            Self::Title => {
                "Must be 1 to 200 characters with no surrounding whitespace or control characters."
            }
            Self::Content => "Must be at most 1048576 bytes of UTF-8 with no U+0000 characters.",
            Self::Language => "Must be a supported BCP 47 language tag (en or es).",
            Self::Identifier(_) => "Must be a lowercase hyphenated UUID.",
        }
    }
}

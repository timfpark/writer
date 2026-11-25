//! The workspace model of ADR 0005: identifiers, titles, content, revisions,
//! the limits, and a tree that validates every operation against them.
//!
//! The crate performs no I/O and depends on no framework, so its rules are
//! tested without a runtime. Storage backends apply [`Tree`]'s checks in the
//! same serialized step as their writes.

mod error;
mod item;
mod tree;
mod values;

#[cfg(test)]
mod tests;

pub use error::{Conflict, DomainError, Violation};
pub use item::{
    Document, DocumentContent, Folder, Item, ItemKind, NewItem, Placement, WorkspaceItem,
};
pub use tree::{CreateCheck, Node, PlaceCheck, Position, Tree};
pub use values::{InvalidId, ItemId, Language, Markdown, Revision, Title};

/// The most items the workspace holds.
pub const MAX_ITEMS: usize = 10_000;
/// The deepest an item may be; a top-level item is at depth 1.
pub const MAX_DEPTH: usize = 16;
/// The most Unicode scalar values in a title.
pub const MAX_TITLE_CHARS: usize = 200;
/// The most UTF-8 bytes in a document's content.
pub const MAX_CONTENT_BYTES: usize = 1_048_576;

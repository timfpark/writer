//! The storage interface of ADR 0006, the revision derivation every backend
//! shares, the conformance suite, and the filesystem backend.
//!
//! No type here comes from axum, Tower, or utoipa, and nothing logs a path
//! inside the workspace, a title, or content.

#[cfg(any(test, feature = "conformance"))]
pub mod conformance;
mod error;
pub mod filesystem;
mod revision;

use std::future::Future;
use std::pin::Pin;

use writer_domain::{
    Document, DocumentContent, Item, ItemId, ItemKind, Markdown, NewItem, Placement, Revision,
    Title, WorkspaceItem,
};

pub use error::{Cause, InternalError, Operation, StoreError, Unreadable};
pub use filesystem::{FilesystemStore, OpenError};
pub use revision::revision_of;

/// A boxed future, so [`WorkspaceStore`] is object-safe.
pub type StoreFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, StoreError>> + Send + 'a>>;

/// Whether a create made a new item, for 201, or found it, for 200.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Created {
    New(Item),
    Existing(Item),
}

impl Created {
    pub fn item(&self) -> &Item {
        match self {
            Self::New(item) | Self::Existing(item) => item,
        }
    }

    pub fn into_item(self) -> Item {
        match self {
            Self::New(item) | Self::Existing(item) => item,
        }
    }

    pub fn is_new(&self) -> bool {
        matches!(self, Self::New(_))
    }
}

/// One method per ADR 0005 operation. Every backend applies
/// `writer-domain`'s checks to its current tree in the same serialized step
/// as the write, and passes the conformance suite.
pub trait WorkspaceStore: Send + Sync {
    /// The whole tree in pre-order.
    fn workspace(&self) -> StoreFuture<'_, Vec<WorkspaceItem>>;

    /// A folder or document; a document carries its current revision.
    fn item(&self, id: ItemId, kind: ItemKind) -> StoreFuture<'_, Item>;

    /// A document's content and revision.
    fn content(&self, id: ItemId) -> StoreFuture<'_, DocumentContent>;

    /// Creates an item, or returns the existing item of the same kind with
    /// the identifier unchanged.
    fn create(&self, item: NewItem) -> StoreFuture<'_, Created>;

    /// Changes an item's title, keeping its identifier and revision.
    fn rename(&self, id: ItemId, kind: ItemKind, title: Title) -> StoreFuture<'_, Item>;

    /// Moves or reorders an item with its subtree.
    fn place(&self, id: ItemId, kind: ItemKind, to: Placement) -> StoreFuture<'_, Item>;

    /// Replaces a document's content under ADR 0005's stale-write rule:
    /// identical content returns the current revision, a matching base
    /// replaces the content, and anything else is a conflict that changes
    /// nothing.
    fn replace_content(
        &self,
        id: ItemId,
        markdown: Markdown,
        base: Revision,
    ) -> StoreFuture<'_, Document>;

    /// Permanently deletes an item with its subtree.
    fn delete(&self, id: ItemId, kind: ItemKind) -> StoreFuture<'_, ()>;
}

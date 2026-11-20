use std::fmt;
use std::io;

use writer_domain::{Conflict, DomainError, ItemId, Violation};

/// One variant per outcome; `writer-api` maps each to an ADR 0004 problem
/// code. Nothing here holds a path, a title, or content, so every variant is
/// safe to log.
#[derive(Debug)]
pub enum StoreError {
    /// No item of the requested kind has the identifier.
    NotFound,
    /// A stale base revision, a missing parent or sibling, a cycle, or an
    /// identifier of the other kind.
    Conflict(Conflict),
    /// A `writer-domain` rule is broken.
    Invalid(Violation),
    /// Stored content cannot be served.
    Unreadable { id: ItemId, reason: Unreadable },
    /// An I/O or other failure of the backend.
    Internal(InternalError),
}

impl StoreError {
    pub(crate) fn internal(operation: Operation, id: Option<&ItemId>, cause: Cause) -> Self {
        Self::Internal(InternalError {
            operation,
            id: id.cloned(),
            cause,
        })
    }

    pub(crate) fn io(operation: Operation, id: Option<&ItemId>, error: &io::Error) -> Self {
        Self::internal(operation, id, Cause::Io(error.kind()))
    }
}

impl From<DomainError> for StoreError {
    fn from(error: DomainError) -> Self {
        match error {
            DomainError::NotFound => Self::NotFound,
            DomainError::Conflict(conflict) => Self::Conflict(conflict),
            DomainError::Invalid(violation) => Self::Invalid(violation),
        }
    }
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound => f.write_str("not found"),
            Self::Conflict(conflict) => write!(f, "conflict: {conflict:?}"),
            Self::Invalid(violation) => write!(f, "invalid: {violation:?}"),
            Self::Unreadable { id, reason } => write!(f, "document {id} is unreadable: {reason}"),
            Self::Internal(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for StoreError {}

/// Why stored content cannot be served.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Unreadable {
    TooLarge,
    NotUtf8,
    ContainsNul,
}

impl fmt::Display for Unreadable {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::TooLarge => "content exceeds 1 MiB",
            Self::NotUtf8 => "content is not UTF-8",
            Self::ContainsNul => "content contains U+0000",
        })
    }
}

/// The operation, item, and cause of an internal failure, for the log.
#[derive(Debug)]
pub struct InternalError {
    pub operation: Operation,
    pub id: Option<ItemId>,
    pub cause: Cause,
}

impl fmt::Display for InternalError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?} failed", self.operation)?;
        if let Some(id) = &self.id {
            write!(f, " for item {id}")?;
        }
        match &self.cause {
            Cause::Io(kind) => write!(f, ": I/O error: {kind}"),
            Cause::Task => f.write_str(": the storage task stopped unexpectedly"),
            Cause::Unstable => f.write_str(": the file kept changing while it was read"),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Operation {
    Workspace,
    Item,
    Content,
    Create,
    Rename,
    Place,
    ReplaceContent,
    Delete,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cause {
    /// A failed file system call, by error kind only.
    Io(io::ErrorKind),
    /// The blocking task panicked or was cancelled.
    Task,
    /// Another program kept writing a file while it was being read.
    Unstable,
}

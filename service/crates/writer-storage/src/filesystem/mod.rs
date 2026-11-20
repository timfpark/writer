//! The filesystem backend of ADR 0006: the workspace as directories and `.md`
//! files under `<data>/workspace/`, with one index in `.writer/`.

mod disk;
#[cfg(test)]
mod faults;
mod index;
mod names;
mod reconcile;
mod state;
#[cfg(test)]
mod tests;

use std::fmt;
use std::fs::{self, OpenOptions, TryLockError};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio::sync::{RwLock, Semaphore};
use writer_domain::{
    Document, DocumentContent, Item, ItemId, ItemKind, Markdown, NewItem, Placement, Revision,
    Title, WorkspaceItem,
};

use self::disk::Disk;
use self::index::LoadError;
use self::state::{Lookup, State};
use crate::{Cause, Created, Operation, StoreError, StoreFuture, WorkspaceStore};

/// Blocking tasks the backend runs at once.
const PERMITS: usize = 4;

/// The filesystem backend. Cloning shares one store; the data folder stays
/// locked until the last clone and its running tasks are gone.
#[derive(Clone)]
pub struct FilesystemStore {
    state: Arc<RwLock<State>>,
    permits: Arc<Semaphore>,
    data: Arc<PathBuf>,
}

/// Why a data folder cannot be opened. Each names the folder or file
/// involved, never a path inside the workspace.
#[derive(Debug)]
pub enum OpenError {
    /// The folder cannot be created, read, recovered, or written.
    Io { path: PathBuf, kind: io::ErrorKind },
    /// Another process owns the folder.
    Locked { path: PathBuf },
    /// The index was written by a newer Writer.
    NewerIndex { path: PathBuf, format: u64 },
    /// The index is not valid; it is left as it is.
    InvalidIndex { path: PathBuf },
    /// The blocking task that opens the store stopped unexpectedly.
    Task,
}

impl fmt::Display for OpenError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io { path, kind } => {
                write!(
                    f,
                    "cannot create, read, or recover the data folder {}: {kind}",
                    path.display()
                )
            }
            Self::Locked { path } => write!(
                f,
                "another Writer process is using the data folder {}",
                path.display()
            ),
            Self::NewerIndex { path, format } => write!(
                f,
                "{} has format {format}, which this version of Writer cannot read",
                path.display()
            ),
            Self::InvalidIndex { path } => write!(
                f,
                "{} is not a valid workspace index; move it aside to rebuild it",
                path.display()
            ),
            Self::Task => f.write_str("the task opening the data folder stopped unexpectedly"),
        }
    }
}

impl std::error::Error for OpenError {}

impl FilesystemStore {
    /// Opens the workspace in `data_dir`, creating the folder on first use,
    /// locking it for this process, settling any interrupted change, and
    /// reconciling the index with the directories.
    pub async fn open(data_dir: impl Into<PathBuf>) -> Result<Self, OpenError> {
        Self::open_disk(Disk::new(data_dir.into())).await
    }

    async fn open_disk(disk: Disk) -> Result<Self, OpenError> {
        let data = disk.data.clone();
        let state = tokio::task::spawn_blocking(move || open_blocking(disk))
            .await
            .map_err(|_| OpenError::Task)??;
        Ok(Self {
            state: Arc::new(RwLock::new(state)),
            permits: Arc::new(Semaphore::new(PERMITS)),
            data: Arc::new(data),
        })
    }

    #[cfg(test)]
    async fn open_with_faults(
        data_dir: &Path,
        faults: Arc<faults::Faults>,
    ) -> Result<Self, OpenError> {
        let mut disk = Disk::new(data_dir.to_owned());
        disk.faults = faults;
        Self::open_disk(disk).await
    }

    /// The data folder the store was opened in.
    pub fn data_dir(&self) -> &Path {
        &self.data
    }

    /// Runs `f` under the exclusive lock in one blocking task that owns the
    /// guard and a permit, so a dropped request cannot release the lock while
    /// its I/O runs.
    async fn exclusive<R: Send + 'static>(
        &self,
        operation: Operation,
        id: Option<&ItemId>,
        f: impl FnOnce(&mut State) -> Result<R, StoreError> + Send + 'static,
    ) -> Result<R, StoreError> {
        let mut guard = self.state.clone().write_owned().await;
        let permit = self.permits.clone().acquire_owned().await;
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            f(&mut guard)
        })
        .await
        .unwrap_or_else(|_| Err(StoreError::internal(operation, id, Cause::Task)))
    }

    async fn shared<R: Send + 'static>(
        &self,
        operation: Operation,
        id: Option<&ItemId>,
        f: impl FnOnce(&State) -> R + Send + 'static,
    ) -> Result<R, StoreError> {
        let guard = self.state.clone().read_owned().await;
        let permit = self.permits.clone().acquire_owned().await;
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            f(&guard)
        })
        .await
        .map_err(|_| StoreError::internal(operation, id, Cause::Task))
    }

    /// Answers a read under the shared lock, or, when the indexed entry is
    /// missing, reconciles under the exclusive lock and answers again; the
    /// shared lock cannot be upgraded in place.
    async fn read<R: Send + 'static>(
        &self,
        operation: Operation,
        id: &ItemId,
        f: impl Fn(&State, &ItemId) -> Lookup<R> + Clone + Send + 'static,
    ) -> Result<R, StoreError> {
        let first = {
            let (id, f) = (id.clone(), f.clone());
            self.shared(operation, Some(&id.clone()), move |state| f(state, &id))
                .await?
        };
        if let Lookup::Found(result) = first {
            return result;
        }
        let owned = id.clone();
        self.exclusive(operation, Some(id), move |state| {
            state.reconcile(operation)?;
            match f(state, &owned) {
                Lookup::Found(result) => result,
                Lookup::Stale => Err(StoreError::NotFound),
            }
        })
        .await
    }
}

fn open_blocking(disk: Disk) -> Result<State, OpenError> {
    let failed = |path: &Path| {
        let path = path.to_owned();
        move |error: io::Error| OpenError::Io {
            path,
            kind: error.kind(),
        }
    };
    for dir in [&disk.root, &disk.meta, &disk.tmp, &disk.trash] {
        fs::create_dir_all(dir).map_err(failed(&disk.data))?;
    }
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&disk.lock)
        .map_err(failed(&disk.lock))?;
    match lock.try_lock() {
        Ok(()) => {}
        Err(TryLockError::WouldBlock) => return Err(OpenError::Locked { path: disk.data }),
        Err(TryLockError::Error(error)) => return Err(failed(&disk.lock)(error)),
    }

    let (mut index, pending, mut dirty) = match index::load(&disk.index) {
        Ok(Some(loaded)) => (loaded.index, loaded.pending, loaded.trimmed),
        Ok(None) => (state::empty(), None, true),
        Err(LoadError::Io(error)) => return Err(failed(&disk.index)(error)),
        Err(LoadError::Newer(format)) => {
            return Err(OpenError::NewerIndex {
                path: disk.index,
                format,
            });
        }
        Err(LoadError::Invalid) => return Err(OpenError::InvalidIndex { path: disk.index }),
    };
    if let Some(pending) = pending {
        state::recover(&disk, &mut index, pending).map_err(failed(&disk.data))?;
        dirty = true;
    }
    disk::empty_dir(&disk.tmp).map_err(failed(&disk.data))?;
    disk::empty_dir(&disk.trash).map_err(failed(&disk.data))?;

    let mut state = State {
        disk,
        index,
        pending: None,
        _lock: lock,
    };
    let data = state.disk.data.clone();
    state
        .reconcile(Operation::Workspace)
        .map_err(|_| OpenError::Io {
            path: data.clone(),
            kind: io::ErrorKind::Other,
        })?;
    if dirty {
        index::save(&state.disk, &state.index, None).map_err(failed(&data))?;
    }
    Ok(state)
}

impl WorkspaceStore for FilesystemStore {
    fn workspace(&self) -> StoreFuture<'_, Vec<WorkspaceItem>> {
        Box::pin(self.exclusive(Operation::Workspace, None, State::workspace))
    }

    fn item(&self, id: ItemId, kind: ItemKind) -> StoreFuture<'_, Item> {
        Box::pin(async move {
            self.read(Operation::Item, &id, move |state, id| {
                state.item(id, kind, Operation::Item)
            })
            .await
        })
    }

    fn content(&self, id: ItemId) -> StoreFuture<'_, DocumentContent> {
        Box::pin(async move { self.read(Operation::Content, &id, State::content).await })
    }

    fn create(&self, item: NewItem) -> StoreFuture<'_, Created> {
        Box::pin(async move {
            let id = item.id().clone();
            self.exclusive(Operation::Create, Some(&id), move |state| {
                state.create(&item)
            })
            .await
        })
    }

    fn rename(&self, id: ItemId, kind: ItemKind, title: Title) -> StoreFuture<'_, Item> {
        Box::pin(async move {
            let owned = id.clone();
            self.exclusive(Operation::Rename, Some(&id), move |state| {
                state.rename(&owned, kind, title)
            })
            .await
        })
    }

    fn place(&self, id: ItemId, kind: ItemKind, to: Placement) -> StoreFuture<'_, Item> {
        Box::pin(async move {
            let owned = id.clone();
            self.exclusive(Operation::Place, Some(&id), move |state| {
                state.place(&owned, kind, &to)
            })
            .await
        })
    }

    fn replace_content(
        &self,
        id: ItemId,
        markdown: Markdown,
        base: Revision,
    ) -> StoreFuture<'_, Document> {
        Box::pin(async move {
            let owned = id.clone();
            self.exclusive(Operation::ReplaceContent, Some(&id), move |state| {
                state.replace_content(&owned, &markdown, &base)
            })
            .await
        })
    }

    fn delete(&self, id: ItemId, kind: ItemKind) -> StoreFuture<'_, ()> {
        Box::pin(async move {
            let owned = id.clone();
            self.exclusive(Operation::Delete, Some(&id), move |state| {
                state.delete(&owned, kind)
            })
            .await
        })
    }
}

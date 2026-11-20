//! The backend's operations. Each runs inside one blocking task that owns the
//! lock guard over [`State`].

use std::fs::{self, File};
use std::io;
use std::path::Path;

use tempfile::NamedTempFile;
use writer_domain::{
    Conflict, CreateCheck, Document, DocumentContent, Folder, Item, ItemId, ItemKind,
    MAX_CONTENT_BYTES, Markdown, NewItem, Node, Placement, Position, Revision, Title, Tree,
    WorkspaceItem,
};

use super::disk::{self, Disk, FileIdentity, ReadFailure, identity, new_id, sync_dir};
use super::index::{self, Index, Pending, Previous};
use super::reconcile;
use crate::{Cause, Created, Operation, StoreError, Unreadable, revision_of};

/// How many names a new document tries when other programs keep taking them.
const CREATE_ATTEMPTS: usize = 8;
/// How many times a save starts again after an edit made outside Writer.
const SAVE_ATTEMPTS: usize = 3;

pub(crate) struct State {
    pub disk: Disk,
    pub index: Index,
    /// A committed change whose record could not be cleared from the index;
    /// every write retries clearing it first.
    pub pending: Option<Pending>,
    /// Held for the life of the store, including blocking tasks that outlive
    /// a dropped request.
    pub _lock: File,
}

/// The outcome of a read under the shared lock: an answer, or a missing
/// entry that needs reconciling under the exclusive lock.
pub(crate) enum Lookup<T> {
    Found(Result<T, StoreError>),
    Stale,
}

fn io_error(operation: Operation, id: Option<&ItemId>) -> impl Fn(io::Error) -> StoreError + '_ {
    move |error| StoreError::io(operation, id, &error)
}

impl State {
    /// The item's path as names relative to the workspace root.
    fn relative(&self, id: &ItemId) -> Option<Vec<String>> {
        self.index
            .lineage(id)
            .map(|lineage| lineage.into_iter().map(|node| node.data.clone()).collect())
    }

    fn folder_relative(&self, parent_id: Option<&ItemId>) -> Option<Vec<String>> {
        parent_id.map_or(Some(Vec::new()), |id| self.relative(id))
    }

    fn save_index(&self) -> io::Result<()> {
        index::save(&self.disk, &self.index, self.pending.as_ref())
    }

    pub fn reconcile(&mut self, operation: Operation) -> Result<(), StoreError> {
        let counts = reconcile::reconcile(&self.disk.root, &mut self.index)
            .map_err(io_error(operation, None))?;
        if counts.changed() {
            tracing::info!(
                adopted = counts.adopted,
                removed = counts.removed,
                renamed = counts.renamed,
                skipped = counts.skipped,
                unlisted = counts.unlisted,
                "reconciled the workspace index with its folder"
            );
            self.save_index().map_err(io_error(operation, None))?;
        }
        Ok(())
    }

    /// Clears the record of a committed change before any further write, so
    /// no later change can make it look uncommitted.
    fn ensure_clear(&mut self, operation: Operation, id: &ItemId) -> Result<(), StoreError> {
        let Some(pending) = self.pending.take() else {
            return Ok(());
        };
        let result = sync_dir(disk::parent(&self.disk.abs(&pending.source)))
            .and_then(|()| sync_dir(disk::parent(&self.disk.abs(&pending.target))))
            .and_then(|()| self.save_index());
        result.map_err(|error| {
            self.pending = Some(pending);
            StoreError::io(operation, Some(id), &error)
        })
    }

    pub fn workspace(&mut self) -> Result<Vec<WorkspaceItem>, StoreError> {
        self.reconcile(Operation::Workspace)?;
        Ok(self.index.items())
    }

    fn read_document(&self, id: &ItemId) -> Option<Result<Vec<u8>, ReadFailure>> {
        let relative = self.relative(id)?;
        Some(disk::read_stable(&self.disk.abs(&relative)))
    }

    /// An item with a document's revision computed from bytes just read.
    pub fn item(&self, id: &ItemId, kind: ItemKind, operation: Operation) -> Lookup<Item> {
        let Ok(node) = self.index.find(id, kind) else {
            return Lookup::Stale;
        };
        let parent_id = self
            .index
            .position(id)
            .and_then(|position| position.parent_id);
        let title = node.title.clone();
        match kind {
            ItemKind::Folder => Lookup::Found(Ok(Item::Folder(Folder {
                id: id.clone(),
                parent_id,
                title,
            }))),
            ItemKind::Document => match self.read_document(id) {
                Some(Ok(bytes)) => Lookup::Found(Ok(Item::Document(Document {
                    id: id.clone(),
                    parent_id,
                    title,
                    revision: revision_of(&bytes),
                }))),
                None | Some(Err(ReadFailure::Missing)) => Lookup::Stale,
                Some(Err(failure)) => Lookup::Found(Err(read_error(operation, id, failure))),
            },
        }
    }

    fn item_now(
        &self,
        id: &ItemId,
        kind: ItemKind,
        operation: Operation,
    ) -> Result<Item, StoreError> {
        match self.item(id, kind, operation) {
            Lookup::Found(result) => result,
            Lookup::Stale => Err(StoreError::NotFound),
        }
    }

    pub fn content(&self, id: &ItemId) -> Lookup<DocumentContent> {
        if self.index.find(id, ItemKind::Document).is_err() {
            return Lookup::Stale;
        }
        match self.read_document(id) {
            Some(Ok(bytes)) => {
                let revision = revision_of(&bytes);
                Lookup::Found(
                    decode(bytes)
                        .map(|markdown| DocumentContent { markdown, revision })
                        .map_err(|reason| unreadable(id, reason)),
                )
            }
            None | Some(Err(ReadFailure::Missing)) => Lookup::Stale,
            Some(Err(failure)) => Lookup::Found(Err(read_error(Operation::Content, id, failure))),
        }
    }

    pub fn create(&mut self, item: &NewItem) -> Result<Created, StoreError> {
        const OP: Operation = Operation::Create;
        let id = item.id();
        self.ensure_clear(OP, id)?;
        self.reconcile(OP)?;
        let position = match self.index.check_create(item)? {
            CreateCheck::Exists => {
                return self.item_now(id, item.kind(), OP).map(Created::Existing);
            }
            CreateCheck::Insert(position) => position,
        };
        let parent = self
            .folder_relative(position.parent_id.as_ref())
            .ok_or(StoreError::NotFound)?;
        let dir = self.disk.abs(&parent);
        let fail = io_error(OP, Some(id));

        match item.kind() {
            ItemKind::Folder => {
                let temp_name = new_id().to_string();
                let temp_path = self.disk.tmp.join(&temp_name);
                self.disk
                    .step("create.prepare")
                    .and_then(|()| fs::create_dir(&temp_path))
                    .map_err(&fail)?;
                let source_identity = fs::symlink_metadata(&temp_path).map(|meta| identity(&meta));
                let committed = source_identity.and_then(|source_identity| {
                    let name =
                        disk::choose_name(&dir, item.title().as_str(), ItemKind::Folder, None)?;
                    let source = vec![
                        disk::META_DIR.to_owned(),
                        disk::TMP_DIR.to_owned(),
                        temp_name,
                    ];
                    self.insert_and_commit(
                        item,
                        &position,
                        &parent,
                        name,
                        source,
                        source_identity,
                        &mut |from, to| {
                            // `rename` would replace an empty directory; check
                            // under the lock immediately before.
                            if fs::symlink_metadata(to).is_ok() {
                                return Err(io::ErrorKind::AlreadyExists.into());
                            }
                            fs::rename(from, to)
                        },
                    )
                });
                if committed.is_err() {
                    let _ = fs::remove_dir(&temp_path);
                }
                committed.map_err(&fail)?;
            }
            ItemKind::Document => {
                let mut temp = Some(
                    disk::temp_file(&self.disk, item.markdown().as_str().as_bytes(), None)
                        .map_err(&fail)?,
                );
                let temp_path = temp
                    .as_ref()
                    .map(|file| file.path().to_owned())
                    .unwrap_or_default();
                let source_identity = temp
                    .as_ref()
                    .map(|file| file.as_file().metadata().map(|meta| identity(&meta)))
                    .transpose()
                    .map_err(&fail)?
                    .unwrap_or(FileIdentity {
                        device: 0,
                        inode: 0,
                    });
                let temp_name = temp_path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or_default()
                    .to_owned();
                let source = vec![
                    disk::META_DIR.to_owned(),
                    disk::TMP_DIR.to_owned(),
                    temp_name,
                ];
                let mut persist = |_: &Path, to: &Path| -> io::Result<()> {
                    let file: NamedTempFile = temp
                        .take()
                        .ok_or_else(|| io::Error::other("temporary file consumed"))?;
                    match file.persist_noclobber(to) {
                        Ok(_) => Ok(()),
                        Err(error) => {
                            temp = Some(error.file);
                            Err(error.error)
                        }
                    }
                };
                let mut attempt = 0;
                loop {
                    attempt += 1;
                    let name =
                        disk::choose_name(&dir, item.title().as_str(), ItemKind::Document, None)
                            .map_err(&fail)?;
                    match self.insert_and_commit(
                        item,
                        &position,
                        &parent,
                        name,
                        source.clone(),
                        source_identity,
                        &mut persist,
                    ) {
                        Ok(()) => break,
                        // Another program took the name at the last moment.
                        Err(error)
                            if error.kind() == io::ErrorKind::AlreadyExists
                                && attempt < CREATE_ATTEMPTS => {}
                        Err(error) => return Err(fail(error)),
                    }
                }
            }
        }
        self.item_now(id, item.kind(), OP).map(Created::New)
    }

    #[expect(clippy::too_many_arguments, reason = "one call per kind of item")]
    fn insert_and_commit(
        &mut self,
        item: &NewItem,
        position: &Position,
        parent: &[String],
        name: String,
        source: Vec<String>,
        source_identity: FileIdentity,
        rename: &mut dyn FnMut(&Path, &Path) -> io::Result<()>,
    ) -> io::Result<()> {
        let before = self.index.clone();
        let mut target = parent.to_vec();
        target.push(name.clone());
        let node = Node::new(item.id().clone(), item.kind(), item.title().clone(), name);
        if self.index.insert(position, node).is_err() {
            return Err(io::ErrorKind::NotFound.into());
        }
        let pending = Pending {
            operation: index::Operation::Create,
            id: item.id().to_string(),
            source,
            target,
            source_identity,
            previous: None,
        };
        self.commit(pending, before, rename)
    }

    /// Commits a structural change whose new shape is already in the index:
    /// records it, makes its one rename, and clears the record. Before the
    /// rename, a failure restores `before`; after it, the change stands.
    fn commit(
        &mut self,
        pending: Pending,
        before: Index,
        rename: &mut dyn FnMut(&Path, &Path) -> io::Result<()>,
    ) -> io::Result<()> {
        let source = self.disk.abs(&pending.source);
        let target = self.disk.abs(&pending.target);
        self.pending = Some(pending);
        let renamed = self
            .save_index()
            .and_then(|()| self.disk.step("commit.rename"))
            .and_then(|()| rename(&source, &target));
        if let Err(error) = renamed {
            self.index = before;
            self.pending = None;
            if let Err(rollback) = self.save_index() {
                // The record on disk rolls the change back when the store
                // next opens.
                tracing::warn!(error = %rollback.kind(), "cannot rewrite the workspace index after a failed change");
            }
            return Err(error);
        }

        let synced = self
            .disk
            .step("commit.sync")
            .and_then(|()| sync_dir(disk::parent(&source)))
            .and_then(|()| sync_dir(disk::parent(&target)));
        if let Err(error) = synced {
            tracing::error!(error = %error.kind(), "a committed change may not survive power loss");
            return Err(error);
        }
        let record = self.pending.take();
        if let Err(error) = self.save_index() {
            tracing::warn!(error = %error.kind(), "cannot clear a committed change from the workspace index");
            self.pending = record;
        }
        Ok(())
    }

    fn identity_of(
        &self,
        relative: &[String],
        operation: Operation,
        id: &ItemId,
    ) -> Result<FileIdentity, StoreError> {
        match fs::symlink_metadata(self.disk.abs(relative)) {
            Ok(meta) => Ok(identity(&meta)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Err(StoreError::NotFound),
            Err(error) => Err(StoreError::io(operation, Some(id), &error)),
        }
    }

    pub fn rename(
        &mut self,
        id: &ItemId,
        kind: ItemKind,
        title: Title,
    ) -> Result<Item, StoreError> {
        const OP: Operation = Operation::Rename;
        self.ensure_clear(OP, id)?;
        self.reconcile(OP)?;
        let node = self.index.find(id, kind)?;
        let previous_entry = index::entry(node);
        let current = node.data.clone();
        let position = self.index.position(id).ok_or(StoreError::NotFound)?;
        let source = self.relative(id).ok_or(StoreError::NotFound)?;
        let parent = &source[..source.len() - 1];
        let own = self.identity_of(&source, OP, id)?;
        let name = disk::choose_name(
            &self.disk.abs(parent),
            title.as_str(),
            kind,
            Some((&current, own)),
        )
        .map_err(io_error(OP, Some(id)))?;

        let before = self.index.clone();
        let Some(node) = self.index.get_mut(id) else {
            return Err(StoreError::NotFound);
        };
        node.title = title;
        if name == current {
            if let Err(error) = self.save_index() {
                self.index = before;
                return Err(StoreError::io(OP, Some(id), &error));
            }
        } else {
            node.data.clone_from(&name);
            let mut target = parent.to_vec();
            target.push(name);
            let pending = Pending {
                operation: index::Operation::Rename,
                id: id.to_string(),
                source,
                target,
                source_identity: own,
                previous: Some(Previous {
                    parent_id: position.parent_id.map(|parent| parent.to_string()),
                    position: position.index,
                    entry: previous_entry,
                }),
            };
            self.commit(pending, before, &mut |from, to| fs::rename(from, to))
                .map_err(io_error(OP, Some(id)))?;
        }
        self.item_now(id, kind, OP)
    }

    pub fn place(
        &mut self,
        id: &ItemId,
        kind: ItemKind,
        to: &Placement,
    ) -> Result<Item, StoreError> {
        const OP: Operation = Operation::Place;
        self.ensure_clear(OP, id)?;
        self.reconcile(OP)?;
        let check = self.index.check_place(id, kind, to)?;
        if check.is_unchanged() {
            return self.item_now(id, kind, OP);
        }
        let before = self.index.clone();
        if check.from.parent_id == check.to.parent_id {
            // Reordering changes only the index.
            self.index.relocate(id, &check.to);
            if let Err(error) = self.save_index() {
                self.index = before;
                return Err(StoreError::io(OP, Some(id), &error));
            }
            return self.item_now(id, kind, OP);
        }

        let node = self.index.find(id, kind)?;
        let previous_entry = index::entry(node);
        let title = node.title.clone();
        let source = self.relative(id).ok_or(StoreError::NotFound)?;
        let parent = self
            .folder_relative(check.to.parent_id.as_ref())
            .ok_or(StoreError::NotFound)?;
        let own = self.identity_of(&source, OP, id)?;
        let name = disk::choose_name(&self.disk.abs(&parent), title.as_str(), kind, None)
            .map_err(io_error(OP, Some(id)))?;

        self.index.relocate(id, &check.to);
        if let Some(node) = self.index.get_mut(id) {
            node.data.clone_from(&name);
        }
        let mut target = parent;
        target.push(name);
        let pending = Pending {
            operation: index::Operation::Move,
            id: id.to_string(),
            source,
            target,
            source_identity: own,
            previous: Some(Previous {
                parent_id: check.from.parent_id.map(|parent| parent.to_string()),
                position: check.from.index,
                entry: previous_entry,
            }),
        };
        self.commit(pending, before, &mut |from, to| fs::rename(from, to))
            .map_err(io_error(OP, Some(id)))?;
        self.item_now(id, kind, OP)
    }

    pub fn delete(&mut self, id: &ItemId, kind: ItemKind) -> Result<(), StoreError> {
        const OP: Operation = Operation::Delete;
        self.ensure_clear(OP, id)?;
        self.reconcile(OP)?;
        self.index.find(id, kind)?;
        let source = self.relative(id).ok_or(StoreError::NotFound)?;
        let own = self.identity_of(&source, OP, id)?;
        let before = self.index.clone();
        let Some((position, node)) = self.index.remove(id) else {
            return Err(StoreError::NotFound);
        };
        let target = vec![
            disk::META_DIR.to_owned(),
            disk::TRASH_DIR.to_owned(),
            new_id().to_string(),
        ];
        let trashed = self.disk.abs(&target);
        let pending = Pending {
            operation: index::Operation::Delete,
            id: id.to_string(),
            source,
            target,
            source_identity: own,
            previous: Some(Previous {
                parent_id: position.parent_id.map(|parent| parent.to_string()),
                position: position.index,
                entry: index::entry(&node),
            }),
        };
        self.commit(pending, before, &mut |from, to| fs::rename(from, to))
            .map_err(io_error(OP, Some(id)))?;
        if let Err(error) = self
            .disk
            .step("delete.purge")
            .and_then(|()| disk::remove_entry(&trashed))
        {
            // Emptied when the store next opens.
            tracing::warn!(%id, error = %error.kind(), "cannot remove a deleted item from the trash");
        }
        Ok(())
    }

    /// ADR 0005's compare-and-replace, checking the file again immediately
    /// before replacing it so an edit made outside Writer is not overwritten.
    pub fn replace_content(
        &mut self,
        id: &ItemId,
        markdown: &Markdown,
        base: &Revision,
    ) -> Result<Document, StoreError> {
        const OP: Operation = Operation::ReplaceContent;
        self.ensure_clear(OP, id)?;
        if self.index.find(id, ItemKind::Document).is_err() {
            self.reconcile(OP)?;
        }
        let node = self.index.find(id, ItemKind::Document)?;
        let title = node.title.clone();
        let parent_id = self
            .index
            .position(id)
            .and_then(|position| position.parent_id);
        let path = self
            .disk
            .abs(&self.relative(id).ok_or(StoreError::NotFound)?);
        let fail = io_error(OP, Some(id));

        for _ in 0..SAVE_ATTEMPTS {
            let stored = match disk::read_stable(&path) {
                Ok(bytes) => bytes,
                Err(ReadFailure::Missing) => {
                    self.reconcile(OP)?;
                    return Err(StoreError::NotFound);
                }
                Err(failure) => return Err(read_error(OP, id, failure)),
            };
            let current = revision_of(&stored);
            if stored == markdown.as_str().as_bytes() {
                return Ok(Document {
                    id: id.clone(),
                    parent_id,
                    title,
                    revision: current,
                });
            }
            if let Err(reason) = check_bytes(&stored) {
                return Err(unreadable(id, reason));
            }
            if &current != base {
                return Err(StoreError::Conflict(Conflict::StaleRevision));
            }
            let like = fs::metadata(&path).map_err(&fail)?;
            let temp = disk::temp_file(&self.disk, markdown.as_str().as_bytes(), Some(&like))
                .map_err(&fail)?;
            self.disk.step("save.recheck").map_err(&fail)?;
            match disk::read_stable(&path) {
                Ok(again) if again == stored => {}
                // A program outside Writer wrote the file; start again.
                Ok(_) => continue,
                Err(ReadFailure::Missing) => {
                    self.reconcile(OP)?;
                    return Err(StoreError::NotFound);
                }
                Err(failure) => return Err(read_error(OP, id, failure)),
            }
            self.disk.step("save.rename").map_err(&fail)?;
            temp.persist(&path).map_err(|error| fail(error.error))?;
            self.disk
                .step("save.sync")
                .and_then(|()| sync_dir(disk::parent(&path)))
                .map_err(&fail)?;
            return Ok(Document {
                id: id.clone(),
                parent_id,
                title,
                revision: revision_of(markdown.as_str().as_bytes()),
            });
        }
        Err(StoreError::Conflict(Conflict::StaleRevision))
    }
}

/// Settles a structural change recorded in the index when the store last
/// stopped: keeps it if its rename happened, and otherwise restores the
/// item's previous entry.
pub(crate) fn recover(disk: &Disk, index: &mut Index, pending: Pending) -> io::Result<()> {
    let id = ItemId::parse(&pending.id).map_err(|_| io::Error::from(io::ErrorKind::InvalidData))?;
    let source = disk.abs(&pending.source);
    let target = disk.abs(&pending.target);
    let committed = match (disk::present(&source)?, disk::present(&target)?) {
        (_, Some(found)) if found == pending.source_identity => Some(true),
        (None, Some(_)) => Some(true),
        (Some(_), _) => Some(false),
        (None, None) => None,
    };
    match committed {
        Some(true) => {
            sync_dir(disk::parent(&source))?;
            sync_dir(disk::parent(&target))?;
        }
        Some(false) => {
            index.remove(&id);
            if let Some(previous) = pending.previous {
                let node = index::node(previous.entry)
                    .map_err(|_| io::Error::from(io::ErrorKind::InvalidData))?;
                let position = Position {
                    parent_id: previous
                        .parent_id
                        .and_then(|parent| ItemId::parse(&parent).ok()),
                    index: previous.position,
                };
                if let Err(node) = index.insert(&position, node) {
                    let end = Position {
                        parent_id: None,
                        index: index.roots().len(),
                    };
                    let _ = index.insert(&end, node);
                }
            }
        }
        None => {
            index.remove(&id);
        }
    }
    let outcome = match committed {
        Some(true) => "kept",
        Some(false) => "rolled back",
        None => "dropped",
    };
    tracing::info!(%id, operation = ?pending.operation, outcome, "settled an interrupted change");
    Ok(())
}

fn check_bytes(bytes: &[u8]) -> Result<&str, Unreadable> {
    if bytes.len() > MAX_CONTENT_BYTES {
        return Err(Unreadable::TooLarge);
    }
    let text = std::str::from_utf8(bytes).map_err(|_| Unreadable::NotUtf8)?;
    if text.contains('\0') {
        return Err(Unreadable::ContainsNul);
    }
    Ok(text)
}

fn decode(bytes: Vec<u8>) -> Result<Markdown, Unreadable> {
    check_bytes(&bytes)?;
    let text = String::from_utf8(bytes).map_err(|_| Unreadable::NotUtf8)?;
    Markdown::parse(text).map_err(|_| Unreadable::TooLarge)
}

fn unreadable(id: &ItemId, reason: Unreadable) -> StoreError {
    tracing::warn!(%id, %reason, "stored content cannot be served");
    StoreError::Unreadable {
        id: id.clone(),
        reason,
    }
}

fn read_error(operation: Operation, id: &ItemId, failure: ReadFailure) -> StoreError {
    match failure {
        ReadFailure::Missing => StoreError::NotFound,
        ReadFailure::Unstable => StoreError::internal(operation, Some(id), Cause::Unstable),
        ReadFailure::Io(error) => StoreError::io(operation, Some(id), &error),
    }
}

/// An empty index for a store opened without one.
pub(crate) fn empty() -> Index {
    Tree::new()
}

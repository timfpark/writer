//! `.writer/workspace.json`: identifiers, exact titles, sibling order, names
//! on disk, and the record of a structural change in progress.

use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};
use writer_domain::{ItemId, ItemKind, MAX_DEPTH, MAX_ITEMS, Node, Title, Tree};

use super::disk::{self, Disk, FileIdentity};
use super::names;

/// The index format this backend writes.
pub(crate) const FORMAT: u64 = 1;

/// The in-memory index: each node's data is its name on disk.
pub(crate) type Index = Tree<String>;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexFile {
    format: u64,
    items: Vec<Entry>,
    pending: Option<Pending>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Entry {
    id: String,
    kind: Kind,
    title: String,
    name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    items: Option<Vec<Entry>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Kind {
    Folder,
    Document,
}

/// A structural change recorded before its one rename on disk.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Pending {
    pub operation: Operation,
    pub id: String,
    /// The rename's source and target, as names relative to the workspace.
    pub source: Vec<String>,
    pub target: Vec<String>,
    pub source_identity: FileIdentity,
    /// The item's entry before the change; `None` for a create.
    pub previous: Option<Previous>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Operation {
    Create,
    Rename,
    Move,
    Delete,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Previous {
    pub parent_id: Option<String>,
    pub position: usize,
    pub entry: Entry,
}

/// Why a stored index cannot be used. The service never overwrites it.
#[derive(Debug)]
pub(crate) enum LoadError {
    Io(io::Error),
    Newer(u64),
    Invalid,
}

/// An index read from disk; `trimmed` is set when entries beyond the limits
/// were left out.
pub(crate) struct Loaded {
    pub index: Index,
    pub pending: Option<Pending>,
    pub trimmed: bool,
}

pub(crate) fn load(path: &Path) -> Result<Option<Loaded>, LoadError> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(LoadError::Io(error)),
    };
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| LoadError::Invalid)?;
    match value.get("format").and_then(serde_json::Value::as_u64) {
        Some(FORMAT) => {}
        Some(format) if format > FORMAT => return Err(LoadError::Newer(format)),
        _ => return Err(LoadError::Invalid),
    }
    let file: IndexFile = serde_json::from_value(value).map_err(|_| LoadError::Invalid)?;
    if let Some(pending) = &file.pending {
        validate_pending(pending)?;
    }
    let mut seen = HashSet::new();
    let mut budget = MAX_ITEMS;
    let mut trimmed = false;
    let roots = nodes(file.items, 1, &mut seen, &mut budget, &mut trimmed)?;
    Ok(Some(Loaded {
        index: Tree::from_roots(roots),
        pending: file.pending,
        trimmed,
    }))
}

pub(crate) fn save(disk: &Disk, index: &Index, pending: Option<&Pending>) -> io::Result<()> {
    let file = IndexFile {
        format: FORMAT,
        items: entries(index.roots()),
        pending: pending.cloned(),
    };
    let mut bytes = serde_json::to_vec_pretty(&file).map_err(io::Error::other)?;
    bytes.push(b'\n');
    disk::write_atomic(disk, &disk.index, &bytes)
}

pub(crate) fn entry(node: &Node<String>) -> Entry {
    Entry {
        id: node.id.to_string(),
        kind: match node.kind {
            ItemKind::Folder => Kind::Folder,
            ItemKind::Document => Kind::Document,
        },
        title: node.title.as_str().to_owned(),
        name: node.data.clone(),
        items: (node.kind == ItemKind::Folder).then(|| entries(&node.children)),
    }
}

fn entries(nodes: &[Node<String>]) -> Vec<Entry> {
    nodes.iter().map(entry).collect()
}

/// The node an entry recorded, as a pending record stores it.
pub(crate) fn node(entry: Entry) -> Result<Node<String>, LoadError> {
    let mut seen = HashSet::new();
    let mut budget = MAX_ITEMS;
    let mut trimmed = false;
    nodes(vec![entry], 1, &mut seen, &mut budget, &mut trimmed)?
        .pop()
        .ok_or(LoadError::Invalid)
}

/// Converts entries, rejecting anything Writer would never write, and leaving
/// out entries deeper than the depth limit or beyond the item limit.
fn nodes(
    entries: Vec<Entry>,
    depth: usize,
    seen: &mut HashSet<ItemId>,
    budget: &mut usize,
    trimmed: &mut bool,
) -> Result<Vec<Node<String>>, LoadError> {
    let mut converted = Vec::with_capacity(entries.len());
    for entry in entries {
        let id = ItemId::parse(&entry.id).map_err(|_| LoadError::Invalid)?;
        let title = Title::parse(entry.title).map_err(|_| LoadError::Invalid)?;
        let kind = match entry.kind {
            Kind::Folder => ItemKind::Folder,
            Kind::Document => ItemKind::Document,
        };
        let valid_name = valid_component(&entry.name)
            && !entry.name.starts_with('.')
            && (kind == ItemKind::Folder || names::is_markdown(&entry.name));
        let valid_items = (kind == ItemKind::Folder) == entry.items.is_some();
        if !valid_name || !valid_items || !seen.insert(id.clone()) {
            return Err(LoadError::Invalid);
        }
        if depth > MAX_DEPTH || *budget == 0 {
            *trimmed = true;
            continue;
        }
        *budget -= 1;
        let mut node = Node::new(id, kind, title, entry.name);
        node.children = nodes(
            entry.items.unwrap_or_default(),
            depth + 1,
            seen,
            budget,
            trimmed,
        )?;
        converted.push(node);
    }
    Ok(converted)
}

/// A single path component that names an entry inside its directory.
fn valid_component(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\\', '\0'])
}

fn validate_pending(pending: &Pending) -> Result<(), LoadError> {
    let valid_path =
        |path: &[String]| !path.is_empty() && path.iter().all(|name| valid_component(name));
    let valid = ItemId::parse(&pending.id).is_ok()
        && valid_path(&pending.source)
        && valid_path(&pending.target)
        && pending.previous.as_ref().is_none_or(|previous| {
            previous
                .parent_id
                .as_deref()
                .is_none_or(|parent| ItemId::parse(parent).is_ok())
                && node(previous.entry.clone()).is_ok()
        });
    if valid {
        Ok(())
    } else {
        Err(LoadError::Invalid)
    }
}

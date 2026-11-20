//! Reconciles the index with the directories, so edits made outside Writer
//! reach the next tree read or structural change.

use std::collections::HashMap;
use std::io;
use std::path::Path;

use unicode_normalization::UnicodeNormalization;
use writer_domain::{ItemKind, MAX_DEPTH, MAX_ITEMS, Node, Tree};

use super::disk::{self, new_id};
use super::index::Index;
use super::names;

/// What reconciliation changed, counted without names.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Counts {
    /// Entries added outside Writer that became items.
    pub adopted: usize,
    /// Items whose entries were removed outside Writer.
    pub removed: usize,
    /// Items whose recorded name differed only in normalization.
    pub renamed: usize,
    /// Entries that are never items: hidden, linked, not UTF-8, or not `.md`.
    pub skipped: usize,
    /// Entries beyond the depth or item limit, left untouched and unlisted.
    pub unlisted: usize,
}

impl Counts {
    pub fn changed(&self) -> bool {
        self.adopted + self.removed + self.renamed > 0
    }
}

/// Walks the workspace depth first, reading only metadata, and updates the
/// index to match it. The index is unchanged if the walk fails.
pub(crate) fn reconcile(root: &Path, index: &mut Index) -> io::Result<Counts> {
    let mut counts = Counts::default();
    let mut budget = MAX_ITEMS.saturating_sub(index.len());
    let roots = walk(root, index.roots().to_vec(), 1, &mut budget, &mut counts)?;
    if counts.changed() {
        *index = Tree::from_roots(roots);
    }
    Ok(counts)
}

/// Reconciles one directory whose items are at `depth`.
fn walk(
    dir: &Path,
    entries: Vec<Node<String>>,
    depth: usize,
    budget: &mut usize,
    counts: &mut Counts,
) -> io::Result<Vec<Node<String>>> {
    if depth > MAX_DEPTH && entries.is_empty() {
        return Ok(entries);
    }
    let listing = match disk::list(dir) {
        Ok(listing) => listing,
        // The folder went away during the walk; the next walk drops it.
        Err(error) if error.kind() == io::ErrorKind::NotFound && depth > 1 => {
            counts.removed += entries.iter().map(Node::count).sum::<usize>();
            return Ok(Vec::new());
        }
        Err(error) => return Err(error),
    };
    counts.skipped += listing.skipped;
    let listed = listing.entries;
    let mut used = vec![false; listed.len()];
    let mut pairs: Vec<Option<usize>> = vec![None; entries.len()];

    for (i, entry) in entries.iter().enumerate() {
        let exact = (0..listed.len())
            .find(|&j| !used[j] && listed[j].0 == entry.data && listed[j].1 == entry.kind);
        if let Some(j) = exact {
            pairs[i] = Some(j);
            used[j] = true;
        }
    }

    // Some file systems return names decomposed; pair a remaining entry with
    // a remaining name of the same NFC form only when each side has one.
    let nfc = |name: &str| name.nfc().collect::<String>();
    let mut index_forms: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, entry) in entries
        .iter()
        .enumerate()
        .filter(|(i, _)| pairs[*i].is_none())
    {
        index_forms.entry(nfc(&entry.data)).or_default().push(i);
    }
    let mut listed_forms: HashMap<String, Vec<usize>> = HashMap::new();
    for (j, (name, _)) in listed.iter().enumerate().filter(|(j, _)| !used[*j]) {
        listed_forms.entry(nfc(name)).or_default().push(j);
    }
    for (form, indices) in &index_forms {
        if let ([i], Some([j])) = (
            indices.as_slice(),
            listed_forms.get(form).map(Vec::as_slice),
        ) && listed[*j].1 == entries[*i].kind
        {
            pairs[*i] = Some(*j);
            used[*j] = true;
        }
    }

    let mut nodes = Vec::with_capacity(listed.len());
    for (mut node, pair) in entries.into_iter().zip(pairs) {
        let Some(j) = pair else {
            counts.removed += node.count();
            continue;
        };
        if node.data != listed[j].0 {
            node.data.clone_from(&listed[j].0);
            counts.renamed += 1;
        }
        if node.kind == ItemKind::Folder {
            let children = std::mem::take(&mut node.children);
            node.children = walk(&dir.join(&node.data), children, depth + 1, budget, counts)?;
        }
        nodes.push(node);
    }

    let mut fresh: Vec<&(String, ItemKind)> = listed
        .iter()
        .zip(&used)
        .filter(|(_, used)| !**used)
        .map(|(entry, _)| entry)
        .collect();
    fresh.sort_by(|a, b| a.0.cmp(&b.0));
    for (name, kind) in fresh {
        if depth > MAX_DEPTH || *budget == 0 {
            counts.unlisted += 1;
            continue;
        }
        *budget -= 1;
        counts.adopted += 1;
        let mut node = Node::new(
            new_id(),
            *kind,
            names::title_from_name(name, *kind),
            name.clone(),
        );
        if *kind == ItemKind::Folder {
            node.children = walk(&dir.join(name), Vec::new(), depth + 1, budget, counts)?;
        }
        nodes.push(node);
    }
    Ok(nodes)
}

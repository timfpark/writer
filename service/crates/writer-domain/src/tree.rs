use crate::{
    Conflict, DomainError, ItemId, ItemKind, MAX_DEPTH, MAX_ITEMS, NewItem, Placement, Title,
    Violation, WorkspaceItem,
};

/// An item in a [`Tree`], carrying backend data `T` such as its name on disk.
/// A document's `children` is always empty.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Node<T> {
    pub id: ItemId,
    pub kind: ItemKind,
    pub title: Title,
    pub data: T,
    pub children: Vec<Node<T>>,
}

impl<T> Node<T> {
    pub fn new(id: ItemId, kind: ItemKind, title: Title, data: T) -> Self {
        Self {
            id,
            kind,
            title,
            data,
            children: Vec::new(),
        }
    }

    /// The node and its descendants.
    pub fn count(&self) -> usize {
        1 + self.children.iter().map(Node::count).sum::<usize>()
    }

    /// Levels in the subtree rooted here, 1 for a node without children.
    pub fn height(&self) -> usize {
        1 + self.children.iter().map(Node::height).max().unwrap_or(0)
    }

    fn contains(&self, id: &ItemId) -> bool {
        self.children
            .iter()
            .any(|child| &child.id == id || child.contains(id))
    }
}

/// A slot among a parent's children: `index` counts the siblings before it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Position {
    pub parent_id: Option<ItemId>,
    pub index: usize,
}

/// The outcome of validating a create.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CreateCheck {
    /// An item of the same kind already has the identifier; nothing changes.
    Exists,
    /// The item goes at this position.
    Insert(Position),
}

/// A validated move: `to.index` applies after the item leaves `from`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlaceCheck {
    pub from: Position,
    pub to: Position,
}

impl PlaceCheck {
    /// Whether the item stays exactly where it is.
    pub fn is_unchanged(&self) -> bool {
        self.from == self.to
    }
}

/// The workspace: top-level items, each parent's children in their one
/// manual order.
///
/// [`Tree::check_create`] and [`Tree::check_place`] apply ADR 0005's rules;
/// the other methods change the tree without checking them, for backends
/// that apply a validated change or load a stored tree.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tree<T> {
    roots: Vec<Node<T>>,
}

impl<T> Default for Tree<T> {
    fn default() -> Self {
        Self { roots: Vec::new() }
    }
}

impl<T> Tree<T> {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_roots(roots: Vec<Node<T>>) -> Self {
        Self { roots }
    }

    pub fn roots(&self) -> &[Node<T>] {
        &self.roots
    }

    pub fn into_roots(self) -> Vec<Node<T>> {
        self.roots
    }

    /// Every item in the tree.
    pub fn len(&self) -> usize {
        self.roots.iter().map(Node::count).sum()
    }

    pub fn is_empty(&self) -> bool {
        self.roots.is_empty()
    }

    fn index_path(&self, id: &ItemId) -> Option<Vec<usize>> {
        fn search<T>(nodes: &[Node<T>], id: &ItemId, path: &mut Vec<usize>) -> bool {
            for (index, node) in nodes.iter().enumerate() {
                path.push(index);
                if &node.id == id || search(&node.children, id, path) {
                    return true;
                }
                path.pop();
            }
            false
        }
        let mut path = Vec::new();
        search(&self.roots, id, &mut path).then_some(path)
    }

    /// The item and its ancestors, from the top level down to the item.
    pub fn lineage(&self, id: &ItemId) -> Option<Vec<&Node<T>>> {
        let path = self.index_path(id)?;
        let mut nodes = &self.roots;
        let mut lineage = Vec::with_capacity(path.len());
        for index in path {
            let node = &nodes[index];
            lineage.push(node);
            nodes = &node.children;
        }
        Some(lineage)
    }

    pub fn get(&self, id: &ItemId) -> Option<&Node<T>> {
        self.lineage(id)?.pop()
    }

    pub fn get_mut(&mut self, id: &ItemId) -> Option<&mut Node<T>> {
        let path = self.index_path(id)?;
        let (last, ancestors) = path.split_last()?;
        let mut nodes = &mut self.roots;
        for &index in ancestors {
            nodes = &mut nodes[index].children;
        }
        nodes.get_mut(*last)
    }

    /// The item with the identifier and kind, or [`DomainError::NotFound`].
    pub fn find(&self, id: &ItemId, kind: ItemKind) -> Result<&Node<T>, DomainError> {
        self.get(id)
            .filter(|node| node.kind == kind)
            .ok_or(DomainError::NotFound)
    }

    pub fn position(&self, id: &ItemId) -> Option<Position> {
        let path = self.index_path(id)?;
        let (&index, ancestors) = path.split_last()?;
        let mut nodes = &self.roots;
        let mut parent_id = None;
        for &step in ancestors {
            parent_id = Some(nodes[step].id.clone());
            nodes = &nodes[step].children;
        }
        Some(Position { parent_id, index })
    }

    /// The children of a folder, or the top-level items for `None`; `None`
    /// when the identifier names no folder.
    pub fn children(&self, parent_id: Option<&ItemId>) -> Option<&[Node<T>]> {
        match parent_id {
            None => Some(&self.roots),
            Some(id) => self
                .get(id)
                .filter(|node| node.kind == ItemKind::Folder)
                .map(|node| node.children.as_slice()),
        }
    }

    fn children_mut(&mut self, parent_id: Option<&ItemId>) -> Option<&mut Vec<Node<T>>> {
        match parent_id {
            None => Some(&mut self.roots),
            Some(id) => self
                .get_mut(id)
                .filter(|node| node.kind == ItemKind::Folder)
                .map(|node| &mut node.children),
        }
    }

    /// The depth an item placed in `parent_id` would have.
    fn depth_in(&self, parent_id: Option<&ItemId>) -> usize {
        parent_id
            .and_then(|id| self.lineage(id))
            .map_or(0, |lineage| lineage.len())
            + 1
    }

    /// Resolves a placement to a position, skipping `moving` among the
    /// siblings, since it leaves its slot before it is placed.
    fn resolve(
        &self,
        placement: &Placement,
        moving: Option<&ItemId>,
    ) -> Result<Position, DomainError> {
        let siblings = self
            .children(placement.parent_id.as_ref())
            .ok_or(Conflict::MissingParent)?;
        let mut remaining = siblings.iter().filter(|node| Some(&node.id) != moving);
        let index = match &placement.before_id {
            None => remaining.count(),
            Some(before) => remaining
                .position(|node| &node.id == before)
                .ok_or(Conflict::MissingSibling)?,
        };
        Ok(Position {
            parent_id: placement.parent_id.clone(),
            index,
        })
    }

    /// Validates creating `item`: a repeated create of the same kind changes
    /// nothing, and otherwise the placement, depth, and item limit apply.
    pub fn check_create(&self, item: &NewItem) -> Result<CreateCheck, DomainError> {
        if let Some(existing) = self.get(item.id()) {
            return if existing.kind == item.kind() {
                Ok(CreateCheck::Exists)
            } else {
                Err(Conflict::OtherKind.into())
            };
        }
        let position = self.resolve(item.placement(), None)?;
        if self.depth_in(position.parent_id.as_ref()) > MAX_DEPTH {
            return Err(Violation::DepthLimit.into());
        }
        if self.len() >= MAX_ITEMS {
            return Err(Violation::ItemLimit.into());
        }
        Ok(CreateCheck::Insert(position))
    }

    /// Validates moving or reordering an item. A move within its parent
    /// before itself leaves it where it is.
    pub fn check_place(
        &self,
        id: &ItemId,
        kind: ItemKind,
        placement: &Placement,
    ) -> Result<PlaceCheck, DomainError> {
        let node = self.find(id, kind)?;
        let from = self.position(id).ok_or(DomainError::NotFound)?;
        if let Some(parent_id) = &placement.parent_id {
            if self.children(Some(parent_id)).is_none() {
                return Err(Conflict::MissingParent.into());
            }
            if parent_id == id || node.contains(parent_id) {
                return Err(Conflict::Cycle.into());
            }
        }
        if placement.before_id.as_ref() == Some(id) {
            return if placement.parent_id == from.parent_id {
                Ok(PlaceCheck {
                    to: from.clone(),
                    from,
                })
            } else {
                Err(Conflict::MissingSibling.into())
            };
        }
        let to = self.resolve(placement, Some(id))?;
        if self.depth_in(to.parent_id.as_ref()) + node.height() - 1 > MAX_DEPTH {
            return Err(Violation::DepthLimit.into());
        }
        Ok(PlaceCheck { from, to })
    }

    /// Inserts a node at a position, clamping the index to the end. Returns
    /// the node when the position's parent is not a folder in the tree.
    pub fn insert(&mut self, at: &Position, node: Node<T>) -> Result<(), Node<T>> {
        match self.children_mut(at.parent_id.as_ref()) {
            Some(children) => {
                children.insert(at.index.min(children.len()), node);
                Ok(())
            }
            None => Err(node),
        }
    }

    /// Removes an item with its subtree, returning where it was.
    pub fn remove(&mut self, id: &ItemId) -> Option<(Position, Node<T>)> {
        let position = self.position(id)?;
        let siblings = self.children_mut(position.parent_id.as_ref())?;
        let node = siblings.remove(position.index);
        Some((position, node))
    }

    /// Moves an item to a position from [`Tree::check_place`].
    pub fn relocate(&mut self, id: &ItemId, to: &Position) -> bool {
        match self.remove(id) {
            Some((from, node)) => match self.insert(to, node) {
                Ok(()) => true,
                Err(node) => {
                    let _ = self.insert(&from, node);
                    false
                }
            },
            None => false,
        }
    }

    /// Every item in pre-order: each folder before its subtree, siblings in
    /// their order.
    pub fn items(&self) -> Vec<WorkspaceItem> {
        fn walk<T>(nodes: &[Node<T>], parent_id: Option<&ItemId>, items: &mut Vec<WorkspaceItem>) {
            for node in nodes {
                items.push(WorkspaceItem {
                    id: node.id.clone(),
                    kind: node.kind,
                    parent_id: parent_id.cloned(),
                    title: node.title.clone(),
                });
                walk(&node.children, Some(&node.id), items);
            }
        }
        let mut items = Vec::with_capacity(self.len());
        walk(&self.roots, None, &mut items);
        items
    }
}

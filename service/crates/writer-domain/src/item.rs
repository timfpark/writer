use crate::{ItemId, Markdown, Revision, Title};

/// Whether an item is a folder, which contains items, or a document, which
/// holds content.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ItemKind {
    Folder,
    Document,
}

/// One entry of the workspace tree as `GET /api/v1/workspace` lists it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorkspaceItem {
    pub id: ItemId,
    pub kind: ItemKind,
    pub parent_id: Option<ItemId>,
    pub title: Title,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Folder {
    pub id: ItemId,
    pub parent_id: Option<ItemId>,
    pub title: Title,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Document {
    pub id: ItemId,
    pub parent_id: Option<ItemId>,
    pub title: Title,
    pub revision: Revision,
}

/// A folder or a document, with a document's current revision.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Item {
    Folder(Folder),
    Document(Document),
}

impl Item {
    pub fn id(&self) -> &ItemId {
        match self {
            Self::Folder(folder) => &folder.id,
            Self::Document(document) => &document.id,
        }
    }

    pub fn kind(&self) -> ItemKind {
        match self {
            Self::Folder(_) => ItemKind::Folder,
            Self::Document(_) => ItemKind::Document,
        }
    }

    pub fn parent_id(&self) -> Option<&ItemId> {
        match self {
            Self::Folder(folder) => folder.parent_id.as_ref(),
            Self::Document(document) => document.parent_id.as_ref(),
        }
    }

    pub fn title(&self) -> &Title {
        match self {
            Self::Folder(folder) => &folder.title,
            Self::Document(document) => &document.title,
        }
    }

    /// The revision of a document, or `None` for a folder.
    pub fn revision(&self) -> Option<&Revision> {
        match self {
            Self::Folder(_) => None,
            Self::Document(document) => Some(&document.revision),
        }
    }
}

/// A document's content with its revision.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DocumentContent {
    pub markdown: Markdown,
    pub revision: Revision,
}

/// Where to place an item: in `parent_id`, or at the top level when `None`,
/// before `before_id`, or at the end when `None`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Placement {
    pub parent_id: Option<ItemId>,
    pub before_id: Option<ItemId>,
}

/// A folder or document to create with its client-generated identifier.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NewItem {
    id: ItemId,
    kind: ItemKind,
    title: Title,
    placement: Placement,
    markdown: Markdown,
}

impl NewItem {
    pub fn folder(id: ItemId, title: Title, placement: Placement) -> Self {
        Self {
            id,
            kind: ItemKind::Folder,
            title,
            placement,
            markdown: Markdown::default(),
        }
    }

    pub fn document(id: ItemId, title: Title, placement: Placement, markdown: Markdown) -> Self {
        Self {
            id,
            kind: ItemKind::Document,
            title,
            placement,
            markdown,
        }
    }

    pub fn id(&self) -> &ItemId {
        &self.id
    }

    pub fn kind(&self) -> ItemKind {
        self.kind
    }

    pub fn title(&self) -> &Title {
        &self.title
    }

    pub fn placement(&self) -> &Placement {
        &self.placement
    }

    /// A new document's initial content; always empty for a folder.
    pub fn markdown(&self) -> &Markdown {
        &self.markdown
    }
}

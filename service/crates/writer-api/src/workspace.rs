//! Reading the workspace tree, and the transport types and request parsing
//! that the folder and document operations share.

use std::sync::Arc;

use axum::extract::State;
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Deserializer, Serialize};
use utoipa::ToSchema;
use writer_domain::{self as domain, Conflict, Item, ItemId, Placement, Title};
use writer_storage::{Created, StoreError, WorkspaceStore};

use crate::extract::Json;
use crate::problem::Problem;

/// The storage every workspace handler reaches through router state.
pub type Store = Arc<dyn WorkspaceStore>;

/// The whole workspace tree.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    /// Every item in pre-order: each folder is followed by its subtree before
    /// its next sibling, and siblings appear in their order.
    pub items: Vec<WorkspaceItem>,
}

/// One folder or document in the tree, without content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceItem {
    pub id: String,
    pub kind: ItemKind,
    /// The containing folder, or `null` at the top level.
    #[schema(required = true)]
    pub parent_id: Option<String>,
    pub title: String,
    /// The document's BCP 47 language tag (`en` or `es`), or `null` for a
    /// folder.
    #[schema(required = true)]
    pub language: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum ItemKind {
    Folder,
    Document,
}

impl From<domain::ItemKind> for ItemKind {
    fn from(kind: domain::ItemKind) -> Self {
        match kind {
            domain::ItemKind::Folder => Self::Folder,
            domain::ItemKind::Document => Self::Document,
        }
    }
}

impl From<ItemKind> for domain::ItemKind {
    fn from(kind: ItemKind) -> Self {
        match kind {
            ItemKind::Folder => Self::Folder,
            ItemKind::Document => Self::Document,
        }
    }
}

impl From<domain::WorkspaceItem> for WorkspaceItem {
    fn from(item: domain::WorkspaceItem) -> Self {
        Self {
            id: item.id.to_string(),
            kind: item.kind.into(),
            parent_id: item.parent_id.map(|id| id.to_string()),
            title: item.title.into_string(),
            language: item.language.map(|language| language.as_str().to_owned()),
        }
    }
}

/// A new title for a folder or document.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReplaceTitleRequest {
    /// 1 to 200 characters with no surrounding whitespace or control
    /// characters.
    pub title: String,
}

/// Where to move a folder or document with its subtree.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReplacePositionRequest {
    /// The folder to place the item in, or `null` for the top level.
    #[serde(deserialize_with = "required_nullable")]
    #[schema(required = true)]
    pub parent_id: Option<String>,
    /// The sibling to place the item before, or `null` for the end.
    #[serde(deserialize_with = "required_nullable")]
    #[schema(required = true)]
    pub before_id: Option<String>,
}

/// Reads a field whose `null` carries meaning. serde treats an omitted
/// `Option` as `None` unless the field has its own deserializer, so this
/// makes omission an error.
pub(crate) fn required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::deserialize(deserializer)
}

/// The identifier in a request path. One that is not a UUID names no item,
/// so it is not found, as ADR 0005 requires.
pub(crate) fn path_id(value: &str) -> Result<ItemId, Problem> {
    ItemId::parse(value).map_err(|_| StoreError::NotFound.into())
}

/// The placement a request names, or `None` when `parentId` or `beforeId` is
/// not a UUID and so names no item in the workspace.
pub(crate) fn placement(parent_id: Option<String>, before_id: Option<String>) -> Option<Placement> {
    let parse = |id: Option<String>| id.map(|id| ItemId::parse(&id)).transpose().ok();
    Some(Placement {
        parent_id: parse(parent_id)?,
        before_id: parse(before_id)?,
    })
}

/// The item a create names when its `parentId` or `beforeId` names no item:
/// an existing item of the same kind, as a replay returns, or a conflict.
pub(crate) async fn replayed(store: &Store, id: ItemId, kind: ItemKind) -> Result<Item, Problem> {
    match store.item(id, kind.into()).await {
        Ok(item) => Ok(item),
        Err(StoreError::NotFound) => Err(StoreError::Conflict(Conflict::MissingParent).into()),
        Err(error) => Err(error.into()),
    }
}

/// 201 with `Location` for a new item, or 200 for one that already existed.
pub(crate) fn created_response<T: Serialize>(
    created: &Created,
    location: String,
    body: T,
) -> Response {
    if created.is_new() {
        (
            StatusCode::CREATED,
            [(header::LOCATION, location)],
            Json(body),
        )
            .into_response()
    } else {
        Json(body).into_response()
    }
}

pub(crate) async fn rename(
    store: &Store,
    id: &str,
    kind: ItemKind,
    body: ReplaceTitleRequest,
) -> Result<Item, Problem> {
    let id = path_id(id)?;
    let title = Title::parse(body.title).map_err(|violation| Problem::violations([violation]))?;
    Ok(store.rename(id, kind.into(), title).await?)
}

pub(crate) async fn place(
    store: &Store,
    id: &str,
    kind: ItemKind,
    body: ReplacePositionRequest,
) -> Result<Item, Problem> {
    let id = path_id(id)?;
    match placement(body.parent_id, body.before_id) {
        Some(to) => Ok(store.place(id, kind.into(), to).await?),
        None => {
            store.item(id, kind.into()).await?;
            Err(StoreError::Conflict(Conflict::MissingParent).into())
        }
    }
}

pub(crate) async fn delete(store: &Store, id: &str, kind: ItemKind) -> Result<StatusCode, Problem> {
    store.delete(path_id(id)?, kind.into()).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Read the whole workspace tree.
#[utoipa::path(
    get,
    path = "/workspace",
    operation_id = "getWorkspace",
    tag = "workspace",
    responses(
        (status = 200, description = "Every folder and document, in pre-order.", body = Workspace),
        (
            status = 500,
            description = "The service failed unexpectedly.",
            body = Problem,
            content_type = "application/problem+json"
        ),
    )
)]
pub(crate) async fn get_workspace(State(store): State<Store>) -> Result<Json<Workspace>, Problem> {
    let items = store.workspace().await?;
    Ok(Json(Workspace {
        items: items.into_iter().map(WorkspaceItem::from).collect(),
    }))
}

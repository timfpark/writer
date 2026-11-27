//! HTTP routes, transport types, problem responses, and the OpenAPI contract
//! for the Writer service.
//!
//! The served router and the contract come from one `OpenApiRouter`
//! registration, so every served route is documented.

mod documents;
mod extract;
mod folders;
mod health;
mod pair_writer;
mod problem;
mod workspace;

use std::any::Any;
use std::sync::Arc;

use axum::Router;
use axum::extract::{DefaultBodyLimit, FromRef};
use axum::response::{IntoResponse, Response};
use tower_http::catch_panic::CatchPanicLayer;
use utoipa::OpenApi;
use utoipa_axum::router::{OpenApiRouter, UtoipaMethodRouterExt};
use utoipa_axum::routes;
use writer_agent::UnconfiguredProvider;

pub use documents::{Document, DocumentContent};
pub use folders::Folder;
pub use health::{Health, HealthStatus};
pub use pair_writer::{
    Agent, ChatContextDocument, ChatDocumentInput, ChatHistoryMessage, ChatHistoryRole,
    ChatReadSource, ChatReplyDelta, ChatReplyDone, ChatReplyMetrics, ChatSelectionInput,
    ChatSourceKind, CreatePairWriterReplyRequest, PairWriterIssue, PairWriterStatus, ReadingScope,
};
pub use problem::{Problem, ProblemCode, ProblemFieldError};
pub use workspace::{ItemKind, Store, Workspace, WorkspaceItem};

/// The request body limit of operations that carry document content: 1 MiB
/// of content escaped at up to six bytes per character, plus the other
/// fields, as ADR 0005 sets. Other operations keep axum's 2 MiB default.
const CONTENT_BODY_LIMIT: usize = 8 * 1024 * 1024;

#[derive(Clone)]
struct AppState {
    store: Store,
    agent: Agent,
}

impl FromRef<AppState> for Store {
    fn from_ref(state: &AppState) -> Self {
        Arc::clone(&state.store)
    }
}

impl FromRef<AppState> for Agent {
    fn from_ref(state: &AppState) -> Self {
        Arc::clone(&state.agent)
    }
}

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Writer API",
        description = "HTTP API of the Writer service, the contract of record for its clients."
    ),
    tags(
        (name = "health", description = "Whether the service can serve requests"),
        (name = "workspace", description = "The whole tree of folders and documents"),
        (name = "folders", description = "Folders, which hold folders and documents"),
        (name = "documents", description = "Documents and their Markdown content"),
        (name = "pair-writer", description = "Provisional pair-writer readiness and streamed replies")
    ),
    components(schemas(
        ChatReplyDelta,
        ChatReplyDone,
        ChatReplyMetrics,
        ChatReadSource,
        ChatSourceKind,
        ReadingScope
    ))
)]
struct ApiDoc;

fn v1() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(health::get_health))
        .routes(routes!(workspace::get_workspace))
        .routes(routes!(folders::create_folder))
        .routes(routes!(folders::get_folder, folders::delete_folder))
        .routes(routes!(folders::replace_folder_title))
        .routes(routes!(folders::replace_folder_position))
        .routes(
            routes!(documents::create_document).layer(DefaultBodyLimit::max(CONTENT_BODY_LIMIT)),
        )
        .routes(routes!(documents::get_document, documents::delete_document))
        .routes(
            routes!(
                documents::get_document_content,
                documents::replace_document_content
            )
            .layer(DefaultBodyLimit::max(CONTENT_BODY_LIMIT)),
        )
        .routes(routes!(documents::replace_document_title))
        .routes(routes!(documents::replace_document_language))
        .routes(routes!(documents::replace_document_position))
        .routes(routes!(pair_writer::get_pair_writer))
        .routes(
            routes!(pair_writer::create_pair_writer_reply)
                .layer(DefaultBodyLimit::max(CONTENT_BODY_LIMIT)),
        )
}

fn parts() -> (Router<AppState>, utoipa::openapi::OpenApi) {
    let mut doc = ApiDoc::openapi();
    // utoipa fills an empty license from the unset Cargo `license` field.
    doc.info.license = None;
    OpenApiRouter::with_openapi(doc)
        .nest("/api/v1", v1())
        .split_for_parts()
}

/// Routes that match no path, or no method on a matched path, and handlers
/// that panic, all answer with problem details.
fn with_problem_fallbacks(router: Router) -> Router {
    router
        .fallback(|| async { Problem::not_found() })
        .method_not_allowed_fallback(|| async { Problem::method_not_allowed() })
        .layer(CatchPanicLayer::custom(panic_response))
}

fn panic_response(_panic: Box<dyn Any + Send + 'static>) -> Response {
    tracing::error!("request handler panicked");
    Problem::internal_error().into_response()
}

/// The router the service serves with no pair-writer provider configured,
/// reading and writing the workspace in `store`.
pub fn router(store: Store) -> Router {
    router_with_agent(store, Arc::new(UnconfiguredProvider))
}

/// The router the service serves, reading and writing the workspace in
/// `store` and answering pair-writer turns with `agent`.
pub fn router_with_agent(store: Store, agent: Agent) -> Router {
    with_problem_fallbacks(parts().0.with_state(AppState { store, agent }))
}

/// The OpenAPI document describing [`router`].
pub fn openapi() -> utoipa::openapi::OpenApi {
    parts().1
}

/// The contract as committed at `service/openapi.json`: pretty-printed JSON
/// ending in a newline.
pub fn openapi_json() -> String {
    let mut json = openapi()
        .to_pretty_json()
        .expect("the OpenAPI document serializes to JSON");
    json.push('\n');
    json
}

#[cfg(test)]
mod tests;

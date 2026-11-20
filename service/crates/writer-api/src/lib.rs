//! HTTP routes, transport types, problem responses, and the OpenAPI contract
//! for the Writer service.
//!
//! The served router and the contract come from one `OpenApiRouter`
//! registration, so every served route is documented.

mod documents;
mod extract;
mod folders;
mod health;
mod problem;
mod workspace;

use std::any::Any;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::response::{IntoResponse, Response};
use tower_http::catch_panic::CatchPanicLayer;
use utoipa::OpenApi;
use utoipa_axum::router::{OpenApiRouter, UtoipaMethodRouterExt};
use utoipa_axum::routes;

pub use documents::{Document, DocumentContent};
pub use folders::Folder;
pub use health::{Health, HealthStatus};
pub use problem::{Problem, ProblemCode, ProblemFieldError};
pub use workspace::{ItemKind, Store, Workspace, WorkspaceItem};

/// The request body limit of the two operations that carry content: 1 MiB
/// of content escaped at up to six bytes per character, plus the other
/// fields, as ADR 0005 sets. Other operations keep axum's 2 MiB default.
const CONTENT_BODY_LIMIT: usize = 8 * 1024 * 1024;

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
        (name = "documents", description = "Documents and their Markdown content")
    )
)]
struct ApiDoc;

fn v1() -> OpenApiRouter<Store> {
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
        .routes(routes!(documents::replace_document_position))
}

fn parts() -> (Router<Store>, utoipa::openapi::OpenApi) {
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

/// The router the service serves, reading and writing the workspace in
/// `store`.
pub fn router(store: Store) -> Router {
    with_problem_fallbacks(parts().0.with_state(store))
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

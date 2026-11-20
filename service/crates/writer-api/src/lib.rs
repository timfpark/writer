//! HTTP routes, transport types, problem responses, and the OpenAPI contract
//! for the Writer service.
//!
//! The served router and the contract come from one `OpenApiRouter`
//! registration, so every served route is documented.

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "handlers that read a body, path, or query arrive with later stories"
    )
)]
mod extract;
mod health;
mod problem;

use std::any::Any;

use axum::Router;
use axum::response::{IntoResponse, Response};
use tower_http::catch_panic::CatchPanicLayer;
use utoipa::OpenApi;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

pub use health::{Health, HealthStatus};
pub use problem::{Problem, ProblemCode, ProblemFieldError};

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Writer API",
        description = "HTTP API of the Writer service, the contract of record for its clients."
    ),
    tags((name = "health", description = "Whether the service can serve requests"))
)]
struct ApiDoc;

fn v1() -> OpenApiRouter {
    OpenApiRouter::new().routes(routes!(health::get_health))
}

fn parts() -> (Router, utoipa::openapi::OpenApi) {
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

/// The router the service serves.
pub fn router() -> Router {
    with_problem_fallbacks(parts().0)
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

//! Tests of the shared error mapping: extractor rejections, fallbacks, and
//! panics. Each request carries a synthetic marker that must not appear in
//! the response, because rejection messages can quote request content.

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{Method, Request, StatusCode, header};
use axum::routing::{get, post};
use serde::Deserialize;
use tower::ServiceExt;

use crate::extract::{Json, Path, Query};
use crate::problem::{PROBLEM_CONTENT_TYPE, Problem, ProblemCode, ProblemFieldError};

const MARKER: &str = "SYNTHETIC-MARKER-7f3a9c";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[expect(dead_code, reason = "fields are only deserialized")]
struct Body1 {
    kind: Kind,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum Kind {
    Question,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[expect(dead_code, reason = "fields are only deserialized")]
struct Params {
    limit: u32,
}

fn test_router() -> Router {
    super::with_problem_fallbacks(
        Router::new()
            .route("/body", post(|Json(_): Json<Body1>| async {}))
            .route("/items/{itemId}", get(|Path(_): Path<u32>| async {}))
            .route("/search", get(|Query(_): Query<Params>| async {}))
            .route(
                "/panic",
                get(|| async {
                    panic!("{MARKER}");
                }),
            ),
    )
}

async fn send(request: Request<Body>) -> (StatusCode, Option<String>, String) {
    let response = test_router().oneshot(request).await.unwrap();
    let status = response.status();
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .map(|value| value.to_str().unwrap().to_owned());
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (
        status,
        content_type,
        String::from_utf8(body.to_vec()).unwrap(),
    )
}

async fn expect_problem(request: Request<Body>, code: ProblemCode) -> Problem {
    let (status, content_type, body) = send(request).await;
    assert_eq!(status, code.status(), "body: {body}");
    assert_eq!(content_type.as_deref(), Some(PROBLEM_CONTENT_TYPE));
    assert!(!body.contains(MARKER), "response echoed the marker: {body}");
    let problem: Problem = serde_json::from_str(&body).unwrap();
    assert_eq!(problem.code, code);
    assert_eq!(problem.status, status.as_u16());
    assert_eq!(problem.title, status.canonical_reason().unwrap());
    assert_eq!(problem.problem_type, "about:blank");
    problem
}

fn json_post(body: impl Into<Body>) -> Request<Body> {
    Request::post("/body")
        .header(header::CONTENT_TYPE, "application/json")
        .body(body.into())
        .unwrap()
}

#[tokio::test]
async fn invalid_json_is_malformed_request() {
    let problem = expect_problem(
        json_post(format!("{{\"kind\": {MARKER}")),
        ProblemCode::MalformedRequest,
    )
    .await;
    assert!(problem.errors.is_empty());
}

#[tokio::test]
async fn unknown_field_is_validation_failed_at_the_root() {
    let problem = expect_problem(
        json_post(format!("{{\"kind\":\"question\",\"{MARKER}\":1}}")),
        ProblemCode::ValidationFailed,
    )
    .await;
    assert_eq!(
        problem.errors,
        vec![ProblemFieldError {
            pointer: String::new(),
            detail: "Does not match the request schema.".to_owned(),
        }]
    );
}

#[tokio::test]
async fn unknown_enum_value_is_validation_failed() {
    expect_problem(
        json_post(format!("{{\"kind\":\"{MARKER}\"}}")),
        ProblemCode::ValidationFailed,
    )
    .await;
}

#[tokio::test]
async fn body_without_json_content_type_is_unsupported_media_type() {
    let request = Request::post("/body")
        .header(header::CONTENT_TYPE, "text/plain")
        .body(Body::from(MARKER))
        .unwrap();
    expect_problem(request, ProblemCode::UnsupportedMediaType).await;
}

#[tokio::test]
async fn oversized_body_is_payload_too_large() {
    // axum's default body limit is 2 MiB.
    let body = format!(
        "{{\"kind\":\"{}\"}}",
        MARKER.repeat(3 * 1024 * 1024 / MARKER.len())
    );
    expect_problem(json_post(body), ProblemCode::PayloadTooLarge).await;
}

#[tokio::test]
async fn unparsable_path_parameter_is_malformed_request() {
    let request = Request::get(format!("/items/{MARKER}"))
        .body(Body::empty())
        .unwrap();
    expect_problem(request, ProblemCode::MalformedRequest).await;
}

#[tokio::test]
async fn unparsable_query_parameter_is_malformed_request() {
    let request = Request::get(format!("/search?limit={MARKER}"))
        .body(Body::empty())
        .unwrap();
    expect_problem(request, ProblemCode::MalformedRequest).await;
}

#[tokio::test]
async fn unmatched_path_is_not_found() {
    let request = Request::get(format!("/{MARKER}"))
        .body(Body::empty())
        .unwrap();
    expect_problem(request, ProblemCode::NotFound).await;
}

#[tokio::test]
async fn unmatched_method_is_method_not_allowed() {
    let request = Request::builder()
        .method(Method::DELETE)
        .uri(format!("/search?{MARKER}"))
        .body(Body::empty())
        .unwrap();
    expect_problem(request, ProblemCode::MethodNotAllowed).await;
}

#[tokio::test]
async fn panicking_handler_is_internal_error() {
    let request = Request::get("/panic").body(Body::empty()).unwrap();
    expect_problem(request, ProblemCode::InternalError).await;
}

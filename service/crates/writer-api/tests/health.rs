//! The health operation, exercised through the served router without a socket.

use std::sync::Arc;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode, header};
use tower::ServiceExt;
use writer_api::{Health, HealthStatus, Problem, ProblemCode};
use writer_storage::FilesystemStore;

async fn send(request: Request<Body>) -> (StatusCode, axum::http::HeaderMap, Vec<u8>) {
    let data = tempfile::tempdir().unwrap();
    let store = FilesystemStore::open(data.path()).await.unwrap();
    let response = writer_api::router(Arc::new(store))
        .oneshot(request)
        .await
        .unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (status, headers, body.to_vec())
}

#[tokio::test]
async fn get_health_returns_ok() {
    let request = Request::get("/api/v1/health").body(Body::empty()).unwrap();
    let (status, headers, body) = send(request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers[header::CONTENT_TYPE], "application/json");
    assert_eq!(body, br#"{"status":"ok"}"#);
    let health: Health = serde_json::from_slice(&body).unwrap();
    assert_eq!(health.status, HealthStatus::Ok);
}

#[tokio::test]
async fn served_router_uses_problem_fallbacks() {
    for (request, code) in [
        (
            Request::get("/api/v1/healthz").body(Body::empty()).unwrap(),
            ProblemCode::NotFound,
        ),
        (
            Request::post("/api/v1/health").body(Body::empty()).unwrap(),
            ProblemCode::MethodNotAllowed,
        ),
    ] {
        let (status, headers, body) = send(request).await;
        assert_eq!(status, code.status());
        assert_eq!(headers[header::CONTENT_TYPE], "application/problem+json");
        let problem: Problem = serde_json::from_slice(&body).unwrap();
        assert_eq!(problem.code, code);
    }
}

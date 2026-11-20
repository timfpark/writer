//! RFC 9457 problem details, the single error body for every API response.
//!
//! `detail` and `errors` hold only text written here. Rejection messages from
//! axum and serde can quote request content, so they are never passed on.

use axum::extract::rejection::{JsonRejection, PathRejection, QueryRejection};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use utoipa::{IntoResponses, ToSchema};
use writer_domain::Violation;
use writer_storage::StoreError;

pub(crate) const PROBLEM_CONTENT_TYPE: &str = "application/problem+json";

/// An RFC 9457 problem details object describing why a request failed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    /// Always `about:blank`; branch on `code` instead.
    #[serde(rename = "type")]
    pub problem_type: String,
    /// The standard reason phrase for `status`.
    pub title: String,
    /// The HTTP status code, repeated from the response.
    pub status: u16,
    /// A short explanation of this occurrence, written by the service.
    pub detail: String,
    pub code: ProblemCode,
    /// One entry per invalid request body field; otherwise empty.
    pub errors: Vec<ProblemFieldError>,
}

/// The kind of error; treat an unrecognized code according to the status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum ProblemCode {
    MalformedRequest,
    NotFound,
    MethodNotAllowed,
    Conflict,
    PayloadTooLarge,
    UnsupportedMediaType,
    ValidationFailed,
    InternalError,
    UpstreamFailed,
    Unavailable,
    UpstreamTimeout,
}

impl ProblemCode {
    /// The one status each kind of failure is served with.
    pub fn status(self) -> StatusCode {
        match self {
            Self::MalformedRequest => StatusCode::BAD_REQUEST,
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::MethodNotAllowed => StatusCode::METHOD_NOT_ALLOWED,
            Self::Conflict => StatusCode::CONFLICT,
            Self::PayloadTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
            Self::UnsupportedMediaType => StatusCode::UNSUPPORTED_MEDIA_TYPE,
            Self::ValidationFailed => StatusCode::UNPROCESSABLE_ENTITY,
            Self::InternalError => StatusCode::INTERNAL_SERVER_ERROR,
            Self::UpstreamFailed => StatusCode::BAD_GATEWAY,
            Self::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
            Self::UpstreamTimeout => StatusCode::GATEWAY_TIMEOUT,
        }
    }
}

/// One invalid field in a request body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProblemFieldError {
    // Built only from declared field names and array indexes, never from
    // request keys the type does not declare, as ADR 0004 requires.
    /// A JSON Pointer to the field, or `""` for the whole body.
    pub pointer: String,
    pub detail: String,
}

impl Problem {
    pub fn new(code: ProblemCode, detail: impl Into<String>) -> Self {
        let status = code.status();
        Self {
            problem_type: "about:blank".to_owned(),
            title: status.canonical_reason().unwrap_or_default().to_owned(),
            status: status.as_u16(),
            detail: detail.into(),
            code,
            errors: Vec::new(),
        }
    }

    pub fn validation_failed(errors: Vec<ProblemFieldError>) -> Self {
        Self {
            errors,
            ..Self::new(
                ProblemCode::ValidationFailed,
                "The request body is invalid.",
            )
        }
    }

    /// A 422 listing each broken workspace rule against its field.
    pub(crate) fn violations(violations: impl IntoIterator<Item = Violation>) -> Self {
        Self::validation_failed(
            violations
                .into_iter()
                .map(|violation| ProblemFieldError {
                    pointer: violation.pointer().to_owned(),
                    detail: violation.detail().to_owned(),
                })
                .collect(),
        )
    }

    pub fn not_found() -> Self {
        Self::new(
            ProblemCode::NotFound,
            "No resource matches the request path.",
        )
    }

    pub fn method_not_allowed() -> Self {
        Self::new(
            ProblemCode::MethodNotAllowed,
            "The resource does not support the request method.",
        )
    }

    pub fn internal_error() -> Self {
        Self::new(
            ProblemCode::InternalError,
            "The service failed unexpectedly.",
        )
    }
}

impl IntoResponse for Problem {
    fn into_response(self) -> Response {
        let status = self.code.status();
        match serde_json::to_vec(&self) {
            Ok(body) => {
                (status, [(header::CONTENT_TYPE, PROBLEM_CONTENT_TYPE)], body).into_response()
            }
            Err(_) => status.into_response(),
        }
    }
}

/// ADR 0006's mapping. Every `StoreError` is safe to log, and none is passed
/// into `detail`.
impl From<StoreError> for Problem {
    fn from(error: StoreError) -> Self {
        match error {
            StoreError::NotFound => Self::new(
                ProblemCode::NotFound,
                "The requested resource does not exist.",
            ),
            StoreError::Conflict(conflict) => Self::new(ProblemCode::Conflict, conflict.detail()),
            StoreError::Invalid(violation) => Self::violations([violation]),
            // The store has already logged the identifier and reason.
            StoreError::Unreadable { .. } => Self::internal_error(),
            StoreError::Internal(error) => {
                tracing::error!("{error}");
                Self::internal_error()
            }
        }
    }
}

/// The failures every operation with a request body documents, besides 500.
#[derive(IntoResponses)]
#[expect(dead_code, reason = "only documents responses")]
pub(crate) enum BodyProblems {
    #[response(
        status = 400,
        description = "The request body is not valid JSON.",
        content_type = "application/problem+json"
    )]
    MalformedRequest(Problem),
    #[response(
        status = 413,
        description = "The request body exceeds the size limit.",
        content_type = "application/problem+json"
    )]
    PayloadTooLarge(Problem),
    #[response(
        status = 415,
        description = "The request body is not sent as application/json.",
        content_type = "application/problem+json"
    )]
    UnsupportedMediaType(Problem),
    #[response(
        status = 422,
        description = "The request body breaks the schema or a workspace rule; `errors` names each field.",
        content_type = "application/problem+json"
    )]
    ValidationFailed(Problem),
}

impl From<JsonRejection> for Problem {
    fn from(rejection: JsonRejection) -> Self {
        match rejection.status() {
            StatusCode::PAYLOAD_TOO_LARGE => Self::new(
                ProblemCode::PayloadTooLarge,
                "The request body exceeds the size limit.",
            ),
            StatusCode::UNSUPPORTED_MEDIA_TYPE => Self::new(
                ProblemCode::UnsupportedMediaType,
                "The request body must be sent with Content-Type: application/json.",
            ),
            // serde reports where the body diverged from the request type,
            // but its path can include a key the type does not declare, so
            // the whole body is reported instead.
            StatusCode::UNPROCESSABLE_ENTITY => Self::validation_failed(vec![ProblemFieldError {
                pointer: String::new(),
                detail: "Does not match the request schema.".to_owned(),
            }]),
            status if status.is_client_error() => Self::new(
                ProblemCode::MalformedRequest,
                "The request body is not valid JSON.",
            ),
            _ => Self::internal_error(),
        }
    }
}

impl From<PathRejection> for Problem {
    fn from(rejection: PathRejection) -> Self {
        if rejection.status().is_client_error() {
            Self::new(
                ProblemCode::MalformedRequest,
                "A path parameter could not be parsed.",
            )
        } else {
            Self::internal_error()
        }
    }
}

impl From<QueryRejection> for Problem {
    fn from(rejection: QueryRejection) -> Self {
        if rejection.status().is_client_error() {
            Self::new(
                ProblemCode::MalformedRequest,
                "A query parameter could not be parsed.",
            )
        } else {
            Self::internal_error()
        }
    }
}

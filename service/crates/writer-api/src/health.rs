use axum::Json;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::problem::Problem;

/// Whether the service can serve requests.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    pub status: HealthStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum HealthStatus {
    Ok,
}

/// Report that the service can serve requests.
#[utoipa::path(
    get,
    path = "/health",
    operation_id = "getHealth",
    tag = "health",
    responses(
        (status = 200, description = "The service can serve requests.", body = Health),
        (
            status = 500,
            description = "The service failed unexpectedly.",
            body = Problem,
            content_type = "application/problem+json"
        ),
    )
)]
pub(crate) async fn get_health() -> Json<Health> {
    Json(Health {
        status: HealthStatus::Ok,
    })
}

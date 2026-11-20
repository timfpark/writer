//! Contract freshness: the committed `service/openapi.json` must equal the
//! document generated from the routes. Set `UPDATE_OPENAPI=1` to rewrite it.

use std::path::PathBuf;

const REGENERATE: &str = "UPDATE_OPENAPI=1 cargo test -p writer-api --test openapi";

#[test]
fn committed_contract_matches_the_routes() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../openapi.json");
    let generated = writer_api::openapi_json();

    if std::env::var_os("UPDATE_OPENAPI").is_some_and(|value| value == "1") {
        std::fs::write(&path, &generated)
            .unwrap_or_else(|error| panic!("cannot write service/openapi.json: {error}"));
        return;
    }

    let committed = std::fs::read_to_string(&path).unwrap_or_default();
    assert!(
        committed == generated,
        "service/openapi.json is stale or missing: it does not match the routes in writer-api. \
         Regenerate it from service/ with `{REGENERATE}` and commit the result."
    );
}

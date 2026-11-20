//! ADR 0004 conventions, checked mechanically against the generated contract.
//! Each violation names the path or schema location that breaks a rule.

use std::collections::BTreeSet;

use serde_json::{Value, json};

const METHODS: [&str; 8] = [
    "get", "put", "post", "delete", "options", "head", "patch", "trace",
];
const PROBLEM_REF: &str = "#/components/schemas/Problem";

fn is_camel_case(text: &str) -> bool {
    let mut chars = text.chars();
    chars.next().is_some_and(|c| c.is_ascii_lowercase()) && chars.all(|c| c.is_ascii_alphanumeric())
}

fn is_kebab_case(text: &str) -> bool {
    !text.is_empty()
        && text.split('-').all(|part| {
            !part.is_empty()
                && part
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        })
}

/// Splits `/api/v{major}/rest` into the segments of `rest`.
fn versioned_segments(path: &str) -> Option<Vec<&str>> {
    let rest = path.strip_prefix("/api/v")?;
    let (major, rest) = rest.split_once('/')?;
    let valid_major =
        !major.is_empty() && !major.starts_with('0') && major.chars().all(|c| c.is_ascii_digit());
    valid_major.then(|| rest.split('/').collect())
}

fn is_nullable(schema: &Value) -> bool {
    let is_null_type = |value: &Value| value.get("type") == Some(&json!("null"));
    match schema.get("type") {
        Some(Value::Array(types)) if types.contains(&json!("null")) => return true,
        Some(value) if value == "null" => return true,
        _ => {}
    }
    ["oneOf", "anyOf"].iter().any(|key| {
        schema
            .get(*key)
            .and_then(Value::as_array)
            .is_some_and(|variants| variants.iter().any(is_null_type))
    })
}

fn check_schema(schema: &Value, location: &str, violations: &mut Vec<String>) {
    let Some(object) = schema.as_object() else {
        return;
    };
    if let Some(values) = object.get("enum").and_then(Value::as_array) {
        for value in values.iter().filter_map(Value::as_str) {
            if !is_camel_case(value) {
                violations.push(format!("{location}: enum value '{value}' is not camelCase"));
            }
        }
    }
    if let Some(properties) = object.get("properties").and_then(Value::as_object) {
        let required: BTreeSet<&str> = object
            .get("required")
            .and_then(Value::as_array)
            .map(|names| names.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default();
        for (name, property) in properties {
            let property_location = format!("{location}/properties/{name}");
            if !is_camel_case(name) {
                violations.push(format!(
                    "{property_location}: property name is not camelCase"
                ));
            }
            if !required.contains(name.as_str()) && is_nullable(property) {
                violations.push(format!(
                    "{property_location}: property is both optional and nullable"
                ));
            }
            check_schema(property, &property_location, violations);
        }
    }
    for key in ["items", "additionalProperties", "not"] {
        if let Some(child) = object.get(key) {
            check_schema(child, &format!("{location}/{key}"), violations);
        }
    }
    for key in ["oneOf", "anyOf", "allOf", "prefixItems"] {
        for (index, child) in object
            .get(key)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .enumerate()
        {
            check_schema(child, &format!("{location}/{key}/{index}"), violations);
        }
    }
}

fn check_content_schemas(content: Option<&Value>, location: &str, violations: &mut Vec<String>) {
    for (media_type, media) in content.and_then(Value::as_object).into_iter().flatten() {
        if let Some(schema) = media.get("schema") {
            check_schema(
                schema,
                &format!("{location}/content/{media_type}/schema"),
                violations,
            );
        }
    }
}

fn check_parameters(parameters: Option<&Value>, location: &str, violations: &mut Vec<String>) {
    for (index, parameter) in parameters
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
    {
        let parameter_location = format!("{location}/parameters/{index}");
        match parameter.get("name").and_then(Value::as_str) {
            Some(name) if is_camel_case(name) => {}
            name => violations.push(format!(
                "{parameter_location}: parameter name {name:?} is not camelCase"
            )),
        }
        if let Some(schema) = parameter.get("schema") {
            check_schema(schema, &format!("{parameter_location}/schema"), violations);
        }
    }
}

fn is_error_status(status: &str) -> bool {
    status == "default" || status.starts_with('4') || status.starts_with('5')
}

fn check_operation(
    operation: &Value,
    location: &str,
    resource: &str,
    declared_tags: &BTreeSet<&str>,
    operation_ids: &mut BTreeSet<String>,
    violations: &mut Vec<String>,
) {
    match operation.get("operationId").and_then(Value::as_str) {
        Some(id) if is_camel_case(id) => {
            if !operation_ids.insert(id.to_owned()) {
                violations.push(format!("{location}: operationId '{id}' is not unique"));
            }
        }
        id => violations.push(format!(
            "{location}: operationId {id:?} is missing or not camelCase"
        )),
    }

    let tags: Vec<&str> = operation
        .get("tags")
        .and_then(Value::as_array)
        .map(|tags| tags.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    match tags.as_slice() {
        [tag] if *tag == resource && declared_tags.contains(tag) => {}
        [tag] if *tag == resource => {
            violations.push(format!(
                "{location}: tag '{tag}' is not declared in the top-level tags"
            ));
        }
        _ => violations.push(format!(
            "{location}: needs exactly one tag, '{resource}', but has {tags:?}"
        )),
    }

    check_parameters(operation.get("parameters"), location, violations);
    if let Some(body) = operation.get("requestBody") {
        check_content_schemas(
            body.get("content"),
            &format!("{location}/requestBody"),
            violations,
        );
    }

    for (status, response) in operation
        .get("responses")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let response_location = format!("{location}/responses/{status}");
        check_content_schemas(response.get("content"), &response_location, violations);
        if !is_error_status(status) {
            continue;
        }
        let content = response.get("content").and_then(Value::as_object);
        let is_problem = content.is_some_and(|content| {
            content.len() == 1
                && content
                    .get("application/problem+json")
                    .and_then(|media| media.get("schema"))
                    .and_then(|schema| schema.get("$ref"))
                    == Some(&json!(PROBLEM_REF))
        });
        if !is_problem {
            violations.push(format!(
                "{response_location}: error response must be only application/problem+json referencing {PROBLEM_REF}"
            ));
        }
    }
}

fn violations(document: &Value) -> Vec<String> {
    let mut violations = Vec::new();
    let mut operation_ids = BTreeSet::new();
    let declared_tags: BTreeSet<&str> = document
        .get("tags")
        .and_then(Value::as_array)
        .map(|tags| {
            tags.iter()
                .filter_map(|tag| tag.get("name").and_then(Value::as_str))
                .collect()
        })
        .unwrap_or_default();

    for (path, item) in document
        .get("paths")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let location = path.to_owned();
        let Some(segments) = versioned_segments(path) else {
            violations.push(format!("{location}: path is not under /api/v{{major}}/"));
            continue;
        };
        for segment in &segments {
            let valid = match segment.strip_prefix('{').and_then(|s| s.strip_suffix('}')) {
                Some(parameter) => is_camel_case(parameter),
                None => is_kebab_case(segment),
            };
            if !valid {
                violations.push(format!(
                    "{location}: segment '{segment}' is not lowercase kebab-case or a camelCase parameter"
                ));
            }
        }
        let resource = segments.first().copied().unwrap_or_default();

        check_parameters(item.get("parameters"), &location, &mut violations);
        for method in METHODS {
            if let Some(operation) = item.get(method) {
                check_operation(
                    operation,
                    &format!("{} {path}", method.to_uppercase()),
                    resource,
                    &declared_tags,
                    &mut operation_ids,
                    &mut violations,
                );
            }
        }
    }

    for (name, schema) in document
        .pointer("/components/schemas")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        check_schema(
            schema,
            &format!("#/components/schemas/{name}"),
            &mut violations,
        );
    }
    violations
}

#[test]
fn contract_follows_the_api_conventions() {
    let document: Value = serde_json::from_str(&writer_api::openapi_json()).unwrap();
    let found = violations(&document);
    assert!(
        found.is_empty(),
        "the contract breaks ADR 0004 conventions:\n{}",
        found.join("\n")
    );
}

#[test]
fn each_rule_reports_the_location_that_breaks_it() {
    let document = json!({
        "tags": [{ "name": "documents" }],
        "paths": {
            "/health": { "get": { "operationId": "getHealth", "tags": ["health"], "responses": {} } },
            "/api/v1/style_guides/": {
                "get": { "operationId": "listStyleGuides", "tags": ["style_guides"], "responses": {} }
            },
            "/api/v1/documents/{document_id}": {
                "parameters": [{ "name": "document_id", "in": "path" }],
                "get": {
                    "operationId": "get_document",
                    "tags": ["documents", "extra"],
                    "responses": {
                        "404": { "content": { "application/json": { "schema": { "$ref": PROBLEM_REF } } } }
                    }
                },
                "delete": { "operationId": "getDocumentById", "tags": ["documents"], "responses": {} },
                "put": { "operationId": "getDocumentById", "tags": ["documents"], "responses": {} }
            },
            "/api/v1/questions": {
                "post": { "operationId": "createQuestions", "tags": ["questions"], "responses": {} }
            }
        },
        "components": {
            "schemas": {
                "Document": {
                    "type": "object",
                    "required": ["title"],
                    "properties": {
                        "title": { "type": "string" },
                        "created_at": { "type": "string" },
                        "summary": { "type": ["string", "null"] },
                        "kind": { "type": "string", "enum": ["plain-text"] }
                    }
                }
            }
        }
    });

    let found = violations(&document).join("\n");
    for expected in [
        "/health: path is not under /api/v{major}/",
        "segment '' is not lowercase kebab-case",
        "segment 'style_guides' is not lowercase kebab-case",
        "segment '{document_id}' is not lowercase kebab-case or a camelCase parameter",
        "/api/v1/documents/{document_id}/parameters/0: parameter name Some(\"document_id\")",
        "GET /api/v1/documents/{document_id}: operationId Some(\"get_document\") is missing or not camelCase",
        "GET /api/v1/documents/{document_id}: needs exactly one tag, 'documents'",
        "operationId 'getDocumentById' is not unique",
        "POST /api/v1/questions: tag 'questions' is not declared",
        "GET /api/v1/documents/{document_id}/responses/404: error response must be only application/problem+json",
        "#/components/schemas/Document/properties/created_at: property name is not camelCase",
        "#/components/schemas/Document/properties/summary: property is both optional and nullable",
        "#/components/schemas/Document/properties/kind: enum value 'plain-text' is not camelCase",
    ] {
        assert!(
            found.contains(expected),
            "missing '{expected}' in:\n{found}"
        );
    }
}

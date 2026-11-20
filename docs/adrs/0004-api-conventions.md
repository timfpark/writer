---
title: "ADR 0004: API versioning, naming, errors, and streaming conventions"
description: Versions the HTTP API with a major-version path segment under /api/, names paths, fields, operations, and tags, returns RFC 9457 problem details for errors, frames SSE streams, and defers pagination and idempotency with their triggers
author: Tim Park
ms.date: 2026-11-20
ms.topic: reference
status: Accepted
subsystems:
  - service
  - webapp
keywords:
  - adr
  - api
  - versioning
  - openapi
  - problem details
  - rfc 9457
  - server-sent events
estimated_reading_time: 14
---

## Status

Accepted on 2026-11-20.

## Decision summary

* Nest every HTTP API route under `/api/v1/`, reject unknown request fields
  with `#[serde(deny_unknown_fields)]`, and keep breaking `v1` changes coupled
  to same-commit client regeneration until a client ships separately.
* Use lowercase kebab-case plural nouns for collections, singular nouns for
  singletons (`GET /api/v1/health`), camelCase parameters with opaque string
  `*Id` identifiers, and `POST` to plural result nouns for stateless
  computations so manuscript text never enters URLs or query strings.
* Format all request and response bodies as camelCase JSON objects (`items`
  array field for collections, never bare arrays or scalars, non-null arrays,
  and UTC RFC 3339 timestamps).
* Make every response field required (`Option<T>` with
  `#[schema(required = true)]` producing `T | null`) and every optional request
  field non-nullable (`#[serde(default)]` plus `#[schema(nullable = false)]`
  producing `field?: T`); never mark a property both optional and nullable.
* Return RFC 9457 `application/problem+json` (`Problem` with `ProblemCode` and
  `errors`) for every error including extractor rejections and router
  fallbacks, never echoing manuscript text, credentials, or raw serde messages
  in responses or logs.
* Set explicit camelCase `operation_id` values (`getHealth`, `createQuestions`)
  and one tag matching the first path segment after `/api/v1/` on every
  operation, enforced by a mechanical OpenAPI conventions test.
* Frame `200 text/event-stream` SSE endpoints with camelCase event names and
  single-line JSON `data` payloads ending in `done` or `error` (`Problem`).

## Context

[ADR 0002](./0002-service-architecture.md) emits the service's contract from
code with utoipa as OpenAPI 3.1.0 at `service/openapi.json`, and lists API
conventions as a follow-up: paths and versioning, error payloads, pagination,
and idempotency. [ADR 0003](./0003-webapp-architecture.md) generates the
webapp's types from that document with openapi-typescript, calls the service
through openapi-fetch, and proxies every path under `/api/` to the service
without rewriting it. It leaves versioning and naming below `/api/` to this
decision, and names the prefix, chosen before these conventions, as a risk.

No route exists yet. [Backlog 6](../backlog/0006-service-foundation.md) creates
the health endpoint, and [backlog 12](../backlog/0012-first-pair-writing-agent.md)
adds the first endpoint with real request, response, and error bodies, possibly
streamed. Whatever those two routes do becomes precedent, so the conventions
come first.

Today the service and the webapp ship from one commit and pass one gate, and a
stale generated client fails `tools/check`. Field names, optionality, and error
shapes reach the webapp as generated TypeScript types, so changing them once
routes exist touches both subsystems. ADR 0002 anticipates other clients. A
client released separately from the service, such as a desktop or mobile
build, cannot be regenerated in the same commit, and that is the case a
versioning scheme protects.

A prototype built outside the repository served three synthetic routes with
axum 0.8.9, utoipa 6.0.0, and utoipa-axum 0.3.0 under a nested `/api/v1`
prefix, exercised them through the router without a socket, and generated types
from the emitted document with openapi-typescript 7.13.0. A client module using
openapi-fetch 0.17.0 type-checked under TypeScript 6.0.3 with ADR 0003's
compiler options, including `exactOptionalPropertyTypes`. Findings that shaped
this decision are noted where they apply.

## Decision drivers

* Conventions that coding agents can follow from one example and that a test
  can check mechanically
* Generated TypeScript types that are idiomatic and say exactly what a field
  can hold
* A compatibility promise that costs nothing while every client ships with the
  service, and that holds once one does not
* Errors that clients can branch on without parsing prose, and that never echo
  manuscript text
* Streams whose end and failures a client can tell apart from a dropped
  connection
* Standards and defaults the chosen tools already support

## Considered options

### Versioning

1. No version. Paths start at `/api/`, such as `/api/health`. Nothing needs
   maintaining while every client ships with the service. Introducing a
   version later changes every path at once, and until then a breaking change
   needs an ad hoc new path per resource.
2. A major-version path segment, such as `/api/v1/health`. The version appears
   in every URL, log line, proxy rule, and generated path type, so a client is
   bound to a version at compile time. utoipa-axum adds the prefix once through
   `OpenApiRouter::nest`; the prototype confirmed that nested routes appear in
   the document with the full path. A second version duplicates the operations
   it changes. Most public HTTP APIs use this form.
3. A header or media type, such as `Accept: application/vnd.writer.v1+json`,
   an `Api-Version` header, or an `api-version` query parameter. URLs stay
   stable across versions, but the version is invisible in logs and proxy
   rules, and responses that vary by header need `Vary` for caching. OpenAPI
   describes it as a parameter or as alternative media types on one operation,
   which openapi-typescript renders as a union the caller must narrow. The
   browser's `EventSource` cannot set request headers.
4. Dated versions with per-change transformations, as Stripe uses. Clients pin
   a date and the service translates older shapes on the fly. It suits a large
   public API with many integrators and needs a translation layer we have no
   use for.

### Path and field naming

Paths can use plural resource nouns or verb-named endpoints, and multiword
segments can be kebab-case, snake_case, or camelCase. Kebab-case is the most
common in URLs and reads well in logs.

JSON field names can be camelCase or snake_case. snake_case matches Rust field
names without any attribute. camelCase matches TypeScript, so the generated
types and the code that uses them read idiomatically, and it is the default in
the JSON style guides from Google and Microsoft. serde produces it with one
`rename_all` attribute per type.

### Optional and absent fields

utoipa marks a bare `Option<T>` field as both optional and nullable, which
openapi-typescript renders as `field?: T | null`, two ways of saying "no value"
that every caller must handle. The prototype confirmed this, and also
confirmed that utoipa attributes produce either of two exact forms instead:

* `#[schema(required = true)]` keeps the field required and nullable, which
  generates `field: T | null`.
* `#[serde(default)]` with `#[schema(nullable = false)]` makes the field
  optional and non-nullable, which generates `field?: T`.

Omitting absent fields from responses shrinks payloads slightly. Always
sending them, with `null` when empty, gives every response the same shape and
makes the generated type force callers to handle the empty case.

### Error payload

1. RFC 9457 problem details, served as `application/problem+json`. Members
   `type`, `title`, `status`, `detail`, and `instance` are standard, and
   extension members are allowed. Its own example carries field-level errors as
   an `errors` array of JSON Pointers. The prototype confirmed that utoipa
   documents the media type, openapi-typescript keeps it, and openapi-fetch
   types the `error` result as the problem schema.
2. A custom envelope, such as `{ "error": { "code", "message", "details" } }`
   as Microsoft's and Google's guidelines describe. Equally expressive, but
   nothing outside Writer recognizes it.
3. axum's defaults: a status code with a plain-text body, or an empty body for
   unmatched routes. Clients cannot tell error kinds apart without parsing
   prose, and rejection messages come from serde, which echoes submitted values
   such as an unknown enum variant.

RFC 9457 identifies a problem kind by its `type` URI, which should resolve to
documentation. Writer publishes no such documentation, and inventing URIs that
do not resolve, or that name a domain we do not own, adds nothing a short code
does not.

### Streaming

ADR 0002 streams incremental results over server-sent events (SSE). Over SSE,
a connection that closes cleanly, closes after a failure, or drops looks the
same to the client unless the stream says which happened. Once the response
status is sent, a failure can no longer change it.

## Decision

### Versioning and compatibility

Serve every API route under `/api/v{major}/`, starting with `/api/v1/`. The
version is one positive integer; there are no minor versions in paths. Build
each version's routes in their own `OpenApiRouter` and nest it under its prefix
once, so handlers declare paths relative to the version.

Clients ignore response fields they do not recognize. The service rejects
request fields it does not recognize, so a misspelled field fails loudly:
request types use `#[serde(deny_unknown_fields)]`, which utoipa documents as
`additionalProperties: false`.

A breaking change is one that can make a correct client built against the
current contract fail:

* Removing or renaming a path, operation, field, parameter, or enum value
* Changing a field's type, format, or meaning, or making a response field
  nullable
* Adding a required request field or parameter, or making an optional one
  required
* Tightening validation of a request the contract already allows
* Adding a value to an enum that appears in a response, except `ProblemCode`
* Changing an operation's success status or media type, or the `code` returned
  for an existing condition

Adding an operation, an optional request field or parameter, a response field,
a request enum value, a `ProblemCode` value, or an error status is not
breaking, nor is relaxing validation, rewording a description or `detail`, or
giving a problem a `type` other than `about:blank`.
Renaming an operation ID changes nothing on the wire but breaks code that uses
the generated `operations` type, so treat it as breaking.

While every client ships from the same commit as the service, make breaking
changes inside `v1` in the same change that updates every client in the
repository; the gate proves they agree. Once any client is released separately
from the service, `v1` takes only additive changes, and a breaking change
creates `/api/v2/`. The story that first needs `v2` decides, in an amendment to
this record, whether `v2` repeats unchanged operations, how operation IDs stay
unique across versions, and how long `v1` remains served.

The document's `info.version` is the `writer-api` package version. It does not
describe compatibility; the path's major version does.

### Paths

* Every literal path segment is lowercase kebab-case, such as `style-guides`.
  No path ends in a slash.
* A collection is a plural noun, such as `/api/v1/documents`, and an item is
  addressed below it by identifier, such as `/api/v1/documents/{documentId}`.
  A singleton is a singular noun, such as `/api/v1/health`.
* Path parameters are camelCase and name the field they match, so an
  identifier ends in `Id`. Identifiers are opaque strings, never numbers.
* Nest a resource below a parent only when it cannot exist without that
  parent, and at most one parent deep, such as
  `/api/v1/documents/{documentId}/revisions/{revisionId}`.
* An operation that computes a result without storing anything is a `POST` to
  a plural noun naming the result, with the input in the request body, such as
  `POST /api/v1/questions`. Manuscript text never appears in a path or query
  string, where proxies, logs, and browser history would keep it.
* Query parameters are camelCase.

Methods follow HTTP semantics: `GET` reads and returns 200, `POST` creates a
resource and returns 201 with a `Location` header or computes a result and
returns 200, `PUT` replaces and returns 200, and `DELETE` returns 204. Partial
updates with `PATCH` are left to the first story that needs one, because they
need a rule for distinguishing "unchanged" from "cleared".

The health endpoint is `GET /api/v1/health`. It returns 200 with
`{ "status": "ok" }` while the service can serve requests.

### Bodies and fields

* Request and response bodies are JSON objects served as `application/json`,
  never a bare array or scalar, so a field can be added later. A response is
  the resource itself, with no `data` envelope. A collection response is an
  object whose `items` field holds the array.
* Field names and enum values are camelCase. Annotate every transport type and
  enum with `#[serde(rename_all = "camelCase")]`.
* Every field in a response is always present. A field with no value is
  `null`: annotate its `Option<T>` with `#[schema(required = true)]`, which
  generates `field: T | null`.
* An optional request field may be omitted and is not nullable: annotate its
  `Option<T>` with `#[serde(default)]` and `#[schema(nullable = false)]`, which
  generates `field?: T`. The service treats an explicit `null` as omitted, but
  the contract does not offer it.
* No property is both optional and nullable.
* Arrays are never `null`. An empty collection is `[]`.
* Timestamps are RFC 3339 strings in UTC, documented with `format: date-time`,
  and named for the event they record, such as `createdAt`.

### Errors

Every error response, including those from axum's extractors, unmatched routes,
and unmatched methods, is an RFC 9457 problem details object served as
`application/problem+json`. Responses that HTTP forbids a body, such as those
to `HEAD`, carry only the status. `writer-api` owns one `Problem` transport
type and maps every axum rejection into it, and its router fallback and
method-not-allowed fallback return it.

| Member   | Type                  | Content                                                                                                     |
|----------|-----------------------|-------------------------------------------------------------------------------------------------------------|
| `type`   | string                | `about:blank` today; clients do not branch on it                                                            |
| `title`  | string                | The status code's standard reason phrase, from the `http` crate's `canonical_reason`                        |
| `status` | integer               | The HTTP status code, repeated                                                                              |
| `detail` | string                | A short English explanation of this occurrence, written by the service                                      |
| `code`   | `ProblemCode`         | A camelCase identifier of the error kind, which clients branch on                                           |
| `errors` | `ProblemFieldError[]` | One entry per invalid request body field, each with a JSON Pointer `pointer` and a `detail`; otherwise `[]` |

`instance` is not used. `detail` and `errors` never contain request content,
manuscript text, credentials, internal error messages, or model provider
responses. The service writes its own text rather than passing on serde's
rejection messages, which can quote the submitted value. A `pointer` is built
only from field names the schema declares and array indexes; a field the
schema does not declare, whose name could itself be prose, is reported with
the root pointer `""`. The same sources stay out of the service's logs: it
never logs request or response bodies, query strings, rejection messages, or
provider responses. Router tests send invalid bodies containing a synthetic
marker string and assert that the marker appears in no response.

Each kind of failure has one status and one code:

| Status | `code`                 | When                                                                                      |
|--------|------------------------|-------------------------------------------------------------------------------------------|
| 400    | `malformedRequest`     | The body is not valid JSON, or a path or query parameter cannot be parsed                 |
| 404    | `notFound`             | No route matches, or the named resource does not exist                                    |
| 405    | `methodNotAllowed`     | The route exists, but not with this method                                                |
| 409    | `conflict`             | The request conflicts with the resource's current state                                   |
| 413    | `payloadTooLarge`      | The body exceeds the service's limit                                                      |
| 415    | `unsupportedMediaType` | A body is present without `Content-Type: application/json`                                |
| 422    | `validationFailed`     | The JSON is well formed but violates the schema or a business rule; `errors` lists fields |
| 500    | `internalError`        | An unexpected failure in the service                                                      |
| 502    | `upstreamFailed`       | A model provider returned an error or an unusable response                                |
| 503    | `unavailable`          | The service is shutting down, or a capability it needs is not configured                  |
| 504    | `upstreamTimeout`      | A model provider did not respond in time                                                  |

A new kind of failure adds a code, and may reuse a status. `ProblemCode` is a
string enum in the contract, so the generated type lists the known codes, but
the set is open: clients treat a code they do not recognize according to its
status, and any runtime response validator added under ADR 0003's trigger
accepts unknown codes.

In the contract, `Problem`, `ProblemCode`, and `ProblemFieldError` are named
schemas under `components`. Every operation documents each error status it can
return, including 500, with `application/problem+json` content referencing
`Problem`. Operations that take a body also document 400, 413, 415, and 422.
Statuses shared by many operations can be declared once on a type that derives
utoipa's `IntoResponses`. ADR 0002 requires router tests to exercise each
documented status. A status an operation's own code returns is tested through
that operation. A status produced by shared code, such as the extractor
rejection mapping, the fallbacks, or the conversion of an unexpected error to
500, is tested once against that shared code rather than through every
operation, so a handler that cannot fail needs no contrived failure.

### Operation IDs and tags

* Every operation sets `operation_id` explicitly in its `#[utoipa::path]`
  attribute; otherwise utoipa uses the Rust function's snake_case name.
* An operation ID is a camelCase verb and noun, unique in the document:
  `get` and `list` for reads of an item and a collection, `create`, `replace`,
  and `delete` for writes, and `create` with the result's noun for a
  computation. Examples are `getHealth`, `listDocuments`, `getDocument`, and
  `createQuestions`.
* Every operation has exactly one tag, equal to the first path segment after
  the version, such as `health`, `documents`, or `questions`. Declare each tag
  with a description in the top-level `#[openapi(tags(...))]`.

### Server-sent event streams

These rules frame a stream. Whether an endpoint streams is the decision of the
story or ADR that designs it.

* Failures detected before the stream starts, such as validation errors or an
  unconfigured provider, return an ordinary problem response with its status.
* A stream is a 200 `text/event-stream` response. Every event has a camelCase
  `event` name and a `data` field holding one line of JSON matching a named
  schema under `components`, as ADR 0002 requires. The operation's description
  lists its event names and their schemas.
* A stream that succeeds ends with a `done` event whose data is a JSON object,
  empty unless the operation documents a summary, and the service then closes
  the connection.
* A stream that fails after starting sends an `error` event whose data is a
  `Problem`, with the status and code the failure would have returned before
  the stream started, and the service then closes the connection.
* A connection that closes without `done` or `error` was interrupted. Clients
  report it as a failure.
* Events carry no `id`, and the service does not resume streams from
  `Last-Event-ID`. A client retries with a new request. SSE comment lines can
  serve as keep-alives, and clients ignore them.

### Enforcement

[Backlog 6](../backlog/0006-service-foundation.md) adds a conventions test,
`service/crates/writer-api/tests/conventions.rs` (planned), that walks the
generated document and fails with the path or schema that breaks a rule here:
a path outside `/api/v{major}/` or with a segment that is not lowercase
kebab-case, a parameter, property, or enum value that is not camelCase, an
operation without a camelCase operation ID or with other than one declared tag,
a property that is both optional and nullable, or an error response that is not
`application/problem+json` referencing `Problem`. Review covers the rest.

### Examples

The health endpoint:

```http
GET /api/v1/health

HTTP/1.1 200 OK
Content-Type: application/json

{"status":"ok"}
```

A computation shaped like backlog 12's endpoint. The final fields and schemas
belong to that story; the paths, casing, nullability, and errors follow this
record. `focus` is an optional request field and `quotedSpan` a nullable
response field:

```http
POST /api/v1/questions
Content-Type: application/json

{"passage":"The keeper climbed the stairs twice before lighting the lamp.","focus":"pacing"}

HTTP/1.1 200 OK
Content-Type: application/json

{"items":[{"text":"Why does the keeper climb the stairs twice?","quotedSpan":"climbed the stairs twice"},{"text":"What does the keeper expect to see from the top?","quotedSpan":null}]}
```

The generated types for those bodies:

```ts
CreateQuestionsRequest: {
    focus?: components["schemas"]["QuestionFocus"];
    passage: string;
};
Question: {
    quotedSpan: string | null;
    text: string;
};
```

The same request with an empty passage:

```http
HTTP/1.1 422 Unprocessable Entity
Content-Type: application/problem+json

{"type":"about:blank","title":"Unprocessable Entity","status":422,"detail":"The request body is invalid.","code":"validationFailed","errors":[{"pointer":"/passage","detail":"Must not be empty."}]}
```

A streamed variant that fails after its first event:

```text
event: question
data: {"text":"Why does the keeper climb the stairs twice?","quotedSpan":"climbed the stairs twice"}

event: error
data: {"type":"about:blank","title":"Bad Gateway","status":502,"detail":"The model provider returned an error.","code":"upstreamFailed","errors":[]}
```

### Deferred decisions

* Pagination. Collection responses are already objects with an `items` field,
  so paging fields can be added without a breaking change. Decide the scheme,
  likely an opaque cursor, before the first collection operation whose size the
  service does not bound ships; adding paging to a collection clients already
  read in full is a breaking change.
* Idempotency. `GET`, `PUT`, and `DELETE` are idempotent by their HTTP
  semantics, and a stateless computation such as `createQuestions` is safe to
  repeat, at the cost of another model call. Decide, likely with an
  `Idempotency-Key` request header, when the first `POST` that creates durable
  state ships, or when a separately released client retries requests over an
  unreliable network.
* Partial updates with `PATCH`, decided by the first story that needs one.

## Consequences

Positive outcomes:

* The first route and every later one follow one written scheme, with an
  example for each rule, and a test catches most departures with the name of
  the offending path or schema.
* The generated types say exactly whether a field can be missing or empty, and
  openapi-fetch types each error as `Problem`, so the webapp branches on `code`
  without parsing text.
* The `/api/` prefix from ADR 0003 now has a defined structure below it, which
  retires that ADR's risk of a prefix chosen ahead of the conventions.
* Problem details are a standard that HTTP tooling and other clients recognize.
* A separately released client can be supported without renaming any existing
  path.

Trade-offs and risks:

* Every path carries `/v1` for a promise that costs nothing until a client is
  released separately.
* camelCase and the nullability rules depend on serde and utoipa attributes
  that are easy to forget. The conventions test and the contract diff catch
  omissions, but only after they are written.
* `type` is `about:blank` with a `code` extension, a common but less
  expressive use of RFC 9457 than dereferenceable problem types.
* Accepting `null` for an optional request field is more lenient than the
  contract, so a client that sends `null` works without the contract saying so.
* Rejecting unknown request fields means a client newer than the service fails
  on any new field it sends; only older clients against newer services are
  protected.
* Responses always carry every field, which costs a few bytes per `null`.

## Revisit triggers

* The first client released separately from the service freezes `v1` to
  additive changes. Record the release in this ADR's Status section.
* The first breaking change needed after that point requires `v2` and the
  amendment described under [Versioning and compatibility](#versioning-and-compatibility).
* Publish dereferenceable problem `type` URIs if Writer gains public API
  documentation. Clients branch on `code`, so replacing `about:blank` is not
  breaking.
* Revisit the SSE rules when the contract moves to OpenAPI 3.2 and can describe
  each event with `itemSchema`.
* Pagination and idempotency reopen at the triggers under
  [Deferred decisions](#deferred-decisions).

## Follow-up decisions

* Pagination scheme, when its trigger above occurs
* Idempotency keys, when its trigger above occurs
* Partial update semantics, with the first `PATCH` operation
* Authentication errors and their codes, alongside the authentication decision
  ADR 0002 lists

## References

* [RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html)
* [RFC 6901: JavaScript Object Notation (JSON) Pointer](https://www.rfc-editor.org/rfc/rfc6901.html)
* [RFC 3339: Date and Time on the Internet: Timestamps](https://www.rfc-editor.org/rfc/rfc3339.html)
* [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html)
* [HTML Living Standard: Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html)
* [The Idempotency-Key HTTP header field, IETF draft](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)
* [Microsoft REST API Guidelines](https://github.com/microsoft/api-guidelines/blob/vNext/azure/Guidelines.md)
* [Google JSON Style Guide](https://google.github.io/styleguide/jsoncstyleguide.xml)
* [Google AIP-193: Errors](https://google.aip.dev/193)
* [Stripe API versioning](https://docs.stripe.com/api/versioning)
* [utoipa `ToSchema` field attributes](https://docs.rs/utoipa/latest/utoipa/derive.ToSchema.html)
* [utoipa-axum `OpenApiRouter`](https://docs.rs/utoipa-axum/latest/utoipa_axum/router/struct.OpenApiRouter.html)
* [axum extractor rejections](https://docs.rs/axum/latest/axum/extract/index.html#rejection-types)
* [openapi-fetch](https://openapi-ts.dev/openapi-fetch/)

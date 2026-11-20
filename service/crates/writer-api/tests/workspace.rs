//! The workspace operations, exercised through the served router against the
//! filesystem backend in a temporary directory, without a socket.
//!
//! Titles and content carry a synthetic marker. Every problem response is
//! checked for it, and every test ends by checking that no log line, at any
//! level, contains it.

use std::io;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, Once};

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{HeaderMap, Method, Request, StatusCode, header};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use tempfile::TempDir;
use tower::ServiceExt;
use writer_api::{
    Document, DocumentContent, Folder, ItemKind, Problem, ProblemCode, ProblemFieldError,
    Workspace, WorkspaceItem,
};
use writer_storage::FilesystemStore;

const MARKER: &str = "SYNTHETIC-MARKER-7f3a9c";
const MIB: usize = 1024 * 1024;

static LOGS: Mutex<Vec<u8>> = Mutex::new(Vec::new());

struct LogWriter;

impl io::Write for LogWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        LOGS.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// Sends every log line from every test in this binary to [`LOGS`].
fn capture_logs() {
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        tracing_subscriber::fmt()
            .with_max_level(tracing::Level::TRACE)
            .with_writer(|| LogWriter)
            .init();
    });
}

fn logs() -> String {
    String::from_utf8_lossy(&LOGS.lock().unwrap()).into_owned()
}

/// A synthetic identifier, distinct for each `n`.
fn id(n: u16) -> String {
    format!("a0000000-0000-4000-8000-{n:012}")
}

struct Api {
    data: TempDir,
    router: Router,
}

impl Drop for Api {
    fn drop(&mut self) {
        if !std::thread::panicking() {
            let logs = logs();
            assert!(!logs.contains(MARKER), "a log line has the marker:\n{logs}");
        }
    }
}

struct Reply {
    status: StatusCode,
    headers: HeaderMap,
    body: Vec<u8>,
}

impl Reply {
    fn json<T: DeserializeOwned>(&self, status: StatusCode) -> T {
        assert_eq!(self.status, status, "body: {}", self.text());
        assert_eq!(self.headers[header::CONTENT_TYPE], "application/json");
        serde_json::from_slice(&self.body).unwrap()
    }

    fn problem(&self, code: ProblemCode) -> Problem {
        assert_eq!(self.status, code.status(), "body: {}", self.text());
        assert_eq!(
            self.headers[header::CONTENT_TYPE],
            "application/problem+json"
        );
        assert!(
            !self.text().contains(MARKER),
            "the problem has the marker: {}",
            self.text()
        );
        let problem: Problem = serde_json::from_slice(&self.body).unwrap();
        assert_eq!(problem.code, code);
        problem
    }

    fn field_errors(&self) -> Vec<String> {
        self.problem(ProblemCode::ValidationFailed)
            .errors
            .into_iter()
            .map(|error| error.pointer)
            .collect()
    }

    fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
}

impl Api {
    async fn open() -> Self {
        capture_logs();
        let data = tempfile::tempdir().unwrap();
        let store = FilesystemStore::open(data.path()).await.unwrap();
        let router = writer_api::router(Arc::new(store));
        Self { data, router }
    }

    fn workspace_dir(&self) -> PathBuf {
        self.data.path().join("workspace")
    }

    async fn send_bytes(&self, method: Method, uri: &str, body: Vec<u8>) -> Reply {
        let request = Request::builder()
            .method(method)
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body))
            .unwrap();
        let response = self.router.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let headers = response.headers().clone();
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        Reply {
            status,
            headers,
            body: body.to_vec(),
        }
    }

    async fn send(&self, method: Method, uri: &str, body: Value) -> Reply {
        self.send_bytes(method, uri, serde_json::to_vec(&body).unwrap())
            .await
    }

    async fn get(&self, uri: &str) -> Reply {
        let request = Request::get(uri).body(Body::empty()).unwrap();
        let response = self.router.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let headers = response.headers().clone();
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        Reply {
            status,
            headers,
            body: body.to_vec(),
        }
    }

    async fn delete(&self, uri: &str) -> Reply {
        let request = Request::delete(uri).body(Body::empty()).unwrap();
        let response = self.router.clone().oneshot(request).await.unwrap();
        Reply {
            status: response.status(),
            headers: response.headers().clone(),
            body: to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap()
                .to_vec(),
        }
    }

    async fn workspace(&self) -> Vec<WorkspaceItem> {
        self.get("/api/v1/workspace")
            .await
            .json::<Workspace>(StatusCode::OK)
            .items
    }

    async fn create_folder(&self, id: &str, parent: Option<&str>, title: &str) -> Folder {
        let body = json!({"folderId": id, "parentId": parent, "beforeId": null, "title": title});
        self.send(Method::POST, "/api/v1/folders", body)
            .await
            .json(StatusCode::CREATED)
    }

    async fn create_document(
        &self,
        id: &str,
        parent: Option<&str>,
        title: &str,
        markdown: &str,
    ) -> Document {
        let body = json!({
            "documentId": id, "parentId": parent, "beforeId": null,
            "title": title, "markdown": markdown,
        });
        self.send(Method::POST, "/api/v1/documents", body)
            .await
            .json(StatusCode::CREATED)
    }

    async fn content(&self, id: &str) -> DocumentContent {
        self.get(&format!("/api/v1/documents/{id}/content"))
            .await
            .json(StatusCode::OK)
    }
}

fn item(id: &str, kind: ItemKind, parent: Option<&str>, title: &str) -> WorkspaceItem {
    WorkspaceItem {
        id: id.to_owned(),
        kind,
        parent_id: parent.map(str::to_owned),
        title: title.to_owned(),
    }
}

#[tokio::test]
async fn reads_the_tree_in_pre_order() {
    let api = Api::open().await;
    assert_eq!(api.workspace().await, []);

    api.create_folder(&id(1), None, "The lighthouse").await;
    api.create_document(&id(2), Some(&id(1)), "Chapter one", "")
        .await;
    let before_chapter = json!({
        "folderId": id(3), "parentId": id(1), "beforeId": id(2), "title": "Drafts",
    });
    api.send(Method::POST, "/api/v1/folders", before_chapter)
        .await
        .json::<Folder>(StatusCode::CREATED);
    api.create_document(&id(4), Some(&id(3)), "Opening", "")
        .await;
    api.create_document(&id(5), None, "Notes", "").await;

    assert_eq!(
        api.workspace().await,
        [
            item(&id(1), ItemKind::Folder, None, "The lighthouse"),
            item(&id(3), ItemKind::Folder, Some(&id(1)), "Drafts"),
            item(&id(4), ItemKind::Document, Some(&id(3)), "Opening"),
            item(&id(2), ItemKind::Document, Some(&id(1)), "Chapter one"),
            item(&id(5), ItemKind::Document, None, "Notes"),
        ]
    );
}

#[tokio::test]
async fn a_create_returns_201_with_location_and_a_replay_returns_200() {
    let api = Api::open().await;
    let body = json!({"folderId": id(1), "parentId": null, "beforeId": null, "title": "Drafts"});
    let reply = api.send(Method::POST, "/api/v1/folders", body).await;
    let folder: Folder = reply.json(StatusCode::CREATED);
    assert_eq!(
        reply.headers[header::LOCATION],
        format!("/api/v1/folders/{}", id(1))
    );
    assert_eq!(
        folder,
        Folder {
            id: id(1),
            parent_id: None,
            title: "Drafts".to_owned()
        }
    );
    assert!(api.workspace_dir().join("Drafts").is_dir());

    // A replay returns the folder as it is, whatever the rest of the body
    // says, even a position that names no item.
    let replay =
        json!({"folderId": id(1), "parentId": "not-a-folder", "beforeId": null, "title": "Other"});
    let reply = api.send(Method::POST, "/api/v1/folders", replay).await;
    assert_eq!(reply.json::<Folder>(StatusCode::OK), folder);
    assert!(!reply.headers.contains_key(header::LOCATION));

    let markdown = format!("The keeper {MARKER} climbed the stairs.\n");
    let body = json!({
        "documentId": id(2), "parentId": id(1), "beforeId": null, "title": "Chapter one",
        "markdown": markdown,
    });
    let reply = api.send(Method::POST, "/api/v1/documents", body).await;
    let document: Document = reply.json(StatusCode::CREATED);
    assert_eq!(
        reply.headers[header::LOCATION],
        format!("/api/v1/documents/{}", id(2))
    );
    assert_eq!(document.parent_id, Some(id(1)));
    assert_eq!(api.content(&id(2)).await.markdown, markdown);
    assert_eq!(
        std::fs::read_to_string(api.workspace_dir().join("Drafts/Chapter one.md")).unwrap(),
        markdown
    );

    let replay = json!({"documentId": id(2), "parentId": null, "beforeId": null, "title": "Other"});
    let reply = api.send(Method::POST, "/api/v1/documents", replay).await;
    assert_eq!(reply.json::<Document>(StatusCode::OK), document);

    // A document created without `markdown` is empty.
    let body = json!({"documentId": id(3), "parentId": null, "beforeId": null, "title": "Empty"});
    api.send(Method::POST, "/api/v1/documents", body)
        .await
        .json::<Document>(StatusCode::CREATED);
    assert_eq!(api.content(&id(3)).await.markdown, "");
}

#[tokio::test]
async fn a_create_conflicts_with_the_other_kind_or_a_missing_position() {
    let api = Api::open().await;
    api.create_document(&id(1), None, "Notes", "").await;
    api.create_folder(&id(2), None, "Drafts").await;

    let reply = api
        .send(
            Method::POST,
            "/api/v1/folders",
            json!({"folderId": id(1), "parentId": null, "beforeId": null, "title": MARKER}),
        )
        .await;
    reply.problem(ProblemCode::Conflict);
    let reply = api
        .send(
            Method::POST,
            "/api/v1/documents",
            json!({"documentId": id(2), "parentId": null, "beforeId": null, "title": MARKER}),
        )
        .await;
    reply.problem(ProblemCode::Conflict);

    for (parent, before) in [
        (json!(id(9)), json!(null)),
        (json!(id(1)), json!(null)),
        (json!(MARKER), json!(null)),
        (json!(null), json!(id(9))),
        (json!(id(2)), json!(id(1))),
        (json!(null), json!(MARKER)),
    ] {
        let body = json!({
            "documentId": id(3), "parentId": parent, "beforeId": before,
            "title": MARKER, "markdown": MARKER,
        });
        let problem = api
            .send(Method::POST, "/api/v1/documents", body)
            .await
            .problem(ProblemCode::Conflict);
        assert_eq!(
            problem.detail,
            "The target position does not exist in the workspace."
        );
    }
    assert_eq!(api.workspace().await.len(), 2);
}

#[tokio::test]
async fn a_create_reports_each_broken_field_rule() {
    let api = Api::open().await;
    let body = json!({
        "documentId": id(1).to_uppercase(), "parentId": null, "beforeId": null,
        "title": format!(" {MARKER}"), "markdown": format!("{MARKER}\u{0}"),
    });
    let reply = api.send(Method::POST, "/api/v1/documents", body).await;
    assert_eq!(
        reply.problem(ProblemCode::ValidationFailed).errors,
        [
            ProblemFieldError {
                pointer: "/documentId".to_owned(),
                detail: "Must be a lowercase hyphenated UUID.".to_owned(),
            },
            ProblemFieldError {
                pointer: "/title".to_owned(),
                detail: "Must be 1 to 200 characters with no surrounding whitespace or control characters.".to_owned(),
            },
            ProblemFieldError {
                pointer: "/markdown".to_owned(),
                detail: "Must be at most 1048576 bytes of UTF-8 with no U+0000 characters.".to_owned(),
            },
        ]
    );

    let body = json!({"folderId": MARKER, "parentId": null, "beforeId": null, "title": "Drafts"});
    let reply = api.send(Method::POST, "/api/v1/folders", body).await;
    assert_eq!(reply.field_errors(), ["/folderId"]);

    // Omitting `parentId` or `beforeId` never defaults to the top level or
    // the end.
    for body in [
        json!({"folderId": id(2), "beforeId": null, "title": MARKER}),
        json!({"folderId": id(2), "parentId": null, "title": MARKER}),
    ] {
        let reply = api.send(Method::POST, "/api/v1/folders", body).await;
        assert_eq!(reply.field_errors(), [""]);
    }

    let body = json!({"folderId": id(2), "parentId": null, "beforeId": null, "title": "Drafts", "markdown": MARKER});
    let reply = api.send(Method::POST, "/api/v1/folders", body).await;
    assert_eq!(reply.field_errors(), [""]);

    assert_eq!(api.workspace().await, []);
}

#[tokio::test]
async fn reads_an_item_only_of_the_path_kind() {
    let api = Api::open().await;
    let folder = api.create_folder(&id(1), None, "Drafts").await;
    let markdown = format!("{MARKER}\r\nThe tide came in.");
    let document = api
        .create_document(&id(2), Some(&id(1)), "Chapter one", &markdown)
        .await;

    let reply = api.get(&format!("/api/v1/folders/{}", id(1))).await;
    assert_eq!(reply.json::<Folder>(StatusCode::OK), folder);
    let reply = api.get(&format!("/api/v1/documents/{}", id(2))).await;
    assert_eq!(reply.json::<Document>(StatusCode::OK), document);
    assert_eq!(
        api.content(&id(2)).await,
        DocumentContent {
            markdown,
            revision: document.revision
        }
    );

    for uri in [
        format!("/api/v1/folders/{}", id(2)),
        format!("/api/v1/folders/{}", id(9)),
        format!("/api/v1/folders/{MARKER}"),
        format!("/api/v1/documents/{}", id(1)),
        format!("/api/v1/documents/{}", id(2).to_uppercase()),
        format!("/api/v1/documents/{}/content", id(1)),
        format!("/api/v1/documents/{MARKER}/content"),
    ] {
        let problem = api.get(&uri).await.problem(ProblemCode::NotFound);
        assert_eq!(problem.detail, "The requested resource does not exist.");
    }
}

#[tokio::test]
async fn renaming_keeps_the_identifier_and_revision() {
    let api = Api::open().await;
    api.create_folder(&id(1), None, "Drafts").await;
    let document = api
        .create_document(&id(2), None, "Chapter one", MARKER)
        .await;

    let reply = api
        .send(
            Method::PUT,
            &format!("/api/v1/folders/{}/title", id(1)),
            json!({"title": "Earlier drafts"}),
        )
        .await;
    assert_eq!(reply.json::<Folder>(StatusCode::OK).title, "Earlier drafts");
    assert!(api.workspace_dir().join("Earlier drafts").is_dir());

    let reply = api
        .send(
            Method::PUT,
            &format!("/api/v1/documents/{}/title", id(2)),
            json!({"title": "Chapter 1"}),
        )
        .await;
    assert_eq!(
        reply.json::<Document>(StatusCode::OK),
        Document {
            title: "Chapter 1".to_owned(),
            ..document
        }
    );
    assert!(api.workspace_dir().join("Chapter 1.md").is_file());

    let reply = api
        .send(
            Method::PUT,
            &format!("/api/v1/documents/{}/title", id(2)),
            json!({"title": format!("{MARKER}\n")}),
        )
        .await;
    assert_eq!(reply.field_errors(), ["/title"]);

    for uri in [
        format!("/api/v1/folders/{}/title", id(2)),
        format!("/api/v1/documents/{}/title", id(9)),
    ] {
        let reply = api.send(Method::PUT, &uri, json!({"title": MARKER})).await;
        reply.problem(ProblemCode::NotFound);
    }
    assert_eq!(api.workspace().await[1].title, "Chapter 1");
}

#[tokio::test]
async fn moves_and_reorders_items() {
    let api = Api::open().await;
    api.create_folder(&id(1), None, "Drafts").await;
    api.create_folder(&id(2), Some(&id(1)), "Old").await;
    api.create_document(&id(3), None, "Chapter one", "").await;
    api.create_document(&id(4), None, "Chapter two", "").await;
    let position = |item: &str, kind: &str| format!("/api/v1/{kind}/{item}/position");

    let reply = api
        .send(
            Method::PUT,
            &position(&id(4), "documents"),
            json!({"parentId": null, "beforeId": id(3)}),
        )
        .await;
    assert_eq!(reply.json::<Document>(StatusCode::OK).parent_id, None);
    let reply = api
        .send(
            Method::PUT,
            &position(&id(3), "documents"),
            json!({"parentId": id(1), "beforeId": id(2)}),
        )
        .await;
    assert_eq!(
        reply.json::<Document>(StatusCode::OK).parent_id,
        Some(id(1))
    );
    assert!(api.workspace_dir().join("Drafts/Chapter one.md").is_file());
    let reply = api
        .send(
            Method::PUT,
            &position(&id(2), "folders"),
            json!({"parentId": null, "beforeId": null}),
        )
        .await;
    assert_eq!(reply.json::<Folder>(StatusCode::OK).parent_id, None);
    assert_eq!(
        api.workspace()
            .await
            .into_iter()
            .map(|item| item.id)
            .collect::<Vec<_>>(),
        [id(1), id(3), id(4), id(2)]
    );

    for (item, kind, body) in [
        (
            id(1),
            "folders",
            json!({"parentId": id(1), "beforeId": null}),
        ),
        (
            id(1),
            "folders",
            json!({"parentId": id(9), "beforeId": null}),
        ),
        (
            id(1),
            "folders",
            json!({"parentId": MARKER, "beforeId": null}),
        ),
        (
            id(4),
            "documents",
            json!({"parentId": id(3), "beforeId": null}),
        ),
        (
            id(4),
            "documents",
            json!({"parentId": null, "beforeId": id(3)}),
        ),
        (
            id(4),
            "documents",
            json!({"parentId": null, "beforeId": MARKER}),
        ),
    ] {
        let reply = api.send(Method::PUT, &position(&item, kind), body).await;
        reply.problem(ProblemCode::Conflict);
    }
    for (item, kind) in [
        (id(3), "folders"),
        (id(9), "documents"),
        (MARKER.to_owned(), "documents"),
    ] {
        let body = json!({"parentId": MARKER, "beforeId": null});
        let reply = api.send(Method::PUT, &position(&item, kind), body).await;
        reply.problem(ProblemCode::NotFound);
    }
    let reply = api
        .send(
            Method::PUT,
            &position(&id(4), "documents"),
            json!({"parentId": null}),
        )
        .await;
    assert_eq!(reply.field_errors(), [""]);

    assert_eq!(
        api.workspace()
            .await
            .into_iter()
            .map(|item| item.id)
            .collect::<Vec<_>>(),
        [id(1), id(3), id(4), id(2)]
    );
}

#[tokio::test]
async fn a_move_past_the_depth_limit_is_rejected() {
    let api = Api::open().await;
    let mut parent = None;
    for n in 1..=15 {
        api.create_folder(&id(n), parent.as_deref(), &format!("Level {n}"))
            .await;
        parent = Some(id(n));
    }
    api.create_folder(&id(100), None, "Moving").await;
    api.create_document(&id(101), Some(&id(100)), "Inside", "")
        .await;

    let reply = api
        .send(
            Method::PUT,
            &format!("/api/v1/folders/{}/position", id(100)),
            json!({"parentId": id(15), "beforeId": null}),
        )
        .await;
    assert_eq!(reply.field_errors(), ["/parentId"]);
    assert_eq!(api.workspace().await.last().unwrap().id, id(101));
}

#[tokio::test]
async fn saving_follows_the_stale_write_rule() {
    let api = Api::open().await;
    let created = api.create_document(&id(1), None, "Chapter one", "").await;
    let uri = format!("/api/v1/documents/{}/content", id(1));
    let first = format!("The keeper climbed the stairs. {MARKER}\n");
    let path = api.workspace_dir().join("Chapter one.md");

    let reply = api
        .send(
            Method::PUT,
            &uri,
            json!({"markdown": first, "baseRevision": created.revision}),
        )
        .await;
    let saved: Document = reply.json(StatusCode::OK);
    assert_ne!(saved.revision, created.revision);
    assert_eq!(saved.title, "Chapter one");
    assert_eq!(std::fs::read_to_string(&path).unwrap(), first);

    // Another tab, still holding the first revision, saves different text.
    let reply = api
        .send(
            Method::PUT,
            &uri,
            json!({"markdown": format!("The keeper waited. {MARKER}\n"), "baseRevision": created.revision}),
        )
        .await;
    let problem = reply.problem(ProblemCode::Conflict);
    assert_eq!(
        problem.detail,
        "The document changed after the base revision."
    );
    assert_eq!(
        api.content(&id(1)).await,
        DocumentContent {
            markdown: first.clone(),
            revision: saved.revision.clone()
        }
    );
    assert_eq!(std::fs::read_to_string(&path).unwrap(), first);

    // Identical text succeeds whatever the base, so a retried save is safe.
    let reply = api
        .send(
            Method::PUT,
            &uri,
            json!({"markdown": first, "baseRevision": MARKER}),
        )
        .await;
    assert_eq!(reply.json::<Document>(StatusCode::OK), saved);

    let reply = api
        .send(
            Method::PUT,
            &uri,
            json!({"markdown": format!("{MARKER}\u{0}"), "baseRevision": saved.revision}),
        )
        .await;
    assert_eq!(reply.field_errors(), ["/markdown"]);
    let reply = api
        .send(Method::PUT, &uri, json!({"markdown": MARKER}))
        .await;
    assert_eq!(reply.field_errors(), [""]);
    for missing in [id(9), MARKER.to_owned()] {
        let reply = api
            .send(
                Method::PUT,
                &format!("/api/v1/documents/{missing}/content"),
                json!({"markdown": MARKER, "baseRevision": saved.revision}),
            )
            .await;
        reply.problem(ProblemCode::NotFound);
    }
    assert_eq!(std::fs::read_to_string(&path).unwrap(), first);
}

#[tokio::test]
async fn content_operations_accept_bodies_up_to_8_mib() {
    let api = Api::open().await;
    // U+0001 is escaped as six bytes, so 1 MiB of it is a 6 MiB body.
    let largest = "\u{1}".repeat(MIB);
    let body = json!({
        "documentId": id(1), "parentId": null, "beforeId": null,
        "title": "Largest", "markdown": largest,
    });
    let reply = api.send(Method::POST, "/api/v1/documents", body).await;
    let document: Document = reply.json(StatusCode::CREATED);
    assert_eq!(api.content(&id(1)).await.markdown.len(), MIB);

    let uri = format!("/api/v1/documents/{}/content", id(1));
    let body = json!({"markdown": format!("{largest}{MARKER}"), "baseRevision": document.revision});
    assert_eq!(
        api.send(Method::PUT, &uri, body).await.field_errors(),
        ["/markdown"]
    );

    let oversized = MARKER.repeat(9 * MIB / MARKER.len());
    let body = json!({"markdown": oversized, "baseRevision": document.revision});
    let reply = api.send(Method::PUT, &uri, body).await;
    reply.problem(ProblemCode::PayloadTooLarge);
    let body = json!({
        "documentId": id(2), "parentId": null, "beforeId": null,
        "title": "Too large", "markdown": oversized,
    });
    let reply = api.send(Method::POST, "/api/v1/documents", body).await;
    reply.problem(ProblemCode::PayloadTooLarge);

    // Operations without content keep the 2 MiB default.
    let body = json!({"title": MARKER.repeat(3 * MIB / MARKER.len())});
    let reply = api
        .send(
            Method::PUT,
            &format!("/api/v1/documents/{}/title", id(1)),
            body,
        )
        .await;
    reply.problem(ProblemCode::PayloadTooLarge);

    assert_eq!(api.content(&id(1)).await.markdown, largest);
    assert_eq!(api.workspace().await.len(), 1);
}

#[tokio::test]
async fn deletes_items_with_their_subtrees() {
    let api = Api::open().await;
    api.create_folder(&id(1), None, "Drafts").await;
    api.create_folder(&id(2), Some(&id(1)), "Old").await;
    api.create_document(&id(3), Some(&id(2)), "Chapter one", MARKER)
        .await;
    api.create_document(&id(4), None, "Notes", MARKER).await;

    let folder = format!("/api/v1/folders/{}", id(1));
    let reply = api.delete(&folder).await;
    assert_eq!(reply.status, StatusCode::NO_CONTENT);
    assert!(reply.body.is_empty());
    assert!(!api.workspace_dir().join("Drafts").exists());
    assert_eq!(
        api.workspace().await,
        [item(&id(4), ItemKind::Document, None, "Notes")]
    );

    let document = format!("/api/v1/documents/{}", id(4));
    assert_eq!(api.delete(&document).await.status, StatusCode::NO_CONTENT);
    assert!(!api.workspace_dir().join("Notes.md").exists());
    assert_eq!(api.workspace().await, []);

    for uri in [
        folder,
        document,
        format!("/api/v1/documents/{}", id(3)),
        format!("/api/v1/folders/{MARKER}"),
    ] {
        api.delete(&uri).await.problem(ProblemCode::NotFound);
    }
}

#[tokio::test]
async fn unreadable_content_is_an_internal_error_that_echoes_nothing() {
    let api = Api::open().await;
    api.create_document(&id(1), None, "Unreadable", "").await;
    std::fs::write(
        api.workspace_dir().join("Unreadable.md"),
        format!("{MARKER}\u{0}"),
    )
    .unwrap();

    let reply = api
        .get(&format!("/api/v1/documents/{}/content", id(1)))
        .await;
    let problem = reply.problem(ProblemCode::InternalError);
    assert_eq!(problem.detail, "The service failed unexpectedly.");
    let body = json!({"markdown": MARKER, "baseRevision": MARKER});
    let reply = api
        .send(
            Method::PUT,
            &format!("/api/v1/documents/{}/content", id(1)),
            body,
        )
        .await;
    reply.problem(ProblemCode::InternalError);

    // The store logged the failure by identifier, so the capture works.
    assert!(logs().contains(&id(1)), "no log line names the document");
}

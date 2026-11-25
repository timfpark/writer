//! The conformance suite every backend passes. A backend's test target
//! enables the `conformance` feature, implements [`Harness`], and expands
//! every case with [`conformance_tests!`](crate::conformance_tests):
//!
//! ```ignore
//! writer_storage::conformance_tests!(MyHarness);
//! ```
//!
//! Each case becomes its own `#[tokio::test]`, so a failure names the case
//! and the backend. Every title and document is synthetic.

use std::collections::BTreeMap;
use std::future::Future;
use std::sync::Arc;

use writer_domain::{
    Conflict, Item, ItemId, ItemKind, Language, MAX_CONTENT_BYTES, Markdown, NewItem, Placement,
    Revision, Title, Violation, WorkspaceItem,
};

use crate::{Created, StoreError, WorkspaceStore, revision_of};

/// Opens a backend in an isolated location for one case.
pub trait Harness: Sized + Send + 'static {
    /// A fresh, empty store in a new isolated location.
    fn open() -> impl Future<Output = Self> + Send;

    /// The open store.
    fn store(&self) -> Arc<dyn WorkspaceStore>;

    /// Closes the store and opens it again from the same location.
    fn reopen(self) -> impl Future<Output = Self> + Send;
}

/// Expands every conformance case into a `#[tokio::test]` for a harness. The
/// calling crate needs Tokio with the `macros` and `rt-multi-thread`
/// features.
#[macro_export]
macro_rules! conformance_tests {
    ($harness:ty) => {
        $crate::conformance_tests!(@cases $harness;
            a_new_store_is_empty,
            creates_each_kind_at_the_top_level,
            creates_inside_a_folder_before_a_sibling_and_at_the_end,
            a_repeated_create_returns_the_existing_item_unchanged,
            a_create_reusing_an_identifier_of_the_other_kind_conflicts,
            creates_conflict_with_a_missing_parent_or_sibling,
            moves_between_folders,
            reorders_within_a_parent,
            a_move_before_itself_changes_nothing,
            moves_conflict_with_a_missing_parent_or_sibling,
            a_folder_cannot_move_into_itself_or_a_descendant,
            the_depth_limit_reaches_the_store,
            missing_items_and_the_other_kind_are_not_found,
            renaming_keeps_the_identifier_and_revision,
            stress_titles_read_back_exactly,
            content_round_trips_byte_for_byte,
            saving_follows_the_stale_write_rule,
            concurrent_saves_from_one_base_let_exactly_one_succeed,
            revisions_change_exactly_when_content_changes,
            deletes_documents_and_folders_with_their_subtrees,
            reopening_finds_the_same_workspace,
            document_language_defaults_updates_and_survives_changes,
        );
    };
    (@cases $harness:ty; $($case:ident),+ $(,)?) => {
        $(
            #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
            async fn $case() {
                $crate::conformance::$case::<$harness>().await;
            }
        )+
    };
}

/// A synthetic identifier numbered `n`.
pub fn id(n: u32) -> ItemId {
    ItemId::parse(&format!("c0f0a000-0000-4000-8000-{n:012x}")).expect("a valid identifier")
}

fn title(text: &str) -> Title {
    Title::parse(text).expect("a valid title")
}

fn markdown(text: &str) -> Markdown {
    Markdown::parse(text).expect("valid content")
}

fn at(parent: Option<&ItemId>, before: Option<&ItemId>) -> Placement {
    Placement {
        parent_id: parent.cloned(),
        before_id: before.cloned(),
    }
}

async fn new_folder(store: &dyn WorkspaceStore, n: u32, text: &str, placement: Placement) -> Item {
    let created = store
        .create(NewItem::folder(id(n), title(text), placement))
        .await
        .expect("the folder is created");
    assert!(created.is_new());
    created.into_item()
}

async fn new_document(
    store: &dyn WorkspaceStore,
    n: u32,
    text: &str,
    placement: Placement,
    content: &str,
) -> Item {
    let created = store
        .create(NewItem::document(
            id(n),
            title(text),
            placement,
            markdown(content),
            Language::default(),
        ))
        .await
        .expect("the document is created");
    assert!(created.is_new());
    created.into_item()
}

async fn revision(store: &dyn WorkspaceStore, n: u32) -> Revision {
    store
        .content(id(n))
        .await
        .expect("the content is readable")
        .revision
}

async fn text(store: &dyn WorkspaceStore, n: u32) -> String {
    store
        .content(id(n))
        .await
        .expect("the content is readable")
        .markdown
        .into_string()
}

/// The tree as (parent, identifier, title) in pre-order.
fn shape(items: &[WorkspaceItem]) -> Vec<(Option<ItemId>, ItemId, String)> {
    items
        .iter()
        .map(|item| {
            (
                item.parent_id.clone(),
                item.id.clone(),
                item.title.as_str().to_owned(),
            )
        })
        .collect()
}

async fn ids(store: &dyn WorkspaceStore) -> Vec<(Option<ItemId>, ItemId)> {
    store
        .workspace()
        .await
        .expect("the tree is readable")
        .into_iter()
        .map(|item| (item.parent_id, item.id))
        .collect()
}

fn top(n: u32) -> (Option<ItemId>, ItemId) {
    (None, id(n))
}

fn under(parent: u32, n: u32) -> (Option<ItemId>, ItemId) {
    (Some(id(parent)), id(n))
}

macro_rules! assert_err {
    ($result:expr, $pattern:pat) => {
        match $result {
            Err($pattern) => {}
            other => panic!("expected {}, got {other:?}", stringify!($pattern)),
        }
    };
}

pub async fn a_new_store_is_empty<H: Harness>() {
    let harness = H::open().await;
    assert!(harness.store().workspace().await.unwrap().is_empty());
}

pub async fn creates_each_kind_at_the_top_level<H: Harness>() {
    let harness = H::open().await;
    let store = harness.store();
    let folder = new_folder(&*store, 1, "The lighthouse", at(None, None)).await;
    let content = "The keeper climbed the stairs twice before lighting the lamp.\n";
    let document = new_document(&*store, 2, "Chapter one", at(None, None), content).await;

    assert_eq!(folder.id(), &id(1));
    assert_eq!(folder.kind(), ItemKind::Folder);
    assert_eq!(folder.parent_id(), None);
    assert_eq!(folder.title().as_str(), "The lighthouse");
    assert_eq!(document.kind(), ItemKind::Document);
    assert_eq!(document.revision(), Some(&revision_of(content.as_bytes())));

    assert_eq!(ids(&*store).await, vec![top(1), top(2)]);
    assert_eq!(store.item(id(1), ItemKind::Folder).await.unwrap(), folder);
    assert_eq!(
        store.item(id(2), ItemKind::Document).await.unwrap(),
        document
    );
    assert_eq!(text(&*store, 2).await, content);
}

pub async fn creates_inside_a_folder_before_a_sibling_and_at_the_end<H: Harness>() {
    let harness = H::open().await;
    let store = harness.store();
    new_folder(&*store, 1, "Drafts", at(None, None)).await;
    let first = new_document(&*store, 2, "First", at(Some(&id(1)), None), "").await;
    new_document(&*store, 3, "Third", at(Some(&id(1)), None), "").await;
    new_document(&*store, 4, "Second", at(Some(&id(1)), Some(&id(3))), "").await;
    new_folder(&*store, 5, "Research", at(None, Some(&id(1)))).await;
    new_folder(&*store, 6, "Nested", at(Some(&id(1)), Some(&id(2)))).await;

    assert_eq!(first.parent_id(), Some(&id(1)));
    assert_eq!(
        ids(&*store).await,
        vec![
            top(5),
            top(1),
            under(1, 6),
            under(1, 2),
            under(1, 4),
            under(1, 3)
        ]
    );
}

pub async fn a_repeated_create_returns_the_existing_item_unchanged<H: Harness>() {
    let harness = H::open().await;
    let store = harness.store();
    new_folder(&*store, 1, "Drafts", at(None, None)).await;
    new_document(&*store, 2, "Draft", at(None, None), "First words.\n").await;
    store
        .rename(id(2), ItemKind::Document, title("Renamed draft"))
        .await
        .unwrap();
    store
        .place(id(2), ItemKind::Document, at(Some(&id(1)), None))
        .await
        .unwrap();
    let base = revision(&*store, 2).await;
    store
        .replace_content(id(2), markdown("Later words.\n"), base)
        .await
        .unwrap();

    let replay = NewItem::document(
        id(2),
        title("Draft"),
        at(None, None),
        markdown("First words.\n"),
        Language::Es,
    );
    let created = store.create(replay).await.unwrap();
    let Created::Existing(Item::Document(document)) = created else {
        panic!("expected the existing document, got {created:?}");
    };
    assert_eq!(document.title.as_str(), "Renamed draft");
    assert_eq!(document.parent_id, Some(id(1)));
    assert_eq!(document.revision, revision_of(b"Later words.\n"));
    assert_eq!(text(&*store, 2).await, "Later words.\n");

    let created = store
        .create(NewItem::folder(
            id(1),
            title("Other"),
            at(Some(&id(9)), None),
        ))
        .await
        .unwrap();
    assert!(!created.is_new());
    assert_eq!(created.item().title().as_str(), "Drafts");
    assert_eq!(ids(&*store).await, vec![top(1), under(1, 2)]);
}

pub async fn a_create_reusing_an_identifier_of_the_other_kind_conflicts<H: Harness>() {
    let harness = H::open().await;
    let store = harness.store();
    new_folder(&*store, 1, "Drafts", at(None, None)).await;
    new_document(&*store, 2, "Draft", at(None, None), "").await;
    assert_err!(
        store
            .create(NewItem::document(
                id(1),
                title("Draft"),
                at(None, None),
                markdown(""),
                Language::default(),
            ))
            .await,
        StoreError::Conflict(Conflict::OtherKind)
    );
    assert_err!(
        store
            .create(NewItem::folder(id(2), title("Drafts"), at(None, None)))
            .await,
        StoreError::Conflict(Conflict::OtherKind)
    );
    assert_eq!(ids(&*store).await, vec![top(1), top(2)]);
}

pub async fn creates_conflict_with_a_missing_parent_or_sibling<H: Harness>() {
    let harness = H::open().await;
    let store = harness.store();
    new_folder(&*store, 1, "Drafts", at(None, None)).await;
    new_document(&*store, 2, "Draft", at(Some(&id(1)), None), "").await;
    new_document(&*store, 3, "Notes", at(None, None), "").await;
    let attempt = |placement| store.create(NewItem::folder(id(9), title("New"), placement));
    assert_err!(
        attempt(at(Some(&id(8)), None)).await,
        StoreError::Conflict(Conflict::MissingParent)
    );
    assert_err!(
        attempt(at(Some(&id(3)), None)).await,
        StoreError::Conflict(Conflict::MissingParent)
    );
    assert_err!(
        attempt(at(None, Some(&id(8)))).await,
        StoreError::Conflict(Conflict::MissingSibling)
    );
    assert_err!(
        attempt(at(None, Some(&id(2)))).await,
        StoreError::Conflict(Conflict::MissingSibling)
    );
    assert_eq!(ids(&*store).await, vec![top(1), under(1, 2), top(3)]);
}

pub async fn moves_between_folders<H: Harness>() {
    let harness = H::open().await;
    let store = harness.store();
    new_folder(&*store, 1, "Drafts", at(None, None)).await;
    new_folder(&*store, 2, "Archive", at(None, None)).await;
    new_document(
        &*store,
        3,
        "Chapter",
        at(Some(&id(1)), None),
        "The tide turned.\n",
    )
    .await;
    let before = revision(&*store, 3).await;

    let moved = store
        .place(id(3), ItemKind::Document, at(Some(&id(2)), None))
        .await
        .unwrap();
    assert_eq!(moved.parent_id(), Some(&id(2)));
    assert_eq!(moved.revision(), Some(&before));
    assert_eq!(text(&*store, 3).await, "The tide turned.\n");

    let moved = store
        .place(id(2), ItemKind::Folder, at(Some(&id(1)), None))
        .await
        .unwrap();
    assert_eq!(moved.parent_id(), Some(&id(1)));
    assert_eq!(ids(&*store).await, vec![top(1), under(1, 2), under(2, 3)]);

    store
        .place(id(3), ItemKind::Document, at(None, Some(&id(1))))
        .await
        .unwrap();
    assert_eq!(ids(&*store).await, vec![top(3), top(1), under(1, 2)]);
    assert_eq!(text(&*store, 3).await, "The tide turned.\n");
}

pub async fn reorders_within_a_parent<H: Harness>() {
    let harness = H::open().await;
    let store = harness.store();
    new_document(&*store, 1, "One", at(None, None), "").await;
    new_folder(&*store, 2, "Two", at(None, None)).await;
    new_document(&*store, 3, "Three", at(None, None), "").await;

    store
        .place(id(3), ItemKind::Document, at(None, Some(&id(1))))
        .await
        .unwrap();
    assert_eq!(ids(&*store).await, vec![top(3), top(1), top(2)]);
    store
        .place(id(3), ItemKind::Document, at(None, None))
        .await
        .unwrap();
    assert_eq!(ids(&*store).await, vec![top(1), top(2), top(3)]);
    store
        .place(id(2), ItemKind::Folder, at(None, Some(&id(1))))
        .await
        .unwrap();
    assert_eq!(ids(&*store).await, vec![top(2), top(1), top(3)]);
    // Before the next sibling is where it already is.
    store
        .place(id(1), ItemKind::Document, at(None, Some(&id(3))))
        .await
        .unwrap();
    assert_eq!(ids(&*store).await, vec![top(2), top(1), top(3)]);
}

pub async fn a_move_before_itself_changes_nothing<H: Harness>() {
    let harness = H::open().await;
    let store = harness.store();
    new_folder(&*store, 1, "Drafts", at(None, None)).await;
    new_document(&*store, 2, "One", at(Some(&id(1)), None), "").await;
    new_document(&*store, 3, "Two", at(Some(&id(1)), None), "").await;
    let item = store
        .place(id(2), ItemKind::Document, at(Some(&id(1)), Some(&id(2))))
        .await
        .unwrap();
    assert_eq!(item.parent_id(), Some(&id(1)));
    assert_eq!(ids(&*store).await, vec![top(1), under(1, 2), under(1, 3)]);
    assert_err!(
        store
            .place(id(2), ItemKind::Document, at(None, Some(&id(2))))
            .await,
        StoreError::Conflict(Conflict::MissingSibling)
    );
}

pub async fn moves_conflict_with_a_missing_parent_or_sibling<H: Harness>() {
    let harness = H::open().await;
    let store = harness.store();
    new_folder(&*store, 1, "Drafts", at(None, None)).await;
    new_document(&*store, 2, "Draft", at(Some(&id(1)), None), "").await;
    new_document(&*store, 3, "Notes", at(None, None), "").await;
    let attempt = |placement| store.place(id(3), ItemKind::Document, placement);
    assert_err!(
        attempt(at(Some(&id(8)), None)).await,
        StoreError::Conflict(Conflict::MissingParent)
    );
    assert_err!(
        attempt(at(Some(&id(2)), None)).await,
        StoreError::Conflict(Conflict::MissingParent)
    );
    assert_err!(
        attempt(at(None, Some(&id(8)))).await,
        StoreError::Conflict(Conflict::MissingSibling)
    );
    assert_err!(
        attempt(at(None, Some(&id(2)))).await,
        StoreError::Conflict(Conflict::MissingSibling)
    );
    assert_eq!(ids(&*store).await, vec![top(1), under(1, 2), top(3)]);
}

pub async fn a_folder_cannot_move_into_itself_or_a_descendant<H: Harness>() {
    let harness = H::open().await;
    let store = harness.store();
    new_folder(&*store, 1, "Book", at(None, None)).await;
    new_folder(&*store, 2, "Part", at(Some(&id(1)), None)).await;
    new_folder(&*store, 3, "Chapter", at(Some(&id(2)), None)).await;
    for parent in [1, 2, 3] {
        assert_err!(
            store
                .place(id(1), ItemKind::Folder, at(Some(&id(parent)), None))
                .await,
            StoreError::Conflict(Conflict::Cycle)
        );
    }
    assert_eq!(ids(&*store).await, vec![top(1), under(1, 2), under(2, 3)]);
}

pub async fn the_depth_limit_reaches_the_store<H: Harness>() {
    let harness = H::open().await;
    let store = harness.store();
    let mut parent = None;
    for n in 1..=16 {
        new_folder(&*store, n, &format!("Level {n}"), at(parent.as_ref(), None)).await;
        parent = Some(id(n));
    }
    new_document(&*store, 100, "Deepest", at(Some(&id(15)), None), "").await;
    assert_err!(
        store
            .create(NewItem::document(
                id(101),
                title("Too deep"),
                at(Some(&id(16)), None),
                markdown(""),
                Language::default(),
            ))
            .await,
        StoreError::Invalid(Violation::DepthLimit)
    );

    new_folder(&*store, 200, "Box", at(None, None)).await;
    new_folder(&*store, 201, "Inner box", at(Some(&id(200)), None)).await;
    assert!(
        store
            .place(id(200), ItemKind::Folder, at(Some(&id(14)), None))
            .await
            .is_ok()
    );
    assert_err!(
        store
            .place(id(200), ItemKind::Folder, at(Some(&id(15)), None))
            .await,
        StoreError::Invalid(Violation::DepthLimit)
    );
    assert_eq!(store.workspace().await.unwrap().len(), 19);
}

pub async fn missing_items_and_the_other_kind_are_not_found<H: Harness>() {
    let harness = H::open().await;
    let store = harness.store();
    new_folder(&*store, 1, "Drafts", at(None, None)).await;
    new_document(&*store, 2, "Draft", at(None, None), "Words.\n").await;
    let base = revision(&*store, 2).await;
    for (n, kind) in [
        (9, ItemKind::Folder),
        (9, ItemKind::Document),
        (1, ItemKind::Document),
        (2, ItemKind::Folder),
    ] {
        assert_err!(store.item(id(n), kind).await, StoreError::NotFound);
        assert_err!(
            store.rename(id(n), kind, title("New")).await,
            StoreError::NotFound
        );
        assert_err!(
            store.place(id(n), kind, at(None, None)).await,
            StoreError::NotFound
        );
        assert_err!(store.delete(id(n), kind).await, StoreError::NotFound);
    }
    for n in [1, 9] {
        assert_err!(store.content(id(n)).await, StoreError::NotFound);
        assert_err!(
            store
                .replace_content(id(n), markdown("Other.\n"), base.clone())
                .await,
            StoreError::NotFound
        );
        assert_err!(
            store.replace_language(id(n), Language::Es).await,
            StoreError::NotFound
        );
    }
    assert_eq!(ids(&*store).await, vec![top(1), top(2)]);
}

pub async fn renaming_keeps_the_identifier_and_revision<H: Harness>() {
    let harness = H::open().await;
    let store = harness.store();
    new_folder(&*store, 1, "Drafts", at(None, None)).await;
    new_document(&*store, 2, "Draft", at(Some(&id(1)), None), "Words.\n").await;
    let before = revision(&*store, 2).await;

    let renamed = store
        .rename(id(2), ItemKind::Document, title("Final"))
        .await
        .unwrap();
    assert_eq!(renamed.id(), &id(2));
    assert_eq!(renamed.title().as_str(), "Final");
    assert_eq!(renamed.parent_id(), Some(&id(1)));
    assert_eq!(renamed.revision(), Some(&before));
    let renamed = store
        .rename(id(1), ItemKind::Folder, title("Finished"))
        .await
        .unwrap();
    assert_eq!(renamed.title().as_str(), "Finished");

    let items = store.workspace().await.unwrap();
    assert_eq!(
        shape(&items),
        vec![
            (None, id(1), "Finished".into()),
            (Some(id(1)), id(2), "Final".into())
        ]
    );
    assert_eq!(revision(&*store, 2).await, before);
    assert_eq!(text(&*store, 2).await, "Words.\n");
}

/// Titles that file systems reject, reserve, fold, or normalize.
fn stress_titles() -> Vec<String> {
    vec![
        "Act 1: Arrival?".into(),
        "con".into(),
        "NUL.txt".into(),
        ".plan".into(),
        "Part I.".into(),
        "灯".repeat(200),
        "🌊 Tide 🐚".into(),
        "Cafe\u{301}".into(),
        "Caf\u{e9}".into(),
        "Notes".into(),
        "notes".into(),
        "Notes".into(),
        "NOTES".into(),
        "\u{3a3}".into(),
        "\u{3c2}".into(),
        "a<b>c:d\"e/f\\g|h?i*j".into(),
    ]
}

pub async fn stress_titles_read_back_exactly<H: Harness>() {
    let harness = H::open().await;
    let store = harness.store();
    let titles = stress_titles();
    let mut expected = Vec::new();
    let mut n = 0;
    for text_title in &titles {
        n += 1;
        new_document(
            &*store,
            n,
            text_title,
            at(None, None),
            &format!("Document {n}.\n"),
        )
        .await;
        expected.push((None, id(n), text_title.clone()));
        n += 1;
        new_folder(&*store, n, text_title, at(None, None)).await;
        expected.push((None, id(n), text_title.clone()));
    }
    // Renaming into each title, inside a folder that already holds it.
    n += 1;
    let renamed = n;
    new_document(
        &*store,
        renamed,
        "Placeholder",
        at(Some(&id(2)), None),
        "Renamed.\n",
    )
    .await;
    for text_title in &titles {
        let item = store
            .rename(id(renamed), ItemKind::Document, title(text_title))
            .await
            .unwrap();
        assert_eq!(item.title().as_str(), text_title);
    }
    expected.insert(
        2,
        (Some(id(2)), id(renamed), titles.last().unwrap().clone()),
    );

    assert_eq!(shape(&store.workspace().await.unwrap()), expected);
    for document in (1..renamed).step_by(2) {
        assert_eq!(
            text(&*store, document).await,
            format!("Document {document}.\n")
        );
    }
    drop(store);
    let harness = harness.reopen().await;
    let store = harness.store();
    assert_eq!(shape(&store.workspace().await.unwrap()), expected);
    assert_eq!(text(&*store, renamed).await, "Renamed.\n");
}

pub async fn content_round_trips_byte_for_byte<H: Harness>() {
    let harness = H::open().await;
    let store = harness.store();
    let contents = [
        String::new(),
        "x".repeat(MAX_CONTENT_BYTES),
        "Line one\r\nLine two\r\n".into(),
        "Cafe\u{301} au lait, nai\u{308}ve\n".into(),
        "\u{feff}# Heading\n\nA paragraph without a final newline".into(),
        "Mixed\nendings\r\nand\rreturns".into(),
    ];
    for (n, content) in (1..).zip(&contents) {
        let created = new_document(&*store, n, "Sample", at(None, None), content).await;
        assert_eq!(created.revision(), Some(&revision_of(content.as_bytes())));
        assert_eq!(&text(&*store, n).await, content);
    }
    // Saving each content over another one stores it exactly too.
    let last = contents.len() as u32;
    for content in contents.iter().rev() {
        let base = revision(&*store, last).await;
        let saved = store
            .replace_content(id(last), markdown(content), base)
            .await
            .unwrap();
        assert_eq!(saved.revision, revision_of(content.as_bytes()));
        assert_eq!(&text(&*store, last).await, content);
    }
}

pub async fn saving_follows_the_stale_write_rule<H: Harness>() {
    let harness = H::open().await;
    let store = harness.store();
    new_document(&*store, 1, "Chapter", at(None, None), "").await;
    let empty = revision(&*store, 1).await;

    let first = "The keeper climbed the stairs twice before lighting the lamp.\n";
    let saved = store
        .replace_content(id(1), markdown(first), empty.clone())
        .await
        .unwrap();
    assert_eq!(saved.id, id(1));
    assert_eq!(saved.title.as_str(), "Chapter");
    assert_eq!(saved.revision, revision_of(first.as_bytes()));

    // A stale base with different content changes nothing.
    assert_err!(
        store
            .replace_content(
                id(1),
                markdown("The keeper waited for the tide.\n"),
                empty.clone()
            )
            .await,
        StoreError::Conflict(Conflict::StaleRevision)
    );
    assert_eq!(text(&*store, 1).await, first);

    // Identical content succeeds whatever the base.
    for base in [
        empty,
        Revision::new("not-a-revision"),
        saved.revision.clone(),
    ] {
        let again = store
            .replace_content(id(1), markdown(first), base)
            .await
            .unwrap();
        assert_eq!(again.revision, saved.revision);
    }
    assert_eq!(text(&*store, 1).await, first);
}

pub async fn concurrent_saves_from_one_base_let_exactly_one_succeed<H: Harness>() {
    let harness = H::open().await;
    let store = harness.store();
    new_document(&*store, 1, "Chapter", at(None, None), "Base.\n").await;
    let base = revision(&*store, 1).await;

    let mut saves = tokio::task::JoinSet::new();
    for n in 0..8 {
        let (store, base) = (store.clone(), base.clone());
        saves.spawn(async move {
            let content = format!("Version {n}.\n");
            let result = store.replace_content(id(1), markdown(&content), base).await;
            (content, result)
        });
    }
    let mut winners = Vec::new();
    while let Some(joined) = saves.join_next().await {
        let (content, result) = joined.unwrap();
        match result {
            Ok(_) => winners.push(content),
            Err(StoreError::Conflict(Conflict::StaleRevision)) => {}
            Err(other) => panic!("unexpected error {other:?}"),
        }
    }
    assert_eq!(winners.len(), 1, "{winners:?}");
    assert_eq!(text(&*store, 1).await, winners[0]);

    let base = revision(&*store, 1).await;
    let mut saves = tokio::task::JoinSet::new();
    for _ in 0..8 {
        let (store, base) = (store.clone(), base.clone());
        saves.spawn(async move {
            store
                .replace_content(id(1), markdown("Same.\n"), base)
                .await
        });
    }
    while let Some(joined) = saves.join_next().await {
        assert_eq!(joined.unwrap().unwrap().revision, revision_of(b"Same.\n"));
    }
}

pub async fn revisions_change_exactly_when_content_changes<H: Harness>() {
    let harness = H::open().await;
    let store = harness.store();
    new_folder(&*store, 1, "Drafts", at(None, None)).await;
    let created = new_document(&*store, 2, "Draft", at(None, None), "").await;
    let empty = created.revision().unwrap().clone();
    assert_eq!(empty.as_str(), "e3b0c44298fc1c149afbf4c8996fb924");

    let a = store
        .replace_content(id(2), markdown("A.\n"), empty.clone())
        .await
        .unwrap()
        .revision;
    assert_ne!(a, empty);
    let b = store
        .replace_content(id(2), markdown("B.\n"), a.clone())
        .await
        .unwrap()
        .revision;
    assert_ne!(b, a);
    let back = store
        .replace_content(id(2), markdown("A.\n"), b)
        .await
        .unwrap()
        .revision;
    assert_eq!(back, a);

    store
        .rename(id(2), ItemKind::Document, title("Renamed"))
        .await
        .unwrap();
    store
        .place(id(2), ItemKind::Document, at(Some(&id(1)), None))
        .await
        .unwrap();
    let item = store.item(id(2), ItemKind::Document).await.unwrap();
    assert_eq!(item.revision(), Some(&a));
    assert_eq!(revision(&*store, 2).await, a);
}

pub async fn deletes_documents_and_folders_with_their_subtrees<H: Harness>() {
    let harness = H::open().await;
    let store = harness.store();
    new_folder(&*store, 1, "Book", at(None, None)).await;
    new_folder(&*store, 2, "Part", at(Some(&id(1)), None)).await;
    new_document(&*store, 3, "Chapter", at(Some(&id(2)), None), "Words.\n").await;
    new_document(&*store, 4, "Preface", at(Some(&id(1)), None), "").await;
    new_document(&*store, 5, "Notes", at(None, None), "Notes.\n").await;

    store.delete(id(5), ItemKind::Document).await.unwrap();
    assert_err!(
        store.item(id(5), ItemKind::Document).await,
        StoreError::NotFound
    );
    assert_err!(store.content(id(5)).await, StoreError::NotFound);
    assert_err!(
        store.delete(id(5), ItemKind::Document).await,
        StoreError::NotFound
    );

    store.delete(id(1), ItemKind::Folder).await.unwrap();
    assert!(store.workspace().await.unwrap().is_empty());
    for n in [2, 3, 4] {
        assert_err!(store.content(id(n)).await, StoreError::NotFound);
    }
    assert_err!(
        store.item(id(2), ItemKind::Folder).await,
        StoreError::NotFound
    );
    assert_err!(
        store.delete(id(1), ItemKind::Folder).await,
        StoreError::NotFound
    );
}

pub async fn reopening_finds_the_same_workspace<H: Harness>() {
    let harness = H::open().await;
    let store = harness.store();
    new_folder(&*store, 1, "The lighthouse", at(None, None)).await;
    new_document(
        &*store,
        2,
        "Chapter one",
        at(Some(&id(1)), None),
        "The keeper climbed.\n",
    )
    .await;
    new_folder(&*store, 3, "Drafts", at(Some(&id(1)), None)).await;
    new_document(
        &*store,
        4,
        "Notes",
        at(None, Some(&id(1))),
        "Tide tables.\n",
    )
    .await;
    new_document(
        &*store,
        5,
        "Chapter two",
        at(Some(&id(1)), Some(&id(3))),
        "",
    )
    .await;
    store
        .rename(id(3), ItemKind::Folder, title("Earlier drafts"))
        .await
        .unwrap();
    store
        .place(id(2), ItemKind::Document, at(Some(&id(3)), None))
        .await
        .unwrap();

    let before = store.workspace().await.unwrap();
    let mut contents = BTreeMap::new();
    for n in [2, 4, 5] {
        contents.insert(n, store.content(id(n)).await.unwrap());
    }
    drop(store);

    let harness = harness.reopen().await;
    let store = harness.store();
    assert_eq!(store.workspace().await.unwrap(), before);
    for (n, content) in contents {
        assert_eq!(store.content(id(n)).await.unwrap(), content);
    }
}

pub async fn document_language_defaults_updates_and_survives_changes<H: Harness>() {
    let harness = H::open().await;
    let store = harness.store();
    new_folder(&*store, 1, "Relatos", at(None, None)).await;

    let prose = "¿Quién dejó la lámpara encendida? ¡Qué silencio sobre la bahía!\n";
    let english = new_document(
        &*store,
        2,
        "Harbor",
        at(None, None),
        "Dawn over the quay.\n",
    )
    .await;
    assert_eq!(english.language(), Some(Language::En));

    let spanish = store
        .create(NewItem::document(
            id(3),
            title("Capítulo uno"),
            at(None, None),
            markdown(prose),
            Language::Es,
        ))
        .await
        .unwrap()
        .into_item();
    assert_eq!(spanish.language(), Some(Language::Es));

    let before_rev = revision(&*store, 2).await;
    let switched = store.replace_language(id(2), Language::Es).await.unwrap();
    assert_eq!(switched.id, id(2));
    assert_eq!(switched.language, Language::Es);
    assert_eq!(switched.revision, before_rev);
    assert_eq!(text(&*store, 2).await, "Dawn over the quay.\n");

    // Switching back and forth and repeating the same language is idempotent.
    let same = store.replace_language(id(2), Language::Es).await.unwrap();
    assert_eq!(same.language, Language::Es);
    assert_eq!(same.revision, before_rev);

    // Language survives rename, move, content save, and reopening the store.
    store
        .rename(id(2), ItemKind::Document, title("¿Dónde está el faro?"))
        .await
        .unwrap();
    store
        .place(id(2), ItemKind::Document, at(Some(&id(1)), None))
        .await
        .unwrap();
    let saved = store
        .replace_content(id(2), markdown(prose), before_rev)
        .await
        .unwrap();
    assert_eq!(saved.language, Language::Es);

    let items = store.workspace().await.unwrap();
    let languages: Vec<_> = items
        .iter()
        .map(|item| (item.id.clone(), item.language))
        .collect();
    assert_eq!(
        languages,
        vec![
            (id(1), None),
            (id(2), Some(Language::Es)),
            (id(3), Some(Language::Es)),
        ]
    );

    drop(store);
    let harness = harness.reopen().await;
    let store = harness.store();
    assert_eq!(
        store
            .item(id(2), ItemKind::Document)
            .await
            .unwrap()
            .language(),
        Some(Language::Es)
    );
    assert_eq!(text(&*store, 2).await, prose);
    assert_eq!(
        store
            .item(id(3), ItemKind::Document)
            .await
            .unwrap()
            .language(),
        Some(Language::Es)
    );
}

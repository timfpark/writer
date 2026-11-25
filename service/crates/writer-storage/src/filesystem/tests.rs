//! The filesystem backend's tests: the conformance suite, and the rules only
//! this backend has. Every test opens its store in its own temporary
//! directory, and every title and document is synthetic.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use serde_json::Value;
use tempfile::TempDir;
use writer_domain::{
    Conflict, ItemKind, Language, Markdown, NewItem, Placement, Title, WorkspaceItem,
};

use super::FilesystemStore;
use super::faults::{Action, Faults};
use crate::conformance::{Harness, id};
use crate::{OpenError, StoreError, Unreadable, WorkspaceStore, revision_of};

struct Fs {
    dir: TempDir,
    store: FilesystemStore,
}

impl Fs {
    fn data(&self) -> PathBuf {
        self.dir.path().join("data")
    }

    fn root(&self) -> PathBuf {
        self.data().join("workspace")
    }
}

impl Harness for Fs {
    async fn open() -> Self {
        let dir = TempDir::new().unwrap();
        let store = FilesystemStore::open(dir.path().join("data"))
            .await
            .unwrap();
        Self { dir, store }
    }

    fn store(&self) -> Arc<dyn WorkspaceStore> {
        Arc::new(self.store.clone())
    }

    async fn reopen(self) -> Self {
        let Self { dir, store } = self;
        drop(store);
        let store = FilesystemStore::open(dir.path().join("data"))
            .await
            .unwrap();
        Self { dir, store }
    }
}

mod conformance {
    use super::Fs;

    crate::conformance_tests!(Fs);
}

fn title(text: &str) -> Title {
    Title::parse(text).unwrap()
}

fn markdown(text: &str) -> Markdown {
    Markdown::parse(text).unwrap()
}

fn at(parent: Option<u32>, before: Option<u32>) -> Placement {
    Placement {
        parent_id: parent.map(id),
        before_id: before.map(id),
    }
}

async fn folder(store: &FilesystemStore, n: u32, text: &str, placement: Placement) {
    store
        .create(NewItem::folder(id(n), title(text), placement))
        .await
        .unwrap();
}

async fn document(
    store: &FilesystemStore,
    n: u32,
    text: &str,
    placement: Placement,
    content: &str,
) {
    store
        .create(NewItem::document(
            id(n),
            title(text),
            placement,
            markdown(content),
            Language::default(),
        ))
        .await
        .unwrap();
}

async fn text(store: &FilesystemStore, n: u32) -> String {
    store.content(id(n)).await.unwrap().markdown.into_string()
}

/// Every entry under `root` except `.writer/`, relative and sorted, with a
/// trailing `/` on directories.
fn on_disk(root: &Path) -> Vec<String> {
    fn walk(dir: &Path, prefix: &str, out: &mut Vec<String>) {
        for entry in fs::read_dir(dir).unwrap() {
            let entry = entry.unwrap();
            let name = entry.file_name().into_string().unwrap();
            if prefix.is_empty() && name == ".writer" {
                continue;
            }
            let path = format!("{prefix}{name}");
            if entry.file_type().unwrap().is_dir() {
                out.push(format!("{path}/"));
                walk(&entry.path(), &format!("{path}/"), out);
            } else {
                out.push(path);
            }
        }
    }
    let mut out = Vec::new();
    walk(root, "", &mut out);
    out.sort();
    out
}

fn index_json(root: &Path) -> Value {
    serde_json::from_slice(&fs::read(root.join(".writer/workspace.json")).unwrap()).unwrap()
}

fn assert_settled(root: &Path) {
    assert_eq!(index_json(root)["pending"], Value::Null);
    assert_eq!(fs::read_dir(root.join(".writer/tmp")).unwrap().count(), 0);
    assert_eq!(fs::read_dir(root.join(".writer/trash")).unwrap().count(), 0);
}

#[cfg(unix)]
fn inode(path: &Path) -> u64 {
    use std::os::unix::fs::MetadataExt;
    fs::metadata(path).unwrap().ino()
}

#[tokio::test]
async fn mirrors_the_workspace_as_directories_and_markdown_files() {
    let fs_store = Fs::open().await;
    let store = &fs_store.store;
    folder(store, 1, "The lighthouse", at(None, None)).await;
    let chapter = "The keeper climbed the stairs twice before lighting the lamp.\n";
    document(store, 2, "Chapter one", at(Some(1), None), chapter).await;
    folder(store, 3, "Drafts", at(Some(1), None)).await;
    document(store, 4, "Notes", at(None, None), "Tide tables.\n").await;

    let root = fs_store.root();
    assert_eq!(
        on_disk(&root),
        [
            "Notes.md",
            "The lighthouse/",
            "The lighthouse/Chapter one.md",
            "The lighthouse/Drafts/"
        ]
    );
    assert_eq!(
        fs::read_to_string(root.join("The lighthouse/Chapter one.md")).unwrap(),
        chapter
    );
    assert_eq!(
        fs::read_to_string(root.join("Notes.md")).unwrap(),
        "Tide tables.\n"
    );

    let index = index_json(&root);
    assert_eq!(index["format"], 1);
    let book = &index["items"][0];
    assert_eq!(book["id"], id(1).as_str());
    assert_eq!(book["kind"], "folder");
    assert_eq!(book["title"], "The lighthouse");
    assert_eq!(book["name"], "The lighthouse");
    assert_eq!(book["items"][0]["name"], "Chapter one.md");
    assert!(book["items"][0].get("items").is_none());
    assert_eq!(book["items"][1]["items"], Value::Array(Vec::new()));
    assert_eq!(index["items"][1]["id"], id(4).as_str());
    assert!(root.join(".writer/lock").is_file());
    assert_settled(&root);
}

#[tokio::test]
async fn creates_the_data_folder_on_first_use() {
    let dir = TempDir::new().unwrap();
    let data = dir.path().join("not/yet/here");
    let store = FilesystemStore::open(&data).await.unwrap();
    assert_eq!(store.data_dir(), data);
    assert!(data.join("workspace/.writer/workspace.json").is_file());
    assert!(store.workspace().await.unwrap().is_empty());
}

#[tokio::test]
async fn names_colliding_titles_with_numbered_suffixes() {
    let fs_store = Fs::open().await;
    let store = &fs_store.store;
    let root = fs_store.root();
    for (n, text) in [(1, "Notes"), (2, "notes"), (3, "Notes"), (4, "NOTES")] {
        document(store, n, text, at(None, None), &format!("Note {n}.\n")).await;
    }
    document(store, 5, "Caf\u{e9}", at(None, None), "").await;
    document(store, 6, "Cafe\u{301}", at(None, None), "").await;
    document(store, 7, "\u{3a3}", at(None, None), "").await;
    document(store, 8, "\u{3c2}", at(None, None), "").await;
    // Entries Writer does not list still take their names.
    fs::write(root.join("Plan"), "not markdown").unwrap();
    folder(store, 9, "plan", at(None, None)).await;
    fs::create_dir(root.join(".hidden")).unwrap();
    folder(store, 10, ".hidden", at(None, None)).await;

    assert_eq!(
        on_disk(&root),
        [
            ".hidden/",
            "Caf\u{e9} (2).md",
            "Caf\u{e9}.md",
            "NOTES (4).md",
            "Notes (3).md",
            "Notes.md",
            "Plan",
            "_hidden/",
            "notes (2).md",
            "plan (2)/",
            "\u{3a3}.md",
            "\u{3c2} (2).md",
        ]
    );
    for n in 1..=4 {
        assert_eq!(text(store, n).await, format!("Note {n}.\n"));
    }

    // A suffix never changes afterwards, and a freed name is reused.
    store.delete(id(1), ItemKind::Document).await.unwrap();
    document(store, 11, "notes", at(None, None), "").await;
    let names = on_disk(&root);
    assert!(names.contains(&"notes.md".to_owned()), "{names:?}");
    assert!(names.contains(&"notes (2).md".to_owned()), "{names:?}");
    assert!(!names.contains(&"Notes.md".to_owned()), "{names:?}");
}

#[tokio::test]
async fn maps_titles_the_file_systems_reject_and_reads_them_back_exactly() {
    let fs_store = Fs::open().await;
    let store = &fs_store.store;
    document(store, 1, "Act 1: Arrival?", at(None, None), "").await;
    document(store, 2, ".plan", at(None, None), "").await;
    document(store, 3, "Con", at(None, None), "").await;
    folder(store, 4, "Part I.", at(None, None)).await;
    assert_eq!(
        on_disk(&fs_store.root()),
        ["Act 1_ Arrival_.md", "Con_.md", "Part I_/", "_plan.md"]
    );

    let fs_store = fs_store.reopen().await;
    let titles: Vec<String> = fs_store
        .store
        .workspace()
        .await
        .unwrap()
        .into_iter()
        .map(|item| item.title.into_string())
        .collect();
    assert_eq!(titles, ["Act 1: Arrival?", ".plan", "Con", "Part I."]);
}

#[cfg(unix)]
#[tokio::test]
async fn renames_on_disk_only_when_the_name_changes() {
    let fs_store = Fs::open().await;
    let store = &fs_store.store;
    let root = fs_store.root();
    document(store, 1, "Act 1: Arrival?", at(None, None), "Words.\n").await;
    let original = inode(&root.join("Act 1_ Arrival_.md"));

    // Both titles map to the same name, so only the index changes.
    store
        .rename(id(1), ItemKind::Document, title("Act 1| Arrival*"))
        .await
        .unwrap();
    assert_eq!(on_disk(&root), ["Act 1_ Arrival_.md"]);
    assert_eq!(index_json(&root)["items"][0]["title"], "Act 1| Arrival*");

    store
        .rename(id(1), ItemKind::Document, title("Notes"))
        .await
        .unwrap();
    assert_eq!(on_disk(&root), ["Notes.md"]);
    assert_eq!(inode(&root.join("Notes.md")), original);

    // A case-only rename renames the file, on case-insensitive file systems
    // too.
    store
        .rename(id(1), ItemKind::Document, title("notes"))
        .await
        .unwrap();
    assert_eq!(on_disk(&root), ["notes.md"]);
    assert_eq!(inode(&root.join("notes.md")), original);
    assert_eq!(text(store, 1).await, "Words.\n");
    assert_settled(&root);
}

#[tokio::test]
async fn moves_carry_subtrees_and_take_the_next_free_name() {
    let fs_store = Fs::open().await;
    let store = &fs_store.store;
    let root = fs_store.root();
    folder(store, 1, "Drafts", at(None, None)).await;
    folder(store, 2, "Archive", at(None, None)).await;
    document(store, 3, "Chapter", at(Some(1), None), "Draft chapter.\n").await;
    document(
        store,
        4,
        "Chapter",
        at(Some(2), None),
        "Archived chapter.\n",
    )
    .await;
    folder(store, 5, "Notes", at(Some(1), None)).await;
    document(store, 6, "Idea", at(Some(5), None), "An idea.\n").await;

    store
        .place(id(3), ItemKind::Document, at(Some(2), None))
        .await
        .unwrap();
    store
        .place(id(5), ItemKind::Folder, at(Some(2), Some(4)))
        .await
        .unwrap();
    assert_eq!(
        on_disk(&root),
        [
            "Archive/",
            "Archive/Chapter (2).md",
            "Archive/Chapter.md",
            "Archive/Notes/",
            "Archive/Notes/Idea.md",
            "Drafts/",
        ]
    );
    assert_eq!(text(store, 3).await, "Draft chapter.\n");
    assert_eq!(text(store, 6).await, "An idea.\n");
    assert_settled(&root);
}

#[tokio::test]
async fn reads_edits_made_outside_writer_and_never_overwrites_them() {
    let fs_store = Fs::open().await;
    let store = &fs_store.store;
    document(store, 1, "Chapter", at(None, None), "Old words.\n").await;
    let base = store.content(id(1)).await.unwrap().revision;

    let path = fs_store.root().join("Chapter.md");
    fs::write(&path, "Words from another editor.\n").unwrap();
    let content = store.content(id(1)).await.unwrap();
    assert_eq!(content.markdown.as_str(), "Words from another editor.\n");
    assert_eq!(
        content.revision,
        revision_of(b"Words from another editor.\n")
    );
    let item = store.item(id(1), ItemKind::Document).await.unwrap();
    assert_eq!(item.revision(), Some(&content.revision));

    let saved = store
        .replace_content(id(1), markdown("Writer's words.\n"), base)
        .await;
    assert!(
        matches!(saved, Err(StoreError::Conflict(Conflict::StaleRevision))),
        "{saved:?}"
    );
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        "Words from another editor.\n"
    );
}

#[tokio::test]
async fn an_outside_edit_during_a_save_is_not_overwritten() {
    let dir = TempDir::new().unwrap();
    let faults = Arc::new(Faults::default());
    let store = FilesystemStore::open_with_faults(dir.path(), faults.clone())
        .await
        .unwrap();
    document(&store, 1, "Chapter", at(None, None), "Old words.\n").await;
    let base = store.content(id(1)).await.unwrap().revision;
    let path = dir.path().join("workspace/Chapter.md");

    // One outside write between the check and the replacement: the save
    // starts again, finds the new text, and reports a conflict.
    let once = AtomicUsize::new(0);
    let hooked = path.clone();
    faults.hook("save.recheck", move || {
        if once.fetch_add(1, Ordering::SeqCst) == 0 {
            fs::write(&hooked, "Outside words.\n").unwrap();
        }
    });
    let saved = store
        .replace_content(id(1), markdown("Writer's words.\n"), base.clone())
        .await;
    assert!(
        matches!(saved, Err(StoreError::Conflict(Conflict::StaleRevision))),
        "{saved:?}"
    );
    assert_eq!(fs::read_to_string(&path).unwrap(), "Outside words.\n");

    // A program that keeps writing makes the save give up with a conflict.
    faults.clear_hooks();
    let base = store.content(id(1)).await.unwrap().revision;
    let count = Arc::new(AtomicUsize::new(0));
    let (hooked, counter) = (path.clone(), count.clone());
    faults.hook("save.recheck", move || {
        let n = counter.fetch_add(1, Ordering::SeqCst);
        fs::write(&hooked, format!("Outside words {n}.\n")).unwrap();
    });
    let saved = store
        .replace_content(id(1), markdown("Writer's words.\n"), base)
        .await;
    assert!(
        matches!(saved, Err(StoreError::Conflict(Conflict::StaleRevision))),
        "{saved:?}"
    );
    assert_eq!(count.load(Ordering::SeqCst), 1);
    assert_eq!(fs::read_to_string(&path).unwrap(), "Outside words 0.\n");

    // Rewriting identical bytes is not an edit; the save goes ahead.
    faults.clear_hooks();
    let base = store.content(id(1)).await.unwrap().revision;
    let hooked = path.clone();
    faults.hook("save.recheck", move || {
        let same = fs::read(&hooked).unwrap();
        fs::write(&hooked, same).unwrap();
    });
    store
        .replace_content(id(1), markdown("Writer's words.\n"), base)
        .await
        .unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "Writer's words.\n");
}

#[tokio::test]
async fn adopts_entries_added_outside_writer_after_existing_ones() {
    let fs_store = Fs::open().await;
    let store = &fs_store.store;
    let root = fs_store.root();
    document(store, 1, "Existing", at(None, None), "").await;
    fs::create_dir(root.join("Research")).unwrap();
    fs::write(root.join("Research/Idea.md"), "A synthetic idea.\n").unwrap();
    fs::write(root.join("Loose.MD"), "Loose notes.\n").unwrap();
    fs::write(root.join("Act 1_ Arrival_.md"), "").unwrap();
    fs::write(root.join(" spaced\u{3000}.md"), "").unwrap();

    let items = store.workspace().await.unwrap();
    let shape: Vec<_> = items
        .iter()
        .map(|item| (item.kind, item.parent_id.is_some(), item.title.as_str()))
        .collect();
    assert_eq!(
        shape,
        [
            (ItemKind::Document, false, "Existing"),
            (ItemKind::Document, false, "spaced"),
            (ItemKind::Document, false, "Act 1_ Arrival_"),
            (ItemKind::Document, false, "Loose"),
            (ItemKind::Folder, false, "Research"),
            (ItemKind::Document, true, "Idea"),
        ]
    );
    for item in &items[1..] {
        // Lowercase version 4 identifiers.
        assert_eq!(item.id.as_str().as_bytes()[14], b'4', "{}", item.id);
    }
    assert_eq!(items[5].parent_id.as_ref(), Some(&items[4].id));
    assert_eq!(
        store
            .content(items[5].id.clone())
            .await
            .unwrap()
            .markdown
            .as_str(),
        "A synthetic idea.\n"
    );

    // Adopted identifiers are recorded and stay stable.
    assert_eq!(store.workspace().await.unwrap(), items);
    let fs_store = fs_store.reopen().await;
    assert_eq!(fs_store.store.workspace().await.unwrap(), items);
}

#[tokio::test]
async fn drops_entries_removed_or_renamed_outside_writer() {
    let fs_store = Fs::open().await;
    let store = &fs_store.store;
    let root = fs_store.root();
    folder(store, 1, "Drafts", at(None, None)).await;
    document(store, 2, "Chapter", at(Some(1), None), "Words.\n").await;
    document(store, 3, "Notes", at(None, None), "Notes.\n").await;
    document(store, 4, "Scene", at(None, None), "Scene.\n").await;
    let base = store.content(id(3)).await.unwrap().revision;

    fs::remove_dir_all(root.join("Drafts")).unwrap();
    fs::remove_file(root.join("Notes.md")).unwrap();
    fs::rename(root.join("Scene.md"), root.join("Moved scene.md")).unwrap();

    // Reading a document notices without a tree read.
    assert!(matches!(
        store.content(id(2)).await,
        Err(StoreError::NotFound)
    ));
    assert!(matches!(
        store
            .replace_content(id(3), markdown("Other.\n"), base)
            .await,
        Err(StoreError::NotFound)
    ));
    let items = store.workspace().await.unwrap();
    assert_eq!(items.len(), 1);
    assert_ne!(
        items[0].id,
        id(4),
        "a file renamed outside Writer returns as a new item"
    );
    assert_eq!(items[0].title.as_str(), "Moved scene");
    assert!(matches!(
        store.item(id(1), ItemKind::Folder).await,
        Err(StoreError::NotFound)
    ));
}

#[cfg(unix)]
#[tokio::test]
async fn skips_and_keeps_hidden_linked_and_non_markdown_entries() {
    let fs_store = Fs::open().await;
    let store = &fs_store.store;
    let root = fs_store.root();
    folder(store, 1, "Drafts", at(None, None)).await;
    document(store, 2, "Chapter", at(Some(1), None), "Words.\n").await;
    fs::create_dir(root.join(".git")).unwrap();
    fs::write(root.join(".git/HEAD"), "ref: synthetic\n").unwrap();
    fs::write(root.join("Drafts/cover.png"), [0x89, b'P', b'N', b'G']).unwrap();
    fs::write(root.join("Drafts/notes.txt"), "plain text\n").unwrap();
    fs::write(root.join(".DS_Store"), "").unwrap();
    std::os::unix::fs::symlink(root.join("Drafts/Chapter.md"), root.join("Link.md")).unwrap();
    std::os::unix::fs::symlink(root.join("Drafts"), root.join("Linked folder")).unwrap();

    let items = store.workspace().await.unwrap();
    let ids: Vec<_> = items.iter().map(|item| item.id.clone()).collect();
    assert_eq!(ids, [id(1), id(2)]);
    assert_eq!(
        fs::read_to_string(root.join(".git/HEAD")).unwrap(),
        "ref: synthetic\n"
    );
    assert!(root.join("Drafts/cover.png").is_file());
    assert!(root.join("Link.md").is_symlink());
    assert!(root.join("Linked folder").is_symlink());

    // Deleting a folder deletes what it holds, listed or not.
    store.delete(id(1), ItemKind::Folder).await.unwrap();
    assert!(!root.join("Drafts").exists());
    assert_settled(&root);
}

#[tokio::test]
async fn leaves_entries_beyond_the_depth_limit_unlisted_and_untouched() {
    let fs_store = Fs::open().await;
    let root = fs_store.root();
    let mut deepest = root.clone();
    for level in 1..=18 {
        deepest.push(format!("Level {level:02}"));
    }
    fs::create_dir_all(&deepest).unwrap();
    fs::write(deepest.join("Bottom.md"), "Deep words.\n").unwrap();
    fs::write(deepest.parent().unwrap().join("Seventeen.md"), "").unwrap();
    fs::write(root.join("Level 01/Level 02/Shallow.md"), "").unwrap();

    let items = fs_store.store.workspace().await.unwrap();
    let folders = items
        .iter()
        .filter(|item| item.kind == ItemKind::Folder)
        .count();
    assert_eq!(folders, 16);
    assert_eq!(items.len(), 17);
    assert_eq!(
        fs::read_to_string(deepest.join("Bottom.md")).unwrap(),
        "Deep words.\n"
    );
}

#[tokio::test]
async fn rebuilds_a_missing_index_from_the_directories() {
    let fs_store = Fs::open().await;
    let store = &fs_store.store;
    folder(store, 1, "Drafts", at(None, None)).await;
    document(store, 2, "Act 1: Arrival?", at(Some(1), None), "Arrival.\n").await;
    let root = fs_store.root();
    let fs_store = {
        let Fs { dir, store } = fs_store;
        drop(store);
        fs::remove_file(root.join(".writer/workspace.json")).unwrap();
        Fs {
            store: FilesystemStore::open(dir.path().join("data"))
                .await
                .unwrap(),
            dir,
        }
    };
    let items = fs_store.store.workspace().await.unwrap();
    let titles: Vec<_> = items.iter().map(|item| item.title.as_str()).collect();
    assert_eq!(titles, ["Drafts", "Act 1_ Arrival_"]);
    assert_ne!(items[0].id, id(1));
    let content = fs_store.store.content(items[1].id.clone()).await.unwrap();
    assert_eq!(content.markdown.as_str(), "Arrival.\n");
    assert!(root.join(".writer/workspace.json").is_file());
}

#[tokio::test]
async fn refuses_an_index_it_cannot_read_and_leaves_it_alone() {
    let dir = TempDir::new().unwrap();
    let data = dir.path().join("data");
    drop(FilesystemStore::open(&data).await.unwrap());
    let index = data.join("workspace/.writer/workspace.json");

    for (contents, newer) in [
        (r#"{"format": 2, "items": [], "pending": null}"#, true),
        ("{ not json", false),
        (
            r#"{"format": 1, "items": [{"id": "not-a-uuid", "kind": "document", "title": "A", "name": "A.md"}], "pending": null}"#,
            false,
        ),
        (
            r#"{"format": 1, "items": [{"id": "c0f0a000-0000-4000-8000-000000000001", "kind": "document", "title": "A", "name": "../A.md"}], "pending": null}"#,
            false,
        ),
        (
            r#"{"format": 1, "items": [{"id": "c0f0a000-0000-4000-8000-000000000001", "kind": "document", "title": "A", "name": "A.md", "language": "fr"}], "pending": null}"#,
            false,
        ),
        (
            r#"{"format": 1, "items": [{"id": "c0f0a000-0000-4000-8000-000000000001", "kind": "folder", "title": "A", "name": "A", "language": "en", "items": []}], "pending": null}"#,
            false,
        ),
        (r#"{"format": 0, "items": [], "pending": null}"#, false),
    ] {
        fs::write(&index, contents).unwrap();
        let error = FilesystemStore::open(&data)
            .await
            .err()
            .expect("the open fails");
        match error {
            OpenError::NewerIndex { path, format } => {
                assert!(newer);
                assert_eq!(path, index);
                assert_eq!(format, 2);
            }
            OpenError::InvalidIndex { path } => {
                assert!(!newer);
                assert_eq!(path, index);
            }
            other => panic!("unexpected {other:?}"),
        }
        assert!(error_names_the_file(&index, &data).await);
        assert_eq!(fs::read_to_string(&index).unwrap(), contents);
    }
}

async fn error_names_the_file(index: &Path, data: &Path) -> bool {
    let message = FilesystemStore::open(data).await.err().unwrap().to_string();
    message.contains(&index.display().to_string())
}

#[tokio::test]
async fn a_second_store_cannot_open_the_same_folder() {
    let dir = TempDir::new().unwrap();
    let data = dir.path().join("data");
    let first = FilesystemStore::open(&data).await.unwrap();
    let error = FilesystemStore::open(&data)
        .await
        .err()
        .expect("the folder is locked");
    assert!(
        matches!(&error, OpenError::Locked { path } if path == &data),
        "{error:?}"
    );
    assert!(error.to_string().contains(&data.display().to_string()));
    drop(first);
    FilesystemStore::open(&data).await.unwrap();
}

#[tokio::test]
async fn lists_unreadable_content_but_does_not_serve_it() {
    let fs_store = Fs::open().await;
    let store = &fs_store.store;
    let root = fs_store.root();
    fs::write(root.join("Big.md"), vec![b'x'; 1_048_577]).unwrap();
    fs::write(root.join("Latin.md"), [b'c', b'a', b'f', 0xe9]).unwrap();
    fs::write(root.join("Zero.md"), "before\0after").unwrap();

    let items = store.workspace().await.unwrap();
    assert_eq!(items.len(), 3);
    for (item, reason) in items.iter().zip([
        Unreadable::TooLarge,
        Unreadable::NotUtf8,
        Unreadable::ContainsNul,
    ]) {
        let read = store.content(item.id.clone()).await;
        assert!(
            matches!(read, Err(StoreError::Unreadable { reason: r, .. }) if r == reason),
            "{read:?}"
        );
        let revision = store
            .item(item.id.clone(), ItemKind::Document)
            .await
            .unwrap()
            .revision()
            .cloned()
            .unwrap();
        let saved = store
            .replace_content(item.id.clone(), markdown("Fixed.\n"), revision)
            .await;
        assert!(
            matches!(saved, Err(StoreError::Unreadable { reason: r, .. }) if r == reason),
            "{saved:?}"
        );
        store
            .delete(item.id.clone(), ItemKind::Document)
            .await
            .unwrap();
    }
    assert!(on_disk(&root).is_empty());
}

/// The tree, every document's content, and every name on disk.
#[derive(Debug, PartialEq, Eq)]
struct Snapshot {
    items: Vec<WorkspaceItem>,
    contents: BTreeMap<String, String>,
    disk: Vec<String>,
}

async fn snapshot(store: &FilesystemStore, root: &Path) -> Snapshot {
    let items = store.workspace().await.unwrap();
    let mut contents = BTreeMap::new();
    for item in &items {
        if item.kind == ItemKind::Document {
            let content = store.content(item.id.clone()).await.unwrap();
            contents.insert(item.id.to_string(), content.markdown.into_string());
        }
    }
    Snapshot {
        items,
        contents,
        disk: on_disk(root),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_interrupted_save_leaves_the_previous_content() {
    let old = "The keeper waited for the tide.\n";
    let new = "The keeper climbed the stairs twice before lighting the lamp.\n";
    let open = |faults: Arc<Faults>| async move {
        let dir = TempDir::new().unwrap();
        let store = FilesystemStore::open_with_faults(dir.path(), faults)
            .await
            .unwrap();
        document(&store, 1, "Chapter", at(None, None), old).await;
        let base = store.content(id(1)).await.unwrap().revision;
        (dir, store, base)
    };

    let faults = Arc::new(Faults::default());
    let (_dir, store, base) = open(faults.clone()).await;
    faults.record();
    store
        .replace_content(id(1), markdown(new), base)
        .await
        .unwrap();
    let steps = faults.trace();
    let rename = steps
        .iter()
        .position(|step| *step == "save.rename")
        .unwrap()
        + 1;

    for action in [Action::Fail, Action::Crash] {
        for at_step in 1..=steps.len() {
            let faults = Arc::new(Faults::default());
            let (dir, store, base) = open(faults.clone()).await;
            faults.arm(at_step, action);
            let saved = store.replace_content(id(1), markdown(new), base).await;
            assert!(saved.is_err(), "{action:?} at {}", steps[at_step - 1]);
            drop(store);

            let store = FilesystemStore::open(dir.path()).await.unwrap();
            let content = text(&store, 1).await;
            let expected = if at_step <= rename { old } else { new };
            assert_eq!(content, expected, "{action:?} at {}", steps[at_step - 1]);
            assert_settled(&dir.path().join("workspace"));
        }
    }
}

#[derive(Clone, Copy, Debug)]
enum Change {
    CreateDocument,
    CreateFolder,
    RenameDocument,
    RenameFolder,
    MoveDocument,
    MoveFolder,
    Reorder,
    ReplaceLanguage,
    DeleteDocument,
    DeleteFolder,
}

async fn seed(store: &FilesystemStore) {
    folder(store, 1, "Book", at(None, None)).await;
    document(store, 2, "Chapter", at(Some(1), None), "Chapter words.\n").await;
    folder(store, 3, "Part", at(Some(1), None)).await;
    document(store, 4, "Scene", at(Some(3), None), "Scene words.\n").await;
    folder(store, 5, "Archive", at(None, None)).await;
    document(store, 6, "Notes", at(None, None), "Notes words.\n").await;
}

async fn apply(store: &FilesystemStore, change: Change) -> Result<(), StoreError> {
    match change {
        Change::CreateDocument => store
            .create(NewItem::document(
                id(10),
                title("Prologue"),
                at(Some(1), Some(2)),
                markdown("Prologue words.\n"),
                Language::default(),
            ))
            .await
            .map(drop),
        Change::CreateFolder => store
            .create(NewItem::folder(
                id(10),
                title("Old parts"),
                at(Some(5), None),
            ))
            .await
            .map(drop),
        Change::RenameDocument => store
            .rename(id(2), ItemKind::Document, title("First chapter"))
            .await
            .map(drop),
        Change::RenameFolder => store
            .rename(id(1), ItemKind::Folder, title("Novel"))
            .await
            .map(drop),
        Change::MoveDocument => store
            .place(id(6), ItemKind::Document, at(Some(3), None))
            .await
            .map(drop),
        Change::MoveFolder => store
            .place(id(3), ItemKind::Folder, at(Some(5), None))
            .await
            .map(drop),
        Change::Reorder => store
            .place(id(6), ItemKind::Document, at(None, Some(1)))
            .await
            .map(drop),
        Change::ReplaceLanguage => store.replace_language(id(2), Language::Es).await.map(drop),
        Change::DeleteDocument => store.delete(id(2), ItemKind::Document).await,
        Change::DeleteFolder => store.delete(id(1), ItemKind::Folder).await,
    }
}

fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

async fn open_copy(template: &Path, faults: Arc<Faults>) -> (TempDir, FilesystemStore) {
    let dir = TempDir::new().unwrap();
    copy_dir(template, dir.path());
    let store = FilesystemStore::open_with_faults(dir.path(), faults)
        .await
        .unwrap();
    (dir, store)
}

/// Interrupts `change` at every step it reaches, once by failing the step and
/// once by stopping there, and requires the old or the new tree both in the
/// running store and after reopening.
async fn interrupt_at_every_step(change: Change) {
    let template = TempDir::new().unwrap();
    drop({
        let store = FilesystemStore::open(template.path()).await.unwrap();
        seed(&store).await;
        store
    });
    let faults = Arc::new(Faults::default());
    let (dir, store) = open_copy(template.path(), faults.clone()).await;
    let root = dir.path().join("workspace");
    let old = snapshot(&store, &root).await;
    faults.record();
    apply(&store, change).await.unwrap();
    let steps = faults.trace();
    let new = snapshot(&store, &root).await;
    assert_ne!(old, new);

    for action in [Action::Fail, Action::Crash] {
        for at_step in 1..=steps.len() {
            let context = format!("{action:?} at {} ({at_step})", steps[at_step - 1]);
            let faults = Arc::new(Faults::default());
            let (dir, store) = open_copy(template.path(), faults.clone()).await;
            let root = dir.path().join("workspace");
            faults.arm(at_step, action);
            let result = apply(&store, change).await;

            if let Action::Fail = action {
                let now = snapshot(&store, &root).await;
                assert!(now == old || now == new, "{context}: {now:#?}");
                if result.is_ok() {
                    assert_eq!(now, new, "{context}");
                }
                // The store keeps working, clearing any record left behind
                // before the next write.
                document(&store, 99, "Afterwards", at(None, None), "").await;
                store.delete(id(99), ItemKind::Document).await.unwrap();
                assert_eq!(snapshot(&store, &root).await, now, "{context}");
            }
            drop(store);

            let store = FilesystemStore::open(dir.path()).await.unwrap();
            let reopened = snapshot(&store, &root).await;
            assert!(
                reopened == old || reopened == new,
                "{context}: {reopened:#?}"
            );
            assert_settled(&root);
        }
    }
}

macro_rules! interrupted {
    ($($name:ident: $change:expr,)+) => {
        $(
            #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
            async fn $name() {
                interrupt_at_every_step($change).await;
            }
        )+
    };
}

interrupted! {
    an_interrupted_document_create_leaves_the_old_or_new_tree: Change::CreateDocument,
    an_interrupted_folder_create_leaves_the_old_or_new_tree: Change::CreateFolder,
    an_interrupted_document_rename_leaves_the_old_or_new_tree: Change::RenameDocument,
    an_interrupted_folder_rename_leaves_the_old_or_new_tree: Change::RenameFolder,
    an_interrupted_document_move_leaves_the_old_or_new_tree: Change::MoveDocument,
    an_interrupted_folder_move_leaves_the_old_or_new_tree: Change::MoveFolder,
    an_interrupted_reorder_leaves_the_old_or_new_tree: Change::Reorder,
    an_interrupted_language_change_leaves_the_old_or_new_tree: Change::ReplaceLanguage,
    an_interrupted_document_delete_leaves_the_old_or_new_tree: Change::DeleteDocument,
    an_interrupted_folder_delete_leaves_the_old_or_new_tree: Change::DeleteFolder,
}

#[tokio::test]
async fn loads_a_pre_language_workspace_index_with_english_default() {
    let dir = TempDir::new().unwrap();
    let data = dir.path().join("data");
    let root = data.join("workspace");
    fs::create_dir_all(root.join(".writer")).unwrap();
    fs::create_dir_all(root.join("Folder")).unwrap();
    let prose = "The keeper climbed the stairs.\n";
    fs::write(root.join("Folder/Chapter.md"), prose).unwrap();
    // Format 1 index written before document language existed.
    let legacy = r#"{
  "format": 1,
  "items": [
    {
      "id": "c0f0a000-0000-4000-8000-000000000001",
      "kind": "folder",
      "title": "Folder",
      "name": "Folder",
      "items": [
        {
          "id": "c0f0a000-0000-4000-8000-000000000002",
          "kind": "document",
          "title": "Chapter",
          "name": "Chapter.md"
        }
      ]
    }
  ],
  "pending": null
}"#;
    fs::write(root.join(".writer/workspace.json"), legacy).unwrap();

    let store = FilesystemStore::open(&data).await.unwrap();
    let items = store.workspace().await.unwrap();
    assert_eq!(items.len(), 2);
    assert_eq!(items[0].language, None);
    assert_eq!(items[1].language, Some(Language::En));
    assert_eq!(text(&store, 2).await, prose);
}

#[tokio::test]
async fn outside_document_gets_default_language_and_language_change_leaves_markdown_untouched() {
    let fs_store = Fs::open().await;
    let store = &fs_store.store;
    let root = fs_store.root();
    let spanish = "¿Dónde dejó la lámpara? En el faro, junto al río.\n";
    let path = root.join("Cartas.md");
    fs::write(&path, spanish).unwrap();

    let items = store.workspace().await.unwrap();
    assert_eq!(items.len(), 1);
    let doc_id = items[0].id.clone();
    assert_eq!(items[0].language, Some(Language::En));

    #[cfg(unix)]
    let before_inode = inode(&path);
    let updated = store
        .replace_language(doc_id.clone(), Language::Es)
        .await
        .unwrap();
    assert_eq!(updated.language, Language::Es);
    assert_eq!(fs::read_to_string(&path).unwrap(), spanish);
    #[cfg(unix)]
    assert_eq!(inode(&path), before_inode);
    assert_eq!(index_json(&root)["items"][0]["language"], "es");
}

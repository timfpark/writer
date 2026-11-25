//! Kills a child process while it writes and checks that every document
//! holds a complete version afterwards. It runs in its own test binary,
//! because a spawned child inherits the parent's open files until it execs,
//! including other tests' data folder locks.
#![cfg(unix)]

use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use tempfile::TempDir;
use writer_domain::{Item, ItemId, ItemKind, Language, Markdown, NewItem, Placement, Title};
use writer_storage::{FilesystemStore, WorkspaceStore};

const CHILD_DIR: &str = "WRITER_STORAGE_TEST_CHILD_DIR";
const CHILD_READY: &str = "child ready";

fn id(n: u32) -> ItemId {
    ItemId::parse(&format!("c0f0a000-0000-4000-8000-{n:012x}")).unwrap()
}

fn title(text: &str) -> Title {
    Title::parse(text).unwrap()
}

fn at(parent: Option<u32>) -> Placement {
    Placement {
        parent_id: parent.map(id),
        before_id: None,
    }
}

/// A self-checking document version: its first and last lines name it.
fn version(k: u64) -> Markdown {
    let text = format!(
        "version {k}\n{}end {k}\n",
        "A synthetic line about the tide and the lamp.\n".repeat(2_000)
    );
    Markdown::parse(text).unwrap()
}

fn is_version(text: &str) -> bool {
    text.strip_prefix("version ")
        .and_then(|rest| rest.split_once('\n'))
        .and_then(|(k, _)| k.parse().ok())
        .is_some_and(|k| text == version(k).as_str())
}

fn assert_settled(root: &Path) {
    let index: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join(".writer/workspace.json")).unwrap()).unwrap();
    assert_eq!(index["pending"], serde_json::Value::Null);
    assert_eq!(fs::read_dir(root.join(".writer/tmp")).unwrap().count(), 0);
    assert_eq!(fs::read_dir(root.join(".writer/trash")).unwrap().count(), 0);
}

/// Saves, renames, moves, creates, and deletes until killed; run only by
/// [`kill_during_writes_leaves_complete_documents`].
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "runs only as the child process of kill_during_writes_leaves_complete_documents"]
async fn child_writes_until_killed() {
    let Some(data) = std::env::var_os(CHILD_DIR) else {
        return;
    };
    let store = FilesystemStore::open(PathBuf::from(data)).await.unwrap();
    for n in [1, 2] {
        let folder = NewItem::folder(id(n), title(&format!("Shelf {n}")), at(None));
        store.create(folder).await.unwrap();
    }
    for n in 11..=14 {
        let document = NewItem::document(
            id(n),
            title(&format!("Draft {n}")),
            at(Some(1)),
            version(0),
            Language::default(),
        );
        store.create(document).await.unwrap();
    }
    println!("{CHILD_READY}");
    for k in 1..=u32::MAX {
        let n = 11 + k % 4;
        let base = store.content(id(n)).await.unwrap().revision;
        store
            .replace_content(id(n), version(u64::from(k)), base)
            .await
            .unwrap();
        let result = match k % 5 {
            0 => store
                .place(id(n), ItemKind::Document, at(Some(1 + k / 5 % 2)))
                .await
                .map(drop),
            1 => store
                .rename(
                    id(n),
                    ItemKind::Document,
                    title(&format!("Draft {n} take {k}")),
                )
                .await
                .map(drop),
            2 => store
                .create(NewItem::folder(id(100 + k), title("Scratch"), at(Some(2))))
                .await
                .map(drop),
            3 => store.delete(id(99 + k), ItemKind::Folder).await,
            _ => store
                .place(id(1 + k % 2), ItemKind::Folder, at(None))
                .await
                .map(drop),
        };
        result.unwrap();
    }
}

#[test]
fn kill_during_writes_leaves_complete_documents() {
    let dir = TempDir::new().unwrap();
    let data = dir.path().join("data");
    let runtime = tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap();
    for round in 0..6_u64 {
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--ignored",
                "--exact",
                "child_writes_until_killed",
                "--nocapture",
                "--test-threads=1",
            ])
            .env(CHILD_DIR, &data)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let stdout = child.stdout.take().unwrap();
        let ready = BufReader::new(stdout)
            .lines()
            .map_while(Result::ok)
            .any(|line| line.contains(CHILD_READY));
        assert!(ready, "the child stopped before it was ready");
        std::thread::sleep(Duration::from_millis(30 + round * 45));
        assert!(
            child.try_wait().unwrap().is_none(),
            "the child stopped before it was killed"
        );
        child.kill().unwrap();
        child.wait().unwrap();

        runtime.block_on(async {
            let store = FilesystemStore::open(&data).await.unwrap();
            let items = store.workspace().await.unwrap();
            let documents: Vec<_> = items
                .iter()
                .filter(|item| item.kind == ItemKind::Document)
                .collect();
            assert_eq!(documents.len(), 4, "round {round}: {items:#?}");
            for item in documents {
                let content = store.content(item.id.clone()).await.unwrap();
                assert!(
                    is_version(content.markdown.as_str()),
                    "round {round}: an incomplete document"
                );
            }
            assert_settled(&data.join("workspace"));
            assert!(matches!(
                store.item(id(1), ItemKind::Folder).await.unwrap(),
                Item::Folder(_)
            ));
        });
    }
}

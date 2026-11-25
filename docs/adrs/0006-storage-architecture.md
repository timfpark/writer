---
title: "ADR 0006: Storage interface, filesystem backend, and SQL path"
description: Defines the asynchronous storage interface and the conformance suite every backend passes, specifies the filesystem backend that mirrors the workspace as directories and Markdown files with one workspace index, and sets the SQLx path to SQLite and PostgreSQL, configuration, the data location, and test isolation
author: Tim Park
ms.date: 2026-11-25
ms.topic: reference
status: Accepted
subsystems:
  - service
keywords:
  - adr
  - storage
  - filesystem
  - atomic writes
  - revisions
  - sqlite
  - postgresql
  - sqlx
  - migrations
estimated_reading_time: 25
---

## Status

Accepted on 2026-11-20.

Amended on 2026-11-20, when the workspace storage story (backlog 18) built
[writer-domain](../../service/crates/writer-domain/) and
[writer-storage](../../service/crates/writer-storage/) with the filesystem
backend on this record. `writer-storage` also depends on `tracing`, for the
reconciliation and recovery log lines this record calls for, and on `uuid`,
to generate version 4 identifiers for entries added outside Writer and
unique names in `.writer/`. `replace_content` returns the `Document` it
saved, since only documents have content. A deletion renames the item,
file or directory, to a new UUID name in `.writer/trash/`. The conformance
module also compiles for `writer-storage`'s own tests, which run it against
the filesystem backend.

Amended on 2026-11-25 to store each document's `language` from
[ADR 0005](./0005-workspace-model.md#language). `WorkspaceStore` adds
`replace_language`, and document entries in `.writer/workspace.json` record
`"language"` while staying on format 1 so indexes written before this change
load with the default `en`. Documents created outside Writer and adopted by
reconciliation also get `en`, and changing a document's language rewrites only
`.writer/workspace.json`, leaving the `.md` file untouched.

## Decision summary

* Define the storage interface as `WorkspaceStore`, an object-safe async
  trait in a `writer-storage` crate with one method per
  [ADR 0005](./0005-workspace-model.md) operation, taking and returning
  `writer-domain` types. `writer-api` holds it as `Arc<dyn WorkspaceStore>`,
  `writer-server` opens the configured backend, and a conformance suite in
  `writer-storage` runs the same cases against every backend.
* Derive a document's revision from its content alone: the lowercase hex of
  the first 128 bits of the SHA-256 of its UTF-8 bytes, identical in every
  backend.
* The filesystem backend mirrors the tree under `<data>/workspace/` as
  directories and `.md` files that hold exactly each document's content. One
  index, `.writer/workspace.json`, holds identifiers, exact titles, document
  languages, sibling order, and on-disk names. Names come from titles through
  a portable mapping and collide case- and normalization-insensitively,
  resolved with numbered suffixes such as `Notes (2).md`.
* Write every file through a temporary file in `.writer/tmp/`, `sync_all`,
  `rename`, and a directory sync. A structural change makes exactly one
  rename, its commit point, recorded in the index before it runs and rolled
  back on startup if it did not happen, so a crash leaves either the old or
  the new tree.
* Detect edits made outside Writer by hashing content on every read and
  save, and by reconciling the index with the directories on every tree read
  and structural change. No file watcher.
* One process owns a data folder through an exclusive lock file. Inside it,
  one async read-write lock serializes writes, and each operation runs its
  file I/O in one `spawn_blocking` task behind a bounded permit that owns the
  lock guard.
* SQLite and PostgreSQL backends use SQLx 0.9 in a `writer-storage-sql`
  crate (planned) that owns forward-only, per-dialect migrations embedded with
  `sqlx::migrate!` and applied at startup. A copy command moves the working
  state between backends with identifiers and revisions intact.
* `WRITER_DATA_DIR` sets the data location: the platform's per-user data
  folder in release builds and the ignored `.local/data/` in debug builds.
  `WRITER_STORAGE` selects a backend once a second one exists. Tests use only
  temporary directories and synthetic text.

## Context

[ADR 0001](./0001-monorepo-structure.md#context) makes text storage a service
responsibility, and [ADR 0002](./0002-service-architecture.md#crate-layout)
expects a storage crate below `writer-api`, free of axum, Tower, and utoipa
types, with blocking work run through `spawn_blocking` behind a bounded
permit. It lists storage engine, schema ownership, and migrations as a
follow-up decision.

The [README](../../README.md#saving-and-storage) sets the direction: storage
sits behind interchangeable backends, starting with plain files, then SQLite,
then PostgreSQL. The filesystem backend mirrors the workspace, folders as
directories and documents as `.md` files, so the workspace stays readable and
editable with other tools.

[ADR 0005](./0005-workspace-model.md) defines what storage persists: one tree
of folders and documents with client-generated UUIDs that survive rename and
move, one manual order per parent mixing both kinds, titles that siblings may
share in any case, content stored and returned byte for byte, and limits of
10,000 items, depth 16, and 1 MiB per document. Its
[follow-up decisions](./0005-workspace-model.md#follow-up-decisions) leave to
storage where identifiers and order live, the title-to-name mapping, revision
derivation, the compare-and-replace of content and how it guards against
outside edits, all-or-nothing subtree deletion, and content created outside
Writer that breaks a limit.

The first release has one local user and one service process, but the writer
can edit files in the data folder with other tools while Writer runs, and
can open two browser tabs. The workspace is a writer's manuscript, so a
crash, a full disk, or a stray edit must never lose committed text.

An earlier project chose SQLite through SQLx. This record treats that as
input for the SQL backends and weighs it against the alternatives below.

A prototype built outside the repository, under the pinned Rust 1.100
toolchain on macOS with APFS, confirmed the mechanisms this record relies
on: `File::sync_all` on a directory succeeds, `File::try_lock` on a second
handle reports `WouldBlock`, a case-only `rename` succeeds, and creating
`NOTES.md` beside `notes.md` or opening an NFD spelling of an NFC name
resolves to the existing file.

## Decision drivers

* Never lose committed text, whatever the moment of a crash or power loss
* A data folder that stays readable and editable with ordinary tools
* Edits made outside Writer are detected, never silently overwritten
* One interface and one test suite that a filesystem, SQLite, or PostgreSQL
  backend implements without changing the API
* Revisions that mean the same thing in every backend, so a workspace moves
  between backends without breaking open documents
* ADR 0002's rules: no blocking on async workers, a downward dependency
  direction, and framework-free lower crates
* Few dependencies and no `unsafe` code, which the workspace lints forbid

## Considered options

### Interface shape

1. A synchronous trait that `writer-api` calls inside `spawn_blocking`. It
   suits files, but SQLx backends would block a thread on async calls.
2. An async trait with static dispatch, the router generic over the backend.
   No allocation per call, but every handler and utoipa-axum registration
   becomes generic, and choosing a backend at runtime still needs an enum.
3. An object-safe async trait returning boxed futures, held as
   `Arc<dyn WorkspaceStore>`. One allocation per call, negligible beside the
   I/O, keeps the router concrete and lets configuration pick the backend.
4. Narrow persistence primitives beneath one shared engine that validates and
   serializes in process. Less code per backend, but PostgreSQL could not
   serialize writers across processes with its own transactions.

### Where identifiers, titles, and order live

1. Markdown front matter in each document, such as `id:` and `position:`.
   An identifier travels with a file renamed outside Writer, but every file
   gains lines that Writer must parse and preserve and the editor must hide,
   folders still need another home, reordering rewrites every sibling's file,
   and Writer's keys mix with a writer's own front matter.
2. A sidecar file per folder, such as `.writer.json`, listing its children in
   order. A folder moved outside Writer keeps its children's identifiers, but
   a hidden file appears in every directory, and a move between folders
   rewrites two sidecars that no single atomic step can replace together.
3. One workspace index in a hidden `.writer/` folder at the root. Documents
   hold only their content, every metadata change is one atomic file
   replacement, and order and exact titles survive lossy file names. An
   identifier does not follow a file renamed or moved outside Writer.

### Mapping titles to names

1. Percent-encode reserved characters. Reversible, but `Act 1%3A Arrival.md`
   reads poorly in a file manager, and the index already keeps exact titles.
2. Substitute Unicode lookalikes, such as a fullwidth colon. Readable, but
   confusing in shells and searches.
3. Substitute `_` for reserved characters, with rules for reserved names,
   dots, and length, and numbered suffixes for collisions. Predictable and
   ASCII-safe; lossy, which the index makes harmless.
4. Name entries by identifier, such as `3f2c8a10-….md`. Always safe, but
   defeats a workspace readable with other tools.

### Atomic writes

1. Write the file in place. A crash mid-write leaves a truncated document.
2. Write a temporary file beside the target, sync, and rename it over the
   target. Standard, but temporary files appear among the writer's documents,
   and a crash leaves them there.
3. Write the temporary file in `.writer/tmp/`, sync, rename it over the
   target, and sync the directory. The same guarantee with nothing visible,
   provided the workspace is one file system.
4. Journal full content before writing it in place. Every save writes twice.

### Changes made outside Writer

1. A file watcher, such as the `notify` crate over inotify, FSEvents, and
   ReadDirectoryChangesW. Live, but events coalesce and overflow, and an
   editor's write-and-rename produces bursts, so a watcher is a cache that
   still needs a full rescan behind it. Pushing changes to clients would also
   need a channel the API lacks.
2. Reconcile on demand: hash content on every read and save, and compare the
   index with the directories on every tree read and structural change.
   Correct at the moment of each request, for the cost of walking at most
   10,000 entries.
3. Poll with periodic rescans. Delayed and always working.

### Revision tokens

1. Modification time and size. Cheap, but coarse timestamps on some file
   systems miss a quick edit of equal size, and touching a file without
   changing it would cause a conflict.
2. A counter in the index or a column. It cannot see edits made to files
   outside Writer, and every save would rewrite the index.
3. A hash of the content. It changes exactly when the content changes, needs
   no storage, and is the same in every backend. Hashing 1 MiB costs about a
   millisecond.

### Serializing writes

1. Per-document locks. Saves to different documents run in parallel, but
   structural changes still need a tree-wide lock, and one writer gains
   nothing.
2. One workspace read-write lock in the process, and a lock file against
   other processes.
3. No lock, relying on the operating system. Two tabs saving at once could
   both pass the revision check.

### SQL access library

1. SQLx: async and Tokio-native, SQLite and PostgreSQL drivers behind one
   API, and embedded migrations. Queries are SQL strings per dialect. The
   earlier project used it.
2. rusqlite with tokio-postgres: mature, but two libraries with two migration
   mechanisms, and rusqlite blocks, so every call needs `spawn_blocking`.
3. Diesel: a compile-time checked query DSL with its own migrations, a
   synchronous core with async support in a separate crate, and more DSL than
   a few tables need.
4. SeaORM: an entity layer on SQLx, more abstraction than a few tables need.

### Schema ownership

1. One crate per SQL backend. Separates dependencies, but duplicates the
   logic both share, such as sibling positions and the copy.
2. One `writer-storage-sql` crate with a module and a migration set per
   dialect, each behind a Cargo feature.
3. One migration set for both dialects through SQLx's `Any` driver. Limited
   to the types and statements both share.

### Configuration

1. One URL, such as `WRITER_STORAGE_URL=file:///…` or `sqlite:///…`. One
   variable, but file URLs need percent-encoded spaces and awkward Windows
   forms.
2. Separate settings for the data folder, the backend, and a database URL.

### Default data location

1. The platform's per-user data folder in release builds, and `.local/data/`
   in the repository for debug builds.
2. `~/Documents/Writer`. Visible, but Documents is often cloud-synced, and
   sync clients evict files to placeholders, lock them, and create their own
   conflict copies.
3. The working directory. It depends on where the service starts, which is
   usually inside a repository during development.

## Decision

### Storage crates

| Crate                          | Kind    | Responsibility                                                                                         | May depend on                                                                                                          |
|--------------------------------|---------|--------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------|
| `writer-storage`               | Library | `WorkspaceStore`, `StoreError`, revision derivation, the conformance suite, and the filesystem backend | `writer-domain`, Tokio, serde, `serde_json`, `sha2`, `tempfile`, `unicase`, `unicode-normalization`, `uuid`, `tracing` |
| `writer-storage-sql` (planned) | Library | The SQLite and PostgreSQL backends, their schemas, and their migrations                                | `writer-storage`, `writer-domain`, SQLx                                                                                |

Backlog 18, the workspace storage story, built `writer-storage`; the story
that delivers the second backend creates `writer-storage-sql`. The
dependency direction becomes `writer-server` → `writer-api` →
`writer-storage` → `writer-domain`, with `writer-storage-sql` →
`writer-storage`. `writer-server` also depends on the storage crates to open
the backend its configuration names and pass it to `writer_api::router`.
That is the one addition to [ADR 0002's crate table](./0002-service-architecture.md#crate-layout):
opening a backend is wiring, not a rule, so it belongs with configuration.

No storage crate exposes axum, Tower, or utoipa types, and none logs a path
inside the workspace, because paths contain titles, which
[ADR 0004](./0004-api-conventions.md#errors) keeps out of logs. Errors and
logs name the operation, the item identifier, and the I/O error kind or
database error code, never a path, a title, content, or a database message.

### Storage interface

`WorkspaceStore` has one method per ADR 0005 operation. Methods take
validated `writer-domain` values, return futures boxed so the trait is
object-safe, and are `Send` so handlers can await them. Backlog 18 settled
the exact names:

```rust
pub type StoreFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, StoreError>> + Send + 'a>>;

pub trait WorkspaceStore: Send + Sync {
    fn workspace(&self) -> StoreFuture<'_, Vec<WorkspaceItem>>;
    fn item(&self, id: ItemId, kind: ItemKind) -> StoreFuture<'_, Item>;
    fn content(&self, id: ItemId) -> StoreFuture<'_, DocumentContent>;
    fn create(&self, item: NewItem) -> StoreFuture<'_, Created>;
    fn rename(&self, id: ItemId, kind: ItemKind, title: Title) -> StoreFuture<'_, Item>;
    fn place(&self, id: ItemId, kind: ItemKind, to: Placement) -> StoreFuture<'_, Item>;
    fn replace_content(&self, id: ItemId, markdown: Markdown, base: Revision) -> StoreFuture<'_, Document>;
    fn replace_language(&self, id: ItemId, language: Language) -> StoreFuture<'_, Document>;
    fn delete(&self, id: ItemId, kind: ItemKind) -> StoreFuture<'_, ()>;
}
```

* `workspace` returns the tree in pre-order, as `GET /api/v1/workspace`
  does. `Item` is a folder or a document, and a document carries its
  revision. `Created` says whether the item is new, for 201, or already
  existed, for 200.
* A backend applies `writer-domain`'s checks to its current tree in the same
  serialized step as the write, as ADR 0005 requires, so the domain rules
  live in one place and every backend enforces them identically.
* `replace_content` implements ADR 0005's stale-write rule: identical content
  returns the current revision, a matching base replaces the content, and
  anything else is a conflict that changes nothing.
* The story that delivers the second backend adds one bulk operation,
  importing a whole working state into an empty store, for
  [moving between backends](#moving-between-backends).

`StoreError` has one variant per outcome, and `writer-api` maps each to
ADR 0004's problem codes:

| Variant      | When                                                                                            | Response               |
|--------------|-------------------------------------------------------------------------------------------------|------------------------|
| `NotFound`   | No item of the requested kind has the identifier                                                | 404 `notFound`         |
| `Conflict`   | A stale base revision, a missing parent or sibling, a cycle, or an identifier of the other kind | 409 `conflict`         |
| `Invalid`    | A `writer-domain` rule is broken, carrying the domain error and its pointer                     | 422 `validationFailed` |
| `Unreadable` | Stored content cannot be served: over 1 MiB, not UTF-8, or containing U+0000                    | 500 `internalError`    |
| `Internal`   | An I/O or database failure, carrying the operation, identifier, and error kind for the log      | 500 `internalError`    |

### Conformance suite

`writer-storage` exposes a `conformance` module behind a Cargo feature of the
same name. A backend's test target enables the feature and supplies a
harness that opens a fresh, empty store in an isolated location and reopens
one from the same location. A macro expands every case into its own
`#[tokio::test]`, so a failure names the case and the backend. Every backend
passes every case, and a new behavior in the interface adds its cases in the
same change.

The cases cover ADR 0005 through the interface:

* Creating each kind at the top level, inside a folder, before a sibling, and
  at the end; a repeated create returning the existing item unchanged; and a
  create reusing an identifier of the other kind returning a conflict
* Placing items: moving between folders, reordering within a parent, the
  no-op move before itself, a missing parent or sibling, a folder moved into
  itself or a descendant, and a move that would exceed depth 16
* Renaming that keeps the identifier and revision, with titles that stress
  every backend: reserved characters such as `Act 1: Arrival?`, reserved
  device names such as `con`, a leading dot, a trailing dot, 200 characters
  of CJK text, emoji, combining marks, case-only siblings such as `Notes` and
  `notes`, and duplicates; each reads back exactly as sent
* Content stored and returned byte for byte: empty, exactly 1 MiB, CRLF line
  endings, NFD text, and a leading byte order mark
* Every branch of the stale-write rule, and many concurrent saves from one
  base revision, of which exactly one succeeds unless the contents are
  identical
* Revisions that change exactly when content changes, a rename or move that
  leaves them unchanged, and the known value for empty content
* Deleting a document, deleting a folder with its whole subtree, and deleting
  an item that does not exist
* Reopening a store from the same location and finding the same tree, order,
  titles, languages, content, and revisions
* Setting and updating a document's language, defaulting to `en`, leaving
  content and revision unchanged, surviving rename, move, and reopen, and
  returning `NotFound` for missing items or folders
* Domain checks reaching the store: one case per kind of check, using the
  depth limit for limits, while `writer-domain`'s own tests cover each limit
  exhaustively without storage

Backend-specific behavior, such as names on disk, crash recovery, and edits
made outside Writer, is tested beside each backend, not in the suite.

### Revisions

A revision is the lowercase hexadecimal form of the first 16 bytes of the
SHA-256 digest of the content's UTF-8 bytes, computed with RustCrypto's
`sha2` crate. Empty content has the revision
`e3b0c44298fc1c149afbf4c8996fb924`, and
`The keeper climbed the stairs twice before lighting the lamp.\n` has
`50a52a64cb33d03e10dc09540168aec7`.

* Two different contents of one document share a revision only through a
  128-bit hash collision, which no workspace will plausibly meet. This
  record reads ADR 0005's promise that they never share one in that
  cryptographic sense, as any hash-derived token must.
* A document that returns to earlier content returns to its earlier
  revision. That is correct for the stale-write rule, because a revision
  then still names exactly the stored text, and ADR 0005's restore behavior
  relies on it.
* Every backend computes the same revision for the same content, so copying
  a workspace between backends preserves revisions. PostgreSQL and most
  tools can compute SHA-256 too.
* Clients still treat revisions as opaque, so the derivation can change
  later; a change makes open clients' next differing save return 409 once.

### Filesystem backend

#### Layout

The backend keeps the workspace in `workspace/` inside the data folder.
Every folder is a directory, and every document is a regular file whose name
ends in `.md` and whose bytes are exactly the document's content, with no
front matter or other metadata. Writer's own files live in a hidden
`.writer/` directory at the workspace root:

```text
<data>/workspace/
  .writer/
    workspace.json    identifiers, exact titles, sibling order, and names
    lock              held by the service that owns the folder
    tmp/              new content waiting to be renamed into place
    trash/            deleted subtrees waiting to be removed
  The lighthouse/
    Chapter one.md
    Drafts/
  Notes.md
```

The workspace must be on one file system, because every write ends in a
rename from `.writer/tmp/`, and the data folder must be on a local disk,
because advisory file locks are unreliable on network file systems.

#### Workspace index

`.writer/workspace.json` is the source of truth for identity, titles,
document languages, and order; the files are the source of truth for content
and existence. It nests items as the tree does, each parent's `items` in
sibling order, and stores each entry's name on disk beside its exact title
and, for documents, its BCP 47 `language` tag:

```json
{
  "format": 1,
  "items": [
    {
      "id": "3f2c8a10-6b1e-4d4a-9c55-0e7b2d9a41f3",
      "kind": "folder",
      "title": "The lighthouse",
      "name": "The lighthouse",
      "items": [
        {
          "id": "c7e5b3a1-9d2f-4e8c-a6b4-1f3e5d7c9b2a",
          "kind": "document",
          "title": "Chapter one",
          "name": "Chapter one.md",
          "language": "en"
        },
        {
          "id": "8a41d7e2-2c90-4f6b-b1a3-5d6e7f809a1b",
          "kind": "folder",
          "title": "Drafts",
          "name": "Drafts",
          "items": []
        }
      ]
    },
    {
      "id": "5b9d1f3e-7a2c-4c6e-8b0a-2d4f6e8a0c1b",
      "kind": "document",
      "title": "Notes",
      "name": "Notes.md",
      "language": "es"
    }
  ],
  "pending": null
}
```

* Nesting makes a parent implicit, so the index cannot hold a dangling or
  cyclic parent reference.
* The index is pretty-printed so a writer can read it, and is rewritten whole
  through the atomic write below. At the 10,000 item limit it is a few
  megabytes. Saving content never rewrites it.
* `format` stays at `1`: `"language"` is optional when reading a document
  entry and defaults to `en` when omitted, so an index written before
  document language existed still loads unchanged. An unsupported language
  tag, or a `"language"` field on a folder entry, makes the index invalid.
* On opening, an older format is migrated forward, and a newer format, an
  unreadable file, or invalid JSON stops the service with a log line naming
  the file. The service never overwrites an index it cannot read; a writer
  can move it aside to rebuild one.
* A missing index is rebuilt from the directories, as reconciliation below
  adopts new entries, so deleting `.writer/` loses identifiers, exact titles,
  document languages, and order, but no content.

#### Names on disk

The backend derives a name from a title when it creates, renames, or moves
an item, applying these steps in order, so the result is valid on Linux,
macOS, and Windows:

1. Normalize the title to NFC.
2. Replace each character Windows reserves (`<`, `>`, `:`, `"`, `/`, `\`,
   `|`, `?`, and `*`) with `_`.
3. Replace a leading `.` with `_`, so the entry is not hidden and not
   skipped.
4. Truncate to at most 120 bytes of UTF-8 at a character boundary, which
   leaves room for a suffix and `.md` within the 255-byte or 255-unit name
   limits of ext4, APFS, and NTFS.
5. For a folder, replace a trailing `.` or space with `_`, since Windows
   strips them. A document's name ends in `.md`, so its stem may end in
   either.
6. Append `_` to the part before the first `.` when that part, with trailing
   spaces removed as Windows removes them, is a Windows reserved device
   name, compared case-insensitively: `CON`, `PRN`, `AUX`,
   `NUL`, `COM1` to `COM9`, `LPT1` to `LPT9`, and the superscript-digit forms
   Microsoft lists.
7. For a document, append `.md`.
8. If the name's collision key equals the key of any other entry in the
   target directory, including hidden and non-Markdown entries, insert a
   space and `(2)`, `(3)`, and so on before `.md`, or at the end of a
   folder's name, until it does not.

A collision key is the NFC form of the name under full Unicode case folding,
as the `unicase` crate implements it, so `Σ.md` and `ς.md` collide. Every
file system is treated as both case-insensitive, as APFS and NTFS are by
default, and normalization-insensitive, as APFS is, so a workspace copied
between machines rarely acquires two names that one of them cannot hold. No
single rule matches every file system's own comparison exactly, so before
each create, rename, or move the backend also asks the file system whether
the target name already resolves to an entry other than the item's own,
compared by file identity, and moves to the next suffix if it does. For
example:

| Title                                 | Name on disk         |
|---------------------------------------|----------------------|
| `Act 1: Arrival?`                     | `Act 1_ Arrival_.md` |
| `.plan`                               | `_plan.md`           |
| `Con`                                 | `Con_.md`            |
| `Part I.`, folder                     | `Part I_`            |
| `notes` beside an existing `Notes.md` | `notes (2).md`       |

A new document is moved into place with `tempfile`'s `persist_noclobber`,
which never replaces an existing file, so a name taken by another program
at the last moment moves to the next suffix instead of overwriting. Where
the platform lacks a no-replace rename, `persist_noclobber` creates a hard
link and then removes the temporary name; an interruption between the two
leaves an extra name in `.writer/tmp/`, which recovery removes. A rename or
move checks its target under the lock immediately before renaming, and
POSIX `rename` refuses to replace a non-empty directory, but a file that
another program creates at the target name in that instant can be replaced,
a window this record accepts. A suffix never changes
afterwards: deleting `Notes.md` leaves `notes (2).md` as it is. A rename
whose new title maps to the entry's current name changes only the index.

#### Reading and reconciling the tree

The backend keeps the index in memory under its lock and reconciles it with
the directories when it opens, on every tree read, and before every
structural change. Reconciliation walks the workspace depth first, reading
only metadata:

* It skips entries whose names start with `.`, which covers `.writer/`,
  `.git/`, and editor or operating system files; symbolic links, which it
  neither follows nor lists; names that are not valid UTF-8; and regular
  files without an `.md` extension, compared case-insensitively. Skipped
  entries are left untouched.
* Index entries match directory entries one to one. Every entry with an
  exact name match pairs first. A remaining index entry then pairs with a
  remaining directory entry of the same NFC form, since some file systems
  return names decomposed, but only when exactly one entry on each side has
  that form; otherwise neither pairs.
* An index entry with no matching directory entry of its kind was removed
  outside Writer, and the backend drops it with its subtree.
* A directory entry with no index entry was added outside Writer. The backend
  assigns it a version 4 UUID, derives its title from its name, assigns the
  default language `en` when it is a document, and appends it to its parent's
  items after existing ones, new entries sorted by name in code point order.
* A title derived from a name drops the `.md` extension, replaces control
  characters and line or paragraph separators with spaces, truncates to 200
  characters, trims surrounding whitespace, and becomes `Untitled` if
  nothing is left, so it always passes ADR 0005's title rules. It does not
  undo the `_` substitutions.
* Folders and documents deeper than 16, and items beyond the 10,000th in
  index order and then name order, are not listed and are left untouched, so
  the tree the service returns stays within ADR 0005's bounds.
* When anything changed, the backend writes the index and logs counts of
  adopted, removed, and skipped entries, without names.

A Markdown file is listed whatever its size. Reading or saving a document
whose stored bytes exceed 1 MiB, are not valid UTF-8, or contain U+0000
returns `Unreadable`, logged with its identifier and reason, so the writer
still sees it in the navigator and can delete it or fix it with another
tool. Reading a document's content or saving it does not walk the tree. It
looks up the document's indexed path, and only if that entry is missing or
of the wrong kind reconciles and answers, usually with `NotFound`. A read
holding the shared lock releases it, takes the exclusive lock, and starts
again before reconciling, because the lock cannot be upgraded in place.

The backend does not follow a file renamed or moved outside Writer: the old
item disappears and the file returns as a new item with a new identifier.
An open document then saves to an identifier that no longer exists, and the
client recovers as ADR 0005 describes for a document deleted elsewhere.

#### Writing atomically

Every file the backend writes, whether a document or the index, goes through
the same steps:

1. Create a uniquely named temporary file in `.writer/tmp/` with `tempfile`,
   with the permissions of the file it replaces, or the process's default
   for a new file.
2. Write the whole content and call `File::sync_all`, which on macOS issues
   `F_FULLFSYNC`, so the bytes reach stable storage rather than a drive
   cache.
3. Rename it over the target. On every supported platform a rename within
   one file system replaces the target in one step, so a reader sees either
   the old file or the new one.
4. Call `sync_all` on the target's directory, so the rename itself survives
   power loss.

Windows has no directory sync through the standard library, so on Windows
these steps guarantee that a reader sees the old or new file, but not that
an acknowledged write survives power loss. The durability guarantee covers
Linux and macOS until Windows becomes a supported host.

The index and the files can still disagree after a crash, because a
structural change touches both. Each structural change is therefore at most
one rename on disk, recorded in the index before it happens:

| Change                       | Rename on disk                                                    |
|------------------------------|-------------------------------------------------------------------|
| Create a document            | A temporary file holding its content to its final path            |
| Create a folder              | An empty directory made in `.writer/tmp/` to its final path       |
| Rename or move an item       | Its current path to its new path; a directory carries its subtree |
| Delete an item               | Its path to a new UUID name in `.writer/trash/`                   |
| Reorder within a parent      | None; only the index changes                                      |
| Change a document's language | None; only the index changes                                      |

That rename is the change's commit point. The backend validates the change
with `writer-domain` against the reconciled tree, prepares any temporary
file or directory, and then:

1. Writes the new index with `pending` recording the operation, the item's
   identifier, the rename's source and target paths, the source's file
   identity, and the item's previous index entry with its subtree, parent,
   and position.
2. Performs the rename, which commits the change, and syncs the directories
   it touched.
3. Writes the index again with `pending` set to `null`.
4. For a deletion, removes its entry in `.writer/trash/`.

Before the commit point, a failure rolls the change back: the backend
restores the previous entry in memory, writes the index without `pending`,
and returns `Internal`, and nothing visible has changed. If that index write
also fails, the `pending` record left on disk rolls the change back when the
backend next opens. After the commit point, the change stands. A failure in
the later steps is logged, and the backend returns `Internal` only when the
directory sync failed, because the change may then not survive power loss.
If the backend cannot clear `pending`, it refuses every further write with
`Internal` and retries the clear before each one, so no later change can
make a committed rename look uncommitted. A 500 from a structural change
therefore does not promise that nothing changed, which amends ADR 0005 for
deletion. ADR 0005's retry rules make that safe, since a retried rename or
move is idempotent, a retried create returns the item with 200, and a
retried delete returns 404, which clients treat as success. Either way the
tree is entirely old or entirely new.

When the backend opens and finds `pending` set, it lists the source's and
target's directories and compares entry names case-sensitively after NFC
normalization. A case-only rename on a case-insensitive file system is
therefore not mistaken for both paths existing, and a name that the file
system returns decomposed still matches:

| Source  | Target                                  | Outcome                                                                    |
|---------|-----------------------------------------|----------------------------------------------------------------------------|
| Any     | Present with the recorded file identity | Committed                                                                  |
| Absent  | Present with another file identity      | Committed; another program replaced the target afterwards                  |
| Present | Absent                                  | Not committed                                                              |
| Present | Present with another file identity      | Not committed; another program owns the target name                        |
| Absent  | Absent                                  | The item is gone; the backend drops it and reconciliation settles the tree |

For a committed change, the backend syncs both directories before clearing
`pending`, so a power loss during recovery cannot undo the rename after its
record is gone. A temporary name that `persist_noclobber`'s hard-link
fallback left behind goes when `.writer/tmp/` is emptied. For an
uncommitted change, it restores the previous entry from `pending`, dropping
a created item, and clears it.

It then empties `.writer/tmp/` and `.writer/trash/`. Because the visible
tree changes only through that one rename, a crash at any step leaves either
the old tree or the new one, and deleting a folder removes its whole subtree
from the tree at once, as ADR 0005 requires. Removing a deleted directory
from `.writer/trash/` can stop partway without affecting the tree.

Deleting a folder removes its directory with everything in it, including
files Writer does not list, such as images. The navigator's confirmation
counts only items, as ADR 0005 describes.

#### Saving content

`replace_content` performs ADR 0005's compare-and-replace in one blocking
task, holding the exclusive lock:

1. Read the document's file, recording its file identity, size, and
   modification time before and after the read, and read again if they
   differ, so the bytes come from one stable version. Hash them for the
   current revision.
2. If the submitted content equals the stored bytes, return the current
   revision without writing.
3. If `baseRevision` differs from the current revision, return `Conflict`.
4. Write the submitted content to a synced temporary file, as above.
5. Read the document's bytes again and compare them with the bytes from
   step 1. If they differ, a program outside Writer wrote the file, so
   remove the temporary file and repeat from step 1, which usually ends in a
   conflict that preserves the outside edit. After three attempts the save
   returns `Conflict`.
6. Rename the temporary file over the document, sync the directory, and
   return the revision of the submitted content.

Comparing bytes rather than metadata catches an outside edit of equal size
whose modification time is unchanged or restored. The window ADR 0005 leaves
open narrows to the interval between the reread in step 5 and the rename in
step 6, a few system calls rather than the whole request. An outside write
landing exactly there is replaced; this record accepts that risk. Every
revision the backend reports, including in a rename's response, is
computed from bytes it has just read.

#### Ownership and serialization

* Opening the backend creates `<data>/workspace/` and `.writer/` if they are
  missing, then takes an exclusive lock on `.writer/lock` with
  `File::try_lock`, stable since Rust 1.89, and holds it for the life of the
  store. A second Writer process on the same folder fails to open, and the
  service exits naming the data folder.
* Inside the process, a `tokio::sync::RwLock` guards the in-memory index.
  Reading an item or a document's content takes it shared. Reading the tree,
  which may rewrite the index, saving content, and every structural change
  take it exclusively, so ADR 0005's check and write form one step that no
  other request interleaves with.
* Each operation acquires an owned guard, then a permit from a
  `tokio::sync::Semaphore` of four permits owned by the backend, and then
  runs its whole sequence of `std::fs` calls in one
  `tokio::task::spawn_blocking` closure that owns both. ADR 0002's rule holds,
  and when axum drops a request's future, because the client disconnected or
  the shutdown deadline passed, the lock stays held until the I/O finishes.
* The backend uses `std::fs` rather than `tokio::fs`. Each `tokio::fs` call is
  its own blocking task, so one save would make several round trips and
  could stop between them.

### SQL backends

The SQLite and PostgreSQL backends are not built yet. When they are:

* They use SQLx 0.9 with default features off and `runtime-tokio`,
  `sqlite-bundled`, so no system SQLite is needed, `postgres`, `migrate`, and
  `macros`, enabled only for `sqlx::migrate!`. The PostgreSQL story chooses
  the TLS feature. SQLx runs each SQLite connection on its own worker thread
  and PostgreSQL over async I/O, so neither needs `spawn_blocking`.
* Queries use the runtime-checked `sqlx::query` and `sqlx::query_as`, not the
  compile-time `query!` macros, which need a live database or committed
  offline metadata for each dialect at build time. The conformance suite runs
  every query.
* `writer-storage-sql` owns the schema. Migrations are SQL files named
  `NNNN_description.sql` in `migrations/sqlite/` and `migrations/postgres/`
  inside the crate, and the same number means the same logical change in both
  dialects.
* Migrations are forward-only, with no down scripts. `sqlx::migrate!` embeds
  them in the binary, and opening a backend applies pending ones before the
  service binds its listener. SQLx records each applied version and checksum,
  so editing an applied migration, or opening a database that a newer Writer
  migrated, stops the service rather than guessing. Rolling back an upgrade
  means restoring a backup taken before it, which the backend's README
  explains. On PostgreSQL, SQLx holds an advisory lock while migrating, so
  services starting together do not race.
* The schema starts from an `items` table holding identifier, kind, parent,
  position, title, and nullable document language, with foreign keys that
  cascade a folder's deletion, and a `contents` table holding each document's
  Markdown and revision. The backend renumbers sibling positions in the same
  transaction as a create or move. A save, inside its serialized transaction,
  returns the current revision when the submitted content equals the stored
  content, and otherwise runs an `UPDATE` conditioned on the base revision,
  so the whole stale-write rule holds.
* SQLite runs in WAL mode with `synchronous = FULL` and foreign keys on, and
  every write runs in a `BEGIN IMMEDIATE` transaction, which serializes
  writers. Each PostgreSQL write transaction first locks a single `workspace`
  row with `SELECT … FOR UPDATE`, which serializes writers across processes
  too.
* Tests apply every migration to an empty database before running the
  conformance suite. A schema snapshot per dialect is committed beside the
  migrations and compared in a test, regenerated with an environment variable
  in the way `UPDATE_OPENAPI` regenerates the contract, so reviewers see each
  schema change. Once a schema version ships, each later migration adds a
  test that upgrades a synthetic database from the previous version.

### Moving between backends

A one-shot command of the service executable (planned) copies the working
state from one backend to another while the service is stopped, taking each
backend's ownership lock. It reads the source's tree and every document's
content and imports them into an empty destination with the bulk operation
above, keeping every identifier, title, position, and content. Revisions
match because their derivation is shared. It verifies the copy by comparing
both trees and every revision, and never changes the source. Copying from
the filesystem backend into another filesystem location doubles as an export
of the working state. The SQLite backend's story delivers the command and
names it. Moving history waits for the change control decision.

### Configuration and data location

The service reads storage settings from its environment, as it reads
`WRITER_PORT`:

| Variable                        | Default             | Effect                                                                                                                                    |
|---------------------------------|---------------------|-------------------------------------------------------------------------------------------------------------------------------------------|
| `WRITER_DATA_DIR`               | Per build, as below | The folder holding Writer's data. The filesystem backend keeps its workspace in `workspace/` inside it, and SQLite its database file.     |
| `WRITER_STORAGE` (planned)      | `filesystem`        | The backend: `filesystem`, then `sqlite`, then `postgres`. It arrives with the second backend; until then the filesystem is the only one. |
| `WRITER_DATABASE_URL` (planned) | None                | The PostgreSQL connection URL, required with `postgres`. `.env.example` shows it with a placeholder password.                             |

* Backlog 18 added `WRITER_DATA_DIR` to `service/.env.example` and the
  service README. An empty value, or a value that is not valid Unicode, is
  invalid configuration, and the service exits with status 2 naming the
  variable. A relative path is resolved against the working directory at
  startup.
* The service opens the store before binding its listener, creating the data
  folder on first use, and logs the resolved data location once. A data
  folder it cannot create, lock, or recover stops it with a log line naming
  the folder or file.
* Release builds default to the platform's per-user data folder, computed
  from the standard environment variables without another dependency:
  `$XDG_DATA_HOME/writer` on Linux, or `~/.local/share/writer` when that is
  unset; `~/Library/Application Support/Writer` on macOS; and
  `%LOCALAPPDATA%\Writer` on Windows.
* Debug builds, which `cargo run` produces, default to `.local/data/` at the
  repository root, found from `CARGO_MANIFEST_DIR` at compile time.
  `.gitignore` already ignores `.local/`, and the release default lies
  outside any repository, so neither default puts a manuscript under version
  control.
* A writer who wants the workspace somewhere visible, or backed up by a sync
  client, sets `WRITER_DATA_DIR`. The service README explains how to back up
  the folder: copy it while the service is stopped.

### Committed revisions later

The change control ADR designs history. These notes show each backend can
hold it without changing the decisions above:

* The filesystem backend can keep a Git repository at the workspace root.
  Reconciliation already skips `.git/`, and a commit that captures the files
  with `.writer/workspace.json`, ignoring `lock`, `tmp/`, and `trash/`,
  records the whole working state keyed by identifier, readable with any Git
  tool. `gix` is a candidate library.
* The SQL backends can add a `commits` table, a table of each commit's items
  with their parent, position, title, and content hash, and a table of
  content keyed by its full SHA-256, so unchanged documents are stored once.
* The copy command moves the working state only. Moving history between
  backends is part of the change control decision.

### Test isolation

* Storage constructors take an explicit location. Only `writer-server`
  resolves `WRITER_DATA_DIR` and the defaults, so no library test can reach a
  writer's data.
* Every test opens its own store in a `tempfile::TempDir`, removed when the
  test ends. SQLite tests use a database file in such a directory, and
  PostgreSQL tests create a uniquely named database from
  `WRITER_TEST_POSTGRES_URL` and drop it afterwards. Without that variable
  the PostgreSQL tests are marked ignored, so a run reports them as ignored
  rather than passed, and CI runs them against a PostgreSQL service.
* `writer-server`'s smoke test sets `WRITER_DATA_DIR` to a temporary
  directory, and `writer-api`'s router tests run against the filesystem
  backend in one, rather than a test double that could drift from it.
* Every title and document in a test or fixture is synthetic, written for
  the purpose, and built by the test rather than copied from a real
  workspace.
* The filesystem backend runs its steps through an internal seam that a test
  can make fail after any step. The test then reopens the store and asserts
  the old or new state, which proves the recovery logic for every
  interruption point. A further test runs saves and structural changes in a
  child process, kills it abruptly, and checks after reopening that every
  document holds a complete old or new version. Neither test can simulate
  power loss, which rests on the sync steps above.
* The naming rules are tested as a pure function, because CI's Linux file
  system is case-sensitive and cannot show a case-insensitive collision.
  Running the tests on macOS exercises the real behavior.

## Consequences

Positive outcomes:

* The data folder holds the workspace as ordinary directories and Markdown
  files with nothing added to them, so any editor, file manager, or backup
  tool works with it, and the editor never meets metadata that Writer
  inserted.
* A crash at any moment, or a power loss on Linux or macOS, leaves each
  document's old or new content and the tree's old or new shape, with
  nothing half-written.
* Edits made outside Writer reach the next read or save, and a save never
  replaces text that Writer has not seen, apart from a window of a few
  system calls.
* Every backend implements one interface, passes one suite, and derives the
  same revisions, so adding SQLite or PostgreSQL changes neither the API nor
  the clients, and a workspace can move between backends.
* File I/O stays off Tokio's workers, behind a bound, and a dropped request
  cannot release the lock while its I/O runs.

Trade-offs and risks:

* Identifiers do not follow files renamed or moved outside Writer, so such
  an item returns with a new identifier, and an open document recovers as if
  deleted. Writers should rename and move inside Writer.
* Losing `.writer/workspace.json` loses identifiers, exact titles, and order,
  though no content, and a lossy name such as `Act 1_ Arrival_` then becomes
  the title.
* Order exists only in the index, so other tools list items alphabetically.
* Every tree read and structural change walks the workspace. At the
  10,000-item limit that is tens of milliseconds on a solid-state disk, and
  more on a slow or network disk.
* Changes made outside Writer appear only when a client next reads the tree;
  nothing pushes them.
* Each structural change writes the index twice, up to a few megabytes each.
* Deleting a folder also deletes files inside it that Writer does not list.
* A document whose stored bytes break the content rules is listed but cannot
  be opened, and the client sees a generic 500 until a problem code exists.
* All writes, including saves to different documents, run one at a time. A
  save on macOS waits for `F_FULLFSYNC`, which can take tens of milliseconds.
* A cloud sync client that evicts files to placeholders makes them look
  deleted, so Writer drops them from the index and later readopts them with
  new identifiers.
* Windows is designed for but untested: long paths beyond 260 characters
  and renaming over a file another program holds open are unverified, and
  without a directory sync an acknowledged write may not survive power loss
  there.
* A 500 from a structural change may follow a change that committed, which
  ADR 0005's retry rules absorb but a client cannot tell apart.

## Revisit triggers

* A tree read or structural change takes long enough to notice: cache the
  reconciliation by directory modification times, or add a watcher.
* Writers lose identifiers to renames made outside Writer in practice: follow
  them by recording a content hash per document in the index, or reconsider
  front matter.
* Writers want structural changes made outside Writer to appear without a
  reload: add a watcher and a server-sent event stream of tree changes.
* More than one service process, or more than one device, needs one
  workspace: use PostgreSQL, since a lock file cannot coordinate them.
* Windows becomes a supported host: test long paths, open-file renames, and
  durability there.
* A writer keeps the data folder in a cloud-synced location and placeholders
  appear: recognize placeholders as present.
* Unreadable content occurs in practice: add a problem code so the client can
  explain it.

## Follow-up decisions

* The SQLite backend: its schema and first migration, the
  `writer-storage-sql` crate, `WRITER_STORAGE`, the bulk import operation,
  and the copy command
* The PostgreSQL backend: its TLS feature, `WRITER_DATABASE_URL`, and the
  PostgreSQL service CI runs its tests against
* Change control: history for each backend, as
  [Committed revisions later](#committed-revisions-later) outlines
* Pushing tree changes to clients, if its trigger occurs

## References

* [Rust `File::sync_all` and `File::try_lock`](https://doc.rust-lang.org/std/fs/struct.File.html)
* [Tokio `spawn_blocking`](https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html)
* [`tempfile` `NamedTempFile::persist_noclobber`](https://docs.rs/tempfile/latest/tempfile/struct.NamedTempFile.html)
* [RustCrypto `sha2`](https://docs.rs/sha2/latest/sha2/)
* [Windows: naming files, paths, and namespaces](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file)
* [Apple File System Guide: case and normalization](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/APFS_Guide/FAQ/FAQ.html)
* [POSIX `rename`](https://pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html)
* [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir-spec/latest/)
* [SQLx](https://docs.rs/sqlx/latest/sqlx/) and [`sqlx::migrate!`](https://docs.rs/sqlx/latest/sqlx/macro.migrate.html)
* [SQLite write-ahead logging](https://www.sqlite.org/wal.html) and [`synchronous`](https://www.sqlite.org/pragma.html#pragma_synchronous)
* [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html)
* [PostgreSQL `sha256`](https://www.postgresql.org/docs/current/functions-binarystring.html)
* [Diesel](https://diesel.rs/), [SeaORM](https://www.sea-ql.org/SeaORM/), [rusqlite](https://docs.rs/rusqlite/latest/rusqlite/), and [`notify`](https://docs.rs/notify/latest/notify/)

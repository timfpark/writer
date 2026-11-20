---
title: "ADR 0005: Workspace model, autosave, and API"
description: Defines folders and documents with client-generated identifiers and one manual sibling order, bounds the workspace so its tree is read whole, and specifies the workspace API, autosave with revision tokens and conflict recovery, the domain crate, and where version history attaches later
author: Tim Park
ms.date: 2026-11-20
ms.topic: reference
status: Accepted
subsystems:
  - service
  - webapp
keywords:
  - adr
  - workspace
  - folders
  - documents
  - autosave
  - optimistic concurrency
  - idempotency
  - version history
estimated_reading_time: 20
---

## Status

Accepted on 2026-11-20.

Amended on 2026-11-20 by [ADR 0006](./0006-storage-architecture.md), which
settles the storage [follow-up decisions](#follow-up-decisions): identifiers,
titles, and order live in one workspace index, revisions are content hashes,
and saves check the file again immediately before replacing it. It reads the
promise that two contents never share a revision as holding up to a hash
collision. It also amends [Deleting an item](#deleting-an-item): a 500 from
a structural change may follow a change that committed, which the retry
rules here make safe, and the tree is still entirely old or entirely new.

Amended on 2026-11-20 by [ADR 0007](./0007-webapp-interface.md), which
settles the webapp interface [follow-up decisions](#follow-up-decisions):
`/documents/{documentId}` URLs, TanStack Query applying tree changes in
order and rolling back by refetching the tree, and IndexedDB holding
unacknowledged text per document and browser tab.

Amended on 2026-11-20 by [ADR 0008](./0008-editor.md), which settles the
editor [follow-up decisions](#follow-up-decisions): the supported Markdown
subset and its canonical form, raw source for Markdown outside it, identical
bytes for content the writer has not changed, and the autosave timing and
flush events.

## Decision summary

* Model the workspace as one tree of folders and documents. Folders nest up
  to depth 16, documents are leaves holding UTF-8 Markdown of at most 1 MiB,
  folders and documents share one manually ordered sequence per parent, and
  the workspace holds at most 10,000 items.
* Identify every item by a lowercase UUID the client generates at creation,
  unique across both kinds and unchanged by rename and move. Titles are 1 to
  200 characters with no control characters or surrounding whitespace, and
  siblings may share a title.
* Read the whole tree with `GET /api/v1/workspace` as a flat, pre-order
  `items` list; the item limit bounds it, so it is not paginated.
* Create with `POST /api/v1/folders` and `POST /api/v1/documents` carrying the
  client's identifier, so a repeated create returns the existing item with
  200. Change a title, position, or content with `PUT` on the item's `title`,
  `position`, or `content` sub-resource, never `PATCH`. Deleting a folder
  permanently deletes its subtree.
* Save a document by sending its whole content with the `baseRevision` the
  edits started from. A stale base returns `409` with code `conflict` and
  leaves the stored content unchanged, unless the content is identical. The
  client recovers by keeping its text in the document and saving the stored
  version as a sibling copy, so neither version is lost.
* Keep the model's types and rules in a pure `writer-domain` crate at the
  bottom of ADR 0002's dependency direction. Version history arrives later as
  additive commit resources keyed by the same identifiers.

## Context

The [README](../../README.md#product-direction) sets the first release's
direction: a navigator showing a tree of folders and documents, a writing
surface, and transparent autosave, with storage behind interchangeable
backends. Writers create, rename, delete, move, and manually reorder folders
and documents at any level. Documents are Markdown, edited in a rich-text
surface. The first backend mirrors the tree as directories and `.md` files
that other tools can read and edit, and SQLite and PostgreSQL backends follow
without changing the API.

The first release has one local user and one service process, but not one
editor: a writer can open Writer in two browser tabs, and can edit a file in
the workspace's data folder with another tool while Writer runs. Saving
therefore has to detect writes it did not expect rather than assume it is the
only writer.

[ADR 0002](./0002-service-architecture.md#crate-layout) expects a pure domain
crate below `writer-api` and leaves its name to the work that needs it.
[ADR 0004](./0004-api-conventions.md) sets paths, fields, and errors, and its
[deferred decisions](./0004-api-conventions.md#deferred-decisions) each reopen
here: renaming and moving are the first partial updates, creating a document
is the first `POST` that creates durable state, and the workspace tree is the
first collection whose size the service might not bound.

Later decisions build on this one. The storage ADR
([ADR 0006](./0006-storage-architecture.md)) persists the model
and derives revision tokens, the editor ADR
([ADR 0008](./0008-editor.md)) chooses the Markdown subset and
when autosave fires, and the webapp interface ADR
([ADR 0007](./0007-webapp-interface.md)) chooses routing and server-state
caching. A later release adds change control in the style of
Git, where the writer commits a set of changes as one atomic revision and can
view or roll back to earlier states. This record leaves room for it without
designing it.

## Decision drivers

* One model that a filesystem, SQLite, or PostgreSQL backend stores without
  changing the API
* Identity that survives rename and move, so an open document's URL, the
  navigator's expansion state, and later history keep pointing at the same
  item
* Optimistic interface updates and safe retries without bookkeeping in the
  service
* Autosave that never loses text, including text changed outside Writer or
  in a second tab
* Operations that follow ADR 0004 with as few new conventions as possible
* Room for committed history without breaking `v1`

## Considered options

### Hierarchy and sibling order

1. Folders first, then documents, each sorted by title, as file managers do.
   Nothing stores order, but writers cannot arrange chapters in reading order
   without numbering their titles.
2. Separate manual orders for folders and for documents. Order is stored, but
   a writer cannot place a folder of research notes between two chapters.
3. One manual order per parent shared by folders and documents, as
   Scrivener's binder works. Every arrangement a writer can draw is possible,
   and the order lives outside titles, which the storage ADR must then store.

### Identifiers

1. Paths derived from titles, such as `/drafts/chapter-one`. They change on
   every rename and move, break open URLs and history, and put manuscript
   titles in URLs and logs, which ADR 0004 keeps manuscript text out of.
2. Opaque identifiers the service generates. The client cannot address a new
   item until the create response arrives, so an optimistic create needs a
   temporary identifier and a remapping step, and a create retried after a
   lost response makes a duplicate.
3. UUIDs the client generates. The client knows the final identifier before
   it sends the request, so a new document can open, take typing, and queue
   its first save immediately, and the identifier doubles as an idempotency
   key. The service must validate the format and trust clients not to reuse
   one.

### Reading the tree

1. The whole tree in one response, with the workspace's size bounded. One
   request draws the navigator, restores expansion state, counts what a
   folder deletion removes, and checks a drop target without more calls.
2. One folder at a time, loaded on expansion. Restoring a deeply expanded
   tree after a reload cascades into one request per level, the client
   cannot count or validate a subtree it has not loaded, and each folder's
   listing still needs a bound or pagination.
3. The whole tree with cursor pagination. A partially loaded tree is hard to
   draw or validate, and a tree bounded at a few megabytes does not need it.

### Changing a title, position, or content

1. `PATCH` on the item with optional fields, in the style of JSON Merge
   Patch. One operation covers everything, but `parentId: null`, meaning the
   top level, is then both optional and nullable, which ADR 0004 forbids, and
   it mixes a content write that needs a revision check with metadata writes
   that do not.
2. Action endpoints such as `POST /api/v1/documents/{documentId}/moves`. They
   read naturally but are not idempotent, and ADR 0004 reserves `POST` to a
   plural noun for creating resources and computing results.
3. `PUT` on singleton sub-resources: `title`, `position`, and `content`. Each
   replaces one aspect completely, is idempotent by HTTP semantics, and has
   only required fields, so no rule for "unchanged" versus "cleared" is
   needed.

### Create idempotency

1. An `Idempotency-Key` request header. The service stores each key with its
   response for a retention window, so every backend needs a key store, which
   the filesystem backend has no natural place for.
2. Client-generated identifiers with create-or-replace `PUT` on the item's
   path. Creation and content replacement would share one method and path,
   and a `PUT` that silently creates a deleted document is surprising.
3. Client-generated identifiers in the `POST` body. The identifier is the
   idempotency key, and the item itself records that the create happened.

### Deletion

1. Permanent and recursive, after a confirmation in the navigator.
2. A trash: deletion moves items aside, with operations to list, restore, and
   empty, a view to show them, and storage for trashed items in every
   backend.
3. Refusing to delete a folder that is not empty, which makes removing a
   project a tedious bottom-up walk.

### Detecting a stale write

1. Last write wins. An edit made outside Writer, or in another tab, is
   overwritten without notice.
2. `ETag` and `If-Match` headers with `412 Precondition Failed`. Standard
   HTTP, but the token travels in headers the generated client does not type,
   and 412 is outside ADR 0004's problem table.
3. A revision token in JSON bodies, with `409 conflict` when it is stale.
   Typed in the contract and covered by ADR 0004's existing code.
4. Operational transformation or a CRDT that merges concurrent edits. Merges
   without asking, but needs per-keystroke operations, a merge engine in the
   service, and editor integration, all for one writer.

### Recovering from a conflict

1. Show both versions and make the writer choose before saving resumes. It
   interrupts writing, and text typed while the choice is pending is lost if
   the tab closes.
2. Load the stored version into the editor, discarding local text. It loses
   the writer's text.
3. Preserve both automatically: keep the writer's text in the document, save
   the stored version as a sibling copy, and say so. Nothing is lost and the
   cursor stays put; merging the two is left to the writer.

## Decision

### Items and hierarchy

The service holds one workspace: a tree of items, each a folder or a
document. Items at the top level have no parent; there is no root item in the
API.

* A folder contains folders and documents. A document contains no items.
* Each parent's children form one ordered sequence that mixes both kinds.
  Order is manual: the service never sorts, and an item stays where it was
  created or last moved.
* A top-level item is at depth 1. No item is deeper than 16.
* The workspace holds at most 10,000 items.

The limits bound what the service stores and returns. A request that would
break one fails with `422 validationFailed`, and nothing changes:

| Rule                     | Limit                                                            | Error pointer                |
|--------------------------|------------------------------------------------------------------|------------------------------|
| Items in the workspace   | 10,000                                                           | `""`                         |
| Depth of any item        | 16                                                               | `/parentId`                  |
| Title                    | 1 to 200 characters, as [Titles](#titles) defines                | `/title`                     |
| Document content         | 1 MiB (1,048,576 bytes of UTF-8), as [Content](#content) defines | `/markdown`                  |
| Identifier of a new item | Lowercase hyphenated UUID                                        | `/folderId` or `/documentId` |

How a backend treats content created outside Writer that breaks a limit, such
as a directory nested 20 levels deep, is the storage ADR's decision, within
one constraint: the tree the service returns stays within the bounds above.

### Identifiers

* Every item has an `id`: a UUID (RFC 9562) in lowercase hyphenated form,
  such as `3f2c8a10-6b1e-4d4a-9c55-0e7b2d9a41f3`. Identifiers are unique
  across folders and documents.
* The client generates the identifier of an item it creates, with
  `crypto.randomUUID()` in the webapp, and never reuses one. The service
  accepts any UUID version in a create request and rejects any other string
  with 422. When a backend finds an item Writer did not create, such as a
  file added outside Writer, it assigns a version 4 UUID itself.
* An identifier never changes. Rename and move keep it, and it is never
  derived from a title or a storage location.
* Otherwise clients treat identifiers as opaque, as ADR 0004 requires. The
  service looks up a path identifier as a string and returns 404 when it
  names no item of the path's kind, whatever its form.

### Titles

* A title has 1 to 200 characters, counted as Unicode scalar values. In
  TypeScript, count with `[...title].length`, not `title.length`, which counts
  UTF-16 code units.
* A title has no leading or trailing whitespace (Unicode `White_Space`), no
  control characters (general category `Cc`, including tabs and line breaks),
  and no line or paragraph separators (U+2028, U+2029).
* The service rejects a title that breaks a rule rather than repairing it, so
  a title always reads back exactly as sent; the client trims before sending.
  The service applies no Unicode normalization.
* Siblings may share a title, in any case. Identity is the identifier, so
  "Untitled" or "Notes" can repeat and a move never fails over a name.
* Every backend accepts every valid title. A backend that names files after
  titles maps characters its file systems reject, reserved names, length,
  case-insensitive collisions, and duplicates to file names itself, as the
  storage ADR decides. It never rejects a title the model allows, and never
  changes the title the API returns.
* Titles are manuscript text under ADR 0004: they never appear in a path,
  query string, problem `detail`, or log line.

### Content

* A document's content is UTF-8 Markdown, carried as the JSON string field
  `markdown`. The [editor ADR](./0008-editor.md#supported-markdown) decides the
  supported subset and the canonical form the editor writes.
* The service does not parse, reformat, or normalize content, including line
  endings and Unicode, and returns exactly the text it stores. The one
  character it rejects is U+0000, which PostgreSQL text columns cannot hold.
* Content excludes the title, which is not repeated as a heading, and any
  metadata a backend stores alongside it, such as front matter the storage
  ADR might add.
* Content is at most 1 MiB, measured in UTF-8 bytes after JSON decoding.
  That holds about 170,000 English words, a whole novel, while keeping each
  autosave request and the editor's working set small.
* `createDocument` and `replaceDocumentContent`, the two operations that
  carry content, accept request bodies up to 8 MiB. JSON escaping takes at
  most six bytes per character, so 1 MiB of any permitted text plus the
  other fields always reaches validation and is reported against
  `/markdown`. Larger bodies return 413. Other operations keep axum's 2 MiB
  default.
* A new document's content is empty unless its create request supplies some.

### Reading the workspace

`GET /api/v1/workspace` returns the whole tree as a flat list in pre-order:
each folder is followed by its subtree before its next sibling, and siblings
appear in their order. A client builds each parent's children in order of
appearance and finds an item's depth from its ancestors. The list carries no
content.

Each `WorkspaceItem` holds `id`, `kind`, `parentId`, and `title`. `kind` is
`folder` or `document`, and `parentId` is `null` at the top level. Under
ADR 0004, adding a kind is a breaking change, because `kind` is a response
enum.

The item limit bounds the response. A workspace of a few hundred items is
tens of kilobytes, and one at the 10,000 item limit is about 2 MB, which a
loopback service returns in milliseconds. The response is not paginated,
because the service bounds its size; this does not meet ADR 0004's trigger
for choosing a pagination scheme.

### Operations

Every operation follows ADR 0004. Tags are `workspace`, `folders`, and
`documents`. Every operation documents 500, and every operation with a
request body also documents 400, 413, 415, and 422.

| Operation                  | Method and path                               | Operation ID              | Request body             | Success               | Error statuses                    |
|----------------------------|-----------------------------------------------|---------------------------|--------------------------|-----------------------|-----------------------------------|
| Read the tree              | `GET /api/v1/workspace`                       | `getWorkspace`            | None                     | 200 `Workspace`       | 500                               |
| Create a folder            | `POST /api/v1/folders`                        | `createFolder`            | `CreateFolderRequest`    | 201 or 200 `Folder`   | 400, 409, 413, 415, 422, 500      |
| Read a folder              | `GET /api/v1/folders/{folderId}`              | `getFolder`               | None                     | 200 `Folder`          | 404, 500                          |
| Rename a folder            | `PUT /api/v1/folders/{folderId}/title`        | `replaceFolderTitle`      | `ReplaceTitleRequest`    | 200 `Folder`          | 400, 404, 413, 415, 422, 500      |
| Move or reorder a folder   | `PUT /api/v1/folders/{folderId}/position`     | `replaceFolderPosition`   | `ReplacePositionRequest` | 200 `Folder`          | 400, 404, 409, 413, 415, 422, 500 |
| Delete a folder            | `DELETE /api/v1/folders/{folderId}`           | `deleteFolder`            | None                     | 204                   | 404, 500                          |
| Create a document          | `POST /api/v1/documents`                      | `createDocument`          | `CreateDocumentRequest`  | 201 or 200 `Document` | 400, 409, 413, 415, 422, 500      |
| Read a document            | `GET /api/v1/documents/{documentId}`          | `getDocument`             | None                     | 200 `Document`        | 404, 500                          |
| Read a document's content  | `GET /api/v1/documents/{documentId}/content`  | `getDocumentContent`      | None                     | 200 `DocumentContent` | 404, 500                          |
| Save a document's content  | `PUT /api/v1/documents/{documentId}/content`  | `replaceDocumentContent`  | `ReplaceContentRequest`  | 200 `Document`        | 400, 404, 409, 413, 415, 422, 500 |
| Rename a document          | `PUT /api/v1/documents/{documentId}/title`    | `replaceDocumentTitle`    | `ReplaceTitleRequest`    | 200 `Document`        | 400, 404, 413, 415, 422, 500      |
| Move or reorder a document | `PUT /api/v1/documents/{documentId}/position` | `replaceDocumentPosition` | `ReplacePositionRequest` | 200 `Document`        | 400, 404, 409, 413, 415, 422, 500 |
| Delete a document          | `DELETE /api/v1/documents/{documentId}`       | `deleteDocument`          | None                     | 204                   | 404, 500                          |

The schemas, all named under `components`. Every field is a string unless the
table says otherwise, and every field is required:

| Schema                   | Fields                                                                                       |
|--------------------------|----------------------------------------------------------------------------------------------|
| `Workspace`              | `items` (array of `WorkspaceItem`)                                                           |
| `WorkspaceItem`          | `id`, `kind` (`ItemKind`), `parentId` (nullable), `title`                                    |
| `ItemKind`               | Enum: `folder`, `document`                                                                   |
| `Folder`                 | `id`, `parentId` (nullable), `title`                                                         |
| `Document`               | `id`, `parentId` (nullable), `title`, `revision`                                             |
| `DocumentContent`        | `markdown`, `revision`                                                                       |
| `CreateFolderRequest`    | `folderId`, `parentId` (nullable), `beforeId` (nullable), `title`                            |
| `CreateDocumentRequest`  | `documentId`, `parentId` (nullable), `beforeId` (nullable), `title`, and optional `markdown` |
| `ReplaceTitleRequest`    | `title`                                                                                      |
| `ReplacePositionRequest` | `parentId` (nullable), `beforeId` (nullable)                                                 |
| `ReplaceContentRequest`  | `markdown`, `baseRevision`                                                                   |

`parentId` and `beforeId` in requests are required and nullable
(`#[schema(required = true)]`, generating `string | null`), because `null`
means something: the top level, or the end of the sibling list. The service
rejects a body that omits either one with 422, so a missing field never
silently moves an item. Request types reject unknown fields, as ADR 0004
requires. `markdown` in `CreateDocumentRequest` follows ADR 0004's optional
request field rule and defaults to empty.

#### Placing an item

Creating and moving an item place it with the same two fields:

* `parentId` names the folder to place the item in, or is `null` for the top
  level.
* `beforeId` names the sibling to place the item before, or is `null` for the
  end of the parent's children. Dropping an item after its last sibling is
  therefore `beforeId: null`.

Reordering is a move that keeps `parentId`. A move within the item's current
parent whose `beforeId` names the item itself leaves it where it is. The request returns 409 `conflict` when
the workspace contradicts it: `parentId` names no folder, `beforeId` names no
child of that parent, or `parentId` is the moved folder itself or one of its
descendants. These usually mean the client's copy of the tree is stale; the
client rolls back its optimistic change and reloads the tree. A move that
would put any item of the moved subtree deeper than 16 returns 422 against
`/parentId`.

Titles and positions carry no revision: two tabs that rename the same item
both succeed, in the order the service receives them.

#### Creating an item

* A create returns 201 with a `Location` header naming the new item, such as
  `/api/v1/documents/{documentId}`, and the item in the body.
* When an item with the requested identifier already exists and is of the
  same kind, the create changes nothing and returns 200 with the item as it
  is now. The service does not compare the rest of the body, because a later
  rename or move may already have changed the item. A client can therefore
  retry a create whose response it never received.
* A 200 replay of `createDocument` returns the document's current revision,
  which may already reflect a save the client never saw, such as one from
  another tab. Before adopting it as a base, the client reads the content
  with `getDocumentContent`: if the content equals what the create sent, it
  adopts the revision; otherwise it follows the conflict recovery under
  [Presenting saves and recovering](#presenting-saves-and-recovering) from
  step 3.
* The service keeps no record of deleted identifiers, so a create retried
  after another tab deleted the new item creates it again. With one writer
  this needs a lost response and a deletion within one retry window, and it
  restores rather than loses text.
* When the identifier belongs to an item of the other kind, the create
  returns 409 `conflict`.
* The item limit, depth limit, title rules, and content limit return 422.
  `parentId` and `beforeId` return 409 as [Placing an item](#placing-an-item)
  describes.

#### Deleting an item

* Deleting a folder deletes it and every item below it. The deletion is all
  or nothing: afterwards either the whole subtree is gone or all of it
  remains. A failure response usually means all of it remains, but a 500
  can follow a deletion that committed, as ADR 0006 explains, and a retry
  then returns 404. The storage ADR decides how each backend achieves that.
* Deletion is permanent. There is no trash in the first release; the
  navigator confirms first and says how many items a folder deletion
  removes, as [backlog 22](../backlog/0022-workspace-navigator.md) describes.
* Deleting an item that does not exist returns 404. A client retrying a
  delete treats 404 as success.

### Autosave and stale writes

#### Revisions

Each document has a `revision`: an opaque string that changes whenever its
content changes, through Writer or, in the filesystem backend, through an
edit made outside it. Renaming or moving a document does not change it.
Clients compare revisions only for equality and never parse them. The storage
ADR derives them, for example from a hash of the content; the contract
promises only that two different contents never share a revision of the same
document.

A revision identifies the working state. It is not a committed revision in
the sense of later history, and history will not expose it.

#### Saving

* Each save sends the document's whole content to `replaceDocumentContent`
  with `baseRevision`: the revision of the content the client's edits
  started from, taken from `getDocumentContent`, `createDocument`, or its
  previous successful save. Saves never send diffs.
* A client keeps at most one save in flight per document, because the next
  save needs the revision the current one returns. Edits made meanwhile go
  into the next save.
* The [editor ADR](./0008-editor.md#autosave-timing-and-flush-events) sets
  when saves happen: the idle delay, the maximum delay while typing
  continues, and the events that flush pending changes.

#### The stale-write rule

The storage layer compares `baseRevision` with the current revision and
replaces the content in one step that no other request to the service can
interleave with:

* When `baseRevision` equals the current revision, the content is replaced
  and the response is 200 with the `Document` and its new revision.
* When the submitted content equals the stored content, the response is 200
  with the current revision, whatever `baseRevision` holds. A retry of a save
  that succeeded but whose response was lost therefore succeeds, and a second
  tab that sends identical text causes no conflict.
* Otherwise the response is 409 with code `conflict`, and the stored content
  is unchanged. The problem names no content and no revision.

`replaceDocumentContent` returns the document's metadata rather than its
content. Echoing up to 1 MiB of text back on every autosave would add nothing
the client lacks.

A program outside Writer that writes a file in the filesystem backend's data
folder does not take part in that step. An outside edit that lands between
the check and the replacement, a window of milliseconds, could still be
overwritten. The storage ADR decides how its backend narrows that window or
detects and preserves such an edit, for example by checking the file again
immediately before replacing it.

#### Presenting saves and recovering

The header shows one save status for the open document: saved, saving,
retrying while the service is unreachable or returns a 5xx status, or in
conflict, as [backlog 23](../backlog/0023-writing-surface.md) builds. Until
the service acknowledges a save that contains it, the client never discards
the writer's text. A network failure or 5xx response is retried with the
same `baseRevision`, which the stale-write rule makes safe.

Holding text in memory is not enough, because the writer can close the tab
or reload while the service is unreachable or a conflict is unresolved. The
client therefore also writes each document's unacknowledged text, with its
`baseRevision`, to browser storage, clears it once a save containing that
text is acknowledged, and on reopening saves any text it finds through the
same stale-write rule, so a stale base leads to the recovery below rather
than an overwrite. The webapp interface ADR
([ADR 0007](./0007-webapp-interface.md#browser-storage)) chooses the storage
mechanism.

On a 409 from `replaceDocumentContent`, the client recovers without losing
either version:

1. It shows the conflict status and pauses autosave for the document. The
   writer keeps typing, and the local text stays in the editor.
2. It reads the stored content and revision with `getDocumentContent`.
3. If the stored content equals the local text, it adopts that revision and
   resumes autosave.
4. Otherwise it creates a document with a new identifier directly after the
   original in the same folder, holding the stored content, with a title
   derived from the original's that marks it as the other version and stays
   within 200 characters. Backlog 23 chooses the wording. If the copy cannot
   be created, for example because the workspace is at its item limit, the
   client stops here: it leaves the original unchanged, keeps the local text
   in browser storage, and shows the problem and the conflict status until
   the writer makes room, then resumes from step 2.
5. It saves the local text to the original document with `baseRevision` set
   to the revision from step 2, only after the copy is acknowledged. A
   further 409 repeats from step 2.
6. It shows a notice naming the copy, which stays until the writer dismisses
   it, and returns the status to saved.

The writer's place in the editor never moves, both versions are stored, and
merging them is the writer's choice. When a save returns 404 because the
document was deleted elsewhere, the client creates a new document holding
the local text, with the same title, in the original folder if it still
exists or at the top level otherwise, opens it, and says so. When a save
returns 422 or 413 because the content exceeds its limit, the client keeps
the text, shows the problem, and does not retry until the content changes.

### Examples

The examples use synthetic identifiers and prose. A tree with a folder
holding a document and a subfolder, and a top-level document:

```http
GET /api/v1/workspace

HTTP/1.1 200 OK
Content-Type: application/json

{"items":[{"id":"3f2c8a10-6b1e-4d4a-9c55-0e7b2d9a41f3","kind":"folder","parentId":null,"title":"The lighthouse"},{"id":"c7e5b3a1-9d2f-4e8c-a6b4-1f3e5d7c9b2a","kind":"document","parentId":"3f2c8a10-6b1e-4d4a-9c55-0e7b2d9a41f3","title":"Chapter one"},{"id":"8a41d7e2-2c90-4f6b-b1a3-5d6e7f809a1b","kind":"folder","parentId":"3f2c8a10-6b1e-4d4a-9c55-0e7b2d9a41f3","title":"Drafts"},{"id":"5b9d1f3e-7a2c-4c6e-8b0a-2d4f6e8a0c1b","kind":"document","parentId":null,"title":"Notes"}]}
```

Creating the `Drafts` folder at the end of `The lighthouse`. Sending the same
request again returns `200 OK` with the same body and no `Location`:

```http
POST /api/v1/folders
Content-Type: application/json

{"folderId":"8a41d7e2-2c90-4f6b-b1a3-5d6e7f809a1b","parentId":"3f2c8a10-6b1e-4d4a-9c55-0e7b2d9a41f3","beforeId":null,"title":"Drafts"}

HTTP/1.1 201 Created
Content-Type: application/json
Location: /api/v1/folders/8a41d7e2-2c90-4f6b-b1a3-5d6e7f809a1b

{"id":"8a41d7e2-2c90-4f6b-b1a3-5d6e7f809a1b","parentId":"3f2c8a10-6b1e-4d4a-9c55-0e7b2d9a41f3","title":"Drafts"}
```

Reading a folder:

```http
GET /api/v1/folders/8a41d7e2-2c90-4f6b-b1a3-5d6e7f809a1b

HTTP/1.1 200 OK
Content-Type: application/json

{"id":"8a41d7e2-2c90-4f6b-b1a3-5d6e7f809a1b","parentId":"3f2c8a10-6b1e-4d4a-9c55-0e7b2d9a41f3","title":"Drafts"}
```

Renaming it:

```http
PUT /api/v1/folders/8a41d7e2-2c90-4f6b-b1a3-5d6e7f809a1b/title
Content-Type: application/json

{"title":"Earlier drafts"}

HTTP/1.1 200 OK
Content-Type: application/json

{"id":"8a41d7e2-2c90-4f6b-b1a3-5d6e7f809a1b","parentId":"3f2c8a10-6b1e-4d4a-9c55-0e7b2d9a41f3","title":"Earlier drafts"}
```

Moving it before `Chapter one`, after another tab has already moved
`Chapter one` to the top level:

```http
PUT /api/v1/folders/8a41d7e2-2c90-4f6b-b1a3-5d6e7f809a1b/position
Content-Type: application/json

{"parentId":"3f2c8a10-6b1e-4d4a-9c55-0e7b2d9a41f3","beforeId":"c7e5b3a1-9d2f-4e8c-a6b4-1f3e5d7c9b2a"}

HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{"type":"about:blank","title":"Conflict","status":409,"detail":"The target position does not exist in the workspace.","code":"conflict","errors":[]}
```

Deleting it with its subtree:

```http
DELETE /api/v1/folders/8a41d7e2-2c90-4f6b-b1a3-5d6e7f809a1b

HTTP/1.1 204 No Content
```

Creating `Chapter one` before `Drafts`, with no initial content:

```http
POST /api/v1/documents
Content-Type: application/json

{"documentId":"c7e5b3a1-9d2f-4e8c-a6b4-1f3e5d7c9b2a","parentId":"3f2c8a10-6b1e-4d4a-9c55-0e7b2d9a41f3","beforeId":"8a41d7e2-2c90-4f6b-b1a3-5d6e7f809a1b","title":"Chapter one"}

HTTP/1.1 201 Created
Content-Type: application/json
Location: /api/v1/documents/c7e5b3a1-9d2f-4e8c-a6b4-1f3e5d7c9b2a

{"id":"c7e5b3a1-9d2f-4e8c-a6b4-1f3e5d7c9b2a","parentId":"3f2c8a10-6b1e-4d4a-9c55-0e7b2d9a41f3","title":"Chapter one","revision":"q7Kx2mP9"}
```

Reading the document and its content:

```http
GET /api/v1/documents/c7e5b3a1-9d2f-4e8c-a6b4-1f3e5d7c9b2a

HTTP/1.1 200 OK
Content-Type: application/json

{"id":"c7e5b3a1-9d2f-4e8c-a6b4-1f3e5d7c9b2a","parentId":"3f2c8a10-6b1e-4d4a-9c55-0e7b2d9a41f3","title":"Chapter one","revision":"q7Kx2mP9"}
```

```http
GET /api/v1/documents/c7e5b3a1-9d2f-4e8c-a6b4-1f3e5d7c9b2a/content

HTTP/1.1 200 OK
Content-Type: application/json

{"markdown":"","revision":"q7Kx2mP9"}
```

Saving content, then a second tab, still holding the old revision, saving
different text:

```http
PUT /api/v1/documents/c7e5b3a1-9d2f-4e8c-a6b4-1f3e5d7c9b2a/content
Content-Type: application/json

{"markdown":"The keeper climbed the stairs twice before lighting the lamp.\n","baseRevision":"q7Kx2mP9"}

HTTP/1.1 200 OK
Content-Type: application/json

{"id":"c7e5b3a1-9d2f-4e8c-a6b4-1f3e5d7c9b2a","parentId":"3f2c8a10-6b1e-4d4a-9c55-0e7b2d9a41f3","title":"Chapter one","revision":"Zr4tB8wN"}
```

```http
PUT /api/v1/documents/c7e5b3a1-9d2f-4e8c-a6b4-1f3e5d7c9b2a/content
Content-Type: application/json

{"markdown":"The keeper waited for the tide.\n","baseRevision":"q7Kx2mP9"}

HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{"type":"about:blank","title":"Conflict","status":409,"detail":"The document changed after the base revision.","code":"conflict","errors":[]}
```

Renaming the document with a title that is only whitespace:

```http
PUT /api/v1/documents/c7e5b3a1-9d2f-4e8c-a6b4-1f3e5d7c9b2a/title
Content-Type: application/json

{"title":"   "}

HTTP/1.1 422 Unprocessable Entity
Content-Type: application/problem+json

{"type":"about:blank","title":"Unprocessable Entity","status":422,"detail":"The request body is invalid.","code":"validationFailed","errors":[{"pointer":"/title","detail":"Must be 1 to 200 characters with no surrounding whitespace or control characters."}]}
```

Moving `Notes` to the end of `The lighthouse`:

```http
PUT /api/v1/documents/5b9d1f3e-7a2c-4c6e-8b0a-2d4f6e8a0c1b/position
Content-Type: application/json

{"parentId":"3f2c8a10-6b1e-4d4a-9c55-0e7b2d9a41f3","beforeId":null}

HTTP/1.1 200 OK
Content-Type: application/json

{"id":"5b9d1f3e-7a2c-4c6e-8b0a-2d4f6e8a0c1b","parentId":"3f2c8a10-6b1e-4d4a-9c55-0e7b2d9a41f3","title":"Notes","revision":"Hc6yW1sD"}
```

Deleting it, then repeating the request:

```http
DELETE /api/v1/documents/5b9d1f3e-7a2c-4c6e-8b0a-2d4f6e8a0c1b

HTTP/1.1 204 No Content
```

```http
DELETE /api/v1/documents/5b9d1f3e-7a2c-4c6e-8b0a-2d4f6e8a0c1b

HTTP/1.1 404 Not Found
Content-Type: application/problem+json

{"type":"about:blank","title":"Not Found","status":404,"detail":"The requested resource does not exist.","code":"notFound","errors":[]}
```

The generated types for placing an item:

```ts
ReplacePositionRequest: {
    beforeId: string | null;
    parentId: string | null;
};
```

### Domain crate

The model's types and rules live in `writer-domain` (planned, at
`service/crates/writer-domain/`), the pure domain crate ADR 0002 anticipates.
[Backlog 18](../backlog/0018-workspace-storage.md) creates it.

* It defines identifiers, item kinds, titles, content, revisions as opaque
  values, the limits, and a workspace tree that upholds the rules above:
  one shared sibling order, depth, item count, and no cycles.
* It validates each operation against a tree and returns domain errors that
  say whether the request breaks a field rule or conflicts with the tree,
  which `writer-api` maps to 422 with a pointer or to 409.
* It performs no I/O and depends on no internal crate, Tokio, axum, Tower, or
  utoipa, so its tests run without a runtime. Small pure dependencies, such
  as a UUID parser, are added when needed.

The dependency direction becomes `writer-server` → `writer-api` → the storage
crate the storage ADR names → `writer-domain`, and `writer-api` also depends
on `writer-domain` to map transport types to domain types. Transport types
stay in `writer-api`, as ADR 0002 requires. The storage crate applies the
domain checks to the current tree in the same serialized step as the write,
so no concurrent request can change the tree between check and write.

### Attaching version history later

Change control is a later release, designed by its own ADR. This model
leaves it these attachment points:

* The workspace these operations read and change is the working state.
  History is a separate, immutable sequence of commits, each recording the
  whole working state, its tree and every document's content keyed by item
  identifier, with its own commit identifier, parent commit, message, and
  time.
* Because identifiers survive rename and move, history follows a document
  across both and compares its content between any two commits, which
  history keyed by file paths cannot do.
* The API grows additively under `v1`: a `commits` collection to record the
  working state as a commit and to list commits, reads of a commit's tree and
  of a document's content at a commit, and an operation that restores the
  working state, or one document, from a commit. The commit list is the
  first collection without a bound, so it triggers ADR 0004's pagination
  decision. Existing operations keep their shapes; `Workspace` may gain
  response fields, such as whether the working state differs from the latest
  commit, which ADR 0004 treats as additive.
* A restore that changes a document's content changes its revision, so an
  open client's next save of different text returns 409 and follows the
  recovery above. A restore that returns a document to exactly the content
  an open client last read leaves its revision usable, and that client's
  edits then apply on top of the restored text. Either way a rollback never
  silently discards unsaved text.
* Permanent deletion stays permanent in the working state, but a deleted item
  becomes recoverable from any commit that contains it.
* Revisions remain working-state tokens; commits never expose them.

How each backend could store commits is noted by the storage ADR.

## Consequences

Positive outcomes:

* Every backend implements one model with one set of limits, and the domain
  crate enforces them once, before storage sees a request.
* Client-generated identifiers let the navigator create, open, and type into
  a document without waiting, and make creates safe to retry without any
  idempotency store.
* The whole tree arrives in one bounded response, so expansion, counting,
  and drop validation need no further requests.
* Every write can be retried after a lost response or a 5xx status, so the
  client needs no special cases beyond reconciling a replayed document create.
* Autosave through Writer cannot overwrite text it has not seen, unsaved
  text survives a closed tab, and conflict recovery keeps both versions
  without interrupting the writer.
* ADR 0004's deferred decisions on partial updates, idempotency, and
  pagination are settled or bounded for the workspace without a new
  convention beyond required nullable request fields.

Trade-offs and risks:

* The service trusts clients to generate unique identifiers and never reuse
  one; a buggy client reusing an identifier gets the existing item back with
  200 instead of an error. `crypto.randomUUID()` needs a secure context,
  which `localhost` is.
* Fixed limits of 10,000 items, depth 16, and 1 MiB per document are
  judgment calls. Raising one later is not breaking; lowering one is.
* Permanent deletion relies on a confirmation until version history exists.
  A writer who confirms by mistake loses the subtree.
* Every save sends the whole document, which costs bandwidth proportional to
  its size on every autosave. On loopback with a 1 MiB cap this is small.
* Conflict copies can accumulate when two tabs edit one document at once,
  and the writer merges them by hand.
* An edit made outside Writer in the instant between a save's check and its
  replacement can be overwritten unless the storage ADR closes that window.
* A create retried after the new item was deleted elsewhere recreates it,
  because the service keeps no record of deleted identifiers.
* Titles and positions are last write wins, so two tabs renaming one item
  keep the later name without notice.
* `replaceDocumentContent` returns `Document` rather than the content it
  replaced, and a repeated create returns 200 rather than 201; both refine
  ADR 0004's method rules, which that record now notes.

## Revisit triggers

* A workspace nears 10,000 items, or the tree response becomes slow enough to
  notice: consider per-folder reads or pagination, which changes how clients
  read the tree and is breaking once a client ships separately.
* A writer loses work to a confirmed deletion before version history ships:
  add a trash.
* More than one user, or one writer on several devices, edits the same
  workspace: revisit last write wins for metadata, conflict copies, and
  merging, and reconsider client-generated identifiers.
* Conflict copies become common in practice, such as from two open tabs:
  coordinate tabs, for example by letting one tab own a document's saves.
* The webapp is served from an origin that is not a secure context, where
  `crypto.randomUUID()` is unavailable.

## Follow-up decisions

* Storage ([ADR 0006](./0006-storage-architecture.md)): where
  identifiers and order live, title-to-name mapping, the compare-and-replace
  of content and how it guards against edits made outside Writer, revision
  derivation, external edits, all-or-nothing subtree deletion, and content
  created outside Writer that breaks a limit
* Editor ([ADR 0008](./0008-editor.md)): the Markdown subset,
  canonical form, and autosave timing and flush events
* Webapp interface ([ADR 0007](./0007-webapp-interface.md)):
  the URL scheme for open documents, the server-state cache that applies
  optimistic changes, and the browser storage that holds unacknowledged text
* Version history: commits, history reads, restore, and the pagination
  scheme its commit list needs
* A trash, if its trigger occurs

## References

* [RFC 9562: Universally Unique IDentifiers (UUIDs)](https://www.rfc-editor.org/rfc/rfc9562.html)
* [RFC 9110: HTTP Semantics, idempotent methods and conditional requests](https://www.rfc-editor.org/rfc/rfc9110.html)
* [RFC 7396: JSON Merge Patch](https://www.rfc-editor.org/rfc/rfc7396.html)
* [The Idempotency-Key HTTP header field, IETF draft](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)
* [MDN: `Crypto.randomUUID()`](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID)
* [MDN: Secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts)
* [PostgreSQL character types, on the zero character](https://www.postgresql.org/docs/current/datatype-character.html)
* [Unicode character database: `White_Space` and general categories](https://www.unicode.org/reports/tr44/)

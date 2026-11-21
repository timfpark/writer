---
title: "ADR 0007: Webapp styling, typefaces, components, routing, and server state"
description: Selects CSS Modules with typed declarations and design tokens in custom properties, light and dark themes, Newsreader and Inter served from the webapp's own build, React Aria Components for the tree, menus, dialogs, and drag and drop, TanStack Router with /documents/{documentId}, TanStack Query with ordered optimistic tree changes, IndexedDB for unsaved text, Lucide icons, contrast targets, and the supported browsers
author: Tim Park
ms.date: 2026-11-20
ms.topic: reference
status: Accepted
subsystems:
  - webapp
keywords:
  - adr
  - webapp
  - css modules
  - design tokens
  - typography
  - accessibility
  - react aria
  - drag and drop
  - tanstack router
  - tanstack query
  - indexeddb
estimated_reading_time: 18
---

## Status

Accepted on 2026-11-20.

This record settles the routing, styling and components, and server-state
caching that [ADR 0003](./0003-webapp-architecture.md#follow-up-decisions)
left to the first story needing more than one view. It also settles the URL
scheme, optimistic cache, and browser storage that
[ADR 0005](./0005-workspace-model.md#follow-up-decisions) left to this
decision.

Amended on 2026-11-20 by [ADR 0008](./0008-editor.md), which settles the
editor [follow-up decisions](#follow-up-decisions): the bundle budget, with
the editor loaded as its own chunk, the flush events that drive unsaved-text
writes, and document styles built on these tokens, adding `--color-ink` on
`--color-chrome` to the contrast test.

Amended on 2026-11-20 by [ADR 0009](./0009-browser-tests.md), which settles
the browser test engines, including WebKit at iPad sizes with touch, and the
accessibility checker that measures composed contrast.

## Decision summary

* Style with CSS Modules and CSS custom properties. `vite-css-modules`
  generates a declaration for each module, so `tsc` rejects a class that does
  not exist. Components use only semantic color tokens, never raw palette
  values.
* Ship light and dark themes in the first release, chosen by the operating
  system's `prefers-color-scheme`. Interface text meets WCAG 2.2 AA in both
  themes; body text on the writing surface meets at least 10:1, and a Vitest
  test fails the gate when a token pair misses its target.
* Set writing in Newsreader and the interface in Inter, both under the SIL
  Open Font License 1.1, installed from Fontsource packages and emitted into
  `webapp/dist/` with their licenses, so the webapp requests nothing from
  another origin.
* Build the navigator, menus, dialogs, tooltips, and drag and drop on React
  Aria Components. The tree follows the WAI-ARIA treegrid pattern, every row
  has a drag handle and an actions button, and moves are also offered as
  menu commands, as WCAG 2.2's dragging movements criterion requires.
* Route with TanStack Router's code-based, typed route tree: `/` for the
  workspace and `/documents/{documentId}` for an open document.
* Cache server state with TanStack Query. Tree changes show at once as
  pending changes over the cached tree, reach the service in order through
  one mutation scope, and roll back by refetching the tree. Document saves
  stay outside queued mutations.
* Hold each document's unacknowledged text and base revision in IndexedDB
  through `idb`, keyed by document and browser tab, with a Web Lock per tab
  so a closed tab's text is recovered rather than overwritten.
* Lay out for desktop windows and iPad in either orientation, with two fixed
  breakpoints and touch rules keyed to input capability; phones are out of
  scope.
* Use Lucide icons, and support desktop Chrome and Edge 111, Firefox 114, and
  Safari 16.4, and Safari on iPadOS 16.4, and later versions: Vite 8's
  default build target.

## Context

[ADR 0003](./0003-webapp-architecture.md) builds `webapp/` as a
client-rendered React 19 application with Vite 8 and leaves routing, styling
and components, and server-state caching to the first story that needs more
than one view. [ADR 0005](./0005-workspace-model.md) defines the workspace
tree, client-generated identifiers, optimistic structural changes that roll
back on conflict, and autosave that must never discard text the service has
not acknowledged. It leaves the URL scheme, the cache that applies optimistic
changes, and the browser storage for unsaved text to this decision.

The [README](../../README.md#product-direction) describes the workspace: a
header, a navigator showing folders and documents with drag and drop, a
writing surface, and an assistant pane, with both side panes collapsible. The
writing surface is the product's focus, so its typeface and contrast matter
more than anything else on the page. Backlog 20, the workspace shell story,
installed them, and backlogs
[22](../backlog/0022-workspace-navigator.md),
[23](../backlog/0023-writing-surface.md),
[24](../backlog/0024-tree-drag-and-drop.md), and
[26](../backlog/0026-keyboard-accessibility.md) build on these choices.

The first release has one local user on a desktop browser, the service on
loopback, and no hosting beyond the development server. Writing on an iPad
is a longer-term goal, so the interface is designed for iPad now, while
reaching the service from another device waits for a hosting decision.
Phones are not a goal. ADR 0003's
TypeScript settings apply: `strict`, `noUncheckedIndexedAccess`, and
`exactOptionalPropertyTypes`.

A prototype built outside the repository, on Node.js 26.13.1 on a macOS host,
copied the webapp's configuration and installed the candidates through the
npm proxy with install scripts disabled. It generated its client from a
synthetic OpenAPI 3.1 document shaped like ADR 0005's workspace operations
and passed the webapp's format, lint, type, test, and build checks. Against a
stand-in service on loopback, it ran in Chromium: the navigator moved items
by pointer and by keyboard, a 409 rolled a move back, fonts loaded only from
the page's own origin, and unsaved text survived a reload and a closed tab.
Side prototypes installed and built each alternative for comparison. Findings
that shaped this decision are noted where they apply. Adoption figures are
npm weekly downloads for November 13 to 19, 2026, and size deltas are
gzipped JavaScript over a bare React page of 66 KB.

## Decision drivers

* A calm writing surface with a typeface chosen for long-form text and a
  contrast target above the interface's
* Accessible tree, menus, dialogs, and drag and drop, operable by keyboard
  and screen reader, without building those patterns ourselves
* The compiler catching mistakes in class names, routes, and API calls, in
  keeping with ADR 0003's generated contract types
* No request to another origin, so fonts and icons ship in the build
* Few dependencies, exact versions, and no package install scripts
* Optimistic tree changes that cannot leave the tree wrong after a failure
* Unsaved text that survives a reload, a crash, and a closed tab

## Considered options

### Styling

| Option                                     | Packages added | Typed class names                   | Notes                                                          |
|--------------------------------------------|----------------|-------------------------------------|----------------------------------------------------------------|
| CSS Modules with `vite-css-modules` 1.16.1 | 23             | Yes, through generated declarations | Plain CSS; replaces Vite's own CSS Modules handling            |
| CSS Modules alone                          | 0              | No                                  | Fails `tsc` on every React Aria `className` under our settings |
| Tailwind CSS 4.3.5                         | 28             | No                                  | Needs Firefox 128; classes in strings                          |
| vanilla-extract 1.21.3, plugin 5.2.6       | 93             | Yes, from TypeScript sources        | Adds Babel, `vite-node`, and esbuild with an install script    |

1. CSS Modules with custom properties are built into Vite, keep styles in
   plain CSS, and style React Aria's `data-*` state attributes and the
   editor's generated markup with ordinary selectors. Vite types a module's
   classes as an index signature, so under `noUncheckedIndexedAccess` each
   class is `string | undefined`. React Aria's `className` rejects that
   under `exactOptionalPropertyTypes`, and the prototype's `tsc` failed on
   every styled component. A misspelled class is also silently `undefined`.
   `vite-css-modules` 1.16.1 (MIT, October 2026, about 150,000 weekly)
   generates a declaration listing each module's classes, which fixes both:
   in the prototype, `tsc` passed and an unknown class failed it. It
   integrates CSS Modules into Vite's module graph in place of Vite's own
   handling, and one author maintains it.
2. Tailwind CSS 4.3.5 (MIT, about 190 million weekly) compiles utilities
   with a Rust engine through `@tailwindcss/vite`, makes theme values custom
   properties through `@theme`, and has official React Aria starters. It
   built with no install scripts. A misspelled utility generates no CSS and
   no error, every React Aria component carries a long string of
   `data-*` variants, the writing surface and editor content still need
   authored CSS, and Tailwind 4 requires Firefox 128, above Vite's Firefox
   114 target.
3. vanilla-extract 1.21.3 with `@vanilla-extract/vite-plugin` 5.2.6 (MIT,
   about 3.7 million weekly) exports typed classes and token contracts from
   `.css.ts` files with nothing generated on disk, and built on Vite 8. It
   added 93 packages, including Babel, `vite-node`, and esbuild, whose
   install script was the only one in any candidate's tree, and evaluates
   every style file in a second pipeline beside Rolldown.

### Themes

1. Light only, with tokens structured so a dark theme needs no component
   changes later.
2. Light and dark, following `prefers-color-scheme`, with no in-app control.
3. Light and dark with an in-app override stored per browser.

Writers often work at night, and a dark theme is cheap when components never
name a color directly, so the first release ships both, following the
operating system. A theme switch inside Writer can follow when writers ask
for it. CSS `light-dark()` would halve the token declarations but needs
Safari 17.5 and Firefox 120, beyond the supported browsers.

### Typefaces

| Typeface       | Considered for       | Variable axes                            | Latin roman file                 | Fontsource weekly |
|----------------|----------------------|------------------------------------------|----------------------------------|-------------------|
| Newsreader     | Writing              | Optical size 6 to 72, weight 200 to 800  | 132 KB                           | About 880,000     |
| Literata       | Writing              | Optical size 7 to 72, weight 200 to 900  | 110 KB                           | About 200,000     |
| Source Serif 4 | Writing              | Optical size 8 to 60, weight 200 to 900  | 122 KB                           | About 1.3 million |
| IBM Plex Sans  | Writing or interface | Width 75 to 100, weight 100 to 700       | 65 KB                            | About 830,000     |
| Inter          | Interface            | Optical size 14 to 32, weight 100 to 900 | 72 KB, or 48 KB for weight alone | About 13 million  |

Every option is licensed under the SIL Open Font License 1.1.

Literata was drawn for long-form reading on screens and Source Serif 4 is
crisper and more editorial. Newsreader, drawn by Production Type for
continuous reading in news and long-form text, is warmer and more bookish,
and its optical-size axis adapts its letterforms between body text and
headings. It is the product's choice. For the interface, Inter is designed
for small sizes on screens and sits quietly beside a serif. The operating
system's `system-ui` face costs nothing to download but differs on every
platform and pairs unpredictably with Newsreader.

Fontsource publishes each face as an npm package of `woff2` files and
`@font-face` rules split by Unicode range. Google Fonts' CDN and similar
services were not considered, because the story requires no third-party
requests.

### Component primitives

1. React Aria Components 1.22.1 (Adobe, Apache-2.0, about 10 million weekly,
   12 packages) provides an unstyled `Tree` with expansion, type-ahead,
   selection, keyboard navigation, and drag and drop, plus `Menu`,
   `Popover`, `Dialog`, `Modal`, `Tooltip`, and `Toolbar`, all exposing
   state as `data-*` attributes. The tree, menus, dialog, and tooltip added
   91 KB; menus, dialog, and tooltip alone added 50 KB.
2. Radix UI 1.8.1 (MIT, about 30 million weekly, 73 packages) added 31 KB for
   menus, a context menu, a dialog, and a tooltip, but has no tree and no drag
   and drop. We would build the tree pattern ourselves and add a drag-and-drop
   library.
3. Building in-house costs the least bundle and the most accessibility risk:
   the tree pattern alone needs roving focus, type-ahead, expansion,
   announcements, and drag-and-drop semantics.

`Tree` renders the WAI-ARIA treegrid pattern, `treegrid` with `row` and
`gridcell` roles, rather than `tree` and `treeitem`, because a row may hold
buttons and a `treeitem` may not. React Aria's `NavigationTree` wraps `Tree`
for link navigation, but takes no drag-and-drop hooks. React Aria's toast is
still exported as `UNSTABLE_Toast` in 1.22.

### Drag and drop

1. React Aria drag and drop is part of `Tree`. It handles mouse through
   native drag events, touch, keyboard, and screen readers with live
   announcements; offers drop positions before, on, and after each row; and
   scrolls the tree near its edges. React Stately refuses a drop onto a
   dragged item or its descendants. In the prototype, a keyboard user
   dragged a document into a folder through the row's drag button, and a
   pointer drag highlighted its target.
2. dnd-kit's `@dnd-kit/core` 6.3.1 (about 45 million weekly) was last
   released in December 2024; its successor, `@dnd-kit/react` 0.5.3, is
   before 1.0 and added 35 KB. It has no tree, only a sortable-tree example,
   so tree semantics and announcements would be ours.
3. Pragmatic drag and drop 4.0.0 (Atlassian, Apache-2.0) added 6 KB and
   computes before, inside, and after for tree rows, but supports only native
   pointer dragging. Its guidance is to provide menus instead of keyboard
   dragging, and pairing it with React Aria's tree would put two systems on
   the same rows.

WCAG 2.2's dragging movements criterion, 2.5.7 at level AA, requires every
drag to be possible with a single pointer without dragging. Keyboard dragging
does not meet it, so whichever library is chosen, moves also need commands.

### Router

| Router                   | Packages added | Size added | Typed paths and parameters                          |
|--------------------------|----------------|------------|-----------------------------------------------------|
| TanStack Router 1.170.46 | 10             | 25 KB      | Yes, from the route tree                            |
| React Router 8.5.1       | 3              | 29 KB      | Only in framework mode, through generation          |
| wouter 3.13.0            | 3              | 2 KB       | Parameters from the path pattern; links are strings |

1. TanStack Router (MIT, about 28 million weekly) checks `to` paths,
   parameters, and search parameters at compile time once the router is
   registered, without its Vite plugin or a generated route file. Its
   router context carries the query client. It published 15 releases in the
   three months to November 20, 2026.
   On 2026-05-11, an attacker used its release workflow to publish 84
   malicious versions across 42 `@tanstack/*` router and Start packages, with
   a payload that ran at install time
   ([GHSA-g7cv-rxg3-hmpx](https://github.com/advisories/GHSA-g7cv-rxg3-hmpx)).
   TanStack Query was not affected, and `ignore-scripts=true` would have kept
   the payload from running.
2. React Router 8.5.1 (MIT, about 80 million weekly) is the most familiar.
   Its declarative and data modes type every parameter as
   `string | undefined` and every path as a string; typed routes need
   framework mode's Vite plugin and code generation.
3. wouter 3.13.0 (Unlicense, about 2.9 million weekly) is tiny and infers
   parameters from a path pattern, but links are unchecked strings, and it
   has no search-parameter validation or route context.

### Server-state caching

1. TanStack Query 5.107.1 (MIT, about 92 million weekly) caches the tree once
   for the navigator, header, and writing region, deduplicates requests,
   retries, and runs mutations with optimistic updates. A mutation `scope`
   runs mutations sharing it one at a time, in order.
2. `openapi-react-query` 0.5.4 wraps TanStack Query with hooks typed from the
   generated paths. It is before 1.0, was last released in February 2026,
   and its peer range pins `openapi-fetch` to 0.17, so it would gate that
   upgrade. Its path-derived keys do not help optimistic updates, which need
   hand-written cache changes either way.
3. Calling openapi-fetch directly from components leaves caching, request
   deduplication, refetching, ordering, and rollback to hand-written code in
   every view that reads the tree.

### Browser storage for unsaved text

1. IndexedDB is asynchronous, transactional, and has quotas far above 1 MiB
   documents. `idb` 8.0.4 (ISC, about 38 million weekly) adds promises and
   typed stores in about 1 KB. `idb-keyval` 6.3.0 offers only single-key
   operations with no indexes, and Dexie 4.4.7 adds live queries and
   migrations we do not need.
2. `localStorage` is synchronous on the main thread and holds about 5 MB per
   origin of UTF-16 text, so a few unsaved 1 MiB documents exhaust it.
3. `sessionStorage` ends with the tab, which is the case recovery must cover.
4. The origin private file system needs file handles and, for synchronous
   writes, a worker; at this scale it adds machinery without benefit.

### Icons

1. Lucide 1.72.0 (ISC, about 143 million weekly) has a large, consistent
   stroke set including folder, file, panel, grip, and chevron icons, with
   one component per icon so unused icons drop from the build. React Aria's
   own examples use it.
2. Phosphor 2.1.10 (MIT) offers six weights but was last released in May
   2025.
3. Tabler 3.51.0 (MIT) is larger and similar in style, with less adoption.
4. Heroicons (MIT) has about 300 icons and lacks several this interface needs.

## Decision

### Packages

Install these packages, starting on the versions shown. Resolved versions live
in `webapp/package-lock.json`, and upgrading within these choices is a
dependency change, not a new decision.

| Package                           | Starting version | Purpose                                                 | License    |
|-----------------------------------|------------------|---------------------------------------------------------|------------|
| `react-aria-components`           | 1.22.1           | Tree, menus, popovers, dialogs, tooltips, drag and drop | Apache-2.0 |
| `@tanstack/react-router`          | 1.170.46         | Routes and typed links                                  | MIT        |
| `@tanstack/react-query`           | 5.107.1          | Server-state cache and mutations                        | MIT        |
| `idb`                             | 8.0.4            | IndexedDB access for unsaved text                       | ISC        |
| `lucide-react`                    | 1.72.0           | Icons                                                   | ISC        |
| `@fontsource-variable/newsreader` | 5.3.0            | Writing typeface                                        | OFL-1.1    |
| `@fontsource-variable/inter`      | 5.3.0            | Interface typeface                                      | OFL-1.1    |
| `vite-css-modules` (development)  | 1.16.1           | Typed CSS Module declarations                           | MIT        |

In the prototype these added 51 packages, none with an install script, and
none had an advisory in the GitHub Advisory Database. The JavaScript the
browser loads grew from 69 KB to 199 KB gzipped for the shell, the
navigator, and their dependencies, before the editor.

Every webapp dependency is exposed to the same kind of compromised release
that hit TanStack's router packages. Exact versions, the committed lockfile,
and `ignore-scripts` stay in force, and the webapp's Dependabot entry gains a
`cooldown` of 7 days, so a release is proposed only after it has been public
for a week. TanStack's malicious versions had an advisory within five hours.

### Styling and design tokens

Write styles as CSS Modules, one `Component.module.css` beside each component,
using Vite's default CSS pipeline. Vite 8 minifies CSS with Lightning CSS for
the supported browsers, which lowers nesting and other newer syntax; the
prototype's built CSS contained no nesting.

Register `patchCssModules({ generateSourceTypes: true })` from
`vite-css-modules` in `webapp/vite.config.ts`. It writes a
`Component.module.css.d.ts` declaration beside each module whenever the
development server, build, or tests load it. The `typecheck` script becomes
`vite-css-modules --silent && tsc`, so the gate regenerates every declaration
before checking types, and the prototype passed from a clean checkout. The
declarations are generated, so they are ignored by Git, Prettier, and Oxlint,
never committed, and never edited.

Global styles live in `webapp/src/styles/`: `tokens.css` holds every token,
and `global.css` imports the fonts and tokens and sets the page's base styles.
Oxlint's `import/no-unassigned-import` rule allows `**/*.css`, because these
imports exist for their side effects.

Tokens come in two layers. Primitive tokens name raw values, such as
`--paper-50` or `--blue-600`, and appear only in `tokens.css`. Semantic tokens
name roles, such as `--color-page` and `--color-ink`, and are the only color
tokens components use. Other tokens:

| Group            | Tokens                                                                                                                                                           |
|------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Spacing          | `--space-1`, `-2`, `-3`, `-4`, `-6`, `-8`, `-12`, and `-16`: 0.25, 0.5, 0.75, 1, 1.5, 2, 3, and 4 rem                                                            |
| Interface type   | `--text-sm` 0.8125 rem, `--text-md` 0.875 rem (the default), `--text-lg` 1 rem, `--text-xl` 1.25 rem; weights 400, 500, and 600                                  |
| Writing type     | `--writing-size` 1.25 rem, `--writing-leading` 1.6, `--writing-measure` 36 em (about 70 characters); headings 2, 1.5, and 1.25 rem at weight 600                 |
| Families         | `--font-interface`: Inter, then `system-ui`; `--font-writing`: Newsreader, then Georgia; `--font-mono`: `ui-monospace` and system faces, downloaded from nowhere |
| Shape and motion | `--radius-sm` 4 px, `--radius-md` 6 px, `--duration-fast` 150 ms, set to 0 under `prefers-reduced-motion`                                                        |

Sizes are in `rem`, so a writer's browser font size scales the whole
interface. Backlogs 20 and 23 may refine values within these structures;
renaming a token or adding a layer is a change to this record.

### Themes

Ship the light and dark themes the table below defines. `tokens.css` sets the
light values on `:root` with `color-scheme: light`, then sets the dark values
and `color-scheme: dark` inside `@media (prefers-color-scheme: dark)`, so
native controls and scroll bars follow. No component, test, or script
chooses a theme.

| Semantic token          | Role                                  | Light     | Dark      |
|-------------------------|---------------------------------------|-----------|-----------|
| `--color-chrome`        | Header and side panes                 | `#f3f1ec` | `#141312` |
| `--color-chrome-raised` | Menus, popovers, and dialogs          | `#fbfaf7` | `#1f1e1c` |
| `--color-text`          | Interface text                        | `#26241f` | `#e2ded6` |
| `--color-text-muted`    | Secondary interface text              | `#605b52` | `#a8a397` |
| `--color-border`        | Control boundaries                    | `#8a8478` | `#78736a` |
| `--color-accent`        | Focus rings, drop indicators, links   | `#2b5bc6` | `#8db0ff` |
| `--color-current`       | The open document's row               | `#e2e7f4` | `#28303f` |
| `--color-page`          | The writing surface                   | `#fffefa` | `#1d1c1a` |
| `--color-ink`           | Body text on the writing surface      | `#1f1d1a` | `#e6e1d8` |
| `--color-ink-muted`     | Secondary text on the writing surface | `#57524a` | `#b9b3a8` |

In both themes the writing surface is lighter than the chrome around it, so
the page reads as a sheet laid on the workspace. Dark body text is off-white rather than white, which keeps
contrast high without the glare of pure white on near-black.

### Contrast targets

* Interface text and controls meet WCAG 2.2 level AA in both themes: 4.5:1
  for text, 3:1 for large text, and 3:1 for control boundaries, meaningful
  icons, and focus indicators against adjacent colors. Focus stays visible
  and unobscured, and pointer targets, including the tree's drag handles and
  actions buttons, are at least 24 by 24 CSS pixels, and 44 by 44 on touch
  screens, as [Responsive layout and touch](#responsive-layout-and-touch)
  sets.
* Body text on the writing surface meets at least 10:1 against the page in
  both themes, above WCAG's enhanced 7:1. Secondary text on the surface, such
  as block quotes or placeholders, meets at least 7:1.
* Focus indicators use `outline`, which survives forced-colors mode.

The tokens above measure:

| Pair                                            | Target | Light   | Dark    |
|-------------------------------------------------|--------|---------|---------|
| `--color-ink` on `--color-page`                 | 10:1   | 16.66:1 | 13.08:1 |
| `--color-ink-muted` on `--color-page`           | 7:1    | 7.68:1  | 8.17:1  |
| `--color-text` on `--color-chrome`              | 4.5:1  | 13.73:1 | 13.83:1 |
| `--color-text-muted` on `--color-chrome`        | 4.5:1  | 5.97:1  | 7.38:1  |
| `--color-text-muted` on `--color-chrome-raised` | 4.5:1  | 6.46:1  | 6.62:1  |
| `--color-text` on `--color-current`             | 4.5:1  | 12.53:1 | 9.88:1  |
| `--color-border` on `--color-chrome`            | 3:1    | 3.29:1  | 3.94:1  |
| `--color-accent` on `--color-chrome`            | 3:1    | 5.45:1  | 8.65:1  |
| `--color-accent` on `--color-page`              | 3:1    | 6.09:1  | 7.94:1  |
| `--color-accent` on `--color-current`           | 3:1    | 4.97:1  | 6.18:1  |

A Vitest test, `src/styles/tokens.test.ts`, reads `tokens.css`, resolves each
semantic token in both themes, and asserts every pair in this table with the
WCAG 2 contrast formula, so a color change that misses a target fails the
gate. Vitest loads CSS as empty unless `test.css.include` lists it, so the
configuration includes `tokens.css`; the prototype's test read nothing until
it did. Browser accessibility checks, which
[ADR 0009](./0009-browser-tests.md#accessibility-checks) adds, cover colors as
composed on the page.

### Typefaces

* Writing: Newsreader, by Production Type, under the SIL Open Font License
  1.1, from `@fontsource-variable/newsreader`. Import `opsz.css` and
  `opsz-italic.css`, which carry the optical-size and weight axes, and set
  `font-optical-sizing: auto` on the writing surface.
* Interface: Inter, by Rasmus Andersson, under the SIL Open Font License 1.1,
  from `@fontsource-variable/inter`. Import `wght.css`, the weight axis
  alone; the interface sets no italic.
* Code inside documents uses the system's monospace faces, downloading
  nothing.

Vite copies every `woff2` file the imported CSS names into `webapp/dist/assets/`
with a content hash and rewrites each URL to it, so the fonts are served from
the webapp's own build output. Each `@font-face` rule carries a
`unicode-range`, so a browser downloads only the subsets the page's text
uses. In the prototype, Chromium requested nothing outside the page's origin
and fetched three font files: Inter's Latin roman and Newsreader's Latin
roman and italic, 327 KB together. The rules use `font-display: swap`, so
text appears in the fallback face until a font arrives.

The font files carry their copyright notices and a license URL, but not the
license text, which the Open Font License asks every copy to include. The
build therefore emits each package's `LICENSE` file into `webapp/dist/assets/`
beside the fonts, through a small plugin in `vite.config.ts`, and
`webapp/README.md` credits both typefaces.

### Layout and density

The interface stays quiet so the page carries the eye. Color comes from two
surfaces and one accent: the chrome around the page, the page itself, and
`--color-accent` for focus and drop targets. Nothing uses gradients, shadows,
or decorative borders, and motion is limited to state changes of
`--duration-fast`. The prototype established these starting values, which
backlogs 20, 22, and 23 may tune within the tokens:

| Element            | Starting treatment                                                                                                                                         |
|--------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Header             | One row padded `--space-2` by `--space-4`, separated from the regions below by a single 1 px `--color-border` line                                         |
| Side panes         | 16 rem navigator and 18 rem assistant on `--color-chrome`, the header's color, with no divider of their own                                                |
| Writing page       | A sheet on `--color-page`, centered at `--writing-measure`, padded `--space-12` by `--space-8`, with no border or shadow; it stands out by lightness alone |
| Page headings      | Newsreader at 2 rem with line height 1.2, its optical size following the font size                                                                         |
| Interface text     | Inter at `--text-md` with line height 1.4; secondary text in `--color-text-muted`                                                                          |
| Tree rows          | At least 1.75 rem tall with a 4 px radius, indented 1 rem per level, with 16 px folder and document icons                                                  |
| Row controls       | 24 px drag handle and chevron with 14 px icons; the chevron turns 90 degrees over `--duration-fast` when a folder expands                                  |
| Row states         | The open document tinted `--color-current` with no border, focus shown by a 2 px `--color-accent` outline inset 2 px, a dragged row at half opacity        |
| Menus and popovers | `--color-chrome-raised` with a 1 px `--color-border` edge and a 6 px radius; the focused item tinted `--color-current`                                     |
| Icons              | Lucide's default 2 px stroke in `currentColor`, 16 to 18 px                                                                                                |

### Responsive layout and touch

Writer lays out for desktop windows and for iPad in portrait and landscape,
from 744 px wide in portrait to 1,376 px in landscape. Phones are out of scope; a narrower window still works, with both
panes over the writing region. Responsiveness is plain CSS: media queries on
the viewport for the shell, container queries for components whose pane
width varies, and `rem` and `clamp()` sizing. Custom properties cannot appear
in a media query, so the two breakpoints are fixed widths, written the same
way everywhere:

| Viewport width             | Navigator                     | Assistant                     | Writing page                                      |
|----------------------------|-------------------------------|-------------------------------|---------------------------------------------------|
| 75 rem (1,200 px) or wider | Docked                        | Docked                        | As [Layout and density](#layout-and-density) sets |
| 60 to 75 rem               | Docked                        | Opens over the writing region | As above                                          |
| Narrower than 60 rem       | Opens over the writing region | Opens over the writing region | Padded `--space-8` by `--space-6`                 |

A pane that opens over the writing region closes when the writer chooses a
document, presses `Escape`, or taps outside it, and returns focus to where
it was. Collapsing a docked pane still persists across reloads; an overlaid
pane always starts closed.

Touch rules follow the input, not the width or the device, through the
`hover` and `pointer` media features, because an iPad with a trackpad
behaves like a desktop and a touch-screen laptop does not:

* Where `(hover: none)`, controls that appear on hover elsewhere, such as a
  row's drag handle and actions button, are always visible.
* Where `(pointer: coarse)`, tree rows, menu items, and pointer targets are
  at least 2.75 rem (44 px) tall, Apple's minimum touch target.
* Editable text fields, such as inline rename and the document title, use at
  least 1 rem (16 px) text everywhere, because Safari on iPadOS zooms the
  page to a focused field with smaller text.
* Touch dragging starts from the drag handle. Safari may not raise
  `contextmenu` for a long press, so the actions button and its move
  commands are the touch path to every row command.
* The shell's height is `100dvh`, so Safari's toolbars never hide it, and the
  header and panes pad by `env(safe-area-inset-*)`.
* The editor keeps the caret visible above iPadOS's on-screen keyboard, which
  [backlog 23](../backlog/0023-writing-surface.md) verifies. A hardware
  keyboard on iPad gets the same shortcuts as desktop.

### Components

Build the tree, menus, popovers, dialogs, tooltips, and toolbars on React
Aria Components, styled with CSS Modules through their `className` props and
`data-*` state attributes. Do not add a second component library.

The navigator is a React Aria `Tree`:

* It follows the WAI-ARIA treegrid pattern, so screen readers announce a
  tree grid of rows with levels. Arrow keys move and expand, `Home` and
  `End` jump, type-ahead finds a title, and the open document is the selected
  row. Selecting a document navigates to it with the router, because tree
  rows cannot be links.
* Each row has a drag handle, a `Button` in the `drag` slot; React Aria warns
  without one, because keyboard and screen reader users drag through it.
* Each row has an actions button opening a `Menu` with the row's commands,
  including move up, move down, and move to. The same menu opens from the
  row's `contextmenu` event, which a right click raises, as do the Menu key
  and Shift+F10 on platforms that map them. React Aria's `MenuTrigger` with
  `trigger="contextMenu"` binds only to a button, so the row opens a
  `Popover` it controls. Synthetic key presses in the prototype did not raise
  the event, so the actions button, not the context menu, is the guaranteed
  keyboard and touch path to every command.
* Notices about failed changes use an ARIA live region rather than React
  Aria's unstable toast.

Drag and drop uses `useDragAndDrop` on the `Tree`, with a private drag type so
nothing outside the tree can be dropped in:

* `onMove` turns a drop into ADR 0005's placement. Before a row places the
  item before it; on a folder places it last inside; after a row places it
  before that row's next sibling other than the moved item, or last when there
  is none.
* `shouldAcceptItemDrop` accepts drops only on folders, React Stately refuses
  drops into the dragged item's subtree, and `onDropActivate` expands a folder
  held under a drag.
* The move commands in each row's menu provide WCAG 2.5.7's single-pointer
  alternative, and [backlog 24](../backlog/0024-tree-drag-and-drop.md) builds
  them.

### Routing and URLs

Use TanStack Router with a code-based route tree in one module, registered
through its `Register` interface so links and navigation are type-checked.
Do not add its Vite plugin, generated route files, or devtools.

| Path                      | Shows                                 |
|---------------------------|---------------------------------------|
| `/`                       | The workspace with no document open   |
| `/documents/{documentId}` | The workspace with that document open |
| Any other path            | A not-found message linking to `/`    |

`documentId` is ADR 0005's lowercase UUID, written `$documentId` in the route
definition. Titles never appear in URLs, so a renamed or moved document keeps
its URL. Folders have no URL. A document that no longer exists shows a
message in the writing region with a link to `/`. The first release uses no
search parameters; pane and folder expansion state is a preference, not
navigation, and stays out of the URL.

Routes do not own data. The root route's context carries the query client, and
components read through the query options below. Vite's development server
answers a page request for any path outside `/api/` with `index.html`, which
client-side routing needs; a later hosting decision must keep that behavior.

### Server state

Create one `QueryClient` at startup and pass it to the router's context.
Beside `client.ts` in `webapp/src/api/`, export query options and mutation
hooks; components use them and never write query keys themselves. Keys are
`["workspace"]` for the tree, `["documents", documentId]` for a document's
metadata, and `["documents", documentId, "content"]` for its content.

* Queries retry network failures and 5xx responses up to three times and
  never retry a 4xx response. Mutations do not retry on their own.
* The tree refetches when the window regains focus, so changes made in
  another tab or outside Writer appear.
* A document's content is read from the service every time the document
  opens, even when an earlier read is cached, so changes made elsewhere
  appear. After that read, the editor owns the text: content queries never
  refetch in the background, on focus, on reconnect, or on an interval, and
  no read may replace text the editor holds.

Tree changes (create, rename, move, and delete) share the mutation key prefix
`["workspace"]` and the mutation scope `workspace`:

* The shared scope sends the requests to the service one at a time, in the
  order the writer made them. A change waiting its turn is still listed as
  pending, with its variables, by `useMutationState`.
* The navigator shows the cached tree with every pending tree change applied
  over it, in order, by pure functions that follow ADR 0005's placement
  rules. A change therefore appears at once and stays visible through any
  refetch until its request settles.
* When a change succeeds, the same function applies it to the cached tree,
  so it does not flicker out before the next read. When one fails, it drops
  out of the pending list, its problem is shown by `code`, and the tree is
  refetched, which is the service's truth; later pending changes stay
  applied over the refreshed tree. After the last pending tree change
  settles, the tree is refetched once.
* No snapshot is taken or restored, because a snapshot from before queued
  changes would undo them.

In the prototype, a second move appeared at once while its request waited for
the first, a move the service refused with 409 disappeared on refetch, and a
queued change was listed as pending until its request finished. The
prototype edited the cache in `onMutate`; review found that a refetch after a
failure would then erase a later queued change, which deriving the view from
the pending list avoids.

Document saves do not use queued mutations. A queued mutation's variables are
fixed when it is queued, but each save needs the revision the previous save
returns. A per-document save controller, which
[backlog 23](../backlog/0023-writing-surface.md) builds, keeps one save in
flight, reads the latest base revision when it sends, retries as ADR 0005
describes, and writes each acknowledged revision into the cache.

### Browser storage

Unacknowledged text lives in an IndexedDB database named `writer`, accessed
through `idb`. Its `unsavedText` store holds one record per document per tab,
keyed by `[documentId, tabId]`:

| Field          | Holds                                        |
|----------------|----------------------------------------------|
| `documentId`   | The document's identifier                    |
| `tabId`        | The tab that wrote the text                  |
| `baseRevision` | The revision the text was edited from        |
| `markdown`     | The whole unacknowledged text                |
| `title`        | The document's last known title              |
| `parentId`     | The document's last known folder, or `null`  |
| `updatedAt`    | When the record was written, in milliseconds |

A tab's identifier is a UUID kept in `sessionStorage`, so it survives a
reload. While open, the tab holds the Web Lock `writer-tab:{tabId}`. A
duplicated tab inherits the original's `sessionStorage`, finds the lock held,
and takes a new identifier. Keying by tab means two tabs editing one document
never overwrite each other's unsaved text.

* The client writes the record before each save request, on each of the
  [editor ADR's flush events](./0008-editor.md#autosave-timing-and-flush-events),
  and otherwise at most every 500 ms while the writer types, so a browser
  crash loses at most half a second of typing.
* When a save is acknowledged, the record is deleted if it holds exactly the
  saved text. Otherwise the newer text now builds on the acknowledged
  revision, and the record's `baseRevision` becomes it.
* On startup, a tab recovers its own records, left by a reload, and those
  of other tabs whose lock it can take with `ifAvailable`, left by a closed
  tab or a crash. It holds that lock until the record is saved and deleted,
  so exactly one tab recovers each record, and a reloading tab that finds
  its own lock taken takes a new identifier and leaves the record to the
  tab recovering it. Recovery saves through ADR 0005's stale-write rule, so
  a stale base leads to conflict recovery, with one sibling copy, rather
  than an overwrite.
* The record keeps the document's last known title and folder, so text whose
  document was deleted elsewhere can be recreated with that title, in that
  folder if it still exists, as ADR 0005 requires, even after the tab that
  wrote it has closed.

The prototype verified each case in Chromium, using a same-origin frame as a
second tab: a reload kept the tab's identifier and its record, a duplicate
took a new identifier, a live tab's record stayed hidden from another tab,
the same record became recoverable once its tab closed, and acknowledging
either deleted or rebased the record. The prototype only observed which locks
were held; taking the closed tab's lock for the length of recovery, and the
title and folder fields, came from review afterwards, and backlog 23 tests
them.

Small preferences, such as which panes are collapsed and which folders are
expanded, are kept in `localStorage` under keys starting `writer.`, and a
missing or unreadable value falls back to the default. The client does not
call `navigator.storage.persist()`, because Firefox asks the writer for
permission.

### Icons

Use `lucide-react`, importing each icon by name. Icons are decorative,
`aria-hidden`, and drawn in `currentColor`; a button containing only an icon
has an accessible name.

### Supported browsers

The webapp supports desktop Chrome and Edge 111, Firefox 114, and Safari
16.4, and Safari on iPadOS 16.4, and later versions: Vite 8's default
`baseline-widely-available` target, which names iOS 16.4, used for both
JavaScript and CSS. Every feature this record relies on is
available there, including IndexedDB, Web Locks, `crypto.randomUUID()`,
variable fonts, and `prefers-color-scheme`; nested CSS is lowered at build. A
feature outside the target, such as `:has()` before Firefox 121, may only
enhance a layout that works without it. Phones, including Safari on iPhone,
are not a target. Until a hosting decision serves Writer to other devices
over HTTPS, which Web Locks and `crypto.randomUUID()` require away from
`localhost`, iPad layouts are verified in browser tests at iPad sizes with
touch. [ADR 0009](./0009-browser-tests.md#projects) runs the browser tests on
Chromium, Firefox, and WebKit, and on WebKit with touch at iPad sizes.

## Consequences

Positive outcomes:

* The tree, menus, dialogs, and drag and drop share one accessibility
  foundation, including keyboard and screen reader dragging that the
  prototype exercised.
* `tsc` rejects an unknown class, route, parameter, or API call, and the
  gate rejects a color that breaks a contrast target in either theme.
* The webapp requests nothing from another origin; fonts and icons ship in
  its build with content hashes.
* Tree changes appear at once, reach the service in order, and cannot leave
  the navigator showing a tree the service does not hold.
* Unsaved text survives a reload, a crash, a closed tab, and a duplicated tab.
* No added package runs an install script.

Trade-offs and risks:

* The JavaScript loaded grows from 69 KB to 199 KB gzipped before the editor,
  and the single chunk exceeds Vite's advisory 500 KB minified warning, which
  the build prints but which fails nothing. The editor ADR
  ([ADR 0008](./0008-editor.md#bundle-budget)) sets the budget and loads the
  editor as its own chunk; splitting by route is the next remedy if it is
  exceeded.
* Screen readers announce the navigator as a tree grid rather than a tree.
  Backlogs 22 and 26 test it with a screen reader.
* Each row carries a drag handle and an actions button. They may appear on
  hover or focus, but must stay operable and at least 24 pixels square, and
  on touch screens they are always visible and 44 pixels tall.
* iPad layouts and touch rules add CSS and test cases now, before any iPad
  can reach Writer.
* With a controlled selection, the prototype's live region repeated the
  selected row's announcement after each tree refetch. Backlog 22 checks
  that selection is announced once.
* `vite-css-modules` replaces Vite's CSS Modules handling, so a Vite upgrade
  can break it until it catches up, and one author maintains it.
* TanStack Router releases often and has already had a compromised release.
  Exact versions, the lockfile, disabled install scripts, and Dependabot's
  cooldown reduce the exposure without removing it.
* Two palettes double the colors to choose and check; the contrast test
  covers both.
* IndexedDB is best-effort storage that a browser may evict under storage
  pressure, and Safari clears it for a site not visited in seven days of
  browser use. Records
  live only until the service acknowledges their text, so the window is
  short.
* `font-display: swap` shows Georgia or the system face until the fonts
  arrive, which on loopback is a moment on first load.

## Revisit triggers

* Vite types CSS Modules itself, or `vite-css-modules` lags a Vite major
  release: drop the plugin, or generate declarations another way.
* A screen reader test in backlog 26 finds the treegrid confusing: reconsider
  the tree's pattern, which may mean a primitive other than React Aria's
  `Tree`.
* The bundle exceeds [ADR 0008's budget](./0008-editor.md#bundle-budget):
  split by route and load drag and drop, menus, and dialogs on demand.
* Writers ask to choose a theme inside Writer: add an override stored per
  browser on top of the operating system's setting.
* A chosen package has a compromised release or stalls: reassess it against
  this record's alternatives.
* React Aria's toast becomes stable: consider it for notices.
* Writer is served to an iPad or another device beyond loopback: revisit the
  supported browsers, the storage eviction risk, the secure context, and the
  development server's fallback routing.
* Writer targets phones: add a phone layout below 60 rem and revisit the
  writing page, the panes, and touch targets.

## Follow-up decisions

* The editor: settled by [ADR 0008](./0008-editor.md), including the bundle
  budget, the autosave timing and flush events that drive unsaved-text
  writes, and styles for document content built on these tokens
* Browser tests: settled by [ADR 0009](./0009-browser-tests.md), including
  the engines covered, WebKit at iPad sizes with touch, and axe-core, which
  checks composed contrast
* Hosting: fallback routing to `index.html`, and a content security policy
  that can allow fonts, styles, and scripts from the webapp's own origin only
* A theme control inside Writer, if writers ask for one

## References

* [WCAG 2.2](https://www.w3.org/TR/WCAG22/), including contrast (1.4.3,
  1.4.6, 1.4.11), dragging movements (2.5.7), and target size (2.5.8)
* [WAI-ARIA treegrid pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treegrid/)
* [React Aria Tree](https://react-aria.adobe.com/Tree)
* [React Aria drag and drop](https://react-aria.adobe.com/dnd)
* [React Aria Menu, including context menus](https://react-aria.adobe.com/Menu)
* [React Aria NavigationTree](https://react-aria.adobe.com/NavigationTree)
* [Radix UI primitives](https://www.radix-ui.com/primitives)
* [dnd-kit](https://dndkit.com/)
* [Pragmatic drag and drop](https://atlassian.design/components/pragmatic-drag-and-drop/)
* [vite-css-modules](https://github.com/privatenumber/vite-css-modules)
* [Vite CSS Modules](https://vite.dev/guide/features#css-modules)
* [Tailwind CSS browser compatibility](https://tailwindcss.com/docs/compatibility)
* [vanilla-extract](https://vanilla-extract.style/)
* [TanStack Router](https://tanstack.com/router/latest)
* [TanStack Query mutation scopes](https://tanstack.com/query/latest/docs/framework/react/guides/mutations#mutation-scopes)
* [GHSA-g7cv-rxg3-hmpx: malware in TanStack router packages](https://github.com/advisories/GHSA-g7cv-rxg3-hmpx)
* [React Router](https://reactrouter.com/)
* [wouter](https://github.com/molefrog/wouter)
* [idb](https://github.com/jakearchibald/idb)
* [MDN: Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)
* [MDN: Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
* [Fontsource](https://fontsource.org/)
* [Newsreader](https://github.com/productiontype/Newsreader)
* [Inter](https://rsms.me/inter/)
* [SIL Open Font License 1.1](https://openfontlicense.org/)
* [Lucide](https://lucide.dev/)
* [Dependabot options reference, including `cooldown`](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference)

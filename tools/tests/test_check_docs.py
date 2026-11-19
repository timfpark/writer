import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import check_docs  # noqa: E402

FRONTMATTER = "---\ntitle: T\ndescription: D\n---\n"
NUMBERED = "---\ntitle: T\ndescription: D\nsubsystems:\n  - service\n---\n"


class CheckDocsTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, rel, text):
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def problems(self):
        return check_docs.check(self.root)[1]

    def test_valid_tree_passes(self):
        self.write("README.md", FRONTMATTER + "## Start\n\nSee [ADRs](./docs/adrs/README.md#records) and <https://example.com>.\n")
        self.write("docs/adrs/README.md", FRONTMATTER + "## Records\n\n[0001](./0001-first.md)\n")
        self.write("docs/adrs/0001-first.md", NUMBERED + "## Context\n\n[Back](#context)\n")
        self.assertEqual(self.problems(), [])

    def test_missing_frontmatter_and_fields(self):
        self.write("a.md", "## Heading\n")
        self.write("b.md", "---\ntitle: T\nms.date: 11/19/2026\n---\n")
        self.assertEqual(self.problems(), [
            "a.md:1: missing YAML frontmatter delimited by '---' lines",
            "b.md:1: frontmatter 'description' must be a non-empty string",
            "b.md:1: ms.date '11/19/2026' is not an ISO 8601 date (YYYY-MM-DD)",
        ])

    def test_malformed_frontmatter_values(self):
        self.write("a.md", "---\ntitle: []\ndescription: \"unterminated\n---\n")
        self.assertEqual(self.problems(), [
            "a.md:3: frontmatter 'description' has an unterminated quoted value",
            "a.md:1: frontmatter 'title' must be a non-empty string",
        ])

    def test_links_with_titles_are_checked(self):
        self.write("a.md", FRONTMATTER + "[x](./one.md \"t\") [y](./two.md 't') [z](./three.md (t))\n")
        self.assertEqual(self.problems(), [
            "a.md:5: link target './one.md' does not exist",
            "a.md:5: link target './two.md' does not exist",
            "a.md:5: link target './three.md' does not exist",
        ])

    def test_broken_links_and_fragments(self):
        self.write("other.md", FRONTMATTER + "## Real heading\n")
        self.write("a.md", FRONTMATTER + "[x](./missing.md) [y](./other.md#nope) [z](/abs.md) [w](../outside.md)\n")
        self.assertEqual(self.problems(), [
            "a.md:5: link target './missing.md' does not exist",
            "a.md:5: link fragment '#nope' has no matching heading in 'other.md'",
            "a.md:5: link '/abs.md' must be relative, not root-absolute",
            "a.md:5: link '../outside.md' points outside the repository",
        ])

    def test_links_in_code_are_ignored(self):
        self.write("a.md", FRONTMATTER + "`[x](./missing.md)`\n\n```markdown\n[y](./missing.md)\n```\n")
        self.assertEqual(self.problems(), [])

    def test_numbered_doc_needs_subsystems_and_index_row(self):
        self.write("docs/backlog/README.md", FRONTMATTER + "## Backlog\n")
        self.write("docs/backlog/0002-thing.md", FRONTMATTER + "## Story\n")
        self.assertEqual(self.problems(), [
            "docs/backlog/0002-thing.md:1: frontmatter is missing a non-empty 'subsystems' list",
            "docs/backlog/0002-thing.md:1: not linked from 'docs/backlog/README.md'; add a row to the index",
        ])

    def test_h1_with_title_is_rejected(self):
        self.write("a.md", FRONTMATTER + "# Title again\n")
        self.assertEqual(self.problems(), ["a.md:5: H1 heading duplicates the frontmatter title; start at H2"])

    def test_previous_work_is_not_checked(self):
        self.write("docs/previous-work/0001-old.md", "# No frontmatter\n\n[x](./missing.md)\n")
        self.write("docs/previous-work-notes.md", "## No frontmatter\n")
        self.assertEqual(self.problems(), [
            "docs/previous-work-notes.md:1: missing YAML frontmatter delimited by '---' lines",
        ])


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Validate Markdown frontmatter, relative links, and docs index coverage.

Uses only the Python standard library (3.9+) so it runs on a bare host.
Prints one `path:line: message` diagnostic per problem and exits 1 when any
problem is found.
"""

import argparse
import datetime
import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote

REQUIRED_KEYS = ("title", "description")
INDEXED_DIRS = ("docs/adrs", "docs/backlog")
ALLOWED_SUBSYSTEMS = ("repository", "service", "webapp")
NUMBERED_DOC = re.compile(r"^\d{4}-[a-z0-9-]+\.md$")
SKIP_DIRS = {".git", "node_modules", "target", "dist", ".local", "test-results"}
# GitHub copies these files verbatim into new pull request bodies, so they
# carry no frontmatter. Their links are still checked.
NO_FRONTMATTER = {".github/pull_request_template.md"}
# Markdown test data for the editor's round trip, kept byte for byte as other
# tools write it, so it is neither documentation nor checked as such.
FIXTURE_DIRS = ("webapp/src/editor/markdown/corpus/",)

FENCE = re.compile(r"^\s{0,3}(```|~~~)")
INLINE_CODE = re.compile(r"(`+).*?\1")
INLINE_LINK = re.compile(r"!?\[(?:[^\[\]]|\[[^\]]*\])*\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:\"[^\"]*\"|'[^']*'|\([^)]*\)))?\s*\)")
REFERENCE_DEF = re.compile(r"^\s{0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)")
HEADING = re.compile(r"^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$")
SCHEME = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*:")


def markdown_files(root):
    if (root / ".git").exists():
        try:
            out = subprocess.run(
                ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "*.md"],
                cwd=root, check=True, capture_output=True,
            ).stdout.decode()
            return sorted(
                root / p
                for p in out.split("\0")
                if p and not p.startswith(FIXTURE_DIRS) and (root / p).is_file()
            )
        except (OSError, subprocess.CalledProcessError):
            pass
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        found.extend(
            path
            for path in (Path(dirpath) / f for f in filenames if f.endswith(".md"))
            if not path.relative_to(root).as_posix().startswith(FIXTURE_DIRS)
        )
    return sorted(found)


def parse_frontmatter(lines):
    """Return (fields, body_start_index, errors); fields is None when absent or unterminated."""
    if not lines or lines[0].rstrip() != "---":
        return None, 0, []
    fields, key, errors = {}, None, []
    for i, line in enumerate(lines[1:], start=1):
        if line.rstrip() == "---":
            return fields, i + 1, errors
        item = re.match(r"^\s+-\s*(.*)$", line)
        if item and key is not None:
            if not isinstance(fields[key], list):
                fields[key] = []
            fields[key].append(item.group(1).strip().strip("'\""))
            continue
        pair = re.match(r"^([A-Za-z0-9_.-]+):\s*(.*)$", line)
        if pair:
            key, value = pair.group(1), pair.group(2).strip()
            if value.startswith("[") and value.endswith("]"):
                fields[key] = [v.strip().strip("'\"") for v in value[1:-1].split(",") if v.strip()]
            else:
                if value[:1] in ("'", '"') and (len(value) < 2 or value[-1] != value[0]):
                    errors.append((i + 1, f"frontmatter '{key}' has an unterminated quoted value"))
                fields[key] = value.strip("'\"")
    return None, 0, []


def slugify(text):
    text = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = text.replace("`", "").lower()
    text = re.sub(r"[^\w\- ]", "", text)
    return text.replace(" ", "-")


def scan_body(lines, start):
    """Yield (line_number, text) for body lines outside fenced code blocks."""
    fence = None
    for i in range(start, len(lines)):
        match = FENCE.match(lines[i])
        if match:
            marker = match.group(1)
            if fence is None:
                fence = marker
            elif marker == fence:
                fence = None
            continue
        if fence is None:
            yield i + 1, lines[i]


def anchors(lines, start):
    seen, result = {}, set()
    for _, line in scan_body(lines, start):
        match = HEADING.match(line)
        if match:
            slug = slugify(match.group(2))
            count = seen.get(slug, 0)
            seen[slug] = count + 1
            result.add(slug if count == 0 else f"{slug}-{count}")
    return result


class Checker:
    def __init__(self, root):
        self.root = root.resolve()
        self.problems = []
        self._cache = {}

    def report(self, path, line, message):
        rel = path.relative_to(self.root).as_posix()
        self.problems.append(f"{rel}:{line}: {message}")

    def load(self, path):
        if path not in self._cache:
            lines = path.read_text(encoding="utf-8").splitlines()
            self._cache[path] = (lines, *parse_frontmatter(lines))
        return self._cache[path]

    def check_file(self, path):
        lines, fields, start, errors = self.load(path)
        for number, message in errors:
            self.report(path, number, message)
        rel = path.relative_to(self.root).as_posix()
        if fields is None:
            if rel not in NO_FRONTMATTER:
                self.report(path, 1, "missing YAML frontmatter delimited by '---' lines")
        else:
            for key in REQUIRED_KEYS:
                value = fields.get(key)
                if not isinstance(value, str) or not value.strip():
                    self.report(path, 1, f"frontmatter '{key}' must be a non-empty string")
            date = fields.get("ms.date")
            if date is not None:
                try:
                    datetime.date.fromisoformat(str(date))
                except ValueError:
                    self.report(path, 1, f"ms.date '{date}' is not an ISO 8601 date (YYYY-MM-DD)")
            numbered = NUMBERED_DOC.match(path.name) and str(path.parent.relative_to(self.root).as_posix()) in INDEXED_DIRS
            if numbered:
                subsystems = fields.get("subsystems")
                if not (isinstance(subsystems, list) and subsystems):
                    self.report(path, 1, "frontmatter is missing a non-empty 'subsystems' list")
                else:
                    for item in subsystems:
                        if item not in ALLOWED_SUBSYSTEMS:
                            allowed = ", ".join(ALLOWED_SUBSYSTEMS)
                            self.report(path, 1, f"frontmatter 'subsystems' entry '{item}' must be one of: {allowed}")
                    if len(set(subsystems)) != len(subsystems):
                        self.report(path, 1, "frontmatter 'subsystems' must not contain duplicates")
        for number, line in scan_body(lines, start):
            if fields is not None and fields.get("title") and re.match(r"^\s{0,3}#\s", line):
                self.report(path, number, "H1 heading duplicates the frontmatter title; start at H2")
            self.check_links(path, number, line)
        if rel.endswith(".md") and NUMBERED_DOC.match(path.name):
            self.check_indexed(path, fields)

    def check_links(self, path, number, line):
        stripped = INLINE_CODE.sub("", line)
        targets = [m.group(1) for m in INLINE_LINK.finditer(stripped)]
        definition = REFERENCE_DEF.match(stripped)
        if definition:
            targets.append(definition.group(1))
        for target in targets:
            target = target.strip("<>")
            if SCHEME.match(target) or target.startswith("//"):
                continue
            self.check_target(path, number, target)

    def check_target(self, path, number, target):
        link, _, fragment = target.partition("#")
        if link.startswith("/"):
            self.report(path, number, f"link '{target}' must be relative, not root-absolute")
            return
        dest = (path.parent / unquote(link)).resolve() if link else path
        try:
            dest.relative_to(self.root)
        except ValueError:
            self.report(path, number, f"link '{target}' points outside the repository")
            return
        if not dest.exists():
            self.report(path, number, f"link target '{link}' does not exist")
            return
        if fragment and dest.suffix == ".md":
            lines, _, start, _ = self.load(dest)
            if unquote(fragment).lower() not in anchors(lines, start):
                self.report(path, number, f"link fragment '#{fragment}' has no matching heading in '{dest.name}'")

    def check_indexed(self, path, fields):
        parent = path.parent.relative_to(self.root).as_posix()
        if parent not in INDEXED_DIRS:
            return
        index = path.parent / "README.md"
        if not index.is_file():
            self.report(path, 1, f"'{parent}/README.md' index is missing")
            return
        link_re = re.compile(r"\]\(\./" + re.escape(path.name) + r"(#[^)]*)?\)")
        idx_lines, _, idx_start, _ = self.load(index)
        text = "\n".join(INLINE_CODE.sub("", line) for _, line in scan_body(idx_lines, idx_start))
        if not link_re.search(text):
            self.report(path, 1, f"not linked from '{parent}/README.md'; add a row to the index")
            return
        expected = fields.get("subsystems") if isinstance(fields, dict) else None
        if not (isinstance(expected, list) and expected):
            return
        subsystems_col, prev_cells = None, None
        for number, line in scan_body(idx_lines, idx_start):
            stripped = line.strip()
            if not (stripped.startswith("|") and stripped.endswith("|")):
                subsystems_col, prev_cells = None, None
                continue
            cells = [c.strip() for c in stripped[1:-1].split("|")]
            if cells and all(re.match(r"^:?-{3,}:?$", c) for c in cells):
                if prev_cells is not None:
                    subsystems_col = next((i for i, h in enumerate(prev_cells) if h.lower() == "subsystems"), None)
                prev_cells = None
                continue
            if subsystems_col is not None and subsystems_col < len(cells) and link_re.search(INLINE_CODE.sub("", stripped)):
                cell = cells[subsystems_col]
                listed = re.findall(r"`([^`]+)`", cell) or [c.strip() for c in cell.split(",") if c.strip()]
                if listed != expected:
                    self.report(
                        index,
                        number,
                        f"Subsystems cell for '{path.name}' has {listed}, expected {expected} from frontmatter",
                    )
            prev_cells = cells


def check(root):
    checker = Checker(Path(root))
    files = markdown_files(checker.root)
    for path in files:
        checker.check_file(path)
    return files, checker.problems


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--root", default=Path(__file__).resolve().parent.parent, type=Path,
                        help="repository root to check (default: this repository)")
    args = parser.parse_args(argv)
    files, problems = check(args.root)
    for problem in problems:
        print(problem, file=sys.stderr)
    print(f"docs: checked {len(files)} Markdown files, found {len(problems)} problems")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())

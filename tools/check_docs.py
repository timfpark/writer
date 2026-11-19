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
NUMBERED_DOC = re.compile(r"^\d{4}-[a-z0-9-]+\.md$")
SKIP_DIRS = {".git", "node_modules", "target", "dist", ".local"}
# Reference material imported from an earlier project; its links point there.
EXCLUDED_DIRS = ("docs/previous-work",)

FENCE = re.compile(r"^\s{0,3}(```|~~~)")
INLINE_CODE = re.compile(r"(`+).*?\1")
INLINE_LINK = re.compile(r"!?\[(?:[^\[\]]|\[[^\]]*\])*\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:\"[^\"]*\"|'[^']*'|\([^)]*\)))?\s*\)")
REFERENCE_DEF = re.compile(r"^\s{0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)")
HEADING = re.compile(r"^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$")
SCHEME = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*:")


def excluded(root, path):
    rel = path.relative_to(root).as_posix()
    return any(rel == d or rel.startswith(d + "/") for d in EXCLUDED_DIRS)


def markdown_files(root):
    return [p for p in _all_markdown_files(root) if not excluded(root, p)]


def _all_markdown_files(root):
    if (root / ".git").exists():
        try:
            out = subprocess.run(
                ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "*.md"],
                cwd=root, check=True, capture_output=True,
            ).stdout.decode()
            return sorted(root / p for p in out.split("\0") if p and (root / p).is_file())
        except (OSError, subprocess.CalledProcessError):
            pass
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        found.extend(Path(dirpath) / f for f in filenames if f.endswith(".md"))
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
            if numbered and not (isinstance(fields.get("subsystems"), list) and fields["subsystems"]):
                self.report(path, 1, "frontmatter is missing a non-empty 'subsystems' list")
        for number, line in scan_body(lines, start):
            if fields is not None and fields.get("title") and re.match(r"^\s{0,3}#\s", line):
                self.report(path, number, "H1 heading duplicates the frontmatter title; start at H2")
            self.check_links(path, number, line)
        if rel.endswith(".md") and NUMBERED_DOC.match(path.name):
            self.check_indexed(path)

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

    def check_indexed(self, path):
        parent = path.parent.relative_to(self.root).as_posix()
        if parent not in INDEXED_DIRS:
            return
        index = path.parent / "README.md"
        if not index.is_file():
            self.report(path, 1, f"'{parent}/README.md' index is missing")
            return
        text = index.read_text(encoding="utf-8")
        if not re.search(r"\]\(\./" + re.escape(path.name) + r"(#[^)]*)?\)", text):
            self.report(path, 1, f"not linked from '{parent}/README.md'; add a row to the index")


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

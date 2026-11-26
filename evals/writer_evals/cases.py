"""Synthetic evaluation cases and the documents they read."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

KINDS = ("suggestion", "question", "disconnect")
TASKS = ("conversation", "review")
SPLITS = ("tune", "holdout")
REQUESTS = {
    "improve": "Give me some ideas about how I can improve this text.",
    "develop": "How can I further develop this text?",
    "explore": "What other ideas should I explore?",
}


def request_text(request: str) -> str:
    """Expand a named example request or return a custom writer request verbatim."""
    return REQUESTS.get(request, request)


class CaseError(Exception):
    """A case or document file is malformed; the message names the file."""


@dataclass
class Document:
    id: str
    title: str
    text: str

    @property
    def words(self) -> int:
        return len(self.text.split())


@dataclass
class Expected:
    id: str
    kind: str
    passages: List[str]
    note: str = ""


@dataclass
class Case:
    id: str
    task: str
    split: str
    length: str
    documents: List[Document]
    request: str = ""
    selection: str = ""
    expected: List[Expected] = field(default_factory=list)
    expect_none: List[str] = field(default_factory=list)
    note: str = ""

    @property
    def words(self) -> int:
        return sum(d.words for d in self.documents)


def load_documents(folder: Path) -> Dict[str, Document]:
    docs: Dict[str, Document] = {}
    for path in sorted(folder.glob("*.md")):
        raw = path.read_text(encoding="utf-8")
        title = path.stem
        body = raw
        if raw.startswith("# "):
            first, _, body = raw.partition("\n")
            title = first[2:].strip()
        docs[path.stem] = Document(id=path.stem, title=title, text=body.strip() + "\n")
    return docs


def flat(text: str) -> str:
    return " ".join(text.split())


def contains(documents: List[Document], passage: str) -> bool:
    return any(flat(passage) in flat(d.text) for d in documents)


def _require(cond: bool, path: Path, message: str) -> None:
    if not cond:
        raise CaseError(f"{path}: {message}")


def load_cases(cases_dir: Path) -> List[Case]:
    docs = load_documents(cases_dir / "documents")
    cases: List[Case] = []
    seen = set()
    for path in sorted(cases_dir.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as err:
            raise CaseError(f"{path}: invalid JSON: {err}") from None
        cid = data.get("id")
        _require(cid == path.stem, path, "'id' must equal the file name")
        _require(cid not in seen, path, f"duplicate case id '{cid}'")
        seen.add(cid)
        task = data.get("task")
        _require(task in TASKS, path, f"'task' must be one of {', '.join(TASKS)}")
        split = data.get("split")
        _require(split in SPLITS, path, f"'split' must be one of {', '.join(SPLITS)}")
        doc_ids = data.get("documents") or []
        _require(isinstance(doc_ids, list) and doc_ids, path, "'documents' must list document ids")
        missing = [d for d in doc_ids if d not in docs]
        _require(not missing, path, f"unknown documents: {', '.join(missing)}")
        documents = [docs[d] for d in doc_ids]
        request = ""
        if task == "conversation":
            req = data.get("request")
            _require(isinstance(req, str) and bool(req.strip()), path,
                     f"'request' must be a non-empty string or one of {', '.join(REQUESTS)}")
            request = req.strip()
        selection = data.get("selection", "")
        if selection:
            _require(contains(documents, selection), path,
                     "'selection' must appear verbatim in a document")
        expected = []
        for item in data.get("expected", []):
            _require(item.get("kind") in KINDS, path, f"expected kind must be one of {', '.join(KINDS)}")
            passages = item.get("passages") or []
            _require(bool(passages), path, f"expected '{item.get('id')}' needs passages")
            for passage in passages:
                _require(contains(documents, passage), path,
                         f"expected passage not found verbatim: {passage[:60]!r}")
            expected.append(Expected(id=item.get("id", ""), kind=item["kind"],
                                     passages=passages, note=item.get("note", "")))
        expect_none = data.get("expectNone", [])
        _require(all(k in KINDS for k in expect_none), path, "'expectNone' lists unknown kinds")
        length = data.get("length", "")
        _require(length in ("scene", "chapter", "manuscript"), path,
                 "'length' must be scene, chapter, or manuscript")
        cases.append(Case(id=cid, task=task, split=split, length=length, documents=documents,
                          request=request, selection=selection, expected=expected,
                          expect_none=list(expect_none), note=data.get("note", "")))
    _require(bool(cases), cases_dir, "no cases found")
    return cases


def tree_digest(folder: Path) -> str:
    """A short digest of every file under a folder, so results name the exact cases used."""
    digest = hashlib.sha256()
    for path in sorted(p for p in folder.rglob("*") if p.is_file() and "__pycache__" not in p.parts):
        digest.update(str(path.relative_to(folder)).encode("utf-8") + b"\0")
        digest.update(path.read_bytes() + b"\0")
    return digest.hexdigest()[:12]


def select(cases: List[Case], ids: Optional[List[str]] = None, task: Optional[str] = None,
           split: Optional[str] = None) -> List[Case]:
    chosen = [c for c in cases if (not ids or c.id in ids) and (not task or c.task == task)
              and (not split or c.split == split)]
    if ids:
        unknown = sorted(set(ids) - {c.id for c in cases})
        if unknown:
            raise CaseError(f"unknown case ids: {', '.join(unknown)}")
    return chosen

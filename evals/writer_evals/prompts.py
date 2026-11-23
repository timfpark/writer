"""Prompt templates: a [system] and a [user] section with {{placeholders}}."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List

from .cases import Case, Document

PLACEHOLDER = re.compile(r"\{\{(\w+)\}\}")

REVIEW_SCHEMA = {
    "type": "object",
    "properties": {
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": ["suggestion", "question", "disconnect"]},
                    "text": {"type": "string"},
                    "passages": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "document": {"type": "string"},
                                "quote": {"type": "string"},
                            },
                            "required": ["document", "quote"],
                        },
                    },
                },
                "required": ["kind", "text", "passages"],
            },
        },
    },
    "required": ["findings"],
}

JUDGE_SCHEMA = {
    "type": "object",
    "properties": {
        "usefulness": {"type": "integer", "minimum": 1, "maximum": 5},
        "grounding": {"type": "integer", "minimum": 1, "maximum": 5},
        "restraint": {"type": "integer", "minimum": 1, "maximum": 5},
        "rationale": {"type": "string"},
    },
    "required": ["usefulness", "grounding", "restraint", "rationale"],
}


class PromptError(Exception):
    pass


@dataclass
class Template:
    name: str
    system: str
    user: str
    digest: str

    def render(self, values: Dict[str, str]) -> List[dict]:
        def fill(text: str) -> str:
            def sub(match: "re.Match[str]") -> str:
                key = match.group(1)
                if key not in values:
                    raise PromptError(f"prompt '{self.name}' needs a value for {{{{{key}}}}}")
                return values[key]
            return PLACEHOLDER.sub(sub, text)

        return [{"role": "system", "content": fill(self.system)},
                {"role": "user", "content": fill(self.user)}]


def load_template(path: Path) -> Template:
    raw = path.read_text(encoding="utf-8")
    match = re.fullmatch(r"\[system\]\n(.*?)\n\[user\]\n(.*)", raw, re.S)
    if not match:
        raise PromptError(f"{path}: expected a [system] section followed by a [user] section")
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:12]
    return Template(name=path.stem, system=match.group(1).strip(), user=match.group(2).strip(),
                    digest=digest)


def load_templates(folder: Path) -> Dict[str, Template]:
    templates = {p.stem: load_template(p) for p in sorted(folder.glob("*.txt"))}
    for required in ("conversation", "review", "judge-conversation", "judge-review"):
        if required not in templates:
            raise PromptError(f"{folder}: missing {required}.txt")
    return templates


def render_documents(documents: List[Document]) -> str:
    return "\n\n".join(
        f'<document id="{d.id}" title="{d.title}">\n{d.text.strip()}\n</document>'
        for d in documents
    )


def case_values(case: Case) -> Dict[str, str]:
    from .cases import REQUESTS

    selection = ""
    if case.selection:
        selection = f"\nThe writer has selected this passage:\n<selection>\n{case.selection}\n</selection>\n"
    return {
        "documents": render_documents(case.documents),
        "selection": selection,
        "request": REQUESTS.get(case.request, ""),
    }

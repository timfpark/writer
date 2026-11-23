"""Command line: python3 -m writer_evals <command> from the evals/ folder."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import List, Optional

from . import cases as cases_mod
from .judge import judge_results
from .prompts import PromptError, load_templates
from .report import report
from .runner import ConfigError, Environment, load_configs, run_config, run_pair, run_sustained
from .runtimes import GenerationFailed, OllamaRuntime, RuntimeUnavailable, ollama_url_from_env
from .sheet import build_sheet, ingest_scores

EVALS = Path(__file__).resolve().parent.parent
REPO = EVALS.parent


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="writer_evals", description="Score models and prompts on Writer's synthetic cases.")
    p.add_argument("--ollama-url", default=None, help="Ollama's address (default: OLLAMA_HOST or http://127.0.0.1:11434)")
    p.add_argument("--configs", type=Path, default=EVALS / "configs.json")
    p.add_argument("--cases-dir", type=Path, default=EVALS / "cases")
    p.add_argument("--prompts-dir", type=Path, default=EVALS / "prompts")
    p.add_argument("--results-dir", type=Path, default=EVALS / "results")
    p.add_argument("--raw-dir", type=Path, default=REPO / ".local" / "evals" / "raw")
    sub = p.add_subparsers(dest="command", required=True)

    sub.add_parser("list", help="list configurations and cases")
    run = sub.add_parser("run", help="run configurations over cases")
    run.add_argument("config", nargs="+")
    run.add_argument("--case", action="append", dest="case_ids")
    run.add_argument("--task", choices=cases_mod.TASKS)
    run.add_argument("--split", choices=cases_mod.SPLITS)

    pair = sub.add_parser("pair", help="keep a chat model and a reviewer loaded together")
    pair.add_argument("chat")
    pair.add_argument("reviewer")
    pair.add_argument("--review-case", required=True)

    sus = sub.add_parser("sustained", help="review one case repeatedly while sampling power and heat")
    sus.add_argument("config")
    sus.add_argument("--case", required=True)
    sus.add_argument("--minutes", type=float, default=10)

    judge = sub.add_parser("judge", help="score result outputs with a judge configuration")
    judge.add_argument("config")
    judge.add_argument("results", nargs="+", type=Path)
    judge.add_argument("--force", action="store_true")

    sheet = sub.add_parser("sheet", help="write a blind scoring sheet for people")
    sheet.add_argument("results", nargs="+", type=Path)
    sheet.add_argument("--out", type=Path, default=REPO / ".local" / "evals" / "sheet")
    sheet.add_argument("--case", action="append", dest="case_ids")

    ingest = sub.add_parser("ingest", help="copy a filled scoring sheet into the result summaries")
    ingest.add_argument("--sheet", type=Path, default=REPO / ".local" / "evals" / "sheet")
    ingest.add_argument("--scorer", required=True)

    rep = sub.add_parser("report", help="summarize result files as Markdown tables")
    rep.add_argument("results", nargs="*", type=Path)
    return p


def main(argv: Optional[List[str]] = None, runtime=None, out=None, err=None) -> int:
    out = out or print
    err = err or (lambda message: print(message, file=sys.stderr))
    args = _parser().parse_args(argv)
    try:
        all_cases = cases_mod.load_cases(args.cases_dir)
        by_id = {c.id: c for c in all_cases}
        templates = load_templates(args.prompts_dir)
        configs = load_configs(args.configs)
    except (cases_mod.CaseError, PromptError, ConfigError) as error:
        err(f"writer_evals: {error}")
        return 2

    def config(name: str):
        if name not in configs:
            raise ConfigError(f"unknown config '{name}'; see: python3 -m writer_evals list")
        return configs[name]

    if args.command == "list":
        for c in configs.values():
            out(f"config {c.name}: {c.model}")
        for c in all_cases:
            out(f"case {c.id}: {c.task}, {c.length}, {c.words} words, {c.split}")
        return 0
    if args.command == "report":
        paths = args.results or sorted(args.results_dir.glob("*.json"))
        if not paths:
            err("writer_evals: no result files")
            return 2
        out(report(paths).rstrip("\n"))
        return 0
    if args.command == "ingest":
        try:
            count = ingest_scores(args.sheet, args.results_dir, args.scorer)
        except (OSError, ValueError) as error:
            err(f"writer_evals: {error}")
            return 2
        out(f"ingested {count} scored outputs")
        return 0
    if args.command == "sheet":
        count = build_sheet(args.results, by_id, args.raw_dir, args.out, args.case_ids)
        out(f"wrote {count} outputs to {args.out}")
        return 0

    if runtime is None:
        runtime = OllamaRuntime(args.ollama_url or ollama_url_from_env())
    env = Environment(runtime=runtime, templates=templates,
                      cases_digest=cases_mod.tree_digest(args.cases_dir),
                      results_dir=args.results_dir, raw_dir=args.raw_dir, repo_root=REPO, log=out)
    try:
        if args.command == "run":
            chosen = cases_mod.select(all_cases, args.case_ids, args.task, args.split)
            if not chosen:
                err("writer_evals: no cases match")
                return 2
            for name in args.config:
                out(f"wrote {run_config(env, config(name), chosen)}")
        elif args.command == "pair":
            chat_cases = cases_mod.select(all_cases, task="conversation", split="tune")
            out(f"wrote {run_pair(env, config(args.chat), config(args.reviewer), chat_cases, by_id[args.review_case])}")
        elif args.command == "sustained":
            out(f"wrote {run_sustained(env, config(args.config), by_id[args.case], args.minutes)}")
        elif args.command == "judge":
            out(f"judged {judge_results(env, config(args.config), args.results, by_id, args.force)} outputs")
    except (ConfigError, RuntimeUnavailable, cases_mod.CaseError) as error:
        err(f"writer_evals: {error}")
        return 2
    except KeyError as error:
        err(f"writer_evals: unknown case {error}")
        return 2
    except GenerationFailed as error:
        err(f"writer_evals: {error}")
        return 1
    return 0


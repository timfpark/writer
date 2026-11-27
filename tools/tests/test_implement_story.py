import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
GIT_ENV = {
    "GIT_AUTHOR_NAME": "Test User",
    "GIT_AUTHOR_EMAIL": "test@example.com",
    "GIT_COMMITTER_NAME": "Test User",
    "GIT_COMMITTER_EMAIL": "test@example.com",
    "GIT_CONFIG_GLOBAL": os.devnull,
    "GIT_CONFIG_NOSYSTEM": "1",
}


class ImplementStoryTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.base = Path(self._tmp.name).resolve()
        self.origin = self.base / "origin.git"
        self.repo = self.base / "writer"
        self.bin = self.base / "bin"
        self.bin.mkdir()

        for tool in ("bash", "cat", "dirname", "pwd", "basename", "env", "mktemp", "rm", "git"):
            found = shutil.which(tool)
            if found:
                (self.bin / tool).symlink_to(found)
        (self.bin / "python3").symlink_to(sys.executable)

        self.git(["init", "--bare", "-b", "main", str(self.origin)])
        self.git(["init", "-b", "main", str(self.repo)])
        self.git(["remote", "add", "origin", str(self.origin)], cwd=self.repo)

        (self.repo / "tools").mkdir()
        shutil.copy2(REPO_ROOT / "tools/implement-story", self.repo / "tools/implement-story")
        (self.repo / "service").mkdir()
        (self.repo / "service/Cargo.toml").write_text("[workspace]\n", encoding="utf-8")
        (self.repo / "docs/backlog").mkdir(parents=True)
        (self.repo / "docs/backlog/0099-demo-story.md").write_text(
            "---\ntitle: Demo\ndescription: Synthetic story\n---\n",
            encoding="utf-8",
        )

        self.git(
            [
                "add",
                "tools/implement-story",
                "service/Cargo.toml",
                "docs/backlog/0099-demo-story.md",
            ],
            cwd=self.repo,
        )
        self.git(["commit", "-m", "initial commit"], cwd=self.repo)
        self.git(["push", "-u", "origin", "main"], cwd=self.repo)
        self.git(["remote", "set-head", "origin", "main"], cwd=self.repo)

        self.cargo_log = self.add_cargo_stub()

    def tearDown(self):
        self._tmp.cleanup()

    def write_exec(self, path, body):
        path.write_text(body, encoding="utf-8")
        path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    def git(self, args, cwd=None, check=True):
        env = dict(os.environ, **GIT_ENV)
        return subprocess.run(
            ["git", *args],
            cwd=cwd,
            env=env,
            capture_output=True,
            text=True,
            check=check,
        )

    def add_cargo_stub(self):
        log = self.base / "cargo-calls.log"
        self.write_exec(
            self.bin / "cargo",
            f"""#!/usr/bin/env python3
import os, sys
with open({str(log)!r}, "a", encoding="utf-8") as fh:
    fh.write(os.getcwd() + "|" + " ".join(sys.argv[1:]) + "\\n")
""",
        )
        return log

    def add_copilot_stub(self, advance_main=False, skip_delete=False, empty_review=False):
        log = self.base / "copilot-calls.jsonl"
        self.write_exec(
            self.bin / "copilot",
            f"""#!/usr/bin/env python3
import json, os, pathlib, re, subprocess, sys

args = sys.argv[1:]
model = args[args.index("--model") + 1]
prompt = args[-1]
with open({str(log)!r}, "a", encoding="utf-8") as fh:
    fh.write(json.dumps({{"model": model, "args": args, "cwd": os.getcwd()}}) + "\\n")

def run_git(cmd, cwd=None):
    subprocess.run(["git", *cmd], cwd=cwd, check=True)

if prompt.startswith("Implement the backlog story"):
    pathlib.Path("feature.txt").write_text("implemented\\n", encoding="utf-8")
    if not {skip_delete!r}:
        pathlib.Path("docs/backlog/0099-demo-story.md").unlink()
    run_git(["add", "-A"])
    run_git(["commit", "-m", "feat: implement demo story"])
elif prompt.startswith("Review the changes"):
    match = re.search(r"plain text in (\\S+),", prompt)
    assert match, f"could not find feedback file in prompt: {{prompt}}"
    if not {empty_review!r}:
        pathlib.Path(match.group(1)).write_text("Looks good with one minor suggestion.\\n", encoding="utf-8")
elif prompt.startswith("Assess the code review feedback"):
    pathlib.Path("feature.txt").write_text("implemented and polished\\n", encoding="utf-8")
    run_git(["add", "feature.txt"])
    run_git(["commit", "-m", "refactor: address review feedback"])
    if {advance_main!r}:
        main_repo = {str(self.repo)!r}
        (pathlib.Path(main_repo) / "upstream.txt").write_text("main moved\\n", encoding="utf-8")
        run_git(["add", "upstream.txt"], cwd=main_repo)
        run_git(["commit", "-m", "chore: advance main"], cwd=main_repo)
        run_git(["push", "origin", "main"], cwd=main_repo)
elif prompt.startswith("Merge origin/main"):
    run_git(["merge", "--no-edit", "origin/main"])
else:
    sys.stderr.write(f"unexpected prompt: {{prompt}}\\n")
    sys.exit(1)
""",
        )
        return log

    def run_script(self, *args, env_override=None):
        env = dict(os.environ, PATH=str(self.bin), **GIT_ENV)
        if env_override:
            env.update(env_override)
        return subprocess.run(
            [str(self.repo / "tools/implement-story"), *args],
            cwd=self.repo,
            env=env,
            capture_output=True,
            text=True,
        )

    def test_help_usage_and_prerequisites(self):
        self.add_copilot_stub()
        help_res = self.run_script("--help")
        self.assertEqual(help_res.returncode, 0, help_res.stderr)
        self.assertIn("Usage:", help_res.stdout)

        self.assertEqual(self.run_script().returncode, 2)
        self.assertEqual(self.run_script("--flag").returncode, 2)

        bad_branch = self.run_script("docs/backlog/bad..story.md")
        self.assertEqual(bad_branch.returncode, 2)
        self.assertIn("not a valid branch name", bad_branch.stderr)

        (self.bin / "copilot").unlink()
        missing_copilot = self.run_script("docs/backlog/0099-demo-story.md")
        self.assertEqual(missing_copilot.returncode, 2)
        self.assertIn("copilot", missing_copilot.stderr)

        self.add_copilot_stub()
        (self.bin / "cargo").unlink()
        missing_cargo = self.run_script("docs/backlog/0099-demo-story.md")
        self.assertEqual(missing_cargo.returncode, 2)
        self.assertIn("cargo", missing_cargo.stderr)

    def test_rejects_missing_or_external_story(self):
        self.add_copilot_stub()
        missing = self.run_script("docs/backlog/0000-missing.md")
        self.assertEqual(missing.returncode, 1)
        self.assertIn("story not found on origin/main", missing.stderr)

        outside = self.base / "outside.md"
        outside.write_text("outside\n", encoding="utf-8")
        ext = self.run_script(str(outside))
        self.assertEqual(ext.returncode, 1)
        self.assertIn("outside the repository", ext.stderr)

    def test_full_workflow_uses_expected_models_service_manifest_and_pushes(self):
        copilot_log = self.add_copilot_stub(advance_main=True)
        res = self.run_script("docs/backlog/0099-demo-story.md")
        self.assertEqual(res.returncode, 0, res.stderr + res.stdout)

        wt_path = self.base / "writer-0099-demo-story"
        self.assertTrue(wt_path.is_dir())
        self.assertIn(f"Pushed 0099-demo-story from {wt_path}", res.stdout)

        calls = [
            json.loads(line)
            for line in copilot_log.read_text(encoding="utf-8").splitlines()
        ]
        self.assertEqual(
            [c["model"] for c in calls],
            ["gemini-4-neon", "claude-opus-5.5", "gemini-4-neon", "gemini-4-neon"],
        )
        self.assertIn("--no-ask-user", calls[3]["args"])
        self.assertIn("--trust-folder", calls[3]["args"])
        self.assertIn("-p", calls[3]["args"])

        cargo_calls = self.cargo_log.read_text(encoding="utf-8").splitlines()
        expected_manifest = f"{wt_path}/service/Cargo.toml"
        self.assertEqual(
            cargo_calls,
            [
                f"{wt_path}|clean --manifest-path {expected_manifest}",
                f"{wt_path}|clean --manifest-path {expected_manifest}",
            ],
        )

        # Verify the branch was pushed to origin and includes the upstream main commit.
        remote_ref = self.git(
            ["ls-remote", "--heads", str(self.origin), "0099-demo-story"]
        ).stdout.strip()
        self.assertNotEqual(remote_ref, "")
        self.assertTrue((wt_path / "upstream.txt").is_file())

    def test_fails_when_story_not_deleted_or_review_empty(self):
        self.add_copilot_stub(skip_delete=True)
        res = self.run_script("docs/backlog/0099-demo-story.md")
        self.assertEqual(res.returncode, 1)
        self.assertIn("implementation did not delete docs/backlog/0099-demo-story.md", res.stderr)

        # Clean up worktree and branch before checking empty review failure.
        wt_path = self.base / "writer-0099-demo-story"
        self.git(["worktree", "remove", "--force", str(wt_path)], cwd=self.repo)
        self.git(["branch", "-D", "0099-demo-story"], cwd=self.repo)

        self.add_copilot_stub(empty_review=True)
        res2 = self.run_script("docs/backlog/0099-demo-story.md")
        self.assertEqual(res2.returncode, 1)
        self.assertIn("code review produced no feedback", res2.stderr)


if __name__ == "__main__":
    unittest.main()

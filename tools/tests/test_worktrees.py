import os
import shutil
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


class WorktreeScriptsTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.base = Path(self._tmp.name).resolve()
        self.origin = self.base / "origin.git"
        self.repo = self.base / "writer"

        self.git(["init", "--bare", "-b", "main", str(self.origin)])
        self.git(["init", "-b", "main", str(self.repo)])
        self.git(["remote", "add", "origin", str(self.origin)], cwd=self.repo)

        tools_dir = self.repo / "tools"
        tools_dir.mkdir()
        for name in ("create-worktree", "delete-worktree"):
            shutil.copy2(REPO_ROOT / "tools" / name, tools_dir / name)

        (self.repo / "README.md").write_text("initial\n", encoding="utf-8")
        self.git(["add", "README.md", "tools/create-worktree", "tools/delete-worktree"], cwd=self.repo)
        self.git(["commit", "-m", "initial commit"], cwd=self.repo)
        self.git(["push", "-u", "origin", "main"], cwd=self.repo)
        self.git(["remote", "set-head", "origin", "main"], cwd=self.repo)

    def tearDown(self):
        self._tmp.cleanup()

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

    def run_script(self, name, *args, env_override=None):
        env = dict(os.environ, **GIT_ENV)
        if env_override:
            env.update(env_override)
        return subprocess.run(
            [str(self.repo / "tools" / name), *args],
            cwd=self.repo,
            env=env,
            capture_output=True,
            text=True,
        )

    def make_path_without_git(self):
        bin_dir = self.base / "no-git-bin"
        bin_dir.mkdir(exist_ok=True)
        for tool in ("bash", "dirname", "pwd", "basename", "env"):
            found = shutil.which(tool)
            if found and not (bin_dir / tool).exists():
                (bin_dir / tool).symlink_to(found)
        return str(bin_dir)

    def test_help_and_usage_exit_codes(self):
        for script in ("create-worktree", "delete-worktree"):
            help_res = self.run_script(script, "--help")
            self.assertEqual(help_res.returncode, 0, help_res.stderr)
            self.assertIn("Usage:", help_res.stdout)

            no_args = self.run_script(script)
            self.assertEqual(no_args.returncode, 2)
            self.assertIn("Usage:", no_args.stderr)

            bad_name = self.run_script(script, "--bad")
            self.assertEqual(bad_name.returncode, 2)
            self.assertIn("invalid branch name: --bad", bad_name.stderr)

            bad_ref = self.run_script(script, "feat..invalid")
            self.assertEqual(bad_ref.returncode, 2)
            self.assertIn("invalid branch name: feat..invalid", bad_ref.stderr)

    def test_missing_git_exits_2_and_names_prerequisite(self):
        path_without_git = self.make_path_without_git()
        for script in ("create-worktree", "delete-worktree"):
            res = self.run_script(script, "feat/demo", env_override={"PATH": path_without_git})
            self.assertEqual(res.returncode, 2)
            self.assertIn("git must be on PATH", res.stderr)

    def test_create_worktree_creates_sibling_with_sanitized_name_and_refuses_existing(self):
        res = self.run_script("create-worktree", "feat/0001-demo")
        self.assertEqual(res.returncode, 0, res.stderr)
        wt_path = self.base / "writer-feat-0001-demo"
        self.assertTrue(wt_path.is_dir())
        self.assertIn(f"Created worktree: {wt_path}", res.stdout)

        branch = self.git(["symbolic-ref", "--short", "HEAD"], cwd=wt_path).stdout.strip()
        self.assertEqual(branch, "feat/0001-demo")

        # Existing destination is rejected with exit 1.
        dup = self.run_script("create-worktree", "feat-0001-demo")
        self.assertEqual(dup.returncode, 1)
        self.assertIn("destination already exists:", dup.stderr)

    def test_delete_worktree_refuses_unregistered_detached_and_unmerged(self):
        missing = self.run_script("delete-worktree", "feat/does-not-exist")
        self.assertEqual(missing.returncode, 1)
        self.assertIn("no registered worktree found at:", missing.stderr)

        self.assertEqual(self.run_script("create-worktree", "feat/unmerged").returncode, 0)
        wt_path = self.base / "writer-feat-unmerged"
        (wt_path / "draft.txt").write_text("work in progress\n", encoding="utf-8")
        self.git(["add", "draft.txt"], cwd=wt_path)
        self.git(["commit", "-m", "wip"], cwd=wt_path)

        unmerged = self.run_script("delete-worktree", "feat/unmerged")
        self.assertEqual(unmerged.returncode, 1)
        self.assertIn("branch is not merged into origin/main", unmerged.stderr)
        self.assertTrue(wt_path.is_dir())

        self.git(["checkout", "--detach", "HEAD"], cwd=wt_path)
        detached = self.run_script("delete-worktree", "feat/unmerged")
        self.assertEqual(detached.returncode, 1)
        self.assertIn("worktree is not on a local branch:", detached.stderr)

    def test_delete_worktree_accepts_squash_merge_even_after_later_commits_on_main(self):
        self.assertEqual(self.run_script("create-worktree", "feat/squash-me").returncode, 0)
        wt_path = self.base / "writer-feat-squash-me"

        (wt_path / "a.txt").write_text("first\n", encoding="utf-8")
        self.git(["add", "a.txt"], cwd=wt_path)
        self.git(["commit", "-m", "first commit"], cwd=wt_path)
        (wt_path / "b.txt").write_text("second\n", encoding="utf-8")
        self.git(["add", "b.txt"], cwd=wt_path)
        self.git(["commit", "-m", "second commit"], cwd=wt_path)

        # Simulate a GitHub squash merge into main, then another commit on main.
        self.git(["merge", "--squash", "feat/squash-me"], cwd=self.repo)
        self.git(["commit", "-m", "feat: squash-me (#1)"], cwd=self.repo)
        (self.repo / "other.txt").write_text("later commit on main\n", encoding="utf-8")
        self.git(["add", "other.txt"], cwd=self.repo)
        self.git(["commit", "-m", "later change"], cwd=self.repo)
        self.git(["push", "origin", "main"], cwd=self.repo)

        res = self.run_script("delete-worktree", "feat/squash-me")
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertFalse(wt_path.exists())
        self.assertIn("Removed worktree and branch: feat/squash-me", res.stdout)
        branches = self.git(["branch", "--list", "feat/squash-me"], cwd=self.repo).stdout.strip()
        self.assertEqual(branches, "")

    def test_delete_worktree_accepts_merged_remote_branch_ahead_of_local(self):
        self.assertEqual(self.run_script("create-worktree", "feat/remote-ahead").returncode, 0)
        wt_path = self.base / "writer-feat-remote-ahead"

        (wt_path / "part1.txt").write_text("one\n", encoding="utf-8")
        self.git(["add", "part1.txt"], cwd=wt_path)
        self.git(["commit", "-m", "part 1"], cwd=wt_path)
        local_head = self.git(["rev-parse", "HEAD"], cwd=wt_path).stdout.strip()

        # Simulate a follow-up commit pushed to the remote branch, then squashed into main.
        (wt_path / "part2.txt").write_text("two\n", encoding="utf-8")
        self.git(["add", "part2.txt"], cwd=wt_path)
        self.git(["commit", "-m", "part 2"], cwd=wt_path)
        self.git(["push", "origin", "feat/remote-ahead"], cwd=wt_path)
        self.git(["reset", "--hard", local_head], cwd=wt_path)

        self.git(["merge", "--squash", "origin/feat/remote-ahead"], cwd=self.repo)
        self.git(["commit", "-m", "feat: remote-ahead (#2)"], cwd=self.repo)
        self.git(["push", "origin", "main"], cwd=self.repo)

        res = self.run_script("delete-worktree", "feat/remote-ahead")
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertFalse(wt_path.exists())

    @unittest.skipUnless(sys.platform == "darwin", "macOS ACL test only applies on Darwin")
    def test_delete_worktree_strips_macos_delete_acl_from_dependency_and_build_dirs(self):
        self.assertEqual(self.run_script("create-worktree", "feat/macos-acl").returncode, 0)
        wt_path = self.base / "writer-feat-macos-acl"
        user = subprocess.check_output(["id", "-un"], text=True).strip()
        acl = f"user:{user} deny delete"
        protected = [
            wt_path / "webapp" / "node_modules",
            wt_path / "tools" / "node_modules",
            wt_path / "service" / "target",
        ]
        try:
            for directory in protected:
                directory.mkdir(parents=True, exist_ok=True)
                subprocess.run(["chmod", "+a", acl, str(directory)], check=True)

            res = self.run_script("delete-worktree", "feat/macos-acl")
            self.assertEqual(res.returncode, 0, res.stderr)
            self.assertFalse(wt_path.exists())
            for directory in protected:
                self.assertIn(f"Removed macOS delete-denying ACL from: {directory}", res.stdout)
        finally:
            for directory in protected:
                if directory.exists():
                    subprocess.run(["chmod", "-a", acl, str(directory)], check=False)


if __name__ == "__main__":
    unittest.main()

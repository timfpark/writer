import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SYSTEM_TOOLS = ("bash", "dirname", "pwd", "env")


class CheckGateTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name) / "repo"
        self.bin = Path(self._tmp.name) / "bin"
        self.bin.mkdir()

        for name in SYSTEM_TOOLS:
            found = shutil.which(name)
            if found:
                (self.bin / name).symlink_to(found)
        (self.bin / "python3").symlink_to(sys.executable)

        for rel in (
            "tools/check",
            "tools/check_docs.py",
            "tools/.npmrc",
            "tools/package.json",
            "tools/package-lock.json",
            ".markdownlint-cli2.jsonc",
        ):
            dest = self.root / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(REPO_ROOT / rel, dest)

        self.write(
            "tools/tests/test_smoke.py",
            "import unittest\nclass Smoke(unittest.TestCase):\n    def test_ok(self): pass\n",
        )
        self.write(
            "README.md",
            "---\ntitle: Test\ndescription: Synthetic workspace\n---\n\n## Overview\n\nClean paragraph.\n",
        )
        (self.root / "service").mkdir()
        self.cargo_log = self.add_cargo_stub()
        self.write("webapp/package.json", '{"engines": {"node": "26.13.1"}}\n')

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, rel, text):
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def write_exec(self, path, body):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding="utf-8")
        path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    def add_node_stub(self, version="26.13.1"):
        self.write_exec(self.bin / "node", f"#!/usr/bin/env bash\necho {version}\n")

    def add_npm_stub(self, lint_rc=0, lint_stderr="", npm_rc=0, fail_script=""):
        log = self.root / "npm-calls.log"
        self.write_exec(
            self.bin / "npm",
            f"""#!/usr/bin/env python3
import os, pathlib, stat, sys
with open({str(log)!r}, "a", encoding="utf-8") as fh:
    fh.write(os.getcwd() + "|" + " ".join(sys.argv[1:]) + "\\n")
if sys.argv[1:3] == ["run", {fail_script!r}]:
    sys.stderr.write("npm run " + sys.argv[2] + " simulated failure\\n")
    sys.exit(1)
if sys.argv[1:2] == ["run"]:
    sys.exit(0)
if len(sys.argv) < 2 or sys.argv[1] != "ci":
    sys.stderr.write(f"expected 'npm ci' or 'npm run', got {{sys.argv[1:]}}\\n")
    sys.exit(1)
if {npm_rc} != 0:
    sys.stderr.write("npm ci simulated failure\\n")
    sys.exit({npm_rc})
bin_dir = pathlib.Path("node_modules/.bin")
bin_dir.mkdir(parents=True, exist_ok=True)
cli = bin_dir / "markdownlint-cli2"
cli.write_text(
    "#!/usr/bin/env python3\\nimport sys\\n"
    + (f"sys.stderr.write({lint_stderr!r} + '\\\\n')\\n" if {bool(lint_stderr)!r} else "")
    + f"sys.exit({lint_rc})\\n",
    encoding="utf-8",
)
cli.chmod(cli.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
""",
        )
        return log

    def add_cargo_stub(self, fail_subcommand=""):
        log = self.root / "cargo-calls.log"
        self.write_exec(
            self.bin / "cargo",
            f"""#!/usr/bin/env python3
import os, sys
with open({str(log)!r}, "a", encoding="utf-8") as fh:
    fh.write(f"{{os.getcwd()}}|{{os.environ.get('UPDATE_OPENAPI', '<unset>')}}|{{' '.join(sys.argv[1:])}}\\n")
if sys.argv[1:2] == [{fail_subcommand!r}]:
    sys.stderr.write("cargo " + sys.argv[1] + " simulated failure\\n")
    sys.exit(101)
""",
        )
        return log

    def run_check(self, *args, **extra_env):
        env = dict(os.environ, PATH=str(self.bin), **extra_env)
        return subprocess.run(
            [str(self.root / "tools/check"), *args],
            cwd=self.root,
            env=env,
            capture_output=True,
            text=True,
        )

    def npm_calls(self, log, folder):
        prefix = str((self.root / folder).resolve()) + "|"
        return [line[len(prefix) :] for line in log.read_text(encoding="utf-8").splitlines() if line.startswith(prefix)]

    def test_missing_node_exits_2_and_names_pinned_version(self):
        res = self.run_check()
        self.assertEqual(res.returncode, 2)
        self.assertIn("Node.js 26.13.1 (node), the version webapp/package.json engines.node pins", res.stderr)
        self.assertIn("found none", res.stderr)
        self.assertEqual(res.stdout, "")

    def test_node_other_than_webapp_pin_exits_2_and_names_both_versions(self):
        self.add_node_stub("26.12.0")
        self.add_npm_stub()
        res = self.run_check()
        self.assertEqual(res.returncode, 2)
        self.assertIn("Node.js 26.13.1", res.stderr)
        self.assertIn("found 26.12.0", res.stderr)

    def test_missing_webapp_node_pin_exits_2(self):
        self.add_node_stub()
        self.add_npm_stub()
        (self.root / "webapp/package.json").unlink()
        res = self.run_check()
        self.assertEqual(res.returncode, 2)
        self.assertIn("webapp/package.json must pin the Node.js version in engines.node", res.stderr)

    def test_missing_npm_exits_2_and_names_prerequisite(self):
        self.add_node_stub()
        res = self.run_check()
        self.assertEqual(res.returncode, 2)
        self.assertIn("npm must be on PATH", res.stderr)

    def test_npm_ci_runs_in_tools_when_needed_and_skips_when_stamp_matches(self):
        self.add_node_stub()
        log = self.add_npm_stub()

        first = self.run_check()
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(self.npm_calls(log, "tools"), ["ci --include=dev --no-audit --no-fund"])

        second = self.run_check()
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(len(self.npm_calls(log, "tools")), 1)

        lock_path = self.root / "tools/package-lock.json"
        lock_path.write_text(lock_path.read_text(encoding="utf-8") + "\n", encoding="utf-8")
        third = self.run_check()
        self.assertEqual(third.returncode, 0, third.stderr)
        self.assertEqual(len(self.npm_calls(log, "tools")), 2)

    def test_failed_npm_ci_fails_docs_without_writing_stamp_and_stops_webapp(self):
        self.add_node_stub()
        log = self.add_npm_stub(npm_rc=1)
        res = self.run_check()
        self.assertEqual(res.returncode, 1)
        self.assertFalse((self.root / "tools/node_modules/.lock-stamp").exists())
        self.assertIn("FAILED phases: docs webapp", res.stderr)
        self.assertEqual(self.npm_calls(log, "webapp"), ["ci --include=dev --no-audit --no-fund"])

    def test_markdownlint_failure_fails_docs_phase_with_exit_1(self):
        self.add_node_stub()
        self.add_npm_stub(lint_rc=1, lint_stderr="README.md:7:18 error MD009/no-trailing-spaces")
        res = self.run_check()
        self.assertEqual(res.returncode, 1)
        self.assertIn("README.md:7:18", res.stderr)
        self.assertIn("FAILED phases: docs", res.stderr)

    def test_missing_cargo_exits_2_and_names_prerequisite(self):
        self.add_node_stub()
        self.add_npm_stub()
        (self.bin / "cargo").unlink()
        res = self.run_check()
        self.assertEqual(res.returncode, 2)
        self.assertIn("cargo (installed with rustup) must be on PATH", res.stderr)
        self.assertEqual(res.stdout, "")

    def test_service_phase_checks_workspace_in_service_without_update_openapi(self):
        self.add_node_stub()
        self.add_npm_stub()
        res = self.run_check(UPDATE_OPENAPI="1")
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertIn("<== service: passed", res.stdout)
        service = str((self.root / "service").resolve())
        self.assertEqual(
            self.cargo_log.read_text(encoding="utf-8").splitlines(),
            [
                f"{service}|<unset>|fmt --all --check",
                f"{service}|<unset>|clippy --workspace --all-targets --locked -- -D warnings",
                f"{service}|<unset>|build --workspace --all-targets --locked",
                f"{service}|<unset>|test --workspace --locked",
            ],
        )

    def test_failing_cargo_step_fails_service_phase_with_exit_1_and_runs_the_rest(self):
        self.add_node_stub()
        self.add_npm_stub()
        self.add_cargo_stub(fail_subcommand="fmt")
        res = self.run_check()
        self.assertEqual(res.returncode, 1)
        self.assertIn("cargo fmt simulated failure", res.stderr)
        self.assertIn("FAILED phases: service", res.stderr)
        self.assertEqual(len(self.cargo_log.read_text(encoding="utf-8").splitlines()), 4)

    def test_webapp_phase_installs_then_runs_every_check_in_webapp_after_service(self):
        self.add_node_stub()
        log = self.add_npm_stub()
        res = self.run_check()
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertLess(res.stdout.index("<== service: passed"), res.stdout.index("<== webapp: passed"))
        self.assertEqual(
            self.npm_calls(log, "webapp"),
            [
                "ci --include=dev --no-audit --no-fund",
                "run api:check",
                "run format:check",
                "run lint",
                "run typecheck",
                "run test",
                "run build",
            ],
        )

    def test_stale_client_fails_webapp_phase_with_exit_1_and_runs_the_rest(self):
        self.add_node_stub()
        log = self.add_npm_stub(fail_script="api:check")
        res = self.run_check()
        self.assertEqual(res.returncode, 1)
        self.assertIn("npm run api:check simulated failure", res.stderr)
        self.assertIn("FAILED phases: webapp", res.stderr)
        self.assertEqual(len(self.npm_calls(log, "webapp")), 7)


if __name__ == "__main__":
    unittest.main()

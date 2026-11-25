import json
import tempfile
import unittest
from pathlib import Path

from writer_evals.cli import main
from writer_evals.runner import resolve_think
from writer_evals.runtimes import FakeRuntime, ModelInfo

EVALS = Path(__file__).resolve().parent.parent


def scripted(model, messages):
    system = messages[0]["content"]
    if "judging" in system:
        return json.dumps({"usefulness": 4, "grounding": 5, "restraint": 3, "rationale": "Fine."})
    if "background" in system:
        return json.dumps({"findings": [{"kind": "suggestion", "text": "Show the fear.", "passages": [
            {"document": "harbor-light", "quote": "Her heart was pounding like a drum."}]}]})
    return 'Cut "Her heart was pounding like a drum" and trust the signal lamp.'


class CliTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.configs = self.tmp / "configs.json"
        self.configs.write_text(json.dumps({
            "defaults": {"options": {"seed": 1}, "review": {"options": {"num_predict": 500}}},
            "configs": [{"name": "fake-a", "runtime": "fake", "model": "fake:a"},
                        {"name": "fake-b", "runtime": "fake", "model": "fake:b"},
                        {"name": "absent", "runtime": "fake", "model": "missing:x"},
                        {"name": "judge", "runtime": "fake", "model": "fake:judge"}]}))
        self.results, self.raw = self.tmp / "results", self.tmp / "raw"
        self.runtime = FakeRuntime(reply=scripted)
        self.lines, self.errors = [], []

    def tearDown(self):
        self._tmp.cleanup()

    def cli(self, *args):
        argv = ["--configs", str(self.configs), "--results-dir", str(self.results),
                "--raw-dir", str(self.raw), *args]
        return main(argv, runtime=self.runtime, out=self.lines.append, err=self.errors.append)

    def test_run_writes_summary_without_output_text_and_keeps_raw_output_aside(self):
        self.assertEqual(self.cli("run", "fake-a", "--case", "review-harbor", "--case", "conv-harbor-improve"), 0)
        [path] = self.results.glob("*.json")
        result = json.loads(path.read_text())
        self.assertEqual((result["kind"], result["config"]["model"]["quantization"]), ("run", "Q4_K_M"))
        review = next(i for i in result["items"] if i["task"] == "review")
        self.assertEqual(review["scores"]["planted"], {"weak-paragraph": True, "unopened-letter": False})
        self.assertEqual(review["scores"]["falseAlarms"], {"disconnect": 0})
        self.assertNotIn("pounding", path.read_text())
        self.assertTrue((self.raw / result["id"] / "review-harbor.json").exists())
        review_call = next(c for c in self.runtime.calls if c["format"])
        self.assertEqual(review_call["options"]["num_ctx"], 8192)

    def test_judge_sheet_ingest_and_report(self):
        self.cli("run", "fake-a", "fake-b", "--case", "conv-harbor-improve")
        paths = sorted(str(p) for p in self.results.glob("*.json"))
        self.assertEqual(self.cli("judge", "judge", *paths), 0)
        self.assertIn("judged 2 outputs", self.lines[-1])
        sheet = self.tmp / "sheet"
        self.assertEqual(self.cli("sheet", *paths, "--out", str(sheet)), 0)
        text = (sheet / "sheet.txt").read_text()
        self.assertNotIn("fake-a", text)
        self.assertNotIn("fake:a", text)
        rows = (sheet / "scores.csv").read_text().splitlines()
        (sheet / "scores.csv").write_text("\n".join([rows[0]] + [r.replace(",,,,", ",5,4,3,") for r in rows[1:]]) + "\n")
        self.assertEqual(self.cli("ingest", "--sheet", str(sheet), "--scorer", "tester"), 0)
        self.assertEqual(self.cli("rescore", *paths), 0)
        self.assertIn("rescored 2 outputs", self.lines[-1])
        self.assertEqual(self.cli("report"), 0)
        self.assertIn("| fake-a ", self.lines[-1])
        self.assertIn("| 4.0 ", self.lines[-1])

    def test_missing_model_and_unknown_config_exit_2(self):
        self.assertEqual(self.cli("run", "absent", "--case", "review-harbor"), 2)
        self.assertIn("not pulled", self.errors[-1])
        self.assertEqual(self.cli("run", "nope"), 2)
        self.assertIn("unknown config 'nope'", self.errors[-1])


class ThinkTest(unittest.TestCase):
    def test_lowest_prefers_a_named_level_and_omits_think_for_models_without_it(self):
        def model(*levels):
            return ModelInfo(name="m", thinking=list(levels))
        self.assertEqual(resolve_think("lowest", model(False, "low", "high")), "low")
        self.assertEqual(resolve_think("lowest", model(False, True)), False)
        self.assertEqual(resolve_think("highest", model(False, True)), True)
        self.assertEqual(resolve_think("highest", model("low", "medium", "high")), "high")
        self.assertIsNone(resolve_think("lowest", model()))
        self.assertIsNone(resolve_think(False, model()))


if __name__ == "__main__":
    unittest.main()

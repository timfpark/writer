import json
import tempfile
import unittest
from pathlib import Path

from writer_evals.cases import CaseError, Case, Document, Expected, load_cases
from writer_evals.scoring import overlaps, parse_findings, resolves, score_conversation, score_review

EVALS = Path(__file__).resolve().parent.parent

DOC = Document("d", "D", "Mara had left Calloway three springs ago, with two bags.\n"
                         "Later: Mara, who had never once left Calloway, wrote a postcard.\n")


def case(**kw):
    defaults = dict(id="c", task="review", split="tune", length="scene", documents=[DOC])
    defaults.update(kw)
    return Case(**defaults)


def reply(*findings):
    return json.dumps({"findings": [
        {"kind": k, "text": "t", "passages": [{"document": "d", "quote": q} for q in qs]}
        for k, qs in findings]})


class ScoringTest(unittest.TestCase):
    def test_quotes_resolve_across_typography_and_ellipses(self):
        text = "She said, \u201cIt\u2019s late\u201d \u2014 and left the  room quietly."
        self.assertTrue(resolves("It's late\" - and left the room", text))
        self.assertTrue(resolves("She said ... left the room quietly", text))
        self.assertFalse(resolves("left the room loudly", text))

    def test_overlap_needs_five_shared_consecutive_words(self):
        self.assertTrue(overlaps("and so Mara had left Calloway three springs", "Mara had left Calloway three"))
        self.assertFalse(overlaps("Mara had left town", "Mara had left Calloway three springs ago"))

    def test_parse_rejects_invalid_shapes_and_accepts_fences(self):
        self.assertIsNone(parse_findings("not json")[0])
        self.assertIsNone(parse_findings('{"findings": [{"kind": "rant", "text": "", "passages": []}]}')[0])
        self.assertEqual(parse_findings('```json\n{"findings": []}\n```'), ([], ""))
        findings, note = parse_findings('{"findings": []}<|eot|>')
        self.assertEqual((findings, note), ([], "text outside the JSON was ignored"))

    def test_disconnect_counts_only_when_it_cites_both_sides(self):
        planted = case(expected=[Expected("m", "disconnect", [
            "Mara had left Calloway three springs ago", "Mara, who had never once left Calloway"])])
        one_side = score_review(planted, reply(("disconnect", ["Mara had left Calloway three springs ago"])))
        both = score_review(planted, reply(("disconnect", ["Mara had left Calloway three springs ago",
                                                           "Mara, who had never once left Calloway"])))
        self.assertEqual((one_side["planted"], both["planted"]), ({"m": False}, {"m": True}))
        self.assertEqual((both["anchors"], both["anchorsResolved"], both["findingsFullyAnchored"]), (2, 2, 1))

    def test_false_alarms_and_unresolved_anchors_are_counted(self):
        coherent = case(expect_none=["disconnect"])
        scores = score_review(coherent, reply(("disconnect", ["a passage that is not there at all"]),
                                              ("suggestion", ["with two bags"])))
        self.assertEqual(scores["falseAlarms"], {"disconnect": 1})
        self.assertEqual((scores["anchors"], scores["anchorsResolved"]), (2, 1))

    def test_invalid_review_is_scored_invalid(self):
        self.assertEqual(score_review(case(), "Here are my thoughts")["valid"], False)

    def test_conversation_grounding_counts_quotes_found_in_the_text(self):
        scores = score_conversation(case(task="conversation"),
                                    'Cut \u201cMara had left Calloway three springs ago\u201d and "a line that is invented here".')
        self.assertEqual((scores["quotes"], scores["quotesGrounded"]), (2, 1))


class CasesTest(unittest.TestCase):
    def test_committed_cases_load(self):
        cases = load_cases(EVALS / "cases")
        self.assertEqual({c.split for c in cases}, {"tune", "holdout"})
        self.assertTrue(any(c.expect_none for c in cases))

    def test_errors_name_the_file_and_problem(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "documents").mkdir()
            (root / "documents" / "a.md").write_text("# A\n\nSome synthetic text here.\n")
            (root / "bad.json").write_text(json.dumps({
                "id": "bad", "task": "review", "split": "tune", "length": "scene", "documents": ["a"],
                "expected": [{"id": "x", "kind": "suggestion", "passages": ["absent words"]}]}))
            with self.assertRaisesRegex(CaseError, r"bad\.json: expected passage not found"):
                load_cases(root)


if __name__ == "__main__":
    unittest.main()

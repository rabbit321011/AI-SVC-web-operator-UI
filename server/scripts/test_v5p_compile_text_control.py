import importlib.util
from pathlib import Path
import sys
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
TO_LINUX_ROOT = Path("E:/MyProject/ToLinuxServer")
RUNTIME_ROOT = TO_LINUX_ROOT / "package_v4c_finetune"


def load_compiler():
    path = PROJECT_ROOT / "server" / "scripts" / "v5p_compile_text_control.py"
    spec = importlib.util.spec_from_file_location("v5p_compile_text_control_tested", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sys.path.insert(0, str(RUNTIME_ROOT))
from h_alignment.placement import render_h_pul_placements, solve_monotonic_frames


class TextControlCompilerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.compiler = load_compiler()

    def test_phone_placement_stays_sparse_and_ends_with_sep(self):
        region = {
            "Phrases": [{
                "id": "segment:a",
                "start": 0,
                "end": 1,
                "sourceStartFrame": 2,
                "sourceEndFrameExclusive": 10,
                "tokens": [32, 56],
            }],
            "HAlignment": {
                "phrase_candidates": [{
                    "status": "eligible",
                    "tokens": [32, 56, 365],
                    "relative_frames": [0, 3, 6],
                }],
                "phrase_audits": [{
                    "hAlignment": {
                        "phone_events": [
                            {"token_id": 32, "mora_index": 0},
                            {"token_id": 56, "mora_index": 0},
                        ],
                    },
                }],
            },
        }
        events, audit = self.compiler.compile_h(
            region,
            12,
            render_h_pul_placements,
            {32: "k", 56: "i"},
        )
        self.assertEqual(
            [(event["frame"], event["tokenId"]) for event in events],
            [(2, 32), (5, 56), (11, 365)],
        )
        self.assertEqual(audit["phonePhraseCount"], 1)
        self.assertEqual(audit["pulFrameCount"], 0)
        self.assertEqual(
            [(event.get("moraIndex"), event.get("phoneIndex")) for event in events[:2]],
            [(0, 0), (0, 1)],
        )
        self.assertEqual(events[-1].get("phraseId"), "segment:a")
        self.assertEqual(audit["phraseModes"], [{
            "phraseId": "segment:a",
            "placementMode": "phone",
            "fallbackReason": None,
        }])

    def test_fallback_writes_dense_pul_only_between_lyrics_and_sep(self):
        region = {
            "Phrases": [{
                "id": "segment:a",
                "start": 0,
                "end": 1,
                "sourceStartFrame": 2,
                "sourceEndFrameExclusive": 7,
                "tokens": [32, 56],
            }],
            "HAlignment": {
                "phrase_candidates": [{
                    "status": "fallback",
                    "fallback_reason": "fixture",
                    "tokens": [32, 56, 365],
                    "relative_frames": [],
                }],
            },
        }
        events, audit = self.compiler.compile_h(
            region,
            8,
            render_h_pul_placements,
            {32: "k", 56: "i"},
        )
        self.assertEqual(
            [(event["frame"], event["tokenId"]) for event in events],
            [(2, 32), (3, 56), (4, 366), (5, 366), (6, 366), (7, 365)],
        )
        self.assertEqual(audit["pulPhraseCount"], 1)
        self.assertEqual(audit["pulFrameCount"], 3)

    def test_terminal_control_boundary_places_sep_before_kana_seg(self):
        region = {
            "Phrases": [{
                "id": "kana-phrase:a",
                "start": 0,
                "end": 1,
                "sourceStartFrame": 2,
                "sourceEndFrameExclusive": 8,
                "controlEndFrameExclusive": 12,
                "tokens": [32, 56],
            }],
            "HAlignment": {
                "phrase_candidates": [{
                    "status": "eligible",
                    "tokens": [32, 56, 365],
                    "relative_frames": [0, 2, 4],
                }],
                "phrase_audits": [{
                    "hAlignment": {
                        "phone_events": [
                            {"token_id": 32, "mora_index": 0},
                            {"token_id": 56, "mora_index": 1},
                        ],
                    },
                }],
            },
        }
        events, _ = self.compiler.compile_h(
            region,
            20,
            render_h_pul_placements,
            {32: "k", 56: "i"},
        )
        self.assertEqual(
            [(event["frame"], event["tokenId"]) for event in events],
            [(2, 32), (4, 56), (11, 365)],
        )

    def test_kana_boundaries_use_frozen_segment_frames(self):
        region = {
            "Phrases": [{
                "id": "segment:a",
                "start": 0,
                "end": 1,
                "sourceStartFrame": 2,
                "sourceEndFrameExclusive": 10,
            }],
            "HAlignment": {
                "phrase_audits": [{
                    "cropStart": 0,
                    "hAlignment": {
                        "used_word_tier": [
                            {"phone": "キ", "start": 0.1, "end": 0.4},
                            {"phone": "ミ", "start": 0.4, "end": 0.8},
                        ],
                    },
                }],
            },
        }
        units, boundaries, ranges = self.compiler.compile_kana(
            region,
            12,
            solve_monotonic_frames,
        )
        self.assertEqual([(unit["kana"], unit["startFrame"]) for unit in units], [("き", 2), ("み", 9)])
        self.assertEqual(units[-1]["endFrameExclusive"], 10)
        self.assertEqual(boundaries, [])
        self.assertEqual(ranges[0]["startFrame"], 2)


if __name__ == "__main__":
    unittest.main()

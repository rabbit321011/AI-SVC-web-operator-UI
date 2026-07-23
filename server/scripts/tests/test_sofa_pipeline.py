import pathlib
import sys
import types
import unittest


SCRIPTS_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

import sofa_runner
import whisper_runner


class SofaRunnerTests(unittest.TestCase):
    def test_voicebank_g2p_lowercases_devoiced_vowels_and_inserts_sp(self):
        outputs = {
            "きみ": ["k", "I", "m", "i"],
            "うた": ["U", "t", "a"],
        }

        phonemes, words, mapping = sofa_runner.phrases_to_sofa_input(
            [{"kana": "きみ"}, {"kana": "うた"}],
            lambda text, join=False: outputs[text],
        )

        self.assertEqual(phonemes, ["SP", "k", "i", "m", "i", "SP", "u", "t", "a", "SP"])
        self.assertEqual(words, ["きみ", "うた"])
        self.assertEqual(mapping, [-1, 0, 0, 0, 0, -1, 1, 1, 1, -1])

    def test_result_uses_only_sofa_intervals_and_preserves_readings(self):
        result = sofa_runner.build_result(
            "take_sofa",
            [
                {"text": "君", "kana": "きみ", "romaji": "ki mi", "start": 99, "end": 100},
                {"text": "歌", "kana": "うた", "romaji": "u ta", "start": 101, "end": 102},
            ],
            5.0,
            0.97,
            ["SP", "きみ", "うた", "SP"],
            [(0, 0.4), (0.4, 1.5), (2.0, 3.2), (3.2, 5.0)],
            ["SP", "k", "i", "SP"],
            [(0, 0.4), (0.4, 0.8), (0.8, 1.5), (1.5, 5.0)],
        )

        self.assertEqual(result["alignmentMethod"], sofa_runner.ALIGNMENT_METHOD)
        self.assertEqual(
            result["textObject"]["text"]["segments"],
            [
                {
                    "id": "textseg:sofa:0",
                    "start": 0.4,
                    "end": 1.5,
                    "kana": "きみ",
                    "romaji": "ki mi",
                    "alignmentMethod": sofa_runner.ALIGNMENT_METHOD,
                },
                {
                    "id": "textseg:sofa:1",
                    "start": 2.0,
                    "end": 3.2,
                    "kana": "うた",
                    "romaji": "u ta",
                    "alignmentMethod": sofa_runner.ALIGNMENT_METHOD,
                },
            ],
        )
        self.assertEqual([phone["label"] for phone in result["phones"]], ["SP", "k", "i", "SP"])

    def test_rejects_missing_or_invalid_sofa_word_intervals(self):
        with self.assertRaisesRegex(ValueError, "word count mismatch"):
            sofa_runner.validate_intervals([(0.1, 0.5)], 1.0, 2)
        with self.assertRaisesRegex(ValueError, "not positive"):
            sofa_runner.validate_intervals([(0.5, 0.5)], 1.0, 1)
        with self.assertRaisesRegex(ValueError, "overlap"):
            sofa_runner.validate_intervals([(0.1, 0.6), (0.5, 0.8)], 1.0, 2)


class WhisperRunnerTests(unittest.TestCase):
    def test_transcript_keeps_phrase_order_but_drops_whisper_timestamps(self):
        raw_segments = [
            types.SimpleNamespace(text=" 君 の 声 ", start=8.0, end=9.0),
            types.SimpleNamespace(text=""),
            types.SimpleNamespace(text="歌う", start=20.0, end=21.0),
        ]
        readings = {
            "君の声": ("きみのこえ", "ki mi no ko e"),
            "歌う": ("うたう", "u ta u"),
        }

        transcript = whisper_runner.build_transcript(
            raw_segments,
            "ja",
            converter=lambda text: readings[text],
        )

        self.assertEqual(transcript["language"], "ja")
        self.assertEqual([phrase["text"] for phrase in transcript["phrases"]], ["君の声", "歌う"])
        self.assertEqual([phrase["kana"] for phrase in transcript["phrases"]], ["きみのこえ", "うたう"])
        self.assertTrue(all("start" not in phrase and "end" not in phrase for phrase in transcript["phrases"]))


if __name__ == "__main__":
    unittest.main()

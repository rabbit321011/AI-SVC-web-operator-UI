import unittest

from server.scripts.v5p_direct_control import (
    build_frame_map,
    build_h_transport,
    build_midi_class_transport,
)


class V5PDirectControlTest(unittest.TestCase):
    def test_frame_aligned_gap_maps_b_zero_to_joint_frame_start(self):
        frame_map = build_frame_map(1_548_645, 1_548_645, 767, 777)
        self.assertEqual(frame_map["reference"]["paddingSampleCount"], 22_171)
        self.assertEqual(frame_map["reference"]["paddedTrailingSampleCount"], 0)
        self.assertEqual(frame_map["bOffsetFrame"], 767)
        self.assertEqual(frame_map["totalFrameCount"], 1_544)
        self.assertEqual(frame_map["crop"]["endFrameExclusive"], 1_523)

    def test_midi_transport_preserves_b_and_uses_rest_outside_it(self):
        frame_map = build_frame_map(8_192, 8_192)
        transport = build_midi_class_transport(frame_map, [120, 121, 255, 122])
        start = transport["targetStartFrame"]
        end = transport["targetEndFrameExclusive"]
        self.assertEqual(transport["classIds"][start:end], [120, 121, 255, 122])
        self.assertEqual(set(transport["classIds"][:start]), {255})
        self.assertEqual(set(transport["classIds"][end:]), {255})
        self.assertEqual(transport["clearEmbeddingEndFrameExclusive"], start)

    def test_midi_transport_rejects_pad_or_wrong_length(self):
        frame_map = build_frame_map(8_192, 8_192)
        with self.assertRaisesRegex(ValueError, "length mismatch"):
            build_midi_class_transport(frame_map, [120])
        with self.assertRaisesRegex(ValueError, "REST=255"):
            build_midi_class_transport(frame_map, [120, 121, 256, 122])

    def test_joint_h_relocates_context_sep_without_moving_lyrics(self):
        frame_map = build_frame_map(8_192, 8_192)
        result = build_h_transport(
            frame_map,
            [46, 0, 0, 365],
            [0, 0, 56, 365],
        )
        self.assertEqual(result["reference"]["jointTerminalSepFrame"], 16)
        self.assertEqual(result["target"]["jointTerminalSepFrame"], 39)
        self.assertEqual(
            [token for token in result["tokens"] if token],
            [46, 365, 56, 365],
        )

    def test_joint_h_extends_terminal_pul_to_training_boundaries(self):
        result = build_h_transport(
            build_frame_map(8_192, 8_192),
            [46, 366, 366, 365],
            [56, 366, 366, 365],
        )
        self.assertEqual(result["reference"]["terminalPulExtendedFrames"], 11)
        self.assertEqual(result["target"]["terminalPulExtendedFrames"], 21)
        self.assertTrue(all(token == 366 for token in result["tokens"][1:14]))
        self.assertTrue(all(token == 366 for token in result["tokens"][16:39]))

    def test_joint_h_rejects_ambiguous_outer_structure(self):
        frame_map = build_frame_map(8_192, 8_192)
        with self.assertRaisesRegex(ValueError, "after its terminal SEP"):
            build_h_transport(frame_map, [46, 365, 56, 0], [56, 0, 0, 365])
        with self.assertRaisesRegex(ValueError, "before its first lyric"):
            build_h_transport(frame_map, [46, 0, 0, 365], [366, 56, 0, 365])
        with self.assertRaisesRegex(ValueError, "sentence placement"):
            build_h_transport(
                frame_map,
                [46, 0, 0, 365],
                [56, 0, 0, 365],
                reference_terminal_mode="sentence",
            )


if __name__ == "__main__":
    unittest.main()

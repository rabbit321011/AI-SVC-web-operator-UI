import hashlib
import importlib.util
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


runner = load_module("v5p_direct_runner", ROOT / "server/scripts/v5p_direct_runner.py")
direct = load_module("v5p_direct_control", ROOT / "server/scripts/v5p_direct_control.py")


class V5PDirectRunnerTest(unittest.TestCase):
    def test_validate_job_recomputes_frame_map_and_training_terminal_seps(self):
        job = build_job()
        validated = runner.validate_job(job, direct)

        self.assertEqual(validated["frameMap"]["bOffsetFrame"], 75)
        self.assertEqual(validated["frameMap"]["totalFrameCount"], 160)
        self.assertEqual(validated["hTransport"]["reference"]["jointTerminalSepFrame"], 82)
        self.assertEqual(validated["hTransport"]["target"]["jointTerminalSepFrame"], 159)
        self.assertEqual(validated["hTransport"]["tokens"][82], 365)
        self.assertEqual(validated["hTransport"]["tokens"][83], 46)
        self.assertEqual(validated["hTransport"]["tokens"][159], 365)

    def test_validate_job_rejects_client_control_tampering(self):
        job = build_job()
        snapshot = json.loads(job["snapshotCanonical"])
        snapshot["hTransport"]["tokens"][82] = 0
        job["snapshotCanonical"] = runner.canonical_json(snapshot)
        job["snapshotSHA256"] = hashlib.sha256(
            job["snapshotCanonical"].encode("utf-8")
        ).hexdigest()

        with self.assertRaisesRegex(ValueError, "runner joint H"):
            runner.validate_job(job, direct)

    def test_padding_makes_reference_boundary_exact(self):
        import torch

        frame_map = direct.build_frame_map(131_072, 131_072)
        reference = torch.zeros(1, 131_072)
        target = torch.zeros(1, 131_072)
        reference_padded, target_padded = runner.pad_audio_for_frame_map(
            reference, target, frame_map
        )

        self.assertEqual(reference_padded.shape[1], 75 * 2_048)
        self.assertEqual(target_padded.shape[1], 131_072 + 44_100)
        self.assertEqual(reference_padded.shape[1] % 2_048, 0)


def build_job():
    frame_map = direct.build_frame_map(131_072, 131_072)
    local_h = [0] * 64
    local_h[8] = 46
    local_h[63] = 365
    h_transport = direct.build_h_transport(frame_map, local_h, local_h)
    midi_transport = direct.build_midi_class_transport(frame_map, [120] * 64)
    text = {
        "segmentRevision": 1,
        "kanaRevision": 1,
        "hRevision": 1,
        "hEvents": [
            {"frame": 8, "tokenId": 46},
            {"frame": 63, "tokenId": 365},
        ],
        "denseHTokens": local_h,
        "placementRanges": [],
    }
    guide = {
        "assetId": "asset:guide",
        "audioSHA256": "a" * 64,
        "sampleRate": 44_100,
        "sampleCount": 131_072,
        "frameCount": 64,
    }
    snapshot = {
        "schema": "aisvc.v5p-material-snapshot.v1",
        "createdAt": "2026-08-11T00:00:00.000Z",
        "reference": {
            "unitId": "unit:a",
            "unitRevision": 1,
            "guide": guide,
            "text": text,
        },
        "target": {
            "unitId": "unit:b",
            "unitRevision": 1,
            "guide": guide,
            "text": text,
            "midiP": {"revision": 1, "classes": [120] * 64, "manualFrames": []},
        },
        "frameMap": frame_map,
        "hTransport": h_transport,
        "midiPTransport": midi_transport,
    }
    canonical = runner.canonical_json(snapshot)
    return {
        "schema": runner.JOB_SCHEMA,
        "jobId": "v5p-direct-test",
        "preset": {"id": "V5P_40K_EMA"},
        "inputs": {"referenceWav": "A.wav", "targetWav": "B.wav"},
        "render": {"steps": 1, "cfg": 1, "seed": 42, "device": "cuda:0"},
        "snapshotCanonical": canonical,
        "snapshotSHA256": hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
    }


if __name__ == "__main__":
    unittest.main()

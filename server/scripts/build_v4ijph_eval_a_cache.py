#!/usr/bin/env python3
"""Build the per-group A.wav INS cache used by the V4IjPH evaluation."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import torch
from torch import nn
import torch.nn.functional as F


EXPECTED_INTRINSIC_SHA256 = (
    "22b37acc1bb27a26034614b6eab1562131a4197b86fd0221e45350f927663ad2"
)
EXPECTED_SOURCE_REVISION = "4767eea9b05bb22598541d3c6ec42f5c6249d2fc"
EXPECTED_WAVLM_CONFIG_SHA256 = (
    "a3d8fe831aaf63d725b54a8ac36f3549cd4365c5086774b2c89cabbc6f9e129d"
)
TRAINING_SAMPLE_RATE = 44_100
MODEL_SAMPLE_RATE = 16_000


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def tensor_sha256(value: torch.Tensor) -> str:
    value = value.detach().cpu().float().contiguous()
    return hashlib.sha256(value.numpy().tobytes()).hexdigest()


def waveform_sha256(value: torch.Tensor) -> str:
    value = value.detach().cpu().float().contiguous()
    digest = hashlib.sha256()
    digest.update(
        f"sr={TRAINING_SAMPLE_RATE};shape={tuple(value.shape)};".encode("ascii")
    )
    digest.update(value.numpy().tobytes())
    return digest.hexdigest()


class Projection(nn.Module):
    def __init__(self, input_dim: int, output_dim: int = 768) -> None:
        super().__init__()
        self.linear1 = nn.Linear(input_dim, output_dim, bias=False)
        self.linear2 = nn.Linear(output_dim, output_dim, bias=False)
        self.layer_norm = nn.LayerNorm(output_dim)
        self.drop = nn.Dropout(0.5)

    def forward(self, value: torch.Tensor) -> torch.Tensor:
        direct = self.linear1(value)
        residual = self.drop(self.linear2(F.gelu(direct)))
        return self.layer_norm(direct + residual)


class SpeechEncoder(nn.Module):
    def __init__(self, config_dir: Path) -> None:
        super().__init__()
        from transformers import AutoConfig, AutoModel

        config = AutoConfig.from_pretrained(config_dir, local_files_only=True)
        config.layerdrop = 0.0
        self.base = AutoModel.from_config(config)

    def forward(
        self, audio: torch.Tensor, attention_mask: torch.Tensor
    ) -> torch.Tensor:
        hidden = self.base(
            audio,
            attention_mask=attention_mask,
            return_dict=False,
        )[0]
        feature_mask = self.base._get_feature_vector_attention_mask(
            feature_vector_length=hidden.shape[1],
            attention_mask=attention_mask,
        ).unsqueeze(-1)
        feature_mask = feature_mask.to(dtype=hidden.dtype, device=hidden.device)
        return (hidden * feature_mask).sum(dim=1) / feature_mask.sum(dim=1).clamp(
            min=1.0
        )


class AudioOnlyParaSpeechCLAP(nn.Module):
    """Exact ParaSpeechCLAP audio branch without constructing the unused text tower."""

    def __init__(self, config_dir: Path) -> None:
        super().__init__()
        self.audio_branch = SpeechEncoder(config_dir)
        self.audio_projection = Projection(self.audio_branch.base.config.hidden_size)

    def encode(
        self, audio: torch.Tensor, attention_mask: torch.Tensor
    ) -> torch.Tensor:
        return F.normalize(
            self.audio_projection(self.audio_branch(audio, attention_mask)), dim=-1
        )


def load_encoder(
    checkpoint: Path, wavlm_config_dir: Path, device: torch.device
) -> AudioOnlyParaSpeechCLAP:
    if sha256_file(checkpoint) != EXPECTED_INTRINSIC_SHA256:
        raise ValueError("Intrinsic checkpoint SHA256 mismatch")
    config_path = wavlm_config_dir / "config.json"
    if sha256_file(config_path) != EXPECTED_WAVLM_CONFIG_SHA256:
        raise ValueError("WavLM config SHA256 mismatch")
    full_state = torch.load(checkpoint, map_location="cpu", weights_only=True)
    prefixes = ("audio_branch.", "audio_projection.")
    audio_state = {key: value for key, value in full_state.items() if key.startswith(prefixes)}
    if len(audio_state) == len(full_state):
        raise ValueError("Intrinsic checkpoint unexpectedly contains no text-side state")
    encoder = AudioOnlyParaSpeechCLAP(wavlm_config_dir)
    incompatible = encoder.load_state_dict(audio_state, strict=False)
    if incompatible.missing_keys or incompatible.unexpected_keys:
        raise ValueError(
            "Audio checkpoint state mismatch: "
            f"missing={incompatible.missing_keys} unexpected={incompatible.unexpected_keys}"
        )
    del full_state, audio_state
    return encoder.to(device).eval()


def load_complete_a(path: Path) -> tuple[torch.Tensor, int]:
    import torchaudio
    import soundfile as sf

    audio, original_rate = sf.read(path, dtype="float32", always_2d=True)
    if audio.ndim != 2 or audio.shape[1] != 1:
        raise ValueError(f"A reference must be mono: {path}: {tuple(audio.shape)}")
    waveform = torch.from_numpy(audio[:, 0].copy())
    if original_rate != TRAINING_SAMPLE_RATE:
        waveform = torchaudio.functional.resample(
            waveform.unsqueeze(0), original_rate, TRAINING_SAMPLE_RATE
        )
        waveform = waveform.squeeze(0)
    waveform = waveform.contiguous().float()
    if waveform.numel() == 0:
        raise ValueError(f"A reference is empty: {path}")
    return waveform, int(original_rate)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--wavlm-config-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--device", default="cuda:0")
    return parser.parse_args()


def main() -> None:
    import torchaudio

    args = parse_args()
    dataset = args.dataset.resolve()
    checkpoint = args.checkpoint.resolve()
    config_dir = args.wavlm_config_dir.resolve()
    output_dir = args.output_dir.resolve()
    device = torch.device(args.device)
    torch.cuda.set_device(device)
    groups = json.loads((dataset / "manifest.json").read_text(encoding="utf-8"))[
        "groups"
    ]
    if len(groups) != 27:
        raise ValueError(f"Expected 27 evaluation groups, got {len(groups)}")

    output_dir.mkdir(parents=True, exist_ok=True)
    encoder = load_encoder(checkpoint, config_dir, device)
    resampler = torchaudio.transforms.Resample(TRAINING_SAMPLE_RATE, MODEL_SAMPLE_RATE)
    vectors: list[torch.Tensor] = []
    records: list[dict] = []
    for index, group in enumerate(groups, start=1):
        a_path = (dataset / group["directory"] / "A.wav").resolve()
        waveform, original_rate = load_complete_a(a_path)
        model_audio = resampler(waveform).contiguous()
        if model_audio.numel() < 400:
            model_audio = F.pad(model_audio, (0, 400 - model_audio.numel()))
        audio = model_audio.unsqueeze(0).to(device)
        mask = torch.ones_like(audio, dtype=torch.long)
        with torch.inference_mode():
            vector = encoder.encode(audio, mask).squeeze(0).float().cpu()
        norm = float(vector.norm())
        if tuple(vector.shape) != (768,) or not 0.99 <= norm <= 1.01:
            raise ValueError(f"Invalid INS vector for {group['name']}: norm={norm}")
        vectors.append(vector)
        record = {
            "index": index,
            "group": group["name"],
            "aReference": {
                "path": str(a_path),
                "fileSHA256": sha256_file(a_path),
                "originalSampleRate": original_rate,
                "encoderInputSampleRate": TRAINING_SAMPLE_RATE,
                "encoderInputSamples": int(waveform.numel()),
                "encoderInputDurationSeconds": waveform.numel() / TRAINING_SAMPLE_RATE,
                "encoderInputWaveformSHA256": waveform_sha256(waveform),
                "cropPolicy": "none_complete_A.wav",
                "channelPolicy": "require_mono",
            },
            "ins": {
                "shape": [768],
                "dtype": "float32",
                "l2": norm,
                "sha256": tensor_sha256(vector),
            },
        }
        records.append(record)
        print(
            json.dumps(
                {"type": "encoded", "index": index, "group": group["name"], "l2": norm},
                ensure_ascii=False,
            ),
            flush=True,
        )

    matrix = torch.stack(vectors).contiguous()
    matrix_path = output_dir / "a_ins.f32.npy"
    np.save(matrix_path, matrix.numpy(), allow_pickle=False)
    manifest = {
        "schema": "aisvc.v4ijph-eval-a-ins.v1",
        "dataset": str(dataset),
        "groupCount": len(records),
        "matrix": {
            "file": matrix_path.name,
            "shape": list(matrix.shape),
            "dtype": "float32",
            "sha256": sha256_file(matrix_path),
        },
        "encoder": {
            "name": "ajd12342/paraspeechclap-intrinsic",
            "sourceRevision": EXPECTED_SOURCE_REVISION,
            "checkpoint": str(checkpoint),
            "checkpointSHA256": EXPECTED_INTRINSIC_SHA256,
            "wavlmConfig": str(config_dir / "config.json"),
            "wavlmConfigSHA256": EXPECTED_WAVLM_CONFIG_SHA256,
            "modelSampleRate": MODEL_SAMPLE_RATE,
            "output": "get_audio_embedding(normalize=True)",
            "textTowerExecution": "not_constructed_not_used_by_audio_embedding",
        },
        "records": records,
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "type": "complete",
                "groups": len(records),
                "matrix": str(matrix_path),
                "manifest": str(manifest_path),
            },
            ensure_ascii=False,
        ),
        flush=True,
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"type": "error", "message": str(error)}), flush=True)
        raise

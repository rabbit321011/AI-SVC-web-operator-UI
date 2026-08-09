#!/usr/bin/env python3
"""Batch V4IjPH evaluation: A.wav INS style with B-only H/PUL and GAME MIDI_P."""

from __future__ import annotations

import argparse
import gc
import json
import os
from pathlib import Path
import sys
from types import MethodType

import numpy as np

import v4iph_eval_batch as base


CHECKPOINT_SCHEMA = "v4ijph_training_checkpoint_v2"
EXPECTED_CHECKPOINT_SHA256 = (
    "0dfa31c293d3558dbe28868edb66ecf2959a5b92bbdbc96f0819222df351c2e9"
)
EXPECTED_PACKAGE_HASHES = {
    "train/train_v4ijph.py": "f6bf45b57a4e0c3bc03198acc6518765af96b2695655b6184d48311a2ab8ff7c",
    "train/v4ijph_contract.py": "0c8a5c8efec8eb3ff71eae2cf30c9f75407b1d506569b0e5ce9fb3c42566cd04",
    "train/v4ijph_ins_cache.py": "49832bbf0200afdab7419de82939221ca682e3250bc7764c2be343fcc2f957c3",
    "infer/v4ijph_sampling.py": "0c60870cc596ead09a3022319c6cced6ddad648a087dc5e963a66f1faaf01d44",
}


def require_package_hashes(package: Path) -> dict[str, str]:
    for relative, expected in EXPECTED_PACKAGE_HASHES.items():
        actual = base.sha256_file(package / relative)
        if actual != expected:
            raise ValueError(f"V4IjPH package hash mismatch: {relative}: {actual}")
    return dict(EXPECTED_PACKAGE_HASHES)


def strict_checkpoint_metadata(
    checkpoint: Path,
    runtime: Path,
    package: Path,
    vae_ckpt: Path,
    game_cache_manifest: Path,
    game_model: Path,
    midi_p_schema: str,
    game_cache_schema: str,
):
    import torch

    if base.sha256_file(checkpoint) != EXPECTED_CHECKPOINT_SHA256:
        raise ValueError("V4IjPH 30k checkpoint SHA256 mismatch")
    payload = torch.load(
        checkpoint, map_location="cpu", weights_only=False, mmap=True
    )
    if payload.get("checkpoint_schema") != CHECKPOINT_SCHEMA:
        raise ValueError(f"unexpected checkpoint schema: {payload.get('checkpoint_schema')}")
    if payload.get("run_state") != "complete" or int(payload.get("global_step", -1)) != 30000:
        raise ValueError("V4IjPH checkpoint is not the completed 30k final")
    metadata = payload.get("v4ijph_training")
    if not isinstance(metadata, dict) or metadata.get("schema") != CHECKPOINT_SCHEMA:
        raise ValueError("V4IjPH checkpoint lacks authoritative training metadata")
    expected_values = {
        "reference_mode": "all_b",
        "reference_policy": "ref_len_zero_global_ins_style_or_exact_zero_null",
        "placement_mode": "phone_pul",
        "midi_teacher": "GAME medium K4 offline cache",
        "midi_fuzz_disturb": False,
    }
    for key, expected in expected_values.items():
        if metadata.get(key) != expected:
            raise ValueError(f"V4IjPH metadata mismatch: {key}")
    ins = metadata.get("ins") or {}
    if ins.get("style_guidance") != 1.0:
        raise ValueError("V4IjPH style guidance is not fixed at 1")
    contract = metadata.get("h_pul") or {}
    for key, expected in {
        "pul_token_id": base.PUL_TOKEN,
        "sep_token_id": base.SEP_TOKEN,
        "sep_policy": "next_runtime_control_anchor_minus_one",
        "final_sep_policy": "last_dense_text_frame",
        "pul_policy": "repeat_after_packed_lyrics_until_sep",
        "hard_fallback_policy": "whole_sample_exact_control",
    }.items():
        if contract.get(key) != expected:
            raise ValueError(f"V4IjPH H/PUL contract mismatch: {key}")
    if payload.get("midi_p_schema") != midi_p_schema:
        raise ValueError("checkpoint MIDI_P schema differs from inference runtime")
    if payload.get("game_cache_schema") != game_cache_schema:
        raise ValueError("checkpoint GAME cache schema differs from inference runtime")

    expected_hashes = metadata.get("file_sha256") or {}
    actual_paths = {
        "training_code": package / "train/train_v4ijph.py",
        "contract_code": package / "train/v4ijph_contract.py",
        "ins_cache_code": package / "train/v4ijph_ins_cache.py",
        "inference_sampling_code": package / "infer/v4ijph_sampling.py",
        "placement_code": runtime / "h_alignment/placement_v4iph.py",
        "model_config": runtime / "YingMusic_Singer.yaml",
        "vae_config": runtime / "stable_audio_2_0_vae_20hz_official.json",
        "vae_checkpoint": vae_ckpt,
        "game_cache_manifest": game_cache_manifest,
    }
    for key, path in actual_paths.items():
        actual = base.sha256_file(path)
        if actual != expected_hashes.get(key):
            raise ValueError(f"{key} SHA256 mismatch: {actual} != {expected_hashes.get(key)}")
    game_manifest = json.loads(game_cache_manifest.read_text(encoding="utf-8"))
    if game_manifest.get("cache_schema") != game_cache_schema:
        raise ValueError("training GAME manifest schema mismatch")
    if game_manifest.get("game_model_sha256") != base.EXPECTED_GAME_MODEL_SHA256:
        raise ValueError("training GAME manifest model hash mismatch")
    if base.sha256_file(game_model) != base.EXPECTED_GAME_MODEL_SHA256:
        raise ValueError("inference GAME model hash mismatch")
    return payload


def build_model(
    checkpoint: Path,
    runtime: Path,
    package: Path,
    vae_ckpt: Path,
    game_cache_manifest: Path,
    game_model: Path,
    device: str,
):
    import torch

    if not hasattr(torch, "load_orig"):
        torch.load_orig = torch.load

        def load_compat(*args, **kwargs):
            kwargs.setdefault("weights_only", False)
            return torch.load_orig(*args, **kwargs)

        torch.load = load_compat
    from omegaconf import OmegaConf
    from src.YingMusicSinger.melody.game_cache_v4ph import GAME_CACHE_SCHEMA
    from src.YingMusicSinger.melody.midi_p_v4ph import (
        MIDI_P_V4PH_SCHEMA,
        V4PHMIDIEmbedding,
    )
    from src.YingMusicSinger.models.dit import DiT
    from src.YingMusicSinger.models.model import Singer
    from src.YingMusicSinger.utils.stable_audio_tools.vae_copysyn import StableAudioInfer
    from v4ijph_contract import InsStyleAdapter, strict_load_module

    payload = strict_checkpoint_metadata(
        checkpoint,
        runtime,
        package,
        vae_ckpt,
        game_cache_manifest,
        game_model,
        MIDI_P_V4PH_SCHEMA,
        GAME_CACHE_SCHEMA,
    )
    cfg = OmegaConf.load(runtime / "YingMusic_Singer.yaml")
    policy = Singer(
        transformer=DiT(
            **cfg.model.arch,
            text_num_embeds=cfg.datasets_cfg.text_num_embeds,
            mel_dim=cfg.model.mel_spec.n_mel_channels,
            long_skip_connection=True,
        ),
        is_tts_pretrain=cfg.model.is_tts_pretrain,
        melody_input_source=cfg.model.melody_input_source,
        cka_disabled=cfg.model.cka_disabled,
        num_channels=None,
        extra_parameters=cfg.extra_parameters,
        mel_spec_kwargs=cfg.model.mel_spec,
        distill_stage=None,
        use_guidance_scale_embed=False,
    )
    policy.midi_p_v4ph = V4PHMIDIEmbedding(seed=42)
    state = {
        key.replace("module.", "").replace("ema_model.", ""): value
        for key, value in payload["ema_model_state_dict"].items()
        if key not in {"initted", "step"}
    }
    policy.load_state_dict(state, strict=True)
    adapter = InsStyleAdapter()
    strict_load_module(
        adapter, payload["adapter_ema_model_state_dict"], "V4IjPH inference adapter"
    )
    del payload, state
    gc.collect()
    policy = policy.to(device).eval()
    adapter = adapter.to(device).eval()
    policy.smoothMelody_MIDIFuzzDisturb = torch.nn.Identity()
    p_weight = policy.midi_p_v4ph.embedding.weight.detach()
    if tuple(p_weight.shape) != (257, 128) or not torch.equal(
        p_weight[256], torch.zeros_like(p_weight[256])
    ):
        raise ValueError("V4IjPH P embedding shape/PAD row is invalid")
    vae = StableAudioInfer(
        model_config_path=str(runtime / "stable_audio_2_0_vae_20hz_official.json"),
        model_ckpt_path=str(vae_ckpt),
    ).to(device).eval()
    return policy, adapter, vae


def install_style_sampler(policy, adapter):
    import torch
    from v4ijph_sampling import full_timeline_cond, sample_full_timeline_style

    def sample_override(
        self,
        *,
        text,
        duration,
        midi_p,
        steps,
        cfg_strength,
        seed,
        **_kwargs,
    ):
        if not hasattr(self, "_v4ijph_current_ins"):
            raise RuntimeError("Per-group A INS was not installed before sampling")
        style_cond, style = full_timeline_cond(
            adapter,
            self._v4ijph_current_ins,
            int(duration),
            null_ins=False,
        )
        if bool(torch.count_nonzero(style)) is False:
            raise AssertionError("A INS produced an all-zero V4IjPH style")
        output, trajectory = sample_full_timeline_style(
            self,
            style_cond=style_cond,
            text=text,
            midi=midi_p,
            duration=duration,
            steps=steps,
            cfg_strength=cfg_strength,
            seed=seed,
            t_shift=0.5,
        )
        self._v4ijph_last_style = style.detach().float().cpu()
        self._v4ijph_last_cond_sha256 = base.tensor_sha256(style_cond)
        return output, trajectory

    policy.sample = MethodType(sample_override, policy)


def load_a_ins_cache(cache_dir: Path, dataset: Path, groups: list[dict]):
    manifest_path = cache_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schema") != "aisvc.v4ijph-eval-a-ins.v1":
        raise ValueError("unsupported A INS cache schema")
    if Path(manifest["dataset"]).resolve() != dataset:
        raise ValueError("A INS cache dataset mismatch")
    matrix_path = cache_dir / manifest["matrix"]["file"]
    if base.sha256_file(matrix_path) != manifest["matrix"]["sha256"]:
        raise ValueError("A INS matrix SHA256 mismatch")
    matrix = np.load(matrix_path, allow_pickle=False)
    if matrix.shape != (len(groups), 768) or matrix.dtype != np.float32:
        raise ValueError(f"invalid A INS matrix: {matrix.shape} {matrix.dtype}")
    records = manifest.get("records") or []
    if [record["group"] for record in records] != [group["name"] for group in groups]:
        raise ValueError("A INS cache group order mismatch")
    for group, record in zip(groups, records):
        a_path = dataset / group["directory"] / "A.wav"
        if base.sha256_file(a_path) != record["aReference"]["fileSHA256"]:
            raise ValueError(f"A reference SHA256 mismatch: {group['name']}")
    return matrix, records, manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--alignment-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--v4ijph-package", type=Path, required=True)
    parser.add_argument("--a-ins-cache", type=Path, required=True)
    parser.add_argument("--singer-root", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--vae-ckpt", type=Path, required=True)
    parser.add_argument("--game-repo", type=Path, required=True)
    parser.add_argument("--game-deps", type=Path, required=True)
    parser.add_argument("--game-model", type=Path, required=True)
    parser.add_argument("--game-cache-manifest", type=Path, required=True)
    parser.add_argument("--steps", type=int, default=32)
    parser.add_argument("--cfg", type=float, default=3.0)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--limit", type=int)
    return parser.parse_args()


def main() -> None:
    import torch

    args = parse_args()
    dataset = args.dataset.resolve()
    alignment_dir = args.alignment_dir.resolve()
    output_dir = args.output_dir.resolve()
    runtime = args.runtime.resolve()
    package = args.v4ijph_package.resolve()
    singer_root = args.singer_root.resolve()
    checkpoint = args.checkpoint.resolve()
    vae_ckpt = args.vae_ckpt.resolve()
    game_model = args.game_model.resolve()
    game_cache_manifest = args.game_cache_manifest.resolve()

    package_hashes = require_package_hashes(package)
    runtime_hashes = base.require_runtime_hashes(runtime, singer_root)
    for path in (package / "train", package / "infer", runtime, singer_root):
        if str(path) not in sys.path:
            sys.path.insert(0, str(path))
    os.chdir(singer_root)
    from h_alignment.placement_v4iph import render_h_pul_placements
    from src.YingMusicSinger.melody.game_cache_v4ph import (
        canonicalize_game_cache,
        game_cache_to_model_tracks,
    )
    from src.YingMusicSinger.melody.game_runtime_v4ph import (
        extract_game_notes_with_posterior,
        stable_game_seed,
    )

    alignment_manifest = json.loads(
        (alignment_dir / "manifest.json").read_text(encoding="utf-8")
    )
    if alignment_manifest.get("schema") != base.ALIGNMENT_SCHEMA:
        raise ValueError("unsupported alignment schema")
    if Path(alignment_manifest["sourceDataset"]).resolve() != dataset:
        raise ValueError("alignment source dataset does not match --dataset")
    dataset_groups = json.loads((dataset / "manifest.json").read_text(encoding="utf-8"))[
        "groups"
    ]
    alignment_groups = alignment_manifest.get("groups") or []
    if [item["name"] for item in dataset_groups] != [
        item["name"] for item in alignment_groups
    ]:
        raise ValueError("dataset/alignment group order mismatch")
    matrix, a_records, a_manifest = load_a_ins_cache(
        args.a_ins_cache.resolve(), dataset, dataset_groups
    )
    if args.limit is not None:
        count = min(args.limit, len(dataset_groups))
        dataset_groups = dataset_groups[:count]
        alignment_groups = alignment_groups[:count]
        matrix = matrix[:count]
        a_records = a_records[:count]

    output_dir.mkdir(parents=True, exist_ok=True)
    audit_dir = output_dir / "_placement"
    audit_dir.mkdir(exist_ok=True)
    base.emit("loading_v4ijph", checkpoint=str(checkpoint), groups=len(dataset_groups))
    policy, adapter, vae = build_model(
        checkpoint,
        runtime,
        package,
        vae_ckpt,
        game_cache_manifest,
        game_model,
        args.device,
    )
    install_style_sampler(policy, adapter)
    base.emit("loaded_v4ijph")
    game, language_map = base.load_game(
        args.game_repo, args.game_deps, game_model, torch.device(args.device)
    )
    base.emit("loaded_game", languageMap=language_map)

    completed = 0
    skipped = 0
    for index, (group, alignment_entry, ins_row, a_record) in enumerate(
        zip(dataset_groups, alignment_groups, matrix, a_records), start=1
    ):
        output_path = output_dir / f"{base.safe_name(group['name'])}.wav"
        audit_path = audit_dir / f"{base.safe_name(group['name'])}.json"
        if args.resume and base.is_valid_wav(output_path) and audit_path.is_file():
            skipped += 1
            base.emit("skipped", index=index, total=len(dataset_groups), group=group["name"])
            continue
        alignment = json.loads(
            (alignment_dir / alignment_entry["alignmentFile"]).read_text(encoding="utf-8")
        )
        group_dir = dataset / group["directory"]
        policy._v4ijph_current_ins = torch.from_numpy(ins_row.copy()).unsqueeze(0).to(
            args.device, dtype=torch.float32
        )
        base.emit("start", index=index, total=len(dataset_groups), group=group["name"])
        wav, sample_rate, audit = base.synthesize(
            policy,
            vae,
            game,
            language_map,
            render_h_pul_placements,
            canonicalize_game_cache,
            game_cache_to_model_tracks,
            extract_game_notes_with_posterior,
            stable_game_seed,
            group_dir / "B.wav",
            alignment,
            args.steps,
            args.cfg,
            args.seed,
            args.device,
        )
        base.save_audio(output_path, wav.unsqueeze(0), sample_rate)
        style = policy._v4ijph_last_style
        audit["schema"] = "aisvc.v4ijph-placement-audit.v1"
        audit.update(
            {
                "group": group["name"],
                "checkpoint": str(checkpoint),
                "checkpointSHA256": EXPECTED_CHECKPOINT_SHA256,
                "cfg": args.cfg,
                "steps": args.steps,
                "seed": args.seed,
                "aReference": a_record["aReference"],
                "ins": a_record["ins"],
                "style": {
                    "shape": list(style.shape),
                    "l2": float(style.norm()),
                    "sha256": base.tensor_sha256(style),
                    "fullTimelineCondSHA256": policy._v4ijph_last_cond_sha256,
                    "cfgPolicy": "same_style_in_conditional_and_content_unconditional_branches",
                    "styleGuidance": 1.0,
                },
                "referenceContract": {
                    "A": "INS_only_complete_A.wav_no_crop",
                    "B": "GAME_MIDI_P_and_H_PUL_target",
                    "refFrames": 0,
                    "AEntersVAE": False,
                    "AConsumesTimeline": False,
                },
                "runtimeSHA256": runtime_hashes,
                "v4ijphPackageSHA256": package_hashes,
                "aInsCacheMatrixSHA256": a_manifest["matrix"]["sha256"],
            }
        )
        audit_path.write_text(
            json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        completed += 1
        del wav
        torch.cuda.empty_cache()
        base.emit(
            "done",
            index=index,
            total=len(dataset_groups),
            group=group["name"],
            styleL2=float(style.norm()),
            phone=audit["phonePhraseCount"],
            pul=audit["pulPhraseCount"],
        )

    del policy, adapter, vae, game
    torch.cuda.empty_cache()
    gc.collect()
    base.emit("complete", completed=completed, skipped=skipped, total=len(dataset_groups))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        base.emit("error", message=str(error))
        raise

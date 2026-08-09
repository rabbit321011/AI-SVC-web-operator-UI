#!/usr/bin/env python3
"""Run one hash-locked V4H web inference job."""

import argparse
import json
import os
from pathlib import Path
import sys


SCHEMA = "aisvc.v4h-web-alignment.v1"


def emit(event_type, **payload):
    print(json.dumps({"type": event_type, **payload}, ensure_ascii=False), flush=True)


def parse_args():
    parser = argparse.ArgumentParser(description="Run one V4H web inference job")
    parser.add_argument("--ref-audio", type=Path, required=True)
    parser.add_argument("--melody-audio", type=Path, required=True)
    parser.add_argument("--alignment", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--audit", type=Path, required=True)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--singer-root", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--vae-ckpt", type=Path, required=True)
    parser.add_argument("--midi-ckpt", type=Path, required=True)
    parser.add_argument("--steps", type=int, default=32)
    parser.add_argument("--cfg", type=float, default=3.0)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--device", default="cuda:0")
    return parser.parse_args()


def main():
    args = parse_args()
    scripts_dir = Path(__file__).resolve().parent
    sys.path.insert(0, str(scripts_dir))
    import v4h_eval_batch as batch

    runtime = args.runtime.resolve()
    singer_root = args.singer_root.resolve()
    placement_path = runtime / "h_alignment" / "placement.py"
    if batch.sha256_file(placement_path) != batch.EXPECTED_PLACEMENT_SHA256:
        raise ValueError("authoritative V4H placement module SHA256 mismatch")
    sys.path.insert(0, str(runtime))
    sys.path.insert(0, str(singer_root))
    os.chdir(singer_root)
    from h_alignment.placement import render_h_pul_placements
    import torch
    import soundfile as sf

    alignment = json.loads(args.alignment.read_text(encoding="utf-8"))
    if alignment.get("schema") != SCHEMA:
        raise ValueError(f"unsupported V4H web alignment schema: {alignment.get('schema')}")
    emit("loading_model", checkpoint=str(args.checkpoint.resolve()))
    policy, vae, midi_teacher, mel_extract = batch.build_model(
        checkpoint=args.checkpoint.resolve(),
        config=runtime / "YingMusic_Singer.yaml",
        vae_config=runtime / "stable_audio_2_0_vae_20hz_official.json",
        vae_ckpt=args.vae_ckpt.resolve(),
        midi_ckpt=args.midi_ckpt.resolve(),
        device=args.device,
    )
    emit("loaded_model")
    emit("synthesizing")
    wav, sample_rate, audit = batch.synthesize(
        policy=policy,
        vae=vae,
        midi_teacher=midi_teacher,
        mel_extract=mel_extract,
        render_h_pul_placements=render_h_pul_placements,
        ref_audio=args.ref_audio.resolve(),
        melody_audio=args.melody_audio.resolve(),
        alignment=alignment,
        steps=args.steps,
        cfg_strength=args.cfg,
        seed=args.seed,
        device=args.device,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(args.output), wav.numpy(), sample_rate, subtype="FLOAT")
    audit.update(
        {
            "schema": "aisvc.v4h-web-placement-audit.v1",
            "checkpoint": str(args.checkpoint.resolve()),
            "alignment": str(args.alignment.resolve()),
            "escapeSeconds": alignment["escapeSeconds"],
            "cfg": args.cfg,
            "steps": args.steps,
            "seed": args.seed,
        }
    )
    args.audit.write_text(
        json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    emit(
        "complete",
        output=str(args.output),
        audit=str(args.audit),
        phonePhraseCount=audit["phonePhraseCount"],
        pulPhraseCount=audit["pulPhraseCount"],
        exactControlPhraseCount=audit["exactControlPhraseCount"],
    )
    del wav, policy, vae, midi_teacher, mel_extract
    torch.cuda.empty_cache()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit("error", message=str(error))
        raise

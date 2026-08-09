#!/usr/bin/env python3
"""Batch an existing SVS evaluation folder through YingMusic-SVC."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import types


YINGMUSIC = Path("E:/AIscene/AISVCs/YingMusic-SVC")
TEMP_MODULES = Path("E:/AIscene/AISVCs/temp/temp_0502")


def emit(event_type, **payload):
    print(json.dumps({"type": event_type, **payload}, ensure_ascii=False), flush=True)


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_name(value):
    value = re.sub(r'[<>:"/\\|?*]', "_", str(value)).strip().rstrip(".")
    return value or "unnamed"


def is_valid_wav(path):
    return Path(path).is_file() and Path(path).stat().st_size > 44


def load_inference_module():
    sys.path.insert(0, str(YINGMUSIC))
    sys.path.insert(0, str(TEMP_MODULES))

    sox_dummy = types.ModuleType("torchaudio.sox_effects")
    sox_dummy.apply_effects_tensor = lambda *args, **kwargs: (_ for _ in ()).throw(
        RuntimeError("sox_effects unavailable")
    )
    sys.modules["torchaudio.sox_effects"] = sox_dummy

    import torchaudio

    torchaudio.sox_effects = sox_dummy
    import my_inference

    return my_inference


def parse_args():
    parser = argparse.ArgumentParser(description="Batch SVC evaluation runner")
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--diffusion-steps", type=int, default=30)
    parser.add_argument("--inference-cfg-rate", type=float, default=0.7)
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--fp16", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--limit", type=int)
    return parser.parse_args()


def main():
    args = parse_args()
    source_dir = args.source_dir.resolve()
    dataset = args.dataset.resolve()
    output_dir = args.output_dir.resolve()
    checkpoint = args.checkpoint.resolve()
    config = args.config.resolve()

    dataset_manifest = json.loads((dataset / "manifest.json").read_text(encoding="utf-8"))
    groups = dataset_manifest.get("groups") or []
    if args.limit is not None:
        groups = groups[: args.limit]
    if not groups:
        raise ValueError("dataset contains no evaluation groups")

    missing = []
    for group in groups:
        name = safe_name(group["name"])
        source = source_dir / f"{name}.wav"
        target = dataset / group["directory"] / "A.wav"
        if not is_valid_wav(source):
            missing.append(str(source))
        if not is_valid_wav(target):
            missing.append(str(target))
    if missing:
        raise FileNotFoundError(f"missing evaluation audio: {missing[:5]}")

    output_dir.mkdir(parents=True, exist_ok=True)
    audit_dir = output_dir / "_svc_audit"
    raw_dir = output_dir / "_raw"
    audit_dir.mkdir(exist_ok=True)
    raw_dir.mkdir(exist_ok=True)

    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    os.environ.setdefault("HF_DATASETS_OFFLINE", "1")
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.chdir(YINGMUSIC)

    import torch

    svc = load_inference_module()
    runtime_args = argparse.Namespace(
        checkpoint=str(checkpoint),
        config=str(config),
        cuda=torch.device(args.device),
        fp16=args.fp16,
        diffusion_steps=args.diffusion_steps,
        length_adjust=1.0,
        inference_cfg_rate=args.inference_cfg_rate,
        f0_condition=True,
        semi_tone_shift=None,
        output=str(output_dir),
        expname="_raw",
        accompany=None,
    )
    checkpoint_hash = sha256_file(checkpoint)
    config_hash = sha256_file(config)
    emit("loading", checkpoint=str(checkpoint), groups=len(groups))
    models = svc.load_models_api(runtime_args, device=runtime_args.cuda)
    emit("loaded")

    completed = 0
    skipped = 0
    for index, group in enumerate(groups, start=1):
        name = safe_name(group["name"])
        source = source_dir / f"{name}.wav"
        target = dataset / group["directory"] / "A.wav"
        output = output_dir / f"{name}.wav"
        audit = audit_dir / f"{name}.json"
        if args.resume and is_valid_wav(output) and audit.is_file():
            skipped += 1
            emit("skipped", index=index, total=len(groups), group=group["name"])
            continue

        runtime_args.source = str(source)
        runtime_args.target = str(target)
        emit("start", index=index, total=len(groups), group=group["name"])
        generated = Path(svc.run_inference(runtime_args, models, device=runtime_args.cuda))
        if not is_valid_wav(generated):
            raise RuntimeError(f"SVC emitted no valid WAV for {group['name']}: {generated}")
        os.replace(generated, output)
        payload = {
            "schema": "aisvc.svc-eval-audit.v1",
            "group": group["name"],
            "source": str(source),
            "sourceSHA256": sha256_file(source),
            "camPlusReference": str(target),
            "camPlusReferenceSHA256": sha256_file(target),
            "checkpoint": str(checkpoint),
            "checkpointSHA256": checkpoint_hash,
            "config": str(config),
            "configSHA256": config_hash,
            "diffusionSteps": args.diffusion_steps,
            "inferenceCfgRate": args.inference_cfg_rate,
            "f0Condition": True,
            "semiToneShift": None,
            "fp16": args.fp16,
            "outputSHA256": sha256_file(output),
        }
        audit.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        completed += 1
        emit("done", index=index, total=len(groups), group=group["name"])

    shutil.rmtree(raw_dir, ignore_errors=True)
    emit("complete", completed=completed, skipped=skipped, total=len(groups))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit("error", message=str(error))
        raise

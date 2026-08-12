#!/usr/bin/env python3
"""Resident SVS worker for V4fg (T1) and V4Hg (PH/PUL)."""

import argparse
import importlib.util
import json
import os
import sys
from pathlib import Path


def emit(event_type, **payload):
    print(json.dumps({"type": event_type, **payload}, ensure_ascii=False), flush=True)


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_t1_runtime(preset):
    singer_root = Path(str(preset["singerRoot"])).resolve()
    sys.path.insert(0, str(singer_root))
    os.chdir(singer_root)
    infer = load_module(singer_root / "infer_v4_formal.py", "infer_v4_formal")
    policy, vae, midi_teacher, mel_extract, tokenizer = infer.build_model(
        checkpoint=str(preset["checkpoint"]),
        vae_ckpt=str(preset["vaeCheckpoint"]),
        midi_ckpt=str(preset["midiCheckpoint"]),
        model_id=str(preset["modelId"]),
        device=str(preset["device"] or "cuda:0"),
    )
    return {
        "engine": "t1",
        "module": infer,
        "policy": policy,
        "vae": vae,
        "midiTeacher": midi_teacher,
        "melExtract": mel_extract,
        "tokenizer": tokenizer,
        "checkpoint": str(preset["checkpoint"]),
    }


def load_v4h_runtime(preset):
    scripts_dir = Path(__file__).resolve().parent
    sys.path.insert(0, str(scripts_dir))
    import v4h_eval_batch as batch
    runtime = Path(str(preset["runtime"])).resolve()
    singer_root = Path(str(preset["singerRoot"])).resolve()
    placement_path = runtime / "h_alignment" / "placement.py"
    if batch.sha256_file(placement_path) != batch.EXPECTED_PLACEMENT_SHA256:
        raise ValueError("authoritative V4H placement module SHA256 mismatch")
    sys.path.insert(0, str(runtime))
    sys.path.insert(0, str(singer_root))
    os.chdir(singer_root)
    from h_alignment.placement import render_h_pul_placements
    policy, vae, midi_teacher, mel_extract = batch.build_model(
        checkpoint=Path(str(preset["checkpoint"])).resolve(),
        config=runtime / "YingMusic_Singer.yaml",
        vae_config=runtime / "stable_audio_2_0_vae_20hz_official.json",
        vae_ckpt=Path(str(preset["vaeCheckpoint"])).resolve(),
        midi_ckpt=Path(str(preset["midiCheckpoint"])).resolve(),
        device=str(preset["device"] or "cuda:0"),
    )
    return {
        "engine": "v4h",
        "module": batch,
        "placement": render_h_pul_placements,
        "policy": policy,
        "vae": vae,
        "midiTeacher": midi_teacher,
        "melExtract": mel_extract,
        "checkpoint": str(preset["checkpoint"]),
    }


def infer_t1(runtime, request):
    output = Path(str(request["output"])).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    wav, sample_rate = runtime["module"].synthesize(
        runtime["policy"],
        runtime["vae"],
        runtime["midiTeacher"],
        runtime["melExtract"],
        runtime["tokenizer"],
        ref_audio=str(request["refAudio"]),
        melody_audio=str(request["melodyAudio"]),
        ref_phrases=request["refPhrases"],
        target_phrases=request["targetPhrases"],
        steps=int(request["steps"] or 32),
        cfg_strength=float(request["cfg"] or 3.0),
        seed=int(request["seed"] or 42),
        device=str(request["device"] or "cuda:0"),
    )
    import torchaudio
    torchaudio.save(str(output), wav.unsqueeze(0), sample_rate)
    emit("complete", output=str(output), modelId=runtime["checkpoint"])


def infer_v4h(runtime, request):
    output = Path(str(request["output"])).resolve()
    audit_path = Path(str(request["audit"])).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    alignment = json.loads(Path(str(request["alignment"])).read_text(encoding="utf-8"))
    wav, sample_rate, audit = runtime["module"].synthesize(
        policy=runtime["policy"],
        vae=runtime["vae"],
        midi_teacher=runtime["midiTeacher"],
        mel_extract=runtime["melExtract"],
        render_h_pul_placements=runtime["placement"],
        ref_audio=str(request["refAudio"]),
        melody_audio=str(request["melodyAudio"]),
        alignment=alignment,
        steps=int(request["steps"] or 32),
        cfg_strength=float(request["cfg"] or 3.0),
        seed=int(request["seed"] or 42),
        device=str(request["device"] or "cuda:0"),
    )
    import soundfile as sf
    sf.write(str(output), wav.numpy(), sample_rate, subtype="FLOAT")
    audit.update({
        "schema": "aisvc.v4h-web-placement-audit.v1",
        "checkpoint": runtime["checkpoint"],
        "alignment": str(request["alignment"]),
        "escapeSeconds": alignment.get("escapeSeconds", 0),
        "cfg": float(request["cfg"] or 3.0),
        "steps": int(request["steps"] or 32),
        "seed": int(request["seed"] or 42),
    })
    audit_path.write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    emit("complete", output=str(output), audit=str(audit_path), modelId=runtime["checkpoint"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preset-file", type=Path, required=True)
    args = parser.parse_args()
    preset = json.loads(args.preset_file.read_text(encoding="utf-8"))
    engine = str(preset.get("engine") or "")
    runtime = load_t1_runtime(preset) if engine == "t1" else load_v4h_runtime(preset)
    resident_mib = None
    try:
        import torch
        resident_mib = round(torch.cuda.memory_reserved() / 1024 / 1024, 1)
    except Exception:
        pass
    emit(
        "runtime_ready",
        modelId=str(preset["modelId"]),
        engine=engine,
        residentMiB=resident_mib,
    )
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as error:
            emit("error", message=f"invalid worker request: {error}")
            continue
        request_type = str(request.get("type") or "")
        try:
            if request_type == "ping":
                emit("pong", modelId=str(preset["modelId"]))
            elif request_type == "infer":
                if engine == "t1":
                    infer_t1(runtime, request)
                else:
                    infer_v4h(runtime, request)
                emit("infer_done")
            elif request_type == "shutdown":
                emit("shutdown_ok")
                return
            else:
                raise ValueError(f"unsupported worker request: {request_type}")
        except Exception as error:
            emit("error", message=str(error))
            if request_type == "infer":
                emit("infer_failed")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit("error", message=str(error))
        raise

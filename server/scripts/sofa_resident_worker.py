#!/usr/bin/env python3
"""Resident SOFA worker that keeps JPN_Test2_Plus loaded between jobs."""

import argparse
import importlib.util
import json
import sys
from pathlib import Path


RUNNER = Path(__file__).with_name("sofa_runner.py")
ALIGNMENT_METHOD = "SOFA_JPN_Test2_Plus_full_segment"
MODEL_ID = "Greenleaf2001/JPN_Test2_Plus"


def emit(event_type, **payload):
    print(json.dumps({"type": event_type, **payload}, ensure_ascii=False), flush=True)


def load_runner():
    spec = importlib.util.spec_from_file_location("sofa_runner", RUNNER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import sofa runner: {RUNNER}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_model(runner, repo, ckpt, device):
    import pyopenjtalk
    import torch

    sofa_source = Path(repo) / "src" / "SOFA"
    if not sofa_source.is_dir():
        raise FileNotFoundError(f"SOFA source not found: {sofa_source}")
    sys.path.insert(0, str(sofa_source))
    from modules.task import forced_alignment
    import modules.AP_detector.loudnesss_pectralcentroid_detector as ap_detector_module
    import modules.utils.load_wav as sofa_load_wav
    from modules.utils.post_processing import add_SP, fill_small_gaps

    sofa_load_wav.installed_torchaudio = False
    forced_alignment.load_wav = runner.load_audio_with_librosa
    ap_detector_module.load_wav = runner.load_audio_with_librosa

    emit("log", stage="sofa", message=f"Loading {MODEL_ID}...")
    emit("progress", stage="sofa", progress=8)
    model = forced_alignment.LitForcedAlignmentTask.load_from_checkpoint(
        str(ckpt), map_location=device
    )
    model.set_inference_mode("force")
    model.eval()
    model.freeze()
    model.to(torch.device(device))
    model.on_predict_start()
    return {
        "model": model,
        "pyopenjtalk": pyopenjtalk,
        "ap_detector": ap_detector_module.LoudnessSpectralcentroidAPDetector(),
        "post": {"add_SP": add_SP, "fill_small_gaps": fill_small_gaps},
    }


def align(runner, runtime, request):
    input_path = Path(str(request["input"]))
    transcript_path = Path(str(request["transcript"]))
    output_dir = Path(str(request["outputDir"]))
    output_name = str(request["outputName"])
    if not input_path.is_file():
        raise FileNotFoundError(input_path)
    if not transcript_path.is_file():
        raise FileNotFoundError(transcript_path)
    transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
    if transcript.get("language") != "ja":
        raise ValueError("SOFA JPN_Test2_Plus only accepts Japanese transcripts")
    phrases = transcript.get("phrases") or []
    if not phrases:
        raise ValueError("Whisper transcript contains no phrases")
    phonemes, words, phoneme_to_word = runner.phrases_to_sofa_input(
        phrases, runtime["pyopenjtalk"].g2p
    )
    emit("log", stage="sofa", message="Aligning the complete audio segment...")
    emit("progress", stage="sofa", progress=30)
    import torch
    with torch.inference_mode():
        prediction = runtime["model"].predict_step(
            (input_path, phonemes, words, phoneme_to_word), 0
        )
    prediction = runtime["ap_detector"].process([prediction])[0]
    (
        _,
        duration,
        confidence,
        output_phonemes,
        phoneme_intervals,
        output_words,
        output_word_intervals,
    ) = prediction
    output_words, output_word_intervals = runtime["post"]["fill_small_gaps"](
        output_words, output_word_intervals, duration
    )
    output_phonemes, phoneme_intervals = runtime["post"]["fill_small_gaps"](
        output_phonemes, phoneme_intervals, duration
    )
    output_words, output_word_intervals = runtime["post"]["add_SP"](
        output_words, output_word_intervals, duration
    )
    output_phonemes, phoneme_intervals = runtime["post"]["add_SP"](
        output_phonemes, phoneme_intervals, duration
    )
    result = runner.build_result(
        output_name,
        phrases,
        duration,
        confidence,
        output_words,
        output_word_intervals,
        output_phonemes,
        phoneme_intervals,
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{output_name}.json"
    output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    emit("progress", stage="sofa", progress=95)
    emit("result", **result, outputFile=str(output_path))
    emit("done", alignmentMethod=ALIGNMENT_METHOD, outputFile=str(output_path))
    emit("align_done", outputFile=str(output_path))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--ckpt", required=True)
    parser.add_argument("--device", default="cuda")
    args = parser.parse_args()
    runner = load_runner()
    runtime = load_model(runner, args.repo, args.ckpt, args.device)
    import torch
    emit("runtime_ready", modelId="SOFA Japanese", residentMiB=round(torch.cuda.memory_reserved() / 1024 / 1024, 1))
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
                emit("pong", modelId="SOFA Japanese")
            elif request_type == "align":
                align(runner, runtime, request)
            elif request_type == "shutdown":
                emit("shutdown_ok")
                return
            else:
                raise ValueError(f"unsupported worker request: {request_type}")
        except Exception as error:
            emit("error", message=str(error))
            if request_type == "align":
                emit("infer_failed")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit("error", message=str(error))
        raise

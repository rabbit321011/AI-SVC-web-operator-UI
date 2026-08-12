#!/usr/bin/env python3
"""Resident Whisper worker that keeps faster-whisper loaded between jobs."""

import argparse
import importlib.util
import json
import os
import sys
from pathlib import Path


RUNNER = Path(__file__).with_name("whisper_runner.py")


def emit(event_type, **payload):
    print(json.dumps({"type": event_type, **payload}, ensure_ascii=False), flush=True)


def load_runner():
    spec = importlib.util.spec_from_file_location("whisper_runner", RUNNER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import whisper runner: {RUNNER}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def transcribe(runner, model, request):
    input_path = str(request["input"])
    output_dir = Path(str(request["outputDir"]))
    output_name = str(request["outputName"])
    vad = bool(request.get("vad", True))
    if not Path(input_path).is_file():
        raise FileNotFoundError(input_path)
    output_dir.mkdir(parents=True, exist_ok=True)
    emit("log", message="Transcribing audio...")
    emit("progress", progress=20)
    segments, info = model.transcribe(
        input_path,
        language="ja",
        beam_size=1,
        vad_filter=vad,
    )
    raw_segments = list(segments)
    detected_language = getattr(info, "language", "ja") or "ja"
    if detected_language != "ja":
        raise ValueError(f"Japanese transcription required, detected: {detected_language}")
    emit("progress", progress=78)
    emit("log", message="Preparing Japanese phrase readings for SOFA...")
    transcript = runner.build_transcript(raw_segments, detected_language)
    output_path = output_dir / f"{output_name}.whisper.json"
    output_path.write_text(json.dumps(transcript, ensure_ascii=False, indent=2), encoding="utf-8")
    emit("progress", progress=95)
    emit("transcript", transcript=transcript, transcriptFile=str(output_path))
    emit("stage_done", stage="whisper", transcriptFile=str(output_path))
    emit("transcribe_done", transcriptFile=str(output_path))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--compute-type", default="float16")
    args = parser.parse_args()
    runner = load_runner()
    from faster_whisper import WhisperModel
    import torch

    model_name = os.environ.get("AISVC_WHISPER_MODEL", "Systran/faster-whisper-large-v3")
    emit("log", message="Loading faster-whisper large-v3...")
    emit("progress", progress=8)
    model = WhisperModel(model_name, device=args.device, compute_type=args.compute_type)
    emit("runtime_ready", modelId="Whisper large-v3", residentMiB=round(torch.cuda.memory_reserved() / 1024 / 1024, 1))
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
                emit("pong", modelId="Whisper large-v3")
            elif request_type == "transcribe":
                transcribe(runner, model, request)
            elif request_type == "shutdown":
                emit("shutdown_ok")
                return
            else:
                raise ValueError(f"unsupported worker request: {request_type}")
        except Exception as error:
            emit("error", message=str(error))
            if request_type == "transcribe":
                emit("infer_failed")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit("error", message=str(error))
        raise

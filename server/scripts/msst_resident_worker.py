#!/usr/bin/env python3
"""Resident MSST worker that keeps one separator model loaded between jobs."""

import argparse
import gc
import importlib.util
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path


RUNNER = Path(__file__).with_name("msst_runner.py")
MSST_ROOT = Path(r"E:\MyProject\cyanAI\nodeServer\src\utility\MSST\msst_webui")


def emit(event_type, **payload):
    print(json.dumps({"type": event_type, **payload}, ensure_ascii=False), flush=True)


def load_runner():
    spec = importlib.util.spec_from_file_location("msst_runner", RUNNER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import MSST runner: {RUNNER}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def separate(runner, separator, model_id, runtime_output, request):
    input_wav = Path(str(request["input"])).resolve()
    output_dir = Path(str(request["outputDir"])).resolve()
    if not input_wav.is_file():
        raise FileNotFoundError(input_wav)
    output_dir.mkdir(parents=True, exist_ok=True)
    saved = {}
    with tempfile.TemporaryDirectory(prefix="aisvc_msst_resident_in_") as temp_root:
        stage_input = Path(temp_root)
        local_input = stage_input / "input.wav"
        shutil.copy2(input_wav, local_input)
        emit("progress", progress=0, stage="resident")
        separator.process_folder(str(stage_input))
        for instrument, result_id in runner.MODELS[model_id]["outputs"].items():
            source = runner.find_output(Path(runtime_output), local_input.stem, instrument)
            destination = output_dir / f"{result_id}.wav"
            shutil.copy2(source, destination)
            saved[result_id] = str(destination)
        for stale in Path(runtime_output).glob("*.wav"):
            stale.unlink()
        emit("progress", progress=100, stage="complete")
        emit("result", outputs=saved)
        emit("separate_done", outputs=saved)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", choices=["duality", "dereverb", "denoise"], required=True)
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cuda")
    args = parser.parse_args()
    runner = load_runner()
    sys.path.insert(0, str(MSST_ROOT))
    os.chdir(MSST_ROOT)
    from inference.msst_infer import MSSeparator

    step = runner.MODELS[args.model]
    runtime_output = Path(tempfile.mkdtemp(prefix="aisvc_msst_resident_out_")) / "output"
    runtime_output.mkdir()
    separator = MSSeparator(
        model_type="mel_band_roformer",
        config_path=str(MSST_ROOT / step["config"]),
        model_path=str(MSST_ROOT / step["model"]),
        device=args.device,
        device_ids=[0],
        output_format="wav",
        use_tta=False,
        store_dirs=str(runtime_output),
    )
    separator.model_id = args.model
    try:
        import torch
        resident_mib = round(torch.cuda.memory_reserved() / 1024 / 1024, 1)
    except Exception:
        resident_mib = None
    emit("runtime_ready", modelId=f"MSST_{args.model}", residentMiB=resident_mib)
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
                emit("pong", modelId=f"MSST_{args.model}")
            elif request_type == "separate":
                separate(runner, separator, args.model, runtime_output, request)
            elif request_type == "shutdown":
                emit("shutdown_ok")
                return
            else:
                raise ValueError(f"unsupported worker request: {request_type}")
        except Exception as error:
            emit("error", message=str(error))
            if request_type == "separate":
                emit("infer_failed")
    separator.del_cache()
    del separator
    gc.collect()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit("error", message=str(error))
        raise

#!/usr/bin/env python3
"""Profile GPU memory around a real model runner invocation.

This wrapper deliberately measures the process from the outside. Torch's
allocated/reserved counters do not include every CUDA allocation or context.
The runner command is supplied by the caller so each model family can keep its
own verified environment and input contract.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import shutil
import subprocess
import time
from pathlib import Path


def nvidia_memory(device: str) -> dict[str, int] | None:
    if not shutil.which("nvidia-smi"):
        return None
    index = device.split(":", 1)[1] if device.startswith("cuda:") else device
    result = subprocess.run(
        ["nvidia-smi", "-i", index, "--query-gpu=memory.total,memory.used,memory.free",
         "--format=csv,noheader,nounits"],
        capture_output=True, text=True, check=False,
    )
    if result.returncode != 0 or not result.stdout.strip():
        return None
    row = next(csv.reader([result.stdout.strip()]))
    values = [int(float(value.strip())) for value in row[:3]]
    return {"totalMiB": values[0], "usedMiB": values[1], "freeMiB": values[2]}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-id", required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--sample-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--seconds", default="3,10,30")
    parser.add_argument("--steps", type=int)
    parser.add_argument("--sample-command", nargs=argparse.REMAINDER, required=True,
                        help="Command after --sample-command; use {input} and {seconds} placeholders")
    args = parser.parse_args()
    if not args.input.is_file():
        raise FileNotFoundError(args.input)
    args.sample_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for seconds_text in args.seconds.split(","):
        seconds = float(seconds_text)
        sample = args.sample_dir / f"{args.model_id}_{seconds:g}s.wav"
        # ffmpeg performs the cut without decoding the entire source in Python.
        cut = subprocess.run([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-t", str(seconds),
            "-i", str(args.input), "-ar", "44100", "-ac", "1", str(sample),
        ], check=False)
        if cut.returncode != 0 or not sample.exists():
            raise RuntimeError(f"cannot create sample: {sample}")
        sample_sha256 = hashlib.sha256(sample.read_bytes()).hexdigest()
        before = nvidia_memory(args.device)
        command = [part.replace("{input}", str(sample)).replace("{seconds}", str(seconds))
                   .replace("{sha256}", sample_sha256)
                   .replace("{frames}", str(int(44100 * seconds / 2048)))
                   for part in args.sample_command]
        if os.name == "nt" and not os.path.isfile(command[0]):
            wrapper = shutil.which(command[0] + ".cmd") or shutil.which(command[0] + ".exe")
            if wrapper:
                command[0] = wrapper
        started = time.time()
        process = subprocess.Popen(command, env={**os.environ, "PYTHONUNBUFFERED": "1"})
        peak = before
        while process.poll() is None:
            time.sleep(0.5)
            current = nvidia_memory(args.device)
            if current and (not peak or current["usedMiB"] > peak["usedMiB"]):
                peak = current
        after = nvidia_memory(args.device)
        rows.append({
            "seconds": seconds,
            "sample": str(sample.resolve()),
            "exitCode": process.returncode,
            "elapsedSeconds": round(time.time() - started, 3),
            "before": before,
            "peak": peak,
            "after": after,
        })
        if process.returncode != 0:
            raise RuntimeError(f"runner failed for {seconds:g}s with code {process.returncode}")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({
        "schema": "aisvc.gpu-vram-profile.v1",
        "modelId": args.model_id,
        "device": args.device,
        "steps": args.steps,
        "source": str(args.input.resolve()),
        "measuredAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "samples": rows,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Resident V5-P worker that keeps the DiT and VAE loaded between jobs."""

import argparse
import importlib.util
import json
import os
import sys
from pathlib import Path


RUNNER = Path(__file__).with_name("v5p_direct_runner.py")


def load_runner():
    spec = importlib.util.spec_from_file_location("v5p_direct_runner", RUNNER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import V5-P runner: {RUNNER}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def emit(event_type, **payload):
    print(json.dumps({"type": event_type, **payload}, ensure_ascii=False), flush=True)


def load_runtime(runner, preset):
    resources = runner.require_record(preset["resources"], "V5-P runtime resources")
    direct_adapter = runner.require_resource(resources, "directControlAdapter")
    direct_control = runner.load_direct_control(direct_adapter)
    resource_paths = {
        "checkpoint": runner.require_resource(resources, "checkpoint"),
        "modelConfig": runner.require_resource(resources, "modelConfig"),
        "vaeConfig": runner.require_resource(resources, "vaeConfig"),
        "vaeCheckpoint": runner.require_resource(resources, "vaeCheckpoint"),
        "placement": runner.require_resource(resources, "placement"),
        "midiPModule": runner.require_resource(resources, "midiPModule"),
        "runner": runner.require_resource(resources, "runner"),
    }
    singer_root = runner.require_resource(resources, "singerRoot", directory=True)
    if str(singer_root) not in sys.path:
        sys.path.insert(0, str(singer_root))
    os.chdir(singer_root)
    preset_identity = runner.require_record(preset.get("preset"), "V5-P preset identity")
    policy, vae = runner.build_model(
        checkpoint=resource_paths["checkpoint"],
        model_config=resource_paths["modelConfig"],
        vae_config=resource_paths["vaeConfig"],
        vae_checkpoint=resource_paths["vaeCheckpoint"],
        singer_root=singer_root,
        preset=preset_identity,
        resources=resources,
        device=str(preset.get("device") or "cuda:0"),
    )
    resource_hashes = {
        name: item["sha256"]
        for name, item in resources.items()
        if isinstance(item, dict) and "sha256" in item
    }
    resident_mib = None
    try:
        import torch
        resident_mib = round(torch.cuda.memory_reserved() / 1024 / 1024, 1)
    except Exception:
        pass
    return {
        "policy": policy,
        "vae": vae,
        "directControl": direct_control,
        "directControlPath": str(direct_adapter),
        "resourceHashes": resource_hashes,
        "presetId": str(preset_identity.get("id") or ""),
        "device": str(preset.get("device") or "cuda:0"),
        "residentMiB": resident_mib,
    }


def infer_job(runner, runtime, request):
    job_path = Path(str(request["jobFile"])).resolve()
    expected_sha = runner.require_hash(str(request["expectedJobSha256"]), "job manifest SHA-256")
    actual_sha = runner.sha256_file(job_path)
    if actual_sha != expected_sha:
        raise ValueError(f"job manifest SHA-256 mismatch: {actual_sha} != {expected_sha}")
    job = runner.require_record(json.loads(job_path.read_text(encoding="utf-8")), "job manifest")
    resources = runner.require_record(job.get("resources"), "job resources")
    direct_adapter = runner.require_resource(resources, "directControlAdapter")
    if str(direct_adapter) != runtime["directControlPath"]:
        direct_control = runner.load_direct_control(direct_adapter)
    else:
        direct_control = runtime["directControl"]
    validated = runner.validate_job(job, direct_control)
    resource_hashes = {
        name: item["sha256"]
        for name, item in resources.items()
        if isinstance(item, dict) and "sha256" in item
    }
    if resource_hashes != runtime["resourceHashes"]:
        raise ValueError("job requires a different V5-P runtime identity; unload the resident model first")
    if str(job.get("preset", {}).get("id", "")) != runtime["presetId"]:
        raise ValueError("job preset does not match the resident V5-P runtime")

    emit(
        "validated_job",
        jobId=validated["jobId"],
        snapshotSHA256=validated["snapshotSHA256"],
        totalFrames=validated["frameMap"]["totalFrameCount"],
    )
    reference_audio, _ = runner.load_audio(
        validated["referenceWav"], validated["referenceGuide"], "reference"
    )
    target_audio, _ = runner.load_audio(
        validated["targetWav"], validated["targetGuide"], "target"
    )
    started_at = __import__("time").time()
    audio, audit = runner.synthesize(
        runtime["policy"], runtime["vae"], reference_audio, target_audio, validated
    )
    result, result_path = runner.save_result(
        Path(str(request["outputDir"])).resolve(),
        job,
        validated,
        audio,
        audit,
        resource_hashes,
        started_at,
    )
    emit(
        "complete",
        resultFile=str(result_path),
        outputWav=result["outputWav"],
        outputSHA256=result["outputSHA256"],
        sampleCount=result["sampleCount"],
    )
    return result_path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preset-file", type=Path, required=True)
    args = parser.parse_args()
    runner = load_runner()
    preset = json.loads(args.preset_file.read_text(encoding="utf-8"))
    runtime = load_runtime(runner, preset)
    emit(
        "runtime_ready",
        presetId=runtime["presetId"],
        device=runtime["device"],
        residentMiB=runtime["residentMiB"],
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
                emit("pong", presetId=runtime["presetId"])
            elif request_type == "infer":
                result_path = infer_job(runner, runtime, request)
                emit("infer_done", resultFile=str(result_path))
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

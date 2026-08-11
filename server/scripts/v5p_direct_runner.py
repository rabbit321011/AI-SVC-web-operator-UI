#!/usr/bin/env python3
"""Run one hash-locked V5-P job from editor-authored H and MIDI-P controls."""

import argparse
import gc
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import time


JOB_SCHEMA = "aisvc.v5p-direct-job.v1"
RESULT_SCHEMA = "aisvc.v5p-direct-result.v1"
CHECKPOINT_SCHEMA = "v5p_training_checkpoint_v1"
SAMPLE_RATE = 44100
HOP_SAMPLES = 2048
REST_CLASS_ID = 255
PAD_CLASS_ID = 256
SEP_TOKEN_ID = 365
PUL_TOKEN_ID = 366


def emit(event_type, **payload):
    print(json.dumps({"type": event_type, **payload}, ensure_ascii=False), flush=True)


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_text(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def tensor_sha256(value):
    return hashlib.sha256(
        value.detach().cpu().contiguous().numpy().tobytes()
    ).hexdigest()


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def load_direct_control(path):
    spec = importlib.util.spec_from_file_location("v5p_direct_control", path)
    if spec is None or spec.loader is None:
        raise ValueError(f"cannot import direct-control adapter: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def scalar(value):
    if hasattr(value, "numel") and value.numel() == 1:
        return value.item()
    return value


def require_record(value, label):
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def require_integer(value, label, minimum=0, maximum=None):
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{label} must be an integer")
    if value < minimum or (maximum is not None and value > maximum):
        raise ValueError(f"{label} is outside its contract")
    return value


def require_hash(value, label):
    if not isinstance(value, str) or len(value) != 64:
        raise ValueError(f"{label} must be a SHA-256 digest")
    try:
        int(value, 16)
    except ValueError as error:
        raise ValueError(f"{label} must be a SHA-256 digest") from error
    return value.lower()


def require_resource(resources, name, directory=False):
    resource = require_record(resources.get(name), f"resource {name}")
    path = Path(str(resource.get("path", ""))).resolve()
    if directory:
        if not path.is_dir():
            raise FileNotFoundError(f"missing resource directory {name}: {path}")
        return path
    if not path.is_file():
        raise FileNotFoundError(f"missing resource {name}: {path}")
    expected = require_hash(resource.get("sha256"), f"resource {name} SHA-256")
    actual = sha256_file(path)
    if actual != expected:
        raise ValueError(f"resource {name} SHA-256 mismatch: {actual} != {expected}")
    return path


def terminal_placement_mode(text):
    dense = text["denseHTokens"]
    try:
        terminal_sep = len(dense) - 1 - dense[::-1].index(SEP_TOKEN_ID)
    except ValueError as error:
        raise ValueError("dense H lacks a terminal SEP") from error
    matches = []
    for raw in text.get("placementRanges") or []:
        start = int(raw["startFrame"])
        end = int(raw["endFrameExclusive"])
        if start <= terminal_sep < end:
            matches.append(str(raw["placementMode"]))
    if len(matches) > 1:
        raise ValueError("terminal SEP has duplicate placement provenance")
    return matches[0] if matches else "user"


def validate_job(job, direct_control):
    if job.get("schema") != JOB_SCHEMA:
        raise ValueError(f"unsupported V5-P direct job schema: {job.get('schema')}")
    job_id = str(job.get("jobId", ""))
    if not job_id or len(job_id) > 64:
        raise ValueError("invalid V5-P job ID")
    snapshot_canonical = job.get("snapshotCanonical")
    if not isinstance(snapshot_canonical, str):
        raise ValueError("job lacks canonical material snapshot")
    snapshot_sha = require_hash(job.get("snapshotSHA256"), "snapshot SHA-256")
    if sha256_text(snapshot_canonical) != snapshot_sha:
        raise ValueError("canonical material snapshot SHA-256 mismatch")
    snapshot = require_record(json.loads(snapshot_canonical), "material snapshot")
    if snapshot.get("schema") != "aisvc.v5p-material-snapshot.v1":
        raise ValueError("unsupported material snapshot schema")

    reference = require_record(snapshot.get("reference"), "reference snapshot")
    target = require_record(snapshot.get("target"), "target snapshot")
    reference_guide = require_record(reference.get("guide"), "reference Guide")
    target_guide = require_record(target.get("guide"), "target Guide")
    reference_text = require_record(reference.get("text"), "reference text")
    target_text = require_record(target.get("text"), "target text")
    target_midi = require_record(target.get("midiP"), "target MIDI-P")
    reference_samples = require_integer(
        reference_guide.get("sampleCount"), "reference sample count", 1
    )
    target_samples = require_integer(
        target_guide.get("sampleCount"), "target sample count", 1
    )
    frame_map = direct_control.build_frame_map(reference_samples, target_samples)
    if canonical_json(snapshot.get("frameMap")) != canonical_json(frame_map):
        raise ValueError("runner AB frame map differs from material snapshot")

    reference_tokens = reference_text.get("denseHTokens")
    target_tokens = target_text.get("denseHTokens")
    if not isinstance(reference_tokens, list) or not isinstance(target_tokens, list):
        raise ValueError("material snapshot lacks dense H controls")
    h_transport = direct_control.build_h_transport(
        frame_map,
        reference_tokens,
        target_tokens,
        reference_terminal_mode=terminal_placement_mode(reference_text),
        target_terminal_mode=terminal_placement_mode(target_text),
    )
    if canonical_json(snapshot.get("hTransport")) != canonical_json(h_transport):
        raise ValueError("runner joint H differs from material snapshot")

    classes = target_midi.get("classes")
    if not isinstance(classes, list):
        raise ValueError("material snapshot lacks MIDI-P classes")
    midi_transport = direct_control.build_midi_class_transport(frame_map, classes)
    if canonical_json(snapshot.get("midiPTransport")) != canonical_json(midi_transport):
        raise ValueError("runner MIDI-P transport differs from material snapshot")

    inputs = require_record(job.get("inputs"), "job inputs")
    reference_wav = Path(str(inputs.get("referenceWav", ""))).resolve()
    target_wav = Path(str(inputs.get("targetWav", ""))).resolve()
    render = require_record(job.get("render"), "render settings")
    steps = require_integer(render.get("steps"), "sampling steps", 1, 256)
    seed = require_integer(render.get("seed"), "sampling seed", 0, 0xFFFFFFFF)
    cfg = render.get("cfg")
    if isinstance(cfg, bool) or not isinstance(cfg, (int, float)) or not 0 <= cfg <= 10:
        raise ValueError("CFG is outside its contract")
    device = str(render.get("device", ""))
    if device != "cpu" and not device.startswith("cuda:"):
        raise ValueError("invalid sampling device")
    return {
        "jobId": job_id,
        "snapshot": snapshot,
        "snapshotSHA256": snapshot_sha,
        "frameMap": frame_map,
        "hTransport": h_transport,
        "midiTransport": midi_transport,
        "referenceGuide": reference_guide,
        "targetGuide": target_guide,
        "referenceWav": reference_wav,
        "targetWav": target_wav,
        "steps": steps,
        "cfg": float(cfg),
        "seed": seed,
        "device": device,
    }


def load_audio(path, guide, label):
    import soundfile as sf
    import torch

    if not path.is_file():
        raise FileNotFoundError(f"missing {label} Guide WAV: {path}")
    expected_sha = require_hash(guide.get("audioSHA256"), f"{label} Guide SHA-256")
    actual_sha = sha256_file(path)
    if actual_sha != expected_sha:
        raise ValueError(f"{label} Guide SHA-256 mismatch: {actual_sha} != {expected_sha}")
    audio, sample_rate = sf.read(str(path), dtype="float32", always_2d=True)
    if int(sample_rate) != SAMPLE_RATE:
        raise ValueError(f"{label} Guide must be 44100 Hz")
    if int(audio.shape[0]) != int(guide["sampleCount"]):
        raise ValueError(f"{label} Guide sample count differs from snapshot")
    frame_count = int(audio.shape[0]) // HOP_SAMPLES
    if frame_count != int(guide["frameCount"]):
        raise ValueError(f"{label} Guide frame count differs from snapshot")
    return torch.from_numpy(audio.T.copy()), actual_sha


def pad_audio_for_frame_map(reference, target, frame_map):
    import torch

    reference_padding = int(frame_map["reference"]["paddingSampleCount"])
    target_padding = int(frame_map["target"]["paddingSampleCount"])
    reference_padded = torch.cat(
        [reference, torch.zeros(reference.shape[0], reference_padding, dtype=reference.dtype)],
        dim=1,
    )
    target_padded = torch.cat(
        [target, torch.zeros(target.shape[0], target_padding, dtype=target.dtype)],
        dim=1,
    )
    if reference_padded.shape[1] != int(frame_map["reference"]["paddedSampleCount"]):
        raise AssertionError("reference padding differs from AB frame map")
    if target_padded.shape[1] != int(frame_map["target"]["paddedSampleCount"]):
        raise AssertionError("target padding differs from AB frame map")
    return reference_padded, target_padded


def strict_checkpoint_metadata(payload, preset, resources):
    if payload.get("checkpoint_schema") != CHECKPOINT_SCHEMA:
        raise ValueError("checkpoint is not a V5-P training checkpoint")
    if int(scalar(payload.get("global_step", -1))) != int(preset["checkpointStep"]):
        raise ValueError("V5-P checkpoint step differs from preset")
    if payload.get("run_state") != "complete":
        raise ValueError("V5-P checkpoint is not complete")
    if int(scalar(payload.get("ema_step", -1))) != int(preset["checkpointStep"]):
        raise ValueError("V5-P EMA step differs from checkpoint step")
    if not bool(scalar(payload.get("ema_initted", False))):
        raise ValueError("V5-P EMA is not initialized")

    metadata = require_record(payload.get("v5p_training"), "V5-P training metadata")
    expected_values = {
        "schema": CHECKPOINT_SCHEMA,
        "placement_mode": "phone_pul",
        "phase": "joint",
        "midi_teacher": "GAME medium K4 offline cache",
        "midi_fuzz_disturb": False,
        "schedule_profile": "v5p_two_cosine",
        "warmup_steps": 2000,
        "first_decay_end": 28000,
        "mid_lr": 1e-5,
        "max_steps": 40000,
        "pool_policy": "KEEP_LONG_DEDUP_SHORT",
        "sampling_policy": "NATURAL_RECORD",
        "engineering_joint_probe": False,
        "ema_device": "cpu",
    }
    for key, expected in expected_values.items():
        if metadata.get(key) != expected:
            raise ValueError(f"checkpoint metadata mismatch for {key}")
    h_pul = require_record(metadata.get("h_pul"), "V5-P H/PUL metadata")
    expected_h_pul = {
        "pul_token_id": PUL_TOKEN_ID,
        "sep_token_id": SEP_TOKEN_ID,
        "sep_policy": "next_runtime_control_anchor_minus_one",
        "final_sep_policy": "last_dense_text_frame",
        "pul_policy": "repeat_after_packed_lyrics_until_sep",
        "hard_fallback_policy": "whole_sample_exact_control",
    }
    for key, expected in expected_h_pul.items():
        if h_pul.get(key) != expected:
            raise ValueError(f"checkpoint H/PUL contract mismatch for {key}")
    declared_hashes = require_record(metadata.get("file_sha256"), "checkpoint file hashes")
    declared_contract = {
        "training_code": preset["trainingCodeSHA256"],
        "placement_code": resources["placement"]["sha256"],
        "model_config": resources["modelConfig"]["sha256"],
        "vae_config": resources["vaeConfig"]["sha256"],
        "vae_checkpoint": resources["vaeCheckpoint"]["sha256"],
    }
    for key, expected in declared_contract.items():
        if declared_hashes.get(key) != expected:
            raise ValueError(f"checkpoint-declared SHA-256 mismatch for {key}")
    midi_schema = require_record(payload.get("midi_p_schema"), "MIDI-P schema")
    expected_midi = {
        "pitch_scale": 2,
        "pitch_class_count": 255,
        "rest_id": REST_CLASS_ID,
        "pad_id": PAD_CLASS_ID,
        "num_embeddings": 257,
        "embedding_dim": 128,
        "fuzz_disturb": False,
    }
    for key, expected in expected_midi.items():
        if midi_schema.get(key) != expected:
            raise ValueError(f"checkpoint MIDI-P schema mismatch for {key}")


def build_model(checkpoint, model_config, vae_config, vae_checkpoint, singer_root,
                preset, resources, device):
    import torch

    if not hasattr(torch, "load_orig"):
        torch.load_orig = torch.load

        def load_compat(*args, **kwargs):
            kwargs.setdefault("weights_only", False)
            return torch.load_orig(*args, **kwargs)

        torch.load = load_compat
    from omegaconf import OmegaConf
    from src.YingMusicSinger.melody.midi_p_v4ph import V4PHMIDIEmbedding
    from src.YingMusicSinger.models.dit import DiT
    from src.YingMusicSinger.models.model import Singer
    from src.YingMusicSinger.utils.stable_audio_tools.vae_copysyn import StableAudioInfer

    emit("loading_checkpoint", path=str(checkpoint))
    payload = torch.load(checkpoint, map_location="cpu", weights_only=False, mmap=True)
    strict_checkpoint_metadata(payload, preset, resources)
    cfg = OmegaConf.load(model_config)
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
    state_key = str(preset["weightSource"])
    state = payload.get(state_key)
    if not isinstance(state, dict):
        raise ValueError(f"checkpoint lacks {state_key}")
    clean_state = {
        key.replace("module.", "").replace("ema_model.", ""): value
        for key, value in state.items()
        if key not in {"initted", "step"}
    }
    policy.load_state_dict(clean_state, strict=True)
    del payload, state, clean_state
    gc.collect()
    policy = policy.to(device).eval()
    policy.smoothMelody_MIDIFuzzDisturb = torch.nn.Identity()
    weight = policy.midi_p_v4ph.embedding.weight.detach()
    if tuple(weight.shape) != (257, 128):
        raise ValueError("V5-P P embedding shape is not [257,128]")
    if not torch.equal(weight[PAD_CLASS_ID], torch.zeros_like(weight[PAD_CLASS_ID])):
        raise ValueError("V5-P P embedding PAD row is not zero")
    emit("loaded_checkpoint", device=device, pEmbeddingShape=list(weight.shape))

    emit("loading_vae", path=str(vae_checkpoint))
    vae = StableAudioInfer(
        model_config_path=str(vae_config),
        model_ckpt_path=str(vae_checkpoint),
    ).to(device).eval()
    emit("loaded_vae", device=device)
    return policy, vae


def build_control_tensors(policy, h_transport, midi_transport, device):
    import torch

    text = torch.tensor(h_transport["tokens"], dtype=torch.int64, device=device).unsqueeze(0)
    class_ids = torch.tensor(
        midi_transport["classIds"], dtype=torch.int64, device=device
    ).unsqueeze(0)
    if (class_ids == PAD_CLASS_ID).any():
        raise ValueError("effective V5-P MIDI-P transport contains PAD")
    with torch.inference_mode():
        embedded = policy.midi_p_v4ph(class_ids)
    clear_start = int(midi_transport["clearEmbeddingStartFrame"])
    clear_end = int(midi_transport["clearEmbeddingEndFrameExclusive"])
    nonzero_before = int(
        torch.count_nonzero(embedded[:, clear_start:clear_end]).item()
    )
    midi = torch.cat(
        [
            embedded[:, :clear_start],
            torch.zeros_like(embedded[:, clear_start:clear_end]),
            embedded[:, clear_end:],
        ],
        dim=1,
    )
    if int(torch.count_nonzero(midi[:, clear_start:clear_end]).item()) != 0:
        raise AssertionError("V5-P reference MIDI embedding clear failed")
    target_start = int(midi_transport["targetStartFrame"])
    target_end = int(midi_transport["targetEndFrameExclusive"])
    expected_target = policy.midi_p_v4ph.embedding.weight[class_ids[0, target_start:target_end]]
    if not torch.equal(midi[0, target_start:target_end], expected_target):
        raise AssertionError("V5-P target MIDI embedding changed during transport")
    if not torch.equal(policy.smoothMelody_MIDIFuzzDisturb(midi), midi):
        raise AssertionError("V5-P MIDI fuzz path changed direct controls")
    return text, midi, {
        "textSHA256": tensor_sha256(text),
        "midiClassSHA256": tensor_sha256(class_ids),
        "midiEmbeddingSHA256": tensor_sha256(midi),
        "referenceEmbeddingNonzeroBeforeClear": nonzero_before,
        "referenceEmbeddingNonzeroAfterClear": 0,
    }


def synthesize(policy, vae, reference_audio, target_audio, validated):
    import torch

    device = validated["device"]
    frame_map = validated["frameMap"]
    reference_padded, target_padded = pad_audio_for_frame_map(
        reference_audio, target_audio, frame_map
    )
    emit("encoding_reference")
    with torch.inference_mode():
        reference_latent = vae.encode_audio(
            reference_padded, in_sr=SAMPLE_RATE
        ).transpose(1, 2)
        target_latent = vae.encode_audio(
            target_padded, in_sr=SAMPLE_RATE
        ).transpose(1, 2)
    reference_frames = int(reference_latent.shape[1])
    target_frames = int(target_latent.shape[1])
    expected_reference = int(frame_map["reference"]["paddedFrameCount"])
    expected_target = int(frame_map["target"]["paddedFrameCount"])
    if reference_frames != expected_reference:
        raise ValueError(
            f"official VAE reference frame count mismatch: {reference_frames} != {expected_reference}"
        )
    if target_frames != expected_target:
        raise ValueError(
            f"official VAE target frame count mismatch: {target_frames} != {expected_target}"
        )
    total_frames = reference_frames + target_frames
    if total_frames != int(frame_map["totalFrameCount"]):
        raise ValueError("official VAE total frame count differs from AB frame map")
    del target_latent, reference_padded, target_padded
    torch.cuda.empty_cache() if str(device).startswith("cuda:") else None

    text, midi, control_audit = build_control_tensors(
        policy, validated["hTransport"], validated["midiTransport"], device
    )
    bound_transport = torch.zeros(
        1, total_frames, 1, device=device, dtype=midi.dtype
    )
    emit(
        "sampling",
        steps=validated["steps"],
        cfg=validated["cfg"],
        seed=validated["seed"],
        totalFrames=total_frames,
    )
    torch.manual_seed(validated["seed"])
    if str(device).startswith("cuda:"):
        torch.cuda.manual_seed_all(validated["seed"])
    with torch.inference_mode():
        generated, _ = policy.sample(
            cond=reference_latent.to(device),
            text=text,
            duration=total_frames,
            midi_p=midi,
            bound_p=bound_transport,
            steps=validated["steps"],
            cfg_strength=validated["cfg"],
            guidance_scale=validated["cfg"],
            t_shift=0.5,
            seed=validated["seed"],
            use_epss=False,
            enable_melody_control=True,
        )
    crop = frame_map["crop"]
    start = int(crop["startFrame"])
    end = int(crop["endFrameExclusive"])
    target_generated = generated[:, start:end, :].permute(0, 2, 1).float()
    emit("decoding", cropStartFrame=start, cropEndFrameExclusive=end)
    with torch.inference_mode():
        decoded = vae.decode_audio(target_generated).squeeze(0)[:1].reshape(-1).cpu()
    final_samples = int(crop["finalSampleCount"])
    if decoded.numel() < final_samples:
        raise ValueError("official VAE decoded fewer samples than the effective target range")
    decoded = decoded[:final_samples].contiguous()
    return decoded, {
        **control_audit,
        "referenceLatentShape": list(reference_latent.shape),
        "generatedLatentShape": list(generated.shape),
        "decodedSamplesBeforeTrim": int(end - start) * HOP_SAMPLES,
        "finalSampleCount": final_samples,
    }


def save_result(output_dir, job, validated, audio, audit, resource_hashes, started_at):
    import soundfile as sf

    output_dir.mkdir(parents=True, exist_ok=True)
    wav_path = output_dir / "take.wav"
    audit_path = output_dir / "audit.json"
    result_path = output_dir / "result.json"
    sf.write(
        str(wav_path), audio.numpy().reshape(-1, 1), SAMPLE_RATE, subtype="PCM_16"
    )
    output_sha = sha256_file(wav_path)
    completed_at = time.time()
    full_audit = {
        "schema": "aisvc.v5p-direct-audit.v1",
        "jobId": validated["jobId"],
        "snapshotSHA256": validated["snapshotSHA256"],
        "frameMap": validated["frameMap"],
        "jointH": {
            key: value
            for key, value in validated["hTransport"].items()
            if key != "tokens"
        },
        "midiTransport": {
            key: value
            for key, value in validated["midiTransport"].items()
            if key != "classIds"
        },
        "render": job["render"],
        "resources": resource_hashes,
        "tensor": audit,
        "elapsedSeconds": completed_at - started_at,
    }
    audit_path.write_text(
        json.dumps(full_audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    result = {
        "schema": RESULT_SCHEMA,
        "jobId": validated["jobId"],
        "snapshotSHA256": validated["snapshotSHA256"],
        "outputWav": str(wav_path.resolve()),
        "outputSHA256": output_sha,
        "sampleRate": SAMPLE_RATE,
        "sampleCount": int(audio.numel()),
        "duration": int(audio.numel()) / SAMPLE_RATE,
        "auditFile": str(audit_path.resolve()),
        "presetId": job["preset"]["id"],
        "checkpointSHA256": resource_hashes["checkpoint"],
        "vaeSHA256": resource_hashes["vaeCheckpoint"],
        "adapterSHA256": resource_hashes["directControlAdapter"],
        "seed": validated["seed"],
    }
    result_path.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return result, result_path


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--job", type=Path, required=True)
    parser.add_argument("--expected-job-sha256", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--validate-only", action="store_true")
    return parser.parse_args()


def main():
    args = parse_args()
    started_at = time.time()
    job_path = args.job.resolve()
    expected_job_sha = require_hash(args.expected_job_sha256, "job manifest SHA-256")
    actual_job_sha = sha256_file(job_path)
    if actual_job_sha != expected_job_sha:
        raise ValueError(f"job manifest SHA-256 mismatch: {actual_job_sha} != {expected_job_sha}")
    job = require_record(json.loads(job_path.read_text(encoding="utf-8")), "job manifest")
    resources = require_record(job.get("resources"), "job resources")
    direct_adapter = require_resource(resources, "directControlAdapter")
    direct_control = load_direct_control(direct_adapter)
    validated = validate_job(job, direct_control)

    resource_paths = {
        "checkpoint": require_resource(resources, "checkpoint"),
        "modelConfig": require_resource(resources, "modelConfig"),
        "vaeConfig": require_resource(resources, "vaeConfig"),
        "vaeCheckpoint": require_resource(resources, "vaeCheckpoint"),
        "placement": require_resource(resources, "placement"),
        "midiPModule": require_resource(resources, "midiPModule"),
        "runner": require_resource(resources, "runner"),
    }
    singer_root = require_resource(resources, "singerRoot", directory=True)
    resource_hashes = {
        name: resource["sha256"]
        for name, resource in resources.items()
        if isinstance(resource, dict) and "sha256" in resource
    }
    emit(
        "validated_job",
        jobId=validated["jobId"],
        snapshotSHA256=validated["snapshotSHA256"],
        totalFrames=validated["frameMap"]["totalFrameCount"],
    )
    if args.validate_only:
        return

    if str(singer_root) not in sys.path:
        sys.path.insert(0, str(singer_root))
    os.chdir(singer_root)
    reference_audio, _ = load_audio(
        validated["referenceWav"], validated["referenceGuide"], "reference"
    )
    target_audio, _ = load_audio(
        validated["targetWav"], validated["targetGuide"], "target"
    )
    device = validated["device"]
    import torch

    if device.startswith("cuda:") and not torch.cuda.is_available():
        raise ValueError("CUDA was requested but this Python runtime has no CUDA support")
    preset = require_record(job.get("preset"), "V5-P preset")
    policy, vae = build_model(
        checkpoint=resource_paths["checkpoint"],
        model_config=resource_paths["modelConfig"],
        vae_config=resource_paths["vaeConfig"],
        vae_checkpoint=resource_paths["vaeCheckpoint"],
        singer_root=singer_root,
        preset=preset,
        resources=resources,
        device=device,
    )
    audio, audit = synthesize(
        policy, vae, reference_audio, target_audio, validated
    )
    result, result_path = save_result(
        args.output_dir.resolve(), job, validated, audio, audit, resource_hashes, started_at
    )
    emit(
        "complete",
        resultFile=str(result_path),
        outputWav=result["outputWav"],
        outputSHA256=result["outputSHA256"],
        sampleCount=result["sampleCount"],
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit("error", message=str(error))
        raise

#!/usr/bin/env python3
"""Batch V4IPH inference: no-A full-timeline generation with H placement and GAME MIDI_P."""

import argparse
import gc
import hashlib
import json
import os
from pathlib import Path
import re
import sys


ALIGNMENT_SCHEMA = "aisvc.v4h-eval-alignment.v1"
CHECKPOINT_SCHEMA = "v4iph_training_checkpoint_v1"
VFR = 44100 / 2048
SEP_TOKEN = 365
PUL_TOKEN = 366
GAME_BASE_SEED = 20260730
EXPECTED_PLACEMENT_SHA256 = "96af5a627e8cbd758a2b89fb29091f8c3257d1f994a5dfecec6eb2ec5b336472"
EXPECTED_GAME_COMMIT = "4ad815c90dfe2442730f3fdc866fd23e737cbc97"
EXPECTED_GAME_MODEL_SHA256 = "e9904159fb0646e1a352b9d2bc74615547cfa3e32d45c7464d440ac142846d93"
EXPECTED_RUNTIME_HASHES = {
    "train_v4iph.py": "e386ace7a5f9d7f52f1b2c18ccf95d54d4c65ee831710249425669fa7bbbac73",
    "v4iph_contract.py": "a08bbb49b17dd1186f10963201d26f1bbd3843df8fd20cacc4d63d7baba9b043",
    "game_cache_v4ph.py": "2bd07ff9c9c3748289e4c2a65a4e8fa1b1cbf52fce2fdf689252a85a87ae17bd",
    "game_cka_v4ph.py": "43071b4b4401e202f84e86a729694e4973118b8a4132128f52eacd3e16fb94ba",
    "game_p_v4pf.py": "5cea9223b94897dc0277fbc330e72187795154f9859a0285453fa48fe0e6dce8",
    "game_runtime_v4ph.py": "cb46560b2fd10010b38048b891f8fccb2a12e3acd7a314f186ff8ee43b834bd4",
    "midi_p_v4ph.py": "b33101ac135815bfcd3a3a2ba2233ddee0f5f7321285327871758804119e271f",
}


def emit(event_type, **payload):
    print(json.dumps({"type": event_type, **payload}, ensure_ascii=False), flush=True)


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_bytes(value):
    return hashlib.sha256(value).hexdigest()


def tensor_sha256(value):
    return sha256_bytes(value.detach().cpu().contiguous().numpy().tobytes())


def safe_name(value):
    value = re.sub(r'[<>:"/\\|?*]', "_", str(value)).strip().rstrip(".")
    return value or "unnamed"


def is_valid_wav(path):
    return Path(path).is_file() and Path(path).stat().st_size > 44


def load_audio(path):
    import soundfile as sf
    import torch

    audio, sample_rate = sf.read(str(path), dtype="float32", always_2d=True)
    return torch.from_numpy(audio.T.copy()), int(sample_rate)


def save_audio(path, audio, sample_rate):
    import soundfile as sf

    sf.write(str(path), audio.detach().cpu().numpy().T, int(sample_rate), subtype="PCM_16")


def require_runtime_hashes(runtime, singer_root):
    actual = {}
    for name, expected in EXPECTED_RUNTIME_HASHES.items():
        if name in ("train_v4iph.py", "v4iph_contract.py"):
            archived = runtime / name
            archived_hash = sha256_file(archived)
            if archived_hash != expected:
                raise ValueError(
                    f"V4IPH runtime hash mismatch for {name}: "
                    f"archive={archived_hash} expected={expected}"
                )
        else:
            archived = runtime / f"melody/{name}"
            source = singer_root / f"src/YingMusicSinger/melody/{name}"
            archived_hash = sha256_file(archived)
            source_hash = sha256_file(source)
            if archived_hash != expected or source_hash != expected:
                raise ValueError(
                    f"V4IPH runtime hash mismatch for {name}: "
                    f"archive={archived_hash} source={source_hash} expected={expected}"
                )
        actual[name] = expected
    return actual


def strict_checkpoint_metadata(
    checkpoint,
    runtime,
    vae_ckpt,
    game_cache_manifest,
    game_model,
    midi_p_schema,
    game_cache_schema,
):
    import torch

    payload = torch.load(checkpoint, map_location="cpu", weights_only=False, mmap=True)
    if payload.get("checkpoint_schema") != CHECKPOINT_SCHEMA:
        raise ValueError(f"unexpected checkpoint schema: {payload.get('checkpoint_schema')}")
    if payload.get("run_state") != "complete" or int(payload.get("global_step", -1)) != 30000:
        raise ValueError("V4IPH checkpoint is not the completed 30k final")
    metadata = payload.get("v4iph_training")
    if not isinstance(metadata, dict) or metadata.get("schema") != CHECKPOINT_SCHEMA:
        raise ValueError("V4IPH checkpoint lacks authoritative training metadata")
    expected_values = {
        "placement_mode": "phone_pul",
        "phase": "joint",
        "midi_teacher": "GAME medium K4 offline cache",
        "midi_fuzz_disturb": False,
        "reference_mode": "all_b",
        "reference_policy": "ref_len_exactly_zero_cond_all_zero_full_timeline_is_b",
        "flow_policy": "flow_a_zero_plus_flow_b_weight_times_full_timeline_flow_b",
    }
    for key, expected in expected_values.items():
        if metadata.get(key) != expected:
            raise ValueError(f"V4IPH metadata {key} mismatch: {metadata.get(key)} != {expected}")
    contract = metadata.get("h_pul") or {}
    expected_contract = {
        "pul_token_id": PUL_TOKEN,
        "sep_token_id": SEP_TOKEN,
        "sep_policy": "next_runtime_control_anchor_minus_one",
        "final_sep_policy": "last_dense_text_frame",
        "pul_policy": "repeat_after_packed_lyrics_until_sep",
        "hard_fallback_policy": "whole_sample_exact_control",
    }
    for key, expected in expected_contract.items():
        if contract.get(key) != expected:
            raise ValueError(f"V4IPH H/PUL contract mismatch for {key}")
    if payload.get("midi_p_schema") != midi_p_schema:
        raise ValueError("checkpoint MIDI_P schema differs from inference runtime")
    if payload.get("game_cache_schema") != game_cache_schema:
        raise ValueError("checkpoint GAME cache schema differs from inference runtime")

    expected_hashes = metadata.get("file_sha256") or {}
    actual_paths = {
        "training_code": runtime / "train_v4iph.py",
        "contract_code": runtime / "v4iph_contract.py",
        "placement_code": runtime / "h_alignment/placement_v4iph.py",
        "model_config": runtime / "YingMusic_Singer.yaml",
        "vae_config": runtime / "stable_audio_2_0_vae_20hz_official.json",
        "vae_checkpoint": vae_ckpt,
        "game_cache_manifest": game_cache_manifest,
    }
    for key, path in actual_paths.items():
        actual = sha256_file(path)
        expected = expected_hashes.get(key)
        if actual != expected:
            raise ValueError(f"{key} SHA256 mismatch: {actual} != {expected}: {path}")

    game_manifest = json.loads(Path(game_cache_manifest).read_text(encoding="utf-8"))
    if game_manifest.get("cache_schema") != game_cache_schema:
        raise ValueError("training GAME manifest schema mismatch")
    if game_manifest.get("game_model_sha256") != EXPECTED_GAME_MODEL_SHA256:
        raise ValueError("training GAME manifest model hash mismatch")
    if sha256_file(game_model) != EXPECTED_GAME_MODEL_SHA256:
        raise ValueError("inference GAME model hash mismatch")
    return payload


def build_model(
    checkpoint,
    runtime,
    singer_root,
    vae_ckpt,
    game_cache_manifest,
    game_model,
    device,
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

    checkpoint_payload = strict_checkpoint_metadata(
        checkpoint=checkpoint,
        runtime=runtime,
        vae_ckpt=vae_ckpt,
        game_cache_manifest=game_cache_manifest,
        game_model=game_model,
        midi_p_schema=MIDI_P_V4PH_SCHEMA,
        game_cache_schema=GAME_CACHE_SCHEMA,
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
    state = checkpoint_payload.get("ema_model_state_dict")
    if not isinstance(state, dict):
        raise ValueError("V4IPH checkpoint lacks ema_model_state_dict")
    state = {
        key.replace("module.", "").replace("ema_model.", ""): value
        for key, value in state.items()
        if key not in {"initted", "step"}
    }
    policy.load_state_dict(state, strict=True)
    del checkpoint_payload, state
    gc.collect()
    policy = policy.to(device).eval()
    policy.smoothMelody_MIDIFuzzDisturb = torch.nn.Identity()
    p_weight = policy.midi_p_v4ph.embedding.weight.detach()
    if tuple(p_weight.shape) != (257, 128) or not torch.equal(
        p_weight[256], torch.zeros_like(p_weight[256])
    ):
        raise ValueError("V4IPH P embedding shape/PAD row is invalid")

    vae = StableAudioInfer(
        model_config_path=str(runtime / "stable_audio_2_0_vae_20hz_official.json"),
        model_ckpt_path=str(vae_ckpt),
    ).to(device).eval()
    return policy, vae


def load_game(game_repo, game_deps, game_model, device):
    game_repo = str(Path(game_repo).resolve())
    game_deps = str(Path(game_deps).resolve())
    for path in (game_deps, game_repo):
        if path not in sys.path:
            sys.path.insert(0, path)
    from inference.api import load_inference_model

    game, language_map = load_inference_model(Path(game_model).resolve())
    return game.to(device).eval(), language_map or {}


def b_phrases_and_candidates(alignment):
    """V4IPH has no A region; extract B phrases only, no frame offset needed."""
    record = alignment["B"]
    phrases = record.get("Phrases") or []
    candidates = (record.get("HAlignment") or {}).get("phrase_candidates") or []
    if len(phrases) != len(candidates):
        raise ValueError("B phrase/candidate count mismatch")
    regions = ["B"] * len(phrases)
    return list(phrases), list(candidates), regions


def placement_audit(rendered, regions):
    phrase_audits = []
    for region, audit in zip(regions, rendered["phone_pul"]["phrases"]):
        phrase_audits.append({"region": region, **audit})
    return {
        "schema": "aisvc.v4iph-placement-audit.v1",
        "renderer": "authoritative render_h_pul_placements (placement_v4iph)",
        "placementModuleSHA256": EXPECTED_PLACEMENT_SHA256,
        "phonePhraseCount": rendered["phone_phrase_count"],
        "pulPhraseCount": rendered["pul_phrase_count"],
        "exactControlPhraseCount": rendered["exact_control_phrase_count"],
        "pulFrameCount": rendered["pul_frame_count"],
        "sampleControlAnomaly": rendered["sample_control_anomaly"],
        "sampleStructuralFallback": rendered["sample_structural_fallback"],
        "structuralFallbackReason": rendered["structural_fallback_reason"],
        "lockedEventTokenSHA256": rendered["locked_event_token_sha256"],
        "denseTextSHA256": sha256_bytes(
            json.dumps(rendered["phone_pul"]["text"], separators=(",", ":")).encode("utf-8")
        ),
        "phrases": phrase_audits,
    }


def synthesize(
    policy,
    vae,
    game,
    language_map,
    render_h_pul_placements,
    canonicalize_game_cache,
    game_cache_to_model_tracks,
    extract_game_notes_with_posterior,
    stable_game_seed,
    melody_audio,
    alignment,
    steps,
    cfg_strength,
    seed,
    device,
):
    import torch

    ma, ms = load_audio(melody_audio)
    if ms != 44100:
        raise ValueError("V4IPH evaluation requires 44.1kHz B WAV")
    mw = torch.cat([ma, torch.zeros(ma.shape[0], int(ms * 1.0))], dim=1)
    ml = vae.encode_audio(mw, in_sr=ms).transpose(1, 2)
    ref_frames = 0
    total_frames = int(ml.shape[1])

    game_melody = mw.mean(dim=0)
    game_wave = game_melody.contiguous()
    game_wave_sha = tensor_sha256(game_wave)
    game_seed = stable_game_seed(game_wave_sha, GAME_BASE_SEED)
    language_id = int(language_map.get("ja", 0))
    notes = extract_game_notes_with_posterior(
        model=game,
        waveform=game_wave,
        duration=game_wave.numel() / 44100,
        language_id=language_id,
        nsteps=4,
        seed=game_seed,
        device=torch.device(device),
    )
    arrays = canonicalize_game_cache(notes)
    cache = {name: torch.from_numpy(value.copy()) for name, value in arrays.items()}
    tracks = game_cache_to_model_tracks(
        cache,
        num_samples=game_wave.numel(),
        target_len=total_frames,
        sample_rate=44100,
    )
    p_classes = tracks["p_classes"].long().unsqueeze(0).to(device)
    if tuple(p_classes.shape) != (1, total_frames) or (p_classes == 256).any():
        raise AssertionError("GAME emitted invalid V4IPH model classes")
    with torch.inference_mode():
        midi = policy.midi_p_v4ph(p_classes)
    if tuple(midi.shape) != (1, total_frames, 128):
        raise AssertionError("V4IPH MIDI shape mismatch")
    if not torch.equal(policy.smoothMelody_MIDIFuzzDisturb(midi), midi):
        raise AssertionError("V4IPH precomputed MIDI transport is not tensor-identical")

    phrases, candidates, regions = b_phrases_and_candidates(alignment)
    rendered = render_h_pul_placements(
        phrases,
        candidates,
        ref_len=ref_frames,
        total_frames=total_frames,
        sep_token_id=SEP_TOKEN,
        pul_token_id=PUL_TOKEN,
    )
    dense_text = rendered["phone_pul"]["text"]
    if len(dense_text) != total_frames or max(dense_text, default=0) > PUL_TOKEN:
        raise AssertionError("V4IPH renderer emitted an invalid dense text tensor")
    text_tokens = torch.tensor(dense_text, dtype=torch.int64).unsqueeze(0).to(device)

    # The configured some_pretrain branch only transports an equal-length 128-D
    # tensor. Passing the learned P embedding here does not load or execute SOME.
    bound_transport = torch.zeros(1, total_frames, 1, device=device, dtype=midi.dtype)
    cond = torch.zeros(1, 1, 64, device=device)
    lens = torch.tensor([0], device=device, dtype=torch.long)
    torch.manual_seed(seed)
    with torch.inference_mode():
        gen_latent, _ = policy.sample(
            cond=cond,
            text=text_tokens,
            duration=total_frames,
            lens=lens,
            midi_p=midi,
            bound_p=bound_transport,
            steps=steps,
            cfg_strength=cfg_strength,
            guidance_scale=cfg_strength,
            t_shift=0.5,
            seed=seed,
            use_epss=False,
            enable_melody_control=True,
        )
    rear_frames = int(VFR * 1.0)
    b_latent = gen_latent[:, :-rear_frames, :].permute(0, 2, 1).float()
    wav = vae.decode_audio(b_latent).squeeze(0)[:1].reshape(-1).cpu()

    audit = placement_audit(rendered, regions)
    valid = cache["valid"].bool()
    presence = cache["presence"].bool()
    b_classes = p_classes[0].detach().cpu()
    audit.update(
        {
            "refFrames": ref_frames,
            "melodyFrames": int(ml.shape[1]),
            "totalFrames": total_frames,
            "nonPadTextFrames": sum(token != 0 for token in dense_text),
            "game": {
                "schema": "aisvc.v4iph-game-audit.v1",
                "commit": EXPECTED_GAME_COMMIT,
                "modelSHA256": EXPECTED_GAME_MODEL_SHA256,
                "modelScale": "medium",
                "nsteps": 4,
                "baseSeed": GAME_BASE_SEED,
                "effectiveSeed": game_seed,
                "language": "ja",
                "languageId": language_id,
                "waveformSHA256": game_wave_sha,
                "samples": int(game_wave.numel()),
                "melodySourceChannels": int(ma.shape[0]),
                "channelPolicy": "per-region L/R arithmetic mean for GAME only",
                "notes": int(valid.sum()),
                "voicedNotes": int((valid & presence).sum()),
                "restNotes": int((valid & ~presence).sum()),
                "nativeFrames100Hz": int(cache["duration_frames_100hz"][valid].sum()),
                "nativeDurationSeconds": float(cache["durations"][valid].sum()),
                "targetClassMin": int(b_classes.min()),
                "targetClassMax": int(b_classes.max()),
                "targetUniqueClasses": int(torch.unique(b_classes).numel()),
                "targetPadFrames": int((b_classes == 256).sum()),
                "targetRestFrames": int((b_classes == 255).sum()),
                "targetPitchFrames": int((b_classes < 255).sum()),
                "pClassSHA256": tensor_sha256(p_classes),
                "midiEmbeddingSHA256": tensor_sha256(midi),
                "promptMidiNonzero": int(torch.count_nonzero(midi[:, :ref_frames]).item()),
                "sampleTransport": "equal_length_precomputed_embedding_with_fuzz_identity_no_SOME_model",
            },
        }
    )
    return wav, 44100, audit


def parse_args():
    parser = argparse.ArgumentParser(description="Batch V4IPH evaluation runner")
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--alignment-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--runtime", type=Path, required=True)
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


def main():
    args = parse_args()
    dataset = args.dataset.resolve()
    alignment_dir = args.alignment_dir.resolve()
    output_dir = args.output_dir.resolve()
    runtime = args.runtime.resolve()
    singer_root = args.singer_root.resolve()
    checkpoint = args.checkpoint.resolve()
    vae_ckpt = args.vae_ckpt.resolve()
    game_model_path = args.game_model.resolve()
    game_cache_manifest = args.game_cache_manifest.resolve()

    runtime_hashes = require_runtime_hashes(runtime, singer_root)
    placement_path = runtime / "h_alignment/placement_v4iph.py"
    if sha256_file(placement_path) != EXPECTED_PLACEMENT_SHA256:
        raise ValueError("V4IPH placement module SHA256 mismatch")
    sys.path.insert(0, str(runtime))
    sys.path.insert(0, str(singer_root))
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
    import torch

    alignment_manifest = json.loads(
        (alignment_dir / "manifest.json").read_text(encoding="utf-8")
    )
    if alignment_manifest.get("schema") != ALIGNMENT_SCHEMA:
        raise ValueError(f"unsupported alignment schema: {alignment_manifest.get('schema')}")
    if Path(alignment_manifest["sourceDataset"]).resolve() != dataset:
        raise ValueError("alignment source dataset does not match --dataset")
    dataset_manifest = json.loads((dataset / "manifest.json").read_text(encoding="utf-8"))
    dataset_groups = dataset_manifest.get("groups") or []
    alignment_groups = alignment_manifest.get("groups") or []
    if [item["name"] for item in dataset_groups[: len(alignment_groups)]] != [
        item["name"] for item in alignment_groups
    ]:
        raise ValueError("dataset/alignment group order mismatch")
    if args.limit is not None:
        count = min(args.limit, len(alignment_groups))
        dataset_groups = dataset_groups[:count]
        alignment_groups = alignment_groups[:count]
    elif len(dataset_groups) != len(alignment_groups):
        raise ValueError("full evaluation requires alignment for every dataset group")

    output_dir.mkdir(parents=True, exist_ok=True)
    audit_dir = output_dir / "_placement"
    audit_dir.mkdir(exist_ok=True)
    emit("loading_v4iph", checkpoint=str(checkpoint), groups=len(dataset_groups))
    policy, vae = build_model(
        checkpoint=checkpoint,
        runtime=runtime,
        singer_root=singer_root,
        vae_ckpt=vae_ckpt,
        game_cache_manifest=game_cache_manifest,
        game_model=game_model_path,
        device=args.device,
    )
    emit("loaded_v4iph")
    game, language_map = load_game(
        game_repo=args.game_repo,
        game_deps=args.game_deps,
        game_model=game_model_path,
        device=torch.device(args.device),
    )
    emit("loaded_game", languageMap=language_map)

    completed = 0
    skipped = 0
    for index, (group, alignment_entry) in enumerate(
        zip(dataset_groups, alignment_groups), start=1
    ):
        output_path = output_dir / f"{safe_name(group['name'])}.wav"
        audit_path = audit_dir / f"{safe_name(group['name'])}.json"
        if args.resume and is_valid_wav(output_path) and audit_path.is_file():
            skipped += 1
            emit("skipped", index=index, total=len(dataset_groups), group=group["name"])
            continue
        alignment = json.loads(
            (alignment_dir / alignment_entry["alignmentFile"]).read_text(encoding="utf-8")
        )
        group_dir = dataset / group["directory"]
        emit("start", index=index, total=len(dataset_groups), group=group["name"])
        wav, sample_rate, audit = synthesize(
            policy=policy,
            vae=vae,
            game=game,
            language_map=language_map,
            render_h_pul_placements=render_h_pul_placements,
            canonicalize_game_cache=canonicalize_game_cache,
            game_cache_to_model_tracks=game_cache_to_model_tracks,
            extract_game_notes_with_posterior=extract_game_notes_with_posterior,
            stable_game_seed=stable_game_seed,
            melody_audio=group_dir / "B.wav",
            alignment=alignment,
            steps=args.steps,
            cfg_strength=args.cfg,
            seed=args.seed,
            device=args.device,
        )
        save_audio(output_path, wav.unsqueeze(0), sample_rate)
        audit.update(
            {
                "group": group["name"],
                "checkpoint": str(checkpoint),
                "cfg": args.cfg,
                "steps": args.steps,
                "seed": args.seed,
                "runtimeSHA256": runtime_hashes,
            }
        )
        audit_path.write_text(
            json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        completed += 1
        del wav
        torch.cuda.empty_cache()
        emit(
            "done",
            index=index,
            total=len(dataset_groups),
            group=group["name"],
            phone=audit["phonePhraseCount"],
            pul=audit["pulPhraseCount"],
            notes=audit["game"]["notes"],
            rest=audit["game"]["restNotes"],
        )

    del policy, vae, game
    torch.cuda.empty_cache()
    gc.collect()
    emit("complete", completed=completed, skipped=skipped, total=len(dataset_groups))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit("error", message=str(error))
        raise

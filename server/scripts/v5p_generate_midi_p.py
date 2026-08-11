#!/usr/bin/env python3
"""Generate a B-local V5-P MIDI-P layer with the frozen GAME training adapter."""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys


GAME_COMMIT = "4ad815c90dfe2442730f3fdc866fd23e737cbc97"
BASE_SEED = 20260730
SCHEMA = "aisvc.v5p-midi-p.v1"
EXPECTED_HASHES = {
    "game_api": "b2d0a2df7c1ca7510cdee6cee65a8aa9ef9abd59be99aab89695cbcbea82a8a8",
    "game_infer": "faab1adba0f96bc0b82c74ce6958460474ca242963b01ded6284c1a8c29c8784",
    "game_model": "e9904159fb0646e1a352b9d2bc74615547cfa3e32d45c7464d440ac142846d93",
    "game_runtime": "cb46560b2fd10010b38048b891f8fccb2a12e3acd7a314f186ff8ee43b834bd4",
    "game_cache": "2bd07ff9c9c3748289e4c2a65a4e8fa1b1cbf52fce2fdf689252a85a87ae17bd",
    "game_adapter": "5cea9223b94897dc0277fbc330e72187795154f9859a0285453fa48fe0e6dce8",
}


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--guide-sha256", required=True)
    parser.add_argument("--frame-count", type=int, required=True)
    parser.add_argument("--game-repo", type=Path, required=True)
    parser.add_argument("--game-deps", type=Path, required=True)
    parser.add_argument("--game-model", type=Path, required=True)
    parser.add_argument("--singer-repo", type=Path, required=True)
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--language", default="ja")
    return parser.parse_args()


def emit(event_type, **payload):
    print(json.dumps({"type": event_type, **payload}, ensure_ascii=False), flush=True)


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_hash(label, path):
    path = Path(path).resolve()
    if not path.is_file():
        raise FileNotFoundError(f"missing GAME {label}: {path}")
    actual = sha256_file(path)
    if actual != EXPECTED_HASHES[label]:
        raise ValueError(
            f"GAME {label} SHA256 mismatch: {actual} != {EXPECTED_HASHES[label]}"
        )
    return actual


def main():
    args = parse_args()
    if args.frame_count < 1:
        raise ValueError("frame-count must be positive")
    input_path = args.input.resolve()
    game_repo = args.game_repo.resolve()
    game_model = args.game_model.resolve()
    singer_repo = args.singer_repo.resolve()
    if not args.game_deps.resolve().is_dir():
        raise FileNotFoundError(f"missing GAME dependencies: {args.game_deps}")

    source_hash = sha256_file(input_path)
    if source_hash != args.guide_sha256.lower():
        raise ValueError(
            f"Owned Guide SHA256 mismatch: {source_hash} != {args.guide_sha256.lower()}"
        )
    commit = subprocess.check_output(
        ["git", "-C", str(game_repo), "rev-parse", "HEAD"],
        text=True,
    ).strip()
    if commit != GAME_COMMIT:
        raise ValueError(f"GAME commit mismatch: {commit} != {GAME_COMMIT}")

    module_paths = {
        "game_api": game_repo / "inference" / "api.py",
        "game_infer": game_repo / "inference" / "me_infer.py",
        "game_model": game_model,
        "game_runtime": singer_repo / "src" / "YingMusicSinger" / "melody" / "game_runtime_v4ph.py",
        "game_cache": singer_repo / "src" / "YingMusicSinger" / "melody" / "game_cache_v4ph.py",
        "game_adapter": singer_repo / "src" / "YingMusicSinger" / "melody" / "game_p_v4pf.py",
    }
    hashes = {label: require_hash(label, path) for label, path in module_paths.items()}
    for path in (args.game_deps.resolve(), game_repo, singer_repo):
        sys.path.insert(0, str(path))

    import soundfile as sf
    import torch
    from inference.api import load_inference_model
    from src.YingMusicSinger.melody.game_cache_v4ph import (
        GAME_CACHE_SCHEMA,
        canonicalize_game_cache,
        game_cache_to_model_tracks,
    )
    from src.YingMusicSinger.melody.game_runtime_v4ph import (
        extract_game_notes_with_posterior,
        stable_game_seed,
    )

    waveform, sample_rate = sf.read(
        input_path, dtype="float32", always_2d=True
    )
    if sample_rate != GAME_CACHE_SCHEMA["sample_rate"] or waveform.shape[0] < 2048:
        raise ValueError(f"Unexpected Owned Guide audio: {waveform.shape} @ {sample_rate}")
    mono = waveform.mean(axis=1, dtype="float32")
    sample_count = int(mono.size)
    actual_frame_count = sample_count // 2048
    if actual_frame_count != args.frame_count:
        raise ValueError(
            f"Owned Guide frameCount mismatch: {actual_frame_count} != {args.frame_count}"
        )

    device = torch.device(args.device)
    if device.type == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("GAME requested CUDA but CUDA is unavailable")
    emit("loading_model", model=str(game_model))
    model, language_map = load_inference_model(game_model)
    model = model.to(device).eval()
    emit("loaded_model")
    language_id = int((language_map or {}).get(args.language, 0))
    seed = stable_game_seed(source_hash, BASE_SEED)
    emit("extracting", seed=seed, frameCount=args.frame_count)
    notes = extract_game_notes_with_posterior(
        model=model,
        waveform=torch.from_numpy(mono.copy()),
        duration=sample_count / sample_rate,
        language_id=language_id,
        nsteps=GAME_CACHE_SCHEMA["nsteps"],
        seed=seed,
        device=device,
    )
    arrays = canonicalize_game_cache(notes)
    cache = {name: torch.from_numpy(value.copy()) for name, value in arrays.items()}
    tracks = game_cache_to_model_tracks(
        cache,
        num_samples=sample_count,
        target_len=args.frame_count,
        sample_rate=sample_rate,
    )
    classes = [int(value) for value in tracks["p_classes"].tolist()]
    if len(classes) != args.frame_count or any(value < 0 or value > 255 for value in classes):
        raise AssertionError("GAME adapter produced invalid B-local MIDI-P classes")

    payload = {
        "schema": SCHEMA,
        "sourceSHA256": source_hash,
        "sourceSampleCount": sample_count,
        "frameCount": args.frame_count,
        "classes": classes,
        "noteIds": [int(value) for value in tracks["note_ids"].tolist()],
        "rawNotes": [
            {
                "duration": float(duration),
                "presence": bool(presence),
                "score": float(score),
                "class": int(class_id),
                "valid": bool(valid),
            }
            for duration, presence, score, class_id, valid in zip(
                arrays["durations"],
                arrays["presence"],
                arrays["scores"],
                arrays["classes"],
                arrays["valid"],
            )
        ],
        "baseSeed": BASE_SEED,
        "effectiveSeed": seed,
        "language": args.language,
        "languageId": language_id,
        "gameCommit": commit,
        "gameSchema": GAME_CACHE_SCHEMA,
        "runtimeHashes": hashes,
        "compilerSHA256": sha256_file(Path(__file__)),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    emit(
        "complete",
        output=str(args.output),
        noteCount=sum(bool(value) for value in arrays["valid"]),
        voicedNoteCount=sum(bool(valid and presence) for valid, presence in zip(arrays["valid"], arrays["presence"])),
        restFrameCount=sum(value == 255 for value in classes),
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit("error", message=str(error))
        raise

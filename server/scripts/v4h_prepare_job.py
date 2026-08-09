#!/usr/bin/env python3
"""Prepare one web V4H job with user-bounded per-phrase SOFA alignment."""

import argparse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import shutil
import sys
import tempfile


SCHEMA = "aisvc.v4h-web-alignment.v1"
EXPECTED_HASHES = {
    "h_runner": "936d4a0e34a4f72f52592e741d4c0f1b36ff03e5657cba3d5eaf8242d18090da",
    "frontend": "a121d614d2a0962e4c8db796e186826ef69b7fba5428ecd5167808eff61c27c8",
    "manifest": "67f0abb8f75b1a0b79f17fb2846da086370f49633b71d497acdb10abce75d6c2",
    "placement": "086d4e65432d27a7513cac5e61343f89554711c8194bb4258667d0d2c106a2ee",
    "japanese": "46dea1dabb4a63c7a1aa7ed03f86ad752da32ea0ff8098b23ee6cb4c75834c89",
    "vocab": "0f5c44e05f79df8ae4fd77d7772950436a8bacc83d134fdf0ae3c72412b5676a",
    "sofa_checkpoint": "d408bb1f511c79ae3fe7ea4f72d02032b384677c1435e9c2e54973139fdf3fc8",
}


def emit(event_type, **payload):
    print(json.dumps({"type": event_type, **payload}, ensure_ascii=False), flush=True)


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_hash(label, path):
    path = Path(path).resolve()
    if not path.is_file():
        raise FileNotFoundError(f"missing V4H {label}: {path}")
    actual = sha256_file(path)
    expected = EXPECTED_HASHES[label]
    if actual != expected:
        raise ValueError(f"V4H {label} SHA256 mismatch: {actual} != {expected}: {path}")
    return actual


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def parse_args():
    parser = argparse.ArgumentParser(description="Prepare a single V4H web inference job")
    parser.add_argument("--job-manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--h-runner", type=Path, required=True)
    parser.add_argument("--singer-root", type=Path, required=True)
    parser.add_argument("--sofa-repo", type=Path, required=True)
    parser.add_argument("--sofa-checkpoint", type=Path, required=True)
    parser.add_argument("--escape-seconds", type=float, required=True)
    parser.add_argument("--gpu", type=int, default=0)
    return parser.parse_args()


def validate_phrases(source, duration, label, tokenizer):
    if not isinstance(source, list) or not source:
        raise ValueError(f"{label} contains no phrases")
    phrases = []
    previous_end = None
    for index, raw in enumerate(source):
        text = str(raw.get("text") or "").strip()
        if not text:
            raise ValueError(f"{label} phrase {index + 1} contains no kana")
        start = float(raw["start"])
        if raw.get("end") is None:
            raise ValueError(f"{label} phrase {index + 1} requires an end boundary for V4H")
        end = float(raw["end"])
        if not math.isfinite(start) or not math.isfinite(end) or not 0 <= start < end <= duration + 0.05:
            raise ValueError(
                f"{label} phrase {index + 1} is outside audio: "
                f"{start:.6f}-{end:.6f}/{duration:.6f}"
            )
        if previous_end is not None and start < previous_end - 1e-6:
            raise ValueError(f"{label} TextObject phrases overlap before SOFA alignment")
        tokens = [int(token) for token in tokenizer.encode(text)]
        if not tokens:
            raise ValueError(f"{label} phrase {index + 1} tokenizer returned no tokens")
        phrases.append(
            {
                "id": str(raw.get("id") or f"{label}:phrase:{index}"),
                "text": text,
                "kana": text,
                "start": start,
                "end": min(end, duration),
                "tokens": tokens,
            }
        )
        previous_end = end
    return phrases


def lexical_span(h_alignment, crop_start):
    intervals = [
        event.get("interval")
        for event in h_alignment.get("phone_events", [])
        if isinstance(event.get("interval"), dict)
    ]
    if not intervals:
        return None
    return {
        "firstStart": float(intervals[0]["start"]) + crop_start,
        "lastEnd": float(intervals[-1]["end"]) + crop_start,
        "phoneCount": len(intervals),
    }


def write_crop(sf, audio_path, crop_path, crop_start, crop_end):
    info = sf.info(audio_path)
    start_frame = max(0, int(round(crop_start * info.samplerate)))
    end_frame = min(info.frames, int(round(crop_end * info.samplerate)))
    audio, sample_rate = sf.read(
        audio_path,
        start=start_frame,
        stop=end_frame,
        dtype="float32",
        always_2d=True,
    )
    if len(audio) == 0:
        raise ValueError(f"empty SOFA crop: {crop_start:.6f}-{crop_end:.6f}")
    mono = audio.mean(axis=1)
    sf.write(crop_path, mono, sample_rate, subtype="FLOAT")
    return start_frame / sample_rate, end_frame / sample_rate


def prepare_region(
    *,
    label,
    audio_path,
    raw_phrases,
    escape_seconds,
    temp_dir,
    batch_offset,
    h_runner,
    sofa_runtime,
    tokenizer,
    ipa_converter,
    phone_to_ipa,
    vocab,
):
    import soundfile as sf

    audio_path = Path(audio_path).resolve()
    if not audio_path.is_file():
        raise FileNotFoundError(f"missing {label} audio: {audio_path}")
    duration = float(sf.info(audio_path).duration)
    phrases = validate_phrases(raw_phrases, duration, label, tokenizer)
    candidates = []
    audits = []

    for index, phrase in enumerate(phrases):
        requested_start = max(0.0, phrase["start"] - escape_seconds)
        requested_end = min(duration, phrase["end"] + escape_seconds)
        crop_path = temp_dir / f"{label}_{index:04d}.wav"
        crop_start, crop_end = write_crop(
            sf, audio_path, crop_path, requested_start, requested_end
        )
        local_phrase = {
            **phrase,
            "start": phrase["start"] - crop_start,
            "end": phrase["end"] - crop_start,
        }
        item = {
            "split": label,
            "source_index": batch_offset + index,
            "record": {
                "Path": str(crop_path),
                "Duration": crop_end - crop_start,
                "Phrases": [local_phrase],
            },
        }
        emit(
            "align_phrase",
            region=label,
            index=index + 1,
            total=len(phrases),
            cropStart=crop_start,
            cropEnd=crop_end,
        )
        record = h_runner.build_output_record(
            item,
            crop_path,
            sha256_file(crop_path),
            ipa_converter,
            phone_to_ipa,
            vocab,
            max_abs_phone_shift=4,
            sofa_runtime=sofa_runtime,
            batch_index=batch_offset + index,
        )
        h_alignment = record["HAlignment"]
        phrase_candidates = h_alignment.get("phrase_candidates") or []
        if len(phrase_candidates) != 1:
            raise ValueError(f"{label} phrase {index + 1} produced no unique candidate")
        candidate = dict(phrase_candidates[0])
        candidate["phrase_index"] = index
        candidates.append(candidate)
        audits.append(
            {
                "phraseIndex": index,
                "text": phrase["text"],
                "coreStart": phrase["start"],
                "coreEnd": phrase["end"],
                "cropStart": crop_start,
                "cropEnd": crop_end,
                "status": candidate.get("status"),
                "fallbackReason": candidate.get("fallback_reason"),
                "lexicalSpan": lexical_span(h_alignment, crop_start),
                "hAlignment": h_alignment,
            }
        )

    for index in range(len(audits) - 1):
        previous_span = audits[index]["lexicalSpan"]
        next_span = audits[index + 1]["lexicalSpan"]
        if previous_span is None or next_span is None:
            continue
        if previous_span["lastEnd"] > next_span["firstStart"] + 1e-6:
            emit(
                "alignment_order_error",
                code="alignment_order",
                region=label,
                previousPhrase=index + 1,
                nextPhrase=index + 2,
                previousLastEnd=previous_span["lastEnd"],
                nextFirstStart=next_span["firstStart"],
            )
            raise ValueError("音素对齐错位，请调小SOFA逸散程度后重试")

    eligible = sum(candidate.get("status") == "eligible" for candidate in candidates)
    return {
        "Audio": str(audio_path),
        "Duration": duration,
        "Phrases": phrases,
        "HAlignment": {
            "schema": "h_alignment_v1_web_phrase_windows",
            "sample_status": (
                "all_phone" if eligible == len(candidates)
                else "all_sentence_fallback" if eligible == 0
                else "mixed"
            ),
            "phrase_candidates": candidates,
            "phrase_audits": audits,
        },
    }


def main():
    args = parse_args()
    if not math.isfinite(args.escape_seconds) or not 0 <= args.escape_seconds <= 2:
        raise ValueError("SOFA escape seconds must be between 0 and 2")
    os.environ.setdefault(
        "PHONEMIZER_ESPEAK_LIBRARY", r"C:\Program Files\eSpeak NG\libespeak-ng.dll"
    )
    runtime = args.runtime.resolve()
    singer_root = args.singer_root.resolve()
    h_runner_path = args.h_runner.resolve()
    sofa_checkpoint = args.sofa_checkpoint.resolve()
    required = {
        "h_runner": h_runner_path,
        "frontend": runtime / "h_alignment" / "frontend.py",
        "manifest": runtime / "h_alignment" / "manifest.py",
        "placement": runtime / "h_alignment" / "placement.py",
        "japanese": runtime / "japanese.py",
        "vocab": runtime / "vocab.json",
        "sofa_checkpoint": sofa_checkpoint,
    }
    hashes = {label: require_hash(label, path) for label, path in required.items()}

    sys.path.insert(0, str(h_runner_path.parents[2]))
    h_runner = load_module(h_runner_path, "v4h_authoritative_h_runner_web")
    actual_module_paths = {
        "frontend": Path(sys.modules[h_runner.build_frontend.__module__].__file__).resolve(),
        "manifest": Path(sys.modules[h_runner.build_phrase_candidates.__module__].__file__).resolve(),
        "placement": Path(sys.modules[h_runner.canonical_sha256.__module__].__file__).resolve(),
    }
    for label, module_path in actual_module_paths.items():
        require_hash(label, module_path)

    sys.path.insert(0, str(singer_root))
    os.chdir(singer_root)
    from src.YingMusicSinger.utils.cnen_tokenizer import CNENTokenizer

    tokenizer = CNENTokenizer()
    if int(tokenizer.phone2id["<SEP>"]) != 365:
        raise ValueError("tokenizer SEP ID is not 365")
    ipa_converter, phone_to_ipa = h_runner.load_japanese_frontend(runtime / "japanese.py")
    vocab = json.loads((runtime / "vocab.json").read_text(encoding="utf-8"))["vocab"]

    class SofaArgs:
        gpu = args.gpu
        sofa_repo = args.sofa_repo.resolve()
        checkpoint = sofa_checkpoint

    emit("loading_sofa", checkpoint=str(sofa_checkpoint))
    sofa_runtime = h_runner.SofaRuntime(SofaArgs())
    emit("loaded_sofa")
    job = json.loads(args.job_manifest.read_text(encoding="utf-8"))
    temp_dir = Path(tempfile.mkdtemp(prefix="v4h_phrase_", dir=str(args.output.parent)))
    try:
        ref_phrases = job.get("refPhrases") or []
        target_phrases = job.get("targetPhrases") or []
        ref = prepare_region(
            label="A",
            audio_path=job["refAudio"],
            raw_phrases=ref_phrases,
            escape_seconds=args.escape_seconds,
            temp_dir=temp_dir,
            batch_offset=0,
            h_runner=h_runner,
            sofa_runtime=sofa_runtime,
            tokenizer=tokenizer,
            ipa_converter=ipa_converter,
            phone_to_ipa=phone_to_ipa,
            vocab=vocab,
        )
        target = prepare_region(
            label="B",
            audio_path=job["melodyAudio"],
            raw_phrases=target_phrases,
            escape_seconds=args.escape_seconds,
            temp_dir=temp_dir,
            batch_offset=len(ref_phrases),
            h_runner=h_runner,
            sofa_runtime=sofa_runtime,
            tokenizer=tokenizer,
            ipa_converter=ipa_converter,
            phone_to_ipa=phone_to_ipa,
            vocab=vocab,
        )
        all_candidates = [
            *ref["HAlignment"]["phrase_candidates"],
            *target["HAlignment"]["phrase_candidates"],
        ]
        eligible = sum(item.get("status") == "eligible" for item in all_candidates)
        output = {
            "schema": SCHEMA,
            "escapeSeconds": args.escape_seconds,
            "hashes": hashes,
            "maxAbsPhoneShift": 4,
            "A": ref,
            "B": target,
            "summary": {
                "phraseCount": len(all_candidates),
                "phoneCandidateCount": eligible,
                "fallbackCandidateCount": len(all_candidates) - eligible,
            },
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        emit("complete", output=str(args.output), **output["summary"])
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit(
            "error",
            code=("alignment_order" if str(error) == "音素对齐错位，请调小SOFA逸散程度后重试" else None),
            message=str(error),
        )
        raise

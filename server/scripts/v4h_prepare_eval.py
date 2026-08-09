#!/usr/bin/env python3
"""Build V4H phone/PUL candidates for an exported SVS evaluation dataset."""

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys


SCHEMA = "aisvc.v4h-eval-alignment.v1"
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
    actual = sha256_file(path)
    expected = EXPECTED_HASHES[label]
    if actual != expected:
        raise ValueError(f"{label} SHA256 mismatch: {actual} != {expected}: {path}")
    return actual


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_t1_phrases(path, tokenizer, duration):
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    source = payload.get("phrases")
    if not isinstance(source, list) or not source:
        raise ValueError(f"T1 contains no phrases: {path}")
    phrases = []
    for index, phrase in enumerate(source):
        kana = str(phrase.get("kana") or phrase.get("text") or "").strip()
        if not kana:
            raise ValueError(f"T1 phrase {index} contains no kana/text: {path}")
        start = float(phrase["start"])
        end = float(phrase["end"])
        if not 0 <= start < end <= duration + 0.05:
            raise ValueError(
                f"T1 phrase {index} is outside audio: {start:.6f}-{end:.6f}/{duration:.6f}"
            )
        tokens = [int(token) for token in tokenizer.encode(kana)]
        if not tokens:
            raise ValueError(f"tokenizer returned no tokens for phrase {index}: {kana!r}")
        phrases.append(
            {
                "id": str(phrase.get("id") or f"phrase:{index}"),
                "text": kana,
                "kana": kana,
                "start": start,
                "end": end,
                "tokens": tokens,
            }
        )
    return phrases


def build_region_record(
    h_runner,
    sofa_runtime,
    tokenizer,
    ipa_converter,
    phone_to_ipa,
    vocab,
    audio_path,
    t1_path,
    region,
    source_index,
    batch_index,
):
    import soundfile as sf

    audio_path = Path(audio_path).resolve()
    duration = float(sf.info(audio_path).duration)
    phrases = load_t1_phrases(t1_path, tokenizer, duration)
    item = {
        "split": region,
        "source_index": int(source_index),
        "record": {
            "Path": str(audio_path),
            "Duration": duration,
            "Phrases": phrases,
        },
    }
    return h_runner.build_output_record(
        item,
        audio_path,
        sha256_file(audio_path),
        ipa_converter,
        phone_to_ipa,
        vocab,
        max_abs_phone_shift=4,
        sofa_runtime=sofa_runtime,
        batch_index=batch_index,
    )


def parse_args():
    parser = argparse.ArgumentParser(description="Prepare V4H evaluation alignments")
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--h-runner", type=Path, required=True)
    parser.add_argument("--singer-root", type=Path, required=True)
    parser.add_argument("--sofa-repo", type=Path, required=True)
    parser.add_argument("--sofa-checkpoint", type=Path, required=True)
    parser.add_argument("--gpu", type=int, default=0)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--limit", type=int)
    return parser.parse_args()


def main():
    args = parse_args()
    os.environ.setdefault(
        "PHONEMIZER_ESPEAK_LIBRARY",
        r"C:\Program Files\eSpeak NG\libespeak-ng.dll",
    )
    dataset = args.dataset.resolve()
    output_dir = args.output_dir.resolve()
    runtime = args.runtime.resolve()
    h_runner_path = args.h_runner.resolve()
    singer_root = args.singer_root.resolve()
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

    to_linux_root = h_runner_path.parents[2]
    sys.path.insert(0, str(to_linux_root))
    h_runner = load_module(h_runner_path, "v4h_authoritative_h_runner")
    actual_module_paths = {
        "frontend": Path(sys.modules[h_runner.build_frontend.__module__].__file__).resolve(),
        "manifest": Path(sys.modules[h_runner.build_phrase_candidates.__module__].__file__).resolve(),
        "placement": Path(sys.modules[h_runner.canonical_sha256.__module__].__file__).resolve(),
    }
    for label, path in actual_module_paths.items():
        require_hash(label, path)

    sys.path.insert(0, str(singer_root))
    os.chdir(singer_root)
    from src.YingMusicSinger.utils.cnen_tokenizer import CNENTokenizer

    tokenizer = CNENTokenizer()
    if int(tokenizer.phone2id["<SEP>"]) != 365:
        raise ValueError("tokenizer SEP ID is not 365")
    ipa_converter, phone_to_ipa = h_runner.load_japanese_frontend(
        runtime / "japanese.py"
    )
    vocab = json.loads((runtime / "vocab.json").read_text(encoding="utf-8"))["vocab"]

    class SofaArgs:
        gpu = args.gpu
        sofa_repo = args.sofa_repo.resolve()
        checkpoint = sofa_checkpoint

    emit("loading_sofa", checkpoint=str(sofa_checkpoint))
    sofa_runtime = h_runner.SofaRuntime(SofaArgs())
    emit("loaded_sofa")

    source_manifest = json.loads((dataset / "manifest.json").read_text(encoding="utf-8"))
    groups = source_manifest.get("groups") or []
    if not groups:
        raise ValueError("evaluation dataset contains no groups")
    if args.limit is not None:
        groups = groups[: args.limit]
    groups_dir = output_dir / "groups"
    groups_dir.mkdir(parents=True, exist_ok=True)
    output_groups = []

    for position, group in enumerate(groups, start=1):
        group_dir = dataset / group["directory"]
        output_file = groups_dir / f"{int(group['index']):03d}.json"
        if args.resume and output_file.is_file():
            record = json.loads(output_file.read_text(encoding="utf-8"))
            output_groups.append(record["indexEntry"])
            emit("skipped", index=position, total=len(groups), group=group["name"])
            continue

        emit("start", index=position, total=len(groups), group=group["name"])
        records = {}
        for region_index, region in enumerate(("A", "B")):
            records[region] = build_region_record(
                h_runner=h_runner,
                sofa_runtime=sofa_runtime,
                tokenizer=tokenizer,
                ipa_converter=ipa_converter,
                phone_to_ipa=phone_to_ipa,
                vocab=vocab,
                audio_path=group_dir / f"{region}.wav",
                t1_path=group_dir / f"{region}_T1.json",
                region=region,
                source_index=(position - 1) * 2 + region_index,
                batch_index=(position - 1) * 2 + region_index,
            )
        index_entry = {
            "index": int(group["index"]),
            "name": str(group["name"]),
            "directory": str(group["directory"]),
            "alignmentFile": f"groups/{int(group['index']):03d}.json",
        }
        result = {
            "schema": SCHEMA,
            "indexEntry": index_entry,
            "A": records["A"],
            "B": records["B"],
        }
        output_file.write_text(
            json.dumps(result, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        output_groups.append(index_entry)
        emit(
            "done",
            index=position,
            total=len(groups),
            group=group["name"],
            aStatus=records["A"]["HAlignment"]["sample_status"],
            bStatus=records["B"]["HAlignment"]["sample_status"],
        )

    manifest = {
        "schema": SCHEMA,
        "sourceDataset": str(dataset),
        "runtime": str(runtime),
        "hashes": hashes,
        "maxAbsPhoneShift": 4,
        "groups": output_groups,
    }
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    emit("complete", groups=len(output_groups), output=str(output_dir))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit("error", message=str(error))
        raise

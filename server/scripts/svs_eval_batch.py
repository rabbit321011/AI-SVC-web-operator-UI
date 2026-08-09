import argparse
import gc
import json
import os
import re
import sys
from pathlib import Path


SVS_ROOT = Path(r"E:\AIscene\YingMusic_Singer_Plus")


def emit(event_type, **payload):
    print(json.dumps({"type": event_type, **payload}, ensure_ascii=False), flush=True)


def safe_name(value):
    value = re.sub(r'[<>:"/\\|?*]', "_", str(value)).strip().rstrip(".")
    return value or "unnamed"


def load_phrases(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    phrases = []
    for phrase in data.get("phrases", []):
        text = str(phrase.get("kana") or phrase.get("text") or phrase.get("romaji") or "").strip()
        if not text:
            continue
        item = {"start": float(phrase["start"]), "text": text}
        if phrase.get("end") is not None:
            item["end"] = float(phrase["end"])
        phrases.append(item)
    if not phrases:
        raise ValueError(f"T1 has no usable phrases: {path}")
    return phrases


def is_valid_wav(path):
    return path.is_file() and path.stat().st_size > 44


def main():
    parser = argparse.ArgumentParser(description="Batch SVS evaluation runner")
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--model-id", required=True)
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--vae-ckpt", required=True)
    parser.add_argument("--steps", type=int, default=32)
    parser.add_argument("--cfg", type=float, default=3.0)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()

    dataset = Path(args.dataset).resolve()
    output_dir = Path(args.output_dir).resolve()
    manifest = json.loads((dataset / "manifest.json").read_text(encoding="utf-8"))
    groups = manifest.get("groups", [])
    if not groups:
        raise ValueError("Evaluation manifest has no groups")
    output_dir.mkdir(parents=True, exist_ok=True)

    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    os.environ.setdefault("HF_DATASETS_OFFLINE", "1")
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("PHONEMIZER_ESPEAK_LIBRARY", r"C:\Program Files\eSpeak NG\libespeak-ng.dll")
    os.chdir(SVS_ROOT)
    sys.path.insert(0, str(SVS_ROOT))

    import torch
    import torchaudio
    import infer_v4_formal as infer

    emit("loading", modelId=args.model_id, groups=len(groups))
    policy, vae, midi_teacher, mel_extract, tokenizer = infer.build_model(
        checkpoint=args.checkpoint,
        vae_ckpt=args.vae_ckpt,
        model_id=args.model_id,
        device=args.device,
    )
    emit("loaded", modelId=args.model_id)

    completed = 0
    skipped = 0
    for index, group in enumerate(groups, start=1):
        group_dir = dataset / group["directory"]
        output_path = output_dir / f"{safe_name(group['name'])}.wav"
        if args.resume and is_valid_wav(output_path):
            skipped += 1
            emit("skipped", index=index, total=len(groups), group=group["name"], output=str(output_path))
            continue

        ref_phrases = load_phrases(group_dir / "A_T1.json")
        target_phrases = load_phrases(group_dir / "B_T1.json")
        emit("start", index=index, total=len(groups), group=group["name"])
        wav, sample_rate = infer.synthesize(
            policy,
            vae,
            midi_teacher,
            mel_extract,
            tokenizer,
            ref_audio=str(group_dir / "A.wav"),
            melody_audio=str(group_dir / "B.wav"),
            ref_phrases=ref_phrases,
            target_phrases=target_phrases,
            steps=args.steps,
            cfg_strength=args.cfg,
            seed=args.seed,
            device=args.device,
        )
        torchaudio.save(str(output_path), wav.unsqueeze(0), sample_rate)
        duration = wav.shape[0] / sample_rate
        del wav
        torch.cuda.empty_cache()
        completed += 1
        emit("done", index=index, total=len(groups), group=group["name"], duration=duration, output=str(output_path))

    del policy, vae, midi_teacher, mel_extract, tokenizer
    torch.cuda.empty_cache()
    gc.collect()
    emit("complete", modelId=args.model_id, completed=completed, skipped=skipped, total=len(groups))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit("error", message=str(error))
        raise

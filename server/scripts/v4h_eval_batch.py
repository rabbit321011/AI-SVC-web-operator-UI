#!/usr/bin/env python3
"""Batch V4H inference using the hash-locked training phone/PUL renderer."""

import argparse
import gc
import hashlib
import json
import os
from pathlib import Path
import re
import sys


SCHEMA = "aisvc.v4h-eval-alignment.v1"
VFR = 44100 / 2048
SEP_TOKEN = 365
PUL_TOKEN = 366
EXPECTED_PLACEMENT_SHA256 = "086d4e65432d27a7513cac5e61343f89554711c8194bb4258667d0d2c106a2ee"
SUPPORTED_CHECKPOINT_SCHEMAS = {
    "h_pul_training_checkpoint_v1",
    "h_pul_g_training_checkpoint_v1",
}


def emit(event_type, **payload):
    print(json.dumps({"type": event_type, **payload}, ensure_ascii=False), flush=True)


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


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


def strict_checkpoint_metadata(checkpoint, config, vae_config, vae_ckpt, midi_ckpt):
    import torch

    payload = torch.load(checkpoint, map_location="cpu", weights_only=False, mmap=True)
    metadata = payload.get("h_training")
    if not isinstance(metadata, dict):
        raise ValueError("V4H checkpoint lacks h_training metadata")
    if metadata.get("schema") not in SUPPORTED_CHECKPOINT_SCHEMAS:
        raise ValueError(f"unexpected V4H schema: {metadata.get('schema')}")
    if metadata.get("placement_mode") != "phone_pul":
        raise ValueError(f"unexpected placement mode: {metadata.get('placement_mode')}")
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
            raise ValueError(f"V4H contract {key} mismatch: {contract.get(key)} != {expected}")

    expected_hashes = metadata.get("file_sha256") or {}
    actual_paths = {
        "model_config": config,
        "vae_config": vae_config,
        "vae_checkpoint": vae_ckpt,
        "midi_checkpoint": midi_ckpt,
    }
    for key, path in actual_paths.items():
        actual = sha256_file(path)
        expected = expected_hashes.get(key)
        if actual != expected:
            raise ValueError(f"{key} SHA256 mismatch: {actual} != {expected}: {path}")
    return payload


def build_model(checkpoint, config, vae_config, vae_ckpt, midi_ckpt, device):
    import torch
    if not hasattr(torch, "load_orig"):
        torch.load_orig = torch.load

        def load_compat(*args, **kwargs):
            kwargs.setdefault("weights_only", False)
            return torch.load_orig(*args, **kwargs)

        torch.load = load_compat
    from omegaconf import OmegaConf
    from src.YingMusicSinger.models.dit import DiT
    from src.YingMusicSinger.models.model import Singer
    from src.YingMusicSinger.melody.midi_extractor import MIDIExtractor
    from src.YingMusicSinger.utils.mel_spectrogram import MelodySpectrogram
    from src.YingMusicSinger.utils.stable_audio_tools.vae_copysyn import StableAudioInfer

    checkpoint_payload = strict_checkpoint_metadata(
        checkpoint, config, vae_config, vae_ckpt, midi_ckpt
    )
    cfg = OmegaConf.load(config)
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
    state = checkpoint_payload.get("ema_model_state_dict")
    if not isinstance(state, dict):
        raise ValueError("V4H checkpoint lacks ema_model_state_dict")
    state = {
        key.replace("module.", "").replace("ema_model.", ""): value
        for key, value in state.items()
        if key not in {"initted", "step"}
    }
    policy.load_state_dict(state, strict=True)
    del checkpoint_payload, state
    gc.collect()
    policy = policy.to(device).eval()

    vae = StableAudioInfer(
        model_config_path=str(vae_config), model_ckpt_path=str(vae_ckpt)
    ).to(device).eval()
    midi_teacher = MIDIExtractor(in_dim=80)
    midi_teacher._load_form_ckpt(str(midi_ckpt))
    midi_teacher = midi_teacher.to(device).eval()
    return policy, vae, midi_teacher, MelodySpectrogram()


def combined_phrases_and_candidates(alignment, encoded_ref_frames):
    combined_phrases = []
    combined_candidates = []
    regions = []
    for region in ("A", "B"):
        record = alignment[region]
        phrases = record.get("Phrases") or []
        candidates = (record.get("HAlignment") or {}).get("phrase_candidates") or []
        if len(phrases) != len(candidates):
            raise ValueError(f"{region} phrase/candidate count mismatch")
        for phrase, candidate in zip(phrases, candidates):
            phrase = dict(phrase)
            if region == "B":
                relative_start_frame = int(float(phrase["start"]) * VFR)
                phrase["start"] = (int(encoded_ref_frames) + relative_start_frame) / VFR
                phrase["end"] = int(encoded_ref_frames) / VFR + float(phrase["end"])
            combined_phrases.append(phrase)
            combined_candidates.append(candidate)
            regions.append(region)
    return combined_phrases, combined_candidates, regions


def placement_audit(rendered, regions):
    phrase_audits = []
    for region, audit in zip(regions, rendered["phone_pul"]["phrases"]):
        phrase_audits.append({"region": region, **audit})
    return {
        "schema": "aisvc.v4h-placement-audit.v1",
        "renderer": "authoritative render_h_pul_placements",
        "placementModuleSHA256": EXPECTED_PLACEMENT_SHA256,
        "phonePhraseCount": rendered["phone_phrase_count"],
        "pulPhraseCount": rendered["pul_phrase_count"],
        "exactControlPhraseCount": rendered["exact_control_phrase_count"],
        "pulFrameCount": rendered["pul_frame_count"],
        "sampleControlAnomaly": rendered["sample_control_anomaly"],
        "sampleStructuralFallback": rendered["sample_structural_fallback"],
        "structuralFallbackReason": rendered["structural_fallback_reason"],
        "lockedEventTokenSHA256": rendered["locked_event_token_sha256"],
        "denseTextSHA256": hashlib.sha256(
            json.dumps(rendered["phone_pul"]["text"], separators=(",", ":")).encode("utf-8")
        ).hexdigest(),
        "phrases": phrase_audits,
    }


def synthesize(
    policy,
    vae,
    midi_teacher,
    mel_extract,
    render_h_pul_placements,
    ref_audio,
    melody_audio,
    alignment,
    steps,
    cfg_strength,
    seed,
    device,
):
    import torch
    ra, rs = load_audio(ref_audio)
    rw = torch.cat([ra, torch.zeros(ra.shape[0], int(rs * 0.5))], dim=1)
    rl = vae.encode_audio(rw, in_sr=rs).transpose(1, 2)

    ma, ms = load_audio(melody_audio)
    mw = torch.cat([ma, torch.zeros(ma.shape[0], int(ms * 1.0))], dim=1)
    ml = vae.encode_audio(mw, in_sr=ms).transpose(1, 2)

    midi_in = torch.cat([rl, ml], dim=1)
    ref_frames = int(rl.shape[1])
    total_frames = ref_frames + int(ml.shape[1])
    ref_mel = mel_extract(audio=rw, sr=rs)
    melody_mel = mel_extract(audio=mw, sr=ms)
    combined_mel = torch.cat([ref_mel, melody_mel], dim=2).to(device)
    with torch.no_grad():
        midi_p, bound_p = midi_teacher(combined_mel.transpose(1, 2))

    phrases, candidates, regions = combined_phrases_and_candidates(
        alignment, ref_frames
    )
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
        raise AssertionError("V4H renderer emitted an invalid dense text tensor")
    text_tokens = torch.tensor(dense_text, dtype=torch.int64).unsqueeze(0).to(device)

    torch.manual_seed(seed)
    with torch.inference_mode():
        gen_latent, _ = policy.sample(
            cond=rl.to(device),
            text=text_tokens,
            duration=total_frames,
            midi_in=midi_in.to(device),
            midi_p=midi_p,
            bound_p=bound_p,
            steps=steps,
            cfg_strength=cfg_strength,
            guidance_scale=cfg_strength,
            t_shift=0.5,
            seed=seed,
            use_epss=False,
            enable_melody_control=True,
        )
    rear_frames = int(VFR * 1.0)
    b_latent = gen_latent[:, ref_frames:-rear_frames, :].permute(0, 2, 1).float()
    wav = vae.decode_audio(b_latent).squeeze(0)[:1].reshape(-1).cpu()
    audit = placement_audit(rendered, regions)
    audit.update(
        {
            "refFrames": ref_frames,
            "melodyFrames": int(ml.shape[1]),
            "totalFrames": total_frames,
            "nonPadFrames": sum(token != 0 for token in dense_text),
        }
    )
    return wav, 44100, audit


def parse_args():
    parser = argparse.ArgumentParser(description="Batch V4H evaluation runner")
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--alignment-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--singer-root", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--vae-ckpt", type=Path, required=True)
    parser.add_argument("--midi-ckpt", type=Path, required=True)
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
    placement_path = runtime / "h_alignment" / "placement.py"
    if sha256_file(placement_path) != EXPECTED_PLACEMENT_SHA256:
        raise ValueError("authoritative V4H placement module SHA256 mismatch")
    sys.path.insert(0, str(runtime))
    sys.path.insert(0, str(singer_root))
    os.chdir(singer_root)
    from h_alignment.placement import render_h_pul_placements
    import torch
    alignment_manifest = json.loads(
        (alignment_dir / "manifest.json").read_text(encoding="utf-8")
    )
    if alignment_manifest.get("schema") != SCHEMA:
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
    emit("loading", checkpoint=str(args.checkpoint), groups=len(dataset_groups))
    policy, vae, midi_teacher, mel_extract = build_model(
        checkpoint=args.checkpoint.resolve(),
        config=runtime / "YingMusic_Singer.yaml",
        vae_config=runtime / "stable_audio_2_0_vae_20hz_official.json",
        vae_ckpt=args.vae_ckpt.resolve(),
        midi_ckpt=args.midi_ckpt.resolve(),
        device=args.device,
    )
    emit("loaded")

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
            midi_teacher=midi_teacher,
            mel_extract=mel_extract,
            render_h_pul_placements=render_h_pul_placements,
            ref_audio=group_dir / "A.wav",
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
                "checkpoint": str(args.checkpoint.resolve()),
                "cfg": args.cfg,
                "steps": args.steps,
                "seed": args.seed,
            }
        )
        audit_path.write_text(
            json.dumps(audit, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
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
            exact=audit["exactControlPhraseCount"],
        )

    del policy, vae, midi_teacher, mel_extract
    torch.cuda.empty_cache()
    gc.collect()
    emit("complete", completed=completed, skipped=skipped, total=len(dataset_groups))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit("error", message=str(error))
        raise

#!/usr/bin/env python3
"""Compile and audit V5-P direct MIDI control on a frame-aligned A/B map."""

import argparse
import hashlib
import json
from pathlib import Path


SAMPLE_RATE = 44100
HOP_SAMPLES = 2048
NOMINAL_REFERENCE_GAP_SAMPLES = 22050
TARGET_REAR_SAMPLES = 44100
EVALUATOR_REAR_CROP_FRAMES = TARGET_REAR_SAMPLES // HOP_SAMPLES
REST_CLASS_ID = 255
PAD_CLASS_ID = 256
SEP_TOKEN_ID = 365
PUL_TOKEN_ID = 366


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def tensor_sha256(value):
    return hashlib.sha256(
        value.detach().cpu().contiguous().numpy().tobytes()
    ).hexdigest()


def build_frame_map(reference_samples, target_samples, encoded_ref_frames=None,
                    encoded_target_frames=None):
    reference_samples = positive_integer(reference_samples, "referenceSamples")
    target_samples = positive_integer(target_samples, "targetSamples")
    reference_owned_frames = reference_samples // HOP_SAMPLES
    target_owned_frames = target_samples // HOP_SAMPLES
    if reference_owned_frames < 1 or target_owned_frames < 1:
        raise ValueError("A/B Owned Guide must contain at least one V5-P frame")

    b_start_frame = (
        reference_samples
        + NOMINAL_REFERENCE_GAP_SAMPLES
        + HOP_SAMPLES // 2
    ) // HOP_SAMPLES
    reference_padded_samples = b_start_frame * HOP_SAMPLES
    gap_samples = reference_padded_samples - reference_samples
    target_padded_samples = target_samples + TARGET_REAR_SAMPLES
    target_padded_frames = target_padded_samples // HOP_SAMPLES
    if encoded_ref_frames is not None and int(encoded_ref_frames) != b_start_frame:
        raise ValueError(
            f"A official VAE frame count mismatch: {encoded_ref_frames} != {b_start_frame}"
        )
    if encoded_target_frames is not None and int(encoded_target_frames) != target_padded_frames:
        raise ValueError(
            "B official VAE frame count mismatch: "
            f"{encoded_target_frames} != {target_padded_frames}"
        )

    total_frames = b_start_frame + target_padded_frames
    crop_end = total_frames - EVALUATOR_REAR_CROP_FRAMES
    decoded_frames = crop_end - b_start_frame
    return {
        "schema": "aisvc.v5p-ab-frame-map.v1",
        "sampleRate": SAMPLE_RATE,
        "hopSamples": HOP_SAMPLES,
        "reference": {
            "ownedSampleCount": reference_samples,
            "ownedFrameCount": reference_owned_frames,
            "nominalPaddingSampleCount": NOMINAL_REFERENCE_GAP_SAMPLES,
            "paddingSampleCount": gap_samples,
            "paddingAdjustmentSampleCount": (
                gap_samples - NOMINAL_REFERENCE_GAP_SAMPLES
            ),
            "paddedSampleCount": reference_padded_samples,
            "paddedFrameCount": b_start_frame,
            "paddingFrameCount": b_start_frame - reference_owned_frames,
            "trailingSampleCount": reference_samples % HOP_SAMPLES,
            "paddedTrailingSampleCount": 0,
            "paddingKind": "ab-gap",
        },
        "target": {
            "ownedSampleCount": target_samples,
            "ownedFrameCount": target_owned_frames,
            "nominalPaddingSampleCount": TARGET_REAR_SAMPLES,
            "paddingSampleCount": TARGET_REAR_SAMPLES,
            "paddingAdjustmentSampleCount": 0,
            "paddedSampleCount": target_padded_samples,
            "paddedFrameCount": target_padded_frames,
            "paddingFrameCount": target_padded_frames - target_owned_frames,
            "trailingSampleCount": target_samples % HOP_SAMPLES,
            "paddedTrailingSampleCount": target_padded_samples % HOP_SAMPLES,
            "paddingKind": "decode-rear",
        },
        "bOffsetFrame": b_start_frame,
        "totalFrameCount": total_frames,
        "crop": {
            "startFrame": b_start_frame,
            "endFrameExclusive": crop_end,
            "evaluatorRearFrameCount": EVALUATOR_REAR_CROP_FRAMES,
            "decodedFrameCountBeforeSampleTrim": decoded_frames,
            "decodedFrameDelta": decoded_frames - target_owned_frames,
            "finalSampleCount": target_owned_frames * HOP_SAMPLES,
        },
    }


def build_midi_class_transport(frame_map, target_classes):
    target_classes = [int(value) for value in target_classes]
    target_frames = int(frame_map["target"]["ownedFrameCount"])
    if len(target_classes) != target_frames:
        raise ValueError(
            f"B MIDI-P class length mismatch: {len(target_classes)} != {target_frames}"
        )
    if any(value < 0 or value >= PAD_CLASS_ID for value in target_classes):
        raise ValueError("B effective MIDI-P only accepts pitch 0..254 or REST=255")
    start = int(frame_map["bOffsetFrame"])
    end = start + target_frames
    total = int(frame_map["totalFrameCount"])
    classes = [REST_CLASS_ID] * total
    classes[start:end] = target_classes
    return {
        "classIds": classes,
        "clearEmbeddingStartFrame": 0,
        "clearEmbeddingEndFrameExclusive": start,
        "targetStartFrame": start,
        "targetEndFrameExclusive": end,
        "rearStartFrame": end,
        "rearEndFrameExclusive": total,
        "rearClassId": REST_CLASS_ID,
    }


def build_h_transport(frame_map, reference_tokens, target_tokens,
                      reference_terminal_mode="user", target_terminal_mode="user"):
    reference_tokens = validate_h_layer(
        reference_tokens, frame_map["reference"]["ownedFrameCount"], "A"
    )
    target_tokens = validate_h_layer(
        target_tokens, frame_map["target"]["ownedFrameCount"], "B"
    )
    reference_terminal = terminal_h_structure(
        reference_tokens, "A", reference_terminal_mode
    )
    target_terminal = terminal_h_structure(
        target_tokens, "B", target_terminal_mode
    )
    first_lyric = next(
        (index for index, token in enumerate(target_tokens) if is_lyric_token(token)),
        -1,
    )
    if first_lyric < 0:
        raise ValueError("B dense H has no lyric token")
    if any(token != 0 for token in target_tokens[:first_lyric]):
        raise ValueError("B has unowned SEP/PUL before its first lyric token")

    b_offset = int(frame_map["bOffsetFrame"])
    total = int(frame_map["totalFrameCount"])
    reference_joint_sep = b_offset + first_lyric - 1
    target_joint_sep = total - 1
    tokens = [0] * total
    copy_h_layer(tokens, reference_tokens, 0, reference_terminal["sepFrame"], "A")
    copy_h_layer(
        tokens, target_tokens, b_offset, target_terminal["sepFrame"], "B"
    )
    reference_extension = extend_terminal_pul(
        tokens,
        reference_terminal["extendPul"],
        reference_terminal["sepFrame"],
        reference_joint_sep,
        "A",
    )
    target_extension = extend_terminal_pul(
        tokens,
        target_terminal["extendPul"],
        b_offset + target_terminal["sepFrame"],
        target_joint_sep,
        "B",
    )
    place_h_token(tokens, reference_joint_sep, SEP_TOKEN_ID, "A terminal SEP")
    place_h_token(tokens, target_joint_sep, SEP_TOKEN_ID, "B terminal SEP")
    expected_sep_count = (
        reference_tokens.count(SEP_TOKEN_ID) + target_tokens.count(SEP_TOKEN_ID)
    )
    if tokens.count(SEP_TOKEN_ID) != expected_sep_count:
        raise ValueError("joint H changed the SEP count")
    input_lyrics = [
        token for token in [*reference_tokens, *target_tokens] if is_lyric_token(token)
    ]
    output_lyrics = [token for token in tokens if is_lyric_token(token)]
    if input_lyrics != output_lyrics:
        raise ValueError("joint H changed the user lyric-token sequence")
    return {
        "schema": "aisvc.v5p-joint-h.v1",
        "tokens": tokens,
        "policy": "training-context-terminal-sep.v1",
        "reference": {
            "terminalPlacementMode": reference_terminal["placementMode"],
            "sourceTerminalSepFrame": reference_terminal["sepFrame"],
            "jointTerminalSepFrame": reference_joint_sep,
            "terminalPulExtendedFrames": reference_extension,
        },
        "target": {
            "terminalPlacementMode": target_terminal["placementMode"],
            "firstLyricLocalFrame": first_lyric,
            "sourceTerminalSepFrame": target_terminal["sepFrame"],
            "jointTerminalSepFrame": target_joint_sep,
            "terminalPulExtendedFrames": target_extension,
        },
    }


def embed_midi_transport(weight, transport):
    import torch

    if tuple(weight.shape) != (257, 128):
        raise ValueError(f"V5-P P embedding shape is invalid: {tuple(weight.shape)}")
    if not torch.equal(weight[PAD_CLASS_ID], torch.zeros_like(weight[PAD_CLASS_ID])):
        raise ValueError("V5-P PAD embedding row is not fixed zero")
    class_ids = torch.tensor(transport["classIds"], dtype=torch.long)
    embedding = weight[class_ids].detach().clone()
    clear_end = int(transport["clearEmbeddingEndFrameExclusive"])
    nonzero_before = int(torch.count_nonzero(embedding[:clear_end]).item())
    embedding[:clear_end] = 0
    if int(torch.count_nonzero(embedding[:clear_end]).item()) != 0:
        raise AssertionError("V5-P A MIDI embedding clear failed")
    start = int(transport["targetStartFrame"])
    end = int(transport["targetEndFrameExclusive"])
    if not torch.equal(embedding[start:end], weight[class_ids[start:end]]):
        raise AssertionError("V5-P B MIDI embedding transport changed a class")
    if not torch.equal(
        embedding[end:], weight[REST_CLASS_ID].expand(embedding.shape[0] - end, -1)
    ):
        raise AssertionError("V5-P rear MIDI embedding is not REST")
    return embedding, {
        "weightShape": list(weight.shape),
        "padRowZero": True,
        "aEmbeddingNonzeroBeforeClear": nonzero_before,
        "aEmbeddingNonzeroAfterClear": 0,
        "classSHA256": tensor_sha256(class_ids),
        "embeddingSHA256": tensor_sha256(embedding),
        "bEmbeddingSHA256": tensor_sha256(embedding[start:end]),
    }


def positive_integer(value, label):
    value = int(value)
    if value <= 0:
        raise ValueError(f"{label} must be a positive integer")
    return value


def validate_h_layer(tokens, expected_length, label):
    tokens = [int(token) for token in tokens]
    if len(tokens) != int(expected_length):
        raise ValueError(f"{label} dense H length differs from its frame contract")
    if any(token < 0 or token > PUL_TOKEN_ID or token == 364 for token in tokens):
        raise ValueError(f"{label} dense H contains an invalid token")
    return tokens


def terminal_h_structure(tokens, label, placement_mode):
    if placement_mode in ("sentence", "unknown"):
        raise ValueError(
            f"{label} terminal H uses {placement_mode} placement and cannot use "
            "phone/PUL relocation"
        )
    if placement_mode not in ("phone", "pul", "user"):
        raise ValueError(f"{label} terminal placement mode is invalid: {placement_mode}")
    try:
        sep_frame = len(tokens) - 1 - tokens[::-1].index(SEP_TOKEN_ID)
    except ValueError as error:
        raise ValueError(f"{label} dense H lacks a terminal SEP") from error
    last_event = next(
        (frame for frame in range(len(tokens) - 1, -1, -1) if tokens[frame] != 0),
        -1,
    )
    if last_event != sep_frame:
        raise ValueError(f"{label} has an H event after its terminal SEP")
    return {
        "sepFrame": sep_frame,
        "extendPul": sep_frame > 0 and tokens[sep_frame - 1] == PUL_TOKEN_ID,
        "placementMode": placement_mode,
    }


def copy_h_layer(joint, local, offset, skipped_frame, label):
    for frame, token in enumerate(local):
        if token == 0 or frame == skipped_frame:
            continue
        place_h_token(joint, offset + frame, token, f"{label} H")


def extend_terminal_pul(tokens, enabled, source_sep, target_sep, label):
    if not enabled:
        return 0
    if target_sep < source_sep:
        raise ValueError(f"{label} terminal SEP cannot move backwards")
    for frame in range(source_sep, target_sep):
        place_h_token(tokens, frame, PUL_TOKEN_ID, f"{label} terminal PUL")
    return target_sep - source_sep


def place_h_token(tokens, frame, token, label):
    if not 0 <= int(frame) < len(tokens):
        raise ValueError(f"{label} escaped the joint frame contract")
    if tokens[int(frame)] != 0:
        raise ValueError(f"{label} collided with an existing H token")
    tokens[int(frame)] = int(token)


def is_lyric_token(token):
    return token > 0 and token not in (SEP_TOKEN_ID, PUL_TOKEN_ID)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--expected-checkpoint-sha256", required=True)
    parser.add_argument("--midi-p", type=Path, required=True)
    parser.add_argument("--reference-samples", type=int, required=True)
    parser.add_argument("--target-samples", type=int, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    actual_checkpoint_sha = sha256_file(args.checkpoint)
    if actual_checkpoint_sha != args.expected_checkpoint_sha256.lower():
        raise ValueError(
            "V5-P checkpoint SHA256 mismatch: "
            f"{actual_checkpoint_sha} != {args.expected_checkpoint_sha256.lower()}"
        )
    midi_p = json.loads(args.midi_p.read_text(encoding="utf-8"))
    frame_map = build_frame_map(args.reference_samples, args.target_samples)
    transport = build_midi_class_transport(frame_map, midi_p.get("classes") or [])

    import torch

    payload = torch.load(
        args.checkpoint, map_location="cpu", weights_only=False, mmap=True
    )
    if payload.get("checkpoint_schema") != "v5p_training_checkpoint_v1":
        raise ValueError("checkpoint is not V5-P Phase-B schema")
    if int(payload.get("global_step", -1)) != 40000:
        raise ValueError("checkpoint is not V5-P step 40000")
    state = payload.get("ema_model_state_dict") or {}
    keys = [key for key in state if "midi_p_v4ph.embedding.weight" in key]
    if len(keys) != 1:
        raise ValueError(f"checkpoint P embedding key mismatch: {keys}")
    weight = state[keys[0]].detach().float()
    _, tensor_audit = embed_midi_transport(weight, transport)
    report = {
        "schema": "aisvc.v5p-direct-midi-tensor-audit.v1",
        "checkpointSHA256": actual_checkpoint_sha,
        "weightKey": keys[0],
        "frameMap": frame_map,
        "transport": {
            key: value for key, value in transport.items() if key != "classIds"
        },
        **tensor_audit,
        "midiPSource": str(args.midi_p.resolve()),
    }
    encoded = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n", encoding="utf-8")
    else:
        print(encoded)


if __name__ == "__main__":
    main()

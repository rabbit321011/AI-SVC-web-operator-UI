#!/usr/bin/env python3
"""Compile bounded SOFA/H candidates into B-local Kana and H controls."""

import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

import jaconv


FRAME_RATE = 44100 / 2048
SEP_TOKEN_ID = 365
PUL_TOKEN_ID = 366
SCHEMA = "aisvc.v5p-text-control.v1"


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--alignment", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--vocab", type=Path, required=True)
    parser.add_argument("--frame-count", type=int, required=True)
    return parser.parse_args()


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def frame_floor(seconds, frame_count):
    return max(0, min(frame_count, math.floor(float(seconds) * FRAME_RATE)))


def frame_ceil(seconds, frame_count):
    return max(0, min(frame_count, math.ceil(float(seconds) * FRAME_RATE)))


def phrase_frame_range(phrase, frame_count):
    if (
        phrase.get("sourceStartFrame") is not None
        and phrase.get("sourceEndFrameExclusive") is not None
    ):
        start = int(phrase["sourceStartFrame"])
        end = int(phrase["sourceEndFrameExclusive"])
    else:
        start = frame_floor(phrase["start"], frame_count)
        end = frame_ceil(phrase["end"], frame_count)
    if not 0 <= start < end <= frame_count:
        raise ValueError(
            f"phrase {phrase.get('id')} frame range {start}..{end} "
            f"is outside frameCount {frame_count}"
        )
    return start, end


def anchored_seconds(frame):
    # The training renderer floors phrase.start * frameRate. A quarter-frame
    # interior point preserves the exact integer anchor across float runtimes.
    return (int(frame) + 0.25) / FRAME_RATE


def normalize_mora_label(label):
    text = str(label).strip()
    if not text or text.upper() in {"AP", "SP", "PAU", "SIL"}:
        return ""
    return jaconv.kata2hira(text)


def compile_kana(region, frame_count, solve_monotonic_frames):
    units = []
    phrase_ranges = []
    audits = region["HAlignment"].get("phrase_audits") or []
    phrases = region.get("Phrases") or []
    if len(audits) != len(phrases):
        raise ValueError("phrase/audit count mismatch")

    for phrase_index, (phrase, audit) in enumerate(zip(phrases, audits)):
        start, end = phrase_frame_range(phrase, frame_count)
        crop_start = float(audit["cropStart"])
        word_tier = (
            audit.get("hAlignment", {}).get("used_word_tier")
            or audit.get("hAlignment", {}).get("model_word_tier")
            or []
        )
        moras = []
        for row in word_tier:
            kana = normalize_mora_label(row.get("phone"))
            if not kana:
                continue
            moras.append(
                {
                    "kana": kana,
                    "startSeconds": crop_start + float(row["start"]),
                    "endSeconds": crop_start + float(row["end"]),
                }
            )
        if not moras:
            raise ValueError(f"phrase {phrase_index} produced no SOFA mora tier")
        targets = [
            round(round(row["startSeconds"] * 1_000_000) * 44100 / (2048 * 1_000_000))
            for row in moras
        ]
        targets.append(end)
        placement = solve_monotonic_frames(
            targets,
            first_frame=start,
            lower_frame=start,
            upper_frame=end,
            priority_mask=[True] * len(targets),
        )
        boundaries = placement["frames"]
        for mora_index, row in enumerate(moras):
            units.append(
                {
                    "id": f"kana:{phrase['id']}:{mora_index}",
                    "kana": row["kana"],
                    "romaji": jaconv.kana2alphabet(row["kana"]),
                    "startFrame": boundaries[mora_index],
                    "endFrameExclusive": boundaries[mora_index + 1],
                    "origin": "segment-align",
                    "phraseId": phrase["id"],
                }
            )
        phrase_ranges.append(
            {
                "phraseId": phrase["id"],
                "startFrame": start,
                "speechEndFrameExclusive": end,
                "maxAbsShift": placement["max_abs_shift"],
            }
        )

    boundaries = [
        {
            "id": f"kana-seg:{index}",
            "frame": phrase_ranges[index + 1]["startFrame"],
            "kind": "SEG",
            "origin": "segment-align",
        }
        for index in range(len(phrase_ranges) - 1)
    ]
    return units, boundaries, phrase_ranges


def compile_h(region, frame_count, render_h_pul_placements, inverse_vocab):
    phrases = region.get("Phrases") or []
    candidates = region["HAlignment"].get("phrase_candidates") or []
    if len(phrases) != len(candidates):
        raise ValueError("phrase/candidate count mismatch")

    # A partial KanaTrack can already own a terminal SEG boundary even though
    # later Kana phrases have not been materialized. The training renderer
    # normally puts the last SEP at the end of its supplied dense timeline;
    # use the persisted terminal control boundary as that timeline horizon.
    dense_frame_count = int(frame_count)
    terminal_control_end = phrases[-1].get("controlEndFrameExclusive")
    if terminal_control_end is not None:
        terminal_control_end = int(terminal_control_end)
        if not 0 < terminal_control_end <= dense_frame_count:
            raise ValueError("terminal H control boundary escaped frame contract")
        if terminal_control_end < phrase_frame_range(phrases[-1], frame_count)[1]:
            raise ValueError("terminal H control boundary precedes phrase speech range")
        dense_frame_count = terminal_control_end

    # The authoritative renderer requires a non-empty A prefix. Rebuild every
    # phrase from its frozen integer B-local frame range, shift by one synthetic
    # frame, render with ref_len=1, then strip that frame.
    shifted_phrases = []
    for phrase in phrases:
        start, end = phrase_frame_range(phrase, frame_count)
        shifted_phrases.append(
            {
                **phrase,
                "start": anchored_seconds(start + 1),
                "end": anchored_seconds(end + 1),
            }
        )
    rendered = render_h_pul_placements(
        shifted_phrases,
        candidates,
        ref_len=1,
        total_frames=dense_frame_count + 1,
        sep_token_id=SEP_TOKEN_ID,
        pul_token_id=PUL_TOKEN_ID,
    )
    dense = rendered["phone_pul"]["text"][1:]
    if len(dense) != dense_frame_count:
        raise AssertionError("B-local H candidate horizon mismatch")

    phrase_modes = []
    event_attribution = {}
    rendered_phrases = rendered["phone_pul"].get("phrases") or []
    phrase_audits = region["HAlignment"].get("phrase_audits") or []
    for phrase_index, (phrase, candidate, placement) in enumerate(
        zip(phrases, candidates, rendered_phrases)
    ):
        phrase_id = str(phrase["id"])
        mode = str(placement.get("placement_mode") or "unknown")
        phrase_modes.append(
            {
                "phraseId": phrase_id,
                "placementMode": mode,
                "fallbackReason": placement.get("fallback_reason"),
            }
        )
        raw_sep_frame = placement.get("sep_frame")
        if raw_sep_frame is not None:
            sep_frame = int(raw_sep_frame) - 1
            if 0 <= sep_frame < frame_count:
                event_attribution[sep_frame] = {"phraseId": phrase_id}
        if mode != "phone" or phrase_index >= len(phrase_audits):
            continue

        h_alignment = phrase_audits[phrase_index].get("hAlignment") or {}
        phone_events = h_alignment.get("phone_events") or []
        lyric_tokens = [int(token) for token in phrase.get("tokens") or []]
        relative_frames = [int(frame) for frame in candidate.get("relative_frames") or []]
        if len(phone_events) != len(lyric_tokens) or len(relative_frames) < len(lyric_tokens):
            continue
        if [int(event.get("token_id", -1)) for event in phone_events] != lyric_tokens:
            continue
        start, _ = phrase_frame_range(phrase, frame_count)
        for phone_index, (phone_event, relative_frame) in enumerate(
            zip(phone_events, relative_frames)
        ):
            frame = start + relative_frame
            if not 0 <= frame < frame_count:
                raise AssertionError("attributed H phone escaped B-local frame contract")
            event_attribution[frame] = {
                "phraseId": phrase_id,
                "moraIndex": int(phone_event["mora_index"]),
                "phoneIndex": phone_index,
            }

    events = []
    for frame, token_id in enumerate(dense):
        token_id = int(token_id)
        if token_id == 0:
            continue
        if token_id == SEP_TOKEN_ID:
            symbol = "<SEP>"
        elif token_id == PUL_TOKEN_ID:
            symbol = "<PUL>"
        elif token_id in inverse_vocab:
            symbol = inverse_vocab[token_id]
        else:
            raise ValueError(f"rendered unknown runtime token ID {token_id}")
        event = {
            "id": f"h:{frame}:{token_id}",
            "frame": frame,
            "tokenId": token_id,
            "symbol": symbol,
            "origin": "segment-align",
        }
        event.update(event_attribution.get(frame) or {})
        events.append(event)
    return events, {
        "phonePhraseCount": rendered["phone_phrase_count"],
        "pulPhraseCount": rendered["pul_phrase_count"],
        "exactControlPhraseCount": rendered["exact_control_phrase_count"],
        "pulFrameCount": rendered["pul_frame_count"],
        "lockedEventTokenSHA256": rendered["locked_event_token_sha256"],
        "phraseModes": phrase_modes,
    }


def main():
    args = parse_args()
    if args.frame_count < 1:
        raise ValueError("frame-count must be positive")
    alignment = json.loads(args.alignment.read_text(encoding="utf-8"))
    if alignment.get("schema") != "aisvc.v4h-web-alignment.v1" or not alignment.get("B"):
        raise ValueError("expected a B-local bounded alignment")

    runtime = args.runtime.resolve()
    if not (runtime / "h_alignment" / "placement.py").is_file():
        raise FileNotFoundError(f"runtime root has no h_alignment/placement.py: {runtime}")
    sys.path.insert(0, str(runtime))
    from h_alignment.placement import render_h_pul_placements, solve_monotonic_frames

    vocab = json.loads(args.vocab.read_text(encoding="utf-8"))["vocab"]
    inverse_vocab = {int(raw_id) + 1: token for token, raw_id in vocab.items()}
    units, boundaries, phrase_ranges = compile_kana(
        alignment["B"], args.frame_count, solve_monotonic_frames
    )
    events, h_audit = compile_h(
        alignment["B"], args.frame_count, render_h_pul_placements, inverse_vocab
    )
    payload = {
        "schema": SCHEMA,
        "frameRate": FRAME_RATE,
        "frameCount": args.frame_count,
        "kanaUnits": units,
        "kanaBoundaries": boundaries,
        "phraseRanges": phrase_ranges,
        "hEvents": events,
        "hAudit": h_audit,
        "runtimeHashes": alignment.get("hashes"),
        "alignmentSummary": alignment.get("summary"),
        "compilerSHA256": sha256_file(Path(__file__)),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"type": "complete", "output": str(args.output), **h_audit}), flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(json.dumps({"type": "error", "message": str(error)}, ensure_ascii=False), flush=True)
        raise

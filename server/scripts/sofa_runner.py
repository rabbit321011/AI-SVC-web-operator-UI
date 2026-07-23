#!/usr/bin/env python3
import argparse
import json
import os
import pathlib
import sys


ALIGNMENT_METHOD = "SOFA_JPN_Test2_Plus_full_segment"
MODEL_ID = "Greenleaf2001/JPN_Test2_Plus"


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Align Japanese Whisper phrases with SOFA JPN_Test2_Plus."
    )
    parser.add_argument("--repo", type=pathlib.Path, required=True)
    parser.add_argument("--ckpt", type=pathlib.Path, required=True)
    parser.add_argument("--input", type=pathlib.Path, required=True)
    parser.add_argument("--transcript", type=pathlib.Path, required=True)
    parser.add_argument("--output-dir", type=pathlib.Path, required=True)
    parser.add_argument("--output-name", required=True)
    parser.add_argument("--device", default="cuda")
    return parser.parse_args()


def phrases_to_sofa_input(phrases, g2p):
    phonemes = ["SP"]
    words = []
    phoneme_to_word = [-1]
    for phrase in phrases:
        word = str(phrase.get("kana") or phrase.get("text") or "").strip()
        if not word:
            raise ValueError("Whisper phrase has no Japanese text")
        # JPN_Test2_Plus uses lowercase i/u for PyOpenJTalk's devoiced I/U.
        word_phonemes = [str(phoneme).lower() for phoneme in g2p(word, join=False)]
        if not word_phonemes:
            raise ValueError(f"PyOpenJTalk G2P returned no phonemes for {word!r}")
        word_index = len(words)
        words.append(word)
        for phoneme in word_phonemes:
            phoneme = "SP" if phoneme == "sp" else phoneme
            if phoneme == "SP" and phonemes[-1] == "SP":
                continue
            phonemes.append(phoneme)
            phoneme_to_word.append(-1 if phoneme == "SP" else word_index)
        if phonemes[-1] != "SP":
            phonemes.append("SP")
            phoneme_to_word.append(-1)
    return phonemes, words, phoneme_to_word


def validate_intervals(intervals, duration, expected_count, label="SOFA word"):
    if len(intervals) != expected_count:
        raise ValueError(f"{label} count mismatch: {len(intervals)} != {expected_count}")
    previous_end = -1.0
    for index, interval in enumerate(intervals):
        start = float(interval[0])
        end = float(interval[1])
        if start < -0.001 or end > duration + 0.05:
            raise ValueError(
                f"SOFA interval outside audio: {index}:{start:.3f}-{end:.3f}/{duration:.3f}"
            )
        if end <= start:
            raise ValueError(f"SOFA interval is not positive: {index}:{start:.3f}-{end:.3f}")
        if start < previous_end - 0.001:
            raise ValueError(f"{label} intervals overlap at index {index}")
        previous_end = end


def labeled_intervals(labels, intervals):
    return [
        {
            "label": str(label),
            "start": round(float(interval[0]), 3),
            "end": round(float(interval[1]), 3),
        }
        for label, interval in zip(labels, intervals)
    ]


def build_result(
    output_name,
    phrases,
    duration,
    confidence,
    output_words,
    output_word_intervals,
    output_phonemes,
    phoneme_intervals,
):
    word_pairs = [
        (label, interval)
        for label, interval in zip(output_words, output_word_intervals)
        if str(label) not in {"AP", "SP"}
    ]
    validate_intervals(
        [interval for _, interval in word_pairs],
        float(duration),
        len(phrases),
        "SOFA word",
    )
    validate_intervals(
        phoneme_intervals,
        float(duration),
        len(output_phonemes),
        "SOFA phone",
    )
    words = labeled_intervals(
        [label for label, _ in word_pairs],
        [interval for _, interval in word_pairs],
    )
    segments = []
    aligned_phrases = []
    for index, (phrase, word) in enumerate(zip(phrases, words)):
        aligned_phrase = {
            "id": str(phrase.get("id") or f"phrase:whisper:{index}"),
            "text": str(phrase.get("text") or ""),
            "kana": str(phrase.get("kana") or phrase.get("text") or ""),
            "romaji": str(phrase.get("romaji") or ""),
            "start": word["start"],
            "end": word["end"],
        }
        aligned_phrases.append(aligned_phrase)
        segments.append(
            {
                "id": f"textseg:sofa:{index}",
                "start": aligned_phrase["start"],
                "end": aligned_phrase["end"],
                "kana": aligned_phrase["kana"],
                "romaji": aligned_phrase["romaji"],
                "alignmentMethod": ALIGNMENT_METHOD,
            }
        )
    return {
        "alignmentMethod": ALIGNMENT_METHOD,
        "model": MODEL_ID,
        "confidence": round(float(confidence), 6),
        "duration": round(float(duration), 6),
        "phrases": aligned_phrases,
        "words": words,
        "phones": labeled_intervals(output_phonemes, phoneme_intervals),
        "textObject": {
            "kind": "text",
            "name": output_name,
            "text": {
                "sourceAudioObjectId": None,
                "segments": segments,
            },
        },
    }


def load_audio_with_librosa(path, device, sample_rate=None):
    import librosa
    import torch

    waveform, _ = librosa.load(path, sr=sample_rate, mono=True)
    return torch.from_numpy(waveform).to(device)


def main():
    args = parse_args()
    if not args.input.is_file():
        emit({"type": "error", "message": f"input wav not found: {args.input}"})
        return 1
    if not args.transcript.is_file():
        emit({"type": "error", "message": f"Whisper transcript not found: {args.transcript}"})
        return 1
    if not args.ckpt.is_file():
        emit({"type": "error", "message": f"JPN_Test2_Plus checkpoint not found: {args.ckpt}"})
        return 1
    sofa_source = args.repo / "src" / "SOFA"
    if not sofa_source.is_dir():
        emit({"type": "error", "message": f"Voicebank2DiffSinger SOFA source not found: {sofa_source}"})
        return 1

    with args.transcript.open("r", encoding="utf-8") as file:
        transcript = json.load(file)
    if transcript.get("language") != "ja":
        emit({"type": "error", "message": "SOFA JPN_Test2_Plus only accepts Japanese transcripts"})
        return 1
    phrases = transcript.get("phrases") or []
    if not phrases:
        emit({"type": "error", "message": "Whisper transcript contains no phrases"})
        return 1

    try:
        import pyopenjtalk
        import torch

        sys.path.insert(0, str(sofa_source))
        from modules.task import forced_alignment
        import modules.AP_detector.loudnesss_pectralcentroid_detector as ap_detector_module
        import modules.utils.load_wav as sofa_load_wav
        from modules.utils.post_processing import add_SP, fill_small_gaps

        sofa_load_wav.installed_torchaudio = False
        forced_alignment.load_wav = load_audio_with_librosa
        ap_detector_module.load_wav = load_audio_with_librosa

        emit({"type": "log", "stage": "sofa", "message": f"Loading {MODEL_ID}..."})
        emit({"type": "progress", "stage": "sofa", "progress": 8})
        model = forced_alignment.LitForcedAlignmentTask.load_from_checkpoint(
            str(args.ckpt), map_location=args.device
        )
        model.set_inference_mode("force")
        model.eval()
        model.freeze()
        model.to(torch.device(args.device))
        model.on_predict_start()

        # One predict_step receives the complete WAV and every Whisper phrase in order.
        phonemes, words, phoneme_to_word = phrases_to_sofa_input(phrases, pyopenjtalk.g2p)
        emit({"type": "log", "stage": "sofa", "message": "Aligning the complete audio segment..."})
        emit({"type": "progress", "stage": "sofa", "progress": 30})
        with torch.inference_mode():
            prediction = model.predict_step(
                (args.input, phonemes, words, phoneme_to_word), 0
            )
        ap_detector = ap_detector_module.LoudnessSpectralcentroidAPDetector()
        prediction = ap_detector.process([prediction])[0]
        (
            _,
            duration,
            confidence,
            output_phonemes,
            phoneme_intervals,
            output_words,
            output_word_intervals,
        ) = prediction
        output_words, output_word_intervals = fill_small_gaps(
            output_words, output_word_intervals, duration
        )
        output_phonemes, phoneme_intervals = fill_small_gaps(
            output_phonemes, phoneme_intervals, duration
        )
        output_words, output_word_intervals = add_SP(
            output_words, output_word_intervals, duration
        )
        output_phonemes, phoneme_intervals = add_SP(
            output_phonemes, phoneme_intervals, duration
        )
        result = build_result(
            args.output_name,
            phrases,
            duration,
            confidence,
            output_words,
            output_word_intervals,
            output_phonemes,
            phoneme_intervals,
        )
    except Exception as exc:
        emit({"type": "error", "message": f"SOFA JPN_Test2_Plus alignment failed: {exc}"})
        return 1

    args.output_dir.mkdir(parents=True, exist_ok=True)
    output_path = args.output_dir / f"{args.output_name}.json"
    with output_path.open("w", encoding="utf-8") as file:
        json.dump(result, file, ensure_ascii=False, indent=2)
    emit({"type": "progress", "stage": "sofa", "progress": 95})
    emit({"type": "result", **result, "outputFile": str(output_path)})
    emit({"type": "done", "alignmentMethod": ALIGNMENT_METHOD, "outputFile": str(output_path)})
    return 0


if __name__ == "__main__":
    sys.exit(main())

import json
import sys

import librosa
import numpy as np


def voiced_midi(path: str) -> np.ndarray:
    y, sr = librosa.load(path, sr=None, mono=True, duration=90.0)
    hop_length = max(1, int(sr * 0.032))
    f0, _, voiced_prob = librosa.pyin(
        y,
        fmin=65.4,
        fmax=2093.0,
        sr=sr,
        hop_length=hop_length,
    )
    mask = np.isfinite(f0) & (voiced_prob >= 0.6)
    frequencies = f0[mask]
    if frequencies.size < 30:
        raise ValueError(f"not enough voiced frames: {frequencies.size}")
    return 69.0 + 12.0 * np.log2(frequencies / 440.0)


def pitch_class_shift(reference: np.ndarray, target: np.ndarray) -> tuple[int, float]:
    bins = np.arange(13)
    ref_hist, _ = np.histogram(np.mod(reference, 12.0), bins=bins)
    target_hist, _ = np.histogram(np.mod(target, 12.0), bins=bins)
    ref_hist = ref_hist / max(1, ref_hist.sum())
    target_hist = target_hist / max(1, target_hist.sum())
    scores = []
    for shift in range(-6, 6):
        score = float(np.dot(ref_hist, np.roll(target_hist, shift)))
        scores.append((score, shift))
    score, shift = max(scores)
    return shift, score


def compare(reference_path: str, target_path: str) -> dict:
    reference = voiced_midi(reference_path)
    target = voiced_midi(target_path)
    median_difference = float(np.median(reference) - np.median(target))
    class_shift, class_score = pitch_class_shift(reference, target)
    octave = round((median_difference - class_shift) / 12.0)
    suggested = int(np.clip(class_shift + octave * 12, -24, 24))
    return {
        "referenceMedianMidi": round(float(np.median(reference)), 3),
        "targetMedianMidi": round(float(np.median(target)), 3),
        "suggestedTargetShift": suggested,
        "suggestedReferenceShift": -suggested,
        "referenceVoicedFrames": int(reference.size),
        "targetVoicedFrames": int(target.size),
        "pitchClassScore": round(class_score, 4),
    }


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(json.dumps({"error": "usage: pitch_compare.py <reference.wav> <target.wav>"}))
        sys.exit(1)
    try:
        print(json.dumps(compare(sys.argv[1], sys.argv[2])))
    except Exception as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(1)

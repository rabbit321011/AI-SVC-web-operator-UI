import sys
import json
import numpy as np
import librosa

def extract_f0(wav_path: str, hop_ms: float = 16.0, fmin: float = 65.4, fmax: float = 2093.0,
               start_sec: float | None = None, end_sec: float | None = None) -> list:
    y, sr = librosa.load(wav_path, sr=None, mono=True, offset=start_sec or 0.0,
                         duration=None if end_sec is None else end_sec - (start_sec or 0))

    hop_length = int(sr * hop_ms / 1000)

    f0, voiced_flag, voiced_prob = librosa.pyin(
        y,
        fmin=fmin,
        fmax=fmax,
        sr=sr,
        hop_length=hop_length,
    )

    time_offset = start_sec or 0.0
    frames = []
    for i in range(len(f0)):
        t = time_offset + i * hop_length / sr
        freq = float(f0[i]) if (f0[i] is not None and not np.isnan(f0[i])) else 0.0
        prob = float(voiced_prob[i]) if voiced_prob[i] is not None else 0.0
        frames.append({"t": round(t, 6), "freq": round(freq, 3), "prob": round(prob, 4)})

    return frames, sr, hop_length

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: python f0_extract.py <wav_path> [hop_ms] [--start S] [--end E]"}))
        sys.exit(1)

    wav_path = sys.argv[1]
    hop_ms = 16.0
    start_sec = None
    end_sec = None

    i = 2
    while i < len(sys.argv):
        if sys.argv[i] == '--start' and i + 1 < len(sys.argv):
            start_sec = float(sys.argv[i + 1])
            i += 2
        elif sys.argv[i] == '--end' and i + 1 < len(sys.argv):
            end_sec = float(sys.argv[i + 1])
            i += 2
        else:
            hop_ms = float(sys.argv[i])
            i += 1

    try:
        frames, sr, hop_len = extract_f0(wav_path, hop_ms=hop_ms, start_sec=start_sec, end_sec=end_sec)
        result = {"data": frames, "hop_ms": hop_ms, "sr": sr, "hop_length": hop_len, "file": wav_path}
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

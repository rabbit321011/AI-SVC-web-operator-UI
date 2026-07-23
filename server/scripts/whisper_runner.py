import argparse
import json
import os
import sys
import wave


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def wav_duration(path):
    try:
        with wave.open(path, "rb") as wav:
            frames = wav.getnframes()
            rate = wav.getframerate() or 44100
            return max(0.1, frames / rate)
    except Exception:
        return 1.0


def to_kana_and_romaji(text):
    try:
        import jaconv
        from sudachipy import Dictionary, SplitMode

        tokenizer = Dictionary(dict="full").create()
        pieces = []
        for token in tokenizer.tokenize(text, SplitMode.C):
            reading = token.reading_form()
            pieces.append(reading if reading != "*" else token.surface())
        kana = jaconv.kata2hira("".join(pieces))
        romaji = space_romaji(jaconv.kana2alphabet(kana))
        return kana, romaji
    except Exception:
        return text, ""


def space_romaji(text):
    vowels = "aeiou"
    chunks = []
    current = ""
    for char in text:
        current += char
        if char in vowels or char in "|,.;:!?！？、。":
            chunks.append(current)
            current = ""
    if current:
        chunks.append(current)
    return " ".join(chunk for chunk in chunks if chunk)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--output-name", required=True)
    parser.add_argument("--language", default="auto")
    parser.add_argument("--vad", default="true")
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--compute-type", default="float16")
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel
    except Exception as exc:
        emit({"type": "error", "message": f"faster-whisper unavailable: {exc}"})
        return 1

    if not os.path.exists(args.input):
        emit({"type": "error", "message": f"input wav not found: {args.input}"})
        return 1

    os.makedirs(args.output_dir, exist_ok=True)
    emit({"type": "log", "message": "Loading faster-whisper large-v3..."})
    emit({"type": "progress", "progress": 8})

    model_name = os.environ.get("AISVC_WHISPER_MODEL", "Systran/faster-whisper-large-v3")
    model = WhisperModel(model_name, device=args.device, compute_type=args.compute_type)

    emit({"type": "log", "message": "Transcribing audio..."})
    emit({"type": "progress", "progress": 20})
    language = None if args.language == "auto" else args.language
    segments, _info = model.transcribe(
        args.input,
        language=language,
        beam_size=1,
        vad_filter=args.vad.lower() != "false",
    )

    raw_segments = list(segments)
    raw_text = "".join(segment.text.strip() for segment in raw_segments).strip()
    emit({"type": "progress", "progress": 78})
    emit({"type": "log", "message": "Converting reading to kana/romaji..."})
    kana, romaji = to_kana_and_romaji(raw_text)
    duration = wav_duration(args.input)

    text_object = {
        "kind": "text",
        "name": args.output_name,
        "text": {
            "sourceAudioObjectId": None,
            "segments": [
                {
                    "id": "textseg:whisper:0",
                    "start": 0,
                    "end": duration,
                    "kana": kana,
                    "romaji": romaji,
                }
            ],
        },
    }

    output_path = os.path.join(args.output_dir, f"{args.output_name}.json")
    with open(output_path, "w", encoding="utf-8") as file:
        json.dump(text_object, file, ensure_ascii=False, indent=2)

    emit({"type": "progress", "progress": 95})
    emit({"type": "result", "textObject": text_object, "outputFile": output_path})
    emit({"type": "done", "outputFile": output_path})
    return 0


if __name__ == "__main__":
    sys.exit(main())

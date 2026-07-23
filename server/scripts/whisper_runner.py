import argparse
import json
import os
import sys


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def to_kana_and_romaji(text):
    text = normalize_japanese_phrase(text)
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


def normalize_japanese_phrase(text):
    return "".join(str(text).split())


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


def build_transcript(raw_segments, detected_language, converter=to_kana_and_romaji):
    phrases = []
    for segment in raw_segments:
        text = normalize_japanese_phrase(getattr(segment, "text", ""))
        if not text:
            continue
        kana, romaji = converter(text)
        phrases.append(
            {
                "id": f"phrase:whisper:{len(phrases)}",
                "text": text,
                "kana": kana,
                "romaji": romaji,
            }
        )
    if not phrases:
        raise ValueError("Whisper returned no Japanese phrases")
    return {
        "language": detected_language,
        "text": "".join(phrase["text"] for phrase in phrases),
        "phrases": phrases,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--output-name", required=True)
    parser.add_argument("--language", choices=["ja"], default="ja")
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
    segments, info = model.transcribe(
        args.input,
        language="ja",
        beam_size=1,
        vad_filter=args.vad.lower() != "false",
    )

    raw_segments = list(segments)
    detected_language = getattr(info, "language", "ja") or "ja"
    if detected_language != "ja":
        emit({"type": "error", "message": f"Japanese transcription required, detected: {detected_language}"})
        return 1
    emit({"type": "progress", "progress": 78})
    emit({"type": "log", "message": "Preparing Japanese phrase readings for SOFA..."})
    try:
        transcript = build_transcript(raw_segments, detected_language)
    except Exception as exc:
        emit({"type": "error", "message": f"Japanese phrase reading conversion failed: {exc}"})
        return 1

    output_path = os.path.join(args.output_dir, f"{args.output_name}.whisper.json")
    with open(output_path, "w", encoding="utf-8") as file:
        json.dump(transcript, file, ensure_ascii=False, indent=2)

    emit({"type": "progress", "progress": 95})
    emit({"type": "transcript", "transcript": transcript, "transcriptFile": output_path})
    emit({"type": "stage_done", "stage": "whisper", "transcriptFile": output_path})
    return 0


if __name__ == "__main__":
    sys.exit(main())

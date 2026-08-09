import argparse
import gc
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path


MSST_ROOT = Path(r"E:\MyProject\cyanAI\nodeServer\src\utility\MSST\msst_webui")
MODELS = {
    "duality": {
        "id": "duality",
        "model": "pretrain/vocal_models/melband_roformer_instvox_duality_v2.ckpt",
        "config": "configs/vocal_models/melband_roformer_instvox_duality_v2.ckpt.yaml",
        "outputs": {"Vocals": "vocals", "Instrumental": "instrumental"},
    },
    "dereverb": {
        "id": "dereverb",
        "model": "pretrain/single_stem_models/dereverb_echo_mbr_fused_0.5_v2_0.25_big_0.25_super.ckpt",
        "config": "configs/single_stem_models/dereverb_echo_mbr_fused_0.5_v2_0.25_big_0.25_super.ckpt.yaml",
        "outputs": {"dry": "dry", "other": "other"},
    },
    "denoise": {
        "id": "denoise",
        "model": "pretrain/single_stem_models/denoise_mel_band_roformer_aufr33_sdr_27.9959.ckpt",
        "config": "configs/single_stem_models/denoise_mel_band_roformer_aufr33_sdr_27.9959.ckpt.yaml",
        "outputs": {"dry": "dry", "other": "other"},
    },
}


def emit(event_type, **payload):
    print("MSST_EVENT " + json.dumps({"type": event_type, **payload}, ensure_ascii=False), flush=True)


def find_output(directory, input_stem, instrument):
    expected = f"{input_stem}_{instrument}.wav".lower()
    matches = [p for p in directory.glob("*.wav") if p.name.lower() == expected]
    if not matches:
        raise RuntimeError(f"MSST did not produce {input_stem}_{instrument}.wav")
    return matches[0]


def run_model(model_id, input_wav, output_dir, device):
    sys.path.insert(0, str(MSST_ROOT))
    os.chdir(MSST_ROOT)
    from inference.msst_infer import MSSeparator

    output_dir.mkdir(parents=True, exist_ok=True)
    saved = {}
    step = MODELS[model_id]

    with tempfile.TemporaryDirectory(prefix="aisvc_msst_") as temp_root:
        temp_root = Path(temp_root)
        stage_input = temp_root / "input"
        stage_output = temp_root / "output"
        stage_input.mkdir()
        stage_output.mkdir()
        local_input = stage_input / "input.wav"
        shutil.copy2(input_wav, local_input)
        emit("progress", progress=0, stage=model_id)

        separator = MSSeparator(
            model_type="mel_band_roformer",
            config_path=str(MSST_ROOT / step["config"]),
            model_path=str(MSST_ROOT / step["model"]),
            device=device,
            device_ids=[0],
            output_format="wav",
            use_tta=False,
            store_dirs=str(stage_output),
        )
        try:
            emit("progress", progress=15, stage=model_id)
            separator.process_folder(str(stage_input))
            for instrument, result_id in step["outputs"].items():
                source = find_output(stage_output, local_input.stem, instrument)
                destination = output_dir / f"{result_id}.wav"
                shutil.copy2(source, destination)
                saved[result_id] = str(destination)
        finally:
            separator.del_cache()
            del separator
            gc.collect()

    emit("progress", progress=100, stage="complete")
    emit("result", outputs=saved)


def run_folder(model_id, input_dir, output_dir, device, output_only=None):
    sys.path.insert(0, str(MSST_ROOT))
    os.chdir(MSST_ROOT)
    from inference.msst_infer import MSSeparator

    input_files = sorted(input_dir.glob("*.wav"))
    if not input_files:
        raise RuntimeError("MSST batch input directory has no WAV files")
    output_dir.mkdir(parents=True, exist_ok=True)
    step = MODELS[model_id]

    with tempfile.TemporaryDirectory(prefix="aisvc_msst_batch_") as temp_root:
        stage_output = Path(temp_root) / "output"
        stage_output.mkdir()
        separator = MSSeparator(
            model_type="mel_band_roformer",
            config_path=str(MSST_ROOT / step["config"]),
            model_path=str(MSST_ROOT / step["model"]),
            device=device,
            device_ids=[0],
            output_format="wav",
            use_tta=False,
            store_dirs=str(stage_output),
        )
        try:
            emit("progress", progress=5, stage=model_id, files=len(input_files))
            separator.process_folder(str(input_dir))
            saved = {}
            for index, input_file in enumerate(input_files, start=1):
                for instrument, result_id in step["outputs"].items():
                    if output_only and result_id != output_only:
                        continue
                    source = find_output(stage_output, input_file.stem, instrument)
                    destination = output_dir / f"{input_file.stem}.{result_id}.wav"
                    shutil.copy2(source, destination)
                    saved[f"{input_file.stem}:{result_id}"] = str(destination)
                emit("progress", progress=90 + round(index / len(input_files) * 10), stage="copy", file=input_file.name)
        finally:
            separator.del_cache()
            del separator
            gc.collect()

    emit("progress", progress=100, stage="complete")
    emit("result", outputs=saved)


def main():
    parser = argparse.ArgumentParser(description="AISVC single-model MSST runner")
    parser.add_argument("--model", choices=sorted(MODELS), required=True)
    input_group = parser.add_mutually_exclusive_group(required=True)
    input_group.add_argument("--input")
    input_group.add_argument("--input-dir")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cuda")
    parser.add_argument("--output-only", choices=["vocals", "instrumental", "dry", "other"])
    args = parser.parse_args()

    output_dir = Path(args.output_dir).resolve()
    if args.input_dir:
        input_dir = Path(args.input_dir).resolve()
        if not input_dir.is_dir():
            raise FileNotFoundError(f"Input directory does not exist: {input_dir}")
        run_folder(args.model, input_dir, output_dir, args.device, args.output_only)
    else:
        input_wav = Path(args.input).resolve()
        if not input_wav.is_file():
            raise FileNotFoundError(f"Input WAV does not exist: {input_wav}")
        run_model(args.model, input_wav, output_dir, args.device)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit("error", message=str(error))
        raise

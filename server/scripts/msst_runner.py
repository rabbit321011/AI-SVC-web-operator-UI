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


def main():
    parser = argparse.ArgumentParser(description="AISVC single-model MSST runner")
    parser.add_argument("--model", choices=sorted(MODELS), required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cuda")
    args = parser.parse_args()

    input_wav = Path(args.input).resolve()
    if not input_wav.is_file():
        raise FileNotFoundError(f"Input WAV does not exist: {input_wav}")
    run_model(args.model, input_wav, Path(args.output_dir).resolve(), args.device)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit("error", message=str(error))
        raise

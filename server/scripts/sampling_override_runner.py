#!/usr/bin/env python3
"""Run an SVS evaluation script with auditable sampling-only overrides."""

import argparse
import json
import os
from pathlib import Path
import runpy
import sys


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runner", type=Path, required=True)
    parser.add_argument("--singer-root", type=Path, required=True)
    parser.add_argument(
        "--solver", choices=("euler", "midpoint", "rk4", "dopri5"), required=True
    )
    parser.add_argument("--t-shift", type=float, required=True)
    parser.add_argument("--report-latent-stats", action="store_true")
    parser.add_argument("runner_args", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.runner_args[:1] == ["--"]:
        args.runner_args = args.runner_args[1:]
    return args


def main():
    args = parse_args()
    singer_root = args.singer_root.resolve()
    runner = args.runner.resolve()
    sys.path.insert(0, str(singer_root))
    os.chdir(singer_root)

    from src.YingMusicSinger.models.model import Singer

    original_sample = Singer.sample

    def sample_with_overrides(self, *sample_args, **sample_kwargs):
        self.odeint_kwargs = {"method": args.solver}
        sample_kwargs["t_shift"] = args.t_shift
        result = original_sample(self, *sample_args, **sample_kwargs)
        if args.report_latent_stats:
            sampled = result[0].detach().float()
            lens = sample_kwargs.get("lens")
            cond = sample_kwargs.get("cond")
            start = int(lens[0].item()) if lens is not None else int(cond.shape[1])
            target = sampled[:, start:, :]
            absolute = target.abs().reshape(-1)
            delta = target[:, 1:, :] - target[:, :-1, :]
            print(
                json.dumps(
                    {
                        "type": "latent_stats",
                        "targetFrames": int(target.shape[1]),
                        "mean": float(target.mean().item()),
                        "std": float(target.std().item()),
                        "p99Abs": float(absolute.quantile(0.99).item()),
                        "p999Abs": float(absolute.quantile(0.999).item()),
                        "maxAbs": float(absolute.max().item()),
                        "over3Rate": float((absolute > 3).float().mean().item()),
                        "deltaStd": float(delta.std().item()),
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )
        return result

    Singer.sample = sample_with_overrides
    print(
        json.dumps(
            {
                "type": "sampling_override",
                "solver": args.solver,
                "tShift": args.t_shift,
                "runner": str(runner),
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    sys.argv = [str(runner), *args.runner_args]
    runpy.run_path(str(runner), run_name="__main__")


if __name__ == "__main__":
    main()

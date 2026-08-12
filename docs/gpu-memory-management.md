# GPU 显存管理设计与使用说明

## 当前版本

当前版本已经提供 GPU 状态中心和本应用 GPU 任务登记：

- 顶栏显示第一张 GPU 的已用 / 总显存；
- 点击显存状态可以打开显存页面；
- 显存页面列出所有已配置的 SVS preset，包括 T1、V4H/V4Hg 和 `V5P_40K_EMA`；
- 页面显示本应用启动的 GPU 子进程、PID、模型、设备和 `nvidia-smi` 可见的进程显存；
- 用户可以取消并释放单个任务，也可以释放本应用的全部 GPU 任务；
- 外部程序只显示在 GPU 总量中，不由软件结束。

现阶段 V5-P 已支持常驻 Runtime：用户可以在显存页手动“加载模型”，DiT 与 VAE 保留在独立 worker 中；加载后重复生成不再重新读取 checkpoint。其余 SVS/GAME/Whisper/SOFA/SVC/MSST 仍是一次一进程 Runtime，任务完成后进程退出，显存随进程释放。

## 模型范围

显存系统当前只管理三个模型：

- Direct Control：`V5P_40K_EMA`
- PH/PUL：`V4Hg_10k`
- T1：`V4fg_10k`

旧 SVS 面板中的其他模型仍保留运行能力，但不进入显存管理页。checkpoint 文件大小不等于显存占用。

2026-08-12 常驻显存实测：

- `V5P_40K_EMA`：2354 MiB
- `V4fg_10k`：2810 MiB
- `V4Hg_10k`：2810 MiB

## 自动 / 手动模式

显存页提供“手动”和“自动”两种模式：

- 手动模式：显存不足时弹窗，提供“强制运行 / 删除最久未使用 / 取消运行”。
- 自动模式：显存不足时静默按 LRU 删除其他模型，不打扰用户；删除后仍不足才弹最终警告。
- LRU 的“更新”指模型被加载或被执行任务。
- 驱逐时不会删除当前要使用的模型；释放可回收该模型的 resident 显存。

任务显存估算使用最接近的已标定时长：优先取大于任务时长且最小的一次标定；没有更大标定时取最大标定。模型未加载时还需要额外加入常驻显存。

标定语义：`任务增量 = 整卡峰值 - 未加载基线 - resident`。已加载模型需要 `任务增量`；未加载模型需要 `resident + 任务增量`。这样不会把 resident 重复计算。

## 释放规则

“取消并释放”会结束本应用创建的 Python 进程树。它适用于正在运行的临时 Runtime，可能丢失当前未完成输出，因此需要确认。任务完成、失败或取消后，登记会短暂保留，随后清理。“释放模型”会关闭常驻 V5-P worker，正在执行的推理会被取消。

用户从显存页终止任务后，服务端向原任务返回“用户已取消 GPU 任务并释放显存”。V5-P 合成单元中的占位 Take 保留为 `cancelled`，与模型执行失败的 `failed` 状态分开。

V5-P 常驻 worker 使用 JSONL 协议；显存页展示 `ready/busy/loading/releasing/error` 状态、PID 和 torch reserved 统计。释放操作关闭对应 worker，而不是只调用 `torch.cuda.empty_cache()`。正在执行的 worker 必须先完成、排队释放，或者由用户显式取消。

## 显存标定

不要用 checkpoint 字节数估算 VRAM。推荐使用真实项目音频裁切 3、10、30 秒样本，并记录：

1. runner 启动前 GPU 使用量；
2. 加载模型后的显存；
3. 输入长度对应的推理峰值；
4. 任务结束后的显存。

`server/scripts/profile_vram.py` 提供统一的外部测量包装器。示例：

```powershell
python server/scripts/profile_vram.py `
  --model-id V5P_40K_EMA `
  --input E:/path/to/real.wav `
  --sample-dir data/vram-profile/samples `
  --output data/vram-profile/V5P_40K_EMA.json `
  --sample-command python my_runner.py --input {input}
```

实际模型 runner 的参数仍由对应 preset 决定。标定输出使用 `aisvc.gpu-vram-profile.v1`，结果属于本机，不提交到项目仓库；实测数据应放在本机的 profile 目录并在 UI 显示“本机实测”。

界面中的“峰值增量”按 `推理期间整卡已用峰值 - 启动前整卡已用基线` 计算；整卡峰值仍保留在原始 profile 中。2026-08-12 的 `V5P_40K_EMA` 3 秒、1-step 标定为：基线 1819 MiB、整卡峰值 5506 MiB、峰值增量 3687 MiB、结束后 1828 MiB。

2026-08-12 三个受管模型的 20 步实测：

- `V5P_40K_EMA` 60 秒：基线 1216 MiB、整卡峰值 11585 MiB、峰值增量 10369 MiB、结束后 1055 MiB；12 GB 卡空余仅 272 MiB，接近容量上限。
- `V4fg_10k` 3 秒：基线 1020 MiB、整卡峰值 5441 MiB、峰值增量 4421 MiB、结束后 1206 MiB。
- `V4Hg_10k` 3 秒：基线 1328 MiB、整卡峰值 5344 MiB、峰值增量 4016 MiB、结束后 1293 MiB。
- `GAME-1.0-medium` 3 秒 MIDI-P：峰值增量 458 MiB。

2026-08-12 工具模型 30s / 60s / 120s / 180s 整卡峰值：

- `GAME-1.0-medium`：1703 / 2100 / 3813 / 6376 MiB。
- `MSST_duality`：5988 / 5996 / 5988 / 5995 MiB，基本不随时长增长。
- `SVC_v3_20k_campplus`（20 步）：3892 / 3943 / 4689 / 5429 MiB。
- `Whisper large-v3`：4746 / 4728 / 4754 / 4787 MiB，基本不随时长增长。
- `SOFA Japanese`：1578 / 1748 / 1793 / 1932 MiB。

常驻 Runtime 实测：显存页加载约 26 秒后进入 `ready`，torch reserved 约 2.3 GB；第一次 1-step 推理约 20 秒，第二次复用常驻模型约 3 秒；运行中释放后 GPU 回落至约 1.85 GB，无残留 Python 进程。标定工具支持 `{input}`、`{seconds}` 和 `{sha256}` 占位符。

## 后续常驻 Runtime

下一阶段新增 `GpuRuntimeManager` worker 层：

```text
ModelCatalog -> GpuRuntimeManager -> worker(JSONL/IPC) -> Python model
```

每个模型 preset 都拥有独立 runtime identity；V5-P 的 DiT 与 VAE作为一个单元，T1/V4H 以及不同 checkpoint 不能因为名字相似而共享错误权重。显存不足时只提示可释放对象，由用户决定，不自动驱逐模型。

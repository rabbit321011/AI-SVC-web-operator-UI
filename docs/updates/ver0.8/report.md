# AISVC-midi-web ver0.8 落地报告

> 版本：ver0.8  
> 状态：SOFA 日语转录、SVS A/B 双区 T1 与 V4fg 285k online VAE 已完成落地和真实运行验证  
> 日期：2026-07-23  
> 实施前备份提交：`26c5f5b chore: backup worktree before SOFA and T1 integration`

---

## 1. 本版本结论

本版本完成两条原先缺失的正式链路：

1. 日语 TextObject 不再直接采用 Whisper 时间戳，而是固定走 `Whisper -> SOFA JPN_Test2_Plus -> TextObject`。
2. SVS 不再把整段歌词作为单个 T0 条件，而是要求 A 参考区和 B 目标区各自提供带时间戳的 TextObject，并在两区都执行 T1 token 放置。

V4fg 10k 同时固定绑定服务器导出的 285k online VAE。SOFA、VAE 和 V4fg 权重均保留在项目仓库之外；仓库只保存协议、路径配置、校验逻辑和测试。

---

## 2. Whisper -> SOFA Plus -> TextObject

正式日语转录链路如下：

```text
音频
  -> faster-whisper 日语转写
  -> 按顺序保留 text / kana / romaji，丢弃 Whisper 粗时间戳
  -> 完整音频 + 全部短语一次性送入 SOFA
  -> Greenleaf2001 JPN_Test2_Plus 强制对齐
  -> words + phones 两层时间结果
  -> 带 start/end 的 TextObject segments
```

关键约束：

- SOFA 输入始终是完整音频段和该段内全部短语，不按 Whisper 或 A7 粗边界预切句。
- 日语 G2P 使用 `pyopenjtalk-plus`；清化元音 `I/U` 在送入模型前统一 `.lower()` 为 `i/u`。
- Whisper 只负责短语内容与顺序，SOFA 是最终时间边界的唯一来源。
- `sofa_runner.py` 输出 `phrases`、`words`、`phones` 和 `textObject`；每个 Text segment 标记 `SOFA_JPN_Test2_Plus_full_segment`。
- 客户端只接受该 alignment method 且要求区间正值、单调；SOFA 失败时不静默回退为 Whisper 时间轴。
- 当前链路只接受 `language=ja`。

后端通过独立 runner 串联两阶段：Whisper 使用应用 venv，SOFA 使用隔离的 Plus GPU venv。启动日志已经验证正式进程实际使用的 Python、repo、checkpoint 和 `--device cuda` 路径，而不是仅依赖文档约定。

---

## 3. SVS A/B 双区 T1

### 3.1 输入协议

SVS 面板现在要求两个带时间戳的文本输入：

- A 参考文本：对应 timbre/reference audio。
- B 目标文本：对应 melody/target audio。

手写单字符串不再满足正式 T1 输入。`resolveTextRenderInput()` 从 TextObject/TrackObject/GroupObject 解析每句，随后按各自合并音频的起点重定位时间。句子起止超出对应音频范围时直接失败。

前后端使用同一份 manifest 协议：

```json
{
  "schema": "yingmusic.svs-t1.v1",
  "refPhrases": [{ "start": 0.0, "end": 1.2, "text": "..." }],
  "targetPhrases": [{ "start": 0.0, "end": 1.3, "text": "..." }]
}
```

dryRun 可验证参数、两区短语、model preset、checkpoint/VAE 文件存在性和 285k VAE SHA-256。客户端 dryRun 不合并或上传临时 WAV，服务端也不落盘 T1 manifest 或输出；真实执行才写入与输出 WAV 同名的 `.t1.json` sidecar。

### 3.2 token 放置

`t1_alignment.py` 对 A、B 两区使用同一套句级放置逻辑：

- 每句在 `start * (44100 / 2048)` 对应的 VAE frame 请求放置。
- 每句 token 后加入 `<SEP>=365`。
- A 句位于参考内容区；B 句以 `encoded_ref_frames` 为基址进入目标区。
- 0.5 秒 reference tail 仍保留在编码参考区，B 区从该 tail 之后开始。
- token 与前句冲突时顺延，并记录 requested/actual frame 和 postponed audit。
- A 边界不足时可记录截断；B token 溢出总帧范围时硬失败，避免静默破坏目标歌词。

真实 CUDA smoke 中 A 首句落在 frame 0，B 首句落在 frame 49；A、B 两区均检测到 `<SEP>`，证明不是只给 B 区做 T1。

---

## 4. 生产资源与服务器权威性

### 4.1 SOFA JPN_Test2_Plus

- 服务器权威源：`/home/daodao/sofa_probe/models/step.100000.ckpt`
- 本机生产路径：`E:\AIscene\SOFA-Japanese\Voicebank2DiffSinger-main\community_models\JPN_Test2_Plus\step.100000.server-practiced.ckpt`
- 大小：`83,313,808` bytes
- SHA-256：`d408bb1f511c79ae3fe7ea4f72d02032b384677c1435e9c2e54973139fdf3fc8`
- 内容审计：`global_step=100000`，97 个 state tensors，4,439,933 个参数
- state fingerprint：`2594d3f861c0cf91fe3f98d20be2f0c67bfeac38170714cba39c0716e7f518bd`

本机文件 SHA 与服务器逐字节一致。GitHub release 的较小封装只用于比对；生产环境明确使用带 `server-practiced` 后缀的服务器实践件。两者模型 state fingerprint 一致，但本项目的可复现基准以服务器文件字节为准。

Voicebank2DiffSinger 代码由 GitHub 重新拉取，不迁移服务器 Python 环境：

- repo：`E:\AIscene\SOFA-Japanese\Voicebank2DiffSinger-main`
- repo commit：`4414e59a1dbd7dedbb0ce56f7f932d93b547fb33`
- `src/SOFA` submodule：`0927115a7722ca90cba87601e0b5cdfaa866cad3`
- `src/MakeDiffSinger` submodule：`24f0d964090cb584e0dd6ffe4dcaee296ef1ecb3`

### 4.2 285k online VAE

- 服务器权威源：`/home/daodao/experiments/vae_full_official_300k_20260716/checkpoints/autoencoder_285k.ckpt`
- 本机生产路径：`E:\AIscene\YingMusic_Singer_Plus\ckpts\autoencoder_285k.ckpt`
- 大小：`624,568,721` bytes
- SHA-256：`f18aeecacc04173cd2ea73bbdf8edae9e976d18e4ca050c38e2723281c5cba85`
- 内容审计：365 个 float32 state tensors，156,112,514 个参数

导出件已逐 tensor 对照原始 285k 训练 checkpoint：与 `autoencoder.*` online 权重完全相同，online mismatch 为 0；与 EMA 分支 365/365 均不同。因此该文件确认为 285k online，而不是 EMA 或包含优化器的 2.52 GB 训练 checkpoint。

### 4.3 V4fg 10k

- 本机路径：`E:\MyProject\重要模型保存\V4fg_10k\step_010000.pt`
- 大小：`6,352,039,758` bytes
- SHA-256：`a9d8a05679d413b11c75c983b24118531e193742bb691a1dc25e9f701daeb891`

模型清单把 `V4fg_10k` 明确绑定到上述 285k VAE。Node 服务只接受清单内 checkpoint/VAE preset，补入不可省略的 model ID，并验证 checkpoint/VAE 存在、VAE 精确大小和完整 SHA-256；Python 推理入口再次要求 `--model_id` 并复核 VAE 文件名、大小和 SHA-256。任一不符即拒绝加载。

大文件经服务器 `aliyunpan` 上传和本机 P 盘读取中转；未通过低速 SCP/SFTP 复制。落地后均重新计算 SHA-256。

---

## 5. 两个正式 venv 的分工

### 5.1 应用 venv：Whisper 与 SVS

路径：`E:\AIscene\AISVCs\.venv\Scripts\python.exe`

- Python 3.10.8
- torch 2.11.0+cu128 / CUDA 12.8
- NVIDIA GeForce RTX 5070 Ti Laptop GPU 可用
- `pyopenjtalk 0.4.1`
- librosa 0.11.0

该环境继续服务 Whisper、SVS 和项目其他既有能力。普通 `pyopenjtalk` 必须保留，不能为了 SOFA 在共享应用 venv 内替换为 Plus。

### 5.2 SOFA 隔离 GPU venv

路径：`E:\AIscene\SOFA-Japanese\.venv-gpu\Scripts\python.exe`

- Python 3.10.8
- torch 2.11.0+cu128 / CUDA 12.8
- NVIDIA GeForce RTX 5070 Ti Laptop GPU 可用
- `pyopenjtalk-plus 0.3.4.post10`，实际导入模块版本 `0.3.4-post10`
- librosa 0.11.0

正式服务配置：

```text
AISVC_SOFA_PYTHON=E:/AIscene/SOFA-Japanese/.venv-gpu/Scripts/python.exe
AISVC_SOFA_REPO=E:/AIscene/SOFA-Japanese/Voicebank2DiffSinger-main
AISVC_SOFA_JPN_TEST2_PLUS_CKPT=E:/AIscene/SOFA-Japanese/Voicebank2DiffSinger-main/community_models/JPN_Test2_Plus/step.100000.server-practiced.ckpt
```

repo 内另有 Python 3.11.15 / torch 2.6.0+cpu 的参考 `.venv`，用于锁文件复核和 CPU smoke，不是正式后端运行环境。

---

## 6. 验证证据

以下是提交前最后一次全量回归记录：

| 验证项 | 已通过证据 |
|---|---|
| Client 单测 | 24 files / 94 tests |
| Server 单测 | 6 tests；包含 preset allowlist、V4fg/VAE 绑定和 dryRun 无 manifest 副作用 |
| SOFA Python 单测 | 4 tests；覆盖 I/U lowercase、SP、SOFA 时间覆盖 Whisper 时间、非法区间拒绝 |
| Singer Python 单测 | 8 tests；覆盖 A/B 放置、`<SEP>`、冲突顺延、边界错误、必填 model ID、VAE 大小与完整 SHA-256 |
| 静态检查 | client lint 通过 |
| Production build | client + server build 通过 |
| Python 语法 | 涉及 runner、T1 和 checkpoint binding 的 `py_compile` 通过 |

### 6.1 真实 SOFA CUDA smoke

- 使用正式 `.venv-gpu` 和服务器实践 checkpoint。
- 完整日语样本成功输出 2 phrases、2 words、77 phones。
- 句界为 `0.000-5.361s`、`5.570-13.247s`。
- 与保存的 JPN_Test2_Plus Gold 预测边界最大差约 0.164 ms，仅为三位小数序列化误差。

### 6.2 Whisper -> SOFA -> TextObject E2E

- 启动日志：`.codex-logs/sofa_t1_dev.out.log`
- 结果：`E:\AIscene\AISVC-midi-web\data\render_sofa-smoke-mrx2wndl_whisper\whisper_sofa_e2e.json`
- 结果包含 2 phrases、2 words、78 phones，并生成 `SOFA_JPN_Test2_Plus_full_segment` TextObject。
- 日志明确显示 Whisper 使用应用 venv，SOFA 使用隔离 GPU venv、服务器 checkpoint 和 `--device cuda`。

### 6.3 真实 SVS CUDA smoke

- 模型：V4fg 10k
- VAE：285k online
- 推理步数：1
- T1 audit：A frame 0，B frame 49，两区均包含 `<SEP>`
- 输出：`E:\AIscene\AISVC-midi-web\data\t1_v4fg285k_smoke.wav`
- WAV：44.1 kHz，143,360 frames，3.25079365s
- 峰值：0.518524；RMS：0.090081，确认非静音
- 文件大小：286,798 bytes
- SHA-256：`756caa390f040fb48981dc85cb9bd22f86ddb507e3a3c6a576de10d8da4f8fdb`

### 6.4 `/api/svs/run` 路由 smoke

- V4fg dryRun job：`svs-t1-smoke-mrx8fwes`。
- HTTP 明确返回 `modelId=V4fg_10k`、VAE SHA-256 `f18aeeca...c5cba85`，以及完整 `--ref_audio`、`--t1_manifest`、`--model_id`、`--checkpoint`、`--vae_ckpt` 参数。
- 默认 `plus_ja_sft_v4c step24k` preset 也完成独立 dryRun，服务端确认默认 checkpoint/VAE 存在并自动补入 model ID。
- 两次 dryRun 后对应 WAV 和 `.t1.json` 均不存在；应用内 dryRun 同样跳过 A/B 临时 WAV 合并上传。
- 随后的 HTTP + WebSocket + CUDA job `svs-t1-smoke-mrx6d4xu` 已通过路由启动，命令行明确使用 V4fg 10k、285k online VAE、T1 manifest 和 `--steps 1`。
- 该次完整路由 smoke 因本机同时运行 `phase25_f0_acoustic_anchor.py calibrate`，在 10 分钟接收窗口内停留于重模型加载，未计为成功。超时后仅停止本次 smoke 的两个 Python 进程，未触碰既有研究任务。
- 完整 CUDA 可运行性仍由 6.3 的成功直连 smoke 证明；路由参数和无副作用行为由本节 dryRun 证明。后续 GPU 空闲时可用 `server/scripts/smoke_svs_t1.mjs` 复跑完整路由，默认等待窗口已提高至 30 分钟并可由 `SVS_SMOKE_TIMEOUT_MS` 覆盖。

---

## 7. 代码落地点

AISVC-midi-web：

- 客户端新增 A 参考文本/B 目标文本双槽、T1 文本解析与 rebasing、Whisper-SOFA 严格结果协议。
- Whisper 服务变为两阶段编排，并对 SOFA runtime 路径做启动前检查。
- 新增 `server/scripts/sofa_runner.py`、Whisper-SOFA E2E smoke 和 SVS T1 路由 smoke 脚本。
- SVS 服务写入 `yingmusic.svs-t1.v1` manifest，并强制 V4fg/285k VAE 绑定。
- 模型清单为每个 SVS checkpoint 保存对应 VAE checkpoint。

YingMusic_Singer_Plus：

- `infer_v4_formal.py` 接收 `--t1_manifest` 和 `--vae_ckpt`。
- `t1_alignment.py` 实现 A/B 双区 T1 放置与 audit。
- `checkpoint_binding.py` 对 V4fg 所需 VAE 做文件名、大小和 SHA-256 校验。

---

## 8. 不提交的运行产物

以下内容是运行依赖或验收证据，不进入 AISVC-midi-web Git 提交：

- SOFA、VAE、V4fg 等模型权重。
- `E:\AIscene\SOFA-Japanese` 下的 venv、模型与 smoke 输出。
- `data/render_*`、`data/t1_v4fg285k_smoke.wav`、临时 `.t1.json` 和 Whisper 中间 JSON。
- `.codex-logs/` 中的本地启动日志。
- Python cache、临时 WAV、下载中转目录和阿里云盘临时目录。

仓库提交应只包含源码、测试、模型路径元数据、忽略规则和本报告。运行产物若需长期保存，应转移到外部实验归档并附 SHA-256，而不是加入应用仓库。

---

## 9. 已知边界

- 正式 SVS 真实执行当前只接受 audio melody；MIDI melody 仍仅允许 dryRun，尚未接入 MIDI 到 `melody_audio` 的正式转换。
- SOFA 当前是日语专用，非日语转录会明确失败。
- SOFA checkpoint 和两个正式 venv 使用绝对路径；迁移机器时必须重新配置三个 `AISVC_SOFA_*` 环境变量并重新做 hash/smoke 验收。
- 真实模型 smoke 为最小步数连通性验证，不等同于 32-step 音质验收；音质回归仍应使用正式 steps/cfg/seed 和固定试听集。

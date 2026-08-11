# AI-Midi

AI-Midi 是一个本地运行的歌声编辑与 AI 合成工作台，提供时间线编排、音频对象管理、F0/MIDI 辅助编辑，以及 V5-P 合成单元工作流。

当前项目的核心合成链路已经闭合：

```text
AudioObject
  -> SynthesisUnit
  -> Segment / Kana / H Token / MIDI-P 编辑
  -> A/B 合成单元绑定
  -> V5-P Take
  -> 试听、比较
  -> 导出正式音频到时间线
```

## 项目结构

```text
AISVC-midi-web/
├── client/          # Vue 3 + Vite 前端
├── server/          # Express + TypeScript 后端
├── projects/        # 项目 JSON；大体积 blob 文件不进 Git
├── docs/            # 架构、交接和编辑器设计文档
├── public/          # 公共前端资源
├── data/            # 运行时生成数据，不进 Git
├── exports/         # 导出音频，不进 Git
└── resources/       # 本地资源缓存，不进 Git
```

## 快速开始

需要 Node.js、pnpm，以及 V5-P/SVC 所需的本地 Python、PyTorch 和 CUDA 环境。

```powershell
pnpm install
pnpm dev
```

默认开发服务：

| 服务 | 地址 | 说明 |
|---|---|---|
| Client | `http://localhost:5621` | Vite 前端 |
| Server | `http://localhost:8101` | Express API 与合成 WebSocket |

也可以分别启动：

```powershell
pnpm dev:client
pnpm dev:server
```

如果出现 `EADDRINUSE`，说明对应端口已经被旧进程占用。先查看并关闭旧的 Node 进程，或确认现有服务是否就是当前项目。

## V5-P 使用流程

### 1. 创建合成单元

在左侧资源树或时间线上的 AudioObject 上右键，选择“创建音轨合成单元”。系统会复制有效音频区间生成自有 Owned Guide，并创建一个 SynthesisUnit。

SynthesisUnit 可以：

- 作为资源对象保存在 Workspace/Resource；
- 作为 TrackObject 出现在时间线；
- 双击进入专用编辑器；
- 在时间线上拖动，改变其编排位置和 Take 导出的默认时间戳。

时间线上的 SYN 是 TrackObject，Resource/Workspace 中的 SYN 是源对象。删除时间线 TrackObject 不会删除源 SYN；只有直接删除源 SYN 才会删除它的 Guide、Take 和相关资产。

### 2. 准备 B 区

进入目标 B 合成单元的详细编辑页面，按顺序准备：

1. 生成或编辑 Segment；
2. 校对假名和 Romaji；
3. 生成或调整 Kana 时间范围；
4. 生成或编辑 H Token；
5. 运行 GAME，生成 MIDI-P；
6. 在实际音频 frame 上检查并调整 MIDI-P 音高。

编辑器中的五类对象分别是：

- `Guide Audio`：B 区实际参考音频；
- `Segment`：句级文字与分句；
- `Kana`：假名级文字与范围；
- `H Token`：V5-P 的逐帧文字控制；
- `MIDI-P`：V5-P 的逐帧音高控制。

所有自动分析和对齐都需要用户显式点击，不会在创建合成单元时偷偷运行。

### 3. 绑定 A 区

在 B 编辑器顶部的“A 区参考”槽中：

- 从资源树拖入 A SYN；
- 或拖入指向 A SYN 的时间线 OBJ；
- 或点击“选择合成单元”。

A 区必须是另一个已经准备好 H Token 的 SynthesisUnit。A 使用完整 Owned Guide，并实时读取其最新文字/H 数据。

### 4. 生成和导出 Take

确认 A/B 材料准备完成后，点击“A 区参考”栏最右侧的魔棒按钮生成 V5-P Take。生成过程中会显示进度，完成后结果会出现在 `Takes` 列表中。

用户可以：

- 点击不同 Take 进行比较；
- 选择 `Guide`、`MIDI-P` 或 `Take` 作为编辑器试听源；
- 调整播放速度；
- 点击下载按钮，将满意的 Take 导出为正式音频并加入主时间线。

Take 默认只保存在合成单元内部，不会自动成为正式音轨。导出是显式操作。

## 旧链路

旧的 TextObject、Whisper、SVC/SVS 流程仍保留，用于兼容现有工程和旧工作方式。V5-P 的新入口不依赖旧 TextObject：它以 SynthesisUnit 内部的 Segment/Kana/H/MIDI-P 轨道作为控制数据来源。

## V5-P 本地依赖

V5-P 当前通过本地 Python runner 和 CUDA 模型运行，不调用云端 API。默认配置使用：

```text
Checkpoint: E:/MyProject/重要模型保存/V5P_40K_EMA/step_040000_final.pt
Preset:     V5P_40K_EMA
```

模型权重、VAE、Python 环境和外部运行时不存放在本仓库中。部署到其他机器时，需要修改 `server/src/services/synthesis-direct-control.service.ts` 中的本地路径，或后续将其迁移为环境变量配置。

V5-P 接入的详细合同、frame 对齐、A/B 组合和 Take 生命周期见：

- [`docs/v5p-synthesis-unit-integration.md`](docs/v5p-synthesis-unit-integration.md)
- [`docs/v5p-integration-handoff.md`](docs/v5p-integration-handoff.md)
- [`docs/v5p-token-editor-design.md`](docs/v5p-token-editor-design.md)
- [`docs/v5p-token-editor-v2-inventory.md`](docs/v5p-token-editor-v2-inventory.md)

## Git 忽略内容

以下内容属于本地环境或运行时产物，不应提交：

- `node_modules/`、`dist/`、`.vite/`、日志和环境变量；
- `data/`、`server/data/`、`exports/`、`resources/`；
- `projects/*/blobs/` 和 `projects/*/*.blob`；
- `public/f0_data.json`；
- 模型权重、Python 虚拟环境和临时推理文件。

项目的 `project.json` 可以提交，用于保存对象树和编辑状态；关联的大型音频 blob 需要通过本地备份或其他资源分发方式恢复。

## 检查

```powershell
pnpm --filter client exec vitest run
pnpm build
```

当前开发阶段以真实工程实践为主，测试重点覆盖对象树策略、时间线 Drop、SynthesisUnit 状态和控制轨事务。

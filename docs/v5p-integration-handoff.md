# V5-P 接入上下文交接

> 更新时间：2026-08-10
> 用途：下一次继续工作前先读本文，再按需阅读架构与用户操作计划。

## 1. 当前共识

V5-P 的目标不是在 AI-Midi 里增加一个“可以调用 Python 的模型路由”，而是完成成熟的用户到
控制数据接入：

```text
用户工程对象
  -> 可编辑 ControlData
  -> H / MIDI-P token layer
  -> V5-P sampler
  -> 可比较、可局部重生成的 Take
```

V4PH/V4H 目前的不足已经明确：H 与 MIDI 大多从训练侧搬入，依赖
`audio -> SOFA/GAME -> controlData`。这可以作为兼容导入路径，但不能成为 AI-Midi 的正式用户
操作模型。

## 2. 用户操作模型

MIDI 与 H 必须在同一个 `VocalPart Editor` 中编辑，共享播放头、选区、缩放和时间轴，但分为三层：

```text
句级：phrase、整句文字、起止时间、分句、停顿
假名级：kana/mora、mora 时间、MIDI note group、拖腔
Token 级：H phone token/SEP/PUL + MIDI-P pitch/REST/PAD
```

默认从句级和假名级开始；Token 模式允许专家直接改 token 符号和 frame 位置。用户修改过的深层
区域必须锁定，浅层重新编译不能静默覆盖。

### 正常分层对齐流程

```text
完整音频 + 文字
  -> Whisper/用户确认文字
  -> SOFA 句级时间
  -> 对照 kana/romaji 检查
  -> 用户修正全部假名
  -> SOFA 在句级边界约束下生成假名级时间
  -> 用户对照 MIDI 修正假名级时间
  -> SOFA 在假名级边界约束下生成 phone/token 时间
  -> 人工在离散 frame 上调整 Token 时间
  -> V5-P H/MIDI-P frame layers
```

自动路线允许从无时间戳、句级时间戳或假名级时间戳直接调用 hierarchical SOFA，一次生成下层
结果，但中间 revision 仍要保存并允许用户接管。

注意：SOFA 是对齐器，不是用户语义的最终来源。用户确认过的假名不应在 SOFA 重跑时被悄悄改写。

## 3. H 与 MIDI 的实际 frame 合同

当前冻结的 V5-P runtime 事实是：

```text
vae_frame_rate = 21.533203125
                  = 44100 / 2048
hopSamples = 2048
```

`stable_audio_2_0_vae_20hz_official` 的 `20hz` 是文件名/近似命名，不是当前代码的模型 frame
合同。当前以下位置均使用 `44100 / 2048`：

- `package_v4c_finetune/train/train_v5p.py`
- `package_v4c_finetune/infer/v5p_eval_batch.py`
- `package_v4c_finetune/h_alignment/placement.py`
- `YingMusic-Singer-Plus-src/src/YingMusicSinger/config/YingMusic_Singer.yaml`

另外要区分：

```text
SOFA / 用户编辑：连续秒
GAME-P 原始 duration：100 Hz，0.01 秒
V5-P H/MIDI/latent：21.533203125 Hz
```

GAME 先闭合音频 duration，再映射到 VAE target length，不能把 GAME 的 100 Hz 或 VAE 文件名的
20 Hz 当成最终 P/H frame rate。

### A/B Frame Map

用户实际编辑的不是多套浮点秒数，而是统一的 A/B frame map：

```text
bStartFrame = refFrames + bridgeFrames
globalFrame = bStartFrame + bLocalFrame
```

无额外结构性间隔时 `bridgeFrames=0`。B local 0 对齐到 `bStartFrame`，对应
`bStartFrame * 2048` 个 44.1kHz PCM samples。

`bridgeFrames` 必须是整数 frame，只表示 A/B 结构性接缝；真正的歌词停顿、MIDI REST、H PUL 必须
保存在 B-local control 中，不能藏在 bridge 里。

用户移动接缝时，H lane、MIDI-P lane、kana/mora 和 phrase 同步移动；B-local 控制数据不重新
解释成另一套秒数。

## 4. Token 层的精确定义

### H token

H token 不是只保存一个浮点起止时间。应保存：

```ts
interface HTokenSpan {
  tokenId: number
  symbol: string
  startFrame: number
  endFrame: number
  anchorFrame: number
  origin: 'auto' | 'user' | 'imported'
  locked: boolean
}
```

`anchorFrame` 是真正写入 dense H 的位置；`startFrame/endFrame` 是用户看到的有效区间。phone
可能只在 anchor frame 写入一次，空隙由空 token、PUL 或 placement 规则处理。

特殊 token：

```text
0       dense filler/empty 语义，具体解释以 runtime contract 为准
365     SEP
366     PUL
```

Token 模式允许插入、删除、替换、平移、拉伸和锁定 H token，但应通过符号搜索显示 token ID，不能
让用户只能输入裸整数。

### MIDI-P token

V5-P 的 MIDI-P 是 dense frame layer，每帧一个 class：

```text
pitch class：0.5 半音量化
REST=255
PAD=256
embedding：257 x 128
```

建议保存独立的 `MidiPTokenLayer`。原始 MidiObject 的 note/tempo/PPQ 保留为音乐对象；V5-P token
是 VocalPart control revision 的精确控制，用户 token 修正不覆盖原始 MIDI。

连续相同 class 可以显示成 note overlay，但 overlay 是派生视图。从 token 导出 MIDI 也只是派生
版本，必须提示 frame 量化误差。

## 5. 当前代码事实与缺口

### 已有基础

- `client/src/composables/useRenderSvsPipeline.ts` 已有 A/B 对象解析和 timed phrase 请求。
- `server/src/services/v4h.service.ts` 已有 SOFA/H 单作业准备与 JSONL 事件。
- `server/src/index.ts` 已有 `/api/svs/run` 统一入口。
- `TextObject` 已保存 segment start/end/kana/romaji。
- `MidiObject`、TrackObject、GroupObject 和 Rich Media Editor tab 外壳已存在。
- V5-P evaluator 已能把 `text` dense layer 和 `midi_p` 送入 sampler。

### 必须新增

- `VocalPartObject`：用户可见的演唱片段工作对象。
- `SvsControlData`：模型无关的 phrase/kana/mora/phone/note 控制。
- `sentence/kana/token alignment revision`：每层可保存、回退和继续编辑。
- `HTokenFrameLayer`：允许 runner 直接消费用户修改过的 dense H。
- `MidiPTokenLayer`：允许 V5-P 直接消费用户修改过的 MIDI-P frame tokens。
- `ABFrameMap`：统一 A/B 接缝和 local/global frame 映射。
- hierarchical SOFA compiler：支持无时间戳、句级、假名级三个输入深度。
- MIDI note 到 MIDI-P token 的编译器，以及 token-first 编辑器。
- GPU job snapshot、revision 归属、Take、比较和局部重生成。

### 关键兼容风险

当前 `render_h_pul_placements()` 主要从 phrase/candidate 重新生成 dense H。若只在前端修改 token，
现有 runner 会在推理前把修改覆盖掉。正式接入必须先改成支持 direct `HTokenFrameLayer`，否则
Token 编辑只是表面功能。

当前 evaluator 的 sampler 位置：

```text
policy.sample(cond=rl, text=text_tokens, duration=total_frames, midi_p=midi, ...)
```

B 音频在当前 evaluator 主要用于 VAE target length 和 GAME 输入；成熟 direct-control runner
应允许用 control duration 和用户 `MidiPTokenLayer` 替代这两个导入步骤。

## 6. 文档索引

- [v5p-user-operation-plan.md](./v5p-user-operation-plan.md)：用户全链路、编辑器、分层对齐、Token 操作、错误恢复、分阶段计划。
- [v5p-integration-architecture.md](./v5p-integration-architecture.md)：模型、控制编译、服务端 adapter、runtime 和 runner 架构。
- `ToLinuxServer/docs/基础设施/v5/V5P/V5-P正式训练计划.md`：V5-P 训练合同、数据、门禁和 VAE 谱系。
- `ToLinuxServer/package_v4c_finetune/infer/v5p_eval_batch.py`：当前 V5-P batch evaluator。
- `ToLinuxServer/package_v4c_finetune/train/train_v5p.py`：当前 V5-P training/runtime constants。
- `ToLinuxServer/package_v4c_finetune/h_alignment/placement.py`：权威 H/PUL placement 规则。

## 7. 下一步顺序

1. V5-P artifact 到达后，先读取实际 checkpoint metadata、VAE config、runtime hash 和 encoded frame rate。
2. 用 A 音频 encode shape、B boundary sample/frame delta 和 direct-control fixture 冻结 `ABFrameMap`。
3. 先做无 UI 的 `SvsControlData -> HTokenFrameLayer + MidiPTokenLayer` 纯编译器。
4. 再做 VocalPart Editor 的句级、假名级、Token 级三层联动。
5. 最后接 `v5p` adapter/route。只有 direct-control、手工 token、局部重生成和 revision 审计通过，才叫成熟接入。

不要把“新增 `/api/svs/run` 的 v5p 分支并成功出 WAV”标记为最终完成；那只能是 Compatibility Smoke。

## 8. 当前变更状态

本轮只新增/更新设计与交接文档，没有修改现有运行代码，没有运行测试，也没有恢复或覆盖用户已有的
dirty worktree 修改。

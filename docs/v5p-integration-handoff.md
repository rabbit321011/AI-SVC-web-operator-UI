# V5-P 接入上下文交接

> 更新时间：2026-08-11
> 当前阶段：`SynthesisUnit`、Owned Guide、正式 Vue 编辑器、四条控制轨、Kana -> H、H/MIDI-P 人工编辑、A 区参考绑定、frame-aligned `ABFrameMap`、A/B material snapshot、direct-control runner、不可变 Take 与显式导出均已实装；真实 32-step CUDA 短样本已出声。

## 1. 恢复阅读顺序

上下文压缩后按以下顺序恢复：

1. 本文；
2. [`v5p-synthesis-unit-integration.md`](./v5p-synthesis-unit-integration.md)；
3. [`v5p-token-editor-design.md`](./v5p-token-editor-design.md)；
4. [`v5p-h-token-catalog-zh.md`](./v5p-h-token-catalog-zh.md)；
5. [`v5p-integration-architecture.md`](./v5p-integration-architecture.md)；
6. [`v5p-user-operation-plan.md`](./v5p-user-operation-plan.md) 只用于早期完整产品流程参考；若其旧版
   VocalPart/VoiceReference 与对象生命周期表述冲突，以集成规范为准；Phone lane/级联传播表述冲突，
   以编辑器设计文档为准；
7. `ToLinuxServer/docs/基础设施/v5/H/main_H.md`；
8. `ToLinuxServer/docs/基础设施/v5/H/摩拉音素级对齐实验.md`；
9. `ToLinuxServer/package_v4c_finetune/h_alignment/placement.py`；
10. `ToLinuxServer/package_v4c_finetune/train/train_v5p.py`。

## 2. 最新核心结论

V5-P 成熟接入不是增加一个 route。当前产品主对象从旧讨论中的松散 TextObject/AudioObject 组合，
收敛为新的用户工作对象：

```text
SynthesisUnit
  -> 独立 SegmentTrack
  -> 独立 KanaTrack
  -> 独立 HTokenTrack
  -> 独立 MidiPTokenTrack
  -> V5-P direct-control runner
  -> Take
```

`SynthesisUnit` 是资源栏中的一级工程对象。用户右键 AudioObject 执行“创建合成单元”，系统只复制该对象
的有效音频区间作为 Owned Guide，并继承默认 `timelineStart`；不自动运行任何分析。删除或修改源
AudioObject 不影响已创建 Guide。

SynthesisUnit 持有固定 frame contract、四条控制轨、参考单元绑定、各轨 revision 和 Takes。双击对象进入
Token 编辑器。现有 TextObject 和旧 Whisper 链路保留兼容，但新合成单元内部 Whisper 直接写 SegmentTrack，
不经过 TextObject。

A 区不再使用独立 VoiceReference/AudioObject/TextObject 槽，而是绑定另一个 SynthesisUnit：

```text
audio = 参考单元完整 Owned Guide
text  = 参考单元当前 Segment/Kana/H revision
revision policy = follow latest
Take/range = 禁止
```

参考缺少有效 H/Text 时 preflight 失败，必须由用户打开参考单元显式生成；系统不能静默补齐。A 单元更新后
下一次生成使用最新 revision，但已有 Take 冻结原 A snapshot，声音和审计不变。

每次合成新增不可变 Take。Take 保留在 SynthesisUnit 内试听和比较，不直接进入正式时间线；用户显式执行
“导出到正式音轨”后才创建普通 AudioObject/TrackObject，默认使用来源 `timelineStart`。

编辑页面是某个 `SynthesisUnit` 的内部编辑器，不再把 H 分散到 TextObject Editor、把 MIDI-P 分散
到 MidiObject Editor。

## 3. 独立轨与单目标覆盖

当前最重要的用户裁决：

```text
无论进行哪一种自动对齐/生成，
只强制覆盖一个目标轨的明确范围，
其他轨完全不变。
```

冻结矩阵：

| 源对象 | 操作 | 唯一目标轨 | 范围 |
|---|---|---|---|
| Audio | GAME 自动生成 MIDI-P | MIDI-P | 完整固定 frame 范围 |
| Audio | 自动转录为 Segment | Segment | 完整 SegmentTrack |
| Segment | 自动对齐至 Kana | Kana | 当前 Segment speech range |
| Segment | 自动对齐至 H token | H | 当前 Segment owned H range |
| Kana | 自动对齐至 H token | H | 当前 Kana control range |

明确取消旧设想：

- Segment 变化不自动改 Kana/H；
- Kana 变化不自动改 H；
- Segment -> H 不把临时 kana 写入 KanaTrack；
- H 修改不反写 Kana/Segment；
- MIDI-P 修改不反写原始音频/MIDI；
- 轨道不一致只显示 provenance，不自动“修复”。

右键操作是显式强制覆盖。目标范围内包含用户手工修改时，需显示覆盖统计；每次操作只创建目标轨
revision，并可一次 undo 完整恢复。

## 4. 编辑器轨道

当前推荐顺序：

```text
Frame / Time
Guide Audio waveform / F0
Segment
Kana
H Token
MIDI-P
Take strip（已实现，位于时间轴上方）
```

视觉分组：

```text
Source: Guide Audio
Text:   Segment / Kana / H Token
Melody: MIDI-P
```

音频是 Text 和 Melody 的共同源，不严格归入 Melody。

### Segment

- 对象单位是一句；
- 双击编辑 text/kana/romaji 和句级时间；
- 右键提供 Segment -> Kana、Segment -> H；
- 自动对齐只替换目标轨，不改变 Segment 自身；
- Segment 同时有实际发声区间和 H 控制所有权区间。

### Kana

- UI 名为 Kana，实际对象单位是 mora/KanaUnit；
- `きゃ` 等组合是一个对象，不按 Unicode 字符拆分；
- 双击编辑 kana/romaji；
- 右键提供 Kana -> H；
- KanaTrack 自己保存不可发音的 `KanaSegmentBoundary/SEG`，不依赖当前 SegmentTrack 保存分句；
- Kana `SEG` 不进入 G2P，Kana -> H 时才编译为 H 的 SEP 结构。

### H Token

- 普通发音 token 永远是单 frame 稀疏事件；
- 不再保留独立 Phone lane；
- 不给普通 H token 画持续区间；
- H token 可横向拖动、插入、清除、替换；
- 右键任意 frame（包括 `0` 空 frame）打开 Token Picker；
- 双击已有 H token 等价于右键；
- 拖到已占用 frame 默认阻止，强制替换必须显式执行；
- 悬浮/Inspector 显示中文解释、symbol、ID、来源和 V5-P 训练暴露。

### MIDI-P

- 每个有效 frame 都有 class；
- 横向拖动改变 frame，上下拖动改变 pitch class；
- 单 cell 横移时目标接收 source pitch、源写 `REST=255`，中间 frame 不变；
- 自动目标直接覆盖，手工目标必须二次确认后强制移动；
- 每步 0.5 半音；
- 上下拖动跨入新 class 时即时播放钢琴式音高预览；
- 右键强制替换的候选变化和最终提交同样试听；
- 允许逐 frame/选区替换为 pitch 或 REST；
- 边界固定在 `0..SynthesisUnit.frameCount-1`；
- piano-roll/run/cell 的正式编辑体验仍待 direct-control fixture 后继续裁决。

### 播放与边界

- 工具栏显式选择 `Guide` 或 `MIDI-P`，空格播放当前试听源；
- Guide 播放真实音频；当前 HTML 直接使用 `exports/对比数据集_MSST人声_20260726_235533/鹿乃-温柔.mp3`；
- MIDI-P 播放按连续 class run 触发钢琴式预览，REST 不发声；
- Segment 左右边界可拖动，只修改 SegmentTrack；
- 相邻 Kana 共用边界，拖动同时调整前一 end 和后一 start，只修改 KanaTrack；
- Segment/Kana 边界操作均不自动改写 H/MIDI-P。

HTML 不再复制或提交 Guide 派生文件，而是从 git ignored 的 `exports/` 直接读取本机源 MP3。当前示例为
44.1 kHz/stereo，完整时长 `35.116667s`；编辑窗口显示和播放源文件的 `0.000000–2.972154s`，
正好对应 64 个 V5-P frame。源文件 SHA256：
`bef02450e8ab7daf26c35065667f42fe45f023047b3a500baa090eb40ae6383f`。waveform 只从该窗口的
实际解码采样绘制，点击定位和播放头统一使用 `sourceOffset + frame / frameRate`。

同一窗口的四条控制轨已经改为真实自动生成 fixture，不再使用与音频无关的手写假数据：

- Whisper large-v3 识别：`夏の温度に溶けて`；Kana：`なつのおんどにとけて`；
- SOFA `JPN_Test2_Plus` confidence `0.599706`，Segment 为 frame `8..63`；
- SOFA mora 区间经训练侧 monotonic frame solver 离散化为 10 个 KanaUnit；
- H 使用训练侧 Japanese IPA/vocab 和同一个 solver，得到 18 个发音事件及 frame 63 的 `SEP`；
- SOFA 将拨音 `N` 返回为小写 `n`，fixture 在 phone 数量和顺序完全一致时按期望序列恢复大小写，
  因此“ん”映射为训练 token `327/ɴ`，不是普通 `46/n`；
- GAME medium K=4 使用冻结 commit `4ad815c90dfe2442730f3fdc866fd23e737cbc97` 和模型
  SHA256 `e9904159fb0646e1a352b9d2bc74615547cfa3e32d45c7464d440ac142846d93`；
- GAME effective seed `743440497`，64 帧 MIDI-P 由 `game_cache_to_model_tracks(..., target_len=64)`
  生成，开头 9 帧为 REST，后续 class run 为 `130/134/140/150/148/140/134/144`。

自动生成的中间 WAV、Whisper/SOFA/GAME JSON 和复现脚本位于
`exports/v5p-token-editor-generated/`，受 git ignore 约束，不得提交或上传；HTML 内只固定生成结果和
provenance，方便当前本机原型直接打开。

## 5. Segment 局部 H 覆盖范围

用户已经确认：右键单个 Segment 执行 Segment -> H 时，只覆盖该 Segment 对应的 frame 范围，不能
覆盖整条 H，也不能移动相邻 Segment 的 H。

为了与当前 PH/H-PUL runtime 一致，范围冻结为：

```text
当前 Segment：
[Segment.startFrame, nextSegment.startFrame)

最后一个 Segment：
[Segment.startFrame, SynthesisUnit.frameCount)
```

不能简单使用实际发声 `endFrame`，因为：

```text
SEP_i = next Segment anchor - 1
最后一句 SEP = 最后一个有效 frame
```

句末发声结束到下一句开始之间是前一句的 H control tail，可包含 `0`、PUL 和 SEP。UI 应将该尾部
显示为低对比区域，并在执行前高亮完整待覆盖范围。

局部事务必须：

1. 快照源 Segment revision 和 Audio hash；
2. 在临时缓冲运行当前 PH 同构管线；
3. 检查输出全部位于目标范围；
4. 保存旧 H 范围；
5. 清空目标范围为 0；
6. 写入新 H/SEP/PUL；
7. 原子提交 HTrack revision；
8. 范围外逐 frame 保持不变。

容量不足、token 越界、runtime hash 不一致或任何中途失败都必须整次回滚，不能部分写入或向相邻
范围挤 token。

## 6. H 自动对齐与训练侧等价

### 6.1 Segment -> H

用户要求 Segment 直接对齐至 H 的效果与当前 PH 通路一致。正式实现必须调用同一套权威模块：

```text
Segment text/kana
  -> 临时 kana/mora
  -> 当前 Whisper/SOFA 约束与裁窗策略
  -> 当前 Japanese tokenizer
  -> 当前 placement/H-PUL renderer
  -> H frames
```

临时 kana 只属于本次 job snapshot，不写入 KanaTrack。要保留并使用当前 KanaTrack，应从 Kana 对象
执行 Kana -> H。

为保持 SEP/PUL、下一句 anchor 和全样本 anomaly 语义一致，Segment -> H 可以在临时缓冲中读取完整
SegmentTrack 并运行完整权威 renderer，然后只截取当前 Segment 的 owned H range 写回。临时生成的
其他 Segment H 必须全部丢弃，其他 H 范围逐 frame 不变。

正式门禁不是“听起来相似”，而是同输入、同 Audio、同 runtime、同 frame range 时，新 adapter 与
当前 PH 产生 tensor-identical H。

### 6.2 Kana -> H

单个 KanaUnit 的 H 覆盖范围已冻结：

```text
普通 Kana： [current.startFrame, nextKana.startFrame)
句末 Kana： [current.startFrame, currentKanaSegmentBoundary)
```

Kana `endFrameExclusive` 只表示实际发声结束，句末 `SEP` 属于它到 Kana SEG 之间的 control tail。正式
adapter 冻结完整 Guide/Kana/H revision，把 KanaTrack 按自身 SEG 组成分句，并用完整分句运行当前 SOFA、
Japanese tokenizer、训练侧 monotonic solver 和 placement renderer。每句携带
`controlEndFrameExclusive`；部分 KanaTrack 只含第一句时，它会把训练 renderer 的候选 dense horizon
限制在该句 SEG，避免最后 `SEP` 错落到完整 Guide 的最后一帧。

写回前必须同时满足：placement 为 `phone`；SOFA mora 数量及规范化内容与当前 KanaUnit 逐项一致；普通
H event 精确归属所选 `moraIndex` 且不越过 control range；相邻 mora 不侵入；句末恰有一个 SEP，非句末
没有 SEP。PUL/Exact/fallback 或任何检查失败都不写轨，并提示改用 Segment -> H。

提交只替换所选 Kana control range。手工 H 需显式确认覆盖，一次 undo 恢复整段旧值；Segment、Kana、
MIDI-P revision 不变。

## 7. H 实际训练表示调查

已经重新核对 V5-P 训练入口和真实 H manifest：

```text
正常普通 H：k 0 0 i 0 0
不是：       k k k i i i
```

证据链：

- `train_v5p.py` 每 batch 调用 `render_h_pul_placements()`；
- 直接取 `paired["phone_pul"]["text"]` 作为 `aligned_text`；
- renderer 先创建 `[0] * total_frames`；
- 普通 token 通过 `text[frame] = token` 各写一次；
- fallback 才会连续写入 `PUL=366`；
- SEP 始终是单 frame。

本机真实 H 训练记录重放结果：

```text
total frames: 491
ordinary source/rendered events: 89 / 89
ordinary sequence identical: true
0 filler frames: 313
PUL frames: 82
SEP frames: 7
```

相邻两个相同 `i` 可以来自歌词序列中两个独立元音事件，不表示 duration-expanded `iiii`。

## 8. Token 与 frame 合同

```text
sampleRate = 44100
hopSamples = 2048
frameRate  = 21.533203125 Hz
```

H/MIDI-P 使用同一 cell grid。H anchor 画在 cell 中心，竖线只表示 boundary。

H runtime：

```text
0       filler/no explicit lyric event，不等于静音
1..363  vocab token
364     PUNCT，当前禁止选择
365     SEP
366     PUL
```

MIDI-P 当前已知：

```text
0..254 pitch class，0.5 半音
255 REST
256 PAD
```

MIDI-P 的 B-local frameCount、VAE shape 与 runner direct-control 已由正式 64-frame fixture 最终冻结。

## 9. H Token 中文 UX

面向中国用户，允许完全不认识假名和 IPA。显示顺序：

```text
中文名称/发音作用
-> 中文近似说明
-> romaji
-> kana
-> runtime symbol
-> runtime token ID/vocab hash
-> 当前 preset 训练暴露
```

V5-P 40K：

```text
runtime 可寻址：0..366，共 367 个
实际训练见过：45 个 runtime ID
  36 个发音 token
  6 个歌词标点
  0 / SEP / PUL
```

默认 pronunciation palette 只展示 36 个训练见过的发音 token。完整逐 ID 目录见
[`v5p-h-token-catalog-zh.md`](./v5p-h-token-catalog-zh.md)。

## 10. 已推翻的旧设计

继续工作时不要恢复以下旧设想：

1. 独立 Phone lane；
2. H token 带持续区间块；
3. Segment/Kana/H 是自动级联覆盖的强父子树；
4. 修改 Kana 自动重建 H；
5. Segment -> H 同时落盘临时 Kana；
6. 自动操作默认覆盖整条目标轨；
7. H token 拖动后反写 Phone 或 Kana；
8. 把普通 pause、`0`、PUL、MIDI REST 当成同一概念；
9. 只做 route/runner smoke 就称为成熟接入。
10. Guide 只引用源 AudioObject，导致源裁剪/删除后合成单元变化或损坏；
11. 创建 SynthesisUnit 后自动运行 Whisper/SOFA/GAME；
12. A 区分别绑定音色 AudioObject 和 TextObject；
13. A 区使用 Take 或局部 range；
14. 把 SynthesisUnit/Take 自动当成正式时间线音频；
15. 新内部 Whisper 先创建 TextObject 再回读 SegmentTrack。

## 11. 当前文件状态

### 11.1 已实装

正式代码当前已经具备：

- `SynthesisUnitObjectNode`、固定 Oobleck frame contract、四条独立轨道、reference/Take schema；
- AudioObject 右键“创建合成单元”，按有效区间渲染项目自有 44.1 kHz WAV；
- object-tree 与 project blob 的创建 undo/redo；
- 双击 SynthesisUnit 打开正式 Vue 编辑器；
- 真实 Guide waveform、播放头、frame ruler、Segment/Kana/H/MIDI-P lane；
- `Guide -> Whisper + SOFA -> SegmentTrack`，旧 Whisper 仍写 TextObject；
- H 中文 Picker、单 frame 插入/替换/清除/横向拖动和占用 frame 阻止；
- Segment 双击编辑和整数 frame 边界拖动；
- 训练等价 `Segment -> Kana` 与 `Segment -> H`；
- 训练等价 `Kana -> H`，含 Kana SEG control tail、phone placement 与逐 mora 归属门禁；
- Kana 双击编辑和相邻 mora 共享边界拖动；
- 冻结 GAME medium K=4 单作业服务与训练同一 `game_cache_to_model_tracks()`；
- MIDI-P dense 音高轮廓、右键逐 frame 强制替换、REST、0.5 半音上下拖动和单 cell 横向移动；
- MIDI-P class 变化即时钢琴音，Guide/MIDI-P 试听源切换与编辑器空格播放；
- MIDI-P `manualFrames` 逐 frame 手工 provenance，重跑 GAME 前显示覆盖数量；
- 每次自动操作只写用户选择的一个目标轨/一个 Segment 范围；
- 目标范围有手工对象时显示 frame、对象数和手工修改数并二次确认；
- 相同 Guide hash + frameCount + Segment revision 的 Kana/H 候选在编辑器会话内复用，但每条轨仍需用户显式提交。

Text Control 正式管线：

```text
Owned Guide WAV + 完整 SegmentTrack/KanaTrack 整数 frame snapshot
  -> server /api/synthesis/text-control/run
  -> v4h_prepare_job.py mode=b_only
  -> 当前 V5-P Japanese/vocab + JPN_Test2_Plus
  -> v5p_compile_text_control.py
  -> 训练侧 solve_monotonic_frames
  -> 训练侧 render_h_pul_placements
  -> 完整候选结果
  -> 客户端只截取所选 Segment 的 Kana/H 范围，或所选 Kana 的 control range
  -> stale revision 检查
  -> 单轨原子事务 + undo
```

服务端在运行前同时校验 Owned Guide WAV 的 SHA256、44.1 kHz sample rate、
`floor(sampleCount / 2048) == frameCount`，并按 `v5p-source-20260810` 锁定训练/runtime 文件 hash。

关键新文件：

- `server/src/services/synthesis-text-control.service.ts`；
- `server/scripts/v5p_compile_text_control.py`；
- `server/scripts/test_v5p_compile_text_control.py`；
- `server/scripts/v5p_direct_control.py`；
- `server/scripts/test_v5p_direct_control.py`；
- `client/src/composables/synthesisTextControlClient.ts`；
- `client/src/composables/synthesisTextControlProtocol.ts`；
- `client/src/object-workbench/synthesisKanaControl.ts`；
- `client/src/object-workbench/synthesisABFrameMap.ts`；
- `client/src/object-workbench/synthesisMaterialSnapshot.ts`；
- `server/src/services/synthesis-midi-p.service.ts`；
- `server/src/services/owned-guide-runtime.ts`；
- `server/scripts/v5p_generate_midi_p.py`；
- `client/src/composables/synthesisMidiPClient.ts`；
- `client/src/composables/synthesisMidiPProtocol.ts`；
- `client/src/composables/useSynthesisUnitAnalysis.ts`；
- `client/src/components/synthesis/SynthesisUnitEditor.vue`。

### 11.2 真实验证

真实 Guide：

```text
E:\AIscene\AISVC-midi-web\exports\对比数据集_MSST人声_20260726_235533\鹿乃-温柔.mp3
Owned Guide samples: 1,548,645
frameCount: 756
trailing samples: 357
Whisper/SOFA Segment: 9 句
```

完整 Text Control 候选：

```text
KanaUnit: 100
H events: 227
phone phrase: 8
PUL fallback phrase: 1
exact Control phrase: 0
PUL frames: 37
最后一枚 SEP: frame 755
vocab SHA256: 4246e275721cffd944906ad2e148d85ac93250441e04ac75d2670106bc8ada72
```

完整 GAME MIDI-P 候选：

```text
source samples: 1,548,645
frameCount/classes: 756 / 756
raw note regions: 120
voiced notes: 104
rest notes: 16
REST frames: 148
PAD frames: 0
pitch class range: 119..150
effective seed: 2577097735
GAME model SHA256: e9904159fb0646e1a352b9d2bc74615547cfa3e32d45c7464d440ac142846d93
GAME cache adapter SHA256: 2bd07ff9c9c3748289e4c2a65a4e8fa1b1cbf52fce2fdf689252a85a87ae17bd
```

正式 GAME seed 按训练缓存入口使用 Owned Guide 文件 SHA。旧 64-frame HTML fixture 曾用解码 waveform
SHA，seed 为 `743440497`；正式代码不沿用该原型偏差。

浏览器局部事务验证：

- 第一 Segment -> Kana 后 revision 为 Segment r1 / Kana r1 / H r0 / MIDI-P r0；
- 第一 Segment -> H 后 SEP 在 frame 127，下一 Segment start 为 frame 128；
- 第二 Segment -> H 复用当前候选约 1.3 秒完成，第一句 frame 7 的 H 事件保持不变；
- undo 第二次 H 操作后 H r2 -> r1，恢复为 34 个第一句事件，末尾仍为 frame 127 的 SEP；
- 完整 GAME 写入后 MidiPTokenTrack r0 -> r1，756 个 cell 且 PAD 为 0；
- frame 9 右键替换 `130/F4 -> 131/F4+50`，登记一个 manual frame；
- frame 10 上拖 12px 得到 `132/F#4`，class 改变时触发 Web Audio 钢琴音；
- MIDI-P 空格试听推进内部播放头，停止后回到 frame 0；
- 两个手工 frame 存在时重跑 GAME 显示完整 `frame 0..755` 和手工数量 2；
- 两次 undo 分别恢复上拖和右键替换，最终回到干净的 MIDI-P r1；
- 浏览器控制台没有新的未处理错误。

真实 Kana -> H 门禁：

```text
Owned Guide samples/frameCount/trailing: 1,548,645 / 756 / 357
第一句 start/speechEnd/controlEnd: 7 / 115 / 128
第一句 KanaUnit: 19
最后一个 Kana「な」control range: [104, 128)
候选: n(ID 46)@104, a(ID 211)@108, SEP(ID 365)@127
分句 H event: 34，placementMode=phone
```

浏览器先执行 `n@104 -> 手工 m@104`，再运行 Kana -> H；覆盖确认后只提升 H r2 -> r3，并恢复
`n@104`。一次 undo 恢复手工 `m@104` 与 H r2，Segment/Kana/MIDI-P 始终保持 r1，console error 为 0。
权威作业保存在 `data/render_text-cb8c6761-bb6_v5p_text/`，`job.json` 明确记录
`controlEndFrameExclusive=128`。

V5-P `ABFrameMap` 已按用户裁决闭合：其目的不是生成固定 0.5s 静音，而是让 B 音频 0s 与 B-local
VAE latent frame 0 的 start 重合。adapter 从名义 22,050 samples 出发，把接缝吸附到最近的
2048-sample 边界，恰好一半时向后取整：

```text
bStartFrame = floor((A.samples + 22,050 + 1,024) / 2,048)
gapSamples  = bStartFrame * 2,048 - A.samples
B joint k   = bStartFrame + B local k
```

真实 1,548,645-sample Guide 的正式 gap 是 22,171 samples（0.502743764s），B start sample/frame
为 1,570,816 / 767，official VAE 实测 shape 为 `[1,64,767]`。B 同样使用该 Guide并追加 44,100
rear samples 时为 777 frames，因此 joint total 为 1,544。历史固定 22,050-sample evaluator 会得到
766 个 A frame，但 B sample 0 不在 frame start，不能作为正式编辑坐标合同。

`synthesisABFrameMap.test.ts` 已覆盖真实 fixture、最近帧临界值、B rear 21/22-frame 进位、stale frame
contract 和实际 VAE shape 不一致拒绝。gap 由 adapter 自动计算，不作为用户可编辑空白对象；B 自身
开头到第一枚 H 的静音仍属于 B-local 内容。

对象层 A/B material snapshot 也已实装。它冻结 Guide/unit/四轨 revision、本地 dense H、H event
provenance 与 B MIDI-P class，拒绝错误 reference binding、无发音 H、B MIDI 未准备和 PAD=256。
joint MIDI transport 使用：

```text
[0, bStartFrame)                 -> class transport 为 REST，embedding 后强制清零
[bStartFrame, bStart+BFrames)    -> 当前 B-local class 逐 frame 原样复制
[bStart+BFrames, totalFrames)    -> REST rear
```

snapshot 对原对象后续修改保持不变；2 个 snapshot 测试与 3 个 ABFrameMap 测试通过。Guide blob/path
现由 client 分别上传，Node 校验 hash/sample/frame 后生成不可变 `job.json`，Python runner 再校验 manifest SHA。

随后已用本机正式 V5-P 40K EMA checkpoint 和真实 756-frame MIDI-P 执行实际 P tensor 门禁：

```text
checkpoint SHA256: 3a532f5bd5965dff7d011996b7ca72d7884c5494a2d44d6c28b0bab21bace96c
P embedding: [257,128]，PAD row zero=true
joint class: 1,544 frames，B=[767,1523)，rear=21
A embedding nonzero before/after clear: 98,176 / 0
joint class SHA256: 7686d0bf331ff04bed46399759b92270515eed7933f63137c5464544a634024f
joint embedding SHA256: 2dba7ba37a4f589422e72dd5c9ed3b8841c481bf4574aad4677183de24f30c1a
B embedding SHA256: 79a7ac7b6daf3b6b20ae7efb0280d3c531a83b4cc25d64552aab5ba1893642d3
```

`v5p_direct_control.py` 现在是可复用的服务端合同模块，不是一次性探针；它负责相同 frame map、B class
transport、真实 checkpoint embedding 查表和 embedding 后 A prefix 清零。实际报告位于 ignored 的
`data/v5p-direct-midi-audit.json`。

Node 服务端可信预检也已实装于 `synthesis-direct-control.service.ts`：服务端独立重算 frame map 和 MIDI
transport，逐项检查 A/B dense H 与 event provenance、revision、PAD、WAV data 作业路径，并生成 canonical
snapshot SHA；任何前端 frame/class 篡改均拒绝。preset 锁定 40K EMA checkpoint、official VAE、hash-matched
历史 model/VAE config、placement 和五个 P/GAME 模块。对应 3 个新测试通过。

用户随后裁决两个 joint H 外侧 SEP 必须按训练位置放置：A 最后 SEP 位于 B 第一枚发音 token 前一帧，
B 最后 SEP 位于 joint 末帧；其他用户 H 原位不动。若终端为 PUL fallback，PUL 必须连续延伸到新 SEP
前。三端 `synthesisDirectH.ts` / Node preflight / `v5p_direct_control.py` 已实现相同算法，并拒绝 SEP 后
仍有 event、B 首 token 前有无归属结构 token、前端 transport 篡改和已知 sentence/unknown Exact 终端。
HTrack 现保存逐句 placement provenance；完整手工 layer 使用 `user` direct 语义。

### 11.2.1 正式 direct runner 与 Take 已闭合

新增 `v5p_direct_runner.py`。它不运行 Whisper、SOFA、GAME 或训练 renderer，只消费 frozen snapshot 的
joint H 和 MIDI-P；从 checkpoint 加载 `ema_model_state_dict`，固定 `t_shift=0.5`、默认 steps/cfg/seed
为 `32/1/42`，使用 hash-matched config 和 official 20 Hz VAE。Node 已提供：

```text
POST /api/synthesis/v5p/preflight
POST /api/synthesis/v5p/run
GET  /api/synthesis/v5p/jobs/:jobId/take.wav
```

真实短样本门禁：

```text
A/B local samples: 131,072 / 131,072
bStartFrame / joint total: 75 / 160
A SEP / B first lyric / B SEP: 82 / 83 / 159
reference latent: [1,75,64]
generated latent: [1,160,64]
32-step WAV: 131,072 samples, 2.972154s
peak / RMS / nonzero samples: 0.614258 / 0.146866 / 128,210
output SHA256: 9287f0e4685ea62b65c6879abfe1113c1a7c76d274b6402514664dd249f18201
```

Vue 编辑器新增始终可见的“生成 Take”命令、进度、Take 列表、active Take 试听和导出按钮。启动时先向
SynthesisUnit 追加 running Take；成功后将 WAV 复制到项目 blob/AudioAsset 并冻结 revisions、snapshot/model
hash；失败只把该 Take 标为 failed，不修改 Guide 或四条控制轨。ready Take 拒绝二次覆盖。导出复用现有
AudioObject/TrackObject 管线，默认使用 SynthesisUnit 的 `defaultTimelineStart`。

自动验证：

```text
client: 142 tests passed（排除既有缺失 fixture 套件）
server: 27 tests passed + TypeScript build passed
Python: 13 compiler/direct-control/runner tests passed + py_compile passed
```

完整前端仍只有一个既有失败套件：`projectSamples.test.ts` 在测试收集阶段静态导入用户已删除的
`projects/DEMO1` 与 `projects/summerGoingEnd`；其余 38 个 test files、142 个 tests 全部通过。
`vue-tsc` 也只报告这两个缺失 fixture。

### 11.3 文档与 Git

当前主要文档：

- [`v5p-synthesis-unit-integration.md`](./v5p-synthesis-unit-integration.md)：最新权威对象生命周期、A 区、Take 和导出合同；
- [`v5p-token-editor-design.md`](./v5p-token-editor-design.md)：最新权威轨道交互与覆盖语义；
- [`v5p-h-token-catalog-zh.md`](./v5p-h-token-catalog-zh.md)：完整中文 Token 目录；
- 本文：压缩后恢复入口；
- [`v5p-token-editor-concept.html`](./v5p-token-editor-concept.html)：SynthesisUnit Editor V2，真实 Guide 与同源自动生成 fixture 交互沙盘。

HTML 继续作为交互沙盘；AudioObject 创建、Owned Guide 持久化、正式内部编辑器和 A 区参考绑定交互已经进入 Vue 代码。
A 区当前支持完整 Guide/follow-latest 绑定、对象选择、资源树拖入协议、试听、打开、解除以及 undo/redo；
material snapshot、direct-control runner、Take 管理和正式音轨导出均已实装。浏览器已在 L1/L2/右侧面板
同时打开的窄编辑区检查 Generate/Take 控制无重叠；真实 preflight 与 Take WAV 下载 API 已返回成功。

Git 尚未提交。`exports/` 已加入 `.gitignore`，用户明确要求不要提交或上传。

### 11.4 MIDI-P FLOW 编辑语义（2026-08-11）

MIDI-P 轨新增前端专用 `FLOW`：它不占模型 class ID，项目中用显式 `flowFrames` 与普通音高 token 区分，
material snapshot、job manifest 和模型输入仍只消费展开后的 `classes`。只有 GAME 自动提取完整写轨时，才把
连续同 pitch class 的首帧物化为普通 head、后续帧物化为 FLOW；之后绝不再因两个普通 token 相邻且同音高
而动态合并。普通 head 纵向拖动时，其后连续 FLOW 同步变调和改变显示高度；FLOW 分色显示、不能独立拖音高，
但可通过右键与普通 class/REST 相互强制替换。

对应代码集中在 `types.ts`、`synthesisTrackTransactions.ts`、`SynthesisUnitEditor.vue`；键位教学和
`v5p-token-editor-design.md` 已同步。定向 MIDI-P 事务测试 11/11 通过；`vue-tsc` 仍只报告既有的两个缺失
project fixture。

### 11.5 SynthesisUnit 时间线编辑句柄（2026-08-11）

用户实践时纠正了“单元只在资源树”的旧裁决。现在从时间线 AudioObject 右键创建单元后，单元会保存来源
`timelineTrackId` 与 `defaultTimelineStart`；source 存在内部 `trackSources/Synthesis Units`，并创建独立合成单元轨上的 source 指向 SynthesisUnit 的 audio
`TrackObject`，显示为绿色 `SU`。它可拖动改变 Take 导出时间戳，也可从时间线移到静态资源；双击或右键可打开
单元编辑器。旧单元缺少 TrackObject 时会从 Owned Guide 的 source provenance 回查并迁移。TrackObject 不进入
混音、不等同于 Take；Take 仍只有显式导出后才成为普通可播放 AudioObject/TrackObject。音频对象和合成单元菜单
已分别提供创建、删除、复制、定位和移动动作，菜单透明度跟随全局侧栏设置。

## 12. 下一步讨论/实现顺序

V5-P 成熟接入主链已闭合。下一优先级转为增强与回归：

1. 用两个已准备完成的真实 SynthesisUnit 在浏览器执行一次完整按钮 E2E，并保存项目级 Take；
2. Take 重命名、删除、loop/AB 对比和取消作业；
3. MIDI-P run/cell 缩放、多选复制和 run/paste collision policy；
4. 将 one-shot runner 演进为常驻模型 worker，减少每次约 30 秒的模型加载成本。

正式工程顺序仍是：

```text
已完成：Guide asset freeze / canonical job manifest
-> V5-P direct-control runner
-> revision/preflight/Take/export
```

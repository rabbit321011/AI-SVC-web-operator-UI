# V5-P 合成单元编辑器设计

> 状态：2026-08-10 交互冻结稿。
> 本文是当前编辑器对象、轨道所有权和覆盖语义的权威说明。
> SynthesisUnit 在 AI-Midi 中的对象生命周期、A 区与 Take 合同见
> [`v5p-synthesis-unit-integration.md`](./v5p-synthesis-unit-integration.md)。
> 单 HTML 原型：[`v5p-token-editor-concept.html`](./v5p-token-editor-concept.html)。V2 已用真实同源 fixture 表达本文主要交互裁决。

## 1. 目标

V5-P 接入不能停留在“选择几个输入对象后调用 Python”。用户需要一个稳定的工作对象，在实际
模型帧上编辑歌词控制和旋律控制，并确保编辑结果被 runner 原样消费。

当前目标链路是：

```text
SynthesisUnit
  -> 用户显式生成或编辑各条独立轨道
  -> HTokenTrack + MidiPTokenTrack
  -> V5-P direct-control runner
  -> Take
```

编辑器必须满足：

- 用户可以从音频自动得到句级文本或 MIDI-P；
- 用户可以从 Segment 或 Kana 显式生成更深的文字控制；
- 每次自动操作只强制覆盖一个目标轨，其他轨逐对象、逐 frame 保持不变；
- H 与 MIDI-P 共享同一固定模型 frame grid；
- H 普通发音 token 保持单帧稀疏事件，不伪装成持续区间；
- 用户可以直接插入、替换和移动 H token；
- 用户可以逐帧编辑 MIDI-P，并在固定边界内改变音高；
- 所有强制覆盖都可撤销、可审计，并明确记录来源。

## 2. 合成单元 SynthesisUnit

### 2.1 定位

`SynthesisUnit` 是新的用户可见工作对象，界面名称为“合成单元”。用户右键 AudioObject 的有效区间创建
该对象；系统把有效音频复制为项目自有 Owned Guide。创建后即使源 AudioObject 被修改或删除，Guide
也保持不变。

SynthesisUnit 不依赖 TextObject。它持有 Owned Guide、独立控制轨、固定 frame contract、A 区参考绑定、
revision 和 Takes：

```ts
interface SynthesisUnit {
  id: string
  name: string

  guideAssetId: string
  guideAudioSHA256: string
  sourceAudioObjectId: string
  defaultTimelineStart: number | null
  referenceUnitId: string | null

  sampleRate: 44100
  hopSamples: 2048
  frameRate: number
  frameCount: number

  segmentTrack: SegmentTrack
  kanaTrack: KanaTrack
  hTokenTrack: HTokenTrack
  midiPTokenTrack: MidiPTokenTrack

  unitRevision: number
  takes: RenderTakeRef[]
}
```

Guide 的项目资产由 SynthesisUnit 语义所有，但仍通过现有 AudioAsset/project blob 存储，不把 PCM、模型
checkpoint 或所有中间审计嵌入一个巨型 JSON。现有 TextObject 与旧 Whisper 链路保留兼容，但不是新
SynthesisUnit 内部链路的一部分。

### 2.2 编辑页面

双击 `SynthesisUnit` 打开本文讨论的专用编辑页面。编辑器本地时间线从合成目标音频的 0 开始，
所有轨道共享：

- 播放头；
- 循环选区；
- 时间缩放；
- frame grid；
- 固定起止边界；
- undo/redo；
- 当前 Take 对照。

编辑器顶部或检查器提供 A 区参考槽，从左侧资源栏拖入另一个 SynthesisUnit。A 始终提供其完整 Owned
Guide 和当前文字/H revision，不允许使用 Take 或局部 range。编辑器主要编辑当前单元的 B-local 控制；
打包给 runner 时由 `ABFrameMap` 映射到全局 A/B tensor，并继续清零 A 区 MIDI。

## 3. 独立轨道模型

### 3.1 信息结构

建议的视觉分组是：

```text
Source
  Guide Audio

Text
  Segment
  Kana
  H Token

Melody
  MIDI-P Token
```

音频放在 `Source`，而不是严格归入 Melody，因为它既可以产生 Segment，也可以产生 MIDI-P。

### 3.2 轨道不是父子数据树

四条控制轨都是独立、已经物化的数据：

```text
SegmentTrack
KanaTrack
HTokenTrack
MidiPTokenTrack
```

它们可以在时间上对应，也可以记录 `generatedFrom`，但不形成“父轨改变就自动重写子轨”的强父子
关系。

核心规则：

```text
一次自动操作
  -> 读取一个源对象或源轨
  -> 只替换一个目标轨的明确范围
  -> 其他轨完全不变
```

因此以下情况都是合法的：

- 当前 H 是由 Segment r12 生成，而 Kana 轨后来被用户修改；
- 当前 Kana 来自旧 Segment，但用户保留它作为另一种发音方案；
- 当前 MIDI-P 来自 GAME，Segment/H 来自手工编辑；
- 用户直接修改 H，而不反写 Kana 或 Segment。

Inspector 需要说明来源差异，但不能因为轨道不一致而自动覆盖或禁止用户继续编辑。

## 4. Frame 合同与固定边界

当前 V5-P 合同是：

```text
sampleRate = 44100
hopSamples = 2048
frameRate  = 44100 / 2048 = 21.533203125 Hz
frameDuration ~= 46.4399 ms
```

整数 `frame=k` 表示 dense tensor 第 `k` 个 cell：

```text
sampleStart       = k * 2048
sampleEndExclusive = (k + 1) * 2048
timeStart         = k / frameRate
timeEndExclusive  = (k + 1) / frameRate
```

UI 中：

- 竖线是 frame boundary；
- H token 位于所属 frame cell 的中心；
- MIDI-P 填满整个 frame cell；
- H/MIDI-P 不能停在半帧；
- `frameCount` 由权威音频/VAE frame contract 冻结；
- 用户不能把 H 或 MIDI-P 拖出 `0..frameCount-1`；
- 前端不能自行散落 `round/floor/ceil`，必须调用共享量化 adapter。

SOFA 连续秒、GAME 100 Hz region 与 V5-P 21.533 Hz frame 必须分开保存。编辑器最终控制以
V5-P frame 为准，原始秒数只作为来源证据和显示信息。

## 5. Segment 轨

### 5.1 对象单位

Segment 的对象单位是一句：

```ts
interface SegmentObject {
  id: string
  text: string
  kana: string
  romaji: string

  startFrame: number
  speechEndFrameExclusive: number

  sourceOnsetSeconds?: number
  sourceEndSeconds?: number
  origin: 'whisper-sofa' | 'imported' | 'user'
  revision: number
}
```

双击 Segment 打开与当前 TextObject 相近的编辑浮窗，允许编辑：

- 原句文本；
- kana；
- romaji；
- 句首和句尾；
- 来源和备注。

Segment 轨还应支持选择、整体移动、边界调整、分句和合句。分句优先吸附到合法 Kana/mora 或
播放头位置，但不会自动改写 Kana/H。

Segment 左右边界使用明确的水平拖动手柄。拖动只修改 SegmentTrack：

- 左边界改变 `startFrame`；
- 右边界改变 `speechEndFrameExclusive`；
- 不允许越过相邻 Segment 或形成负时长；
- owned H range 的可视高亮随 Segment start/next start 重新计算；
- 已经物化的 Kana/H/MIDI-P 数据逐 frame 不变；
- pointer release 时合并为一次 SegmentTrack revision 和一次 undo。

### 5.2 发声范围与 H 控制范围

Segment 同时涉及两个不同范围：

```text
speech range
  = [startFrame, speechEndFrameExclusive)

owned H range
  = [startFrame, nextSegment.startFrame)
  = 最后一句时 [startFrame, SynthesisUnit.frameCount)
```

原因是当前 PH/H-PUL runtime 使用：

```text
SEP_i = next Segment anchor - 1
最后一句 SEP = 最后一个有效 frame
```

因此句末实际发声结束到下一句开始之间的 gap 仍属于前一句的 H 控制尾部。该区域可能包含：

- 普通 phone placement 下的 `0` filler；
- fallback 下连续的 `PUL`；
- 下一句前一帧的 `SEP`。

UI 应把 `speechEndFrameExclusive` 到 `ownedHEndFrameExclusive` 显示成低对比 control tail，不能让
用户误以为它仍是实际发声区间。

### 5.3 Segment 右键菜单

右键单个 Segment：

```text
自动对齐至 Kana
自动对齐至 H token
```

两项都是显式、强制、局部的目标轨替换操作，详见第 10 节。

## 6. Kana 轨

### 6.1 对象单位是 mora/KanaUnit

界面名称可以继续叫 Kana，但数据对象必须按发音单位保存，而不是按 Unicode 字符保存：

```text
きゃ = 一个 KanaUnit
っ   = 一个 KanaUnit
ん   = 一个 KanaUnit
长音 = 按当前 runtime 规范化结果保存
```

建议 schema：

```ts
interface KanaUnit {
  id: string
  kana: string
  romaji: string
  startFrame: number
  endFrameExclusive: number
  origin: 'segment-align' | 'imported' | 'user'
  revision: number
  generatedFrom?: SourceRevisionRef
}
```

双击 KanaUnit 打开编辑浮窗，允许直接编辑 kana 和 romaji。修改 Kana 只修改本对象，不自动改变
Segment 或 H。

KanaUnit 左右边界允许水平拖动。普通相邻 Kana 共用同一边界：拖动前一 Kana 的右边界时，同时把
后一 Kana 的左边界设为同一个 frame，避免产生无法解释的重叠或空洞。Kana `SEG` 两侧不自动联动，
不能把普通边界拖过 SEG。整个操作只创建 KanaTrack revision，Segment/H/MIDI-P 不变。

### 6.2 Kana 轨自己的 SEG

由于各轨独立，Kana 不能依赖当前 SegmentTrack 才知道分句。KanaTrack 必须保存自己的分句结构：

```ts
interface KanaSegmentBoundary {
  id: string
  frame: number
  kind: 'SEG'
  origin: 'segment-align' | 'imported' | 'user'
}
```

`SEG` 是 Kana 轨结构对象，不是发音 token：

- 不进入 G2P；
- 不计入普通 KanaUnit 数量；
- 不使用 H vocab ID；
- Kana -> H 时编译为对应句的 `<SEP=365>` 结构；
- 可以由用户移动、插入、删除以维护 Kana 轨自己的分句。

### 6.3 Kana 右键菜单

右键单个 KanaUnit：

```text
自动对齐至 H token
```

该操作只替换 H 轨中当前 Kana 对应的局部 frame 范围；Segment、Kana 和 MIDI-P 不变。

## 7. H Token 轨

### 7.1 实际训练表示

V5-P 普通发音 token 是单帧稀疏事件，不是 duration-expanded token：

```text
正确：k 0 0 i 0 0 0
错误：k k k i i i i
```

训练入口实际执行：

```text
render_h_pul_placements(...)["phone_pul"]["text"]
  -> torch.tensor(...)
  -> DiT text condition
```

renderer 先建立全 `0` dense 数组，再把普通歌词 token 各写入一个 frame。普通 token 相邻重复只能
表示歌词序列里存在两个独立同符号事件，不能解释为一个 token 的持续填充。

特殊值：

```text
0       本 frame 没有显式歌词事件；不是静音
365     SEP，单 frame
366     PUL，fallback 时可以连续占据多个 frame
```

因此 UI 规则冻结为：

- 普通 H token：单 frame chip/anchor；
- SEP：单 frame 结构标记；
- PUL：逐帧真实保存，低缩放时允许合并成视觉 run；
- 0：只显示为空 frame 背景，不画 token 实体；
- 不保留独立 Phone lane；
- 不给普通 H token 画持续音素块。

### 7.2 H 操作

H token 支持：

- 单击选择；
- 横向拖动到另一个整数 frame；
- 右键任意 frame 打开 Token Picker；
- 在空 frame 插入；
- 在已占用 frame 强制替换；
- 清除当前显式事件，恢复为 `0`；
- 多选后整数 frame 平移；
- 恢复本次自动操作之前的 revision；
- 查看来源和 runtime 审计。

双击 H token 等价于右键，直接打开 Token Picker。

普通拖动落到已占用 frame 时默认阻止，不能静默删除目标 token。用户必须通过“强制替换”明确承担
覆盖语义。操作不能把相邻 token 自动向右挤，因为训练 placement 已证明贪心顺延会产生大范围级联。

### 7.3 Token Picker 与悬浮信息

H token 悬浮和选择状态至少显示：

```text
中文名称/发音作用
中文近似说明
romaji
kana 上下文
runtime symbol
runtime token ID
frame / sample range
来源 revision
当前 V5-P preset 是否训练见过
vocab/checkpoint hash
```

默认 pronunciation palette 只展示 V5-P 40K 训练见过的 36 个发音 token。标点、`0/SEP/PUL` 和
Raw/Diagnostic 分组独立，完整口径见
[`v5p-h-token-catalog-zh.md`](./v5p-h-token-catalog-zh.md)。

## 8. MIDI-P 轨

### 8.1 已确认合同

当前代码和训练文档确认：

```text
class 0..254 = MIDI 0..127，0.5 半音一个 class
class 255    = REST
class 256    = PAD
embedding    = 257 x 128
```

有效合成范围内每个 frame 都有一个 class，不存在与 H 的 `0` 相同意义的“空白 MIDI-P frame”。
视觉空白应明确解释为 REST 或其他已知 class；PAD 是 batch/无效区域语义。

编辑器另有一个不属于模型 vocabulary 的 `FLOW` token。它表示“继承本音符头 token 的音高”，项目内以
显式 `flowFrames` 保存，发给 runtime 前则展开为逐 frame 的真实 pitch class。`FLOW` 绝不能占用新的
MIDI-P class ID，也不能出现在 material snapshot、job manifest 或模型输入中。

只有 `Guide -> GAME` 自动提取结果写入完整 MIDI-P 轨时，才把连续相同 pitch class 的首帧保存为普通
头 token、后续帧保存为 `FLOW`。完成这次物化以后，编辑器不得再根据相邻 class 相等动态推断 FLOW：
相邻两个同音高普通 token 仍是两个音符，只有 `flowFrames` 中的帧才属于前一个头 token。

仍需由 direct-control fixture 最终冻结：

- SynthesisUnit 的 B-local `frameCount` 与 VAE encode shape；
- 音频边界到最后一个 MIDI-P frame 的闭合；
- A 区 MIDI 清零和 B-local layer 的打包；
- runner 是否存在未记录的 class clamp/shape 处理。

### 8.2 MIDI-P 操作

MIDI-P token 支持：

- 单 frame 或连续选区选择；
- 横向拖动改变 frame；
- 上下拖动改变 pitch class；
- 每个垂直 class 步进为 0.5 半音；
- 绘制连续 pitch；
- 写入 REST；
- 显式写入 FLOW；
- 右键任意 frame 强制替换 class；
- 恢复 GAME 自动结果；
- 选区复制、平移和重采样；
- 固定在 `0..frameCount-1` 内，禁止越界。

单个 dense cell 的横向移动语义现冻结为：

```text
targetFrame <- source pitch class（允许拖动时同时上下改 pitch）
sourceFrame <- REST=255
其他 frame   <- 逐 frame 不变
```

MIDI-P 没有 H 那样的空 frame，因此不能“删除 source cell”；写 REST 是模型合同内唯一明确的无音高结果。
目标若只有 GAME/自动数据，拖动本身就是显式覆盖意图；目标若已经是手工 frame，先显示二次确认，确认后才
强制覆盖。整个操作只创建一个 MIDI-P revision，affected range 为 source/target 的最小包围区间，一次 undo
同时恢复源和目标。它不是 run 平移，也不挤动或交换中间 frame。

所有改变 pitch class 的交互都必须提供提交前音高试听：

- 上下拖动跨入新的 class 时立即播放该 class 的短钢琴音；
- 右键强制替换时，滑杆、`+0.5/-0.5` 和候选选择均即时试听；
- 提交替换时再次播放最终 class；
- REST/PAD 不发音；
- 连续快速拖动只在 class 实际变化时重触发，并做最小节流，避免同一 class 疯狂叠音。

普通头 token 与其后连续的显式 FLOW 组成一个编辑器音符。上下拖动头 token 时，整条 FLOW 链同步改变
显示高度和展开后的 pitch class；FLOW 使用不同颜色并在悬浮说明里指向 head frame。FLOW 本身不允许
独立拖动音高，用户应拖头 token；右键可把某帧显式改为普通 token、FLOW 或 REST。

同 pitch class 不是合并依据。低缩放时只允许把“头 token + 显式 FLOW 链”合并成 run，不能把两个相邻
同音高普通 token 合并。Piano-roll/note overlay 可以作为 MIDI-P 的派生编辑视图，但不能在没有明确规则时
反写原始 MidiObject。

### 8.3 Audio 右键菜单

右键 Guide Audio：

```text
GAME 自动生成 MIDI-P token
自动转录为 Segment
```

前者只覆盖完整 MIDI-P 轨；后者执行当前 Whisper + SOFA 句级转录/对齐，只覆盖完整 Segment 轨。

## 9. 自动操作矩阵

所有自动操作都遵守“单源、单目标、单范围”：

| 源 | 菜单操作 | 目标轨 | 覆盖范围 | 明确保持不变 |
|---|---|---|---|---|
| Audio | GAME 自动生成 MIDI-P | MIDI-P | 完整固定 frame 范围 | Segment/Kana/H |
| Audio | 自动转录为 Segment | Segment | 完整 SegmentTrack | Kana/H/MIDI-P |
| Segment | 自动对齐至 Kana | Kana | 当前 Segment speech range | Segment/H/MIDI-P |
| Segment | 自动对齐至 H token | H | 当前 Segment owned H range | Segment/Kana/MIDI-P |
| Kana | 自动对齐至 H token | H | 当前 Kana control range | Segment/Kana/MIDI-P |

不存在以下隐式行为：

- Audio -> Segment 后自动删除 Kana/H；
- Segment -> Kana 后自动重建 H；
- Segment -> H 后把临时 kana 写入 KanaTrack；
- Kana 修改后自动覆盖 H；
- H 修改后反写 Kana/Segment；
- MIDI-P 修改后反写 Guide Audio。

## 10. 对齐与强制覆盖事务

### 10.1 Segment -> Kana

```text
输入：单个 Segment + Guide Audio
处理：使用该 Segment 的文字/kana 和句级时间约束执行 Kana/mora 对齐
输出：KanaUnit + KanaSegmentBoundary
目标：KanaTrack 当前 Segment speech range
```

执行时清除目标范围内旧 Kana 对象和 Kana SEG，再写入新结果。H 不变，即使它与新 Kana 不一致。

### 10.2 Segment -> H

该操作必须与当前 PH 通路使用相同权威模块和参数：

```text
Segment text/kana
  -> 临时 kana/mora
  -> 当前 SOFA 路线
  -> 当前 Japanese runtime tokenizer
  -> 当前 placement/H-PUL renderer
  -> H frames
```

中间 kana 只存在于本次 job snapshot，不写入 KanaTrack。

为保持与当前 PH renderer 一致，job 可以只把当前 Segment 视为待替换对象，但计算时必须读取完整
SegmentTrack 作为只读边界上下文。最稳妥的门禁实现是：

```text
完整 Guide Audio + 完整 SegmentTrack
  -> 在临时缓冲运行权威 PH renderer
  -> 只截取当前 Segment owned H range
  -> 只替换 HTrack 的该范围
```

这样 next Segment anchor、最后一句边界、SEP、PUL、跨句容量和 runtime anomaly 仍按当前 PH 解释，
但临时缓冲中其他 Segment 的 H 结果全部丢弃，绝不写入当前 HTrack。相邻 Segment 只是计算上下文，
不是本次操作的第二个目标。

覆盖范围严格是：

```text
[Segment.startFrame, nextSegment.startFrame)

最后一个 Segment：
[Segment.startFrame, SynthesisUnit.frameCount)
```

执行步骤：

```text
1. 冻结源 Segment revision 和音频 hash
2. 计算并在 UI 高亮精确目标 frame 范围
3. 保存目标 H 旧范围，形成 undo revision
4. 在临时缓冲区运行完整 PH 同构流程
5. 检查所有输出均落在目标范围
6. 清空目标范围为 0
7. 写入新 H/SEP/PUL 和逐 frame provenance
8. 原子提交 HTrack revision
```

任何输出越过目标范围、容量不足、出现非法 token 或 runtime hash 不一致时，整个事务失败。失败不能
写入半条 H，也不能把 token 挤入相邻 Segment。

### 10.3 Kana -> H

右键单个 KanaUnit 时，唯一目标轨仍是 HTrack。目标覆盖范围已经冻结为：

```text
普通 KanaUnit：
[currentKana.startFrame, nextKana.startFrame)

分句最后一个 KanaUnit：
[currentKana.startFrame, currentKanaSegmentBoundary)
```

这里不能把最后一个 Kana 的 `endFrameExclusive` 当作控制结束。`endFrameExclusive` 是 SOFA 给出的实际
发声范围，而 Kana `SEG` 是该句 H 控制所有权的结束边界；两者之间的 control tail 允许保存句末 `SEP`。
KanaTrack 因而必须按自身 `KanaSegmentBoundary/SEG` 形成完整分句，即使当前只物化了第一句 Kana、后续
Kana 尚未生成，也必须保留第一句的终止 SEG。

正式计算不是只把一个假名孤立送进 G2P。它冻结完整 Guide 和当前 KanaTrack revision，将 KanaUnit 按
SEG 组合成分句，再把完整分句送入当前 SOFA、Japanese tokenizer、训练侧 monotonic solver 和
`render_h_pul_placements()`。每个分句请求都携带：

```text
startFrame
speechEndFrameExclusive
controlEndFrameExclusive = 对应 Kana SEG；最后一句为 frameCount
```

`controlEndFrameExclusive` 是训练 renderer 的候选 dense horizon。局部 KanaTrack 只含第一句时，如果仍把
整个 SynthesisUnit 的 `frameCount` 作为最后一句 horizon，训练 renderer 会把该句 `SEP` 错放到完整 Guide
末帧。正式 adapter 只在临时候选层收缩这一 horizon，不修改权威 placement/renderer 的实现。

候选返回后必须依次通过以下门禁，任意一项失败都不写 H：

1. Guide SHA、frameCount、Kana revision、H revision 和所选 control range 与启动快照一致；
2. 只接受 `placementMode=phone`；PUL/Exact/fallback 建议改用整句 Segment -> H；
3. SOFA 返回的 mora 数量与当前分句 KanaUnit 数量完全一致；
4. 每个 mora 经 NFKC、片假名转平假名和空白清理后，必须与当前 KanaUnit 逐项一致；
5. 所选普通 H event 必须精确携带当前 `moraIndex`，且全部位于所选 control range；
6. 相邻 mora 的 event 不得侵入所选 control range；
7. 分句末 Kana 必须在范围内恰有一个 `SEP`，非句末 Kana 不得包含 `SEP`。

提交时只收集所选 `moraIndex` 的普通 H event；若为句末，再加入唯一 `SEP`。随后只清空并替换上述
单 Kana control range，其他 H frame 和 Segment/Kana/MIDI-P revision 保持不变。普通 H 与 SEP 仍都是
单 frame 稀疏事件。手工 H 覆盖继续使用 10.4 的确认与单次 undo 事务。

### 10.4 覆盖确认、撤销与来源

右键菜单本身表达了用户主动覆盖意图。目标范围仅含自动数据时可以直接执行；若范围内含用户手工
编辑，执行前显示：

```text
将覆盖 frame 120..184
普通 H token 12 个
手工修改 4 个
SEP 1 个
PUL 0 帧
```

每次操作产生一个仅属于目标轨的新 revision。其他轨 revision 不变。成功后必须支持一次 undo 完整
恢复旧范围。

## 11. 选择、播放与检查器

### 11.1 选择联动

选择对象时只建立视觉上下文，不改变其他轨数据：

- 选择 Segment：高亮其 speech range、owned H range 和时间上重叠的 Kana/H/MIDI-P；
- 选择 Kana：高亮相邻 Kana SEG、同范围 H 和 MIDI-P；
- 选择 H：高亮所在 Segment/Kana 的时间对应关系；
- 选择 MIDI-P：显示当前 frame 的音频、Segment/Kana/H 上下文。

这里的高亮是时间查询，不表示对象拥有关系。

### 11.2 播放

编辑器至少支持：

```text
Owned Guide Audio
MIDI-P preview
Rendered Take
```

空格播放使用显式试听源选择：

```text
Guide Audio
MIDI-P Piano
```

用户切换试听源后，空格播放/暂停始终作用于当前选择。Guide 模式播放 SynthesisUnit 自有的 Guide；
当前 HTML 原型已经接入真实 44.1 kHz 双声道 MP3 的固定编辑窗口。MIDI-P 模式按 dense class 的连续 run 触发
Web Audio 钢琴式音色，REST 不发声。

MIDI-P preview 应按连续 run 保持音高，只在 class/REST 改变时更新合成器，不能把每个 46 ms cell
都播放成独立短音。

### 11.3 检查器

右侧 Inspector 只显示当前选中对象和有效命令，不同时堆叠所有轨的按钮。至少包含：

- 对象/track revision；
- frame、时间和 PCM sample range；
- origin/generatedFrom；
- 当前值与自动来源值；
- 强制替换、恢复、删除；
- runtime/preset/hash；
- 局部覆盖范围预览。

## 12. 推荐轨道顺序

从上到下：

```text
Frame / Time ruler
Guide Audio waveform / F0
Segment
Kana
H Token
MIDI-P
Take / Comp（后续）
```

不再保留独立 Phone lane。Piano roll 是否作为 MIDI-P 的展开视图单独占一行，待 MIDI-P
direct-control fixture 和实际编辑测试后裁决。

## 13. Revision 与 provenance

每条轨有独立 revision：

```ts
interface TrackRevision {
  id: string
  track: 'segment' | 'kana' | 'h' | 'midi-p'
  parentRevisionId?: string
  operation: string
  sourceRefs: SourceRevisionRef[]
  affectedStartFrame: number
  affectedEndFrameExclusive: number
  createdAt: string
}
```

自动操作必须快照：

- SynthesisUnit ID/revision；
- Owned Guide hash；
- source object/track revision；
- target old revision；
- target frame range；
- SOFA/GAME/tokenizer/adapter 版本；
- preset/checkpoint/vocab hash；
- 输出 hash和审计。

由于其他轨不随目标轨变化，不能用单一全局 `controlOrigin` 推断所有关系。每个对象/frame 应保存自己
的 origin，跨轨关系由 `generatedFrom` 表达。

## 14. Preflight

生成 V5-P Take 前至少检查：

- `frameRate/hopSamples/frameCount` 与 preset 一致；
- H 和 MIDI-P 长度与 SynthesisUnit 固定边界一致；
- H token ID 合法；
- 普通 H token、SEP 和 PUL 均位于合法 frame；
- H 插入/拖动没有未经确认的同帧覆盖；
- MIDI-P class 只在 `0..256`；
- 有效 B 区没有意外 PAD；
- H/MIDI-P runner 输入 hash 与编辑器确认 layer hash 一致；
- 当前 target revision 没有被后台旧 job 覆盖；
- Segment/Kana/H 的来源差异只作为可见审计，不被偷偷“修复”。
- 已绑定另一个 SynthesisUnit 作为 A，且不存在自身/循环引用；
- A 使用完整 Owned Guide，当前 H/Text revision 合法；
- A snapshot 使用最新 revision，且 Take 记录实际 Guide/H hash；
- A 区 MIDI 按训练合同清零；

轨道之间文字不一致默认是警告而不是硬失败。真正生成 V5-P 时，H 和 MIDI-P 是直接控制事实；
Segment/Kana 主要负责编辑来源、解释和再次编译。

## 15. HTML V2 交互沙盘

`v5p-token-editor-concept.html` 已升级为 `SynthesisUnit Editor V2`，使用真实 Guide 与同源自动生成 fixture
表达当前裁决：

1. 轨道按 Source/Text/Melody 分组；
2. 增加 Segment，并显示 speech range、control tail 和 SEP frame；
3. Kana 以 mora/KanaUnit 显示，并保留独立 `SEG` marker；
4. 删除 Phone 轨，普通 H 只显示单 frame token；
5. Audio 右键可演示 GAME -> MIDI-P、Whisper+SOFA -> Segment；
6. Segment 右键可演示 Segment -> Kana、Segment -> H；
7. Kana 右键可演示 Kana -> H；
8. 自动操作先高亮唯一目标轨范围，再显示 frame 和手工覆盖统计；
9. 强制覆盖只提升目标轨 revision，状态栏明确显示其他轨不变；
10. Segment/Kana 双击可编辑文字、kana、romaji 和 frame；
11. H 空 frame 和已有 token 均可打开含 36 个训练内发音 token 的中文 Picker；
12. H 可横向拖动，落到已占用 frame 时阻止并要求显式强制替换；
13. MIDI-P 可右键强制替换、写 REST，并演示 0.5 半音上下拖动；
14. undo/redo 按语义操作恢复完整目标轨 revision；
15. Inspector 显示 frame、PCM、来源、训练暴露和各轨 revision。
16. Guide/MIDI-P 试听源可切换，空格播放当前选择；
17. MIDI-P 上下拖动和强制替换候选使用 Web Audio 钢琴式即时试听；
18. Segment/Kana 边界可拖动，并只提升本轨 revision。
19. Guide 接入真实源音频窗口，并使用该窗口的实际解码采样绘制 waveform、驱动播放头。

当前原型音频资产：

```text
源：E:\AIscene\AISVC-midi-web\exports\对比数据集_MSST人声_20260726_235533\鹿乃-温柔.mp3
网页引用：../exports/对比数据集_MSST人声_20260726_235533/鹿乃-温柔.mp3
窗口：源文件 0.000000–2.972154 s，即 64 * 2048 = 131072 PCM samples
格式：44100 Hz / stereo / MP3
完整时长：35.116667 s
源文件 SHA256：bef02450e8ab7daf26c35065667f42fe45f023047b3a500baa090eb40ae6383f
```

窗口长度与 64 个 V5-P frame 精确闭合。Guide 播放时，HTML 以
`sourceOffset + frame / frameRate` 定位 media，并以 `currentTime - sourceOffset` 计算当前 frame；
waveform 来自源 MP3 对应窗口的实际解码采样，不再使用合成波形或伪造 F0 占位。MP3 留在 git ignored
的 `exports/`，不复制进 `docs/`、不提交。

原型中的 Segment/Kana/H/MIDI-P 也必须与 Guide 同源。当前固定 fixture 的生成链为：

```text
源 MP3 的 samples [0, 131072)
  -> Whisper large-v3: 夏の温度に溶けて / なつのおんどにとけて
  -> SOFA JPN_Test2_Plus: Segment + phone intervals
  -> mora grouping + 训练侧 monotonic solver: 10 KanaUnit
  -> Japanese IPA/vocab + 训练侧 monotonic solver: 18 H phones + SEP
  -> GAME medium K=4 + game_cache_to_model_tracks(target_len=64): 64 MIDI-P classes
```

输出摘要：Segment frame `8..63`，SOFA confidence `0.599706`，H 共 19 个单帧事件（含 `SEP`），
MIDI-P 开头 9 帧为 REST。GAME 使用冻结 commit
`4ad815c90dfe2442730f3fdc866fd23e737cbc97`、模型 SHA256
`e9904159fb0646e1a352b9d2bc74615547cfa3e32d45c7464d440ac142846d93`、effective seed
`743440497`。中间产物和复现脚本只保存在 git ignored 的 `exports/v5p-token-editor-generated/`。

当前单 HTML 只验证 SynthesisUnit 内部轨道编辑，不演示 AudioObject 右键创建、Owned Guide 持久化、
参考 SynthesisUnit 拖放、Take 列表和正式音轨导出。外围工作流已经在集成规范中冻结；AudioObject 创建、
Owned Guide 持久化、内部 Vue 编辑器和 A 区参考绑定交互现已实装，Take 和导出仍待实现。

正式 Vue 编辑器的 A 区槽支持从资源树拖入 `application/x-aisvc-node-id`、选择器选择完整
SynthesisUnit、试听参考完整 Guide、打开参考单元、解除绑定和 undo/redo。槽位显示参考 unit/H revision、
Guide 时长、`follow-latest` 状态以及 Segment/H 是否已准备。对象层拒绝自身绑定和传递循环；这只是绑定与
编辑入口，A material snapshot、A MIDI 清零和 V5-P preflight 仍属于后续 direct-control 阶段。

已用浏览器验证 Segment -> H 只改变 H revision、H Picker 插入、Segment 双击编辑、MIDI-P
`class 120 -> 121/C4+50`、MIDI-P/Guide 空格试听、H 横向拖动、占用 frame 碰撞阻止、Segment/Kana
边界拖动、真实 Guide 播放和 undo。原型只用于桌面交互讨论，不作为产品级响应式布局、正式
schema、runner 或 tensor 一致性的验收证据。

### 15.1 正式 Vue Text 侧实现门禁（2026-08-10）

正式 `SynthesisUnitEditor.vue` 已实现并用完整 35.1 秒真实 Guide 验证：

```text
Guide -> Whisper/SOFA -> 9 Segment
第一 Segment -> 20 KanaUnit，只提升 Kana revision
第一 Segment -> 33 发音 H + SEP，只提升 H revision
SEP frame 127，下一 Segment start frame 128
第二 Segment -> H 只覆盖 [128, nextStart)，第一句 H 保持不变
undo 恢复第二次 H 局部事务
```

同一真实 Guide 的 Kana -> H 门禁也已闭合。只生成第一句 Kana 时，轨道仍保存句末 Kana SEG：

```text
Owned Guide samples: 1,548,645
frameCount: 756，trailing samples: 357
第一句: start=7，speechEnd=115，controlEnd/next Segment start=128
KanaUnit: 19
最后一个 Kana「な」control range: [104, 128)
训练候选: n/46@104，a/211@108，SEP/365@127
phrase placement: phone
```

该分句共生成 34 个 H event，且 `controlEndFrameExclusive=128` 将最后 `SEP` 固定在 127；未提供此边界的
旧实现会误将它放到完整 Guide 的 frame 755。浏览器中先把 `n@104` 手工替换成 `m@104`，再运行 Kana -> H，
确认覆盖后恢复 `n@104` 并只提升 H revision；一次 undo 恢复手工 `m@104`，Segment/Kana/MIDI-P 始终保持
原 revision。浏览器控制台无 error。

Segment 同时支持右键和省略号按钮打开同一命令菜单。省略号不是第二套操作语义，而是给不知道右键
手势的用户提供可发现入口。目标范围含 `origin=user` 对象时，提交前显示精确 frame 范围、对象总数和
手工对象数；确认后仍只写一个目标轨。

正式 Text Control 服务一次计算完整 Kana/H 候选，但不会因此提交两条轨。客户端按用户命令只截取：

```text
Segment -> Kana: [startFrame, speechEndFrameExclusive)
Segment -> H:    [startFrame, nextSegment.startFrame)
last Segment H:  [startFrame, frameCount)
```

候选由 `v4h_prepare_job.py mode=b_only`、当前 V5-P Japanese/vocab、训练侧
`solve_monotonic_frames` 和 `render_h_pul_placements` 生成。服务端校验 Guide SHA/sample/frame 合同，
客户端冻结 Guide hash、frameCount、Segment revision 和目标轨 revision；任何一项在任务期间变化都拒绝
旧结果。相同源 snapshot 的候选可在当前编辑会话复用，以免 Kana/H 连续操作重复运行 SOFA，但第二条轨
仍必须显式点击后才写入。

Kana 正式支持双击编辑 kana/romaji。相邻 mora 的普通共享边界可拖动到整数 frame，一次事务同时修改
左侧 end 与右侧 start；SEG frame 两侧禁止通过普通共享边界跨越。Kana 编辑不改 Segment/H/MIDI-P。

### 15.2 正式 Vue MIDI-P 实现门禁（2026-08-10）

正式 `Guide -> MIDI-P` 使用：

```text
Owned Guide WAV
  -> GAME 1.0 medium / K=4 / language=ja / stable file-SHA seed
  -> durations + presence + scores + pitch posterior
  -> canonicalize_game_cache
  -> game_cache_to_model_tracks(num_samples, target_len=frameCount)
  -> dense B-local class[frameCount]
  -> 编辑器一次性物化 head token + flowFrames
```

服务端锁定 GAME commit `4ad815c...`、model SHA `e990415...` 以及 runtime/cache/P adapter SHA；
有效 B-local 结果只接受 pitch `0..254` 与 REST `255`，PAD `256` 立即拒绝。Owned Guide 同样执行
SHA、44.1 kHz 和 `floor(sampleCount/2048)` 门禁。

真实 35.1 秒 Guide 得到 756 个 class、120 个 region、104 个 voiced note、148 个 REST frame、PAD 0，
pitch class 范围 `119..150`。正式 seed `2577097735` 来自训练侧相同的文件 SHA 规则。

正式 MIDI-P lane 当前提供：

- 根据当前 pitch 范围绘制逐 frame 音高轮廓，REST 单独落在底部；
- GAME 写轨时一次性生成显式 FLOW；普通头 token 与 FLOW 分色显示；
- 头 token 纵向变调时只带动其显式 FLOW 链，相邻同 class 的普通 token 不会被误合并；
- 右键任意 cell 打开 class/音名替换浮窗；
- `+/-` 每次改变一个 class，即 0.5 半音，并即时播放短钢琴音；
- 上下拖动每 6px 改变一个 class，跨入新 class 时试听；
- FLOW/REST 都可显式写入；FLOW 只在前端存储，REST 展开为 255；
- Guide/MIDI-P 试听源切换，空格播放当前源；MIDI-P 按连续同 class run 触发音符；
- `manualFrames` 保存逐 frame 手工来源，重跑 GAME 前显示完整覆盖范围与手工 frame 数；
- 每次替换/拖动只提升 MIDI-P revision，undo 可逐操作恢复。

正式界面现已实现单 dense cell 的水平移动：目标接收 source pitch，源写 `REST=255`，中间 frame 不变；
可在同一次拖动中上下改变 0.5 半音 class。自动目标直接覆盖，手工目标弹出二次确认，操作只提升 MIDI-P
revision 并可一次 undo。真实 756-frame GAME 轨已验证 `frame 9/F4 -> frame 12`、源 REST、目标覆盖、
手工目标确认、垂直 class `130 -> 132` 和逐次 undo。run 级平移、多选复制和粘贴 collision policy 仍未冻结。

## 16. 实现顺序

```text
1. [完成] 冻结 SynthesisUnit 与四条独立 track schema
2. [完成] 实现 AudioObject 有效区间 -> Owned Guide 的创建命令
3. [部分] B-local frameCount 与 frame-aligned ABFrameMap 已完成；direct-control tensor fixture 待完成
4. [完成] 实现 track-local replace transaction 和 revision 测试
5. [完成] 实现 Audio -> Segment / Audio -> MIDI-P adapter
6. [完成] 实现 Segment -> Kana / Segment -> H adapter
7. [完成] 冻结并实装 Kana -> H 的局部 frame 边界合同
8. [交互已完成] 实现参考 SynthesisUnit 的完整 Guide/follow-latest 绑定；material snapshot 待完成
9. [Text 侧完成] 实现正式 SynthesisUnit Editor
10. 让 V5-P runner 直接消费确认后的 A/B H 与 B MIDI-P layer
11. 补 Take、导出正式音轨、比较、undo/redo 和完整审计
```

正式代码不能先做一个可编辑 UI，再让 runner 从旧 Segment/GAME cache 重建 H/MIDI-P。只有 runner
实际消费当前目标轨 revision，单轨独立编辑才成立。

## 17. 尚未冻结

以下问题继续讨论，不在本文伪装成已经裁决：

1. MIDI-P 的正式 piano-roll 交互以及 run/cell 两种缩放视图；
2. Segment 整体拖动是否只移动 Segment，还是提供显式“同时移动所选其他轨”的多轨命令；
3. H/MIDI-P 多选、run 级移动、复制和粘贴时的 collision policy；
4. Segment/Kana 文字差异的默认提示强度。

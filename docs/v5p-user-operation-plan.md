# V5-P 用户操作全链路计划

继续工作前先阅读 [`v5p-integration-handoff.md`](./v5p-integration-handoff.md)，其中记录当前帧率、
三层控制、A/B frame map、现有代码缺口和下一步顺序。

## 1. 计划目标

V5-P 的接入目标不是让用户填写 A/B 音频、文本、checkpoint 参数后成功调用一次 Python，而是让
AI-Midi 成为一套可以持续创作、修正、试听和管理候选结果的歌声制作软件。

正式链路必须是：

```text
用户意图
  -> 工程对象
  -> 可编辑、可保存、可审计的演唱控制
  -> 模型适配器
  -> V5-P
  -> 候选 Take
  -> 比较、局部修正、再生成
  -> 成品轨道与导出
```

训练侧的 SOFA、GAME、H placement 仍可复用，但角色要改变：它们是控制数据导入器、编译器和
模型适配器，不是用户每次点“合成”时都必须经历的不可见黑盒。

## 2. 已确认的模型事实

V5-P 当前 evaluator 中，B 音频没有作为声学 latent 条件送入 sampler。它主要承担两件事：

1. 通过 GAME medium K=4 生成 MIDI-P；
2. 通过 B latent 长度确定目标帧数。

sampler 真正消费的是：

```text
A reference latent
dense H text
MIDI-P embedding
total duration
steps / cfg / seed
```

因此成熟入口不需要强制存在 B 音频。用户 MIDI、歌词控制和目标时长能够直接编译成 V5-P 所需
条件；B 音频只作为导入、对照或兼容输入存在。

模型适配器内部继续负责：A 尾部 0.5 秒、目标尾部 1 秒、21.533 latent frames/s、A 区 MIDI
清零、`SEP=365`、`PUL=366`、输出 latent 裁剪以及对应 audit。这些不进入普通用户操作界面。

## 3. 工学原则

### 3.1 用户操作有稳定工作对象

用户不应每次合成都重新填写四个槽位。新增用户可见的 `VocalPartObject`，界面名称为“演唱片段”。
它是一次持续编辑的工作单元，绑定：

- 时间线目标区域；
- 音色参考；
- 旋律对象；
- 歌词对象；
- 控制数据当前 revision；
- 模型 preset；
- 已生成的 Takes。

输入对象保持 UID live reference；每次合成保存不可变 snapshot 和 hash。用户修改 MIDI/歌词后，
演唱片段显示“控制已变化”，旧 Take 保留并标记为来自旧 revision。

### 3.2 用户编辑语义，不编辑训练术语

普通界面只出现：音符、歌词、音节、分句、停顿、音色参考、候选、草稿、最终质量。`H`、`PUL`、
`SEP`、GAME-P、latent frame 和 `t_shift` 只出现在高级诊断和 audit 中。

### 3.3 分析是显式工具，不是隐藏副作用

从音频提取旋律或歌词时，用户主动执行“提取演唱控制”。结果成为 MidiObject、TextObject 和
PhoneControl revision，可以看到来源、置信度并继续编辑。再次合成不会自动重跑 GAME/SOFA。

### 3.4 自动化必须允许修正

自动歌词分配、mora 切分、phone timing、GAME 音符和 SOFA 对齐都先生成可编辑结果。低置信度
位置直接标在时间线上，错误信息必须指向具体音符、歌词单元或边界。

### 3.5 生成结果永不覆盖

每次生成得到新的 Take。用户可以试听、静音、独奏、比较、设为当前版本或拼接成 comp；旧结果
默认保留。重新生成一个短语时，只增加局部 Take，不破坏整段结果。

### 3.6 渲染不阻塞编辑

GPU 可以单任务排队，但编辑器不能被锁死。作业启动时冻结 control revision；用户继续修改时，
运行中的作业仍基于旧 snapshot 完成，结果明确标记 revision，不发生状态串写。

## 4. 用户心智模型与对象

### 4.1 用户可见对象

| 对象 | 用户理解 | 主要操作 |
|---|---|---|
| AudioObject | 音色参考、导唱或成品音频 | 播放、裁剪、分析、设为参考 |
| MidiObject | 可编辑旋律 | 导入、绘制、移调、量化、分组 |
| TextObject | 可编辑歌词与分句 | 粘贴、拆句、改时间、改假名 |
| VoiceReference | 可复用音色参考包 | 选择音频、准备 A 歌词/phone、质量检查 |
| VocalPartObject | 一段待合成歌声 | 绑定控制、选择模型、生成 Takes |
| RenderTakeObject | 某个 revision 的生成候选 | 试听、比较、采用、删除、导出 |

`SvsControlData` 是内部稳定协议，不要求用户在对象树中直接管理。用户看到的是“演唱片段”及其
旋律、歌词、音色参考和候选结果。

### 4.2 演唱片段状态

```text
empty       缺少旋律或歌词
needs-input 存在未分配歌词、非法音符或缺失参考
analyzing   正在从音频提取控制
ready       控制完整，可生成
rendering   某个 revision 正在生成
changed     控制已改变，已有 Take 来自旧 revision
failed      最近一次作业失败，但控制与旧 Take 均保留
```

状态应显示在演唱片段、时间线块和右侧检查器中，并提供唯一明确的下一操作。错误位置同时在编辑器
轨道上高亮。

## 5. 三条用户入口

### 5.1 主入口 A：用户 MIDI 到歌声

适用于已经有旋律或正在编曲的用户。

```text
1. 导入 .mid，或在 MIDI Editor 新建旋律
2. 选择目标时间区域并创建“演唱片段”
3. 粘贴/导入歌词
4. 系统按 phrase、rest、note group 自动分配 mora
5. 用户修正少数多音符拖腔、连音和分句
6. 选择或继承 VoiceReference
7. 自动预检通过
8. 生成当前短语、选择区域或完整片段
9. 试听多个 Takes，采用或继续修正
```

快速路径的目标是：MIDI 已整理、歌词合法、默认参考已设置时，从“创建演唱片段”到首个草稿不
超过“粘贴歌词、确认自动分配、生成”三个主要动作。

MIDI 路线不要求 B 音频。目标时长来自演唱片段范围、末尾音符和显式尾部；模型内部的 1 秒处理
尾部由 adapter 添加并在输出时裁掉。

### 5.2 主入口 B：导唱音频到歌声

适用于用户手里只有人声示范或旧 PH 工作流素材。

```text
1. 把导唱音频放到时间线
2. 执行“提取演唱控制”
3. GAME 生成 MidiObject 初稿
4. Whisper/SOFA 生成 TextObject、phrase 和 phone timing 初稿
5. 系统创建 VocalPartObject 并绑定上述对象
6. 用户只处理低置信度和明显错误位置
7. 选择 VoiceReference 后生成
```

导唱音频保留为可试听 guide lane。生成阶段消费已经确认的控制 revision，不再次从音频抽取。
修改一个音符后不会被下一次 GAME 运行覆盖。

### 5.3 主入口 C：混合工作流

适用于 MIDI 与导唱同时存在。

- MIDI 是旋律第一事实来源；
- 导唱用于节奏、歌词和表达参考；
- 可将 GAME 提取结果与 MIDI 叠加比较；
- 用户逐段选择使用 MIDI 音符、GAME 建议或手工修正；
- provenance 保留每段来源，不静默合并。

## 6. 音色参考操作链路

### 6.1 首次准备

用户选中一段参考人声，执行“设为音色参考”。系统进行：

1. 检查采样率、声道、时长、空白和削波；
2. 查找已关联 TextObject 与 PhoneControl；
3. 缺少时显式运行 Whisper/SOFA 生成初稿；
4. 用户确认歌词和明显边界；
5. 保存为可复用 VoiceReference。

### 6.2 后续使用

VoiceReference 可以设为声部默认值，新建演唱片段自动继承。用户无需每次重新选择 A 文本，也
无需每次合成重跑 SOFA。参考更新后，所有依赖片段显示“参考已更新”，旧 Take 仍可播放。

### 6.3 基础界面不暴露的内容

参考尾部、A 区 H placement、A 区 MIDI 清零和 VAE encode 属于 adapter。普通用户不需要设置
`SOFA 逸散程度`；对齐失败应回到可视化 phone/phrase 修正，而不是要求用户反复猜一个秒数。

## 7. 演唱片段编辑器

`VocalPartObject` 双击后在中央 Rich Media Editor Workspace 打开专用 tab。它是成熟 V5-P 操作的
主界面，右侧 SVS 面板退为检查器和生成控制。

MIDI 和 H 编辑放在同一个编辑器里，因为它们必须共享播放头、目标时长、phrase 边界和选区；但
它们不是同一层数据：MIDI 表达音高/时值，H 表达歌词的音素时序。编辑器采用三层结构：

```text
语义层：note + kana/mora + phrase/pause
音素层：phone sequence + phone timing + lock/override
模型层：dense H token frame + SEP/PUL + audit
```

默认创作从前两层开始；用户进入 Token 模式后，第三层也可以直接编辑。第三层一旦被用户修改，
该区间就成为当前 control revision 的显式事实，不再被浅层自动编译静默覆盖。

### 7.1 中央编辑区轨道

从上到下：

```text
时间尺与小节
Guide waveform / F0（可选、可折叠）
Piano roll 音符区
歌词 / mora lane
Phrase / pause lane
Phone lane（高级模式、默认折叠）
Take lanes / 当前 comp
```

各 lane 共享播放头、选区、循环范围和缩放。时间线与专用编辑器的播放状态保持同步。

默认模式显示 MIDI 和歌词/mora；打开“音素对齐”模式后，Phone lane 展开并与音符、歌词、guide
waveform 垂直对齐。再打开“诊断”模式才显示 latent frame、实际 token ID、SEP/PUL 和 fallback，
避免普通创作被模型内部表示打断。

### 7.2 MIDI 编辑工学

- 单击选择，拖动移动，拖边缘改时值；
- 双击空白创建音符，Delete 删除；
- 网格、吸附和量化是 toolbar 控件；
- 上下键或快捷命令按半音移调，拖动默认保持音高；
- 多选后支持整体移调、时移、量化和复制；
- 连音/拖腔通过 note group 表达，不靠删除歌词字符猜测；
- 休止区显式显示，为 phrase/pause 和 MIDI REST 编译提供语义；PUL 是否出现由权威 H runtime
  的 fallback 合同决定；
- 直接显示超出 V5-P 音域、重叠单音旋律和零时长等问题。

### 7.3 歌词分配工学

歌词 lane 以可编辑 mora/音节块显示在音符下方：

- 粘贴完整歌词后自动按标点、休止和 phrase 分配；
- Tab/Shift+Tab 在歌词单元间移动；
- Enter 拆分 phrase，Backspace 合并；
- 拖动歌词块边界改变其覆盖 note group；
- 一个 mora 可覆盖多音符，支持拖腔；
- 未分配歌词和无歌词音符使用不同警告状态；
- kana 为正式编译来源，romaji 是辅助显示和输入方式；
- 修改 kana 后，phone 建议增量更新并标记待确认区域。

### 7.4 H 控制工学

普通用户编辑 phrase、mora 和停顿；`HControlCompiler` 自动生成 phone timing。高级模式可展开
Phone lane：

- phone 显示为短时间块；
- 拖动边界修正辅音起点和元音持续；
- 可锁定单个 phone，重新自动分配时不覆盖；
- SOFA 来源、tokenizer 来源和用户修改通过图标/颜色区分；
- SEP 不作为普通歌词 token 显示，而映射为 phrase boundary；PUL 主要是当前 H runtime 的
  phone-ineligible fallback，只在 Token/Diagnostic 层显示，不能与普通 pause 混为一谈；
- 编译异常定位到具体 phrase，不只返回 Python 错误文本。

#### 7.4.1 假名到音素的分层关系

歌词编辑仍以假名/mora 为主，因为这是用户能理解和修改的语言单位。例如一个 `かな` 单元可以
对应多个底层音素：

```text
用户单元：かな
音素层：k a n a
模型层：vocab[k], vocab[a], vocab[n], vocab[a]
```

实际音素序列必须由 V5 runtime 的日语 frontend/tokenizer 产生，不能在前端手写一套与训练侧不同
的 IPA 规则。每个 `LyricUnit` 保存 `phoneCandidates` 和当前确认的 `PhoneTiming`，其中：

```ts
interface LyricUnitControl {
  id: string
  phraseId: string
  kana: string
  noteIds: string[]
  start: number
  end: number
  phones: PhoneTiming[]
  timingSource: 'user' | 'tokenizer' | 'sofa' | 'game-guide'
}

interface PhoneTiming {
  id: string
  symbol: string       // 例如 k/a/n/a，不是 0..366 的 token ID
  start: number
  end: number
  locked: boolean
  source: 'auto' | 'audio-analysis' | 'user'
  confidence?: number
}
```

模型无关 PhoneControl 保存 `symbol` 和连续秒级时间。用户进入 Token 模式后，当前 control revision
还必须保存 `symbol + runtime token ID + anchorFrame + vocab/runtime hash`；服务端 adapter 负责
首次映射和迁移审计，不能让工程只剩脱离符号与 runtime 来源的裸整数数组。

#### 7.4.2 MIDI、mora、phone 的联动规则

1. 用户移动或拉伸 note 时，绑定的 `LyricUnit` 跟随 note group 的时间范围重排 phone；未锁定
   phone 按比例重分配，锁定 phone 保持绝对时间并显示冲突。
2. 用户改变 kana 时，只重新 tokenize 受影响的 mora；该 mora 的自动 phone 重新生成，用户锁定
   的 phone 标记为“需要确认”，不静默沿用错误序列。
3. 用户把一个 mora 拖到多个音符上时，`noteIds` 变成一个 note group，phone 序列只生成一次，
   元音延续覆盖 group 的后续时值。
4. 用户把歌词拆成两个 mora 时，系统重新建立两个 `LyricUnit` 和两组 phone；原有手动 phone
   只在符号仍可匹配时迁移，否则放入待确认队列。
5. 用户移动 phrase boundary 时，边界内的 phone 可以整体平移；跨 phrase 的 phone 不自动穿越，
   需要显示冲突。
6. 用户编辑 pause 时，只修改语义层 pause 和对应 MIDI REST/phrase 空间；是否产生 PUL 由权威
   H placement fallback 决定，不能把普通 pause 自动翻译成 PUL。
7. 用户编辑 phrase 顺序或文本后，`SEP` 由 adapter 按 V5 规则重新放置；用户只操作 phrase boundary。

#### 7.4.3 H 编辑的三个工作模式

| 模式 | 显示 | 用户可改内容 |
|---|---|---|
| Compose | note + kana/mora + phrase | 音符、歌词、分句、停顿、音符组 |
| Align | 上述内容 + phone blocks | 音素符号、phone 起止、锁定、来源 |
| Token | frame ruler + H anchor + MIDI-P cell | 直接编辑、锁定、恢复自动结果、导出 audit |

Token 模式可以直接编辑 H token，但编辑对象是“token 符号 + frame 位置”，不是只填裸整数。
这样既保留专家对 H 的控制权，也避免 token ID 脱离 phone/mora/phrase 语义。

### 7.5 三层编辑模型

这里的“句级、假名级、token 级”不是三个互相独立的编辑器，而是同一 VocalPart Editor 的三个
detail 层级。它们共享选区、播放头和 revision，但每层有自己的数据和自动生成边界。

#### 句级：Phrase Control

句级对应当前已经存在的 TextObject segment/phrase：

- 编辑整句文字、起止时间、A/B 归属和 phrase 顺序；
- 插入或删除分句；
- 设置 phrase boundary 和 pause；
- 句内假名、音素和 MIDI token 默认由下层重建；
- 如果下层存在用户锁定内容，修改句级内容时创建新的候选 revision，明确提示受影响范围。

句级是默认操作层，适合整理歌词结构和大范围时间关系。

#### 假名级：Kana / Mora Control

假名级对应用户实际理解的发音单位：

- 一个 mora 绑定一个或多个 MIDI note；
- 可调整 mora 的起止、拖腔和 note group；
- 修改假名后调用 V5 runtime 的 tokenizer 生成新的 phone 候选；
- 可查看每个 mora 展开的 phone 数量，但不要求用户记 token ID；
- 未锁定的 phone timing 按 mora 和 note group 重新分配。

假名级是“歌词对齐 MIDI”的主工作层。它解决的是“这个音符唱哪个假名、这个假名覆盖哪些音符”。

#### Token 级：H Token + MIDI-P Token

Token 级是 V5-P 的精确控制层，也是专家用户可以直接操作的层。它分成两条同步 lane：

```text
同一 latent frame grid
  H lane:     phone token / SEP / PUL / empty
  MIDI-P lane: pitch class / REST / PAD
```

每个 MIDI-P cell 对应一个 V5-P latent frame，时间分辨率为 `44100 / 2048`。用户可以：

- 直接绘制、擦除和替换 pitch class；
- 在 0.5 半音网格上改变 token；
- 写入 REST；PAD 仅表示 batch/无效区域，在有效 B 区只读；
- 选择连续 token 区间整体平移、复制或拉伸；
- 从连续 token 反推 note overlay，作为音符级视图；
- 将 token 区间锁定，阻止句级/假名级重编译覆盖。

H lane 的 token 也可直接操作：

- 插入、删除、替换 phone token；
- 通过符号搜索选择 token，同时显示 runtime token ID；
- 改变 token 所在 frame；
- 选择连续 token 区间重新分配时间；
- 查看 `<SEP>` 和 `<PUL>` 的真实 frame；SEP 的普通修改从 phrase boundary 进入，PUL 只允许
  作为显式高级 runtime override，并经过边界、顺序、容量和 fallback 语义校验；
- 对单个 token 或区间加锁。

### 7.6 浅层到深层的生成规则

每个区域记录独立的 `controlOrigin`：

```text
auto       由浅层编译生成，可被下次编译替换
user       用户直接编辑，默认锁定
imported   GAME/SOFA 导入结果，可由用户确认或覆盖
```

编译采用由上到下的局部传播：

```text
句级修改
  -> 只重建受影响 phrase 内的假名和未锁定 token

假名级修改
  -> 只重建受影响 mora 的 H phone token
  -> 保留未受影响 MIDI-P token

H token 级修改
  -> H lane 直接成为事实来源

MIDI-P token 级修改
  -> MIDI-P lane 直接成为 V5-P 事实来源
  -> note overlay 作为派生视图，不反向覆盖原始 MIDI note
```

当浅层修改会影响用户锁定的深层区间时，不立即覆盖。系统显示三种选择：

```text
保留 token 修改：尝试按符号和时间迁移锁定内容
重新生成深层：删除受影响区域的自动/用户 token revision
复制为新 revision：保留旧 revision，并生成新的浅层派生结果
```

### 7.7 MIDI 的 token-first 设计

普通 MIDI 对象仍可以保存可交换的 note、tempo、PPQ 数据；但 V5-P 的控制编辑不应停留在 note
层。建议在 VocalPart control revision 中保存独立的 `MidiPTokenLayer`：

```ts
interface MidiPTokenCell {
  frame: number
  classId: number
  kind: 'pitch' | 'rest' | 'pad'
  source: 'note-compiler' | 'game-import' | 'user'
  locked: boolean
}
```

这样：

- 原始 MIDI note 是可编辑、可导出的音乐对象；
- MIDI-P token 是 V5-P 的精确控制对象；
- 两者可以互相显示，但不假设完全无损互转；
- 用户在 token 层修正的内容不会污染原始 MIDI；
- V5-P sampler 直接消费 `MidiPTokenLayer`，不再隐式调用 GAME。

连续同 pitch token 可以显示为 note overlay；从 token 导出 MIDI 时明确提示存在 frame 量化误差，
导出的 MIDI 是派生版本，不替换原始版本。

### 7.8 分层对齐工作流

常规制作不应一开始就把用户推到 token 网格。推荐的默认链路是：

```text
完整句子转录/对齐
  -> 句级时间戳
  -> 对照 kana / romaji 检查文字
  -> 用户修正全部假名
  -> 句级 + 修正后的假名
  -> SOFA 生成假名级时间戳
  -> 用户对照 MIDI 对齐假名级时间
  -> 假名级时间 + 正确假名
  -> SOFA 生成 phone/token 级时间戳
  -> 用户在离散 frame 上调整 token 时间
  -> V5-P HTokenFrameLayer + MidiPTokenLayer
```

这里的“转录”与“对齐”要分开记录：Whisper 或用户输入负责文字内容，SOFA 负责把已确认文字
对齐到音频；SOFA 不应重新改掉用户已经确认的假名，除非用户明确选择重新转录。

每一级都产生一个可保存的 alignment revision：

```text
sentence-alignment-v1
kana-alignment-v1
token-alignment-v1
```

下一级生成失败时，上一级仍然可用；用户可以回退、修改上一级，再重新生成下一级。下一级存在
用户锁定内容时，不能由上一级更新静默覆盖。

### 7.9 一键自动路线

也支持直接执行：

```text
无时间戳 / 句级时间戳 / 假名级时间戳
  -> SOFA hierarchical align
  -> 句级、假名级、token 级结果一次生成
```

这不是另一套算法，而是同一个分层 compiler 的自动模式。UI 仍然保存中间结果和 provenance，
只是默认把中间层标记为 `auto`，用户可以随时展开到任意层接管。

自动模式的三个入口：

| 已有输入 | SOFA 的工作 |
|---|---|
| 无时间戳文本 | 生成句级、假名级、phone/token 级时间 |
| 句级时间戳 | 固定句边界，生成假名级和 phone/token 级时间 |
| 假名级时间戳 | 固定假名边界，生成 phone/token 级时间 |

### 7.10 离散 token 时间合同

SOFA 可以先输出连续秒级 interval，但 V5-P 控制层不能直接保存任意浮点时间。所有 token 时间
必须量化到 V5 latent frame。当前冻结 runtime 的实际模型帧率不是 20 fps，而是：

```text
vae_frame_rate = 21.533203125
              = 44100 / 2048
```

`stable_audio_2_0_vae_20hz_official` 中的 `20hz` 是 VAE 权重/配置的近似命名，不能覆盖 runtime
里明确写入的 21.533203125。当前 V5-P 的训练入口、evaluator、H placement 和 latent shape 都
以 21.533203125 为准。

同时要区分三种时间尺度：

```text
SOFA / 用户编辑：连续秒级
GAME-P 原始 duration：100 Hz（0.01 秒量化）
V5-P H/MIDI/latent：21.533203125 Hz（VAE frame）
```

GAME 的 100 Hz duration 先闭合音频时长，再按 `target_len` 映射到 VAE latent frame，不能把
GAME 的 100 Hz 或 VAE 文件名中的 20 Hz 直接当作 MIDI-P/H 的模型帧率。

所有 token 时间必须量化到 V5 latent frame：

```text
frameRate = 44100 / 2048
frameIndex = QuantizeSofaTime(time, frameRate, frozenPolicy)
frameTime = frameIndex / frameRate
```

量化策略必须是单一、确定、可测试的 runtime policy，不能由不同 UI 控件各自 `round/floor`。

#### H token 的时间表示

H phone token 通常是一个离散的 token anchor，用户界面仍显示它的有效区间：

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

其中 `anchorFrame` 是 token 真正进入 dense H 的帧；`endFrame` 表示它在用户语义上的有效范围，
通常延伸到下一个 phone 或 phrase boundary。模型层可能只在 anchor frame 放置 phone token，
其间空隙由空 token、PUL 或后续规则处理，不能把 UI 的区间误认为每一帧都重复写入同一个 phone。

视觉上，整数 `anchorFrame=k` 属于第 `k` 个 frame cell，应显示在 cell 中心；竖线只是
`[k, k+1)` 的边界，不能把 H token 画在分界线上。

`SEP` 是边界 token。`PUL` 可以在 fallback 中重复占据一段 frame，但它不是用户普通 Pause 的
同义词。二者都必须用整数 frame 表示，不允许出现半帧位置。

#### MIDI-P token 的时间表示

MIDI-P 是真正的 dense frame token，每一帧恰好一个 class：

```text
pitch class / REST=255 / PAD=256
```

连续相同 class 可以在 UI 合并显示为一个 token span，但保存时仍保留每个 frame 的 class。用户
拖动 span 的边界，本质上是改变整数 frame 区间，不能产生半帧或隐式时长漂移。

#### Token 调整的交互

- 时间尺默认显示 frame cursor 和秒数；
- 拖动 token 时吸附到整数 frame；
- 显示量化前 SOFA 时间和量化后 frame 时间的差值；
- token 顺序、边界、容量和重叠由 preflight 实时检查；
- 跨 frame 的整体移动使用整数 frame delta；
- 任何自动重对齐都只操作未锁定 token；
- 用户确认 token revision 后，V5-P runner 直接使用已量化 layer。

### 7.11 A/B Frame Anchor

为了让用户在实际音频控制帧上编辑，A/B 不应只保存两个浮点秒数，而应保存一个明确的 model-frame
坐标变换：

```ts
interface ABFrameMap {
  frameRate: number
  hopSamples: number       // 当前 official VAE 为 2048
  aFrames: number
  bridgeFrames: number
  bStartFrame: number
  bFrames: number
}
```

核心约束是：

```text
B local frame 0
  == global frame bStartFrame
  == global audio sample bStartFrame * hopSamples
```

当前无额外 bridge 时，`bStartFrame` 就是实际 A reference latent 的 `refFrames`。如果用户工程中
A/B 原始时间关系存在小数帧偏移，系统默认把 B 起点吸附到最近的合法 frame，并显示吸附差值；不让
每一条 H/MIDI 控制各自拥有不同的浮点起点。

用户界面显示：

```text
B 0s  -> frame 646 -> sample 1,323,008 -> 30.000s
```

其中秒数是 frame 的派生显示，不能反过来成为第二套精度来源。B 的所有 phrase、kana、H token 和
MIDI-P token 都通过同一个 `ABFrameMap` 从 B-local 坐标映射到 global frame。

`bridgeFrames` 只表示 A/B 之间的结构性帧间隔，单位是整数 frame。它不能用来掩盖 B 内部的歌词
停顿或 MIDI REST；真实停顿应该写进 B-local control。若输出要裁去 bridge，裁剪范围必须写入
render contract，不能靠前端时间线猜测。

这会把最麻烦的坐标问题收敛为一个操作：用户移动 A/B 接缝时，移动的是整数 frame 的 boundary；
编辑器中的 H 和 MIDI 两条 token lane 同步移动，局部 B 控制本身不被重新换算成另一套秒数。

### 7.12 Runtime 合同变化

当前 H renderer 主要接收 phrase/candidate，然后重新生成 dense H。这个入口无法保留用户直接改过
的 token。因此 V5-P 成熟接入必须让 runner 接收两类明确的 frame layer：

```ts
interface HTokenFrameLayer {
  frameRate: number
  tokens: number[]          // 0 / phone token / 365 SEP / 366 PUL
  symbols?: Array<string | null>
  origin: Array<'auto' | 'user' | 'imported'>
  lockedFrames: number[]
}

interface MidiPTokenLayer {
  frameRate: number
  classIds: number[]        // pitch class / 255 REST / 256 PAD
  origin: Array<'note' | 'game' | 'user'>
  lockedFrames: number[]
}
```

自动路径仍然是：

```text
phrase/mora/phone -> HTokenFrameLayer
note/GAME          -> MidiPTokenLayer
```

但一旦用户进入 Token 模式修改某段 frame，runner 必须直接消费该 layer，不能再从原始 phrase 或
GAME cache 静默重建同一区间。H layer 的 preflight 负责检查 token ID、顺序、SEP/PUL 位置、A/B
边界和长度；MIDI-P layer 负责检查 class 范围、REST/PAD、A 区清零和目标帧闭合。

### 7.13 右侧检查器

基础区只保留：

```text
音色参考
模型
生成范围：当前短语 / 选区 / 完整片段
质量：草稿 / 标准 / 最终
候选数量
生成
```

`steps`、`cfg`、`seed`、device、adapter hash 和诊断参数放入高级区。当前 `dryRun` 改为自动预检；
开发者仍可从诊断菜单执行纯编译和 tensor audit。

## 8. ControlData 生命周期

### 8.1 三层数据

```text
用户语义层
  notes / mora / phrase / pause / reference

模型无关 ControlData
  秒级 NoteControl / LyricControl / PhoneControl / duration / provenance

V5-P Tensor Bundle
  dense H / MIDI-P / refFrames / totalFrames / crop contract
```

用户语义层和模型无关层进入项目保存与撤销系统。Tensor Bundle 是可重建缓存，绑定 control hash、
adapter version 和 preset，不作为唯一事实来源。

H 的用户修改不直接写入通用 `TextObject` 的 kana 字段，也不直接写入 V5 token 数组。推荐把
`PhoneTimingOverride` 放在 `VocalPartObject` 的 control revision 中：同一份歌词可以服务多个
演唱片段，而不同声区、参考音频和模型 runtime 可以拥有不同的 phone timing 修正。

### 8.2 Dirty 与缓存规则

- 改音符：MelodyControl 和后续 Take stale；歌词/参考不重新分析；
- 改歌词：LyricsControl、相关 PhoneControl 和后续 Take stale；
- 拖 phone：只重编相关 H 区域；
- 换参考：A bundle 和全部 Take stale，B 控制保持；
- 换模型：ControlData 保持，只生成新的 tensor bundle；
- 只换 seed/质量：复用同一 tensor bundle；
- 相同 control hash、preset 和参数可直接识别已有 Take，但不自动覆盖。

### 8.3 确定性与审计

每个 Take 至少保存：

```text
VocalPart ID
control revision/hash
VoiceReference revision/hash
model preset/checkpoint/VAE/runtime hashes
adapter version
render scope
steps/cfg/seed
output path/hash
生成时间与状态
```

## 9. 预检、错误与恢复

### 9.1 自动预检

点击生成前自动运行纯 CPU/轻量检查：

- 音色参考及 A control 是否完整；
- 目标区域时长是否合法；
- 音符是否有限、单调且符合单旋律约束；
- 歌词是否全部分配；
- phrase/phone 是否越界或重叠；
- V5-P 长度上限；
- preset、checkpoint、VAE、runtime 与 adapter 是否匹配；
- 编译后的 H 与 MIDI-P shape、A 区清零和 PAD/REST 语义。

### 9.2 错误呈现

- 数据问题标在编辑位置，可点击错误跳转；
- 资源问题显示在模型/参考检查器；
- 运行错误保留已完成阶段、日志和 audit；
- 失败不删除已有 Take，不改变当前 comp；
- “重试”复用同一 snapshot；“按当前控制重新生成”创建新 snapshot；
- 自动分析失败不静默回退成另一套控制语义。

## 10. 生成、试听与迭代

### 10.1 生成范围

默认优先局部：当前 phrase 或选区；用户显式选择完整片段。局部生成保存上下文边界和 crossfade
metadata，先作为独立 Take 试听，采用时再无损拼入 comp。

### 10.2 质量与候选

- 草稿：快速检查歌词和音符；
- 标准：默认正式试听；
- 最终：完整质量与审计；
- 候选数量 1/2/4；
- 高级用户可展开 raw steps/cfg/seed。

质量 preset 由模型目录定义，不把同一套 step 假设硬编码给所有模型。

### 10.3 后台作业

作业进入 GPU queue，状态为：编译控制、加载模型、生成、解码、写入。时间线上立刻出现 Take
placeholder。用户可继续编辑、播放已有素材、取消排队任务；运行中任务是否可取消由 worker
能力决定。

### 10.4 候选比较

- Takes 对齐同一目标起点；
- 单键切换当前 Take，支持 loop audition；
- 可与 guide、旧 Take 和当前 comp 做 A/B 试听；
- 显示来自哪个 control revision；
- “采用”只改变 comp 指针，不删除其他候选；
- 允许不同 phrase 采用不同 Take。

## 11. 完成与导出

用户完成一个演唱片段后：

1. 将采用的 Takes 组合为 comp；
2. 检查是否存在 stale、缺口、未确认控制或失败区域；
3. 渲染/拼接成完整 AudioObject；
4. 自动创建时间线 TrackObject；
5. 导出 WAV，必要时附带 control/audit manifest；
6. 项目中保留 VocalPart、ControlData revisions 和 Takes，便于返工。

项目级命令“生成所有过期演唱片段”只处理已通过预检的 part，其余 part 显示可定位原因。

## 12. 信息架构调整

### 左侧对象树

```text
References
Melody
Lyrics
Vocal Parts
Renders / Takes
```

不要求物理顶层目录立即改名，但需要让对象类型和关系可定位。双击 VocalPart 打开编辑器；双击
MidiObject 打开 piano roll；双击 TextObject 打开歌词编辑器。

### 中央工作区

Timeline 负责全曲编排；VocalPart Editor 负责歌声控制；Text/MIDI 独立 editor 负责对象级编辑。
同一对象只打开一个 tab，时间线播放头和选区在编辑器间同步。

### 右侧工具区

右侧从“四槽表单”演化为上下文检查器。未选 VocalPart 时可创建/绑定；选中 VocalPart 时显示其
参考、模型、状态、范围和生成命令。Whisper、SOFA、GAME 作为“提取控制”工具保留，不与最终
生成按钮混在同一流程里。

### 底部状态区

显示保存状态、播放时间和后台任务。点击任务可定位对应 VocalPart/Take，不需要用临时 toast
承担长任务状态。

## 13. 分阶段工程计划

### Phase 0：冻结产品与模型合同

1. 冻结 V5-P direct-control runner 输入：A audio、A/B controls、target duration、preset。
2. 用现有 evaluator 证明 B audio 只用于 GAME/length，并建立 direct-control 等价 fixture。
3. 冻结 `MidiData v1`、`SvsControlData v1`、`VocalPartObject v1`、`RenderTakeObject v1`。
4. 决定 phrase/mora/note group 和 phone lock 的精确语义。
5. 设计项目 schema migration 和旧 PH 兼容标记。

完成门禁：同一份 audio-derived control 经旧 evaluator 与新 direct-control adapter 产生 tensor-identical
H/MIDI-P 和一致目标帧数。

### Phase 1：无 UI 的 Control Compiler

1. 实现 MidiObject/GroupObject 到 NoteControl 的纯函数。
2. 实现 tempo、PPQ、拍号、绝对秒和目标区域换算。
3. 实现歌词标准化、mora 拆分、note group 分配和 phrase/pause 推导。
4. 实现 PhoneControl 与 HControlCompiler。
5. 实现 V5-P MIDI-P quantizer/adapter。
6. 实现 control hash、provenance、validation 和 tensor audit。

完成门禁：fixture、边界、休止、拖腔、跨 30 秒和 60 秒上限测试通过；编译确定性一致。

### Phase 2：演唱片段对象与快速路径

1. 增加 VocalPartObject、VoiceReference relation 和 RenderTakeObject。
2. 支持从选中 MIDI + Text/时间区域创建演唱片段。
3. 支持声部默认参考和自动继承。
4. 实现 ready/changed/failed 状态与自动预检。
5. 保留现有四槽 PH 路线作为 Legacy/Compatibility Mode。

完成门禁：不提供 B 音频时，可从已有 MidiObject + TextObject 得到完整 control snapshot。

### Phase 3：VocalPart Editor

1. 落 piano roll、共享播放头、缩放、选区、loop 和 snap。
2. 落歌词/mora lane 与自动分配、拆分、合并、拖腔关系。
3. 落 phrase/pause lane。
4. 落高级 Phone lane 与锁定、局部重编。
5. 所有编辑进入语义 undo/redo。

完成门禁：用户不用编辑 JSON 或秒数字段即可完成一段 30 秒 MIDI 歌词控制。

### Phase 4：音频导入控制

1. GAME 输出对象化为 MidiObject revision。
2. Whisper/SOFA 输出对象化为 TextObject + PhoneControl revision。
3. 显示置信度、来源、差异和待确认位置。
4. 支持 guide audio 与 MIDI/歌词叠加校对。
5. VoiceReference 准备结果可复用。

完成门禁：从 B 音频提取一次后，修改并重复生成不会再次隐式运行 GAME/SOFA。

### Phase 5：V5-P Runner、任务与 Takes

1. 接入经过审计的 V5-P/V5-Pg preset。
2. 实现 direct-control single-job runner。
3. 实现 GPU queue、snapshot、进度、取消/重试和失败保留。
4. 实现局部/完整生成、Take placeholder、试听和采用。
5. 实现 output/audit/provenance 回填。

完成门禁：用户编辑期间运行中的旧 revision 作业能正确完成并标记，不污染当前控制。

### Phase 6：比较、Comp 与最终工学

1. 实现 take lanes、快捷切换、loop A/B 和 phrase comp。
2. 实现 stale 检查和“生成所有过期片段”。
3. 将 cfg/steps/seed 收进高级区，提供模型质量 preset。
4. 用真实用户任务做操作观察，修正高频摩擦点。
5. 完成 29/31/40/55 秒模型边界验收和全链路回归。

## 14. 必须通过的用户场景

### 场景 A：纯 MIDI

用户导入 MIDI、粘贴日语歌词、选择参考、生成 30 秒歌声。全程没有 B 音频，不运行 GAME，用户
能修正一处拖腔后只重生成该 phrase。

### 场景 B：导唱导入

用户导入 B 音频，一次提取 MIDI/歌词/phone，修正一个错误音符后重复生成。第二次生成不重跑
GAME/SOFA，修正不会丢失。

### 场景 C：参考复用

同一 VoiceReference 用于多个演唱片段，A 分析只做一次。更新参考后依赖 part 明确变为 changed，
旧 Take 仍可播放。

### 场景 D：边编辑边生成

revision 3 生成中，用户继续编辑到 revision 4。输出完成后归属 revision 3，并提示当前控制已更新，
不会冒充 revision 4 结果。

### 场景 E：错误定位

存在未分配歌词、重叠音符或 phone 越界时，生成入口明确不可用，点击错误能定位对应位置。修复后
状态自动恢复 ready。

### 场景 F：候选与返工

用户生成四个 Takes，分 phrase 采用两个候选形成 comp，之后改一个短语并新增局部 Take。旧候选、
当前 comp 和新候选均保留，可随时回退。

## 15. 接入完成的定义

只有同时满足以下条件，V5-P 才能称为“成熟接入”：

- 用户 MIDI + 歌词可以直接生成，不依赖 B 音频；
- 音频分析结果对象化、可编辑、可复用，不在每次 render 中隐式重算；
- H 与 MIDI-P 都由版本化 control compiler 产生并可审计；
- 用户围绕 VocalPart 编辑，不重复填写四槽表单；
- 支持局部生成、多个 Takes、比较、采用和非破坏性返工；
- 编辑与 GPU 作业解耦，revision 归属明确；
- 普通流程不要求理解 H/PUL/GAME/latent/cfg/step；
- 每个输出可追溯到控制 revision、参考、模型、VAE、adapter 和 seed；
- 纯 MIDI、导唱、混合、长程、失败恢复和旧 PH 兼容场景全部通过。

单独增加 `/api/svs/run` 的 `v5p` 分支只能称为 Compatibility Smoke，不能标记为本计划完成。

# V5-P MIDI/H Token 编辑器设计

> 状态：交互方案讨论稿，尚未冻结为运行代码。
> 单 HTML 原型：[`v5p-token-editor-concept.html`](./v5p-token-editor-concept.html)

## 1. 目标与边界

本编辑器解决的是用户如何在 V5-P 实际消费的离散模型帧上共同编辑旋律和歌词控制，而不是增加
一个显示 token 数组的诊断页面。

目标工作链路：

```text
用户 MIDI / kana / phrase / phone
  -> 可编辑且可审计的 Control revision
  -> HTokenFrameLayer + MidiPTokenLayer
  -> PH/V5-P direct-control runner
  -> Take
```

必须同时满足：

- 用户从音乐与歌词语义进入，不需要先理解训练术语；
- 专家可以直接接管 H token 和 MIDI-P frame class；
- H 与 MIDI-P 共用同一个播放头、选区、A/B 接缝和模型 frame grid；
- 手工 token 不被 SOFA、GAME、note compiler 或 phrase compiler 静默覆盖；
- runner 最终直接消费用户确认的 frame layer；
- token 放置、量化和特殊值语义与训练 runtime 同构。

当前不把以下内容视为已经完成：

- HTML 原型不是正式 Vue 组件；
- 原型中的 H token ID 是演示值，不是权威 vocab 映射；
- 尚未冻结 VocalPartObject 和持久化 schema；
- 尚未让 V4PH/V4H/V5-P runner 消费 direct layer；
- 尚未建立 SOFA/runtime 到编辑器的正式导入接口。

## 2. 权威事实

继续设计或实现前必须读取：

- `ToLinuxServer/docs/基础设施/v5/H/摩拉音素级对齐实验.md`；
- `ToLinuxServer/docs/基础设施/v5/V4Pf/GAME接入设计.md`；
- `ToLinuxServer/docs/基础设施/v5/V5P/V5-P正式训练计划.md`；
- `ToLinuxServer/package_v4c_finetune/h_alignment/placement.py`；
- 本项目 [`v5p-integration-handoff.md`](./v5p-integration-handoff.md)。

当前冻结的模型时间合同：

```text
sampleRate = 44100
hopSamples = 2048
frameRate  = 44100 / 2048 = 21.533203125 Hz
frameDuration = 2048 / 44100 ~= 46.4399 ms
```

需要区分三套时间：

```text
SOFA / 用户语义时间：连续秒
GAME region 时间：100 Hz
V5-P H/MIDI/latent：21.533203125 Hz
```

GAME 的 100 Hz 和 VAE 文件名中的 `20hz` 都不能成为编辑器 frame grid。

## 3. Frame Cell，而不是 Frame Boundary

### 3.1 视觉合同

整数 `frame=k` 表示 dense tensor 的第 `k` 个 cell：

```text
sampleStart = k * 2048
sampleEndExclusive = (k + 1) * 2048
timeStart = k / frameRate
timeEndExclusive = (k + 1) / frameRate
```

因此 UI 中：

- 竖线表示相邻 frame cell 的边界；
- MIDI-P cell 填满 `[k, k+1)`；
- H token anchor 显示在第 `k` 个 cell 的中心；
- 播放头可以表示当前 frame 的 start boundary；
- Phone lane 继续显示 SOFA 的连续 interval；
- Inspector 同时显示 frame index、cell sample range 和连续时间。

HTML 原型首版曾把 H token 画在 frame 边界上，已纠正为 cell center。这是显示错误，不是 runtime
语义。

### 3.2 连续 onset 与离散 anchor

SOFA phone onset 可能落在任意连续时间。编辑器应同时保留：

```text
sourceOnsetSeconds：SOFA 原始连续 onset
anchorFrame：量化后真正写入 dense H 的 frame index
quantizationDelta：anchor 对应时间与 source onset 的差
```

用户在 Token 模式拖动的是 `anchorFrame`，不是修改 SOFA 原始测量。若用户需要重新解释 phone
interval，应回到“对齐”模式。

### 3.3 量化政策

前端不能自行散落 `round/floor/ceil`。最终应由共享 adapter 暴露：

```text
quantizeHAnchor(...)
sampleMidiClassAtFrameCenter(...)
quantizeSpanStart(...)
quantizeSpanEndExclusive(...)
```

当前训练事实包括：phrase anchor 使用 runtime 的整数 frame 放置；GAME region 到 MIDI-P 使用目标
frame 中心时间查询所属 region，不对离散 class 做线性插值。正式实现前仍需用 direct-control
fixture 对旧 evaluator 与新 adapter 做 tensor-identical 门禁。

## 4. A/B Frame Map

编辑器使用统一的：

```text
bStartFrame = aFrames + bridgeFrames
globalFrame = bStartFrame + bLocalFrame
```

视觉语义：

- A 区使用低对比背景；
- A/B 接缝是唯一明显边界；
- B local frame 0 从接缝右侧第一个完整 cell 开始；
- B 的 phrase、mora、phone、H 和 MIDI-P 全部通过同一映射；
- 移动接缝不能分别重算各 lane 的浮点秒起点。

当前推荐：VocalPart Editor 中 A 区只读。VoiceReference 的歌词/H 准备应由独立参考编辑入口维护，
避免用户在编辑目标演唱时意外改变音色参考合同。该推荐仍等待用户最终裁决。

`bridgeFrames` 只表示结构性接缝。真实歌词停顿、MIDI REST、未发声区和 H fallback 必须保存在
B-local control 中。

## 5. 编辑器信息架构

推荐使用独立 `VocalPart Editor` tab，而不是把 MIDI-P 塞进 MidiObject Editor、把 H 塞进
TextObject Editor。原因是一次生成 revision 同时拥有：

- MidiObject 引用；
- TextObject 引用；
- VoiceReference 引用；
- phrase/mora/note group；
- H 与 MIDI-P 手工覆盖；
- model preset；
- Takes。

MidiObject 和 TextObject 仍有自己的对象级 editor；VocalPart Editor 是两者在某一次演唱控制中的
联合使用和模型级修正。

### 5.1 三种 detail mode

```text
编排 Compose
  Piano Roll + kana/mora + phrase/pause

对齐 Align
  Compose + Guide/F0 + phone interval + alignment confidence

Token
  Align + sparse H anchor + dense MIDI-P frame cells + runtime audit
```

默认打开“编排”。Token 模式是专家层，不应成为普通用户的首次画面。

三个模式不是三个数据副本。它们共享：

- 播放头；
- 循环选区；
- 时间缩放；
- 当前 control revision；
- 选择状态；
- undo/redo。

### 5.2 Lane 顺序

推荐从上到下：

```text
时间尺 / 小节 / latent frame
Guide waveform + F0
Piano Roll
Kana / Mora
Phone interval
H Token anchor
MIDI-P frame class
Take / Comp（后续阶段）
```

这样用户始终能看到：某个声音位置、某个音符、某个假名、对应 phone、真正的 H anchor 与实际
MIDI-P class。

## 6. H Token 的显示与操作

### 6.1 H 是稀疏事件

普通 phone token 通常只在 `anchorFrame` 写入一次：

```text
denseH[anchorFrame] = tokenId
```

Phone lane 的块表示连续发音 interval；H lane 的 anchor 表示模型条件事件。不能把 phone 的视觉
跨度误画成 dense H 每帧重复同一 phone。

推荐同时显示：

- Phone lane：SOFA interval；
- H lane：cell center 上的 token anchor；
- 选择 H token 时：高亮其 parent mora、phone interval 和 note group；
- Inspector：symbol 为主、runtime ID 为辅。

### 6.2 H Inspector

至少显示：

```text
symbol
runtime token ID
anchor global/local frame
cell sample range
source onset 与量化误差
parent phrase / mora / phone
origin: auto / imported / user
locked
runtime preset / vocab hash
```

用户不应只能输入裸整数。插入或替换使用 runtime symbol palette，ID 由当前 preset 的权威 vocab
映射。

### 6.3 H 操作

Token 模式允许：

- 选择和多选；
- 按整数 frame 平移；
- 通过 symbol palette 替换；
- 插入或删除 pronunciation override；
- 区间锁定；
- 恢复自动结果；
- 显示与 kana/tokenizer sequence 的差异。

移动后必须保持：

- token 顺序严格单调；
- 不越过 phrase/A/B/有效 latent 边界；
- 不发生未确认覆盖；
- 与 runtime 最大偏移门限和 collision policy 一致。

不允许前端用简单“向右挤一格”解决连续碰撞；训练 H 已证明贪心顺延可能形成大范围级联。应复用
权威 placement solver，并在结果改变多个 token 时预览影响范围。

### 6.4 Kana 与手工 H 不一致

推荐显式建立 `pronunciation override`：

```text
kana: 用户文字事实
runtimeTokenSequence: tokenizer 建议
overrideTokenSequence: 用户发音覆盖
```

用户覆盖不能悄悄改写 kana，修改 kana 也不能静默删除覆盖。发生不一致时，用户可选择：

- 保留 pronunciation override；
- 根据新 kana 重新生成；
- 复制为新 revision 后比较。

## 7. SEP、PUL 与普通 Pause

特殊值：

```text
0   dense filler / empty
365 SEP
366 PUL
```

必须区分：

- `SEP` 是 runtime phrase boundary；
- `PUL` 在当前 V4H/V5-P 训练合同中主要承担 phone-ineligible placement fallback；
- 用户的普通 Pause 是语义层对象；
- Pause、波形静音、MIDI REST 和 PUL 不是同义词。

因此当前推荐：

- 普通模式只编辑 phrase/pause；
- `SEP/PUL` 在 Token/Diagnostic 模式显示；
- 用户不能把任意休止区直接填成 PUL；
- 若未来允许高级 PUL override，必须显式标为 runtime override 并通过 placement preflight。

## 8. MIDI-P 的显示与操作

### 8.1 Dense frame layer

MIDI-P 每个模型 frame 必须有一个 class：

```text
0..254：MIDI 0..127，0.5 半音一个 class
255：REST
256：PAD
```

显示语义：

- 高缩放：每帧一个 cell；
- 低缩放：连续相同 class 合并成 run，但选择和保存仍是逐帧；
- pitch 显示为音名、MIDI 浮点值和 class ID；
- 例如 class 120 = MIDI 60.0 = C4；
- class 121 = MIDI 60.5 = C4 + 50 cents。

### 8.2 Piano Roll 与 MIDI-P 的所有权

原始 MidiObject 保存 note/tempo/PPQ，是音乐对象。`MidiPTokenLayer` 是某个 VocalPart revision 的
模型控制。两者关系：

```text
MidiObject note edit
  -> 重新编译未锁定 MIDI-P frames

MIDI-P token edit
  -> 只修改 VocalPart token layer
  -> note overlay 作为派生视图
  -> 不覆盖原始 MidiObject
```

从 token 导出的 MIDI 是派生版本，必须保留 frame 量化误差说明。

### 8.3 MIDI-P 操作

Token 模式允许：

- 单帧或连续区间绘制 pitch class；
- 以 0.5 半音移动；
- 写入 REST；
- 整数 frame 平移、复制、拉伸；
- 锁定区间；
- 恢复 note compiler 或 GAME import 结果；
- 比较 source note、GAME suggestion 与用户 override。

`PAD=256` 是 batch/无效区域语义，不是普通目标区音符。当前推荐在编辑器中只读显示 PAD；用户
不能在有效 B 区随意绘制 PAD。A 区 MIDI null 也应由 adapter 显式清零，不能靠用户画 PAD 模拟。

### 8.4 编译合同

从 note 到 MIDI-P 时：

```text
frameCenterTime = (frame + 0.5) / frameRate
class(frame) = 查询 frame center 所属 note/REST region
```

不得对 class ID 做线性插值。REST 与 pitch 分开处理；batch 外部补齐才使用 PAD。

## 9. 预览与播放

编辑器需要三种不同预览来源：

```text
Guide audio：校对实际波形、发音、F0 和 token 位置
MIDI preview：用轻量合成器试听 note/MIDI-P 音高与节奏
Rendered Take：确认模型实际是否遵守控制
```

MIDI preview 是控制试听，不代表 V5-P 生成质量。不要把每个 46ms cell 都播放成独立短蜂鸣；应按
连续 run/note 维持音高，只在 class 或 REST 改变时更新合成器状态。

播放行为：

- 当前 frame cell、H token、MIDI-P、phone、mora 和 note 同步高亮；
- 点击 token 跳转播放头；
- 选中 mora 可循环前后上下文；
- 有 Guide 时可切换 Guide/MIDI/Take；
- token 操作期间播放不能改变数据 revision。

## 10. 选择与 Inspector

右侧 Inspector 只显示当前选中对象可执行的操作，不同时堆叠 H 与 MIDI 操作。

选择 MIDI-P cell 时：

```text
frame / B-local frame
秒数 / PCM sample range
class / MIDI / note name
origin / locked
parent note / mora
pitch up/down / REST / restore / lock
```

选择 H token 时：

```text
symbol / runtime ID
anchor frame / source onset / quantization delta
parent phone / mora / phrase
origin / locked / vocab hash
left/right frame / replace / override / restore / lock
```

Inspector 不承担全局说明文档；异常通过定位到具体 frame 的 preflight message 表达。

## 11. Revision 与自动重编译

每个 frame 或 token 至少记录：

```text
origin = auto | imported | user
locked
source revision
```

传播规则：

```text
修改 note
  -> 重编未锁定 MIDI-P frames

修改 kana/mora
  -> 重建未锁定 tokenizer/phone/H 区域

移动 H anchor
  -> 创建 user override 并锁定受影响 token

修改 MIDI-P cell
  -> 创建 user override 并锁定受影响 frames
```

浅层修改碰到手工锁定区域时不能自动覆盖，应提供：

- 保留并迁移覆盖；
- 删除覆盖后重编；
- 复制为新 revision。

Undo/redo 必须以语义操作为单位，连续拖动在 pointer release 时合并为一次历史命令。

## 12. Preflight

生成前至少检查：

- frameRate/hopSamples 与 preset 一致；
- A/B map 和 layer 长度一致；
- H token ID 对当前 vocab 合法；
- H 顺序、SEP/PUL、phrase 边界与容量合法；
- MIDI-P class 只在 `0..256`；
- 有效 B 区没有意外 PAD；
- A 区 MIDI condition 由 adapter 清零；
- 手工 H/kana 不一致已登记 pronunciation override；
- 所有手工覆盖绑定当前 control revision；
- runner 输入 hash 与编辑器确认 layer hash 一致。

错误必须定位到 frame、mora、phone 或 note，不只显示 Python traceback。

## 13. HTML 原型验证记录

文件：[`v5p-token-editor-concept.html`](./v5p-token-editor-concept.html)。

已验证：

- 桌面布局下各 lane 共用 frame grid；
- 390 x 844 视口没有页面级横向溢出；
- 编排模式隐藏 Phone/H/MIDI-P；
- 对齐模式显示 Phone，隐藏 H/MIDI-P；
- Token 模式显示 Phone/H/MIDI-P；
- MIDI-P class 120 上调一格变为 class 121 / `C4+50`；
- MIDI-P 可切换 REST、锁定和恢复自动结果；
- H anchor 可按整数 frame 移动并锁定；
- H 与 MIDI Inspector 操作互斥显示；
- 浏览器 console 没有 error/warning；
- H anchor 已从错误的 frame boundary 改为 frame cell center。

原型不是验收证据：

- 使用静态演示 waveform、note、mora、phone 和 token；
- MIDI preview 使用简单正弦波；
- 没有真实项目保存、撤销、SOFA、GAME 或 runner；
- 没有使用权威 runtime vocab。

## 14. 待用户裁决

当前推荐但尚未最终冻结：

1. 使用独立 VocalPart Editor，而不是 Text/MIDI Editor 的内嵌模式；
2. A 区在 VocalPart Editor 中只读；
3. H 同时显示 Phone span 和位于 cell center 的 anchor；
4. MIDI-P 低缩放合并 run，高缩放显示逐帧 cell；
5. H sequence 与 kana 不一致时创建显式 pronunciation override；
6. PUL 仅在 runtime/diagnostic 层显示；
7. PAD 对用户只读；
8. 默认进入编排模式，Token 模式由用户主动打开。

用户目前对 HTML 原型的反馈是“暂时还行”，只确认可作为下一轮讨论基础，不表示以上八项已经全部
接受。

## 15. 确认后的实现顺序

```text
1. 冻结 frame quantization 与 direct-control fixture
2. 冻结 VocalPartObject / Control revision / ABFrameMap schema
3. 实现无 UI 的 HTokenFrameLayer / MidiPTokenLayer 纯函数和测试
4. 接入权威 runtime tokenizer、SOFA import 和 placement solver
5. 实现 VocalPart Editor 的编排/对齐/Token 三模式
6. 接 MIDI preview、Guide waveform/F0 与共同播放头
7. 让 PH/V5-P runner 直接消费已确认 layer
8. 补 revision、undo/redo、preflight、audit 与 Take
9. 用真实工程和 29/31/40/55 秒边界验证
```

不能先做只读 token UI，再继续让 runner 从 phrase/GAME 静默重建；那会形成看似能编辑、实际不生效
的假功能。

## 16. 上下文压缩后的阅读顺序

重新接管本任务时按以下顺序读取：

1. [`v5p-integration-handoff.md`](./v5p-integration-handoff.md)；
2. 本文；
3. [`v5p-user-operation-plan.md`](./v5p-user-operation-plan.md) 的第 7、8、13 节；
4. `ToLinuxServer/docs/基础设施/v5/H/main_H.md` 与工人文档；
5. `ToLinuxServer/docs/基础设施/v5/V4Pf/GAME接入设计.md`；
6. 实现前重新检查当前 Git worktree 和 runtime 权威文件。

压缩后不要直接从 HTML 原型开始写 Vue；必须先确认“待用户裁决”是否已经在后续对话中改变。

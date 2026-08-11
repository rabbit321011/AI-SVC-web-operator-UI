# V2 编辑器迁移清单

> 目的：把 `v5p-token-editor-concept.html` 里已经验证过、而正式编辑器还没完整具备的东西一次盘清。

## 结论

正式版的底层动作已经够用：生成、局部覆盖、H/MIDI 编辑、边界拖动、试听、Take 都有了。

现在缺的不是更多生成按钮，而是让用户在编辑时看得懂当前对象、来源、覆盖范围和可做操作的界面层。

## V2 有什么

| 模块 | V2 已验证的体验 | 正式版状态 |
|---|---|---|
| 选择 | 点 Segment/Kana/H/MIDI 任意对象后进入选中态 | 已有统一选择态 |
| Inspector | 右侧显示当前对象的属性、来源、范围、可执行命令 | 已搬入 |
| H 说明 | 悬停显示中文解释、token、frame、训练见过与否 | 已搬入悬浮卡与 Inspector |
| H 编辑 | 空 frame 可选；双击/右键替换；可清为 0 | 大部分已有 |
| MIDI 编辑 | 逐 frame 选中、拖动、改音高、钢琴试听、REST | 大部分已有；需补对象信息 |
| MIDI 显示 | 音高轮廓和 `C4` 等参考音名 | 已有 C 音参考线和 Inspector 读数 |
| Segment/Kana | 选择、双击编辑、右键对齐、拖边界 | 大部分已有 |
| 自动操作 | 显示源、目标轨、覆盖 frame、手工数据数量 | 有确认框；没有时间线范围预览 |
| 工具栏 | 播放、撤销、重做、吸附、轨道显隐、试听源、缩放 | 播放/试听/缩放已有；其余未完整搬 |
| 快捷键 | 空格、Esc、Ctrl+Z、Ctrl+Shift+Z | 空格、撤销、重做已接入；Esc 待补 |

## Inspector 应该显示什么

| 当前选中 | 需要显示 | 需要提供的操作 |
|---|---|---|
| Guide Audio | 文件、采样率、frame 数、有效区间 | 转录 Segment、生成 MIDI-P |
| Segment | 文本、Kana、发声范围、H 控制范围、SEP frame、来源 | 编辑、对齐 Kana、对齐 H |
| Kana | Kana、Romaji、范围、时长、SEG、来源 | 编辑、对齐 H |
| H Token | 中文解释、token、ID、frame、训练见过、所属 Segment/Kana、来源 | 替换、清为 0 |
| MIDI-P | class、`C4` 音名、MIDI 值、frame、来源、FLOW 头 token | 替换、REST |

## 怎么搬

按这个顺序做，前一步是后一步的基础：

1. 统一选择状态：Guide / Segment / Kana / H frame / MIDI frame。
2. 做右侧 Inspector：先只读显示，再把已有操作按钮接进去。
3. 每次自动操作前，在目标轨上画出将被覆盖的 frame 范围。
4. 补撤销、重做、Esc 和轨道显隐。
5. 真实 V5-P 到位后，再校准 MIDI-P class、FLOW、SEP/PUL 的最终语义。

## 不搬什么

- 不搬 V2 HTML 的假数据和假生成器。
- 不复制一套修改逻辑；Inspector 只调用现有 transaction/analysis。
- 不让一次自动操作联动覆盖多个轨。
- 不把 Take 当作 A 区参考。

## 当前下一件事

做自动操作的 **目标 frame 范围预览**，让用户在确认覆盖前直接看到即将被写入的区域。

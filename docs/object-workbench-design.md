# AISVC-midi-web 对象工作台设计文档

> 版本：v0.2 checkpoint-aligned draft  
> 来源：围绕 AI 歌声工程对象、富媒体编辑器、SVC/SVS、素材树、TrackObject、GroupObject、双文件栏、处理工具面板等设计问答整理  
> 状态：长期设计共识文档；部分章节已进入当前 checkpoint，实现偏差在文中标注

---

## 1. 设计目标

AISVC-midi-web 的下一阶段不再只是 YingMusic-SVC 的 Web 操作界面，而是一个面向 AI 歌声制作的本地工程系统。

它的核心不是某一个 SVC/SVS 功能，而是让素材、时间线单元、组合输入、工具产物和实验候选都成为可保存、可引用、可复用的工程资产。

它需要同时支持：

- 音频时间线编辑
- 项目内素材组织
- 全局资源模板管理
- SVC 歌声转换
- SVS 歌声合成
- 生成结果复用
- 基于 TrackObject 的 Group 合成输入
- 假名/罗马音文本编辑
- 未来 MIDI/旋律二维编辑

顶层设计公理：

```text
AISVC-midi-web 是 AI 歌声制作工程系统，不是单一 SVC Web UI。
Object 是工程资产本体；工具结果只要有复用价值就对象化。
对象树和富媒体编辑器工作区是同一工程对象系统的不同表达与编辑入口。
中间区域是多 tab Rich Media Editor Workspace，timeline 只是 project/root 的默认编辑器。
左侧 selection 不等于中间 editor context；复杂对象需要显式打开为 editor tab。
TrackObject / GroupObject 是长期主模型，legacy segment / CompGroup 最终退出。
UID 给程序找对象，树结构给人理解对象。
跨系统流动是语义转换，不是随手共享引用。
timeline 是实验编排面，不只是音频剪辑器。
AI 候选结果默认保留、比较、再处理，而不是覆盖。
Object kind 使用封闭枚举；每种类型必须定义自己的进入边界和消费方式。
```

现阶段对象原则：

```text
Object 表示工程资产，媒体对象只是 Object 的一种。
TrackObject 表示媒体对象在时间线单元系统中的一次时间性使用。
GroupObject 表示多个同类型 TrackObject 的带时间关系合并输入。
右侧处理工具面板消费项目对象，并产出新的项目对象。
```

---

## 2. 顶层界面

主编辑界面采用三块区域：

```text
┌───────────────┬─────────────────────────────┬──────────────────┐
│ L1 / L2 文件栏 │ 富媒体编辑器工作区             │ 右侧处理工具面板    │
│ 对象树         │ Timeline / MIDI / Text / ...  │ SVC / SVS / ...   │
└───────────────┴─────────────────────────────┴──────────────────┘
```

三块区域的职责：

```text
左侧 Object Tree：工程对象导航、组织、定位、拖拽引用入口。
中间 Rich Media Editor Workspace：多 tab 富媒体编辑器宿主。
右侧 Tool Panel：处理器入口，消费项目对象并产出新对象。
```

左侧对象树 selection 表示当前操作对象、拖拽对象、工具填槽来源或定位来源。中间 editor tab 表示当前正在编辑的上下文。二者可以相互定位，但不是同一个状态；选择左侧对象不应自动替换正在编辑的富媒体 editor。

### 2.1 左侧 L1/L2 文件栏

左侧包含两个文件栏：

- `L1`：主浏览/整理栏
- `L2`：定位/对照栏

两栏显示同一套项目树数据，但 UI 状态不同步：

- 展开状态不同步
- 滚动位置不同步
- 临时定位高亮不同步
- 数据修改同步
- 选中状态是全局共享的 `Set<NodeId>`

所有目录默认折叠。用户按需展开。`L1` 和 `L2` 都可以独立展开或收起。

选择规则：

- 普通左键对象：清空旧选择，只选中该对象
- `Ctrl + 左键` 对象：切换该对象是否被选中
- 选择状态以 `NodeId` 去重，同一对象在 L1/L2 不会重复选中
- 文件夹不能被选中
- 如果某个已选对象在另一栏也可见，另一栏也高亮
- 如果另一栏没有展开到该对象，不自动展开，不改变其滚动/展开结构

当前 checkpoint 补充：

- 左侧对象树 selection 和中间 timeline selection 互斥
- 左侧单选优先级高于残留 timeline selection
- 定位快捷键执行时，如果左侧存在单选，优先按左侧对象定位；左侧没有选择时才使用 timeline selection

定位规则：

- 定位不改变全局选中状态
- 定位只展开并滚动 L2 到目标对象，并高亮 0.5 秒
- `Alt+N`、`Alt+L`、`Alt+M`、`Alt+K` 都遵守此规则

文件夹规则：

- 文件夹不可选中
- 文件夹可展开/折叠
- 文件夹可拖拽移动
- 文件夹可作为 drop target
- 文件夹不可拖入右侧工具输入槽

### 2.2 中间富媒体编辑器工作区

中间区域不是固定 timeline，而是多 tab `Rich Media Editor Workspace`。

`Timeline Editor` 是挂载在 `project/root` 下的默认主编辑器，也是当前 checkpoint 的主要富媒体编辑器。未来不同 Object kind 可以按需要打开自己的 editor tab：

- `project/root`：Timeline Editor
- `MidiObject`：MIDI / piano roll / melody editor
- `TextObject`：text / kana / romaji editor；轻量文本也可作为小组件展开
- `PitchObject` / F0 结果：pitch curve / analysis editor
- 复杂分析对象：二维、三维或多维参数/散点编辑器

编辑器粒度分为：

- 轻量内联编辑：名称、简单文本、简单参数
- 局部面板编辑：文本片段、参数列表、对象属性
- 完整主编辑器：timeline、MIDI、waveform、pitch curve、二维/三维/多维编辑器

当前 Timeline Editor 显示并编辑 `TrackObject`。

保留当前值得继承的体验：

- 多音轨显示
- 音频片段显示
- F0 曲线显示
- 播放头
- 选中、框选
- 切分
- 移动
- 合并
- 复制粘贴
- 静音/独奏/音量
- 忽略片段
- 播放选中

Timeline Editor 中的对象不能拖到侧栏。中间拖动手势只用于移动 TrackObject 的时间线位置或音轨归属，不承担“拖到素材栏/Group”的语义。

### 2.3 右侧处理工具面板

右侧不是 SVC/SVS 专属合成面板，而是处理工具面板。它只放会产生新媒体或新工程对象的处理工具，不放重命名、删除、创建 Group 等基础对象管理操作。

处理工具系统不是项目对象子系统。它消费项目对象系统中的对象，并产出新的项目对象：

```text
Object(s) -> Tool Processor -> Object(s)
```

右侧同一时间显示一个工具类型。每个工具保留自己的草稿输入和参数；占用同类重资源的任务运行时，其他同类工具的执行入口禁用。任务状态显示在正在运行的工具内部，第一版不要求取消任务或全局任务中心。

工具按需声明：

- 输入槽需要的对象类型
- 输入是否必须带时间性
- 是否允许普通 Object 作为无时间性参考
- 输出是否进入 `renders`
- 输出是否自动创建 TrackObject

当前第一批工具包括 SVC、SVS。Whisper、F0/pitch 提取、切片/静音检测等识别和提取工具属于后续同类扩展。

SVC 工具：

SVC 面板：

```text
模型: [xxx-SVC]        step: [...]
cond音频: [TrackObject/GroupObject]
被变声音频: [TrackObject/GroupObject]
cfg: [slider]
输出名: [...]
```

SVS 工具：

```text
模型: [xxx-SVS]        step: [...]
音色音频: [TrackObject/GroupObject]
旋律音频: [TrackObject/GroupObject]
目标text: [假名输入或 text TrackObject/GroupObject]
目标romaji: [罗马音输入]
cfg_text: [slider]
cfg_midi: [slider]
cfg_cond: [slider]
输出名: [...]
```

现实约束：

- 当前 `infer_v4_formal.py` 只支持统一 `--cfg`
- `cfg_text / cfg_midi / cfg_cond` 是未来参数设计
- 第一版可将这些 UI 参数映射到统一 cfg，或只启用统一 cfg

---

## 3. 项目树结构

普通项目编辑界面不显示全局资源库，只显示当前项目自己的树。

项目树不是普通文件管理器，而是完整工程资产树。它看起来像文件树，但管理的是工程资产和工程语义。路径服务人的组织理解；对象之间的真实依赖必须通过 UID 和 object relation 表达。

概念上，项目对象系统分为三类职责：

```text
资源定位系统：workspace / resource / renders
时间线单元系统：tracks / Track / TrackObject / TrackSource
组合输入系统：groups / GroupObject
```

这个分层是概念分层，实际区分主要落在 Object kind、对象所在区域和对象行为规则上，不要求项目文件物理拆成多套互不相关的数据结构。

项目内固定顶层结构：

```text
project
├─ workspace       用户手工素材区
├─ resource        从全局 resource 复制来的项目内资源
├─ trackSources    TrackObject 专属源对象
├─ tracks          TrackFolder / TrackObject
├─ groups          GroupObject
└─ renders         工具输出归档资源
```

全局 resource 在单独资源管理页面编辑：

```text
globalResource
└─ ...
```

新建项目时，全量复制 `globalResource` 到项目内 `project:/resource`。项目运行时只依赖自己的 `resource` 副本，不 live 依赖全局资源。

### 3.1 workspace

`workspace` 是当前项目工作素材区。

允许内容：

- AudioObject
- MidiObject
- TextObject
- folder

规则：

- 可建文件夹
- 可重命名
- 可删除
- 可与 `resource` 互相移动/复制
- 可拖入中间时间线，拖入时复制到 `trackSources`
- 可拖入右侧工具输入槽：不允许，必须先变成 TrackObject

### 3.2 resource

`resource` 是从全局资源模板复制进项目的参考素材区。

规则：

- 和 `workspace` 一样是普通素材区
- 可与 `workspace` 互相移动/复制
- 区别只是默认来源和组织语义
- 新建项目时从全局资源全量复制而来

### 3.3 trackSources

`trackSources` 是时间线单元系统的内部源支撑区。

`TrackObject / Track` 是时间线单元系统的基础单元。`TrackSource` 服务于这个单元，是 TrackObject/Track 的内部支撑对象，不是 `workspace/resource/renders` 那种用户资源定位对象，也不应被理解为普通资源池或引用复用入口。

当普通 Object 从 `workspace/resource/renders` 拖入时间线时：

```text
Object
  -> copy to project:/trackSources/...
  -> create TrackObject pointing to copied Object
```

规则：

- 内部允许重命名、建文件夹、移动整理
- 不能移动到 `trackSources` 目录以外
- 不能复制到 `trackSources` 目录以外
- 外部对象不能手动复制进 `trackSources`
- 只有“拖入时间线”这个系统动作会创建 trackSources 副本
- 如果要把时间线源对象保存成普通素材，使用专门命令“保存副本到 workspace/resource”
- 删除被 TrackObject 引用的 trackSources 对象时，需要提示，并同步删除或处理对应 TrackObject

### 3.4 tracks

`tracks` 保存 TrackFolder 和 TrackObject，是真实树，不是动态视图。

```text
project:/tracks
├─ Track 1
│  ├─ TrackObject A
│  └─ TrackObject B
└─ Track 2
   └─ TrackObject C
```

TrackObject 只能存在于 `tracks/<TrackFolder>` 下。

TrackFolder 规则：

- 是普通树节点
- 有固定 `trackType: 'audio' | 'midi' | 'text'`
- 一个 TrackFolder 只能容纳同类型 TrackObject
- 支持重命名
- 支持排序
- 支持删除
- 重命名同步中间音轨名
- 排序同步中间音轨顺序
- 删除空轨直接删除
- 删除非空轨需确认，会删除其下 TrackObject
- Undo 必须恢复 TrackFolder、TrackObject、源对象、Group 关系和音轨顺序

TrackObject 规则：

- 删除 TrackObject 树节点会删除中间时间线元素
- 复制 TrackObject 会复制其 source object，并自动分配到一个新的空音轨
- 复制 TrackObject 创建的新 TrackFolder 类型等于 TrackObject.contentType
- 复制后保持原 timelineStart/timelineEnd
- TrackObject 可在中间拖到别的音轨
- TrackObject 也可在左栏 tracks 树拖到别的 TrackFolder
- 两种移动音轨方式效果一致
- TrackObject 只能移动到同类型 TrackFolder，类型不一致时拒绝并提示

### 3.5 groups

`groups` 只允许保存 GroupObject 和 folder。

规则：

- GroupObject 只能存在于 `project:/groups` 内
- 可在 `groups` 内建子文件夹整理
- GroupObject 不能移动/复制到 `workspace/resource/renders/trackSources/tracks`
- GroupObject 不能拖入中间时间线
- GroupObject 只能拖入右侧处理工具面板
- 如果要变成普通素材，必须执行“渲染/合并为对象”

默认保存位置：

```text
project:/groups/audio
project:/groups/midi
project:/groups/text
```

### 3.6 renders

`renders` 是资源定位系统的一部分，是工具成功产出的项目资源归档区。

`renders` 不是工具历史面板。工具输出一旦进入 `renders`，它就是项目资源，可以继续被定位、复用、拖入 timeline、作为后续工具输入。工具历史如果未来需要，应作为单独机制设计，不污染 `renders` 的资源定位语义。

`renders` 不限于音频。SVC/SVS 输出的 AudioObject、Whisper 输出的 timestamped TextObject、F0/pitch 提取结果、切片/标注结果等，只要是有后续复用价值的工具产物，都应对象化并进入项目对象系统；通常进入 `renders`。

模型输出完成后生成两份语义不同的对象：

```text
render output
├─ renders/...       归档副本
└─ trackSources/...  时间线工作副本，被 TrackObject 引用
```

规则：

- `renders` 只接收模型输出
- 不允许手动把普通对象塞进 `renders`
- 允许从 `renders` 移动/复制到 `workspace/resource`
- 从 `renders` 拖入时间线时，表现和 `workspace/resource` 一致：复制到 `trackSources`，再创建 TrackObject
- 删除 `renders` 归档对象不影响已经进入时间线的 trackSources 副本和 TrackObject

---

## 4. 树节点与 UID

所有对象节点必须有稳定 UID。路径只用于显示和定位，不作为程序引用。

```ts
type NodeId = string

interface BaseTreeNode {
  id: NodeId
  kind: TreeNodeKind
  name: string
}
```

基本原则：

- UID 给程序找对象
- 树结构给人看
- 移动、重命名节点不会导致引用失效
- 运行时可由树构建 `nodeIndex`
- 路径如 `project:/workspace/foo` 只用于 UI 展示
- 所有跨对象引用使用 `NodeId`

项目文件可以保存嵌套树。运行时构建索引：

```ts
interface RuntimeTreeIndex {
  nodes: Record<NodeId, TreeNode>
  parentById: Record<NodeId, NodeId | null>
}
```

---

## 5. 核心对象模型

### 5.1 AudioAsset

`AudioAsset` 是底层完整音频数据，不直接暴露给用户。

```ts
interface AudioAsset {
  id: string
  storage: 'projectBlob' | 'resourceBlob' | 'generatedFile'
  blobKey?: string
  filePath?: string
  sampleRate: number
  duration: number
  channels: number
}
```

原则：

- AudioAsset 永远表示一段完整音频
- 不再使用 `file_start/file_end` 裁剪源文件
- 切分、裁剪、合并都生成新的完整 AudioAsset

### 5.2 AudioObject

`AudioObject` 是用户可见的完整音频对象。

```ts
interface AudioObjectNode extends BaseTreeNode {
  kind: 'audio'
  audio: {
    assetId: string
    midiObjectId: NodeId | null
    textObjectId: NodeId | null
    tags?: string[]
  }
}
```

原则：

- AudioObject 指向完整 AudioAsset
- 不保存源文件裁剪时间戳
- 可关联 MidiObject / TextObject
- 这些关联是 UID 引用，不装载到 TrackObject
- 重新生成 MIDI/Text 时更新关联

### 5.3 MidiObject

`MidiObject` 由 AudioObject 生成，也可在未来 MIDI 编辑器中编辑。

```ts
interface MidiObjectNode extends BaseTreeNode {
  kind: 'midi'
  midi: {
    sourceAudioObjectId: NodeId | null
    versions: MidiVersion[]
    activeVersionId: string
  }
}

interface MidiVersion {
  id: string
  name: string
  createdAt: string
  dataPath?: string
  midiData?: unknown
}
```

### 5.4 TextObject

`TextObject` 保存假名、罗马音和分段时间。

```ts
interface TextObjectNode extends BaseTreeNode {
  kind: 'text'
  text: {
    sourceAudioObjectId: NodeId | null
    segments: TextSegment[]
  }
}

interface TextSegment {
  start: number
  kana: string
  romaji: string
}
```

显示编辑规则：

- 用户输入显示层不做格式干涉
- kana 怎么写就怎么显示
- romaji 怎么写就尽量保留
- 唯一自动干涉是假名和罗马音互转

互转规则：

- kana -> romaji：每个假名单元之间加空格
- romaji -> kana：罗马音空格作为假名单元分隔，转成 kana 后空格消失
- 符号在显示层全部保留

SVS 推理前文本归一化：

- 使用 kana/text 作为源
- 同一个 TextObject 内按 `segments.start` 排序后拼接
- 多个 TextObject 合并时，中间强制加 `|`
- 删除所有空格
- 所有符号统一转成 `|`
- 当前 SVS 推理不使用 `segments.start` 做对齐，只用于排序

### 5.5 TrackObject

`TrackObject` 是时间线包装对象，只表示某个 Object 在时间线上的摆放。

```ts
interface TrackObjectNode extends BaseTreeNode {
  kind: 'trackObject'
  trackObject: {
    contentType: 'audio' | 'midi' | 'text'
    sourceObjectId: NodeId
    timelineStart: number
    timelineEnd: number
    ignored: boolean
  }
}
```

原则：

- TrackObject 不装载媒体内容
- TrackObject 不保存源媒体裁剪信息
- TrackObject 只保存时间线位置
- TrackObject 的轨道归属由其所在 TrackFolder 决定
- 一个 TrackObject 只指向一个 source object
- 复合关系由 folder 或 Group 表达
- TrackObject 必须放在同类型 TrackFolder 下

### 5.6 TrackFolder

`TrackFolder` 表示中间时间线中的一条轨道，同时也是 `project:/tracks` 下的树节点。

```ts
interface TrackFolderNode extends BaseTreeNode {
  kind: 'trackFolder'
  trackFolder: {
    trackType: 'audio' | 'midi' | 'text'
    muted?: boolean
    solo?: boolean
    volume?: number
  }
  children: TrackObjectNode[]
}
```

原则：

- 一个 TrackFolder 只能容纳同类型 TrackObject
- audio track 只显示 audio TrackObject
- midi track 只显示 midi TrackObject
- text track 只显示 text TrackObject
- 中间栏根据 trackType 选择 renderer
- 复制 TrackObject 到新空轨时，新 TrackFolder 自动使用该 TrackObject 的 contentType
- 移动 TrackObject 到不同类型 TrackFolder 时拒绝

### 5.7 GroupObject

`GroupObject` 表示多个同类型 TrackObject 的带时间关系合并输入。

```ts
interface GroupObjectNode extends BaseTreeNode {
  kind: 'group'
  group: {
    mediaType: 'audio' | 'midi' | 'text'
    trackObjectIds: NodeId[]
  }
}
```

原则：

- GroupObject 只能由 TrackObject 建立
- GroupObject 保存 live TrackObjectId
- GroupObject 只能包含同类型 TrackObject
- GroupObject 类型来自 TrackObject 的 contentType
- GroupObject 成员显示和解析永远按 TrackObject.timelineStart 排序
- GroupObject 不能拖入中间时间线
- GroupObject 只能拖入右侧处理工具面板
- GroupObject 是多段媒体的合并对象

Group 展开 UI：

- Group 本体是树节点
- 展开成员是虚拟子项，不是真 TreeNode
- 点击成员可选中/定位中间对应 TrackObject
- 删除成员只从 Group 中移除该 TrackObjectId，不删除 TrackObject
- 拖 TrackObject 到已有 Group 可加入成员
- 类型不一致时拒绝
- 重复加入时不重复添加

---

## 6. 操作语义

### 6.1 拖入时间线

普通 Object 从 `workspace/resource/renders` 拖入中间时间线时：

```text
1. 复制 Object 到 project:/trackSources/...
2. 创建 TrackObject
3. TrackObject 指向 trackSources 副本
4. TrackObject 放入 project:/tracks/<TrackFolder>
```

GroupObject 不可拖入中间时间线。

### 6.2 切分 TrackObject

切分操作基于 TrackObject。

因为 TrackObject 指向 trackSources 专属源对象，所以不需要 copy-on-write。

切分结果：

```text
TrackObject T -> T1 + T2
source Object S -> S1 + S2
```

规则：

- 生成两个新的完整媒体 Object
- 生成两个新的 TrackObject
- 旧 TrackObject 删除
- 旧 source Object 删除
- 如果 Group 包含旧 TrackObject，则替换为两个新 TrackObject
- 左栏 trackSources 中旧源节点替换为两个同级源节点
- Undo 必须恢复旧 TrackObject、旧源对象和 Group 引用

### 6.3 合并 TrackObject

合并操作基于 TrackObject。

合并结果：

```text
T1 + T2 + ... -> T_merged
S1 + S2 + ... -> S_merged
```

规则：

- 永远生成新的完整 Object
- 永远生成新的 TrackObject
- 替换原来的多个 TrackObject
- 删除原 trackSources 源对象
- 如果相关 Group 对合并集合是全包含，则 Group 中这些 TrackObject 替换为合并后的 TrackObject
- 如果某个 Group 只包含合并集合的一部分，则阻止合并并提示

### 6.4 移动 TrackObject

移动时间位置：

- 只修改 TrackObject.timelineStart/timelineEnd
- 不修改 source Object
- Group 自动跟随，因为引用 live TrackObjectId

移动音轨：

- 可在中间时间线拖到别的音轨
- 也可在左栏 tracks 树拖到别的 TrackFolder
- 两者效果一致
- 保持 timelineStart/timelineEnd 不变
- 只能移动到同类型 TrackFolder
- 如果目标 TrackFolder 类型不一致，拒绝移动并显示自动消失提示

### 6.5 忽略 TrackObject

忽略只修改 TrackObject.ignored。

Group 解析时跳过 ignored TrackObject。合成前如果 Group 内有 ignored 元素，提示用户这些元素不会参与合成。

### 6.6 删除 TrackObject

删除 TrackObject 时：

- 删除 TrackObject
- 删除其专属 trackSources 源对象
- 如果属于 Group，提醒用户
- 确认后从所有相关 Group 中移除
- 空 Group 自动删除
- 单元素 Group 保留
- Undo 必须恢复 TrackObject、源对象、树位置、Group 引用和 blob

当前 checkpoint 已闭合：

- 从中间删除 segment 会同步删除 TrackObject、专属 trackSources 源对象、asset，并维护 Group 引用
- 从左侧删除 TrackObject 会反向删除对应 timeline segment、专属 trackSources 源对象、asset，并维护 GroupObject 与旧 CompGroup 引用
- 从左侧删除 TrackFolder 会反向删除对应 timeline track、子 TrackObject、专属 trackSources 源对象、asset，并维护 GroupObject 与旧 CompGroup 引用
- 从左侧删除被 TrackObject 引用的 trackSources 源对象时，不执行孤立删除，而是转为语义删除对应 TrackObject
- 从左侧删除 GroupObject 会同步删除旧 CompGroup

### 6.7 删除 renders 对象

删除 renders 归档对象：

- 只删除归档
- 不影响已经进入时间线的 trackSources 副本
- 不影响对应 TrackObject

### 6.8 删除 workspace/resource 对象

删除 workspace/resource 中的原始对象：

- 不影响已拖入时间线的 trackSources 副本
- 不影响 TrackObject

---

## 7. Group 依赖维护

GroupObject 保存 live TrackObjectId，因此所有会改变 TrackObject 集合的操作必须通过统一语义命令，不允许直接改 store。

依赖规则：

| 操作 | Group 联动 |
|---|---|
| 删除 TrackObject | 提醒；确认后从相关 Group 移除；空 Group 删除，单元素 Group 保留 |
| 切分 TrackObject | Group 中旧 TrackObject 替换为切分后的多个新 TrackObject |
| 合并 TrackObject | 如果相关 Group 全包含合并对象，则替换为合并后 TrackObject；若部分包含，则阻止合并 |
| 移动 TrackObject | Group 自动跟随 |
| 忽略 TrackObject | Group 解析时跳过 ignored，并在合成前提示 |
| TrackObject 意外缺失 | Group 标记损坏，不可合成 |

正常编辑操作必须维护 Group，不应产生断链。只有导入损坏、手工改文件、撤销 bug 等异常情况才可能出现缺失成员。缺失时 Group 整体不可合成，提示需要修复。

---

## 8. 右侧处理工具面板输入模型

右侧处理工具面板按工具声明输入槽。当前 SVC/SVS 等需要时间性输入的槽位默认只接受：

- TrackObject UID
- GroupObject UID

不接受：

- 普通 AudioObject
- 普通 MidiObject
- 普通 TextObject
- Folder

当前 checkpoint 兼容策略：SVS 音色参考槽额外接受普通 AudioObject。普通 AudioObject 被视为无时间性参考，解析起点按 0 处理；SVS 输出仍对齐 melody 输入的最早 timelineStart，不受 timbre 参考时间影响。该兼容用于降低当前音色参考使用成本，长期是否收紧回 TrackObject/GroupObject-only 另行复审。

输入槽结构：

```ts
interface RenderInputRef {
  kind: 'trackObject' | 'group'
  id: NodeId
  displayName: string
  displayPathAtPick?: string
}
```

执行工具时实时解析 UID：

- 如果 UID 存在，读取当前对象状态
- 如果 UID 不存在，显示“原对象不存在”，不可合成
- 如果 Group 损坏，Group 整体不可执行

### 8.1 槽位类型匹配

| 槽位 | 接受 |
|---|---|
| SVC 被变声音频 | audio TrackObject / audio GroupObject |
| SVC cond 音频 | audio TrackObject / audio GroupObject |
| SVS 音色音频 | audio TrackObject / audio GroupObject；当前兼容普通 AudioObject |
| SVS 旋律音频 | audio 或 midi TrackObject / audio 或 midi GroupObject |
| SVS text | text TrackObject / text GroupObject / 手写文本 |

SVS text 槽使用引用模式或手写模式二选一，当前激活模式决定推理文本。

### 8.2 Group 解析

Group 本质上在合成时解析为一段临时媒体。

统一规则：

- 无论放入哪个输入槽，都保留 TrackObject 的时间间隔
- 取所有参与 TrackObject 的最早 timelineStart 作为临时媒体 0 秒
- ignored TrackObject 被跳过
- 如果 Group 内存在被跳过元素，合成前提示

audio Group：

- 根据每个 TrackObject 的 timelineStart/timelineEnd 合成临时 WAV
- 保留相对间隔和静音

midi Group：

- 根据 TrackObject 时间关系组合 MIDI 数据
- 具体 MIDI 算法后续设计

text Group：

- 根据 TrackObject.timelineStart 排序
- 不同 TextObject / TrackObject 之间加 `|`
- 再按 SVS 文本归一化规则处理

### 8.3 输出命名

处理工具面板提供可编辑输出名。默认自动生成，重名自动编号。

默认命名：

```text
SVC_<sourceName>_<modelName>_<001>
SVS_<melodyName>_<modelName>_<001>
```

输出位置：

```text
project:/renders/svc/<outputName>
project:/renders/svs/<outputName>
```

同时创建：

```text
project:/trackSources/audio/<trackIndex>-<outputName>-<uid>
project:/tracks/<TrackFolder>/<TrackObject>
```

---

## 9. SVC / SVS 工具流程

### 9.1 SVC

输入：

- `被变声音频`：audio TrackObject 或 audio GroupObject
- `cond音频`：audio TrackObject 或 audio GroupObject

流程：

```text
1. 解析输入 UID
2. 对 TrackObject/GroupObject 生成临时 WAV
3. 调用 YingMusic-SVC
4. 输出 WAV 写入 renders/svc
5. 复制输出到 trackSources
6. 创建 TrackObject 加入 tracks
7. 新 TrackObject 对齐被变声音频的最早开始时间
```

### 9.2 SVS

输入：

- `音色音频`：audio TrackObject 或 audio GroupObject
- `旋律音频`：audio/midi TrackObject 或 audio/midi GroupObject
- `target text`：text TrackObject、text GroupObject 或手写文本

流程：

```text
1. 解析输入 UID
2. 生成音色参考临时媒体
3. 生成旋律参考临时媒体
4. 生成 target_text
5. 调用 YingMusic-Singer-Plus
6. 输出 WAV 写入 renders/svs
7. 复制输出到 trackSources
8. 创建 TrackObject 加入 tracks
9. 新 TrackObject 对齐旋律输入的最早开始时间
```

YingMusic-Singer-Plus 当前脚本约束：

```text
--ref_audio
--melody_audio
--target_text
--output
--steps
--cfg
--seed
--device
```

---

## 10. 快捷键与定位

快捷键：

| 快捷键 | 行为 |
|---|---|
| Alt+N | TrackObject 定位 |
| Alt+L | 定位 AudioObject |
| Alt+M | 定位关联 MidiObject |
| Alt+K | 定位关联 TextObject |

`Alt+N` 双向行为：

- 中间时间线选中 TrackObject：L2 定位到对应 TrackObject 树节点，临时高亮 0.5 秒
- 左栏单选 TrackObject：中间时间线滚动/定位到对应元素，临时高亮 0.5 秒
- 左栏多选或选中非 TrackObject：提示“请选择一个时间线对象”

`Alt+L/M/K`：

- 从当前 TrackObject 或 AudioObject 追溯关联对象
- 成功时 L2 定位并临时高亮
- 不改变全局选择
- 失败时显示自动消失通知，例如：
  - `该音频尚未生成 MIDI`
  - `该音频尚未关联歌词`
  - `当前选择无法定位`

---

## 11. 中间时间线显示规范

中间时间线根据 TrackFolder.trackType 使用不同显示方式。

### 11.1 Audio TrackObject

Audio TrackObject 继承当前音频轨显示思路：

- 显示音频块
- 显示 F0 曲线
- 显示播放头
- 支持切分、移动、合并、忽略、播放

AudioObject 永远代表完整媒体，因此时间线播放不再需要源裁剪 offset，只需要根据 TrackObject.timelineStart/timelineEnd 调度完整音频。

### 11.2 Text TrackObject

Text TrackObject 显示为歌词时间条。

基础形态：

```text
┌────────────────────────────────────┐
│ きみのこえが    | とおくなる        │
│ ki mi no ko e ga | to o ku na ru    │
└────────────────────────────────────┘
```

显示规则：

- 横向位置来自 TrackObject.timelineStart/timelineEnd
- 内部分段来自 TextObject.segments[].start
- 显示层展示用户原始 kana/text，不做 SVS 推理归一化
- zoom 低时显示单行省略
- zoom 高时显示 segment 分隔线
- 可选第二行小字显示 romaji
- 第一版中间栏只负责预览和排布，不直接承担复杂文本编辑
- 文本编辑主要在左栏 TextObject 展开面板中完成

### 11.3 Midi TrackObject

Midi TrackObject 显示为 pitch-time 二维预览。

显示规则：

- 横轴是时间
- 纵轴是 pitch/frequency bin
- 如果 MIDI 数据是二维分布，显示 heatmap
- 如果 MIDI 数据已经离散成 note，显示 piano-roll note rectangles
- 可叠加主旋律线，便于快速观察音高走势
- 第一版中间栏只负责预览和排布
- 真正 MIDI 编辑器后续单独设计，可复用该二维显示作为预览层

示意：

```text
high pitch ┤      ░▒█▒
           │    ░████▒
           │  ░██▒
low pitch  └──────────────── time
```

---

## 12. 撤销 / 重做

撤销系统需要从当前简单 path patch 升级为“语义命令为主、patch 为辅”的混合模型。

原因：

- 树操作不能稳定依赖字符串路径
- TrackObject 删除会牵连 source object、Group、blob
- 切分/合并会生成和删除多个节点
- Undo 必须恢复父节点、index、引用关系和二进制数据

语义命令示例：

```ts
type Command =
  | MoveTreeNodeCommand
  | InsertTreeNodeCommand
  | RemoveTreeNodeCommand
  | SplitTrackObjectCommand
  | MergeTrackObjectsCommand
  | MoveTrackObjectCommand
  | DeleteTrackObjectCommand
  | PatchCommand
```

删除 TrackObject 命令必须至少保存：

```ts
interface DeleteTrackObjectCommandPayload {
  trackObjectSnapshot: TrackObjectNode
  trackObjectParentId: NodeId
  trackObjectIndex: number

  sourceNodeSnapshot: TreeNode
  sourceParentId: NodeId
  sourceIndex: number

  affectedGroups: Array<{
    groupId: NodeId
    beforeTrackObjectIds: NodeId[]
    afterTrackObjectIds: NodeId[]
  }>

  deletedBlobSnapshots?: unknown[]
}
```

只要会删除或替换节点、TrackObject、blob，就必须进入语义命令，不能直接改 store。

---

## 13. 现有系统中需要保留的设计

这些现有逻辑是下一阶段的地基，不建议推倒：

- Canvas 时间线
- Timeline Editor 作为 project/root 的默认富媒体编辑器
- F0 曲线绘制
- 片段切分/移动/合并/复制粘贴体验
- 音轨 solo/mute 和 TrackObject ignore，用于 AI 候选结果比较、筛选和再处理
- Web Audio 播放调度
- Project JSON + blob 分离保存
- Patch-based undo/redo 的基础思想
- SVC 结果自动回填新轨道
- 合成组 snapshot/完整性检查思想，演化为 Group 依赖维护

需要演化的点：

- `AudioSegment` 的源裁剪模型改为完整 Object 模型
- `CompGroup` 演化为 `GroupObject`
- 右侧合成入口演化为通用处理工具面板，SVC/SVS 只是第一批工具
- tracks/segments store 逐步迁移到树节点 + TrackObject 模型
- 中间区域从固定时间线演化为多 tab Rich Media Editor Workspace

---

## 14. 延后设计

以下内容不在本轮定稿范围内：

- MIDI 二维编辑器的具体算法
- 时间平滑、频谱平滑、二维范围平滑、频谱液化、半音提升等工具实现
- romaji/kana 转换器的完整语言规则
- SVS `cfg_text/cfg_midi/cfg_cond` 多条件参数的真实模型支持
- 当前旧项目格式到新对象树格式的迁移脚本
- 具体 Pinia store 拆分和 API 命名
- 后端临时文件生命周期和缓存清理策略

---

## 15. 版本化设计 checkpoint

后续较小的设计/实现 checkpoint 使用共享版本号组织在 `docs/updates/` 下：

```text
docs/updates/baseline/report.md
+ docs/updates/verX.Y/report.md
+ ...
= 当前项目整体状态
```

每个版本目录结构：

```text
docs/updates/verX.Y/
├─ design.md   本 checkpoint 的最小设计
└─ report.md   checkpoint 收束后生成的现实报告
```

`design.md` 和 `report.md` 共享同一版本号。前者记录意图，后者记录现实。checkpoint 尚未实现或尚未收束时，可以只有 `design.md`，不需要提前创建空的 `report.md`。

当前下一阶段设计 checkpoint：

```text
docs/updates/ver0.3/design.md
report.md 将在 ver0.3 收束时生成
```

---

## 16. 共识复审清单

本节逐条复核问答过程中形成的共识是否已经进入文档。部分早期结论被后续讨论修订，状态标为“已修订”。

| # | 共识主题 | 最终结论 | 文档位置 | 状态 |
|---|---|---|---|---|
| 1 | timeline 是否独立保存 | 后续改为 TrackObject 作为真实树节点存在于 tracks 下 | 3.4, 5.5 | 已修订并纳入 |
| 2 | project/resource 是否引用外部资源 | 后续改为新项目全量复制 globalResource 到项目内 resource | 3, 3.2 | 已修订并纳入 |
| 3 | resource 是否目录映射+索引 | 后续改为全局资源模板，全量复制进项目 | 3, 3.2 | 已修订并纳入 |
| 4 | project 保存真实目录树 | project 保存真实树，对象本体在树节点中 | 3, 4, 5 | 已纳入 |
| 5 | resource 是否内嵌 | 项目内 resource 是全局资源复制来的项目内副本 | 3.2 | 已纳入 |
| 6 | 是否保留全局 resource | 保留，但单独资源管理页面编辑 | 3 | 已纳入 |
| 7 | 新建项目是否全量复制 resource | 全量复制 | 3 | 已纳入 |
| 8 | 跨区域移动/复制 | workspace/resource 普通互通；trackSources/groups/renders/tracks 有边界规则 | 3.1-3.6 | 已修订并纳入 |
| 9 | TrackObject 与源对象关系 | TrackObject 是包装对象，引用 source object | 5.5 | 已纳入 |
| 10 | 多引用 copy-on-write | 后续由“拖入时间线复制到 trackSources”消除多引用问题 | 6.1 | 已修订并纳入 |
| 11 | 切分后左栏变化 | 切分 TrackObject 同步切 source object，旧节点替换为新节点 | 6.2 | 已纳入 |
| 12 | 合并语义 | 合并永远生成新完整 Object 和新 TrackObject | 6.3 | 已纳入 |
| 13 | 删除与 UID/path | 所有引用用 UID，路径只显示；删除进入语义命令 | 4, 12 | 已纳入 |
| 14 | 撤销模型 | 语义命令为主，patch 为辅 | 12 | 已纳入 |
| 15 | 合成输入保存快照还是 UID | 最终改为只接受 TrackObject/GroupObject UID | 8 | 已修订并纳入 |
| 16 | 生成结果默认位置 | renders 归档，同时复制到 trackSources 并加入 tracks | 3.6, 8.3, 9 | 已纳入 |
| 17 | Group 解析间隔 | 无论槽位如何，保留 TrackObject 时间间隔 | 8.2 | 已纳入 |
| 18 | Group 输出对齐 | 对齐 Group/输入的最早 timelineStart | 8.2, 9 | 已纳入 |
| 19 | TextObject 推理处理 | 显示不干涉；推理前归一化 | 5.4 | 已纳入 |
| 20 | TextObject start 是否参与推理 | 当前只用于排序，不做 SVS 对齐 | 5.4 | 已纳入 |
| 21 | TrackObject 是否复合 | 一个 TrackObject 只指向一个源对象 | 5.5 | 已纳入 |
| 22 | Folder 是否可作为输入 | 不允许；多段输入必须走 GroupObject | 3, 5.6, 8 | 已纳入 |
| 23 | Group 保存时间 | 后续改为 Group live 引用 TrackObject，时间来自 TrackObject | 5.6, 8.2 | 已修订并纳入 |
| 24 | Group 保存快照还是引用 | 最终为 live TrackObjectId | 5.6, 7 | 已修订并纳入 |
| 25 | Group live 依赖维护 | Group 存 live TrackObjectId，编辑操作维护依赖 | 5.6, 7 | 已纳入 |
| 26 | 删除 Group 成员 TrackObject | 允许但提醒；同步从 Group 移除 | 6.6, 7 | 已纳入 |
| 27 | ignored 是否参与 Group | 不参与，合成前提示 | 6.5, 7, 8.2 | 已纳入 |
| 28 | 切分联动 | 切 source、切 TrackObject、更新 Group | 6.2, 7 | 已纳入 |
| 29 | trackSources 默认折叠 | 所有目录默认折叠；trackSources 作为项目目录 | 2.1, 3.3 | 已纳入 |
| 30 | 删除 TrackObject 是否删 source | 删除 TrackObject 同时删除专属 trackSources 源对象，且可撤销 | 6.6, 12 | 已纳入 |
| 31 | TrackObject 是否装载 midi/text | TrackObject 不装载；关联在 AudioObject 上 | 5.2, 5.5 | 已纳入 |
| 32 | Object 是否完整媒体 | Object/Asset 永远代表完整媒体，无源裁剪时间戳 | 5.1, 5.2 | 已纳入 |
| 33 | 拖入时间线是否复制 | 复制到 trackSources，TrackObject 指向副本 | 6.1 | 已纳入 |
| 34 | Group 能否拖入中间 | 不能，只能拖入右侧 | 3.5, 5.6, 6.1 | 已纳入 |
| 35 | Group 创建入口 | 由时间线同类型 TrackObject 创建，也可拖 TrackObject 加入已有 Group | 5.6, 3.5 | 已纳入 |
| 36 | Group 成员顺序 | 永远按 TrackObject.timelineStart 显示和解析 | 5.6, 8.2 | 已纳入 |
| 37 | L1/L2 选中模型 | 后续改为 L1/L2 共用全局多选 Set | 2.1 | 已修订并纳入 |
| 38 | 左栏多选 | 支持全局多选；对象可选，文件夹不可选 | 2.1 | 已纳入 |
| 39 | 文件夹拖拽与定位 | 文件夹可拖拽；定位不选中，只临时高亮 | 2.1, 10 | 已纳入 |
| 40 | L1/L2 同对象去重 | selection 使用 NodeId Set 去重 | 2.1 | 已纳入 |
| 41 | 多选拖入右侧 | 不允许；右侧只接受单个 TrackObject/GroupObject | 8 | 已纳入 |
| 42 | Group 保存位置 | 默认保存到 project:/groups/audio|midi|text | 3.5 | 已纳入 |
| 43 | TrackObject 是否显示在树里 | TrackObject 作为真实树节点存在 | 3.4, 5.5 | 已纳入 |
| 44 | TrackObject 放置限制 | 只能在 tracks/TrackFolder 下 | 3.4 | 已纳入 |
| 45 | 移动音轨入口 | 中间拖动和左栏 tracks 拖动都允许 | 6.4 | 已纳入 |
| 46 | TrackFolder 行为 | 可重命名、排序、删除，同步中间音轨 | 3.4 | 已纳入 |
| 47 | 普通项目是否显示 globalResource | 不显示，另开管理页面 | 3 | 已纳入 |
| 48 | trackSources 权限 | 可内部整理，但不能移/复制到外部 | 3.3 | 已纳入 |
| 49 | renders 是否可到 workspace/resource | 允许移动/复制到 workspace/resource，非生成对象不能塞入 renders | 3.6 | 已纳入 |
| 50 | workspace/resource 区别 | 都是普通素材区，可互相移动/复制 | 3.1, 3.2 | 已纳入 |
| 51 | GroupObject 区域限制 | 只能留在 groups 内 | 3.5 | 已纳入 |
| 52 | renders 拖入时间线 | 和普通 Object 一样复制到 trackSources；模型输出会自动生成 renders 和 trackSources 两份 | 3.6, 6.1, 9 | 已纳入 |
| 53 | 删除 renders 影响 | 不影响已进入时间线的 trackSources 副本和 TrackObject | 6.7 | 已纳入 |
| 54 | 输出命名 | 面板可编辑输出名，默认自动生成，重名编号 | 8.3 | 已纳入 |
| 55 | 输入槽 origin/快照 | 最终改为 TrackObject/GroupObject UID；不存在则不可合成 | 8 | 已修订并纳入 |
| 56 | 输入槽是否接受普通 Object | 不接受，必须先变成 TrackObject 或 GroupObject | 8 | 已纳入 |
| 57 | 输入槽类型匹配 | SVC/SVS 槽位按 contentType/mediaType 匹配 | 8.1 | 已纳入 |
| 58 | SVS text 引用/手写 | 二选一，当前激活模式决定推理文本 | 8.1 | 已纳入 |
| 59 | Group 缺失成员 | 正常操作维护依赖；异常缺失时 Group 不可合成 | 7, 8 | 已纳入 |
| 60 | Text TrackObject 显示 | 中间栏显示为歌词时间条，保留用户显示文本，可显示 romaji 小字 | 11.2 | 已纳入 |
| 61 | Midi TrackObject 显示 | 中间栏显示 pitch-time 二维预览，未来 MIDI 编辑器复用 | 11.3 | 已纳入 |
| 62 | TrackFolder 单类型 | TrackFolder 强制单类型，TrackObject 只能放入同类型轨道 | 3.4, 5.6, 6.4 | 已纳入 |
| 63 | 产品目标 | AISVC-midi-web 是 AI 歌声制作工程系统，不是单一 SVC Web UI | 1 | 已纳入 |
| 64 | 中间区域定位 | 中间是多 tab Rich Media Editor Workspace，Timeline 是 project/root 默认编辑器 | 2.2 | 已纳入 |
| 65 | editor context | 左侧 selection 不等于中间 editor context，复杂对象显式打开 editor tab | 2 | 已纳入 |
| 66 | 右侧定位 | 右侧是处理工具面板，SVC/SVS/Whisper 等都是工具，不是对象子系统 | 2.3, 8 | 已纳入 |
| 67 | 工具结果对象化 | 有复用价值的工具结果默认进入项目对象系统，通常进入 renders | 1, 3.6 | 已纳入 |
| 68 | renders 定位 | renders 是资源定位系统的一部分，不是工具历史面板 | 3.6 | 已纳入 |
| 69 | TrackSource 定位 | TrackSource 是 TrackObject/Track 的内部支撑对象，不是普通资源池 | 3.3 | 已纳入 |
| 70 | legacy 长期方向 | TrackObject/GroupObject 是长期主模型，legacy segment/CompGroup 最终退出 | 1, 13 | 已纳入 |
| 71 | 实验候选场景 | solo/mute/ignore/renders 多结果服务于候选比较、筛选和再处理 | 1, 13 | 已纳入 |

---

## 17. 当前设计一句话总结

AISVC-midi-web 是 AI 歌声制作工程系统：用户在左侧对象树组织工程资产，在中间多 tab 富媒体编辑器中编辑时间线、MIDI、文本和未来分析对象，在右侧处理工具面板消费对象并产出新对象。TrackObject/GroupObject 是长期主模型；工具结果默认对象化并回到项目资源循环；所有跨对象链接用 UID，树路径只为人服务。

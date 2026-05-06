# AISVC-midi-web 设计文档

> 多音轨音频编辑 + F0 可视化 + AI-SVC 合成前端
>
> 技术栈：Vue 3 + NaiveUI + Node.js TypeScript + pnpm
>
> 路径：`E:\AIscene\AISVC-midi-web`

---

## 目录

1. [架构总览](#1-架构总览)
2. [数据结构设计](#2-数据结构设计)
3. [核心状态管理](#3-核心状态管理)
4. [Canvas 渲染管线](#4-canvas-渲染管线)
5. [交互系统设计](#5-交互系统设计)
6. [合成组机制](#6-合成组机制)
7. [撤销/重做](#7-撤销重做)
8. [后端 API 设计](#8-后端-api-设计)
9. [项目文件格式](#9-项目文件格式)
10. [目录结构](#10-目录结构)

---

## 1. 架构总览

```
┌─────────────────────────────────────────────────┐
│                    Browser (Vue 3)               │
│  ┌──────────┐ ┌────────────┐ ┌────────────────┐ │
│  │ NaiveUI  │ │  Pinia     │ │  Offscreen     │ │
│  │ 组件 +   │ │  Store     │ │  WebWorker     │ │
│  │ Canvas   │ │  (undoable)│ │  (F0 extraction)│ │
│  └──────────┘ └────────────┘ └───────┬────────┘ │
│                                       │          │
└───────────────────────────────────────┼──────────┘
                                        │ HTTP/WS
┌───────────────────────────────────────┼──────────┐
│              Node.js Backend (TS)     │          │
│  ┌──────────┐ ┌──────────────────────┐│          │
│  │ Express  │ │  SVC Engine          ││          │
│  │ REST API │ │  (调用 YingMusic)    ││          │
│  └──────────┘ └──────────────────────┘│          │
│  ┌──────────────────────────────────┐ │          │
│  │  Audio Service                   │ │          │
│  │  · WAV读写 · F0提取 · 混音/拼接  │ │          │
│  └──────────────────────────────────┘ │          │
└───────────────────────────────────────┴──────────┘
```

---

## 2. 数据结构设计

### 2.1 核心 ID 体系

所有实体使用 `crypto.randomUUID()` 生成唯一 ID，保证跨会话引用一致性。

```typescript
type TrackId = string;       // "trk_xxxxxxxx"
type SegmentId = string;     // "seg_xxxxxxxx"
type CompGroupId = string;   // "cgrp_xxxxxxxx"
type ProjectId = string;     // "proj_xxxxxxxx"
```

### 2.2 AudioSegment — 音频片段（最小操作单元）

一个音轨被切分后产生的每一块。

```typescript
interface AudioSegment {
  id: SegmentId;
  trackId: TrackId;

  /** 在原始 WAV 文件中的采样范围 */
  sourceFile: string;       // 原始 WAV 绝对路径
  srcStartSample: number;   // 片段起始采样点
  srcEndSample: number;     // 片段结束采样点

  /** 在项目时间轴上的位置 */
  timelineStart: number;    // 秒，片段起点在时间轴上的位置
  timelineEnd: number;      // 秒，片段终点在时间轴上的位置
  // timelineEnd - timelineStart = (srcEndSample - srcStartSample) / sr

  /** 片段自己的 F0 数据（缓存）*/
  f0Data: F0Frame[] | null;
  f0Extracted: boolean;

  /** UI 状态 */
  color: string;            // 所属音轨的颜色（从 track 继承）
  ignored: boolean;         // 被忽略（Alt+点击 切换），忽略后预览时静音
}
```

**设计要点**：`sourceFile` + `srcStartSample` + `srcEndSample` 三元组指向原始音频，不复制数据。只有当合成组生成时才产生新音频文件。

### 2.3 Track — 音轨

```typescript
interface Track {
  id: TrackId;
  name: string;             // 可重命名，默认 "音轨 1"
  color: string;            // 从调色板分配

  /** 该音轨包含的所有片段，按 timelineStart 排序 */
  segments: SegmentId[];

  /** 关联的原始 WAV */
  sourceFile: string;
  sampleRate: number;
  totalSamples: number;

  /** F0 数据（整轨缓存）*/
  f0Cache: F0Frame[] | null;

  /** UI 状态 */
  collapsed: boolean;       // 是否折叠
  muted: boolean;
  solo: boolean;
  volume: number;           // 0~1
  ignored: boolean;         // 被忽略（Alt+点击 切换），忽略后预览时静音。若整轨 ignored，轨内所有片段视为 ignored

  /** 关联的合成组（仅 SVC 生成的结果音轨有值）*/
  boundCompGroupId: CompGroupId | null;
}
```

### 2.4 F0Frame — 音高帧

```typescript
interface F0Frame {
  t: number;       // 时间（秒），相对音频起点
  freq: number;    // 基频 Hz，unvoiced = 0
  prob: number;    // 置信度 0~1 (pYin voiced probability)
}
```

F0 提取参数：
- 算法：`librosa.pyin`
- 降采样：16kHz
- 帧长：2048 samples，hop：256 → **16ms/帧**
- 音域：C2 (65.4Hz) ~ C7 (2093Hz)

### 2.5 CompGroup — 合成组

```typescript
interface CompGroup {
  id: CompGroupId;
  name: string;             // 默认 "合成组 1"，可重命名

  /** 生成时锁定的快照 */
  elements: GroupElementSnapshot[];

  /** 合成的结果音频（新 WAV）*/
  combinedAudio: {
    filePath: string;       // 项目目录下生成的 WAV
    startTime: number;      // 合成组在时间轴上的起点（所有元素的最小 timelineStart）
    endTime: number;        // 终点（所有元素的最大 timelineEnd）
    duration: number;
  } | null;

  /** SVC 转换结果 */
  svcResult: {
    modelName: string;      // 使用的音色模型
    trackId: TrackId;       // 新增的结果音轨 ID
    status: 'pending' | 'running' | 'done' | 'failed';
    progress: number;       // 0~100
    eta: number;            // 预计剩余秒数
  } | null;

  /** UI 状态 */
  collapsed: boolean;
  expanded: boolean;        // 双击切换，展开显示绑定的结果音轨
}

interface GroupElementSnapshot {
  type: 'segment' | 'track';
  id: SegmentId | TrackId;  // 引用原始实体的 ID
  startTime: number;        // 生成时的时间轴起点
  endTime: number;          // 生成时的时间轴终点
}
```

**关键设计**：`elements` 保存的是快照而非实时引用。若元素在合成后发生变更（拆分/合并/移动），通过比对 `id` 和当前实体判断"源数据已拆分"。

### 2.6 Project — 项目根

```typescript
interface Project {
  id: ProjectId;
  name: string;
  version: string;          // "1.0.0"

  tracks: Record<TrackId, Track>;
  trackOrder: TrackId[];    // UI 显示顺序

  compGroups: Record<CompGroupId, CompGroup>;
  compGroupOrder: CompGroupId[];

  /** 全局时间轴 */
  timelineOffset: number;   // 所有元素的时间偏移（留白）
  pxPerSec: number;         // 当前缩放级别，持久化

  /** 全局 F0 设置 */
  f0Settings: {
    fmin: number;     // Hz
    fmax: number;
    algorithm: 'pyin';
    hopMs: number;    // 16
  };

  /** 创建/修改时间 */
  createdAt: string;        // ISO 8601
  modifiedAt: string;
}

/**
 * SVC 运行时配置（不保存在 Project 中）
 * 顶栏可随时调整模型、参数，合成时按当前值执行。
 */
interface SvcRuntimeConfig {
  /** 当前选中的模型名称 */
  modelName: string;        // "v3 20k campplus"

  checkpoint: string;       // 模型权重路径
  configYml: string;        // yml 配置路径
  targetAudio: string;      // 参考音频路径
  diffusionSteps: number;   // 10~200，默认 100
  inferenceCfgRate: number; // 0.0~1.0，默认 0.7
  f0Condition: boolean;     // 是否启用 F0 condition
  semiToneShift: number | null; // null = 自动音高迁移
  device: string;           // "cuda:0"
  fp16: boolean;
}
```

---

## 3. 核心状态管理

### 3.1 Pinia Store 顶层设计

```
store/
├── project.ts        ← Project 全局状态
├── tracks.ts         ← 音轨 CRUD
├── selection.ts      ← 选中项管理（多选）
├── compGroups.ts     ← 合成组
├── history.ts        ← 撤销/重做
├── playback.ts       ← 播放状态
├── svcConfig.ts      ← SVC 运行时配置（顶栏可调，不存项目）
├── clipboard.ts      ← 剪贴板（Ctrl+C/V 复制粘贴）
└── f0.ts             ← F0 提取队列
```

### 3.2 选中模型

```typescript
interface SelectionState {
  /** 当前选中的实体 ID 集合 */
  selected: Set<TrackId | SegmentId | CompGroupId>;

  /** 选中类型 */
  type: 'none' | 'tracks' | 'segments' | 'compGroups' | 'mixed';

  /** 混合选中时不允许合并/拖动（启发式保护）*/
  isMixed(): boolean;       // type === 'mixed'

  /** 操作 */
  select(id: string, additive: boolean): void;
  deselect(id: string): void;
  clear(): void;
  selectAll(type: 'tracks' | 'segments' | 'compGroups'): void;
}
```

**规则**：
- 不带 `Ctrl` 的点选自动 `clear()` 后再 `add`（单选模式）
- `Ctrl+click` → `toggle`
- 点击空白 → `clear()`
- 点击顶栏控件不算"点击空白"

### 3.2a 剪贴板

```typescript
interface ClipboardState {
  /** 复制的片段深层拷贝（独立于原始数据）*/
  items: DeepCopySegment[];

  /** 是否有可粘贴的内容 */
  hasContent: ComputedRef<boolean>;

  /** Ctrl+C：深层克隆当前 selected 中的所有 Segment */
  copy(): void;

  /** Ctrl+V：在时间轴上原位置粘贴，分配新 SegmentId/TrackId */
  paste(): Command;
}

interface DeepCopySegment {
  sourceFile: string;
  srcStartSample: number;
  srcEndSample: number;
  timelineStart: number;
  timelineEnd: number;
  color: string;
  f0Data: F0Frame[] | null;
}
```

**复制/粘贴规则**：
- `Ctrl+C` 记录当前所有选中 Segment 的快照（深层拷贝，后续对原 segment 的操作不影响剪贴板）
- `Ctrl+V` 在**原时间位置**粘贴（不偏移），为每个片段生成新的 `SegmentId`
- 粘贴时，如果原片段所在音轨还存在，则加入原音轨；如果原音轨已被删除，则新建一条音轨
- 粘贴触发一次 History Command，可 `Ctrl+Z` 撤销

### 3.2b SVC 运行时配置 Store

```typescript
interface SvcConfigState {
  config: SvcRuntimeConfig;       // 当前配置（见 2.6）

  /** 可用的模型预设列表（从本地文件系统扫描）*/
  presets: SvcRuntimeConfig[];

  /** 更新某个字段 */
  updateField<K extends keyof SvcRuntimeConfig>(key: K, value: SvcRuntimeConfig[K]): void;

  /** 切换预设 */
  selectPreset(name: string): void;

  /** 扫描本地可用的模型 */
  scanPresets(): Promise<void>;
}
```

顶栏 UI：
```
[模型: v3 20k campplus  ▾]  [扩散步数: 100  ▾]  [cfg: 0.7]  [🎤 合成]
```
模型下拉菜单列出所有本地扫描到的 checkpoint 预设。

### 3.2c 忽略（Ignore）状态

忽略不单独建 Store，直接写在 Segment/Track 的 `ignored` 字段上。

**交互**：
- `Alt + 左键` 点击片段色块 → `segment.ignored = !segment.ignored`
- `Alt + 左键` 点击 TrackHeader → `track.ignored = !track.ignored`
- 忽略的音轨/片段，Canvas 渲染时变灰/降低透明度，预览播放时跳过该段音频
- 再次 `Alt + 左键` 取消忽略
- 忽略不进入 History Stack（属于预览状态切换，非数据变更）

### 3.3 撤销/重做机制

采用 **Command Pattern**，每次操作封装为不可变 Command：

```typescript
interface HistoryEntry {
  id: string;
  timestamp: number;
  description: string;      // "切分音轨 1 的片段 #3"
  undo: () => void;          // 回放 inverse patches
  redo: () => void;
}

// Patch 格式（JSON-serializable）
type Patch =
  | { op: 'add'; path: string; value: any }
  | { op: 'remove'; path: string; oldValue: any }
  | { op: 'replace'; path: string; value: any; oldValue: any };

interface Command {
  description: string;
  patches: Patch[];          // forward
  inversePatches: Patch[];   // backward
}
```

**关键路径表示**：
- `"tracks[id].segments"` — 音轨片段列表
- `"tracks[id]"` — 整条音轨
- `"compGroups[id]"` — 合成组
- `"selection.selected"` — 选中集合

> `Ctrl+Z` 执行 `inversePatches`，`Ctrl+Y` / `Ctrl+Shift+Z` 执行 `patches`。

---

## 4. Canvas 渲染管线

### 4.1 渲染架构

每个音轨用一个独立的 `<canvas>` 元素。所有 canvas 放在一个垂直滚动的容器中：

```
<ScrollContainer>          ← overflow-y: auto
  <TrackRow v-for="track"> ← 一行 = 一条音轨
    <TrackHeader />        ← 左侧边界（可 Ctrl+点击 多选）
    <TrackCanvas />        ← Canvas 渲染该轨
  </TrackRow>
</ScrollContainer>
```

**为什么不用一个大 Canvas？**
- 每轨独立渲染，滚动时只需重绘可见轨
- 音轨拖拽重排是 DOM 操作，不触发重绘
- F0 数据独立缓存，互不干扰

### 4.2 Canvas 尺寸与 DPI

```typescript
function setupCanvas(canvas: HTMLCanvasElement, widthPx: number, heightPx: number) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(widthPx * dpr);
  canvas.height = Math.round(heightPx * dpr);
  canvas.style.width = widthPx + 'px';
  canvas.style.height = heightPx + 'px';
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  return ctx;
}
```

### 4.3 单轨 F0 渲染流程

```
1. 获取该轨所有 Segment 的 F0 数据（缓存或懒加载）
2. 按时间轴坐标映射到像素：
   x = PADDING_LEFT + t * pxPerSec
   y = PADDING_TOP + chartH * (1 - logRatio)
       其中 logRatio = (log2(f) - log2(fmin)) / (log2(fmax) - log2(fmin))
3. 对连续 voiced 段，逐个绘制 path 线段
4. 散点叠加置信度点（大/亮 = 高置信）
5. unvoiced 区域不绘制曲线
```

### 4.4 片段可视化

在 F0 曲线下方，每个 Segment 绘制一个半透明的矩形色块：

```
┌─────────── F0 Curve Area ───────────┐
│  ╱╲  ╱╲    ╱╲    ╱╲╱╲             │  高度：~60% 轨道高度
│ ╱  ╲╱  ╲──╱  ╲──╱    ╲──          │
├─────────────────────────────────────┤
│ ████ segment 1 ████████████ seg 2 ██│ ← 片段色块，高度：~15%
│          cut line ↓                  │
├─────────────────────────────────────┤
```

- 色块可点击选中（高亮边框）
- 切割线显示为垂直虚线
- 选中时片段有发光边框

### 4.5 水平同步滚动

所有音轨的 Canvas 放在一个水平滚动容器内，共享 `pxPerSec` 和 `scrollLeft`：

```typescript
// 当任一 Canvas 改变 scrollLeft 时，同步所有轨
watch(pxPerSec, () => {
  // 重新计算各 Canvas 总宽度并重绘
});
```

---

## 5. 交互系统设计

### 5.1 交互映射表

| 操作 | 触发方式 | 目标 |
|------|---------|------|
| 选中音轨 | `Ctrl + 左键` 点击音轨左侧边界 | 整条 Track |
| 选中片段 | `左键` 点击 Canvas 上的片段色块 | Segment |
| 多选片段 | `Ctrl + 左键` 逐个点击片段色块 | Segment[] |
| 矩形框选 | `Tab + 左键` 拖拽画出矩形 | 矩形内/接触矩形边的所有 Segment |
| 切分音轨 | `Shift + 左键` 点击 Canvas 上的时间点 | 在该时间点切割 |
| 合并 | `Ctrl + B` | 按下时处理当前选中集 |
| 复制 | `Ctrl + C` | 深层拷贝当前所有选中 Segment |
| 粘贴 | `Ctrl + V` | 在时间轴原位置粘贴复制的 Segment |
| 加入合成组 | `Enter` | 当前所有选中项 |
| 删除 | `Del` / `Delete` | 当前所有选中项 |
| 删除合成组 | 选中合成组后 `Del` | 删除合成组及绑定的结果音轨 |
| 忽视/取消忽视 | `Alt + 左键` 点击片段色块或 TrackHeader | 切换 Segment/Track.ignored |
| 撤销 | `Ctrl + Z` | 上一步 |
| 重做 | `Ctrl + Y` / `Ctrl + Shift + Z` | 下一步 |
| 拖动移动 | 选中（可多个）后按住 `Ctrl` + 拖拽片段色块 | 左右移动所有选中 Segment |
| 取消选中 | 点击空白区域 | — |
| 选中合成组关联 | `空格 + 单击` 合成组 | 选中所有 element |
| 展开/折叠合成组 | `双击` 合成组 | 显示/隐藏结果音轨 |

### 5.2 切分算法

```
输入：Track, cutTime (秒)
输出：新的 Segment 列表

1. 遍历 track.segments，找到满足的 segment：
     segment.timelineStart < cutTime < segment.timelineEnd
2. 计算切割点在原始音频中的采样位置：
     elapsedInSeg = cutTime - segment.timelineStart
     cutSample = segment.srcStartSample + elapsedInSeg * sampleRate
3. 创建两个新 Segment：
     segA = { ...segment, srcEndSample: cutSample, timelineEnd: cutTime }
     segB = { ...segment, srcStartSample: cutSample, timelineStart: cutTime }
     分配新 SegmentId
4. 在 track.segments 中用 segA, segB 替换原 segment
5. 生成 History Command（undo 时会恢复为原 segments 列表）
```

### 5.3 Ctrl+B 合并算法

```typescript
function merge(selected: Set<SegmentId | TrackId>, state: ProjectState): Command {
  const segments = resolveToSegments(selected);

  // Case 1: 同音轨相邻片段 → 轨内合并
  const byTrack = groupBy(segments, s => s.trackId);
  for (const [trackId, segs] of byTrack) {
    if (areConsecutive(segs, trackId)) {
      return mergeWithinTrack(trackId, segs);
    }
  }

  // Case 2: 不同音轨的多个整条音轨 → 合并为一条音轨
  // ... (见 5.3.1)

  // Case 3: 同音轨不相邻 / 不同音轨片段 → 新开一条音轨
  // ... (见 5.3.2)

  // Case 4: 整条音轨 + 片段音轨 → 移到最上面那条整条音轨
  // ... (见 5.3.3)
}
```

**Case 2 — 多条整轨合并**：将所有 segments 按时间排序，生成一条新 Track。

**Case 3 — 不相邻片段合并**：创建新 Track，把所有 segment 移入，按 `timelineStart` 排序。

**Case 4 — 混合合并**：找 `selected` 中所有整条 Track 的最上面一条作为目标，把所有 segment 移入目标 Track.segments。

### 5.4 拖动移动（支持多选）

```
1. 用户选中 N 个 Segment（来自同一音轨或不同音轨）
2. 按住 Ctrl + mousedown 在任意选中片段上 → 开始拖拽
3. mousemove：计算 Δx → 换算为 Δt = Δx / pxPerSec
4. 同时更新所有选中 segment 的 timelineStart/timelineEnd += Δt
5. 跨轨拖动也是允许的——每个片段在自己的音轨内独立位移
6. 在音轨内部不越界限制（不能覆盖同一轨的其他非选中 segment）
7. mouseup：生成 History Command（包含所有片段的位移记录）
8. 拖动过程中实时重绘所有受影响的 Canvas
```

**越界处理**：
- 片段不能越过同轨前一个非选中片段的 `timelineEnd + 1ms` 或后一个非选中片段的 `timelineStart - 1ms`
- 若检测到即将越界，吸附到边界
- 若某音轨只有被拖拽的这些片段（或被拖拽的片段为首/尾），则可以无限制向该方向移动

### 5.5 矩形框选（Tab + 左键拖拽）

```
1. 用户按下 Tab + 左键，在 Canvas 区域拖拽
2. 绘制半透明蓝色矩形选区（跟随鼠标）
3. mouseup 时，收集所有与该矩形相交或被包含的 Segment：
   - 矩形完全包含该 Segment 色块
   - 矩形与 Segment 色块边界接触
4. 选中的 Segment 加入 selection（替换当前选中，不带 Ctrl 模式）
5. 如果拖拽时按住 Ctrl + Shift，则在现有选中的基础上追加
```

**矩形坐标转换**：
```
rect.left → xToTime(rect.left)   → 时间起点
rect.right → xToTime(rect.right) → 时间终点
rect.top → yToPitch(rect.top)    → 音高上限
rect.bottom → yToPitch(rect.bottom) → 音高下限
```

穿过矩形覆盖的时间范围 × 音轨范围的 Segment 全部选中。

### 5.6 复制粘贴机制

```
Ctrl+C:
  1. 深拷贝当前所有选中 Segment 的数据（sourceFile + src range + timeline + f0Data）
  2. 存入 clipboard.items
  3. 不触发 History Command（复制只读，不影响数据）

Ctrl+V:
  1. 检查 clipboard.items 是否为空
  2. 为每个 clipboard item 创建新 Segment：
     - 生成新 SegmentId
     - 时间位置 = 原 timelineStart/timelineEnd（不偏移）
     - 如果原 trackId 对应的音轨仍存在 → 加入该音轨
     - 如果原音轨已被删除 → 创建新音轨
  3. 更新对应 Track.segments 并按 timelineStart 排序
  4. 自动选中所有新粘贴的 Segment
  5. 生成 History Command（undo 会移除这些新 segment）
```

### 5.7 忽略渲染

被忽略的片段/音轨在 Canvas 上的表现：

```
正常片段：     [████████████]   opacity: 1.0
被忽略片段：   [░░░░░░░░░░░░]   opacity: 0.25, 灰色调
被忽略音轨：   整条轨道 Canvas overlay 斜线网纹 + 整体降低饱和
```

播放时：遍历时间轴上的所有 Segment，跳过 `segment.ignored === true` 或 `segment.track.ignored === true` 的片段。

---

## 6. 合成组机制

### 6.1 创建流程

```
Enter 按下
  │
  ▼
1. 收集当前 selected 中的所有元素
2. 创建 CompGroup：
     name = "合成组 N"（N = compGroupOrder.length + 1）
     elements = 每个元素的快照
3. 音频合成：后台请求 POST /api/combine
     → 把各元素的音频段按时间轴拼接为一段 WAV
     → 保存到 {projectDir}/combined/cgrp_{id}.wav
4. 更新 compGroup.combinedAudio
5. 生成 History Command
```

### 6.2 源数据检测

```typescript
function checkGroupIntegrity(group: CompGroup, state: ProjectState): boolean {
  for (const snap of group.elements) {
    if (snap.type === 'segment') {
      const seg = findSegment(snap.id);
      if (!seg) return false;                           // 被删除了
      if (seg.timelineStart !== snap.startTime ||       // 被移动了
          seg.timelineEnd !== snap.endTime) return false;
    }
    if (snap.type === 'track') {
      const track = state.tracks[snap.id];
      if (!track) return false;                         // 被删除了
      // 整轨的时间变化可由 segments 推断
    }
  }
  return true;
}
```

当检测失败时，`空格 + 单击` 不执行选中，顶栏弹出 `<n-tooltip>` 提示"合成组源数据已拆分"。

### 6.3 SVC 合成

```
点击顶栏 "合成" 按钮
  │
  ▼
1. 检测合成组的 combinedAudio 已生成
2. POST /api/svc/compose
     body: { combinedWav, modelConfig }
3. 后端调用 YingMusic SVC
     → 实时 WebSocket 推送 progress + eta
4. 前端更新 compGroup.svcResult.progress
5. 完成后，生成新 Track 绑定到 compGroup.svcResult.trackId
6. compGroup.svcResult.status = 'done'
```

**进度显示**：在左侧栏合成组元素上显示环形进度条 + ETA 文字。

### 6.4 双击展开/隐藏

```
双击合成组
  → compGroup.expanded = !compGroup.expanded
  → 若 expanded && svcResult.status === 'done'：
     在合成组下方显示绑定结果音轨（完整行，带自己的 Canvas）
  → 若 !expanded：隐藏该音轨行
```

---

## 7. 撤销/重做

### 7.1 全局快捷键

```typescript
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    historyStore.undo();
  }
  if (e.ctrlKey && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
    e.preventDefault();
    historyStore.redo();
  }
});
```

### 7.2 History Store

```typescript
interface HistoryState {
  stack: Command[];       // 最多保留 200 条
  pointer: number;        // 当前指针，-1 = 无历史
  maxSize: number;        // 200

  push(command: Command): void;
  undo(): void;
  redo(): void;
  canUndo: ComputedRef<boolean>;
  canRedo: ComputedRef<boolean>;
}
```

`push` 时若 `pointer < stack.length - 1`（即处于中间状态后又做了新操作），丢弃 `stack[pointer+1..]`。

---

## 8. 后端 API 设计

```
Base URL: http://localhost:8101/api
```

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/audio/info?path=` | 返回 WAV 元信息（sr, samples, duration） |
| `POST` | `/audio/extract-f0` | 提交 F0 提取任务 |
| `GET` | `/audio/f0/:jobId` | 轮询 F0 提取进度/结果 |
| `GET` | `/audio/segment/:segId.wav` | 流式返回片段音频 |
| `POST` | `/combine` | 将多个音频段拼接为一段 WAV |
| `POST` | `/svc/run` | 提交 SVC 转换任务 |
| `WS` | `/svc/ws/:jobId` | WebSocket 推送 SVC 进度 |
| `GET` | `/svc/result/:jobId.wav` | 下载 SVC 结果 |
| `POST` | `/project/save` | 保存项目 |
| `GET` | `/project/load/:id` | 加载项目 |
| `POST` | `/project/export` | 导出选中/全部为 WAV |

**F0 提取**：后端调用 librosa.pyin，缓存结果到 `f0_cache/{fileHash}.json`，后续相同文件秒出。

**SVC 运行**：后端 `child_process.spawn` 调用 `my_inference.py`，通过 stdout 解析进度，WebSocket 推送前端。

---

## 9. 项目文件格式

保存为 `.asvcproj`（JSON 文件 + 同级目录存储音频）：

```
my_project.asvcproj        ← JSON，结构 = Project 接口
my_project_data/           ← 音频数据目录
├── combined/              ← 合成组生成的 WAV
│   └── cgrp_xxx.wav
├── svc/                   ← SVC 结果 WAV
│   └── svc_yyy.wav
└── f0_cache/              ← F0 提取缓存
    └── {hash}.json
```

**导入的原始 WAV 不复制**，仅保存绝对路径引用 `sourceFile`。

---

## 10. 目录结构

```
E:\AIscene\AISVC-midi-web\
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vite.config.ts
├── index.html
│
├── public/
│   ├── f0_data.json             # F0 演示数据（可删除）
│   └── f0_view.html             # F0 原型演示（可删除）
│
├── src/
│   ├── main.ts                  # Vue 入口
│   ├── App.vue                  # 根组件
│   │
│   ├── types/
│   │   └── index.ts             # 所有类型定义 (Section 2)
│   │
│   ├── stores/
│   │   ├── project.ts           # Project 状态
│   │   ├── tracks.ts            # 音轨 CRUD
│   │   ├── selection.ts         # 选中管理
│   │   ├── compGroups.ts        # 合成组
│   │   ├── history.ts           # 撤销/重做
│   │   ├── playback.ts          # 播放
│   │   ├── svcConfig.ts         # SVC 运行时配置（顶栏可调，不存项目）
│   │   ├── clipboard.ts         # 剪贴板（Ctrl+C/V）
│   │   └── f0.ts                # F0 队列
│   │
│   ├── commands/
│   │   ├── types.ts             # Command / Patch 类型
│   │   ├── split.ts             # 切分
│   │   ├── merge.ts             # 合并
│   │   ├── move.ts              # 拖动（支持多选）
│   │   ├── delete.ts            # 删除
│   │   ├── copyPaste.ts         # 复制粘贴
│   │   ├── addToGroup.ts        # 加入合成组
│   │   └── svcCompose.ts        # SVC 合成
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── TopBar.vue       # 顶栏（文件菜单 + SVC运行时配置 + 合成按钮）
│   │   │   ├── LeftSidebar.vue  # 左侧栏（合成组列表）
│   │   │   └── StatusBar.vue    # 底部状态栏
│   │   │
│   │   ├── track/
│   │   │   ├── TrackRow.vue     # 单条音轨行容器
│   │   │   ├── TrackHeader.vue  # 音轨左侧边界
│   │   │   └── TrackCanvas.vue  # 单轨 Canvas（F0 + 片段色块）
│   │   │
│   │   ├── compGroup/
│   │   │   ├── CompGroupItem.vue   # 合成组列表项
│   │   │   └── CompGroupProgress.vue # 进度条 + ETA
│   │   │
│   │   └── shared/
│   │       ├── F0Renderer.ts    # F0 绘制逻辑（pure functions）
│   │       └── SegmentRenderer.ts # 片段色块绘制
│   │
│   ├── composables/
│   │   ├── useF0Extraction.ts   # F0 提取逻辑
│   │   ├── useHorizontalSync.ts # 多轨水平滚动同步
│   │   ├── useKeyboard.ts       # 全局快捷键
│   │   ├── useDragDrop.ts       # 拖拽移动
│   │   └── useMarqueeSelect.ts  # 矩形框选（Tab + 拖拽）
│   │
│   └── api/
│       └── client.ts            # Axios/fetch 封装
│
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts             # Express 入口
│   │   ├── routes/
│   │   │   ├── audio.ts         # 音频信息、F0、片段流
│   │   │   ├── combine.ts       # 音频拼接
│   │   │   ├── svc.ts           # SVC 调度
│   │   │   └── project.ts       # 项目保存/加载
│   │   ├── services/
│   │   │   ├── f0.service.ts    # F0 提取服务
│   │   │   ├── svc.service.ts   # SVC 进程管理
│   │   │   └── audio.service.ts # 音频读写
│   │   └── ws/
│   │       └── svc.ws.ts        # SVC WebSocket
│   └── f0_cache/                # F0 提取缓存
│
└── docs/
    └── design.md                # 本文档
```

---

## 附录 A：Canvas 坐标系

```
Canvas 原点 (0,0)
─────────────────────────────────────────────►  X = 时间
│ PADDING_LEFT = 52px
│
│  ← 音名标签区 →│←────── F0 曲线区域 ────────→│
│                │                            │
│  C6 ───────────│  ╱╲   ╱╲                  │  ← PAD_TOP
│  C5 ───────────│ ╱  ╲─╱  ╲──               │
│  C4 ───────────│╱            ╲──            │  ← 对数 Y 轴
│  C3 ───────────│                        ───│
│                │                            │
│                │ ██████ seg1 ██████████ seg2 │  ← 片段色块
│                │     │ cut                   │
│                ├─────────────────────────────┤
│                     ↑ 时间标签              │
└─────────────────────────────────────────────┘
                    Y = 频率
```

## 附录 B：NaiveUI 组件选型

| 组件 | 用途 |
|------|------|
| `n-dropdown` | 顶栏文件菜单（鼠标悬停展开）|
| `n-select` | SVC 模型选择下拉、参数选择 |
| `n-input-number` | 扩散步数、cfg rate 数值输入 |
| `n-button` | 合成按钮、导入导出 |
| `n-modal` | 合成组重命名、项目另存为 |
| `n-tooltip` | "合成组源数据已拆分" 提示 |
| `n-progress` | 合成进度条（圆形）|
| `n-tag` | 合成组元素类型标签 |
| `n-divider` | 音轨之间分隔 |
| `n-scrollbar` | 全局滚动条（Better than native）|
| `n-message` | Toast 通知（操作结果）|
| `n-switch` | 是否启用 F0 condition、fp16 等 |

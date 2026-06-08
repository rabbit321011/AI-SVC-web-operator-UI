# AISVC-midi-web Baseline Report

> 版本：baseline  
> 状态：版本化 updates 链条开始前的当前状态快照  
> 日期：2026-06-08  
> 依据：`docs/object-workbench-design.md`、当前代码结构、当前未提交 diff

---

## 1. 用途

本文件是 `docs/updates/` 版本化报告链条的起点。

后续项目状态按追加方式理解：baseline report + later version reports = 当前项目整体状态。

它不是完整历史 changelog，而是“从现在往后继续设计/实现”的状态基准。

---

## 2. 当前产品方向

当前设计方向已经从 YingMusic-SVC Web UI 升级为 AI 歌声制作工程系统。

已接受的顶层原则：

- `Object` 是工程资产本体，媒体对象只是 Object 的一种。
- 左侧 Object Tree 和中间 Rich Media Editor Workspace 是同一工程对象系统的不同表达与编辑入口。
- 中间区域长期不是固定 timeline，而是多 tab 富媒体编辑器工作区。
- 当前 timeline 是挂载在 `project/root` 下的默认主编辑器。
- 右侧长期是 Tool Panel，不只是 SVC/SVS 合成面板。
- 有复用价值的工具结果默认对象化，进入项目对象系统，通常进入 `renders`。
- `TrackObject` / `GroupObject` 是长期主模型。
- legacy `segment` / `CompGroup` 是迁移期概念，最终应退出产品主模型。
- 对象关系靠 UID，不靠树路径；树路径服务人的组织理解。

证据：`docs/object-workbench-design.md`，`docs/updates/ver0.3/design.md`。

---

## 3. 当前对象类型与树结构

当前代码中的 Object kind 是封闭枚举，不是开放 payload 系统。

已实现类型：`folder`、`audio`、`midi`、`text`、`trackObject`、`trackFolder`、`group`。

当前固定顶层目录：`workspace`、`resource`、`trackSources`、`tracks`、`groups`、`renders`。

当前实现状态：

- `ProjectObjectTree` 已有 `schemaVersion: object-workbench.v1`。
- `buildNodeIndex` 已能建立 `nodes / parentById / pathById`。
- UID 是真实索引依据，路径由当前树结构派生。
- 顶层目录由 `TOP_LEVEL_IDS` 固定定义。
- `AudioObject` 当前有 asset 引用、midi/text 关联位、tags。
- `TextObject` 当前包含 `segments: { start, kana, romaji }[]`，歌词和 romaji 已绑定在同一文本结构中。
- `TrackObject` 当前包含 `sourceObjectId / timelineStart / timelineEnd / ignored`。
- `TrackFolder` 当前包含 `trackType / muted / solo / volume / color`。
- `GroupObject` 当前包含 `mediaType / trackObjectIds`。

证据：`client/src/object-workbench/types.ts`，`client/src/object-workbench/objectTree.ts`。

---

## 4. 当前区域边界与对象策略

已实现规则：

- `workspace/resource` 可互相移动/复制普通素材。
- `trackSources` 对象不能手动移出，也不能从外部手动移入。
- `groups` 只允许 GroupObject 和 folder。
- GroupObject 只能留在 `groups` 内，不能拖入 timeline。
- `renders` 只接收工具/模型输出，不能手动塞入普通对象。
- `renders` 对象允许移动/复制到 `workspace/resource`。
- 只有 `workspace/resource/renders` 内的普通素材可拖入 timeline。
- 文件夹不能被选择，非 folder 节点可选。
- 右侧槽位基础策略仍主要接受 TrackObject / GroupObject；当前另有 AudioObject 兼容例外。

当前语义解释：

- `workspace/resource/renders` 是资源定位系统。
- `tracks/TrackObject/TrackSource` 是时间线单元系统。
- `groups/GroupObject` 是组合输入系统。
- `trackSources` 是 TrackObject/Track 的内部源支撑区，不是普通资源池。

证据：`client/src/object-workbench/treePolicy.ts`，`docs/object-workbench-design.md`。

---

## 5. Legacy 迁移与双轨现实

当前代码仍是新对象树与 legacy timeline 双轨并存。

已实现：

- 旧项目可通过 `legacyProjectToObjectTree(project)` 派生对象树。
- legacy Track 转成 `TrackFolder`。
- legacy AudioSegment 转成 `trackSources/audio` 下的 AudioObject、`tracks/<TrackFolder>` 下的 TrackObject 和对应 AudioAsset。
- legacy CompGroup 转成 GroupObject。
- 迁移过程保留 `legacy` 字段，用于 segmentId / trackId / compGroupId 回连。
- 缺失 track、segment、compGroup 引用时记录 warnings，而不是直接抛异常。

当前仍未完成：

- legacy `tracks / segmentsMap / compGroups` 仍是运行时重要数据结构。
- `TrackObject / GroupObject` 还没有完全取代 legacy `segment / CompGroup`。
- timeline 编辑仍大量通过 legacy store 执行，再同步到 object tree。

长期方向：`TrackObject / GroupObject` 成为唯一主模型，legacy `segment / CompGroup` 最终退出产品主模型。

证据：`client/src/object-workbench/legacyAdapter.ts`，`client/src/stores/project.ts`，`client/src/stores/objectTree.ts`，`client/src/stores/tracks.ts`，`client/src/stores/compGroups.ts`。

---

## 6. Object Tree Store 当前能力

`useObjectTreeStore` 已经不是纯文档概念，当前承担大量同步和桥接职责。

已实现：

- 创建空对象树。
- 从 legacy project 派生对象树。
- 直接加载/保存 explicit objectTree。
- 节点查询、父节点查询、后代判断。
- guarded move / create folder / rename / delete。
- 导入文件到 `workspace/resource`。
- 普通 AudioObject 拖入 timeline：复制到 `trackSources`，创建 legacy track/segment 和 TrackObject。
- SVC/SVS render audio 落地：写入 `renders`，复制到 `trackSources`，创建 timeline TrackObject。
- pasted timeline track 同步回 object tree。
- TrackFolder 名称同步。
- legacy elements 创建 GroupObject。
- moved / deleted / merged / split segment 同步 object tree。
- split undo 可恢复 object tree snapshot。

最近小闭合已覆盖：

- 从 timeline 删除 segment，同步删除 TrackObject、专属 trackSources source、asset，并维护 Group 引用。
- 从左侧删除 TrackObject，反向删除 legacy timeline segment、专属 source、asset，并维护 GroupObject / legacy CompGroup。
- 从左侧删除 TrackFolder，删除 legacy timeline track、子 TrackObject、source、asset，并维护 GroupObject / legacy CompGroup。
- 从左侧删除被 TrackObject 引用的 trackSources source，转为语义删除 TrackObject。
- 从左侧删除 GroupObject，同步删除 legacy CompGroup。

当前限制：这些能力仍是迁移期桥接逻辑，不代表 legacy 已退出；删除/切分/合并等跨系统操作还没有全部收束到统一 command API。

证据：`client/src/stores/objectTree.ts`，`client/src/stores/objectTreeSyncTimeline.test.ts`，`client/src/stores/objectTreeTimelineDrop.test.ts`，`client/src/stores/historyTimelineCommands.test.ts`。

---

## 7. GroupObject 当前状态

GroupObject 已经有真实代码实现，不是空白设计。

已实现：

- `createGroupObject` 根据 TrackObject 创建 GroupObject。
- GroupObject 只能包含同类型 TrackObject。
- GroupObject 保存 live TrackObjectId。
- 成员按 TrackObject timelineStart 排序。
- 解析 GroupObject 时保留 TrackObject 相对时间关系。
- ignored TrackObject 会被跳过并返回 warnings。
- Group 缺失或类型不匹配时会明确失败。
- legacy CompGroup 可适配为 GroupObject。
- 左侧 GroupObject 删除会同步删除 legacy CompGroup。

当前限制：legacy CompGroup 仍存在；部分创建入口仍是先创建 legacy CompGroup，再同步 GroupObject；GroupObject 还没有成为唯一组合输入模型。

证据：`client/src/object-workbench/groupResolver.ts`，`client/src/object-workbench/groupResolver.test.ts`，`client/src/stores/objectTree.ts`，`client/src/composables/useKeyboard.ts`。

---

## 8. Render / Tool Panel 当前状态

当前右侧代码仍是 `RenderPanel`，以 SVC/SVS 为核心；“Tool Panel”是已经接受的长期设计方向，但尚未泛化实现。

已实现：

- 右侧面板支持 SVC/SVS 模式切换。
- 每个模式保留自己的输入槽和参数草稿。
- 槽位支持从当前 selection 放入，也支持拖拽 drop。
- SVC 槽位：cond audio、source audio。
- SVS 槽位：timbre audio、melody、text ref/manual text。
- SVC/SVS 有各自 running/done/failed 状态和进度消息。
- 任务运行时对应槽位和执行按钮会锁定。
- SVC/SVS 输出可调用 objectTree 的 `addRenderedAudioToTimeline`，写入 `renders` 并创建 TrackObject。
- SVS dryRun 已存在。

当前输入规则：

- RenderInputRef 支持 `trackObject`、`group`、`audioObject`。
- SVC source audio 只接受 audio TrackObject/GroupObject。
- SVC cond audio 当前接受 audio TrackObject/GroupObject，也兼容普通 AudioObject。
- SVS timbre audio 当前接受 audio TrackObject/GroupObject，也兼容普通 AudioObject。
- SVS melody 只接受 audio/midi TrackObject 或 GroupObject。
- SVS text 接受 text TrackObject/GroupObject 或手写文本。

当前限制：右侧还不是通用 Tool Panel 协议；Whisper、F0/pitch、切片/静音检测等工具尚未实现；Tool 输出对象化的通用协议尚未抽出。

证据：`client/src/stores/renderPanel.ts`，`client/src/components/layout/RenderPanel.vue`，`client/src/composables/useRenderSvcPipeline.ts`，`client/src/composables/useRenderSvsPipeline.ts`，`client/src/object-workbench/renderInputs.ts`，`client/src/object-workbench/renderAudioResolver.ts`，`client/src/object-workbench/renderTextResolver.ts`。

---

## 9. 中间编辑区当前状态

当前现实：中间仍是既有 timeline/canvas 编辑区。

已实现和保留：Canvas timeline、多音轨显示、音频片段显示、F0 曲线绘制、播放头、选中、框选、切分、移动、合并、复制粘贴、静音、独奏、音量、TrackObject/segment ignore、播放调度。

当前设计愿景：中间长期应升级为多 tab Rich Media Editor Workspace；Timeline Editor 是 project/root 的默认 editor；MIDI、Text、Pitch/F0、二维/三维/多维分析编辑器未来显式打开为 editor tab。

当前未实现：尚无 `EditorWorkspace` store；尚无 `EditorTab` 数据结构；尚无 active editor context 与 left selection 的正式分离模型；尚无 object-bound editor tab。

证据：`client/src/components/layout/MainCanvas.vue`，`client/src/components/track/TrackCanvas.vue`，`client/src/stores/tracks.ts`，`docs/updates/ver0.3/design.md`。

---

## 10. 保存、撤回与测试状态

保存与加载：

- `Project.toJSON()` 保存 objectTree、tracks、segments、compGroups、timeline 视图状态、F0 设置等。
- 加载项目时，如果项目包含 explicit objectTree，则直接加载。
- 如果旧项目没有 objectTree，则从 legacy project 派生对象树。
- Project JSON 与 blob 分离仍是当前基础保存思路。
- 当前 project 仍同时保存 objectTree 和 legacy tracks/segments/compGroups。

Undo / Redo：

- 现有 history store 仍保留 patch-based undo/redo 基础。
- timeline 核心编辑命令已进入撤回系统。
- objectTree split undo 有专门 snapshot 恢复路径。
- `object-workbench/semanticCommands.ts` 已有 TrackObject semantic command 测试覆盖，包括 move/split/merge/delete 等概念实现。
- 全部跨系统操作尚未完全统一到一个 command API。

测试覆盖：object tree index、tree policy、legacy adapter、GroupObject、render input validation、audio/text resolver、semantic commands、objectTree folder/move/import/delete、AudioObject 拖入 timeline、render 输出归档回填、objectTree 与 legacy timeline 同步、objectTree UI selection、timeline/object tree selection 互斥、project objectTree persistence。

本 baseline 生成时未重新运行完整测试；本文件是状态快照，不是验证报告。

建议后续 report 生成时运行：`pnpm --filter client test`。

---

## 11. 文档和未提交状态

主文档：

- `docs/object-workbench-design.md`：长期对象工作台设计和 checkpoint-aligned notes。
- `docs/object-workbench-handoff.md`：此前 handoff 文档，可能包含旧阶段上下文。
- `docs/verification.md`：历史与手动验证矩阵。
- `docs/updates/README.md`：版本化 updates 规则。
- `docs/updates/baseline/report.md`：当前 baseline。
- `docs/updates/ver0.3/design.md`：Rich Media Editor Workspace 最小设计。

baseline 生成时，工作区存在未提交改动：`client/src/stores/objectTree.ts`、`client/src/stores/objectTreeSyncTimeline.test.ts`、`docs/object-workbench-design.md`、`docs/updates/`。

其中 `objectTree.ts` 和 `objectTreeSyncTimeline.test.ts` 包含最近小闭合的删除同步实现和测试；`object-workbench-design.md` 包含本轮大方向文档升级；`docs/updates/` 包含 baseline、ver0.3 design/report 和 updates README。

---

## 12. 已实现 / 过渡 / 仅设计 总览

已实现或基本实现：ObjectTree 基础结构、顶层目录、legacy adapter、区域策略、AudioObject 导入、AudioObject 拖入 timeline、render audio 输出进入 renders 并自动回填 timeline、GroupObject 创建/解析、SVC/SVS 面板和 pipeline、SVS dryRun、L1/L2 对象树 UI 状态、timeline/object tree selection 互斥、删除同步小闭合、project 保存 explicit objectTree。

过渡实现：TrackObject/GroupObject 与 legacy segment/CompGroup 双轨并存；RenderPanel 已接近 Tool Panel 的入口形态但仍是 SVC/SVS 专用；semantic commands 有核心测试和部分实现但 store 层仍有不少直接同步逻辑；timeline 仍是中间唯一真实编辑器。

仅设计或未开始：EditorWorkspace store、EditorTab / EditorContext、object-bound editor tab、MIDI editor、Text/kana/romaji 富编辑器、Pitch/F0 editor、Whisper 工具、F0/pitch 提取工具对象化、Tool Panel 通用协议、legacy segment/CompGroup 最终退出。

---

## 13. 下一步最合理 checkpoint

建议下一步仍以 `ver0.3` 为 Rich Media Editor Workspace 最小设计 checkpoint。

目标不是实现 MIDI/Text/Pitch 编辑器，而是先架住中间区域的长期结构：`EditorWorkspace`、`EditorTab`、`EditorContext`、`TimelineEditor mounted at project/root`、`left selection != active editor context`。

完成 ver0.3 后，再考虑 Tool Panel 泛化 checkpoint。

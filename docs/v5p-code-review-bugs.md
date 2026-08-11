# V5-P / AI-Midi 代码 Review Bug 记录

> 这份文档只记录代码 Review 中已经确认的行为问题，不承担架构设计说明。
> 用户确认修订策略后，再把对应条目转为实现任务。

## 记录规则

- 只登记可以从当前代码路径推导出明确错误行为的问题；
- 用户明确否定的候选不保留；
- 每个条目包含触发路径、影响和修订方向；
- 本文档不代表实现已经修复。

## 已确认问题

- `BUG-001`：时间线 SYN 使用 `node:trackObject:*` 作为选择 ID 后，全局 Delete 逻辑尚未处理该类型，因此选中时间线 SYN 按 Delete 没有动作。修订时应删除 TrackObject，并按最终所有权规则清理其专属 `trackSources` 来源。
- `BUG-002`：当前从 Workspace/Resource 拖入 SYN 时，`dropAudioObjectToTimeline()` 直接把原 SYN 写入 TrackObject 的 `sourceObjectId`，没有先创建 `trackSources` 副本。修订时应复制 SYN、Owned Guide、Take assets/blob，再让 TrackObject 只引用该副本。
- `BUG-003`：从没有时间线位置的 AudioObject 创建 SYN 时，创建逻辑仍无条件生成位于 `0` 秒的 TrackObject，但保留 `defaultTimelineStart = null`。该对象随后不能通过时间线拖动，Take 导出也会回落到 `0` 秒。
- `BUG-004`：创建 SYN 会同时修改对象树和 `tracksStore`，但创建历史只保存对象树快照，没有 `tracksBefore/tracksAfter`。撤销后可能留下孤立的合成音轨。
- `BUG-005`：右键删除时间线 AudioObject 的历史记录只保存对象树快照；撤销后 TrackObject 可能恢复，但 `tracksStore.segmentsMap` 和轨道片段不会恢复。
- `BUG-006`：右键“复制到静态资源”只复制节点 JSON，没有复制 AudioAsset、Owned Guide/Take asset 或 Blob，副本继续共享原资产。
- `BUG-007`：删除整条音轨没有创建 History，无法恢复 TrackFolder、TrackObject、来源、片段和音轨顺序。
- `BUG-008`：直接删除仍被时间线 TrackObject 引用的源 SynthesisUnit，会留下指向不存在源对象的悬空 TrackObject。
- `BUG-009`：SYN 移动到 Workspace 时只清空 `timelineTrackId`，没有清空 `defaultTimelineStart`；刷新后可能被自动重新放回时间线。
- `BUG-010`：导出 Take 创建的正式 AudioObject、TrackObject、音轨和 Blob 没有进入 History，无法撤销。
- `BUG-011`：左侧树跨轨移动 TrackObject 没有 History，无法撤销对象树和轨道归属变化。
- `BUG-012`：单独发布带 A 区引用的 B SynthesisUnit 时，不会递归发布 A，跨项目同步后 A 可能失效。
- `BUG-013`：Global Resource 重新发布后，已有项目中的叶子 AudioObject/SynthesisUnit 可能不会替换为新版本。
- `BUG-014`：音轨重命名同时修改 `tracksStore` 和对象树，但没有 History，无法恢复两套状态。
- `BUG-015`：音轨上下移动同时修改 `trackOrder` 和对象树顺序，但没有 History，无法撤销排序。
- `BUG-016`：导入同名音频会复用旧 `sourceBlobs` key；若该 key 已标记持久化，新 Blob 不会重新上传，刷新后可能恢复旧音频。
- `BUG-020`：左侧普通对象/文件夹重命名虽然保存，但没有 History，无法通过 `Ctrl+Z` 恢复。
- `BUG-024`：手工修改、移动或清除 H token 时，旧 `placementRanges` 可能残留，材料快照会使用过期 placement provenance。
- `BUG-025`：编辑器和主时间线的 MIDI-P 播放只按 dense class 合并连续音符，不读取 `flowFrames`，相邻同音高但独立的两个音符会被试听成一个长音。
- `BUG-026`：前端允许写入 `PAD=256`，但合成前的 material snapshot 才拒绝它，导致轨道看似 ready 却无法生成 Take。
- `BUG-027`：右键资源栏中的 SYN“移动到 Workspace”时，源 SYN 会被直接移动，但原有时间线 TrackObject 不会同步移除，留下指向 Workspace 源对象的悬空时间线引用。
- `BUG-029`：导出音频的 renders AudioObject 和 trackSources AudioObject 共用同一个 Blob key；删除时间线对象时清理 trackSources Blob，会同时破坏 renders 中的正式导出音频。
- `BUG-032`：导入项目文件后没有重置 EditorWorkspace，旧项目的 Text/SYN 编辑器 Tab 仍然保留，打开后会指向已经不存在的旧对象。
- `BUG-033`：导入项目文件后没有清空 History，导入新项目后按 `Ctrl+Z` 可能执行旧项目留下的撤销命令。
- `BUG-034`：导入项目文件后没有清空时间线和对象树选择状态，旧项目的 `seg_`、TrackObject 或资源节点仍可能保持选中，后续 Delete/Ctrl+C 会作用于失效选择。
- `BUG-035`：TextObject 句子时间校验只检查当前句与上一句的重叠，不检查当前句终点是否越过下一句起点，导致句级时间范围可以无提示地互相覆盖。
- `BUG-037`：渲染槽校验只看 TrackObject 的 `contentType='audio'`，会接受合成单元 TrackObject；但实际音频解析器只支持 AudioObject，导致 SYN 被放入 SVC/Whisper/MSST 后直到执行阶段才失败。
- `BUG-040`：导入项目文件时只清理项目数据和 Blob，没有停止当前主时间线播放；旧项目已经排程的音频可能继续播放到结束。
- `BUG-041`：加载项目时没有清理 `usePlayback()` 内部已排程的 MIDI Oscillator。导入或切换项目后，旧项目的钢琴 MIDI 可能继续响，并与新项目状态脱节。
- `BUG-042`：服务端 WebSocket job 注册表在任务结束、失败或连接关闭后没有统一清理，旧 job 引用会持续保留在内存中。长时间运行或频繁生成后会造成无界的状态积累，并可能让后续状态判断命中已经失效的 job。
- `BUG-043`：WebSocket 注册超时路径只记录服务端日志，没有向前端发送明确失败状态或结束消息；前端已经进入 running 的生成任务可能一直停留在进行中，用户无法知道任务实际已经失败。
- `BUG-045`：SVC 推理子进程没有绑定 WebSocket 连接生命周期。客户端断开后，服务端的 `send()` 只是忽略发送，后台推理仍会继续占用 CPU/GPU 并写出结果，形成用户不可见的孤儿任务。
- `BUG-046`：SVC 结果接口直接取结果目录中的 `files[0]`，没有按照当前 job 或输出文件清单进行精确匹配。当目录中存在多个 WAV 时，接口返回的文件不保证属于当前任务，可能把其他任务的结果当成本次结果。
- `BUG-047`：普通音轨 F0 提取请求没有检查 HTTP 响应是否成功；接口失败或返回空数据时，仍会把片段标记为 `f0Extracted=true`。该片段之后不会自动重试，最终表现为“提取完成但没有 F0 数据”。
- `BUG-048`：合并片段的 F0 提取路径同样没有检查接口失败，并在 `finally` 中无条件把合并片段标记为已提取。合并后的片段可能永久缺少 F0，且不会再被后台重试。
- `BUG-050`：项目保存只上传尚未出现在 `persistedBlobKeys` 中的 Blob。同一个 Blob key 对应的本地音频被替换后，旧 key 仍被视为已上传，服务器会继续保留旧音频；刷新项目后会恢复错误版本。
- `BUG-053`：旧 SVC WebSocket 启动 Promise 只处理 `onopen`，没有处理 `onerror` 或 `onclose`。8101 连接失败时，`await wsReady` 永远不会结束，SVC 状态会一直停留在运行中。
- `BUG-058`：旧 SVC 流程在 WebSocket 已建立后只监听 `message`，没有运行阶段的 `error/close` 失败处理。推理过程中连接断开时，前端不会收敛为失败状态，任务会一直显示运行中。
- `BUG-059`：SVS 和 MSST 的 WebSocket 建立 Promise 只处理 `onopen/onerror`，没有处理连接建立前的 `onclose`。连接被关闭但未触发 error 时，等待连接的 Promise 永远不会结束，渲染面板会永久保持处理中。
- `BUG-060`：移动时间线对象到 Workspace 时，AudioObject 路径先删除 TrackObject，源对象删除失败后不回滚；SYN 路径在源对象删除失败时还会继续返回成功。异常情况下会造成时间线对象消失、源对象留在原位置或两边状态不一致。
- `BUG-061`：全局 Resource 同步只检查项目对象树中是否存在资产，不检查对应项目 Blob 是否存在。项目保留资产元数据但 Blob 丢失时，同步会直接跳过，不再从全局 Resource 恢复音频。
- `BUG-065`：全局 Resource 发布先逐个写入 staged Blob，后续校验或 catalog 写入失败时没有清理已写入文件。失败重试后会遗留孤儿 staged Blob，并可能继续看到上一次尝试留下的文件。
- `BUG-069`：切换项目或加载新项目时没有清理 RenderPanel 中的旧 `RenderInputRef`。右侧槽位会继续显示旧项目对象；若新项目恰好复用了同一 ID，还可能错误解析为新项目中的另一个对象。
- `BUG-070`：F0 提取使用单个全局 `f0RunningForTrack` 锁。当音轨 A 正在提取时，用户对音轨 B 执行强制重算会直接返回且不会排队；若没有后续触发，B 会一直保持未提取状态。
- `BUG-071`：主时间线播放的音频解码期间，`pause()`/`stop()` 不会取消正在进行的 `isScheduling`。用户在解码阶段停止播放后，旧的异步 `play()` 仍可能继续创建音频源并把播放状态重新设为进行中。
- `BUG-072`：AudioObject 试听的异步 `decodeAudioData()` 没有绑定当前预览请求。用户停止试听或切换对象后，旧对象解码完成仍可能创建并启动旧音频源，导致试听内容与当前选择不一致。
- `BUG-073`：合成单元 Guide 波形加载没有校验异步结果是否仍对应当前 `guideBlob`。快速切换 Guide 时，旧 Guide 的解码结果可能晚到并覆盖新 Guide 的 waveform。
- `BUG-075`：MIDI-P 编辑器播放启动过程没有进行中锁。快速连续按空格或点击播放时，多次调用都可能在 `await ensureMidiAudioContext()` 返回后认为当前未播放，并重复排程完整 MIDI，造成音符重叠或停止状态异常。
- `BUG-076`：Whisper、Text Control、MIDI-P、V5-P 的 WebSocket 建立 Promise 只处理 `onopen/onerror`，没有处理连接建立前的 `onclose`。服务端在连接建立前关闭时，等待 Promise 可能永久不结束，分析或生成状态会一直停留在处理中。
- `BUG-077`：上述四类客户端在 WebSocket 建立失败时没有主动关闭已创建的 socket。`openRenderWebSocket()` 抛错后连接引用丢失，连续失败可能积累半开连接。
- `BUG-078`：删除普通 AudioObject、TextObject 或 TrackObject 后，RenderPanel 中的 `RenderInputRef` 不会自动清理。槽位仍显示已删除对象，后续运行只会在解析阶段失败，用户必须手动清空。
- `BUG-079`：MSST 任务启动时使用的 `model`、`outputMode`、`backfillAll` 没有形成任务快照；任务完成时重新读取当前 UI 设置。用户在运行期间修改选项，可能按错误的输出类型下载或回填结果。
- `BUG-080`：SVC、SVS、MSST 回填结果时重新读取当前输出名，而不是使用任务启动时的输出名。用户在推理期间修改输出名，最终对象名称会与本次任务启动配置不一致。
- `BUG-081`：SVC、SVS、MSST 的 WebSocket `onmessage` 处理包含异步下载和对象树写入，但连接断开或外层任务失败后没有取消这些异步处理。任务状态可能已经失败，迟到的结果仍继续写入对象树。
- `BUG-082`：外部项目导入没有先验证项目 JSON 的基本结构，`project.load()` 会先清空当前 tracks、segments、compGroups、Blob 和对象树，再在后续加载或同步阶段暴露结构错误。导入损坏文件可能破坏当前项目状态。
- `BUG-083`：外部项目导入的 `_sourceBlobsBase64` 只经过 `atob()` 和 `Uint8Array` 转换，没有校验 Base64 内容、MIME 或是否能被声明的音频资产解码。无效音频会先进入项目状态，直到播放或分析阶段才失败。
- `BUG-087`：`/api/f0` 接受任意本地 WAV 路径，并会读取该路径、启动提取进程、在原路径旁写入缓存，没有限制路径必须位于项目临时数据目录。
- `BUG-089`：旧 SVC 服务在 WebSocket 断开后仍直接调用 `ws.send()`。推理期间客户端断开时，进度、日志或完成消息发送可能对关闭的 socket 调用 `send()` 并触发未捕获异常。
- `BUG-090`：MIDI-P 任务输出目录使用可复用目录且不清理旧结果；本次 runner 未覆盖 `midi-p.json` 时，服务仍会读取上一次任务残留的结果。
- `BUG-096`：局部替换 H token 时，如果请求没有携带新的 `placementRanges`，事务只替换 H event，保留原有覆盖该范围的 placement provenance。之后生成材料快照时，旧的 phone/PUL/句级来源仍会被用于终止 SEP 等结构判断，控制数据与实际 H token 不一致。
- `BUG-097`：立体声片段合并时，`combineSegmentsToBlob()` 固定读取 `AudioBuffer` 的第一个声道，输出 WAV 又固定写成单声道，因此右声道内容会在 Guide/音轨合并过程中被直接丢弃。
- `BUG-098`：音频片段合并的采样索引使用 `startActual + t * srcLenActual`，当输出循环到最后一个采样时 `t === 1`，索引落在片段末端的排他位置；末尾源采样不会被复制，片段边界可能出现一个采样的缺口。

## 后续处理

每个 BUG 由用户先确认真实影响和修订策略。确认后再：

1. 在实现文档中补充最终行为合同；
2. 修改语义命令或事务边界；
3. 增加必要的轻量回归测试；
4. 更新本记录的处理状态。

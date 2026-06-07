# AISVC-midi-web Object Workbench Handoff

> Purpose: compact handoff for continuing the object workbench implementation after context loss.
> Next requested task: continue wiring the right-side SVC execution flow.

## Current Status

The user and Codex implemented and tested the object workbench foundation through Phase 6 plus the first bridge from object tree audio objects into the old timeline canvas.

Confirmed by user:

- Existing playback, split, drag, and old timeline interactions still work.
- L1/L2 object tree displays correctly.
- L1/L2 expand independently and share selection highlight.
- L2 locate works.
- GroupObject virtual members display.
- Tree nodes can drag to right render slots.
- Workspace/resource folders support right-click create/rename/delete.
- OS file manager files can be dropped into workspace/resource.
- Imported audio can be deleted.
- Workspace/resource object moves work.
- AudioObject dragged from workspace/resource into timeline creates:
  - old Track/AudioSegment for Canvas
  - trackSources copy
  - tracks/TrackFolder/TrackObject in object tree
  - original workspace/resource AudioObject remains.

Latest automated checks before handoff:

```text
pnpm --filter client test  ✅ 39 passed
pnpm --filter client lint  ✅ passed
pnpm build                 ✅ passed
```

The user said they already committed/pushed the work to GitHub. Do not assume working tree is clean; check `git status` first.

## Key Files Added/Changed

Object model and tree logic:

- `client/src/object-workbench/types.ts`
- `client/src/object-workbench/objectTree.ts`
- `client/src/object-workbench/legacyAdapter.ts`
- `client/src/object-workbench/semanticCommands.ts`
- `client/src/object-workbench/groupResolver.ts`
- `client/src/object-workbench/renderInputs.ts`
- `client/src/object-workbench/treePolicy.ts`
- `client/src/object-workbench/index.ts`

Stores:

- `client/src/stores/objectTree.ts`
- `client/src/stores/objectTreeUi.ts`
- `client/src/stores/renderPanel.ts`
- `client/src/stores/project.ts`
- `client/src/types/index.ts`

UI:

- `client/src/components/layout/LeftSidebar.vue`
- `client/src/components/layout/ObjectTreeRows.vue`
- `client/src/components/layout/RenderPanel.vue`
- `client/src/components/layout/MainCanvas.vue`
- `client/src/pages/ProjectPage.vue`

Backend:

- `server/src/services/svs.service.ts`
- `server/src/index.ts`

Tests:

- `client/src/object-workbench/*.test.ts`
- `client/src/stores/objectTree*.test.ts`
- `client/src/stores/projectObjectTreePersistence.test.ts`
- `client/src/stores/projectSamples.test.ts`

## Current Architecture Notes

The old timeline remains the operational Canvas model:

- `Track`
- `AudioSegment`
- `tracksStore.tracks`
- `tracksStore.segmentsMap`
- `tracksStore.sourceBlobs`

The new object tree is now persisted under `Project.objectTree`.

Loading:

- If `project.objectTree` exists, `project.load()` loads it directly.
- If missing, `legacyProjectToObjectTree(project)` derives object tree from old tracks/segments/compGroups.

Saving:

- `project.toJSON()` includes `objectTree: objectTreeStore.tree`.

Important bridge:

- `objectTreeStore.dropAudioObjectToTimeline(nodeId, timelineStart)`:
  - validates source via `canDragIntoTimeline`
  - supports AudioObject from workspace/resource/renders
  - copies asset/blob to `trackSources`
  - creates old Track/AudioSegment via `tracksStore.addTrack`
  - creates object tree `TrackFolder + TrackObject`
  - original AudioObject remains.

Right render panel:

- `RenderPanel.vue` has SVC/SVS tabs.
- SVC slots:
  - `svc.condAudio`
  - `svc.sourceAudio`
- SVS slots:
  - `svs.timbreAudio`
  - `svs.melody`
  - `svs.text`
- Slots accept only TrackObject/GroupObject via `renderPanelStore.setSlotFromNode`.
- Drag/drop to slots is already implemented and uses validation in `renderInputs.ts`.
- The render buttons currently only enable/disable. They do not execute real synthesis yet.

Group resolving:

- `resolveTrackObjectInput(tree, trackObjectId)`
- `resolveGroupObjectInput(tree, groupObjectId)`
- Return `ResolvedRenderMedia`:
  - `mediaType`
  - `sourceStart`
  - `sourceEnd`
  - `duration`
  - `items`
  - `warnings`
- Group resolution skips ignored TrackObjects and returns warnings.

Existing old SVC pipeline:

- `client/src/composables/useSvcPipeline.ts`
- `startSvc(groupId)` currently accepts old `CompGroupId`.
- It collects old `CompGroup.elements`, combines segments with `combineSegmentsToBlob`, uploads `/api/combine`, registers WS, calls `/api/svc/run`, downloads result, creates old Track/Segment result.
- This should be used as reference, but the new right-panel SVC should operate on `RenderInputRef` slots instead of old `CompGroup`.

Audio combine helper:

- `client/src/api/wav.ts`
- `combineSegmentsToBlob(segments, totalDuration, outputSampleRate, minTimelineStart?)`

Backend SVC:

- `server/src/index.ts`
  - `/api/combine`
  - `/api/svc/run`
  - `/api/svc/result/:jobId.wav`
  - WebSocket `/ws/svc`
- `server/src/services/svc.service.ts`

SVS route skeleton:

- `/api/svs/run`
- supports dryRun and arg construction for `infer_v4_formal.py`.
- Do not prioritize SVS before SVC unless user asks.

## Next Task: Wire Right-Side SVC Execution

Implement in small tested steps.

### Suggested Step 1: New SVC Render Resolver

Create a frontend module/composable that can turn a `RenderInputRef` into temporary WAV input data using the new object tree.

Likely new helper:

```ts
resolveAudioRenderInputToSegmentInputs(input: RenderInputRef): {
  segmentInputs: Array<{
    blob: Blob
    startSample: number
    endSample: number
    timelineStart: number
    sampleRate: number
    volume?: number
  }>
  sourceStart: number
  sourceEnd: number
  duration: number
  sampleRate: number
  warnings: string[]
}
```

Important:

- TrackObject source is an AudioObject under trackSources.
- Its asset blobKey should be available in `tracksStore.sourceBlobs`.
- For imported AudioObjects, metadata may be stored in asset.
- If metadata is incomplete, use blob decode in browser, similar to existing `dropAudioObjectToTimeline`.
- For GroupObject, use `resolveGroupObjectInput` to get items ordered by current TrackObject times.
- Preserve relative gaps using `timelineStart - sourceStart`.

### Suggested Step 2: Reuse Combine

For each SVC slot:

- `condAudio`
- `sourceAudio`

Call `combineSegmentsToBlob`.

Then upload one or both temp WAVs. Existing old SVC endpoint expects:

- `combinedWav`: source/input wav path
- `targetWav`: target/cond wav path from svcConfig old config

But the new design has:

- `被变声音频`
- `cond音频`

Need to decide mapping to current backend. Recommended:

- `sourceAudio` -> `/api/combine` output path passed as `combinedWav`
- `condAudio` -> upload via `/api/combine` too and pass returned path as `targetWav`

Existing `/api/combine` accepts `{ groupId, wavBase64, sampleRate }` and writes to `data/<groupId>/combined.wav`.

Use distinct group ids/job ids, e.g.:

```text
render_<jobId>_source
render_<jobId>_cond
```

### Suggested Step 3: Start `/api/svc/run`

Follow old `useSvcPipeline.ts`:

- open WebSocket `ws://hostname:8101/ws/svc`
- register `jobId`
- call `/api/svc/run`
- handle progress/done/error

Expose status in `renderPanelStore`, not old `compGroups`.

Minimal state to add:

```ts
svcStatus: 'idle' | 'running' | 'done' | 'failed'
svcProgress: number
svcMessage: string
currentJobId: string | null
```

### Suggested Step 4: Result Backfill

On done:

- Download `/api/svc/result/${jobId}.wav`.
- Create archive object under `project:/renders/svc`.
- Also copy to `trackSources`.
- Create old Track/AudioSegment so Canvas shows the result.
- Create object tree TrackFolder/TrackObject under `project:/tracks`.
- Align new result to `sourceAudio.sourceStart` per design.

There is already a similar path in `useSvcPipeline.finishSvc`.

Recommended implementation path:

- Add a reusable helper in objectTree store, maybe:

```ts
addRenderedAudioToTimeline({
  blob,
  outputFileName,
  renderFolder: 'svc',
  timelineStart,
  sampleRate?,
})
```

This should mirror `dropAudioObjectToTimeline`, but also create `renders/svc/<outputName>` archive object first.

### Suggested Step 5: Tests

Add unit tests for pure resolver/backfill logic where possible.

Run after each step:

```text
pnpm --filter client test
pnpm --filter client lint
pnpm build
```

For network/model execution:

- Use backend dry/smoke routes where possible.
- Do not require real GPU model for unit tests.

## Important Caveats

- Do not delete or revert user files.
- `docs/object-workbench-design.md` was initially untracked but user says they already committed/pushed work. Still check `git status`.
- `projects/test-1/` appeared as untracked during previous work; likely user-created. Do not remove unless user asks.
- Existing Vite warning about `client/src/api/wav.ts` being both statically and dynamically imported is known and unrelated.
- `project.load()` logs `[load] tracks...`; tests show stdout but pass.
- Current object tree file import stores source blobs in `tracksStore.sourceBlobs` using `file.name`; duplicate filenames may collide. This is acceptable for now but should be improved later.
- Current `dropAudioObjectToTimeline` creates a `sourceFile` like `node:trackSource:audio:<uuid>:<name>` for timeline source blob key.
- Current object tree is not yet fully authoritative for old Canvas; old Tracks/Segments still drive playback.

## User Preferences

- User wants "do one phase, test one phase."
- User prefers Codex to run automatic tests and only ask for manual testing where UI/audio feel matters.
- User expects Codex to continue implementation proactively, but save/commit checkpoints matter for large risky stages.
- User is okay with handoff docs and may open a fresh chat if needed.

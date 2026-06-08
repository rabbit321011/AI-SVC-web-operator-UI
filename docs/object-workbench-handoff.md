# AISVC-midi-web Object Workbench Handoff

> Purpose: compact handoff for continuing after context loss.
> Current date at handoff: 2026-06-08.
> Recommended first instruction in new chat: "请先读 AISVC-midi-web/docs/object-workbench-handoff.md 和 docs/object-workbench-design.md，然后继续 SVS 手动 UI 验证/结果回填检查。"

## Latest Continuation — 2026-06-08

SVS has moved past the dryRun draft.

Implemented in the current uncommitted work:

- Right panel SVS now has both `dryRun` and real `合成` buttons.
- `useRenderSvsPipeline.ts` prepares timbre audio, audio melody, target text, and output path.
- Real SVS execution registers the existing render WebSocket, calls `POST /api/svs/run` with `dryRun: false`, downloads `/api/svs/result/:jobId.wav`, then backfills via:

```ts
objectTreeStore.addRenderedAudioToTimeline({
  blob,
  outputFileName,
  renderKind: 'svs',
  timelineStart,
})
```

- SVS output is intended to align to the melody audio earliest timeline start.
- Real SVS currently supports audio TrackObject/GroupObject melody only. MIDI melody remains a future bridge and shows a clear error for real execution.
- Backend SVS now:
  - accepts `jobId`
  - sends logs/done/error over WebSocket
  - creates the output directory
  - exposes `GET /api/svs/result/:jobId.wav`
  - includes final stderr/stdout tail in failure messages
  - sets the local environment needed by YingMusic-Singer-Plus:

```text
PHONEMIZER_ESPEAK_LIBRARY=C:\Program Files\eSpeak NG\libespeak-ng.dll
PATH prefix=C:\ffmpeg-shared\ffmpeg-8.1.1-full_build-shared\bin
HF_HUB_OFFLINE=1
TRANSFORMERS_OFFLINE=1
HF_DATASETS_OFFLINE=1
HF_HUB_DISABLE_TELEMETRY=1
```

Confirmed automatic/smoke verification in this continuation:

```text
pnpm --filter client test   ✅ 53 passed
pnpm --filter client lint   ✅ passed
pnpm --filter server build  ✅ passed
pnpm build                  ✅ passed; same known wav.ts chunk warning
GET /api/health             ✅ passed
GET /api/svs/result/:jobId.wav after smoke ✅ 200 audio/wav
```

Real SVS smoke test also passed:

```text
refAudio    E:/AIscene/AISVC-midi-web/data/cgrp_31506a33/combined.wav  (~1.78s)
melodyAudio E:/AIscene/AISVC-midi-web/data/cgrp_8abb0842/combined.wav  (~3.25s)
targetText  あ
steps       1
cfg         1
device      cuda:0
output      E:/AIscene/AISVC-midi-web/data/render_codex_svs_mq4msgrt_svs_timbre/svs_smoke.wav
result      ✅ [done], duration ~3.25s, sampleRate 44100
```

Failures encountered and fixed:

- `RuntimeError: espeak not installed on your system`
  - Fixed by adding `PHONEMIZER_ESPEAK_LIBRARY`, matching `E:\AIscene\推理命令.txt`.
- `torchcodec` could not load `libtorchcodec_core4.dll`
  - Fixed by prefixing `PATH` with the ffmpeg shared bin folder from `E:\AIscene\推理命令.txt`.

Next useful checkpoint:

- Ask the user to run SVS from the actual UI:
  - put audio TrackObject/GroupObject into `音色音频`
  - put audio TrackObject/GroupObject into `旋律音频`
  - enter target kana text
  - click `dryRun`
  - click `合成`
  - confirm result appears under `renders/svs`, `trackSources/audio`, and the timeline
  - play/listen once

## Current Checkpoint

The object workbench foundation and right-side SVC flow are implemented and manually verified by the user.

Latest confirmed checkpoint was committed by the user before this handoff. After that commit, a small SVS dryRun draft has already started and is currently uncommitted.

Always run:

```text
git status --short
```

before making changes.

## Verified Working Features

User manually verified:

- Right-side SVC real execution flow succeeds.
- SVC accepts TrackObject/GroupObject as source audio.
- SVC cond audio accepts ordinary AudioObject without requiring timeline placement.
- SVC output is backfilled into:
  - old timeline Track/AudioSegment
  - `project:/renders/svc`
  - `project:/trackSources/audio`
  - `project:/tracks` TrackFolder/TrackObject
- SVC output aligns to source audio earliest timeline start.
- Right-side slot "放入", drag/drop, clear, invalid-state hints, and model dropdown work.
- `Alt+N` works:
  - left tree TrackObject -> locate timeline segment
  - timeline segment -> locate corresponding TrackObject in L2
- `Alt+L` locates source AudioObject from TrackObject/AudioObject.
- `Alt+M` / `Alt+K` locate bound MIDI/Text or show expected missing-binding notice.
- Left AudioObject preview play/stop/switch works.
- Long Windows filename blob save bug is fixed.

Latest automated verification before user commit:

```text
pnpm --filter client test  ✅ 48 passed
pnpm --filter client lint  ✅ passed
pnpm build                 ✅ passed
```

Known build warning:

```text
client/src/api/wav.ts is dynamically imported by TopBar.vue but also statically imported elsewhere
```

This warning is known and unrelated.

## Important Current Git State

At the time this handoff was written, `git status --short` showed uncommitted SVS draft files:

```text
 M client/src/components/layout/RenderPanel.vue
 M client/src/object-workbench/index.ts
 M client/src/stores/renderPanel.ts
?? client/src/composables/useRenderSvsPipeline.ts
?? client/src/object-workbench/renderTextResolver.test.ts
?? client/src/object-workbench/renderTextResolver.ts
```

These are not verified as complete. Treat them as in-progress SVS dryRun work, not as stable checkpoint.

Do not delete them unless the user explicitly asks. Continue from them if possible.

## Files Implemented In The SVC/Object Workbench Checkpoint

Key frontend additions/changes:

- `client/src/object-workbench/renderAudioResolver.ts`
- `client/src/object-workbench/renderAudioResolver.test.ts`
- `client/src/object-workbench/renderInputs.ts`
- `client/src/stores/renderPanel.ts`
- `client/src/stores/objectTree.ts`
- `client/src/composables/useRenderSvcPipeline.ts`
- `client/src/composables/useObjectAudioPreview.ts`
- `client/src/composables/useKeyboard.ts`
- `client/src/components/layout/RenderPanel.vue`
- `client/src/components/layout/LeftSidebar.vue`
- `client/src/components/layout/ObjectTreeRows.vue`
- `client/src/components/layout/MainCanvas.vue`

Backend additions/changes:

- `server/src/index.ts`
  - Project blob persistence now uses short sha256 filenames plus `manifest.json`.
  - Backward-compatible loader still reads old URL-encoded `.blob` names.
- `server/src/services/svc.service.ts`
  - SVC subprocess defaults to HuggingFace/Transformers offline env vars.
  - SVC failure message includes final stderr/stdout lines.

Docs:

- `docs/verification.md` contains "Object Workbench Checkpoint — 2026-06-07".

## Architecture Notes

The old timeline is still the operational canvas model:

- `Track`
- `AudioSegment`
- `tracksStore.tracks`
- `tracksStore.segmentsMap`
- `tracksStore.sourceBlobs`

The new object tree is persisted under `Project.objectTree`.

Important store helpers:

- `objectTreeStore.dropAudioObjectToTimeline(nodeId, timelineStart)`
  - copies a normal AudioObject from workspace/resource/renders into trackSources
  - creates old Track/AudioSegment
  - creates object tree TrackFolder/TrackObject
- `objectTreeStore.addRenderedAudioToTimeline({ blob, outputFileName, renderKind, timelineStart })`
  - archives model result in `renders/<renderKind>`
  - copies result into `trackSources/audio`
  - creates old Track/AudioSegment
  - creates object tree TrackFolder/TrackObject

Right render panel:

- SVC:
  - `svc.condAudio`
    - accepts audio TrackObject, audio GroupObject, and ordinary AudioObject
  - `svc.sourceAudio`
    - accepts audio TrackObject or audio GroupObject only
  - actual execution is in `useRenderSvcPipeline.ts`
- SVS:
  - `svs.timbreAudio`
  - `svs.melody`
  - `svs.textRef` / `svs.manualText`
  - dryRun draft has started but is not verified.

Audio resolver:

- `resolveAudioRenderInputToSegmentInputs(...)`
  - TrackObject/GroupObject -> WAV segment inputs preserving relative gaps
  - AudioObject -> whole-object input starting at 0
  - During transition, legacy `segmentId` data is used to match current old canvas timing/sample ranges.

Text resolver draft:

- `renderTextResolver.ts`
  - `normalizeSvsText(text)`
  - `resolveTextRenderInput(tree, input)`
  - unit tests exist in `renderTextResolver.test.ts`
  - status: draft, needs verification.

## Current SVS Draft Details

Uncommitted draft files indicate this planned dryRun path:

- `useRenderSvsPipeline.ts`
  - combines and uploads timbre audio
  - if melody is audio, combines and uploads melody audio
  - resolves target text from manual input or TextObject/GroupObject ref
  - calls `/api/svs/run` with `dryRun: true`
  - updates `renderPanel.svsStatus/svsProgress/svsMessage`
- `RenderPanel.vue`
  - imports `useRenderSvsPipeline`
  - SVS button currently says `dryRun`
  - SVS slots get clear/invalid-state UI similar to SVC
- `renderPanel.ts`
  - has draft SVS status fields and setters
- `object-workbench/index.ts`
  - exports `renderTextResolver`

Before continuing, inspect these files and run:

```text
pnpm --filter client test
pnpm --filter client lint
pnpm build
```

If tests fail, fix the draft first.

## Backend SVS Skeleton

Relevant files:

- `server/src/services/svs.service.ts`
- `server/src/index.ts`

Existing route:

```text
POST /api/svs/run
```

Expected body fields:

- `refAudio`
- `melodyAudio`
- `targetText`
- `output`
- `checkpoint`
- `steps`
- `cfg`
- `seed`
- `device`
- `dryRun`

`dryRun: true` returns constructed args without running the model.

## Recommended Next Work

Continue in small tested phases.

### Step 1: Stabilize SVS dryRun draft

- Read current uncommitted SVS files.
- Run client tests/lint/build.
- Fix any type/test failures.
- Verify `/api/svs/run` dryRun returns OK.
- Add or update tests for:
  - `normalizeSvsText`
  - `resolveTextRenderInput`
  - SVS slot validation if needed

### Step 2: Manual dryRun verification

Ask the user to verify:

- Put audio TrackObject/GroupObject into `音色音频`.
- Put audio TrackObject/GroupObject into `旋律音频`.
- Use manual text.
- Click SVS `dryRun`.
- Confirm right panel reaches "SVS dryRun OK".
- Repeat with TextObject/GroupObject ref if sample data exists.

### Step 3: Real SVS execution

After dryRun is stable:

- Call `/api/svs/run` with `dryRun: false`.
- Decide how to receive final output:
  - current skeleton may need an endpoint to download/read output WAV, or frontend can fetch via a new route.
- On done:
  - create `renders/svs`
  - copy to `trackSources/audio`
  - create timeline Track/AudioSegment
  - align output to melody earliest start.

Reusing:

```ts
objectTreeStore.addRenderedAudioToTimeline({
  blob,
  outputFileName,
  renderKind: 'svs',
  timelineStart,
})
```

is recommended.

## Important Caveats

- Do not revert user changes.
- `projects/` contains useful local smoke-test samples, but runtime changes to project JSON files are not automatically meant for commits.
- User said `projects` content can be used as test data, but avoid deleting it.
- If `projects/*.json` shows huge diffs, treat as local verification data unless user asks otherwise.
- Existing old timeline remains source of truth for canvas playback.
- Object tree is gradually becoming authoritative, but do not remove old timeline bridge yet.
- The user prefers "one phase, one test".
- User expects automatic tests before asking for manual verification.

## Suggested First Response In New Chat

Say briefly:

```text
我会先读 handoff/design 和当前 SVS 草稿，跑测试确认起点，然后继续 SVS dryRun 链路。
```

Then run:

```text
git status --short
pnpm --filter client test
pnpm --filter client lint
```

and proceed from actual results.

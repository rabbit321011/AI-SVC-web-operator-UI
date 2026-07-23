# AISVC-midi-web v0.4 Report

> Version: ver0.4  
> Status: implemented with manual Whisper runtime check pending  
> Date: 2026-06-09  
> Design: `docs/updates/ver0.4/design.md`

---

## 1. Summary

ver0.4 implemented the TextObject / Text TrackObject editing foundation from the larger Whisper + text workflow design, then connected the first real Whisper backend path.

TextObject outputs can now become visible and editable in the workbench: Whisper-style text creates a visible text track, TextObject segments support stable ids and end times, TextObject opens as an object-bound editor tab, segment timing can be adjusted on the timeline with `Ctrl + drag`, and SVS manual text has kana/romaji synchronized input fields.

The Whisper panel now calls a real backend runner using faster-whisper large-v3 through the existing Python venv. The model is not copied into the project; the runner uses the HuggingFace cache or `AISVC_WHISPER_MODEL` when provided. Runtime dependency import was checked, but a full GPU transcription run has not been manually performed in this report.

---

## 2. Implemented Changes

- Extended `TextSegment` to support optional `id` and `end` fields while remaining compatible with older `{ start, kana, romaji }` data.
- Updated `ver0.4/design.md` with:
  - sentence/phrase as the atomic editable text unit
  - `TextSegment { id, start, end, kana, romaji }`
  - timeline segment boundary editing
  - `Ctrl + drag` rules and constraints
  - distinction between segment boundary editing and TrackObject splitting
- Added non-audio timeline track support through `Track.trackType` and `tracks.addObjectTrack()`.
- Updated `addRenderedTextToTimeline()` so Whisper-style text output:
  - normalizes segments with stable ids and inferred end times
  - archives a TextObject under `renders/whisper`
  - copies a TextObject to `trackSources/text`
  - creates a text TrackObject
  - creates a visible text track in the current timeline track list
- Added object-tree TextSegment update helpers:
  - `updateTextSegmentTiming()`
  - `updateTextSegmentContent()`
- Added `TextObjectEditor.vue` as the first object-bound text editor tab.
- Extended `EditorWorkspace` with singleton TextObject editor tabs.
- Added TextObject editor entry points:
  - double-click TextObject in the object tree
  - object tree context menu: `打开文本编辑器`
  - double-click a text TrackObject on the timeline
- Added text track rendering in `TrackCanvas.vue`:
  - text TrackObject bar
  - internal segment bars
  - romaji and kana rows
  - selected TrackObject outline
- Added timeline text segment boundary editing:
  - `Ctrl + drag` a segment boundary
  - clamps to minimum duration
  - prevents crossing adjacent segment boundaries
  - adjusts adjacent boundary when dragging a shared segment edge
- Added undo/redo coverage for text boundary drags through an objectTree snapshot history command.
- Added a lightweight frontend kana/romaji sync helper.
- TextObject editor now syncs kana edits to romaji and romaji edits to kana.
- SVS manual text input now has separate Kana and Romaji fields backed by the same sync helper.
- Added `server/scripts/whisper_runner.py` using faster-whisper large-v3, SudachiPy, and jaconv.
- Added `server/src/services/whisper.service.ts` to spawn the Whisper runner and stream JSON progress over WebSocket.
- Added `/api/whisper/run` and wired it into the existing job WebSocket registration path.
- Added `useRenderWhisperPipeline()` so the Whisper panel resolves audio input, uploads a temporary WAV, starts the backend, and writes returned TextObject segments into the object tree/timeline.
- Fixed first manual UI feedback batch:
  - forced Whisper Python stdout/stderr to UTF-8 to avoid Japanese mojibake
  - forced Node-spawned Whisper runner to use UTF-8 Python IO
  - added spaced romaji fallback for timeline display
  - increased timeline text font sizes
  - changed timeline text colors to follow theme `--app-text` / `--app-muted`
  - added Alt+N timeline locating for object-only text TrackObjects without legacy segment ids

---

## 3. Changed Files

- `client/src/components/layout/EditorWorkspace.vue`
- `client/src/components/layout/LeftSidebar.vue`
- `client/src/components/layout/ObjectTreeRows.vue`
- `client/src/components/text/TextObjectEditor.vue`
- `client/src/components/track/TrackCanvas.vue`
- `client/src/composables/useRenderWhisperPipeline.ts`
- `client/src/composables/useKeyboard.ts`
- `client/src/object-workbench/types.ts`
- `client/src/stores/editorWorkspace.ts`
- `client/src/stores/editorWorkspace.test.ts`
- `client/src/stores/objectTree.ts`
- `client/src/stores/objectTreeTimelineDrop.test.ts`
- `client/src/stores/renderPanel.ts`
- `client/src/stores/renderPanel.test.ts`
- `client/src/stores/tracks.ts`
- `client/src/types/index.ts`
- `client/src/utils/kanaRomaji.ts`
- `client/src/utils/kanaRomaji.test.ts`
- `server/scripts/whisper_runner.py`
- `server/src/services/whisper.service.ts`
- `server/src/index.ts`
- `docs/updates/ver0.4/design.md`
- `docs/updates/ver0.4/report.md`

---

## 4. Verification

Commands run:

```text
pnpm --filter client test
pnpm --filter client lint
pnpm --filter server build
E:/AIscene/AISVCs/.venv/Scripts/python.exe -c "import faster_whisper, sudachipy, jaconv; print('whisper deps ok')"
```

Results:

- Full client test suite passed: 22 test files, 87 tests.
- Client type check passed: `vue-tsc -b --noEmit`.
- Server TypeScript build passed.
- Python dependency import check passed for `faster_whisper`, `sudachipy`, and `jaconv`.
- Focused post-feedback verification passed: `kanaRomaji`, `renderPanel`, `editorWorkspace`, and `objectTreeTimelineDrop` tests.

---

## 5. Deviations From Design

The full `ver0.4/design.md` scope is larger than this implementation report.

Implemented from the design:

- TextSegment model direction with `id/start/end/kana/romaji`.
- TextObject object-bound editor tab foundation.
- Text TrackObject timeline display foundation.
- Timeline `Ctrl + drag` segment boundary editing foundation.
- Kana/romaji synchronized editing foundation.
- SVS manual text dual-field sync.
- Text output archive/backfill path creates visible text tracks.
- Whisper backend route, service, Python runner, and frontend pipeline.

Not implemented yet:

- Timeline inline text editor overlay.
- Text TrackObject split/merge semantics.
- Dedicated semantic command for text segment timing edits; current undo/redo uses objectTree snapshots.
- Manual browser/GPU verification of a real Whisper transcription.

---

## 6. Known Risks

- Text segment boundary editing currently uses objectTree snapshot undo/redo rather than a dedicated semantic text timing command.
- Text track rendering is canvas-based and has not been manually reviewed in browser.
- `TextSegment.id/end` are optional at the type level for backward compatibility; code paths that need stable segment identity should normalize old data first.
- Non-audio timeline tracks are now represented in the legacy `tracks.trackOrder` list using `trackType: 'text'`, but persistence/load behavior for object-only text tracks should be manually checked with saved projects.
- Frontend kana/romaji sync is intentionally lightweight and does not replace backend SudachiPy/jaconv reading conversion for Whisper output.
- Whisper runtime has been wired and dependency imports were checked, but large-v3 GPU transcription has not been manually run from the UI in this report.
- Japanese text encoding should now be UTF-8 through the Whisper runner path, but existing already-generated mojibake TextObjects may need regeneration.

---

## 7. Suggested Manual Check

- Run Whisper from the right panel against an audio TrackObject or AudioObject and confirm a text track appears in the timeline.
- Confirm text TrackObject bars show kana and romaji rows.
- Hold `Ctrl` and drag text segment boundaries on the timeline; verify neighboring segment constraints feel correct.
- Undo/redo after a text boundary drag.
- Double-click a TextObject in L1/L2 and confirm the TextObject editor opens as a closeable tab.
- Edit segment start/end/kana/romaji in the TextObject editor and confirm the timeline redraws.
- Type into SVS Kana and Romaji fields and confirm the paired field syncs.

---

## 8. Suggested Next Checkpoint

Suggested next work:

- Manually run a real Whisper transcription in browser and adjust backend progress/error handling based on observed output.
- Add a dedicated semantic command for text segment timing edits.
- Add timeline inline text editing overlay.
- Decide whether TextObject editor should preserve user-authored romaji exactly or always auto-sync while editing.

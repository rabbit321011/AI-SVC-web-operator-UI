# AISVC-midi-web v0.31 Report

> Version: ver0.31  
> Status: implemented minimal shell  
> Date: 2026-06-09  
> Design: `docs/updates/ver0.31/design.md`

---

## 1. Summary

ver0.31 implemented the right-side panel product boundary from the design checkpoint.

The right panel now exposes built-in modes for SVC, SVS, Whisper, MSST, and Chat without introducing a plugin framework or schema-driven tool system. SVC/SVS keep their existing pipelines. Whisper, MSST, and Chat have minimal UI/state shells and are explicitly marked as not backend-connected yet.

The shared asset-output convention was added at the object-tree layer: MSST can use the existing rendered audio archive/backfill flow, and Whisper has a new text archive/backfill helper that writes `TextObject` into `renders/whisper`, copies it to `trackSources/text`, and creates a text TrackObject.

---

## 2. Implemented Changes

- Extended right panel modes to:
  - `svc`
  - `svs`
  - `whisper`
  - `msst`
  - `chat`
- Added one local processing lock shared by SVC, SVS, Whisper, and MSST.
- Kept Chat outside the local processing lock.
- Added Whisper state:
  - audio input slot
  - output name
  - language draft
  - running/done/failed/progress message state
- Added MSST state:
  - audio input slot
  - output name
  - output mode draft
  - timeline backfill checkbox draft
  - running/done/failed/progress message state
- Added UI shells for Whisper, MSST, and Chat in `RenderPanel.vue`.
- Added explicit placeholder execution for Whisper/MSST that reports backend not connected.
- Extended render slot validation for:
  - `whisper.audio`
  - `msst.audio`
- Allowed ordinary `AudioObject` as compatible audio input for Whisper/MSST slots.
- Extended rendered audio backfill kind to include `msst`.
- Added `addRenderedTextToTimeline` for Whisper-style text outputs.
- Updated SVC/SVS pipelines to respect the shared local processing lock.

---

## 3. Changed Files

- `client/src/components/layout/RenderPanel.vue`
- `client/src/composables/useRenderSvcPipeline.ts`
- `client/src/composables/useRenderSvsPipeline.ts`
- `client/src/object-workbench/renderInputs.ts`
- `client/src/object-workbench/renderInputs.test.ts`
- `client/src/stores/objectTree.ts`
- `client/src/stores/objectTreeTimelineDrop.test.ts`
- `client/src/stores/renderPanel.ts`
- `client/src/stores/renderPanel.test.ts`
- `docs/updates/ver0.31/report.md`

---

## 4. Verification

Commands run:

```text
pnpm --filter client test renderInputs renderPanel objectTreeTimelineDrop
pnpm --filter client lint
pnpm --filter client test
```

Results:

- Focused tests passed: 12 tests.
- Type check passed: `vue-tsc -b --noEmit`.
- Full client test suite passed: 20 test files, 77 tests.

---

## 5. Deviations From Design

No blocking deviation from `docs/updates/ver0.31/design.md` was introduced.

Intentional limits:

- Whisper backend execution is not implemented.
- MSST backend execution is not implemented.
- Chat backend execution is not implemented.
- No plugin framework or dynamic tool registry was added.
- No broad rename from `RenderPanel` to `ToolPanel` was done.

---

## 6. Known Risks

- The new right-panel UI modes have not been manually reviewed in browser.
- Text TrackObject timeline rendering is still a future editor/timeline concern; the object-tree backfill path exists, but visual timeline support may still be partial.
- MSST multi-stem orchestration is not implemented yet; current support is the object-tree audio result path and UI/state shell.
- Chat is only a UI placeholder.

---

## 7. Suggested Manual Check

- Open the project UI and confirm the right panel tabs fit in the 230px panel.
- Switch across SVC, SVS, Whisper, MSST, and Chat.
- Drag or select an audio object into Whisper/MSST slots and confirm validation feedback feels right.
- Confirm SVC/SVS still feel unchanged for the existing workflow.

---

## 8. Suggested Next Checkpoint

The next implementation checkpoint should pick one concrete backend-connected tool rather than adding more panel architecture.

Recommended options:

- Implement Whisper end to end and render timestamped TextObject into `renders/whisper` plus text TrackObject.
- Implement MSST end to end with selected stem outputs under `renders/msst/<taskName>/`.


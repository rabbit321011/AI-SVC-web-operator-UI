# AISVC-midi-web v0.3 Report

> Version: ver0.3  
> Status: implemented minimal shell  
> Date: 2026-06-08  
> Design: `docs/updates/ver0.3/design.md`

---

## 1. Summary

ver0.3 implemented the minimum Rich Media Editor Workspace shell.

The existing timeline is now mounted through an `EditorWorkspace` container as the default `Timeline` editor for `project/root`. The checkpoint intentionally does not implement MIDI, Text, Pitch, or analysis editors yet. It creates the state and UI seam those future object-bound editors can attach to.

Existing timeline behavior remains owned by `MainCanvas.vue` and was not rewritten in this checkpoint.

---

## 2. Implemented Changes

- Added `useEditorWorkspaceStore` with a default project-root timeline tab.
- Added minimal editor tab model:
  - `EditorTabKind = 'timeline' | 'object'`
  - default timeline editor id: `editor:project-root`
  - default context object id: `project/root`
- Added `EditorWorkspace.vue` as the center workspace host.
- Replaced direct `MainCanvas` rendering in `ProjectPage.vue` with `EditorWorkspace`.
- Kept `MainCanvas.vue` as the actual timeline editor implementation.
- Added tests for:
  - default project-root timeline editor state
  - rejecting activation of unknown tabs
  - active editor context staying separate from object-tree selection

---

## 3. Changed Files

- `client/src/stores/editorWorkspace.ts`
- `client/src/stores/editorWorkspace.test.ts`
- `client/src/components/layout/EditorWorkspace.vue`
- `client/src/pages/ProjectPage.vue`
- `docs/updates/ver0.3/report.md`

---

## 4. Verification

Commands run:

```text
pnpm --filter client test editorWorkspace
pnpm --filter client lint
```

Results:

- `editorWorkspace` focused tests passed: 3 tests.
- `vue-tsc -b --noEmit` passed.

Full client test suite was not run for this checkpoint report.

---

## 5. Deviations From Design

No blocking deviation from `docs/updates/ver0.3/design.md` was introduced.

Implemented design points:

- Timeline is treated as an editor tab mounted at `project/root`.
- Left object-tree selection is separate from active editor context.
- Future object-bound editor tabs have a first type-level extension point.
- Existing timeline implementation is preserved rather than replaced.

Intentional non-implemented parts of the broader design:

- The first UI shell exposes only one visible tab: `Timeline`.
- No close/reorder/open-object interactions were added yet.
- No object-bound editor is rendered yet.
- No MIDI, Text, Pitch, or analysis editor behavior was implemented.
- No Tool Panel generalization was implemented.

---

## 6. Known Risks

- The visible `Timeline` tab is a new shell element and has not been manually reviewed in-browser in this report.
- `EditorWorkspace` state is not persisted; this is acceptable while only the default timeline tab exists, but it will matter once user-opened tabs are added.
- The object-bound tab model is type-level only. Future implementation may require additional lifecycle fields.
- Full client test suite was not run, so verification is limited to focused tests and type checking.

---

## 7. Open Questions

- Add explicit commands for opening supported objects as editor tabs.
- Define object-bound editor lifecycle: open, activate, close, restore after load.
- Decide which object kinds get full editor tabs first: likely `TextObject` or `MidiObject`.
- Persist editor workspace state only after tab behavior becomes user-visible enough to restore.
- Keep separating left selection, timeline selection, and active editor context as future editors arrive.

---

## 8. Suggested Next Checkpoint

The next checkpoint can now move in one of two directions:

- `ver0.4` Tool Panel generalization: extract SVC/SVS into a minimal tool protocol.
- `ver0.4` First object-bound editor: implement an explicit-open lightweight `TextObject` editor tab.

Given the current product architecture, Tool Panel generalization remains the cleaner next structural checkpoint unless the immediate product need is lyric editing.

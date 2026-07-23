# AISVC-midi-web v0.32 Report

> Version: ver0.32  
> Status: implemented  
> Date: 2026-06-09  
> Design: `docs/updates/ver0.32/design.md`

---

## 1. Summary

ver0.32 implemented the UI and settings update without touching GPU-heavy backend tools.

The center `EditorWorkspace` now hosts root-level utility pages: Settings and Keymap Help. Both are singleton closeable tabs. Timeline remains the default non-closeable tab.

The topbar now opens Settings and Keymap Help via SVG icon buttons and no longer exposes the old synthesis button/parameter strip. UI settings are persisted locally and applied through theme classes and CSS variables.

---

## 2. Implemented Changes

- Added local UI settings store with `localStorage` persistence for lightweight preferences.
- Added themes:
  - Night
  - Light
  - 奶黄
- Added persisted settings for:
  - auto-save interval
  - SVC default model / step / cfg
  - SVS default model / step
  - center opacity
  - side opacity
  - topbar opacity
  - background image enabled/url
  - sidebar glass effect
  - center glass effect
  - L1/L2 collapsed state
- Added Settings editor tab.
- Added Keymap Help editor tab with a keyboard-style shortcut view.
- Added topbar SVG icon buttons for Settings and Keymap Help.
- Removed visible topbar synthesis entry.
- Replaced visible emoji/text-symbol UI icons in project UI with SVG icons.
- Added independent L1/L2 collapse controls.
- Added timeline wheel shortcuts:
  - `Alt + Mouse Wheel`: faster horizontal movement
  - `Ctrl + Mouse Wheel`: vertical track browsing
- Added track header controls for moving tracks up/down.
- Added track color editing through Naive UI `NColorPicker` in the track context menu.
- Added object-tree synchronization for TrackFolder color and TrackFolder order.
- Added track color propagation to existing segments on the same track.
- Added project-scoped backend storage for background images:
  - upload: `POST /api/projects/:name/ui/background`
  - serve: `GET /api/projects/:name/ui/background.<ext>`
- Changed background image import so the image file is saved under the backend project directory and only the returned URL is persisted in local settings.

---

## 3. Changed Files

- `client/src/components/layout/EditorWorkspace.vue`
- `client/src/components/layout/LeftSidebar.vue`
- `client/src/components/layout/MainCanvas.vue`
- `client/src/components/layout/ObjectTreeRows.vue`
- `client/src/components/layout/TopBar.vue`
- `client/src/components/settings/KeymapHelpPage.vue`
- `client/src/components/settings/SettingsPage.vue`
- `client/src/components/track/TrackHeader.vue`
- `client/src/pages/HomePage.vue`
- `client/src/pages/ProjectPage.vue`
- `client/src/stores/editorWorkspace.ts`
- `client/src/stores/editorWorkspace.test.ts`
- `client/src/stores/objectTree.ts`
- `client/src/stores/objectTreeSyncTimeline.test.ts`
- `client/src/stores/tracks.ts`
- `client/src/stores/uiSettings.ts`
- `client/src/stores/uiSettings.test.ts`
- `server/src/index.ts`
- `docs/updates/ver0.32/design.md`
- `docs/updates/ver0.32/report.md`

---

## 4. Verification

Commands run:

```text
pnpm --filter client test editorWorkspace uiSettings objectTreeSyncTimeline
pnpm --filter client lint
pnpm --filter client test
pnpm --filter server build
```

Results:

- Focused tests passed: 21 tests.
- Type check passed: `vue-tsc -b --noEmit`.
- Full client test suite passed: 21 test files, 82 tests.
- Server TypeScript build passed.

---

## 5. Deviations From Design

No blocking deviation from `docs/updates/ver0.32/design.md` was introduced.

Notes:

- Auto-save interval is persisted as a setting, but this checkpoint does not wire a new autosave scheduler.
- Default SVC/SVS parameters are persisted as settings, but existing inference stores are not yet automatically initialized from them.
- Background image files are stored on the backend under the current project instead of in localStorage.

---

## 6. Known Risks

- The Settings and Keymap pages have not been manually reviewed in browser.
- CSS `color-mix` and `backdrop-filter` support depends on the browser engine.
- Track color picking uses current UI state and object-tree sync; broader save/load behavior is covered by existing objectTree persistence paths but should still be manually checked after UI review.

---

## 7. Suggested Manual Check

- Open Settings from the topbar and confirm it appears as a closeable editor tab.
- Open Keymap Help from the topbar and confirm the keyboard-style page looks good.
- Switch themes, opacity, background image, and glass settings.
- Import a large-ish background image and confirm it uploads instead of reporting local storage size errors.
- Collapse and expand L1/L2 independently.
- Try `Alt + Mouse Wheel` and `Ctrl + Mouse Wheel` in the timeline.
- Move tracks up/down from the track header.
- Right-click a track header and change its color.

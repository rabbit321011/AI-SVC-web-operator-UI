# AISVC-midi-web v0.32 Design

> Version: ver0.32  
> Status: planning draft  
> Scope: UI and settings update  
> Parent design: `docs/object-workbench-design.md`  
> Previous checkpoint: `docs/updates/ver0.31/`

---

## 1. Purpose

ver0.32 adds project-level utility pages and UI settings without touching GPU-heavy tool execution.

The center area is already an `EditorWorkspace`; this checkpoint extends it with root-level utility tabs for Settings and Keymap Help. These pages are not media editors, but they belong in the same tabbed center workspace because they are project/workbench-level pages rather than modal popups.

---

## 2. Editor Workspace Utility Pages

Initial root-level utility tabs:

```text
Timeline      default root editor, not closeable
Settings      root utility page, singleton, closeable
Keymap Help   root utility page, singleton, closeable
```

Rules:

- Settings tab can have only one instance.
- Keymap Help tab can have only one instance.
- Clicking the corresponding topbar button creates and activates the tab if missing.
- If the tab already exists, clicking the button activates it.
- Timeline remains the default editor and cannot be closed.

---

## 3. TopBar Changes

- Remove the legacy topbar synthesis entry.
- Add SVG-icon buttons for Settings and Keymap Help.
- Do not use emoji or text-symbol icons.

---

## 4. Local Settings Persistence

UI and default parameter settings should persist locally.

Initial storage target:

```text
localStorage
```

Persisted setting groups:

- Theme.
- Auto-save interval.
- Default SVC/SVS model and step values.
- Default SVC cfg.
- Center opacity.
- Left/right sidebar opacity.
- Topbar opacity.
- Background image enabled flag.
- Optional background image data.
- Left/right sidebar glass effect enabled flag.
- Center glass effect enabled flag.

Background image persistence should be defensive so oversized or invalid images do not break app startup.

---

## 5. Settings Page Content

Settings page sections:

```text
Appearance
  Theme: Light / Night / 奶黄
  Center opacity
  Left/right sidebar opacity
  Topbar opacity
  Enable background image
  Import background image
  Enable sidebar glass effect
  Enable center glass effect

Auto Save
  Auto-save interval

Default Inference Parameters
  SVC default model
  SVC default step
  SVC default cfg
  SVS default model
  SVS default step
```

Theme notes:

- `Night` keeps the current dark workbench feeling.
- `Light` is a neutral light theme.
- `奶黄` is a warm old-forum style theme, similar in spirit to A island style colors.

---

## 6. Keymap Help Page

Keymap Help is a root-level editor tab, not a modal.

The page should use a game-like keyboard diagram. Important keys and combinations are visually labeled with their workbench actions.

Initial content should include:

- `Alt + Mouse Wheel`: fast horizontal timeline movement.
- `Ctrl + Mouse Wheel`: vertical timeline movement across tracks.
- `Alt + N`: locate TrackObject.
- `Alt + L`: locate AudioObject.
- `Alt + M`: locate related MidiObject.
- `Alt + K`: locate related TextObject.

Mouse-specific actions can be shown beside the keyboard diagram.

---

## 7. L1/L2 Collapse

The left object tree has L1 and L2 columns. Each column should be independently collapsible.

Rules:

- L1 can collapse without collapsing L2.
- L2 can collapse without collapsing L1.
- Collapse/expand controls use SVG chevrons, not text characters.
- Collapsed state is UI state and may persist locally if convenient.

---

## 8. Timeline Wheel Navigation

Add timeline wheel shortcuts:

```text
Alt + Mouse Wheel   fast horizontal movement
Ctrl + Mouse Wheel  vertical movement across tracks
```

The interaction should not invoke model execution and should not change timeline data.

---

## 9. Track Controls

Track control area should gain small SVG-icon buttons for track ordering:

```text
Move track up
Move track down
```

Moving tracks should keep the timeline order and object-tree TrackFolder order aligned.

Track color should be editable from the track control area context menu. Use a local UI component such as Naive UI `NColorPicker` if available.

---

## 10. Non-Goals

ver0.32 does not implement:

- Whisper backend.
- MSST backend.
- Chat backend.
- MIDI editor.
- Filesystem integration.
- Full settings sync to backend.
- Large visual redesign of the whole product.

---

## 11. Acceptance Shape

ver0.32 is successful when:

- Settings and Keymap Help open as singleton closeable editor tabs.
- Timeline remains default and non-closeable.
- Topbar has SVG buttons for Settings and Keymap Help.
- UI settings persist locally and apply visibly.
- L1/L2 can collapse independently.
- Timeline supports the new wheel shortcuts.
- Tracks can move up/down from the track control area.
- Track color can be changed from the track control area.
- Focused and full client tests pass.


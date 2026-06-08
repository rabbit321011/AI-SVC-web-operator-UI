# AISVC-midi-web v0.3 Design

> Version: ver0.3  
> Status: planning draft  
> Scope: Rich Media Editor Workspace and checkpoint document structure  
> Parent design: `docs/object-workbench-design.md`

---

## 1. Purpose

ver0.3 is a design checkpoint, not only an implementation checkpoint.

Its goal is to turn the latest object-workbench direction into a smaller, versioned design slice that can be reviewed, implemented, and reported against.

The major direction inherited from `object-workbench-design.md` is:

```text
AISVC-midi-web is an AI singing production engineering system.
The center area is a multi-tab Rich Media Editor Workspace.
Timeline is the default editor mounted at project/root, not the whole definition of the center area.
```

---

## 2. Checkpoint Document Rule

Each future design checkpoint should live under:

```text
docs/updates/verX.Y/
├─ design.md
└─ report.md
```

`design.md` records the intended design for the checkpoint.

`report.md` records what actually changed, what was verified, what remains open, and any deviation from the design.

Both files share the same version number so design intent and implementation report can be read together.

---

## 3. ver0.3 Design Focus

ver0.3 should focus on the minimum model for the Rich Media Editor Workspace.

It should not attempt to implement MIDI, Text, Pitch, or multidimensional editors yet. Those are future editor kinds. The first goal is to give them a stable place to live.

Core concepts:

```text
EditorWorkspace
EditorTab
EditorContext
TimelineEditor
ObjectBoundEditor
```

### 3.1 EditorWorkspace

`EditorWorkspace` is the center work area. It owns editor tabs and active editor state.

It is separate from left object-tree selection.

Object-tree selection may be used for drag, locate, fill tool input, or open editor commands, but it must not automatically replace the active editor tab.

### 3.2 EditorTab

An `EditorTab` represents one open editing context.

Initial expected kinds:

```text
timeline       project/root Timeline Editor
object         future object-bound editor, such as MidiObject or TextObject
```

The first implementation can keep only one real editor: the existing timeline.

### 3.3 TimelineEditor

`TimelineEditor` is the default editor mounted at `project/root`.

It edits Track / TrackObject state and remains the highest-frequency working surface.

Timeline is also an experiment arrangement surface. Existing solo, mute, and TrackObject ignore behavior should be understood as candidate comparison and filtering tools, not only DAW-like playback controls.

### 3.4 ObjectBoundEditor

Future object-bound editors are opened explicitly for specific Object kinds.

Examples:

```text
MidiObject -> MIDI / piano-roll editor
TextObject -> lyric / kana / romaji editor
PitchObject -> pitch curve editor
Analysis object -> 2D/3D/multidimensional editor
```

Lightweight object edits may remain inline or in small panels. Only objects needing rich editing space should occupy a full editor tab.

---

## 4. Non-Goals

ver0.3 should not solve:

- MIDI editor interaction details
- Text/kana/romaji editor details
- Pitch/F0 editor details
- Tool Panel generalization implementation
- legacy segment / CompGroup removal
- project file migration

These belong to later checkpoints.

---

## 5. Acceptance Shape

ver0.3 is successful when the project has a documented and, if implemented, minimally represented center workspace model where:

- Timeline is treated as an editor tab mounted at project/root.
- Left object-tree selection is separate from active editor context.
- Future rich editors have a clear extension point.
- Existing timeline behavior continues to work.


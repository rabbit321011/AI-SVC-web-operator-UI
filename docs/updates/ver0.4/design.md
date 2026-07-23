# AISVC-midi-web v0.4 Design

> Version: ver0.4
> Status: planning draft
> Scope: Whisper pipeline + Text TrackObject + Text Editor (3 forms)
> Parent design: `docs/object-workbench-design.md`
> Previous checkpoint: `docs/updates/ver0.32/`

---

## 1. Purpose

ver0.4 implements the first non-SVC/SVS backend-connected tool — Whisper — end to end, and introduces the first object-bound editor: a kana/romaji dual-column text editor with three entry forms.

The goal is to validate:
- A new tool pipeline (faster-whisper on GPU) through the shared render output convention
- Text TrackObject as a first-class timeline entity with visual rendering
- Object-bound editor tab architecture (ver0.3's `EditorWorkspace` extension point)
- Kana ↔ romaji bidirectional sync as a reusable editing primitive

---

## 2. Backend: whisper_runner.py

### 2.1 Pipeline

```text
audio input (wav)
  → faster-whisper (large-v3, CUDA float16)
  → raw Japanese text
  → SudachiPy (kanji → katakana reading)
  → jaconv (katakana → hiragana)
  → jaconv (hiragana → romaji)
  → TextObject JSON written to project data directory
  → WebSocket progress messages back to frontend
```

### 2.2 Script Interface

```text
python whisper_runner.py \
  --input <wav_path> \
  --output-dir <project_renders_dir> \
  --output-name <name> \
  --language <auto|ja|zh|en> \
  --vad <true|false> \
  --device cuda \
  --compute-type float16
```

### 2.3 Transcription Parameters

- Model: `Systran/faster-whisper-large-v3` (HF cache at `C:\Users\jbbj\.cache\huggingface\hub\models--Systran--faster-whisper-large-v3\`)
- `beam_size=1` (fast, sufficient for lyrics)
- `vad_filter`: controlled by `--vad` flag, default `true`
- `language`: controlled by `--language`, default `None` (auto-detect)
- Segment granularity: segment-level (no word_timestamps in v1)

### 2.4 SudachiPy Conversion

- Tokenizer: `Dictionary(dict='full').create()`, SplitMode.C
- Reading: `token.reading_form()` per token → katakana
- jaconv: `kata2hira()` → hiragana for kana field
- jaconv: `kana2alphabet()` → romaji for romaji field

### 2.5 Output Format

TextObject JSON written to `project:/renders/whisper/<outputName>.json`:

```json
{
  "id": "<generated-uid>",
  "kind": "text",
  "name": "<outputName>",
  "text": {
    "sourceAudioObjectId": "<source-audio-object-id>",
    "segments": [
      {
        "start": 0.0,
        "end": 5.98,
        "kana": "とうめいなぼくらどこへいこうか",
        "romaji": "toumeinabokuradokoheikouka"
      }
    ]
  }
}
```

- Segment times (`start`/`end`) are relative to the TextObject's origin (time 0 = source audio start)
- First version: single segment covering full audio duration
- `segments[0].end` = Whisper audio duration
- TrackObjects map their `timelineStart` to TextObject origin when rendering segments on timeline
- Source audio ObjectId is passed through for tracking

### 2.6 WebSocket Progress

Messages follow the existing SVC pattern:

```text
{ "type": "log", "message": "Loading faster-whisper large-v3..." }
{ "type": "progress", "progress": 50 }
{ "type": "log", "message": "SudachiPy conversion..." }
{ "type": "progress", "progress": 90 }
{ "type": "result", "textObject": { ... } }
{ "type": "done" }
{ "type": "error", "message": "..." }
```

---

## 3. Backend: whisper.service.ts

### 3.1 Architecture

- `server/src/services/whisper.service.ts` — spawn `whisper_runner.py`
- `server/scripts/whisper_runner.py` — Python entry point
- Python path: `E:/AIscene/AISVCs/.venv/Scripts/python.exe` (same as SVC)
- Communication: child_process spawn + WebSocket pass-through

### 3.2 Service Interface

```ts
export interface WhisperRequest {
  inputWav: string           // source audio file path
  outputDir: string          // project renders/whisper/ directory
  outputName: string         // output object name
  language: 'auto' | 'ja' | 'zh' | 'en'
  vad: boolean
  sourceAudioObjectId: string // for TextObject.sourceAudioObjectId
}

export function runWhisper(req: WhisperRequest, ws: WebSocket): void
```

### 3.3 Task Lock

Whisper participates in the shared local processing lock (same as SVC/SVS/MSST).
While Whisper is running, SVC/SVS/MSST cannot start.

### 3.4 Result Handling

On success, the service:
1. Reads the generated TextObject JSON
2. Sends `{ type: "result", textObject: { ... } }` to the client
3. The client calls `addRenderedTextToTimeline()` to create:
   - `project:/renders/whisper/<name>` — TextObject archive
   - `project:/trackSources/text/<copy>` — TextObject working copy
   - `project:/tracks/<text track>/<object>` — text TrackObject

---

## 4. Frontend: Whisper UI (Right Panel)

### 4.1 Input Slots

```text
┌─ Whisper ───────────────────────────┐
│ Audio: [TrackObject/GroupObject ▼]   │
│ Language: [auto ▼]                   │
│ VAD: [✓]                             │
│ Output Name: [............]           │
│ [Run]                                │
│ Status: idle / running / done        │
└──────────────────────────────────────┘
```

- **Audio**: accepts audio TrackObject or audio GroupObject
- **Language**: dropdown `auto` / `ja` / `zh` / `en`, default `auto`
- **VAD**: checkbox, default checked
- **Output Name**: editable string, defaults to source object name + "_whisper"

### 4.2 Existing Shell Extension

The Whisper mode in `RenderPanel.vue` already has:
- Audio input slot (slot key: `whisper.audio`)
- Output name field
- Language draft field
- Running/done/failed state display

ver0.4 wires these to real backend execution.

---

## 5. Text TrackObject Timeline Display

### 5.1 Text Track

- text TrackObjects live on text-type TrackFolder tracks
- Whisper output automatically creates or reuses a text track
- Text tracks render differently from audio tracks: no waveform, no F0

### 5.2 Text Bar Rendering

Each text TrackObject is rendered as a bar spanning `timelineStart → timelineEnd`:

```text
┌─────────────────────────────────────────┐
│ toumeinabokuradokoheikouka              │  ← romaji (top row)
│ とうめいなぼくらどこへいこうか             │  ← kana (bottom row)
└─────────────────────────────────────────┘
```

Rules:
- Two rows per bar: romaji on top, kana on bottom
- Romaji row: slightly smaller font, lighter color
- Kana row: primary font size, standard text color
- Both rows share the same background bar
- Text overflow: truncate with `...` when bar width < text length
- Hover tooltip: show full kana + romaji

### 5.3 Multi-Segment Display

When a TextObject has multiple segments with different time ranges:

```text
┌──────────┐  ┌───────────────────────┐
│ toumeina │  │ bokuradokoheikouka    │
│ とうめいな│  │ ぼくらどこへいこうか    │
└──────────┘  └───────────────────────┘
```

- Each segment is a sub-bar within the TrackObject's overall bar
- Segment width = (segment.end - segment.start) / (TrackObject timelineEnd - timelineStart)
- Gaps between segments are transparent / empty
- Truncation applies per segment

### 5.4 Interaction

- **Select**: left-click on text bar → select TrackObject
- **Move**: drag text bar horizontally → change timelineStart/End (shift segment timestamps proportionally)
- **Move to other track**: drag vertically to another text track
- **Double-click**: open **Form 1** inline text editor (see §6.1)
- **Split** (S key): split TrackObject at playhead position (see §7)
- **Copy/Paste**: standard timeline copy/paste, deep-copy segments

### 5.5 Track Header

Text tracks have the same controls as audio tracks:
- Mute / Solo / Volume
- Track name
- Move up/down
- Track color (distinct default color from audio tracks, e.g. green/teal)

---

## 6. Text Editor (Three Forms)

All three forms operate on the same underlying TextObject data.
Edits in any form are immediately reflected in the other two.

### 6.1 Form 1: Timeline Inline Editor

Triggered by double-clicking a text TrackObject bar on the timeline.

```text
┌─ Inline Edit Overlay ──────────────────────┐
│ Romaji: [toumeina bokuradokoheikouka    ]   │
│ Kana:   [とうめいな ぼくらどこへいこうか  ]   │
│                                  [OK] [✕]  │
└─────────────────────────────────────────────┘
```

Rules:
- Compact overlay positioned near the double-clicked bar
- Two text inputs: romaji (top) and kana (bottom)
- Editing one auto-updates the other via sync rules (§6.4)
- **Editing romaji**: space-separated words → kana conversion
- **Editing kana**: direct hiragana → romaji conversion
- Multiple segments: overlay shows the segment that was double-clicked
- Does not change timeline position or segment start/end times
- OK saves, ✕ discards
- Esc cancels

### 6.2 Form 2: Full Text Editor Tab (Object-Bound Editor)

Triggered by selecting a TextObject in L1/L2 object tree → double-click or context menu "Open Editor".

Opens as an `EditorTab` of kind `object` in the EditorWorkspace center area.

```text
┌─ Editor Tab: "Vox_whisper" ────────────────────────────────────┐
│                                                                  │
│  ┌─ Segments ────────────────────────────────────────────────┐  │
│  │ #  Start    End      Kana                    Romaji        │  │
│  │ ────────────────────────────────────────────────────────── │  │
│  │ 1  0.00s   5.98s  [とうめいなぼくらどこへ...] [toumeina...] │  │
│  │ 2  5.98s  12.34s  [さくらさくら            ] [sakura sa...] │  │
│  │ [+ Add Segment]                                            │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─ Selected Segment Editor ────────────────────────────────┐  │
│  │ Romaji: [toumeina bokuradokoheikouka                  ]   │  │
│  │ Kana:   [とうめいな ぼくらどこへいこうか                ]   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

Rules:
- Top section: segment list table with start/end times
- Bottom section: full-width dual editor for the selected segment
- Dual editor: romaji input + kana input, bidirectional sync
- Add/delete segments via the table
- Segment times editable (constrain to non-overlapping within TrackObject range)
- Closeable tab, singleton per TextObject (re-opening re-activates the same tab)

### 6.3 Form 3: SVS Tool Direct Input

The SVS tool panel already has a text slot. ver0.4 extends it with sync:

```text
┌─ SVS ─────────────────────────────────┐
│ Text:  [とうめいな|ぼくら|どこへ|... ]  │  ← kana input
│ Romaji:[toumeina|bokuradokohe|...  ]  │  ← romaji input (new)
│                                        │
│ or                                      │
│                                        │
│ Text:  [📝 TrackObject ref          ]  │  ← existing ref slot
└────────────────────────────────────────┘
```

When entering manual text:
- Two fields: kana (primary) and romaji (secondary)
- Editing kana auto-fills romaji, editing romaji auto-fills kana
- On inference: take the **kana** field, symbols → `|` (existing SVS normalization)
- Romaji field is for visual reference and editing convenience only

When using a TrackObject reference:
- Read-only display of the referenced TextObject's kana
- Click to locate: opens the TextObject in L2 with highlight, or opens Form 2 editor tab
- No direct editing of the reference from SVS panel

### 6.4 Kana ↔ Romaji Sync Rules

```text
kana → romaji:
  jaconv.kana2alphabet(kana)
  → "とうめいなぼくら" → "toumeinabokura"

romaji → kana:
  jaconv.alphabet2kana(romaji)
  → "tou mei na bo ku ra" → "とうめいなぼくら"
```

- Romaji→kana: space-separated tokens are converted as independent kana units
- The space is optional; jaconv handles both spaced and unspaced romaji
- N-continuity (`nn`): jaconv handles standard cases
- Sync is triggered on every keystroke (debounced 200ms for romaji input)
- User explicitly typing in kana field does NOT trigger romaji→kana (only romaji→kana triggers when romaji field is edited, and kana→romaji triggers when kana field is edited)
- Circular prevention: if the sync result matches the current value of the other field, no update is emitted (avoids cursor jumping)

---

## 7. Text TrackObject Splitting

### 7.1 Core Principle

Segment (句) is the atomic unit. A text TrackObject is a timeline container that owns a subset of a TextObject's segments. Splitting a TrackObject never creates, destroys, or modifies segments — it only redistributes segment ownership between TrackObjects.

### 7.2 Timeline Split (S key)

When user presses split (S) with playhead positioned over a selected text TrackObject:

```text
TextObject.segments = [
  { start: 0.0, end: 2.5, kana: "とうめいな", romaji: "toumeina" },
  { start: 2.5, end: 5.0, kana: "ぼくらどこへ", romaji: "bokuradokohe" },
  { start: 5.0, end: 8.0, kana: "いこうか", romaji: "ikouka" },
]

Before split:
  text TrackObject A (timeline 0.0–8.0)
    包含: 句1, 句2, 句3

    ┌─ A ──────────────────────────────────────────┐
    │ 句1            │ 句2           │ 句3           │
    │ toumeina       │ bokuradokohe  │ ikouka        │
    │ とうめいな       │ ぼくらどこへ    │ いこうか       │
    └───────────────┴───────────────┴───────────────┘
                           ↑ playhead at 3.5s

After split at 3.5s:
  text TrackObject A (timeline 0.0–3.5)
    包含: 句1, 句2  (segment.start < 3.5)
  text TrackObject B (timeline 3.5–8.0)
    包含: 句3       (segment.start >= 3.5)

    ┌─ A ──────────────────┐  ┌─ B ────────────────┐
    │ 句1       │ 句2       │  │ 句3                │
    │ toumeina  │ bokurad...│  │ ikouka             │
    │ とうめいな  │ ぼくら...  │  │ いこうか             │
    └───────────┴───────────┘  └────────────────────┘
```

Split logic:
1. Create a new text TrackObject B with `timelineStart` = playhead position, `timelineEnd` = original TrackObject A's `timelineEnd`
2. Set TrackObject A's `timelineEnd` = playhead position
3. Redistribute TextObject's segments:
   - `segment.start < playhead` → stay with TrackObject A
   - `segment.start >= playhead` → move to TrackObject B
4. No segment is created, deleted, or modified
5. Both TrackObjects share the same `sourceObjectId` (same TextObject)
6. Both TrackObjects live on the same text track, B placed immediately after A

### 7.3 Edge Cases

- **No segment starts after playhead**: TrackObject B has no segments. B still exists (empty) and can receive segments if user later edits segment start times.
- **No segment starts before playhead**: TrackObject A has no segments. Reject the split — splitting an empty container is meaningless.
- **Segment start exactly equals playhead**: that segment goes to B (>= rule).

### 7.4 Merge (Inverse of Split)

If user merges two adjacent text TrackObjects that share the same TextObject:
1. Extend A's `timelineEnd` to B's `timelineEnd`
2. All of B's segments move back to A
3. Delete TrackObject B
(Merge is NOT required for ver0.4, noted here for design completeness.)

### 7.5 Timeline Display After Split

Each TrackObject renders its owned segments as sub-bars within its time range. Gaps between segment time ranges within a TrackObject are transparent:

```text
┌─ A ──────────────────┐  ┌─ B ────────────────┐
│ 句1       │ 句2       │  │ 句3                │
└───────────┴───────────┘  └────────────────────┘
```

---

## 8. SVS Text Input Normalization (Existing, Confirmed)

The SVS pipeline already normalizes kana text before inference:

```text
Input kana: "とうめいな、ぼくら。どこへ！いこうか？"
  → delete all spaces
  → convert all symbols to "|"
  → "とうめいな|ぼくら|どこへ|いこうか|"
```

- Multiple TextObjects merged: join with `|` between them
- `segments.start` is used for segment ordering, not alignment

ver0.4 does not change this. It confirms SVS reads from the `kana` field of TextObject segments.

---

## 9. SVS Model Selection (Gap Fix)

### 9.1 Current State

SVS backend (`svs.service.ts`) supports an optional `--checkpoint` parameter. The backend already passes it to `infer_v4_formal.py`. However, the frontend pipeline never sends it — the SVS request body lacks a `checkpoint` field. The Settings page has a `svsDefaultModel` input that is unused.

In contrast, SVC has full model/step/cfg selection wired end to end.

### 9.2 Fix

ver0.4 fills this gap:

**Backend** — no change needed. `--checkpoint` is already supported.

**Frontend — `renderPanel.ts` store**:
- Add `checkpoint: string` to the SVS state (init from `uiSettings.settings.svsDefaultModel`)

**Frontend — `useRenderSvsPipeline.ts`**:
- Add `checkpoint` to the SVS request body

**Frontend — `RenderPanel.vue`**:
- Add SVS model input field (same pattern as SVC model field)
- Add SVS step selector (already has steps, but confirm wired)

**Frontend — `SettingsPage.vue`**:
- `svsDefaultModel` already exists; confirm it connects to store init

### 9.3 Rules

- SVS checkpoint is optional (defaults to script's built-in model when empty)
- UI field accepts a path string (e.g. `E:/AIscene/YingMusic_Singer_Plus/checkpoints/model.pt`)
- Settings default persists via `localStorage` (existing `uiSettings` path)
- SVS model selection does NOT participate in the Whisper pipeline — it is independent

---

## 10. Data Flow Summary

```text
┌─────────────┐    spawn     ┌──────────────────┐
│ whisper.     │────────────→│ whisper_runner.py │
│ service.ts   │←────────────│                   │
│ (WebSocket)  │  progress   │ faster-whisper    │
└──────┬───────┘             │   → SudachiPy     │
       │                     │   → jaconv        │
       │ result              │   → TextObject    │
       ▼                     └──────────────────┘
┌─────────────┐
│ objectTree  │
│ store       │
│             │
│ addRendered │  project:/renders/whisper/<name>  (TextObject archive)
│ TextTo      │  project:/trackSources/text/...   (TextObject copy)
│ Timeline()  │  project:/tracks/<text track>/... (text TrackObject)
└──────┬──────┘
       │
       ▼
┌─────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ Timeline    │    │ Text Editor Tab  │    │ SVS Tool Panel   │
│ Inline Edit │    │ (Form 2)         │    │ Text Input       │
│ (Form 1)    │    │                  │    │ (Form 3)         │
│             │    │ Full editor with │    │                  │
│ Double-click│    │ segment table    │    │ kana/romaji      │
│ text bar    │    │ + dual editor    │    │ manual input     │
└─────────────┘    └──────────────────┘    └──────────────────┘
       │                    │                       │
       └────────────────────┼───────────────────────┘
                            │
                   All operate on the
                   same TextObject data
                   via segments[{ kana, romaji, start }]
```

---

## 10. Non-Goals

ver0.4 does NOT implement:

- MSST backend connection
- Chat backend connection
- MIDI editor
- Pitch/F0 editor
- pykakasi fallback (SudachiPy is the only kanji→kana path)
- Word-level timestamps from Whisper
- Automatic kana/romaji correction or spellcheck
- Segment auto-detection from audio silence (future VAD-based splitting)
- Removal of legacy segment/CompGroup
- Tool Panel generic protocol
- Editor workspace state persistence (still only default timeline tab persisted)

---

## 12. Acceptance Shape

ver0.4 is successful when:

1. User selects an audio TrackObject, opens Whisper panel, clicks Run
2. Backend transcribes audio → produces kana/romaji TextObject
3. A text track appears on timeline with a text bar showing romaji/kana
4. Double-clicking the text bar opens inline editor; editing kana syncs romaji (and vice versa)
5. From L1/L2 object tree, user opens the TextObject as a full editor tab
6. The full editor tab shows segment table + dual editor, supporting add/delete/edit segments
7. SVS text input fields support kana/romaji bidirectional sync
8. Splitting a text TrackObject on timeline redistributes segments between two TrackObjects (never modifies segment content)
9. Text track controls (mute/solo/name/color/move) work identically to audio tracks
10. Focused tests pass: `whisper.service`, whisper_runner, text editor sync, segment splitting
11. Full client test suite passes
12. Server TypeScript build passes

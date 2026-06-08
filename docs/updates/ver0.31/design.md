# AISVC-midi-web v0.31 Design

> Version: ver0.31  
> Status: planning draft  
> Scope: Right Tool Panel product boundary  
> Parent design: `docs/object-workbench-design.md`  
> Previous checkpoint: `docs/updates/ver0.3/`

---

## 1. Purpose

ver0.31 defines the near-term product boundary for the right-side panel.

The goal is not to build a generic plugin framework or a schema-driven tool system. AISVC-midi-web only needs a small number of built-in right-side tools, so the right panel should remain explicit and product-shaped.

Confirmed direction:

```text
The right panel is a small built-in Tool Panel.
Each tool can keep its own hand-written UI and pipeline.
Only the project-object input and asset-output conventions are shared.
```

The product concept may be called `Right Tool Panel`. Current code may continue using names such as `RenderPanel` until a rename has real implementation value.

---

## 2. Current Right Panel Reality

The current implementation is still centered on SVC/SVS rendering.

Implemented reality inherited from baseline and ver0.3:

- The right panel supports SVC and SVS modes.
- Each mode keeps its own input slots and parameter draft.
- Slots can be filled from current selection or drag/drop.
- Inputs are represented with project object references.
- SVC/SVS output can be written into `renders`, copied into `trackSources`, and added back to the timeline as `TrackObject`.
- Some audio slots already accept ordinary `AudioObject` as a compatibility path.

This checkpoint accepts that reality and narrows the next design step: extend the product concept to a few built-in tools without over-abstracting the implementation.

---

## 3. Product Scope: Built-In Tools, Not a Plugin Framework

The right panel should support these built-in modes for the foreseeable future:

```text
SVC
SVS
Whisper
MSST
chatWithLLM
```

These tools are not treated as third-party plugins. They do not need dynamic registration, schema-driven UI generation, or a generic parameter model.

Implementation preference:

- Keep per-tool UI explicit.
- Keep per-tool pipeline code explicit.
- Share only small conventions that protect the project object model.
- Avoid a generic `ToolDefinition` framework unless the product later proves it needs one.

This keeps the right panel understandable and avoids architecture that is larger than the product surface.

---

## 4. Shared Asset Output Convention

SVC, SVS, Whisper, and MSST are asset-producing tools.

Their successful result follows the same broad chain:

```text
project object input
-> run tool
-> write result into renders/<tool>/...
-> copy result into trackSources
-> create TrackObject back into timeline
```

`renders` is not audio-only. It is the project resource area for reusable tool results. Tool results must be grouped by tool folder:

```text
project:/renders/svc/...
project:/renders/svs/...
project:/renders/whisper/...
project:/renders/msst/...
```

`chatWithLLM` is the exception. It is a right-side assistant utility and does not produce project resources in this checkpoint.

---

## 5. Input Reference Rules

The right panel consumes project objects.

For timeline-aware inputs, the preferred input references remain:

```text
TrackObject
GroupObject
```

Ordinary `AudioObject` may be accepted by specific slots as a reference input when timeline position is not required. Such inputs are interpreted as starting at time `0` and do not define output alignment.

Design rule:

- Use `TrackObject` or `GroupObject` for inputs that determine timing or timeline alignment.
- Allow ordinary `AudioObject` only for reference-style audio inputs where time is not meaningful.
- Do not allow folders as tool inputs.
- Keep slot validation explicit per tool instead of moving to a generic slot schema.

---

## 6. Per-Tool Behavior

### 6.1 SVC

SVC is an asset-producing audio conversion tool.

Inputs:

- Source audio: audio `TrackObject` or audio `GroupObject`.
- Conditioning/reference audio: audio `TrackObject`, audio `GroupObject`, or compatible reference `AudioObject`.

Output:

```text
project:/renders/svc/<name>             AudioObject
project:/trackSources/audio/<copy>      AudioObject
project:/tracks/<audio track>/<object>  audio TrackObject
```

Timeline alignment:

- The output TrackObject aligns to the source audio input.
- If the source input is a GroupObject, align to the group's earliest participating TrackObject.

### 6.2 SVS

SVS is an asset-producing singing synthesis tool.

Inputs:

- Timbre/reference audio: audio `TrackObject`, audio `GroupObject`, or compatible reference `AudioObject`.
- Melody input: audio or midi `TrackObject`; audio or midi `GroupObject`.
- Text input: text `TrackObject`, text `GroupObject`, or manual text.

Output:

```text
project:/renders/svs/<name>             AudioObject
project:/trackSources/audio/<copy>      AudioObject
project:/tracks/<audio track>/<object>  audio TrackObject
```

Timeline alignment:

- The output TrackObject aligns to the melody input.
- Timbre/reference audio does not determine timeline alignment when it is an ordinary `AudioObject`.

### 6.3 Whisper

Whisper is an asset-producing transcription or lyric extraction tool.

Inputs:

- Audio to transcribe: audio `TrackObject`, audio `GroupObject`, or compatible audio object where appropriate.

Output:

```text
project:/renders/whisper/<name>         TextObject
project:/trackSources/text/<copy>       TextObject
project:/tracks/<text track>/<object>   text TrackObject
```

Timeline behavior:

- Whisper results are copied into `trackSources/text` and represented on the timeline as text TrackObject.
- The text TrackObject should align to the source audio input.
- Future timeline rendering should display this as a lyric or text time bar.

The TextObject may contain timestamped segments when the backend provides timing information.

### 6.4 MSST

MSST is an asset-producing audio separation or enhancement tool.

Inputs:

- Audio to process: audio `TrackObject`, audio `GroupObject`, or compatible audio object where appropriate.

The tool may expose model-dependent output choices, such as:

```text
vocals only
accompaniment only
vocals + accompaniment
denoising model output
other stem outputs
```

Output:

```text
project:/renders/msst/<taskName>/<stem>        AudioObject
project:/trackSources/audio/<stem-copy>        AudioObject
project:/tracks/<audio track>/<stem-object>    audio TrackObject
```

Timeline behavior:

- Multi-output MSST results default to adding all produced stems back to the timeline.
- Each stem becomes its own audio TrackObject.
- Stems may use separate tracks so comparison and solo/mute workflows remain easy.
- A later implementation may add checkboxes for which stems to output or backfill.

### 6.5 chatWithLLM

chatWithLLM is a right-side assistant utility.

It is a peer mode in the right panel, but it is not an asset-producing render tool in this checkpoint.

Rules:

- It does not write to `renders`.
- It does not create `trackSources` objects.
- It does not create timeline TrackObjects.
- It does not participate in local audio-processing task locking.

Future versions may revisit whether LLM output can be saved into project notes or TextObject, but that is outside ver0.31.

---

## 7. Timeline Backfill Rules

For SVC, SVS, Whisper, and MSST, successful outputs are expected to be visible in the timeline by default.

Backfill rules:

- Audio outputs create audio TrackObject.
- Text outputs create text TrackObject.
- Output TrackObjects reference copies under `trackSources`, not the archive objects under `renders`.
- Archive objects under `renders` remain reusable resources.
- Deleting a `renders` archive object should not delete already-created timeline TrackObjects or their `trackSources` copies.

This continues the existing object-workbench principle:

```text
renders is the reusable archive
trackSources is the timeline working source
tracks contains time placement through TrackObject
```

---

## 8. Task Running And Locking

The first version should keep task execution simple.

Rules:

- SVC, SVS, Whisper, and MSST share one local processing lock.
- Only one local processing task runs at a time.
- While a task is running, other local processing tools cannot start.
- The running tool should show its own running, done, failed, and progress state.
- chatWithLLM is not part of this lock.

This avoids designing a global task center before the product needs one.

---

## 9. Non-Goals

ver0.31 does not design or require:

- A plugin system.
- Dynamic tool registration.
- Schema-driven UI rendering for tool slots.
- A generic parameter model across all tools.
- A global task center.
- Task cancellation.
- Persisted chat history.
- LLM output as project assets.
- Removal of legacy `segment` or `CompGroup`.
- Implementation of Whisper, MSST, or chatWithLLM.
- Renaming all current `RenderPanel` code to `ToolPanel`.

---

## 10. Acceptance Shape

ver0.31 is successful when the project has a clear written design for the right panel where:

- The right panel is understood as a small set of built-in tools.
- SVC, SVS, Whisper, MSST, and chatWithLLM have clear product roles.
- SVC, SVS, Whisper, and MSST share the same asset-output chain.
- Tool results are stored under tool-specific `renders/<tool>/` folders.
- Audio and text outputs are copied into `trackSources` and represented as TrackObject on the timeline.
- chatWithLLM is explicitly excluded from the asset-output pipeline.
- The design avoids generic framework work that is not justified by the current product scale.

---

## 11. Open Questions

- Exact Whisper segment schema and confidence metadata.
- Whether Whisper should support language/model options in the first implementation.
- Exact MSST model list and output stem naming.
- Whether MSST output selection controls affect generation, timeline backfill, or both.
- Whether future LLM replies can optionally be saved as project notes or TextObject.
- Whether task cancellation becomes necessary after MSST or Whisper runs are integrated.


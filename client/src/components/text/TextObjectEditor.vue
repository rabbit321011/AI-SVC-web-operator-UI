<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useObjectTreeStore } from '@/stores/objectTree'
import { useHistoryStore } from '@/stores/history'
import { usePlaybackStore } from '@/stores/playback'
import type { TextSegment } from '@/object-workbench'
import { kanaToRomaji, romajiToKana } from '@/utils/kanaRomaji'

const props = defineProps<{ objectId: string }>()

const objectTree = useObjectTreeStore()
const history = useHistoryStore()
const playback = usePlaybackStore()
const selectedId = ref<string | null>(null)
const editorRoot = ref<HTMLElement | null>(null)
const kanaEditor = ref<HTMLTextAreaElement | null>(null)
const notice = ref('')

const textObject = computed(() => {
  const node = objectTree.node(props.objectId)
  return node?.kind === 'text' ? node : null
})

const segments = computed(() => textObject.value?.text.segments ?? [])
const selectedSegment = computed(() => segments.value.find(segment => segment.id === selectedId.value) ?? segments.value[0] ?? null)
const timelineContext = computed(() => {
  return Object.values(objectTree.index.nodes).find(node => (
    node.kind === 'trackObject'
    && node.trackObject.contentType === 'text'
    && node.trackObject.sourceObjectId === props.objectId
  )) as import('@/object-workbench').TrackObjectNode | undefined
})
const objectDuration = computed(() => {
  const context = timelineContext.value
  return context ? context.trackObject.timelineEnd - context.trackObject.timelineStart : null
})

function ensureId(segment: TextSegment) {
  if (!segment.id) segment.id = `textseg:${crypto.randomUUID()}`
  return segment.id
}

function selectSegment(segment: TextSegment) {
  selectedId.value = ensureId(segment)
}

function patchSegment(segment: TextSegment, patch: Partial<TextSegment>) {
  const segmentId = ensureId(segment)
  if (patch.kana !== undefined) {
    objectTree.updateTextSegmentContent(props.objectId, segmentId, {
      kana: patch.kana,
      romaji: kanaToRomaji(patch.kana),
    })
  } else if (patch.romaji !== undefined) {
    objectTree.updateTextSegmentContent(props.objectId, segmentId, {
      kana: romajiToKana(patch.romaji),
      romaji: patch.romaji,
    })
  } else if (patch.start !== undefined || patch.end !== undefined) {
    const start = Math.max(0, Number(patch.start ?? segment.start) || 0)
    const end = Math.max(start + 0.1, Number(patch.end ?? segment.end) || start + 1)
    objectTree.updateTextSegmentTiming(props.objectId, segmentId, start, end)
  }
}

function addSegment() {
  const list = segments.value
  const selectedIndex = list.findIndex(segment => segment.id === selectedSegment.value?.id)
  const anchor = selectedIndex >= 0 ? list[selectedIndex] : list[list.length - 1]
  const next = selectedIndex >= 0 ? list[selectedIndex + 1] : undefined
  const start = anchor?.end ?? anchor?.start ?? 0
  const availableEnd = next?.start ?? objectDuration.value ?? start + 1
  const segment: TextSegment = {
    id: `textseg:${crypto.randomUUID()}`,
    start,
    end: Math.max(start + 0.1, Math.min(start + 1, availableEnd)),
    kana: '',
    romaji: '',
  }
  const beforeTree = objectTree.snapshotTree()
  const result = objectTree.addTextSegment(props.objectId, segment)
  if (!result.ok) {
    flash(result.reason || '新增句子失败')
    return
  }
  selectedId.value = result.segmentId ?? segment.id!
  history.push({
    description: '新增文本句子',
    patches: [],
    inversePatches: [],
    objectTree: { kind: 'snapshot', before: beforeTree, after: objectTree.snapshotTree() },
  })
  nextTick(() => {
    editorRoot.value?.querySelector(`[data-segment-id="${CSS.escape(selectedId.value!)}"]`)?.scrollIntoView({ block: 'nearest' })
    kanaEditor.value?.focus()
  })
}

function deleteSegment(segment: TextSegment) {
  const object = textObject.value
  if (!object) return
  const id = ensureId(segment)
  const beforeTree = objectTree.snapshotTree()
  const result = objectTree.deleteTextSegment(props.objectId, id)
  if (!result.ok) {
    flash(result.reason || '删除句子失败')
    return
  }
  if (selectedId.value === id) selectedId.value = object.text.segments[0]?.id ?? null
  history.push({
    description: '删除文本句子',
    patches: [],
    inversePatches: [],
    objectTree: { kind: 'snapshot', before: beforeTree, after: objectTree.snapshotTree() },
  })
}

function handleEditorKeydown(event: KeyboardEvent) {
  if (event.key !== 'Delete' && event.key !== 'Backspace') return
  const target = event.target as HTMLElement | null
  if (target?.matches('input, textarea, [contenteditable="true"]')) return
  const segment = selectedSegment.value
  if (!segment) return
  event.preventDefault()
  deleteSegment(segment)
}

function formatTime(value: number | undefined) {
  return (value ?? 0).toFixed(2)
}

function nudgeTime(field: 'start' | 'end', delta: number) {
  const segment = selectedSegment.value
  if (!segment) return
  patchSegment(segment, { [field]: Number(((segment[field] ?? segment.start) + delta).toFixed(3)) })
}

function setTimeFromPlayhead(field: 'start' | 'end') {
  const segment = selectedSegment.value
  if (!segment) return
  const localTime = playback.currentTime - (timelineContext.value?.trackObject.timelineStart ?? 0)
  patchSegment(segment, { [field]: Math.max(0, Number(localTime.toFixed(3))) })
}

function segmentIssue(segment: TextSegment, index: number): string {
  const end = segment.end ?? segment.start
  if (end <= segment.start) return '终点必须晚于起点'
  if (objectDuration.value != null && end > objectDuration.value + 1e-6) return `终点超出音频范围 ${objectDuration.value.toFixed(2)}s`
  const previous = segments.value[index - 1]
  if (previous?.end != null && segment.start < previous.end - 1e-6) return '与上一句重叠'
  if (!segment.kana.trim() && !segment.romaji.trim()) return '歌词为空'
  return ''
}

function flash(message: string) {
  notice.value = message
  window.setTimeout(() => {
    if (notice.value === message) notice.value = ''
  }, 1800)
}
</script>

<template>
  <section v-if="textObject" ref="editorRoot" class="text-editor" tabindex="-1" @keydown="handleEditorKeydown">
    <div class="segment-list">
      <div class="segment-list-header">
        <h2>{{ textObject.name }}</h2>
        <button type="button" class="small-btn icon-btn" title="新增句子" @click="addSegment"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7.25 2h1.5v5.25H14v1.5H8.75V14h-1.5V8.75H2v-1.5h5.25V2Z" /></svg></button>
      </div>
      <div class="segment-table">
        <div class="segment-row segment-head">
          <span>#</span><span>Start</span><span>End</span><span>Kana</span><span>Romaji</span><span></span>
        </div>
        <button
          v-for="(segment, index) in segments"
          :key="ensureId(segment)"
          type="button"
          class="segment-row"
          :class="{ selected: selectedSegment?.id === segment.id, invalid: segmentIssue(segment, index) }"
          :data-segment-id="segment.id"
          :title="segmentIssue(segment, index)"
          @click="selectSegment(segment)"
        >
          <span>{{ index + 1 }}</span>
          <span>{{ formatTime(segment.start) }}</span>
          <span>{{ formatTime(segment.end) }}</span>
          <span class="clip">{{ segment.kana || '-' }}</span>
          <span class="clip">{{ segment.romaji || '-' }}</span>
          <span class="row-actions">
            <button type="button" class="delete-segment-btn" title="删除句子" @click.stop="deleteSegment(segment)">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 2h3l.5 1H13v1H3V3h3l.5-1ZM4 5h8l-.5 9h-7L4 5Z" /></svg>
            </button>
          </span>
        </button>
      </div>
    </div>

    <div v-if="selectedSegment" class="segment-editor">
      <div class="time-grid">
        <div class="time-control">
          <label>Start<input type="number" step="0.01" :value="Number(selectedSegment.start.toFixed(3))" @input="patchSegment(selectedSegment, { start: Number(($event.target as HTMLInputElement).value) })" /></label>
          <div class="time-actions"><button @click="nudgeTime('start', -0.1)">-0.10</button><button @click="nudgeTime('start', -0.01)">-0.01</button><button @click="nudgeTime('start', 0.01)">+0.01</button><button @click="nudgeTime('start', 0.1)">+0.10</button><button class="playhead-btn" title="设为播放头" @click="setTimeFromPlayhead('start')">|</button></div>
        </div>
        <div class="time-control">
          <label>End<input type="number" step="0.01" :value="Number((selectedSegment.end ?? selectedSegment.start).toFixed(3))" @input="patchSegment(selectedSegment, { end: Number(($event.target as HTMLInputElement).value) })" /></label>
          <div class="time-actions"><button @click="nudgeTime('end', -0.1)">-0.10</button><button @click="nudgeTime('end', -0.01)">-0.01</button><button @click="nudgeTime('end', 0.01)">+0.01</button><button @click="nudgeTime('end', 0.1)">+0.10</button><button class="playhead-btn" title="设为播放头" @click="setTimeFromPlayhead('end')">|</button></div>
        </div>
      </div>
      <div v-if="segmentIssue(selectedSegment, segments.indexOf(selectedSegment))" class="segment-warning">{{ segmentIssue(selectedSegment, segments.indexOf(selectedSegment)) }}</div>
      <label>Kana<textarea ref="kanaEditor" :value="selectedSegment.kana" @input="patchSegment(selectedSegment, { kana: ($event.target as HTMLTextAreaElement).value })" /></label>
      <label>Romaji<textarea :value="selectedSegment.romaji" @input="patchSegment(selectedSegment, { romaji: ($event.target as HTMLTextAreaElement).value })" /></label>
    </div>
    <div class="editor-notice">{{ notice }}</div>
  </section>
  <section v-else class="text-editor missing">TextObject unavailable</section>
</template>

<style scoped>
.text-editor {
  flex: 1;
  min-width: 0;
  overflow: auto;
  display: grid;
  grid-template-rows: minmax(160px, 1fr) auto;
  gap: 12px;
  padding: 14px;
  color: var(--app-text);
}
.segment-list, .segment-editor {
  min-width: 0;
  border: 1px solid var(--app-border);
  background: var(--app-panel);
  border-radius: 6px;
  padding: 12px;
}
.segment-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
h2 { margin: 0; font-size: 15px; font-weight: 600; }
.small-btn {
  border: 1px solid var(--app-border);
  background: var(--app-surface);
  color: var(--app-text);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
}
.icon-btn { width: 28px; height: 26px; padding: 4px; display: inline-flex; align-items: center; justify-content: center; }
.icon-btn svg { width: 14px; height: 14px; fill: currentColor; }
.segment-table { display: grid; gap: 3px; }
.segment-row {
  display: grid;
  grid-template-columns: 36px 64px 64px minmax(120px, 1fr) minmax(120px, 1fr) 28px;
  gap: 8px;
  align-items: center;
  min-height: 28px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--app-text);
  text-align: left;
  font: inherit;
  font-size: 12px;
}
.segment-head { color: var(--app-muted); border-bottom: 1px solid var(--app-border); border-radius: 0; }
button.segment-row { cursor: pointer; padding: 0; }
button.segment-row:hover, button.segment-row.selected { background: var(--app-hover); }
button.segment-row.invalid { box-shadow: inset 2px 0 #d29922; }
.clip { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.row-actions { text-align: center; }
.delete-segment-btn {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 3px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: #f85149;
  cursor: pointer;
}
.delete-segment-btn svg { width: 13px; height: 13px; fill: currentColor; }
.delete-segment-btn:hover { border-color: #f85149; background: rgba(248, 81, 73, 0.12); }
.segment-editor { display: grid; gap: 10px; }
.time-grid { display: grid; grid-template-columns: minmax(260px, 1fr) minmax(260px, 1fr); gap: 12px; }
.time-control { min-width: 0; display: grid; gap: 5px; }
.time-actions { display: grid; grid-template-columns: repeat(4, 1fr) 24px; gap: 3px; }
.time-actions button { min-width: 0; height: 22px; border: 1px solid var(--app-border); border-radius: 3px; background: var(--app-surface); color: var(--app-muted); font-size: 10px; cursor: pointer; }
.time-actions button:hover { border-color: var(--app-accent); color: var(--app-text); }
.playhead-btn { font-weight: 700; color: var(--app-accent) !important; }
.segment-warning { color: #d29922; font-size: 11px; }
label { display: grid; gap: 4px; font-size: 12px; color: var(--app-muted); }
input, textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--app-border);
  border-radius: 4px;
  background: var(--app-surface);
  color: var(--app-text);
  padding: 6px 8px;
  font: inherit;
}
textarea { min-height: 58px; resize: vertical; }
.editor-notice { position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); color: #d29922; font-size: 12px; pointer-events: none; }
.missing { display: flex; align-items: center; justify-content: center; color: var(--app-muted); }
</style>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useObjectTreeStore } from '@/stores/objectTree'
import type { TextSegment } from '@/object-workbench'
import { kanaToRomaji, romajiToKana } from '@/utils/kanaRomaji'

const props = defineProps<{ objectId: string }>()

const objectTree = useObjectTreeStore()
const selectedId = ref<string | null>(null)

const textObject = computed(() => {
  const node = objectTree.node(props.objectId)
  return node?.kind === 'text' ? node : null
})

const segments = computed(() => textObject.value?.text.segments ?? [])
const selectedSegment = computed(() => segments.value.find(segment => segment.id === selectedId.value) ?? segments.value[0] ?? null)

function ensureId(segment: TextSegment) {
  if (!segment.id) segment.id = `textseg:${crypto.randomUUID()}`
  return segment.id
}

function selectSegment(segment: TextSegment) {
  selectedId.value = ensureId(segment)
}

function patchSegment(segment: TextSegment, patch: Partial<TextSegment>) {
  ensureId(segment)
  if (patch.kana !== undefined) {
    segment.kana = patch.kana
    segment.romaji = kanaToRomaji(patch.kana)
  } else if (patch.romaji !== undefined) {
    segment.romaji = patch.romaji
    segment.kana = romajiToKana(patch.romaji)
  } else {
    Object.assign(segment, patch)
  }
  if (patch.start !== undefined || patch.end !== undefined) {
    const start = Math.max(0, Number(segment.start) || 0)
    const end = Math.max(start + 0.1, Number(segment.end) || start + 1)
    objectTree.updateTextSegmentTiming(props.objectId, segment.id!, start, end)
  }
  if (patch.kana !== undefined || patch.romaji !== undefined) {
    objectTree.updateTextSegmentContent(props.objectId, segment.id!, { kana: segment.kana, romaji: segment.romaji })
  }
}

function addSegment() {
  const list = segments.value
  const last = list[list.length - 1]
  const start = last?.end ?? last?.start ?? 0
  const segment: TextSegment = {
    id: `textseg:${crypto.randomUUID()}`,
    start,
    end: start + 1,
    kana: '',
    romaji: '',
  }
  textObject.value?.text.segments.push(segment)
  selectedId.value = segment.id!
}

function deleteSegment(segment: TextSegment) {
  const object = textObject.value
  if (!object) return
  const id = ensureId(segment)
  object.text.segments = object.text.segments.filter(item => item.id !== id)
  if (selectedId.value === id) selectedId.value = object.text.segments[0]?.id ?? null
}

function formatTime(value: number | undefined) {
  return (value ?? 0).toFixed(2)
}
</script>

<template>
  <section v-if="textObject" class="text-editor">
    <div class="segment-list">
      <div class="segment-list-header">
        <h2>{{ textObject.name }}</h2>
        <button type="button" class="small-btn" @click="addSegment">+ Segment</button>
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
          :class="{ selected: selectedSegment?.id === segment.id }"
          @click="selectSegment(segment)"
        >
          <span>{{ index + 1 }}</span>
          <span>{{ formatTime(segment.start) }}</span>
          <span>{{ formatTime(segment.end) }}</span>
          <span class="clip">{{ segment.kana || '-' }}</span>
          <span class="clip">{{ segment.romaji || '-' }}</span>
          <span class="row-actions"><span class="delete-mark" @click.stop="deleteSegment(segment)">x</span></span>
        </button>
      </div>
    </div>

    <div v-if="selectedSegment" class="segment-editor">
      <div class="time-grid">
        <label>Start<input type="number" step="0.01" :value="selectedSegment.start" @input="patchSegment(selectedSegment, { start: Number(($event.target as HTMLInputElement).value) })" /></label>
        <label>End<input type="number" step="0.01" :value="selectedSegment.end" @input="patchSegment(selectedSegment, { end: Number(($event.target as HTMLInputElement).value) })" /></label>
      </div>
      <label>Kana<textarea :value="selectedSegment.kana" @input="patchSegment(selectedSegment, { kana: ($event.target as HTMLTextAreaElement).value })" /></label>
      <label>Romaji<textarea :value="selectedSegment.romaji" @input="patchSegment(selectedSegment, { romaji: ($event.target as HTMLTextAreaElement).value })" /></label>
    </div>
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
.clip { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.row-actions { text-align: center; }
.delete-mark { color: #f85149; padding: 2px 5px; }
.segment-editor { display: grid; gap: 10px; }
.time-grid { display: grid; grid-template-columns: 120px 120px; gap: 10px; }
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
.missing { display: flex; align-items: center; justify-content: center; color: var(--app-muted); }
</style>

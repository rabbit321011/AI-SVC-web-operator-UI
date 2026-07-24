<script setup lang="ts">
import { computed, ref, nextTick } from 'vue'
import { useTracksStore } from '@/stores/tracks'
import { useSelectionStore } from '@/stores/selection'
import { useObjectTreeStore } from '@/stores/objectTree'
import { useObjectTreeUiStore } from '@/stores/objectTreeUi'
import type { TrackId } from '@/types'
import { NColorPicker } from 'naive-ui'

const props = defineProps<{ trackId: TrackId }>()
const emit = defineEmits<{ addTextSegment: [] }>()

const tracks = useTracksStore()
const selection = useSelectionStore()
const objectTree = useObjectTreeStore()
const objectTreeUi = useObjectTreeUiStore()

const track = computed(() => tracks.tracks[props.trackId])

const editing = ref(false)
const editName = ref('')
const showMenu = ref(false)
const menuX = ref(0)
const menuY = ref(0)

function handleClick(e: MouseEvent) {
  if (e.altKey) {
    e.preventDefault()
    if (track.value) track.value.ignored = !track.value.ignored
    return
  }
  if (e.ctrlKey || e.metaKey) {
    objectTreeUi.clearSelection()
    selection.select(props.trackId, true)
  } else {
    objectTreeUi.clearSelection()
    selection.select(props.trackId, false)
  }
}

function handleDblClick() {
  if (!track.value) return
  editName.value = track.value.name
  editing.value = true
  nextTick(() => {
    const el = document.querySelector('.track-name-input') as HTMLInputElement
    el?.focus()
    el?.select()
  })
}

function finishRename() {
  const name = editName.value.trim()
  if (name && track.value) {
    tracks.renameTrack(props.trackId, name)
    objectTree.syncTrackFolderName(props.trackId, name)
  }
  editing.value = false
}

function cancelRename() {
  editing.value = false
}

function toggleMute() {
  if (track.value) {
    track.value.muted = !track.value.muted
    if (track.value.solo && track.value.muted) track.value.solo = false
  }
}

function toggleSolo() {
  if (track.value) {
    const nextSolo = !track.value.solo
    for (const tid of tracks.trackOrder) {
      const other = tracks.tracks[tid]
      if (other) other.solo = false
    }
    track.value.solo = nextSolo
    if (track.value.muted && track.value.solo) track.value.muted = false
  }
}

function moveTrack(delta: -1 | 1) {
  const from = tracks.trackOrder.indexOf(props.trackId)
  const to = from + delta
  if (from < 0 || to < 0 || to >= tracks.trackOrder.length) return
  tracks.reorderTracks(from, to)
  objectTree.syncTrackFolderOrder([...tracks.trackOrder])
}

function setTrackColor(color: string) {
  tracks.setTrackColor(props.trackId, color)
  objectTree.syncTrackFolderColor(props.trackId, color)
}

function handleContextMenu(e: MouseEvent) {
  e.preventDefault()
  menuX.value = e.clientX
  menuY.value = e.clientY
  showMenu.value = true
  // Delay listener so the current right-click doesn't immediately close the menu
  setTimeout(() => window.addEventListener('click', closeMenu, { once: true }), 0)
}

function closeMenu() { showMenu.value = false }

function deleteTrack() {
  showMenu.value = false
  objectTree.syncDeletedTrack(props.trackId)
  tracks.removeTrack(props.trackId)
}

function startRename() {
  showMenu.value = false
  handleDblClick()
}

function setVolume(v: number | null) {
  if (track.value && v != null) {
    track.value.volume = Math.max(0, Math.min(2, Math.round(v * 20) / 20))
  }
}
</script>

<template>
  <div
    v-if="track"
    class="track-header"
    :style="{ borderLeftColor: track.color }"
    @mousedown.stop
    @click="handleClick"
    @contextmenu.prevent="handleContextMenu"
  >
    <div class="track-header-inner">
      <div class="track-name" v-if="!editing" :title="track.name" @dblclick.stop="handleDblClick">{{ track.name }}</div>
      <input
        v-else
        v-model="editName"
        class="track-name-input"
        maxlength="40"
        @keyup.enter="finishRename"
        @keyup.escape="cancelRename"
        @blur="finishRename"
        @click.stop
      />
      <div class="track-color-bar" :style="{ background: track.color }" />
      <div class="track-controls">
        <button class="ctrl-btn" :class="{ active: track.muted }" title="静音 (M)" @click.stop="toggleMute">M</button>
        <button class="ctrl-btn" :class="{ active: track.solo }" title="独奏 (S)" @click.stop="toggleSolo">S</button>
        <button v-if="track.trackType === 'text'" class="ctrl-btn icon-ctrl" title="新增句子" @click.stop="emit('addTextSegment')"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7.25 2h1.5v5.25H14v1.5H8.75V14h-1.5V8.75H2v-1.5h5.25V2Z" /></svg></button>
        <button class="ctrl-btn icon-ctrl" title="上移音轨" :disabled="tracks.trackOrder[0] === trackId" @click.stop="moveTrack(-1)"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3 3.5 8h3v5h3V8h3L8 3Z" /></svg></button>
        <button class="ctrl-btn icon-ctrl" title="下移音轨" :disabled="tracks.trackOrder[tracks.trackOrder.length - 1] === trackId" @click.stop="moveTrack(1)"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13 3.5 8h3V3h3v5h3L8 13Z" /></svg></button>
      </div>
      <div class="track-volume">
        <input
          type="range"
          class="vol-slider"
          min="0" max="200" :value="Math.round(track.volume * 100)"
          @input="setVolume(($event.target as HTMLInputElement).valueAsNumber / 100)"
          @click.stop
        />
        <span class="vol-val">{{ Math.round(track.volume * 100) }}%</span>
      </div>
      <div class="track-meta">
        <span class="meta-item" v-if="track.ignored" title="已忽视"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13ZM4.6 5.5a5 5 0 0 0 5.9 5.9L4.6 5.5Zm6.8 5a5 5 0 0 0-5.9-5.9l5.9 5.9Z" /></svg></span>
      </div>
      <div class="f0-progress" v-if="track.f0Total > 0 && track.f0Pending > 0">
        <div class="f0-progress-bar" :style="{ width: ((track.f0Total - track.f0Pending) / track.f0Total * 100) + '%' }" />
        <span class="f0-progress-text">{{ track.f0Total - track.f0Pending }}/{{ track.f0Total }} F0</span>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="showMenu" class="ctx-menu" :style="{ left: menuX + 'px', top: menuY + 'px' }" @click.stop>
        <div class="ctx-item" @click="startRename"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11.9 1.8 14.2 4 5.6 12.6 2.8 13.2l.6-2.8 8.5-8.6ZM3 14h10v1H3v-1Z" /></svg>重命名</div>
        <div class="ctx-color">
          <span>音轨颜色</span>
          <n-color-picker :value="track.color" size="small" :show-alpha="false" @update:value="setTrackColor" />
        </div>
        <div class="ctx-item ctx-danger" @click="deleteTrack"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 2h3l.5 1H13v1H3V3h3l.5-1ZM4 5h8l-.5 9h-7L4 5Z" /></svg>删除音轨</div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.track-header {
  width: 130px;
  flex-shrink: 0;
  background: var(--app-panel);
  border-left: 3px solid var(--app-accent);
  border-right: 1px solid var(--app-border);
  display: flex;
  flex-direction: column;
  user-select: none;
  cursor: default;
  position: sticky;
  left: 0;
  z-index: 2;
}
.track-header-inner {
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}
.track-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--app-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.track-name-input {
  font-size: 13px;
  font-weight: 500;
  background: var(--app-surface);
  border: 1px solid var(--app-accent);
  border-radius: 3px;
  color: var(--app-text);
  padding: 2px 4px;
  outline: none;
  width: 100%;
}
.track-color-bar {
  height: 3px;
  border-radius: 2px;
  margin: 2px 0;
}
.track-controls {
  display: flex;
  gap: 4px;
  margin-top: 2px;
  flex-wrap: wrap;
}
.ctrl-btn {
  width: 22px; height: 18px;
  font-size: 10px; font-weight: 600;
  border: 1px solid var(--app-border); border-radius: 3px;
  background: var(--app-surface); color: var(--app-muted);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  padding: 0;
}
.ctrl-btn:hover { border-color: var(--app-accent); color: var(--app-text); }
.ctrl-btn.active { background: var(--app-accent); color: #fff; border-color: var(--app-accent); }
.ctrl-btn:disabled { opacity: 0.35; cursor: default; }
.icon-ctrl svg { width: 12px; height: 12px; fill: currentColor; }
.track-meta {
  display: flex; gap: 4px; font-size: 10px; margin-top: auto;
}
.meta-item { opacity: 0.6; }
.meta-item svg { width: 12px; height: 12px; fill: currentColor; }

.track-volume {
  display: flex; align-items: center; gap: 3px; margin-top: 2px;
}
.vol-slider {
  width: 60px; height: 4px; cursor: pointer; accent-color: var(--app-accent); margin: 0;
}
.vol-val {
  font-size: 9px; color: var(--app-muted); min-width: 28px; text-align: right;
}

.f0-progress {
  margin-top: 4px; height: 12px;
  background: var(--app-border); border-radius: 6px;
  overflow: hidden; position: relative;
}
.f0-progress-bar {
  height: 100%; background: var(--app-accent); border-radius: 6px;
}
.f0-progress-text {
  position: absolute; top: 0; left: 0; right: 0;
  font-size: 8px; color: var(--app-text);
  text-align: center; line-height: 12px;
}
</style>

<style>
.ctx-menu {
  position: fixed;
  z-index: 9999;
  background: var(--app-panel);
  border: 1px solid var(--app-border);
  border-radius: 6px;
  padding: 4px 0;
  min-width: 120px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
}
.ctx-item {
  padding: 6px 16px;
  font-size: 12px;
  color: var(--app-text);
  cursor: pointer;
  display: flex; align-items: center; gap: 8px;
}
.ctx-item svg {
  width: 13px;
  height: 13px;
  fill: currentColor;
}
.ctx-item:hover { background: var(--app-hover); }
.ctx-danger { color: #f85149; }
.ctx-danger:hover { background: #f8514922; }
.ctx-color {
  padding: 8px 12px;
  display: grid;
  gap: 6px;
  font-size: 12px;
  color: var(--app-text);
}
</style>

<script setup lang="ts">
import { computed, ref, nextTick } from 'vue'
import { useTracksStore } from '@/stores/tracks'
import { useSelectionStore } from '@/stores/selection'
import type { TrackId } from '@/types'

const props = defineProps<{ trackId: TrackId }>()

const tracks = useTracksStore()
const selection = useSelectionStore()

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
    selection.select(props.trackId, true)
  } else {
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
    track.value.solo = !track.value.solo
    if (track.value.muted && track.value.solo) track.value.muted = false
  }
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
        <span class="meta-item" v-if="track.ignored" title="已忽视">🚫</span>
      </div>
      <div class="f0-progress" v-if="track.f0Total > 0 && track.f0Pending > 0">
        <div class="f0-progress-bar" :style="{ width: ((track.f0Total - track.f0Pending) / track.f0Total * 100) + '%' }" />
        <span class="f0-progress-text">{{ track.f0Total - track.f0Pending }}/{{ track.f0Total }} F0</span>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="showMenu" class="ctx-menu" :style="{ left: menuX + 'px', top: menuY + 'px' }" @click.stop>
        <div class="ctx-item" @click="startRename">✏️ 重命名</div>
        <div class="ctx-item ctx-danger" @click="deleteTrack">🗑 删除音轨</div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.track-header {
  width: 130px;
  flex-shrink: 0;
  background: #161b22;
  border-left: 3px solid #58a6ff;
  border-right: 1px solid #21262d;
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
  color: #c9d1d9;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.track-name-input {
  font-size: 13px;
  font-weight: 500;
  background: #0d1117;
  border: 1px solid #58a6ff;
  border-radius: 3px;
  color: #c9d1d9;
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
}
.ctrl-btn {
  width: 22px; height: 18px;
  font-size: 10px; font-weight: 600;
  border: 1px solid #30363d; border-radius: 3px;
  background: #0d1117; color: #484f58;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  padding: 0;
}
.ctrl-btn:hover { border-color: #58a6ff; color: #8b949e; }
.ctrl-btn.active { background: #58a6ff; color: #fff; border-color: #58a6ff; }
.track-meta {
  display: flex; gap: 4px; font-size: 10px; margin-top: auto;
}
.meta-item { opacity: 0.6; }

.track-volume {
  display: flex; align-items: center; gap: 3px; margin-top: 2px;
}
.vol-slider {
  width: 60px; height: 4px; cursor: pointer; accent-color: #58a6ff; margin: 0;
}
.vol-val {
  font-size: 9px; color: #484f58; min-width: 28px; text-align: right;
}

.f0-progress {
  margin-top: 4px; height: 12px;
  background: #21262d; border-radius: 6px;
  overflow: hidden; position: relative;
}
.f0-progress-bar {
  height: 100%; background: #58a6ff; border-radius: 6px;
}
.f0-progress-text {
  position: absolute; top: 0; left: 0; right: 0;
  font-size: 8px; color: #c9d1d9;
  text-align: center; line-height: 12px;
}
</style>

<style>
.ctx-menu {
  position: fixed;
  z-index: 9999;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 6px;
  padding: 4px 0;
  min-width: 120px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
}
.ctx-item {
  padding: 6px 16px;
  font-size: 12px;
  color: #c9d1d9;
  cursor: pointer;
  display: flex; align-items: center; gap: 8px;
}
.ctx-item:hover { background: #1f6feb22; }
.ctx-danger { color: #f85149; }
.ctx-danger:hover { background: #f8514922; }
</style>

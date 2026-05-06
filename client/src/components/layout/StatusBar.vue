<script setup lang="ts">
import { useProjectStore } from '@/stores/project'
import { useTracksStore } from '@/stores/tracks'
import { useSelectionStore } from '@/stores/selection'
import { useHistoryStore } from '@/stores/history'
import { usePlaybackStore } from '@/stores/playback'
import { computed } from 'vue'

const project = useProjectStore()
const tracks = useTracksStore()
const selection = useSelectionStore()
const history = useHistoryStore()
const playback = usePlaybackStore()

const statusText = computed(() => {
  const n = tracks.trackOrder.length
  const segs = tracks.getAllSegments().length
  return `${n} 音轨 · ${segs} 片段 · 缩放 ${project.pxPerSec}px/s`
})

function fmtTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = (s % 60).toFixed(1)
  return `${m}:${sec.padStart(4, '0')}`
}
</script>

<template>
  <div class="statusbar">
    <span class="status-text">{{ statusText }}</span>
    <span class="status-right">
      <span class="playback-time" v-if="playback.isPlaying || playback.currentTime > 0">
        {{ fmtTime(playback.currentTime) }}
        <template v-if="playback.totalDuration > 0"> / {{ fmtTime(playback.totalDuration) }}</template>
      </span>
      <span v-if="selection.count > 0" class="sel-count">已选 {{ selection.count }} 项</span>
      <span class="history-hint">
        {{ history.canUndo ? 'Ctrl+Z 撤销' : '' }}
        {{ history.canRedo ? ' · Ctrl+Y 重做' : '' }}
      </span>
    </span>
  </div>
</template>

<style scoped>
.statusbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 16px;
  background: #161b22;
  border-top: 1px solid #21262d;
  font-size: 11px;
  color: #6e7681;
  flex-shrink: 0;
}
.status-right { display: flex; gap: 16px; }
.playback-time { color: #e94560; font-weight: 500; }
.sel-count { color: #58a6ff; }
.history-hint { color: #484f58; }
</style>

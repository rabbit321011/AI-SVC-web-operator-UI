<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useTracksStore } from '@/stores/tracks'
import { useSelectionStore } from '@/stores/selection'
import { useObjectTreeStore } from '@/stores/objectTree'
import { useObjectTreeUiStore } from '@/stores/objectTreeUi'
import { useMarqueeSelect } from '@/composables/useMarqueeSelect'
import TrackRow from '@/components/track/TrackRow.vue'

const project = useProjectStore()
const tracks = useTracksStore()
const selection = useSelectionStore()
const objectTree = useObjectTreeStore()
const objectTreeUi = useObjectTreeUiStore()
const marquee = useMarqueeSelect()
const notice = ref('')

const scrollRef = ref<HTMLElement | null>(null)

const marqueeStyle = computed(() => {
  const r = marquee.rect.value
  return {
    left: r.x + 'px',
    top: r.y + 'px',
    width: r.w + 'px',
    height: r.h + 'px',
    display: marquee.isDrawing.value ? 'block' : 'none',
  }
})

function handleCanvasClick() {
  objectTreeUi.clearSelection()
  selection.clear()
}

function handleWheel(e: WheelEvent) {
  const el = scrollRef.value
  if (!el) return

  if (e.shiftKey) return

  // Smooth: accumulate deltas, then animate
  const target = el.scrollLeft + e.deltaY * (e.deltaMode === 1 ? 40 : 1) + e.deltaX * (e.deltaMode === 1 ? 40 : 1)

  // Use a cancelable animation for smooth mouse wheel
  const start = performance.now()
  const from = el.scrollLeft
  const duration = 80 // ms for smooth transition
  let frameId = 0

  function step(now: number) {
     const t = Math.min(1, (now - start) / duration)
     const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
     if (el) el.scrollLeft = from + (target - from) * eased
     if (t < 1) frameId = requestAnimationFrame(step)
   }
  cancelAnimationFrame((handleWheel as any)._raf || 0);
  (handleWheel as any)._raf = requestAnimationFrame(step)

  e.preventDefault()
}

function allowDrop(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}

async function handleDrop(e: DragEvent) {
  e.preventDefault()
  const nodeId = e.dataTransfer?.getData('application/x-aisvc-node-id') || e.dataTransfer?.getData('text/plain')
  if (!nodeId) return
  const el = scrollRef.value
  const rect = el?.getBoundingClientRect()
  const timelineStart = rect ? Math.max(0, (e.clientX - rect.left + (el?.scrollLeft ?? 0) - 52) / project.pxPerSec) : 0
  const result = await objectTree.dropAudioObjectToTimeline(nodeId, timelineStart)
  flash(result.ok ? '已加入时间线' : result.reason ?? '无法加入时间线')
  if (result.ok) {
    ;(window as any).__syncProject?.()
  }
}

function flash(message: string) {
  notice.value = message
  window.setTimeout(() => {
    if (notice.value === message) notice.value = ''
  }, 1400)
}

function locateSegment(segmentId: string) {
  const seg = tracks.getSegment(segmentId)
  if (!seg) {
    flash('时间线对象不存在')
    return
  }
  objectTreeUi.clearSelection()
  selection.select(segmentId, false)
  ;(window as any).__playbackSeek?.(seg.timelineStart)

  const el = scrollRef.value
  if (el) {
    el.scrollLeft = Math.max(0, seg.timelineStart * project.pxPerSec - 80)
    document.querySelector(`[data-track-id="${seg.trackId}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  project.bumpRedraw()
}

onMounted(() => {
  ;(window as any).__timelineLocateSegment = locateSegment
})

onUnmounted(() => {
  if ((window as any).__timelineLocateSegment === locateSegment) {
    delete (window as any).__timelineLocateSegment
  }
})
</script>

<template>
  <div class="main-canvas" @mousedown.self="handleCanvasClick">
    <div ref="scrollRef" class="track-scroll" @mousedown.self="handleCanvasClick" @wheel.prevent="handleWheel" @dragover="allowDrop" @drop="handleDrop">
      <div class="marquee-overlay" :style="marqueeStyle" />
      <div class="track-list-inner">
        <TrackRow
          v-for="trackId in tracks.trackOrder"
          :key="trackId + '_' + project.loadTick"
          :track-id="trackId"
        />
      </div>
      <div v-if="tracks.trackOrder.length === 0" class="empty-state">
        <div class="empty-icon">🎵</div>
        <div class="empty-text">导入 WAV 文件开始编辑</div>
        <div class="empty-hint">文件 → 导入 WAV，或拖拽音频文件到此处</div>
      </div>
      <div class="canvas-notice">{{ notice }}</div>
    </div>
  </div>
</template>

<style scoped>
.main-canvas {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: #0d1117;
}
.track-scroll {
  flex: 1;
  overflow: auto;
  position: relative;
}
.marquee-overlay {
  position: absolute;
  pointer-events: none;
  z-index: 10;
  border: 1px solid rgba(88, 166, 255, 0.6);
  background: rgba(88, 166, 255, 0.08);
}
.track-list-inner {
  width: max-content;
  min-width: 100%;
}
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
}
.empty-icon { font-size: 48px; opacity: 0.3; }
.empty-text { font-size: 16px; color: #8b949e; }
.empty-hint { font-size: 13px; color: #484f58; }
.canvas-notice {
  position: sticky;
  left: 12px;
  bottom: 10px;
  width: fit-content;
  min-height: 20px;
  padding: 2px 8px;
  font-size: 12px;
  color: #f0b72f;
  pointer-events: none;
}
</style>

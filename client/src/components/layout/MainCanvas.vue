<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useTracksStore } from '@/stores/tracks'
import { useSelectionStore } from '@/stores/selection'
import { useObjectTreeStore } from '@/stores/objectTree'
import { useObjectTreeUiStore } from '@/stores/objectTreeUi'
import { useEditorWorkspaceStore } from '@/stores/editorWorkspace'
import { useMarqueeSelect } from '@/composables/useMarqueeSelect'
import TrackRow from '@/components/track/TrackRow.vue'

const project = useProjectStore()
const tracks = useTracksStore()
const selection = useSelectionStore()
const objectTree = useObjectTreeStore()
const objectTreeUi = useObjectTreeUiStore()
const editorWorkspace = useEditorWorkspaceStore()
const marquee = useMarqueeSelect()
const notice = ref('')

const scrollRef = ref<HTMLElement | null>(null)
let scrollSyncRaf = 0

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

  if (e.ctrlKey) {
    el.scrollTop += (e.deltaY || e.deltaX) * (e.deltaMode === 1 ? 40 : 1)
    e.preventDefault()
    return
  }

  const unit = e.deltaMode === 1 ? 40 : 1
  const speed = e.altKey ? 3 : 1
  el.scrollLeft += (e.deltaY * unit + e.deltaX * unit) * speed

  e.preventDefault()
}

function handleScroll() {
  const el = scrollRef.value
  if (!el) return
  if (scrollSyncRaf) return
  scrollSyncRaf = requestAnimationFrame(() => {
    scrollSyncRaf = 0
    const current = scrollRef.value
    if (current) editorWorkspace.setTimelineScroll(current.scrollLeft, current.scrollTop)
  })
}

function restoreTimelineScroll() {
  const el = scrollRef.value
  if (!el) return
  el.scrollLeft = editorWorkspace.timelineScroll.left
  el.scrollTop = editorWorkspace.timelineScroll.top
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
    editorWorkspace.setTimelineScroll(el.scrollLeft, el.scrollTop)
  }
  project.bumpRedraw()
}

function locateTrackObject(trackObjectId: string) {
  const node = objectTree.node(trackObjectId)
  if (!node || node.kind !== 'trackObject') {
    flash('时间线对象不存在')
    return
  }
  objectTreeUi.clearSelection()
  selection.select(trackObjectId, false)
  ;(window as any).__playbackSeek?.(node.trackObject.timelineStart)

  const el = scrollRef.value
  if (el) {
    el.scrollLeft = Math.max(0, node.trackObject.timelineStart * project.pxPerSec - 80)
    const parentId = objectTree.index.parentById[trackObjectId]
    const trackId = parentId?.startsWith('node:trackFolder:') ? parentId.slice('node:trackFolder:'.length) : null
    if (trackId) document.querySelector(`[data-track-id="${trackId}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    editorWorkspace.setTimelineScroll(el.scrollLeft, el.scrollTop)
  }
  project.bumpRedraw()
}

onMounted(() => {
  ;(window as any).__timelineLocateSegment = locateSegment
  ;(window as any).__timelineLocateTrackObject = locateTrackObject
  nextTick(restoreTimelineScroll)
})

onUnmounted(() => {
  if (scrollSyncRaf) cancelAnimationFrame(scrollSyncRaf)
  if ((window as any).__timelineLocateSegment === locateSegment) {
    delete (window as any).__timelineLocateSegment
  }
  if ((window as any).__timelineLocateTrackObject === locateTrackObject) {
    delete (window as any).__timelineLocateTrackObject
  }
})
</script>

<template>
  <div class="main-canvas" @mousedown.self="handleCanvasClick">
    <div ref="scrollRef" class="track-scroll" @mousedown.self="handleCanvasClick" @wheel.prevent="handleWheel" @scroll="handleScroll" @dragover="allowDrop" @drop="handleDrop">
      <div class="marquee-overlay" :style="marqueeStyle" />
      <div class="track-list-inner">
        <TrackRow
          v-for="trackId in tracks.trackOrder"
          :key="trackId + '_' + project.loadTick"
          :track-id="trackId"
        />
      </div>
      <div v-if="tracks.trackOrder.length === 0" class="empty-state">
        <div class="empty-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Zm0 2.3L6 8.7v6.6l6 3.4 6-3.4V8.7l-6-3.4Zm0 3.2a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z" /></svg></div>
        <div class="empty-text">导入 WAV 文件开始编辑</div>
        <div class="empty-hint">文件 / 导入 WAV，或拖拽音频文件到此处</div>
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
  background: color-mix(in srgb, var(--app-surface) var(--center-opacity-percent), transparent);
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
.empty-icon { opacity: 0.3; }
.empty-icon svg { width: 48px; height: 48px; fill: currentColor; }
.empty-text { font-size: 16px; color: var(--app-muted); }
.empty-hint { font-size: 13px; color: var(--app-muted); }
.canvas-notice {
  position: sticky;
  left: 12px;
  bottom: 10px;
  width: fit-content;
  min-height: 20px;
  padding: 2px 8px;
  font-size: 12px;
  color: var(--app-warning, #b7791f);
  pointer-events: none;
}
</style>

import { ref, onMounted, onUnmounted } from 'vue'
import { useSelectionStore } from '@/stores/selection'
import { useTracksStore } from '@/stores/tracks'
import { useProjectStore } from '@/stores/project'
import type { AudioSegment } from '@/types'

export function useMarqueeSelect() {
  const selection = useSelectionStore()
  const tracks = useTracksStore()
  const project = useProjectStore()

  const tabHeld = ref(false)
  const isDrawing = ref(false)
  const rect = ref({ x: 0, y: 0, w: 0, h: 0 })
  const startPoint = ref({ x: 0, y: 0 })

  function keydown(e: KeyboardEvent) {
    if (e.key === 'Tab') {
      e.preventDefault()
      tabHeld.value = true
    }
  }

  function keyup(e: KeyboardEvent) {
    if (e.key === 'Tab') {
      tabHeld.value = false
      if (isDrawing.value) {
        finishRect()
      }
    }
  }

  function mousedown(e: MouseEvent) {
    if (!tabHeld.value) return
    const el = e.target as HTMLElement
    if (el.closest('.track-scroll') || el.closest('canvas')) {
      isDrawing.value = true
      const scrollEl = document.querySelector('.track-scroll') as HTMLElement | null
      if (!scrollEl) return
      const cr = scrollEl.getBoundingClientRect()
      startPoint.value = {
        x: e.clientX - cr.left + scrollEl.scrollLeft,
        y: e.clientY - cr.top + scrollEl.scrollTop,
      }
      rect.value = { x: startPoint.value.x, y: startPoint.value.y, w: 0, h: 0 }
      e.preventDefault()
    }
  }

  function mousemove(e: MouseEvent) {
    if (!isDrawing.value) return
    const scrollEl = document.querySelector('.track-scroll') as HTMLElement | null
    if (!scrollEl) return
    const cr = scrollEl.getBoundingClientRect()
    const cx = e.clientX - cr.left + scrollEl.scrollLeft
    const cy = e.clientY - cr.top + scrollEl.scrollTop
    rect.value = {
      x: Math.min(startPoint.value.x, cx),
      y: Math.min(startPoint.value.y, cy),
      w: Math.abs(cx - startPoint.value.x),
      h: Math.abs(cy - startPoint.value.y),
    }
  }

  function mouseup() {
    if (!isDrawing.value) return
    finishRect()
  }

  function finishRect() {
    if (rect.value.w < 5 || rect.value.h < 5) {
      isDrawing.value = false
      rect.value = { x: 0, y: 0, w: 0, h: 0 }
      return
    }

    const allSegs = tracks.getAllSegments()
    const hitIds: string[] = []

    const PAD_L = 52
    const PAD_T = 8
    const CHART_H = 100
    const PAD_B = 20
    const SEG_H = 16
    const CANVAS_H = PAD_T + CHART_H + PAD_B + SEG_H + 6

    for (const seg of allSegs) {
      const track = tracks.tracks[seg.trackId]
      if (!track) continue
      const trackIdx = tracks.trackOrder.indexOf(seg.trackId)
      if (trackIdx < 0) continue

      const segX = PAD_L + seg.timelineStart * project.pxPerSec
      const segW = Math.max(3, (seg.timelineEnd - seg.timelineStart) * project.pxPerSec)
      const segY = trackIdx * CANVAS_H + PAD_T + CHART_H + PAD_B
      const segH = SEG_H

      // check intersection
      if (segX + segW > rect.value.x && segX < rect.value.x + rect.value.w &&
          segY + segH > rect.value.y && segY < rect.value.y + rect.value.h) {
        hitIds.push(seg.id)
      }
    }

    if (hitIds.length > 0) {
      selection.selectAll(hitIds, 'segments')
    }

    isDrawing.value = false
    rect.value = { x: 0, y: 0, w: 0, h: 0 }
  }

  onMounted(() => {
    document.addEventListener('keydown', keydown)
    document.addEventListener('keyup', keyup)
    document.addEventListener('mousedown', mousedown)
    document.addEventListener('mousemove', mousemove)
    document.addEventListener('mouseup', mouseup)
  })

  onUnmounted(() => {
    document.removeEventListener('keydown', keydown)
    document.removeEventListener('keyup', keyup)
    document.removeEventListener('mousedown', mousedown)
    document.removeEventListener('mousemove', mousemove)
    document.removeEventListener('mouseup', mouseup)
  })

  return { isDrawing, rect }
}

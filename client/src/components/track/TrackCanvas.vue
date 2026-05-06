<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useTracksStore } from '@/stores/tracks'
import { useSelectionStore } from '@/stores/selection'
import { useHistoryStore } from '@/stores/history'
import { usePlaybackStore } from '@/stores/playback'
import type { TrackId, AudioSegment, F0Frame } from '@/types'
import { buildSplitCommand } from '@/commands/split'

const props = defineProps<{ trackId: TrackId }>()

const project = useProjectStore()
const tracks = useTracksStore()
const selection = useSelectionStore()
const playback = usePlaybackStore()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)

const PAD_L = 52
const PAD_R = 30
const PAD_T = 8
const PAD_B = 20
const CHART_H = 100
const SEG_H = 16
const CANVAS_H = PAD_T + CHART_H + PAD_B + SEG_H + 6

const track = computed(() => tracks.tracks[props.trackId])
const segments = computed(() => tracks.getTrackSegments(props.trackId))

const totalDuration = computed(() => {
  const segs = segments.value
  if (segs.length > 0) {
    return Math.max(...segs.map(s => s.timelineEnd))
  }
  const allSegs = tracks.getAllSegments()
  if (allSegs.length > 0) {
    return Math.max(...allSegs.map(s => s.timelineEnd))
  }
  return 10
})

const totalW = computed(() => {
  return PAD_L + totalDuration.value * project.pxPerSec + PAD_R
})

function freqToY(f: number): number {
  if (f <= 0) return -1
  const fmin = project.f0Settings.fmin
  const fmax = project.f0Settings.fmax
  const r = (Math.log2(f) - Math.log2(fmin)) / (Math.log2(fmax) - Math.log2(fmin))
  return PAD_T + CHART_H * (1 - Math.max(0, Math.min(1, r)))
}

function timeToX(t: number): number {
  return PAD_L + t * project.pxPerSec
}

function xToTime(x: number): number {
  return (x - PAD_L) / project.pxPerSec
}

function setupCanvas() {
  const canvas = canvasRef.value
  if (!canvas) return
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(totalW.value * dpr)
  canvas.height = Math.round(CANVAS_H * dpr)
  canvas.style.width = totalW.value + 'px'
  canvas.style.height = CANVAS_H + 'px'
}

function draw() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')!
  const dpr = window.devicePixelRatio || 1
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, totalW.value, CANVAS_H)

  const W = totalW.value

  // BG
  ctx.fillStyle = '#0d1117'
  ctx.fillRect(0, 0, W, CANVAS_H)

  // Chart area
  ctx.fillStyle = '#0f1419'
  ctx.fillRect(PAD_L, PAD_T, W - PAD_L - PAD_R, CHART_H)

  // F0 grid lines
  const gridMidi = [48, 55, 60, 67, 72, 79, 84]
  for (const midi of gridMidi) {
    const f = 440 * Math.pow(2, (midi - 69) / 12)
    const y = freqToY(f)
    if (y < PAD_T || y > PAD_T + CHART_H) continue
    ctx.strokeStyle = midi % 12 === 0 ? '#21262d' : '#161b22'
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(PAD_L, y)
    ctx.lineTo(W - PAD_R, y)
    ctx.stroke()
  }

  // F0 curves per segment
  for (const seg of segments.value) {
    if (!seg.f0Data || seg.f0Data.length < 2) continue
    const f0data = seg.f0Data
    // only voiced regions
    let drawing = false
    ctx.beginPath()
    ctx.strokeStyle = seg.ignored ? 'rgba(88,166,255,0.15)' : 'rgba(88,166,255,0.7)'
    ctx.lineWidth = 2
    for (const frame of f0data) {
      const t = seg.timelineStart + frame.t
      const x = timeToX(t)
      if (frame.freq > 0) {
        const y = freqToY(frame.freq)
        if (!drawing) { ctx.moveTo(x, y); drawing = true }
        else ctx.lineTo(x, y)
      } else {
        drawing = false
      }
    }
    ctx.stroke()

    // glow
    drawing = false
    ctx.beginPath()
    ctx.strokeStyle = 'rgba(88,166,255,0.08)'
    ctx.lineWidth = 5
    for (const frame of f0data) {
      const t = seg.timelineStart + frame.t
      const x = timeToX(t)
      if (frame.freq > 0) {
        const y = freqToY(frame.freq)
        if (!drawing) { ctx.moveTo(x, y); drawing = true }
        else ctx.lineTo(x, y)
      } else {
        drawing = false
      }
    }
    ctx.stroke()
  }

  // Segment blocks
  const segAreaTop = PAD_T + CHART_H + PAD_B
  const trackMuted = track.value?.muted ?? false
  for (const seg of segments.value) {
    const x = timeToX(seg.timelineStart)
    const w = Math.max(3, seg.timelineEnd * project.pxPerSec - seg.timelineStart * project.pxPerSec)
    const y = segAreaTop
    const isSel = selection.isSelected(seg.id)

    let alpha = 0.5
    if (seg.ignored) alpha = 0.2
    else if (trackMuted) alpha = 0.25

    ctx.fillStyle = seg.ignored
      ? 'rgba(100,100,100,0.2)'
      : hexToRgba(seg.color, alpha)

    roundRect(ctx, x, y, w, SEG_H, 3)
    ctx.fill()

    if (isSel) {
      ctx.strokeStyle = '#58a6ff'
      ctx.lineWidth = 2
      ctx.shadowColor = 'rgba(88,166,255,0.4)'
      ctx.shadowBlur = 4
      roundRect(ctx, x, y, w, SEG_H, 3)
      ctx.stroke()
      ctx.shadowBlur = 0
    }
  }

  // Time labels every N seconds
  const step = project.pxPerSec > 120 ? 1 : project.pxPerSec > 60 ? 2 : project.pxPerSec > 30 ? 5 : 10
  for (let t = 0; t <= totalDuration.value; t += step) {
    const x = timeToX(t)
    ctx.strokeStyle = '#161b22'
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, CANVAS_H)
    ctx.stroke()
  }

  // Playhead line
  if (playback.isPlaying || playback.currentTime > 0) {
    const px = timeToX(playback.currentTime)
    if (px >= PAD_L && px <= W - PAD_R) {
      ctx.strokeStyle = '#e94560'
      ctx.lineWidth = 2
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(px, 0)
      ctx.lineTo(px, CANVAS_H)
      ctx.stroke()
    }
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function findSegmentAt(cx: number, cy: number): AudioSegment | null {
  const t = xToTime(cx)
  const segAreaTop = PAD_T + CHART_H + PAD_B
  if (cy < segAreaTop || cy > segAreaTop + SEG_H) return null
  for (const seg of segments.value) {
    if (t >= seg.timelineStart && t <= seg.timelineEnd) return seg
  }
  return null
}

function handleClick(e: MouseEvent) {
  const canvas = canvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const cx = e.clientX - rect.left
  const cy = e.clientY - rect.top

  if (e.altKey) {
    const seg = findSegmentAt(cx, cy)
    if (seg) { seg.ignored = !seg.ignored; draw(); }
    return
  }

  if (e.shiftKey) {
    // split
    const t = xToTime(cx)
    handleSplit(t)
    return
  }

  const seg = findSegmentAt(cx, cy)
  if (seg) {
    selection.select(seg.id, e.ctrlKey || e.metaKey)
    draw()
    return
  }
  // click on empty area → seek playhead
  const t = xToTime(cx)
  if (t >= 0) {
    ;(window as any).__playbackSeek?.(t)
  }
}

function handleSplit(cutTime: number) {
  const tstore = useTracksStore()
  const hstore = useHistoryStore()
  for (const seg of segments.value) {
    if (cutTime > seg.timelineStart && cutTime < seg.timelineEnd) {
      const elapsed = cutTime - seg.timelineStart
      const cutSample = Math.round(seg.srcStartSample + elapsed * (track.value?.sampleRate ?? 44100))

      const segAClone = { ...seg }
      const segBClone = { ...seg }

      // slice f0Data so each segment only has its own portion
      if (seg.f0Data) {
        const relCut = cutTime - seg.timelineStart
        const cutIdx = seg.f0Data.findIndex(f => seg.timelineStart + f.t >= cutTime)
        if (cutIdx > 0) {
          segAClone.f0Data = seg.f0Data.slice(0, cutIdx)
          segBClone.f0Data = seg.f0Data.slice(cutIdx).map(f => ({ ...f, t: f.t - relCut }))
        } else if (cutIdx === 0) {
          segAClone.f0Data = []
          segBClone.f0Data = seg.f0Data.map(f => ({ ...f, t: f.t - relCut }))
        }
      }

      const segA: AudioSegment = {
        ...segAClone,
        id: tstore.makeSegmentId(),
        srcEndSample: cutSample,
        timelineEnd: cutTime,
      }
      const segB: AudioSegment = {
        ...segBClone,
        id: tstore.makeSegmentId(),
        srcStartSample: cutSample,
        timelineStart: cutTime,
      }

      const oldSegSnapshot = { ...seg }

      tstore.replaceSegments(props.trackId, [seg.id], [segA, segB])

      const cmd = buildSplitCommand(
        { trackId: props.trackId, segment: oldSegSnapshot, cutTime, sampleRate: track.value?.sampleRate ?? 44100 },
        segA, segB
      )
      hstore.push(cmd)

      break
    }
  }
  draw()
}

const isDragging = ref(false)
const dragStartClientX = ref(0)
const dragSegments: Array<{ seg: AudioSegment; origStart: number; origEnd: number }> = []

function onDragMove(e: MouseEvent) {
  if (!isDragging.value) return
  const dx = e.clientX - dragStartClientX.value
  const dt = dx / project.pxPerSec

  // detect which track the mouse is over (cross-track drag)
  const elem = document.elementFromPoint(e.clientX, e.clientY)
  const trackRow = elem?.closest('[data-track-id]') as HTMLElement | null
  if (trackRow) {
    const targetTrackId = trackRow.dataset.trackId
    if (targetTrackId) {
      for (const { seg } of dragSegments) {
        if (seg.trackId !== targetTrackId) {
          const oldTrack = tracks.tracks[seg.trackId]
          if (oldTrack) {
            oldTrack.segments = oldTrack.segments.filter(s => s !== seg.id)
          }
          seg.trackId = targetTrackId as TrackId
          seg.color = tracks.tracks[targetTrackId]?.color ?? seg.color
          const newTrack = tracks.tracks[targetTrackId]
          if (newTrack && !newTrack.segments.includes(seg.id)) {
            newTrack.segments.push(seg.id)
          }
          project.bumpRedraw()
        }
      }
    }
  }

  for (const { seg, origStart, origEnd } of dragSegments) {
    seg.timelineStart = Math.max(0, origStart + dt)
    seg.timelineEnd = Math.max(0.01, origEnd + dt)
  }
  draw()
}

function onDragEnd() {
  if (!isDragging.value) return
  isDragging.value = false
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
  import('@/commands/move').then(m => {
    const history = useHistoryStore()
    const cmd = m.buildMoveCommand(dragSegments)
    history.push(cmd)
  })
}

function handleMousedown(e: MouseEvent) {
  const canvas = canvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const cx = e.clientX - rect.left
  const cy = e.clientY - rect.top

  const seg = findSegmentAt(cx, cy)
  if (!seg) return

  if ((e.ctrlKey || e.metaKey) && selection.isSelected(seg.id)) {
    isDragging.value = true
    dragStartClientX.value = e.clientX
    dragSegments.length = 0
    for (const sid of selection.ids) {
      const s = tracks.getSegment(sid)
      if (s) {
        dragSegments.push({ seg: s, origStart: s.timelineStart, origEnd: s.timelineEnd })
      }
    }
    document.addEventListener('mousemove', onDragMove)
    document.addEventListener('mouseup', onDragEnd)
    e.preventDefault()
    e.stopPropagation()
  }
}

function handleMousemove(e: MouseEvent) {
  const canvas = canvasRef.value
  if (!canvas || isDragging.value) return
  const rect = canvas.getBoundingClientRect()
  const cx = e.clientX - rect.left
  const cy = e.clientY - rect.top

  const seg = findSegmentAt(cx, cy)
  canvas.style.cursor = seg ? 'pointer' : 'default'
}

// Watch for changes and redraw
watch(() => [
  project.pxPerSec,
  totalDuration.value,
  segments.value.length,
  segments.value,
  selection.ids,
  playback.currentTime,
  project.redrawTick,
], () => {
  nextTick(() => { setupCanvas(); draw(); })
}, { deep: true })

onMounted(() => {
  nextTick(() => { setupCanvas(); draw(); })
})
</script>

<template>
  <div ref="containerRef" class="track-canvas-wrap">
    <canvas
      ref="canvasRef"
      @click="handleClick"
      @mousedown="handleMousedown"
      @mousemove="handleMousemove"
    />
  </div>
</template>

<style scoped>
.track-canvas-wrap {
  flex-shrink: 0;
  overflow: hidden;
}
canvas {
  display: block;
}
</style>

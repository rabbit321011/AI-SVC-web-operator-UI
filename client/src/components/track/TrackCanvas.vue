<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useTracksStore } from '@/stores/tracks'
import { useSelectionStore } from '@/stores/selection'
import { useHistoryStore } from '@/stores/history'
import { usePlaybackStore } from '@/stores/playback'
import { useObjectTreeStore } from '@/stores/objectTree'
import { useObjectTreeUiStore } from '@/stores/objectTreeUi'
import { useUiSettingsStore } from '@/stores/uiSettings'
import { useEditorWorkspaceStore } from '@/stores/editorWorkspace'
import type { TrackId, AudioSegment, F0Frame } from '@/types'
import type { TextObjectNode, TextSegment, TrackObjectNode } from '@/object-workbench'
import { kanaToRomaji, romajiToKana } from '@/utils/kanaRomaji'
import { getAudioBlobMeta } from '@/utils/audioMeta'
import { buildSplitCommand } from '@/commands/split'

const props = defineProps<{ trackId: TrackId }>()

const project = useProjectStore()
const tracks = useTracksStore()
const selection = useSelectionStore()
const playback = usePlaybackStore()
const objectTree = useObjectTreeStore()
const objectTreeUi = useObjectTreeUiStore()
const uiSettings = useUiSettingsStore()
const editorWorkspace = useEditorWorkspaceStore()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const playheadRef = ref<HTMLCanvasElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)

const PAD_L = 52
const PAD_R = 30
const PAD_T = 8
const PAD_B = 20
const CHART_H = 100
const SEG_H = 16
const CANVAS_H = PAD_T + CHART_H + PAD_B + SEG_H + 6
const TEXT_BAR_TOP = PAD_T + 18
const TEXT_BAR_HEIGHT = 66

const selectedTextSegmentId = ref<string | null>(null)
const inlineKanaInput = ref<HTMLInputElement | null>(null)
const inlineEditor = ref<{
  trackObjectId: string
  sourceId: string
  segmentId: string
  originalKana: string
  originalRomaji: string
  beforeTree: ReturnType<typeof objectTree.snapshotTree>
} | null>(null)
const inlineKana = ref('')
const inlineRomaji = ref('')
const composingField = ref<'kana' | 'romaji' | null>(null)

const track = computed(() => tracks.tracks[props.trackId])
const segments = computed(() => tracks.getTrackSegments(props.trackId))
const textTrackObjects = computed(() => {
  if (track.value?.trackType !== 'text') return []
  const folder = objectTree.node(`node:trackFolder:${props.trackId}`)
  if (!folder || folder.kind !== 'trackFolder') return []
  return folder.children
    .map(trackObject => {
      const source = objectTree.node(trackObject.trackObject.sourceObjectId)
      return source?.kind === 'text' ? { trackObject, source } : null
    })
    .filter((item): item is { trackObject: TrackObjectNode; source: TextObjectNode } => Boolean(item))
})
const textTrackRevision = computed(() => textTrackObjects.value.reduce(
  (revision, item) => revision + objectTree.textRevision(item.source.id),
  0,
))

const totalDuration = computed(() => {
  if (track.value?.trackType === 'text') {
    const maxTextEnd = Math.max(0, ...textTrackObjects.value.map(item => item.trackObject.trackObject.timelineEnd))
    return Math.max(10, maxTextEnd)
  }
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

  // Sync playhead overlay
  const ph = playheadRef.value
  if (ph) {
    ph.width = canvas.width
    ph.height = canvas.height
    ph.style.width = canvas.style.width
    ph.style.height = canvas.style.height
  }
}

function draw() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')!
  const theme = canvasTheme()
  const dpr = window.devicePixelRatio || 1
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, totalW.value, CANVAS_H)

  const W = totalW.value

  ctx.fillStyle = hexToRgba(theme.surface, theme.canvasAlpha)
  ctx.fillRect(0, 0, W, CANVAS_H)

  ctx.fillStyle = hexToRgba(theme.panel, Math.min(1, theme.canvasAlpha + 0.08))
  ctx.fillRect(PAD_L, PAD_T, W - PAD_L - PAD_R, CHART_H)

  if (track.value?.trackType === 'text') {
    drawTextTrack(ctx, theme)
    drawTimeGrid(ctx, theme)
    return
  }

  const gridMidi = [48, 55, 60, 67, 72, 79, 84]
  for (const midi of gridMidi) {
    const f = 440 * Math.pow(2, (midi - 69) / 12)
    const y = freqToY(f)
    if (y < PAD_T || y > PAD_T + CHART_H) continue
    ctx.strokeStyle = midi % 12 === 0 ? theme.border : theme.subtleBorder
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(PAD_L, y)
    ctx.lineTo(W - PAD_R, y)
    ctx.stroke()
  }

  for (const seg of segments.value) {
    if (!seg.f0Data || seg.f0Data.length < 2) continue
    const f0data = seg.f0Data
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
      ctx.strokeStyle = theme.accent
      ctx.lineWidth = 2
      ctx.shadowColor = 'rgba(88,166,255,0.4)'
      ctx.shadowBlur = 4
      roundRect(ctx, x, y, w, SEG_H, 3)
      ctx.stroke()
      ctx.shadowBlur = 0
    }
  }

  drawTimeGrid(ctx, theme)
}

function drawTimeGrid(ctx: CanvasRenderingContext2D, theme: ReturnType<typeof canvasTheme>) {
  const step = project.pxPerSec > 120 ? 1 : project.pxPerSec > 60 ? 2 : project.pxPerSec > 30 ? 5 : 10
  for (let t = 0; t <= totalDuration.value; t += step) {
    const x = timeToX(t)
    ctx.strokeStyle = theme.subtleBorder
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, CANVAS_H)
    ctx.stroke()
  }
}

function drawTextTrack(ctx: CanvasRenderingContext2D, theme: ReturnType<typeof canvasTheme>) {
  const barTop = TEXT_BAR_TOP
  const barHeight = TEXT_BAR_HEIGHT
  ctx.textBaseline = 'middle'

  for (const item of textTrackObjects.value) {
    const { trackObject, source } = item
    const start = trackObject.trackObject.timelineStart
    const end = trackObject.trackObject.timelineEnd
    const x = timeToX(start)
    const w = Math.max(8, (end - start) * project.pxPerSec)
    const isSel = selection.isSelected(trackObject.id)
    const baseColor = track.value?.color ?? theme.accent
    const textColors = textColorsForSegment(baseColor, theme)

    ctx.fillStyle = hexToRgba(baseColor, trackObject.trackObject.ignored ? 0.18 : 0.34)
    roundRect(ctx, x, barTop, w, barHeight, 5)
    ctx.fill()

    const segments = normalizedTextSegments(source.text.segments, end - start)
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index]
      const sx = timeToX(start + segment.start)
      const sw = Math.max(3, (segment.end - segment.start) * project.pxPerSec)
      ctx.fillStyle = hexToRgba(baseColor, 0.42)
      roundRect(ctx, sx, barTop + 5, sw, barHeight - 10, 4)
      ctx.fill()
      ctx.strokeStyle = hexToRgba(theme.border, 0.9)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(sx, barTop + 6)
      ctx.lineTo(sx, barTop + barHeight - 6)
      ctx.stroke()

      const pad = 5
      ctx.save()
      ctx.beginPath()
      ctx.rect(sx + pad, barTop + 5, Math.max(0, sw - pad * 2), barHeight - 10)
      ctx.clip()
      ctx.font = '13px system-ui, sans-serif'
      drawReadableText(ctx, displayRomaji(segment), sx + pad, barTop + 22, textColors.muted, textColors.outline)
      ctx.font = '15px system-ui, sans-serif'
      drawReadableText(ctx, segment.kana, sx + pad, barTop + 45, textColors.primary, textColors.outline)
      ctx.restore()

      const previous = segments[index - 1]
      const invalidTiming = segment.start < 0
        || segment.end <= segment.start
        || segment.end > end - start + 1e-6
        || Boolean(previous && segment.start < previous.end - 1e-6)
      if (invalidTiming || (!segment.kana.trim() && !segment.romaji.trim())) {
        ctx.strokeStyle = invalidTiming ? '#f85149' : '#d29922'
        ctx.lineWidth = 2
        roundRect(ctx, sx, barTop + 5, sw, barHeight - 10, 4)
        ctx.stroke()
      }

      if (selectedTextSegmentId.value === segment.id && selection.isSelected(trackObject.id)) {
        ctx.strokeStyle = theme.accent
        ctx.lineWidth = 2
        roundRect(ctx, sx, barTop + 3, sw, barHeight - 6, 4)
        ctx.stroke()
        ctx.fillStyle = theme.accent
        ctx.fillRect(sx - 2, barTop + 10, 4, barHeight - 20)
        ctx.fillRect(sx + sw - 2, barTop + 10, 4, barHeight - 20)
      }
    }

    if (isSel) {
      ctx.strokeStyle = theme.accent
      ctx.lineWidth = 2
      roundRect(ctx, x, barTop, w, barHeight, 5)
      ctx.stroke()
      ctx.fillStyle = theme.accent
      ctx.fillRect(x - 2, barTop, 4, 8)
      ctx.fillRect(x - 2, barTop + barHeight - 8, 4, 8)
      ctx.fillRect(x + w - 2, barTop, 4, 8)
      ctx.fillRect(x + w - 2, barTop + barHeight - 8, 4, 8)
    }
  }
}

function displayRomaji(segment: Required<TextSegment>): string {
  if (segment.romaji.includes(' ')) return segment.romaji
  if (segment.kana) return kanaToRomaji(segment.kana)
  return segment.romaji.replace(/([aeiou])/gi, '$1 ').replace(/\s+/g, ' ').trim()
}

function textColorsForSegment(baseColor: string, theme: ReturnType<typeof canvasTheme>) {
  const rgb = parseColor(baseColor)
  if (!rgb) return { primary: '#0d1117', muted: '#30363d', outline: 'rgba(255,255,255,0.72)' }
  const luminance = relativeLuminance(rgb)
  return luminance > 0.32
    ? { primary: '#0d1117', muted: '#30363d', outline: 'rgba(255,255,255,0.75)' }
    : { primary: theme.text, muted: theme.mutedText, outline: 'rgba(0,0,0,0.72)' }
}

function drawReadableText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string, outline: string) {
  ctx.lineWidth = 3
  ctx.lineJoin = 'round'
  ctx.strokeStyle = outline
  ctx.strokeText(text, x, y)
  ctx.fillStyle = fill
  ctx.fillText(text, x, y)
}

function normalizedTextSegments(segments: TextSegment[], fallbackDuration: number): Array<Required<TextSegment>> {
  const sorted = segments
    .map((segment, index) => ({
      id: segment.id || `textseg:local:${index}`,
      start: Math.max(0, segment.start),
      end: segment.end,
      kana: segment.kana,
      romaji: segment.romaji,
    }))
    .sort((a, b) => a.start - b.start)

  return sorted.map((segment, index) => {
    const nextStart = sorted[index + 1]?.start
    const end = Math.max(segment.start + 0.1, segment.end ?? nextStart ?? fallbackDuration)
    return { ...segment, end }
  })
}

function drawPlayhead() {
  const ph = playheadRef.value
  if (!ph) return
  const ctx = ph.getContext('2d')!
  const dpr = window.devicePixelRatio || 1
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, ph.width, ph.height)
  ctx.scale(dpr, dpr)

  if (!playback.isPlaying && playback.currentTime <= 0) return

  const px = timeToX(playback.currentTime)
  const W = totalW.value
  if (px < PAD_L || px > W - PAD_R) return

  ctx.strokeStyle = '#e94560'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(px, 0)
  ctx.lineTo(px, CANVAS_H)
  ctx.stroke()
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

function findTextObjectAt(cx: number, cy: number): { trackObject: TrackObjectNode; source: TextObjectNode } | null {
  const t = xToTime(cx)
  const barTop = TEXT_BAR_TOP
  const barHeight = TEXT_BAR_HEIGHT
  if (cy < barTop || cy > barTop + barHeight) return null
  for (const item of textTrackObjects.value) {
    const start = item.trackObject.trackObject.timelineStart
    const end = item.trackObject.trackObject.timelineEnd
    if (t >= start && t <= end) return item
  }
  return null
}

type TextSegmentHit = {
  trackObject: TrackObjectNode
  source: TextObjectNode
  segment: Required<TextSegment>
  previous?: Required<TextSegment>
  next?: Required<TextSegment>
}

function findTextSegmentAt(cx: number, cy: number): TextSegmentHit | null {
  const item = findTextObjectAt(cx, cy)
  if (!item) return null
  const localTime = xToTime(cx) - item.trackObject.trackObject.timelineStart
  const duration = item.trackObject.trackObject.timelineEnd - item.trackObject.trackObject.timelineStart
  const textSegments = normalizedTextSegments(item.source.text.segments, duration)
  for (let index = textSegments.length - 1; index >= 0; index--) {
    const segment = textSegments[index]
    if (localTime >= segment.start && localTime <= segment.end) {
      return { trackObject: item.trackObject, source: item.source, segment, previous: textSegments[index - 1], next: textSegments[index + 1] }
    }
  }
  return null
}

type TextBoundaryHit = {
  trackObject: TrackObjectNode
  source: TextObjectNode
  segment: Required<TextSegment>
  previous?: Required<TextSegment>
  next?: Required<TextSegment>
  edge: 'left' | 'right'
}

type TextObjectBoundaryHit = {
  trackObject: TrackObjectNode
  source: TextObjectNode
  edge: 'left' | 'right'
}

function findTextObjectBoundaryAt(cx: number, cy: number): TextObjectBoundaryHit | null {
  const barTop = TEXT_BAR_TOP
  const barBottom = barTop + TEXT_BAR_HEIGHT
  const onOuterRail = cy >= barTop && cy <= barBottom && (cy <= barTop + 7 || cy >= barBottom - 7)
  if (!onOuterRail) return null
  const time = xToTime(cx)
  const handleSec = Math.max(0.04, 7 / project.pxPerSec)
  for (const item of textTrackObjects.value) {
    if (!selection.isSelected(item.trackObject.id)) continue
    const start = item.trackObject.trackObject.timelineStart
    const end = item.trackObject.trackObject.timelineEnd
    if (Math.abs(time - start) <= handleSec) return { ...item, edge: 'left' }
    if (Math.abs(time - end) <= handleSec) return { ...item, edge: 'right' }
  }
  return null
}

function findTextBoundaryAt(cx: number, cy: number): TextBoundaryHit | null {
  const item = findTextObjectAt(cx, cy)
  if (!item) return null
  const localTime = xToTime(cx) - item.trackObject.trackObject.timelineStart
  const duration = item.trackObject.trackObject.timelineEnd - item.trackObject.trackObject.timelineStart
  const handleSec = Math.max(0.04, 6 / project.pxPerSec)
  const textSegments = normalizedTextSegments(item.source.text.segments, duration)
  for (let index = 0; index < textSegments.length; index++) {
    const segment = textSegments[index]
    if (Math.abs(localTime - segment.start) <= handleSec) {
      return { trackObject: item.trackObject, source: item.source, segment, previous: textSegments[index - 1], next: textSegments[index + 1], edge: 'left' }
    }
    if (Math.abs(localTime - segment.end) <= handleSec) {
      return { trackObject: item.trackObject, source: item.source, segment, previous: textSegments[index - 1], next: textSegments[index + 1], edge: 'right' }
    }
  }
  return null
}

function handleClick(e: MouseEvent) {
  const canvas = canvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const cx = e.clientX - rect.left
  const cy = e.clientY - rect.top

  if (track.value?.trackType === 'text') {
    if (inlineEditor.value) finishInlineEdit()
    const segmentHit = findTextSegmentAt(cx, cy)
    if (segmentHit) {
      objectTreeUi.clearSelection()
      selection.select(segmentHit.trackObject.id, e.ctrlKey || e.metaKey)
      selectedTextSegmentId.value = segmentHit.segment.id
      draw()
      return
    }
    const item = findTextObjectAt(cx, cy)
    if (item) {
      objectTreeUi.clearSelection()
      selection.select(item.trackObject.id, e.ctrlKey || e.metaKey)
      selectedTextSegmentId.value = null
      draw()
      return
    }
    const t = xToTime(cx)
    if (t >= 0) (window as any).__playbackSeek?.(t)
    return
  }

  if (e.altKey) {
    const seg = findSegmentAt(cx, cy)
    if (seg) { seg.ignored = !seg.ignored; draw(); }
    return
  }

  if (e.shiftKey) {
    const t = xToTime(cx)
    handleSplit(t)
    return
  }

  const seg = findSegmentAt(cx, cy)
  if (seg) {
    objectTreeUi.clearSelection()
    selection.select(seg.id, e.ctrlKey || e.metaKey)
    draw()
    return
  }
  const t = xToTime(cx)
  if (t >= 0) {
    ;(window as any).__playbackSeek?.(t)
  }
}

async function handleSplit(cutTime: number) {
  const tstore = useTracksStore()
  const hstore = useHistoryStore()
  for (const seg of segments.value) {
    if (cutTime > seg.timelineStart && cutTime < seg.timelineEnd) {
      const sourceSampleRate = await sampleRateForSegment(seg)
      const elapsedSamples = Math.round((cutTime - seg.timelineStart) * sourceSampleRate)
      const cutSample = seg.srcStartSample + elapsedSamples
      const snappedCutTime = seg.timelineStart + elapsedSamples / sourceSampleRate
      if (cutSample <= seg.srcStartSample || cutSample >= seg.srcEndSample) return

      const segAClone = { ...seg }
      const segBClone = { ...seg }

      if (seg.f0Data) {
        const relCut = snappedCutTime - seg.timelineStart
        const cutIdx = seg.f0Data.findIndex(f => f.t >= relCut)
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
        timelineEnd: snappedCutTime,
      }
      const segB: AudioSegment = {
        ...segBClone,
        id: tstore.makeSegmentId(),
        srcStartSample: cutSample,
        timelineStart: snappedCutTime,
      }

      const oldSegSnapshot = { ...seg }

      tstore.replaceSegments(props.trackId, [seg.id], [segA, segB])
      const splitSync = objectTree.syncSplitSegment(oldSegSnapshot, [segA, segB])

      const cmd = buildSplitCommand(
        { trackId: props.trackId, segment: oldSegSnapshot, cutTime: snappedCutTime, sampleRate: sourceSampleRate },
        segA, segB
      )
      if (cmd.objectTree?.kind === 'splitSegment') cmd.objectTree.splitSnapshot = splitSync.snapshot
      hstore.push(cmd)

      break
    }
  }
  draw()
}

const isDragging = ref(false)
const dragStartClientX = ref(0)
const dragSegments: Array<{ seg: AudioSegment; origStart: number; origEnd: number; origTrackId: TrackId; origColor: string }> = []
const textBoundaryDrag = ref<{
  hit: TextBoundaryHit
  originalStart: number
  originalEnd: number
  beforeTree: ReturnType<typeof objectTree.snapshotTree>
} | null>(null)
const textSegmentDrag = ref<{
  hit: TextSegmentHit
  startClientX: number
  originalStart: number
  originalEnd: number
  beforeTree: ReturnType<typeof objectTree.snapshotTree>
  moved: boolean
} | null>(null)
const textObjectBoundaryDrag = ref<{
  trackObject: TrackObjectNode
  source: TextObjectNode
  edge: 'left' | 'right'
  originalStart: number
  originalEnd: number
  originalSegments: Array<{ id: string; start: number; end: number }>
  beforeTree: ReturnType<typeof objectTree.snapshotTree>
} | null>(null)

const inlineEditorStyle = computed(() => {
  const editing = inlineEditor.value
  if (!editing) return {}
  const item = textTrackObjects.value.find(candidate => candidate.trackObject.id === editing.trackObjectId)
  if (!item) return {}
  const duration = item.trackObject.trackObject.timelineEnd - item.trackObject.trackObject.timelineStart
  const segment = normalizedTextSegments(item.source.text.segments, duration).find(candidate => candidate.id === editing.segmentId)
  if (!segment) return {}
  const segmentLeft = timeToX(item.trackObject.trackObject.timelineStart + segment.start)
  const desiredWidth = Math.max(320, (segment.end - segment.start) * project.pxPerSec)
  const width = Math.min(desiredWidth, Math.max(220, totalW.value - PAD_R - 8))
  const left = Math.max(PAD_L, Math.min(segmentLeft, totalW.value - PAD_R - width))
  return { left: `${left}px`, top: `${TEXT_BAR_TOP + 3}px`, width: `${width}px` }
})

function activeTextItem() {
  const selected = selection.ids.length === 1 ? selection.ids[0] : null
  return textTrackObjects.value.find(item => item.trackObject.id === selected) ?? textTrackObjects.value[0] ?? null
}

function startInlineEdit(hit: TextSegmentHit) {
  const actual = hit.source.text.segments.find(segment => segment.id === hit.segment.id)
  if (!actual?.id) return
  if (inlineEditor.value) finishInlineEdit()
  objectTreeUi.clearSelection()
  selection.select(hit.trackObject.id, false)
  selectedTextSegmentId.value = actual.id
  inlineKana.value = actual.kana
  inlineRomaji.value = actual.romaji
  inlineEditor.value = {
    trackObjectId: hit.trackObject.id,
    sourceId: hit.source.id,
    segmentId: actual.id,
    originalKana: actual.kana,
    originalRomaji: actual.romaji,
    beforeTree: objectTree.snapshotTree(),
  }
  nextTick(() => {
    inlineKanaInput.value?.focus()
    inlineKanaInput.value?.select()
  })
}

function updateInlineFromKana(value: string) {
  const editing = inlineEditor.value
  if (!editing) return
  inlineKana.value = value
  inlineRomaji.value = kanaToRomaji(value)
  objectTree.updateTextSegmentContent(editing.sourceId, editing.segmentId, { kana: inlineKana.value, romaji: inlineRomaji.value })
}

function updateInlineFromRomaji(value: string) {
  const editing = inlineEditor.value
  if (!editing) return
  inlineRomaji.value = value
  inlineKana.value = romajiToKana(value)
  objectTree.updateTextSegmentContent(editing.sourceId, editing.segmentId, { kana: inlineKana.value, romaji: inlineRomaji.value })
}

function handleInlineInput(field: 'kana' | 'romaji', event: Event) {
  const value = (event.target as HTMLInputElement).value
  if (field === 'kana') inlineKana.value = value
  else inlineRomaji.value = value
  if (composingField.value === field) return
  if (field === 'kana') updateInlineFromKana(value)
  else updateInlineFromRomaji(value)
}

function finishComposition(field: 'kana' | 'romaji', event: CompositionEvent) {
  composingField.value = null
  const value = (event.target as HTMLInputElement).value
  if (field === 'kana') updateInlineFromKana(value)
  else updateInlineFromRomaji(value)
}

function finishInlineEdit() {
  const editing = inlineEditor.value
  if (!editing) return
  const changed = inlineKana.value !== editing.originalKana || inlineRomaji.value !== editing.originalRomaji
  if (changed) {
    useHistoryStore().push({
      description: '编辑文本句子',
      patches: [],
      inversePatches: [],
      objectTree: { kind: 'snapshot', before: editing.beforeTree, after: objectTree.snapshotTree() },
    })
  }
  inlineEditor.value = null
  composingField.value = null
  project.bumpRedraw()
}

function deleteSelectedTextSegment() {
  const item = activeTextItem()
  const segmentId = selectedTextSegmentId.value
  if (!item || !segmentId) return
  const segment = item.source.text.segments.find(candidate => candidate.id === segmentId)
  if (!segment) return
  const beforeTree = objectTree.snapshotTree()
  const result = objectTree.deleteTextSegment(item.source.id, segmentId)
  if (!result.ok) return
  if (inlineEditor.value?.segmentId === segmentId) {
    inlineEditor.value = null
    composingField.value = null
  }
  const remaining = item.source.text.segments
  selectedTextSegmentId.value = remaining[0]?.id ?? null
  useHistoryStore().push({
    description: '删除文本句子',
    patches: [],
    inversePatches: [],
    objectTree: { kind: 'snapshot', before: beforeTree, after: objectTree.snapshotTree() },
  })
  project.bumpRedraw()
  nextTick(draw)
}

function handleInlineFocusOut(event: FocusEvent) {
  const next = event.relatedTarget as Node | null
  const current = event.currentTarget as HTMLElement
  if (!next || !current.contains(next)) finishInlineEdit()
}

function addTextSegment() {
  const item = activeTextItem()
  if (!item) return
  if (inlineEditor.value) finishInlineEdit()
  const duration = Math.max(0.1, item.trackObject.trackObject.timelineEnd - item.trackObject.trackObject.timelineStart)
  const textSegments = normalizedTextSegments(item.source.text.segments, duration)
  const selected = textSegments.find(segment => segment.id === selectedTextSegmentId.value)
  const playheadLocal = playback.currentTime - item.trackObject.trackObject.timelineStart
  const preferredStart = selected?.end ?? (playheadLocal >= 0 && playheadLocal < duration ? playheadLocal : textSegments.at(-1)?.end ?? 0)
  const start = Math.max(0, Math.min(duration - 0.1, preferredStart))
  const end = Math.min(duration, start + 1)
  const beforeTree = objectTree.snapshotTree()
  const result = objectTree.addTextSegment(item.source.id, { start, end, kana: '', romaji: '' })
  if (!result.ok || !result.segmentId) return
  selection.select(item.trackObject.id, false)
  selectedTextSegmentId.value = result.segmentId
  project.bumpRedraw()
  useHistoryStore().push({
    description: '新增文本句子',
    patches: [],
    inversePatches: [],
    objectTree: { kind: 'snapshot', before: beforeTree, after: objectTree.snapshotTree() },
  })
  nextTick(draw)
}

defineExpose({ addTextSegment })

function onTextBoundaryMove(e: MouseEvent) {
  const drag = textBoundaryDrag.value
  const canvas = canvasRef.value
  if (!drag || !canvas) return
  const rect = canvas.getBoundingClientRect()
  const candidate = xToTime(e.clientX - rect.left) - drag.hit.trackObject.trackObject.timelineStart
  const minDuration = 0.1
  let nextStart = drag.originalStart
  let nextEnd = drag.originalEnd

  if (drag.hit.edge === 'left') {
    const min = drag.hit.previous?.end ?? 0
    const max = nextEnd - minDuration
    nextStart = Math.max(min, Math.min(max, candidate))
    if (drag.hit.previous && Math.abs(drag.hit.previous.end - drag.originalStart) < 0.001) {
      objectTree.updateTextSegmentTiming(drag.hit.source.id, drag.hit.previous.id, drag.hit.previous.start, nextStart)
    }
  } else {
    const min = nextStart + minDuration
    const max = drag.hit.next?.start ?? (drag.hit.trackObject.trackObject.timelineEnd - drag.hit.trackObject.trackObject.timelineStart)
    nextEnd = Math.max(min, Math.min(max, candidate))
    if (drag.hit.next && Math.abs(drag.hit.next.start - drag.originalEnd) < 0.001) {
      objectTree.updateTextSegmentTiming(drag.hit.source.id, drag.hit.next.id, nextEnd, drag.hit.next.end)
    }
  }

  objectTree.updateTextSegmentTiming(drag.hit.source.id, drag.hit.segment.id, nextStart, nextEnd)
  project.bumpRedraw()
  draw()
}

async function sampleRateForSegment(seg: AudioSegment): Promise<number> {
  const blob = tracks.sourceBlobs.get(seg.sourceFile) ?? tracks.sourceBlobs.get(seg.trackId)
  if (!blob) return track.value?.sampleRate || 44100
  try {
    const meta = await getAudioBlobMeta(blob)
    return meta.sampleRate || track.value?.sampleRate || 44100
  } catch {
    return track.value?.sampleRate || 44100
  }
}

function onTextBoundaryEnd() {
  const drag = textBoundaryDrag.value
  if (drag) {
    const afterTree = objectTree.snapshotTree()
    useHistoryStore().push({
      description: '调整文本句子边界',
      patches: [],
      inversePatches: [],
      objectTree: { kind: 'snapshot', before: drag.beforeTree, after: afterTree },
    })
  }
  textBoundaryDrag.value = null
  document.removeEventListener('mousemove', onTextBoundaryMove)
  document.removeEventListener('mouseup', onTextBoundaryEnd)
}

function onTextObjectBoundaryMove(e: MouseEvent) {
  const drag = textObjectBoundaryDrag.value
  const canvas = canvasRef.value
  if (!drag || !canvas) return
  const rect = canvas.getBoundingClientRect()
  const candidate = xToTime(e.clientX - rect.left)
  if (drag.edge === 'left') {
    const firstSegmentStart = Math.min(...drag.originalSegments.map(segment => segment.start), drag.originalEnd - drag.originalStart)
    const maxStart = Math.min(drag.originalEnd - 0.1, drag.originalStart + firstSegmentStart)
    const nextStart = Math.max(0, Math.min(maxStart, candidate))
    const delta = nextStart - drag.originalStart
    drag.trackObject.trackObject.timelineStart = nextStart
    for (const segment of drag.originalSegments) {
      objectTree.updateTextSegmentTiming(drag.source.id, segment.id, segment.start - delta, segment.end - delta)
    }
  } else {
    const lastSegmentEnd = Math.max(0.1, ...drag.originalSegments.map(segment => segment.end))
    const minEnd = drag.originalStart + lastSegmentEnd
    drag.trackObject.trackObject.timelineEnd = Math.max(minEnd, candidate)
  }
  project.bumpRedraw()
  draw()
}

function onTextObjectBoundaryEnd() {
  const drag = textObjectBoundaryDrag.value
  if (drag) {
    useHistoryStore().push({
      description: '调整 TextObject 边界',
      patches: [],
      inversePatches: [],
      objectTree: { kind: 'snapshot', before: drag.beforeTree, after: objectTree.snapshotTree() },
    })
  }
  textObjectBoundaryDrag.value = null
  document.removeEventListener('mousemove', onTextObjectBoundaryMove)
  document.removeEventListener('mouseup', onTextObjectBoundaryEnd)
}

function onTextSegmentMove(e: MouseEvent) {
  const drag = textSegmentDrag.value
  if (!drag) return
  const duration = drag.hit.trackObject.trackObject.timelineEnd - drag.hit.trackObject.trackObject.timelineStart
  const segmentDuration = drag.originalEnd - drag.originalStart
  const min = drag.hit.previous?.end ?? 0
  const max = Math.max(min, (drag.hit.next?.start ?? duration) - segmentDuration)
  const delta = (e.clientX - drag.startClientX) / project.pxPerSec
  const nextStart = Math.max(min, Math.min(max, drag.originalStart + delta))
  const nextEnd = nextStart + segmentDuration
  if (Math.abs(nextStart - drag.originalStart) > 0.0005) drag.moved = true
  objectTree.updateTextSegmentTiming(drag.hit.source.id, drag.hit.segment.id, nextStart, nextEnd)
  draw()
}

function onTextSegmentEnd() {
  const drag = textSegmentDrag.value
  if (drag?.moved) {
    useHistoryStore().push({
      description: '平移文本句子',
      patches: [],
      inversePatches: [],
      objectTree: { kind: 'snapshot', before: drag.beforeTree, after: objectTree.snapshotTree() },
    })
  }
  textSegmentDrag.value = null
  document.removeEventListener('mousemove', onTextSegmentMove)
  document.removeEventListener('mouseup', onTextSegmentEnd)
}

function onDragMove(e: MouseEvent) {
  if (!isDragging.value) return
  const dx = e.clientX - dragStartClientX.value
  const dt = dx / project.pxPerSec

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
  const beforeTree = objectTree.snapshotTree()
  objectTree.syncMovedSegments(dragSegments.map(entry => entry.seg))
  const afterTree = objectTree.snapshotTree()
  import('@/commands/move').then(m => {
    const history = useHistoryStore()
    const cmd = m.buildMoveCommand(dragSegments)
    cmd.objectTree = { kind: 'snapshot', before: beforeTree, after: afterTree }
    history.push(cmd)
  })
}

function canvasTheme() {
  const source = containerRef.value ?? document.documentElement
  const style = getComputedStyle(source)
  const surface = cssVar(style, '--app-surface', '#0d1117')
  const panel = cssVar(style, '--app-panel', '#161b22')
  const border = cssVar(style, '--app-border', '#21262d')
  const accent = cssVar(style, '--app-accent', '#58a6ff')
  const text = cssVar(style, '--app-text', '#e6edf3')
  const mutedText = cssVar(style, '--app-muted', '#8b949e')
  const canvasAlpha = Number(style.getPropertyValue('--track-canvas-bg-alpha').trim())
  return {
    surface,
    panel,
    border,
    accent,
    text,
    mutedText,
    canvasAlpha: Number.isFinite(canvasAlpha) ? Math.max(0.2, Math.min(1, canvasAlpha)) : 1,
    subtleBorder: mixHex(surface, border, 0.45),
  }
}

function cssVar(style: CSSStyleDeclaration, name: string, fallback: string): string {
  return style.getPropertyValue(name).trim() || fallback
}

function mixHex(a: string, b: string, amount: number): string {
  const left = parseHex(a)
  const right = parseHex(b)
  if (!left || !right) return b
  const next = left.map((value, index) => Math.round(value * (1 - amount) + right[index] * amount))
  return `rgb(${next[0]},${next[1]},${next[2]})`
}

function parseHex(value: string): [number, number, number] | null {
  const match = value.match(/^#([0-9a-f]{6})$/i)
  if (!match) return null
  return [
    parseInt(match[1].slice(0, 2), 16),
    parseInt(match[1].slice(2, 4), 16),
    parseInt(match[1].slice(4, 6), 16),
  ]
}

function parseColor(value: string): [number, number, number] | null {
  const hex = parseHex(value)
  if (hex) return hex
  const rgb = value.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/i)
  if (!rgb) return null
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [rs, gs, bs] = [r, g, b].map(channel => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
}

function handleMousedown(e: MouseEvent) {
  const canvas = canvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const cx = e.clientX - rect.left
  const cy = e.clientY - rect.top

  if (track.value?.trackType === 'text') {
    const objectBoundary = findTextObjectBoundaryAt(cx, cy)
    if (objectBoundary) {
      if (inlineEditor.value) finishInlineEdit()
      const originalSegments = objectBoundary.source.text.segments
        .filter((segment): segment is TextSegment & { id: string } => Boolean(segment.id))
        .map(segment => ({ id: segment.id, start: segment.start, end: segment.end ?? segment.start + 0.1 }))
      textObjectBoundaryDrag.value = {
        ...objectBoundary,
        originalStart: objectBoundary.trackObject.trackObject.timelineStart,
        originalEnd: objectBoundary.trackObject.trackObject.timelineEnd,
        originalSegments,
        beforeTree: objectTree.snapshotTree(),
      }
      document.addEventListener('mousemove', onTextObjectBoundaryMove)
      document.addEventListener('mouseup', onTextObjectBoundaryEnd)
      e.preventDefault()
      e.stopPropagation()
      return
    }
    const hit = findTextBoundaryAt(cx, cy)
    const boundaryIsSelected = hit?.segment.id === selectedTextSegmentId.value && selection.isSelected(hit.trackObject.id)
    if (hit && (boundaryIsSelected || e.ctrlKey || e.metaKey)) {
      textBoundaryDrag.value = { hit, originalStart: hit.segment.start, originalEnd: hit.segment.end, beforeTree: objectTree.snapshotTree() }
      document.addEventListener('mousemove', onTextBoundaryMove)
      document.addEventListener('mouseup', onTextBoundaryEnd)
      e.preventDefault()
      e.stopPropagation()
      return
    }
    const segmentHit = findTextSegmentAt(cx, cy)
    if (segmentHit) {
      if (inlineEditor.value) finishInlineEdit()
      objectTreeUi.clearSelection()
      selection.select(segmentHit.trackObject.id, false)
      selectedTextSegmentId.value = segmentHit.segment.id
      textSegmentDrag.value = {
        hit: segmentHit,
        startClientX: e.clientX,
        originalStart: segmentHit.segment.start,
        originalEnd: segmentHit.segment.end,
        beforeTree: objectTree.snapshotTree(),
        moved: false,
      }
      document.addEventListener('mousemove', onTextSegmentMove)
      document.addEventListener('mouseup', onTextSegmentEnd)
      e.preventDefault()
      e.stopPropagation()
      draw()
      return
    }
  }

  const seg = findSegmentAt(cx, cy)
  if (!seg) return

  if ((e.ctrlKey || e.metaKey) && selection.isSelected(seg.id)) {
    isDragging.value = true
    dragStartClientX.value = e.clientX
    dragSegments.length = 0
    for (const sid of selection.ids) {
      const s = tracks.getSegment(sid)
      if (s) {
        dragSegments.push({ seg: s, origStart: s.timelineStart, origEnd: s.timelineEnd, origTrackId: s.trackId, origColor: s.color })
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
  if (!canvas || isDragging.value || textBoundaryDrag.value || textSegmentDrag.value || textObjectBoundaryDrag.value) return
  const rect = canvas.getBoundingClientRect()
  const cx = e.clientX - rect.left
  const cy = e.clientY - rect.top

  if (track.value?.trackType === 'text') {
    if (findTextObjectBoundaryAt(cx, cy)) {
      canvas.style.cursor = 'ew-resize'
      return
    }
    const hit = findTextBoundaryAt(cx, cy)
    if (hit && ((hit.segment.id === selectedTextSegmentId.value && selection.isSelected(hit.trackObject.id)) || e.ctrlKey || e.metaKey)) {
      canvas.style.cursor = 'ew-resize'
      return
    }
    if (findTextSegmentAt(cx, cy)) {
      canvas.style.cursor = 'grab'
      return
    }
  }

  const seg = findSegmentAt(cx, cy)
  if (seg && (e.ctrlKey || e.metaKey)) {
    canvas.style.cursor = 'grab'
  } else {
    canvas.style.cursor = 'default'
  }
}

function handleDblClick(e: MouseEvent) {
  if (track.value?.trackType !== 'text') return
  const canvas = canvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const hit = findTextSegmentAt(e.clientX - rect.left, e.clientY - rect.top)
  if (hit) startInlineEdit(hit)
}

function handleTextKeyboard(e: KeyboardEvent) {
  const item = activeTextItem()
  if (!item || !selection.isSelected(item.trackObject.id)) return
  const target = e.target as HTMLElement | null
  const editingInput = target?.matches('input, textarea, [contenteditable="true"]')
  if ((e.key === 'Delete' || e.key === 'Backspace') && !editingInput && selectedTextSegmentId.value) {
    e.preventDefault()
    e.stopImmediatePropagation()
    deleteSelectedTextSegment()
    return
  }
  if (inlineEditor.value) return
  const ctrl = e.ctrlKey || e.metaKey
  if (ctrl && e.key.toLowerCase() === 'e') {
    e.preventDefault()
    e.stopImmediatePropagation()
    editorWorkspace.openTextObjectTab(item.source.id, item.source.name)
    return
  }
  if (e.key !== 'Enter' || !selectedTextSegmentId.value) return
  const duration = item.trackObject.trackObject.timelineEnd - item.trackObject.trackObject.timelineStart
  const textSegments = normalizedTextSegments(item.source.text.segments, duration)
  const segment = textSegments.find(candidate => candidate.id === selectedTextSegmentId.value)
  if (!segment) return
  e.preventDefault()
  e.stopImmediatePropagation()
  startInlineEdit({ trackObject: item.trackObject, source: item.source, segment })
}

// ── Watch: content redraw only (playhead separated) ──
watch(() => [
  project.pxPerSec,
  uiSettings.settings.theme,
  uiSettings.settings.centerOpacity,
  uiSettings.settings.backgroundImageEnabled,
  uiSettings.settings.backgroundImageUrl,
  totalDuration.value,
  objectTree.tree,
  segments.value.length,
  segments.value,
  selection.ids,
  project.redrawTick,
], () => {
  nextTick(() => { setupCanvas(); draw(); drawPlayhead(); })
})

watch(textTrackRevision, () => {
  nextTick(draw)
})

// ── Seek/stop playhead update (cheap: 1 line clear + 1 line draw) ──
watch(() => playback.currentTime, () => {
  if (!playback.isPlaying) drawPlayhead()
})

// ── Playhead-only loop ──
let playheadRaf: number | null = null
watch(() => playback.isPlaying, (playing) => {
  if (playing) {
    drawPlayhead()
    function loop() {
      if (!playback.isPlaying) { playheadRaf = null; drawPlayhead(); return }
      drawPlayhead()
      playheadRaf = requestAnimationFrame(loop)
    }
    playheadRaf = requestAnimationFrame(loop)
  } else {
    if (playheadRaf) { cancelAnimationFrame(playheadRaf); playheadRaf = null }
    drawPlayhead()
  }
}, { immediate: false })

onMounted(() => {
  document.addEventListener('keydown', handleTextKeyboard, true)
  nextTick(() => { setupCanvas(); draw(); drawPlayhead(); })
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleTextKeyboard, true)
  document.removeEventListener('mousemove', onTextBoundaryMove)
  document.removeEventListener('mouseup', onTextBoundaryEnd)
  document.removeEventListener('mousemove', onTextSegmentMove)
  document.removeEventListener('mouseup', onTextSegmentEnd)
  document.removeEventListener('mousemove', onTextObjectBoundaryMove)
  document.removeEventListener('mouseup', onTextObjectBoundaryEnd)
  if (playheadRaf) cancelAnimationFrame(playheadRaf)
})
</script>

<template>
  <div ref="containerRef" class="track-canvas-wrap">
    <canvas
      ref="canvasRef"
      class="content-canvas"
      @click="handleClick"
      @mousedown="handleMousedown"
      @mousemove="handleMousemove"
      @dblclick="handleDblClick"
    />
    <div
      v-if="inlineEditor"
      class="inline-text-editor"
      :style="inlineEditorStyle"
      @focusout="handleInlineFocusOut"
      @mousedown.stop
      @click.stop
      @keydown.ctrl.enter.prevent="finishInlineEdit"
      @keydown.meta.enter.prevent="finishInlineEdit"
      @keydown.esc.prevent="finishInlineEdit"
    >
      <button type="button" class="inline-delete" title="删除当前句子" @click="deleteSelectedTextSegment">删除句子</button>
      <label><span>Kana</span><input ref="inlineKanaInput" :value="inlineKana" @input="handleInlineInput('kana', $event)" @compositionstart="composingField = 'kana'" @compositionend="finishComposition('kana', $event)" /></label>
      <label><span>Romaji</span><input :value="inlineRomaji" @input="handleInlineInput('romaji', $event)" @compositionstart="composingField = 'romaji'" @compositionend="finishComposition('romaji', $event)" /></label>
    </div>
    <canvas
      ref="playheadRef"
      class="playhead-canvas"
      style="pointer-events: none;"
    />
  </div>
</template>

<style scoped>
.track-canvas-wrap {
  flex-shrink: 0;
  overflow: hidden;
  position: relative;
}
canvas {
  display: block;
}
.content-canvas {
  position: relative;
  z-index: 1;
}
.playhead-canvas {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 2;
}
.inline-text-editor {
  position: absolute;
  z-index: 3;
  height: 60px;
  box-sizing: border-box;
  display: grid;
  grid-template-rows: 1fr 1fr;
  gap: 3px;
  padding: 4px 6px;
  border: 1px solid var(--app-accent);
  border-radius: 4px;
  background: var(--app-panel);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
}
.inline-delete {
  position: absolute;
  top: 3px;
  right: 5px;
  border: 0;
  padding: 1px 4px;
  color: var(--app-danger, #d85b5b);
  background: transparent;
  font-size: 10px;
  cursor: pointer;
}
.inline-text-editor label {
  min-width: 0;
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr);
  align-items: center;
  gap: 5px;
  color: var(--app-muted);
  font-size: 10px;
}
.inline-text-editor input {
  width: 100%;
  min-width: 0;
  height: 22px;
  box-sizing: border-box;
  border: 1px solid var(--app-border);
  border-radius: 3px;
  outline: none;
  background: var(--app-surface);
  color: var(--app-text);
  padding: 2px 6px;
  font: inherit;
  font-size: 12px;
}
.inline-text-editor input:focus { border-color: var(--app-accent); }
</style>

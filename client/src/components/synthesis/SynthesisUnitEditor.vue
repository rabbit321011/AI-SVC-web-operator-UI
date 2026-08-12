<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NButton, NDropdown, NIcon, NInput, NInputNumber, NModal, NRadioButton, NRadioGroup, NSlider } from 'naive-ui'
import { Add, ColorWandOutline, DownloadOutline, EllipsisHorizontal, LinkOutline, MicOutline, MusicalNotesOutline, OpenOutline, Pause, Play, Remove, Stop, UnlinkOutline } from '@vicons/ionicons5'
import { useObjectTreeStore } from '@/stores/objectTree'
import { useGpuRuntimeStore } from '@/stores/gpuRuntime'
import { useTracksStore } from '@/stores/tracks'
import { useHistoryStore } from '@/stores/history'
import { useEditorWorkspaceStore } from '@/stores/editorWorkspace'
import HTokenPicker from './HTokenPicker.vue'
import { V5P_H_TOKEN_BY_ID, type V5PHTokenCatalogEntry } from '@/generated/v5pHTokenCatalog'
import { useSynthesisUnitAnalysis } from '@/composables/useSynthesisUnitAnalysis'
import type { SegmentTextControlTarget } from '@/composables/useSynthesisUnitAnalysis'
import { createSynthesisMaterialSnapshot, getKanaControlRange, type SynthesisHTokenEvent } from '@/object-workbench'
import { runSynthesisV5P } from '@/composables/synthesisV5PClient'
import { kanaToRomaji, romajiToKana } from '@/utils/kanaRomaji'
import { kanaToHTokens } from '@/utils/kanaToHTokens'

const props = defineProps<{ objectId: string }>()
const objectTree = useObjectTreeStore()
const gpuRuntime = useGpuRuntimeStore()
const tracks = useTracksStore()
const history = useHistoryStore()
const editorWorkspace = useEditorWorkspaceStore()
const analysis = useSynthesisUnitAnalysis()

const waveformCanvas = ref<HTMLCanvasElement | null>(null)
const audioElement = ref<HTMLAudioElement | null>(null)
const takeAudioElement = ref<HTMLAudioElement | null>(null)
const referenceAudioElement = ref<HTMLAudioElement | null>(null)
const guideUrl = ref('')
const referenceGuideUrl = ref('')
const takeUrl = ref('')
const waveform = ref<Float32Array | null>(null)
const pxPerFrame = ref(14)
const playheadFrame = ref(0)
const playing = ref(false)
const referencePlaying = ref(false)
const referenceDropActive = ref(false)
const auditionSource = ref<'guide' | 'midi-p' | 'take'>('guide')
const playbackRate = ref(1)
const takeGeneration = ref({ running: false, progress: 0, message: '' })
const forceCapacity = ref(false)
const capacityRetry = ref<'v5p' | 'transcribe' | 'sofa' | 'game'>('v5p')
const capacityDialog = ref<{
  modelId: string
  requiredMiB: number
  freeMiB: number
  insufficient: boolean
  estimate: any
  evictions: Array<{ modelId: string; residentMiB?: number }>
} | null>(null)
const pendingAnalysis = ref<{
  kind: 'transcribe' | 'sofa' | 'game'
  segmentId?: string
  target?: SegmentTextControlTarget
  kanaUnitId?: string
} | null>(null)
const hPicker = ref({ show: false, frame: 0 })
const hoveredHTokenId = ref<number | null>(null)
const hTokenTooltip = ref({ show: false, x: 0, y: 0, frame: 0 })
const hDrag = ref<{
  eventId: string
  sourceFrame: number
  targetFrame: number
  startX: number
} | null>(null)
const statusNotice = ref('')
const segmentMenu = ref({ show: false, x: 0, y: 0, segmentId: '' })
const kanaMenu = ref({ show: false, x: 0, y: 0, kanaUnitId: '' })
type EditorSelection =
  | { type: 'guide' }
  | { type: 'segment', id: string }
  | { type: 'kana', id: string }
  | { type: 'h', frame: number }
  | { type: 'midi-p', frame: number }
  | null
const editorSelection = ref<EditorSelection>({ type: 'guide' })
const selectedSegmentId = computed(() => editorSelection.value?.type === 'segment' ? editorSelection.value.id : '')
const selectedKanaUnitId = computed(() => editorSelection.value?.type === 'kana' ? editorSelection.value.id : '')
const guideMenu = ref({ show: false, x: 0, y: 0 })
const midiGenerationConfirm = ref({ show: false, manualCount: 0 })
const midiEditor = ref({ show: false, frame: 0, midiClass: 120, asFlow: false })
const midiDrag = ref<{
  sourceFrame: number
  targetFrame: number
  sourceClass: number
  targetClass: number
  startX: number
  startY: number
} | null>(null)
const midiMoveConfirm = ref({
  show: false,
  sourceFrame: 0,
  targetFrame: 0,
  targetClass: 120,
})
const alignmentConfirm = ref({
  show: false,
  segmentId: '',
  target: 'kana' as SegmentTextControlTarget,
  startFrame: 0,
  endFrameExclusive: 0,
  objectCount: 0,
  manualCount: 0,
})
const kanaAlignmentConfirm = ref({
  show: false,
  kanaUnitId: '',
  kana: '',
  startFrame: 0,
  endFrameExclusive: 0,
  objectCount: 0,
  manualCount: 0,
})
const segmentEditor = ref({
  show: false,
  id: '',
  text: '',
  kana: '',
  romaji: '',
  startFrame: 0,
  speechEndFrameExclusive: 1,
})
const segmentDrag = ref<{
  segmentId: string
  edge: 'start' | 'end'
  startX: number
  originalStart: number
  originalEnd: number
  previewStart: number
  previewEnd: number
  minStart: number
  maxEnd: number
} | null>(null)
const kanaEditor = ref({ show: false, id: '', kana: '', romaji: '' })
const kanaDrag = ref<{
  unitId: string
  edge: 'start' | 'end'
  startX: number
  originalFrame: number
  previewFrame: number
  minFrame: number
  maxFrame: number
} | null>(null)
let animationFrame = 0
let noticeTimer = 0
let midiAudioContext: AudioContext | null = null
let midiPlaybackStartTime = 0
let midiPlaybackStartFrame = 0
let scheduledMidiNodes: OscillatorNode[] = []
let guideLoadGeneration = 0
let midiPlaybackGeneration = 0
let midiPlaybackStarting = false

const unit = computed(() => {
  const node = objectTree.node(props.objectId)
  return node?.kind === 'synthesisUnit' ? node : null
})
const synthesis = computed(() => unit.value?.synthesisUnit ?? null)
const frameCount = computed(() => synthesis.value?.frameContract.frameCount ?? 1)
const frameRate = computed(() => synthesis.value?.frameContract.frameRate ?? (44100 / 2048))
const timelineWidth = computed(() => Math.max(640, frameCount.value * pxPerFrame.value))
const modelDuration = computed(() => (synthesis.value?.frameContract.modelSampleCount ?? 0) / 44100)
const guideAsset = computed(() => {
  const assetId = synthesis.value?.guide.assetId
  return assetId ? objectTree.tree.assets[assetId] : null
})
const guideBlob = computed(() => {
  const key = guideAsset.value?.blobKey
  return key ? tracks.sourceBlobs.get(key) ?? null : null
})
const referenceUnit = computed(() => {
  const referenceUnitId = synthesis.value?.reference?.unitId
  if (!referenceUnitId) return null
  const node = objectTree.node(referenceUnitId)
  return node?.kind === 'synthesisUnit' ? node : null
})
const referenceGuideAsset = computed(() => {
  const assetId = referenceUnit.value?.synthesisUnit.guide.assetId
  return assetId ? objectTree.tree.assets[assetId] : null
})
const referenceGuideBlob = computed(() => {
  const key = referenceGuideAsset.value?.blobKey
  return key ? tracks.sourceBlobs.get(key) ?? null : null
})
const activeTake = computed(() => synthesis.value?.takes.find(take => (
  take.id === synthesis.value?.activeTakeId
)) ?? null)
const activeTakeAsset = computed(() => {
  const assetId = activeTake.value?.outputAssetId
  return assetId ? objectTree.tree.assets[assetId] : null
})
const activeTakeBlob = computed(() => {
  const blobKey = activeTakeAsset.value?.blobKey
  return blobKey ? tracks.sourceBlobs.get(blobKey) ?? null : null
})
const referenceStatus = computed(() => {
  if (!synthesis.value?.reference) return { label: '未绑定', warning: false }
  const reference = referenceUnit.value?.synthesisUnit
  if (!reference) return { label: '引用对象不存在', warning: true }
  if (reference.segmentTrack.status !== 'ready') return { label: 'Segment 未生成', warning: true }
  if (reference.hTokenTrack.status !== 'ready') return { label: 'H 未生成', warning: true }
  return { label: '控制已准备', warning: false }
})
const referenceMenuOptions = computed(() => Object.values(objectTree.index.nodes)
  .filter(node => node.kind === 'synthesisUnit' && node.id !== props.objectId)
  .map((node) => {
    if (node.kind !== 'synthesisUnit') throw new Error('unreachable')
    const policy = objectTree.canBindSynthesisReferenceUnit(props.objectId, node.id)
    return {
      label: `${node.name} · ${formatTime(node.synthesisUnit.guide.duration)}`,
      key: node.id,
      disabled: !policy.ok,
      props: policy.reason ? { title: policy.reason } : undefined,
    }
  })
  .sort((left, right) => String(left.label).localeCompare(String(right.label), 'zh-CN')))
const frameTicks = computed(() => Array.from({ length: frameCount.value }, (_, frame) => frame))
const majorTickEvery = computed(() => pxPerFrame.value >= 18 ? 5 : pxPerFrame.value >= 10 ? 10 : 20)
const midiReady = computed(() => synthesis.value?.midiPTokenTrack.status === 'ready')
const midiFlowFrameSet = computed(() => new Set(synthesis.value?.midiPTokenTrack.flowFrames ?? []))
const midiPitchRange = computed(() => {
  const classes = synthesis.value?.midiPTokenTrack.classes.filter(value => value < 255) ?? []
  if (classes.length === 0) return { min: 96, max: 168 }
  let min = Math.max(0, Math.min(...classes) - 12)
  let max = Math.min(254, Math.max(...classes) + 12)
  if (max - min < 48) {
    const center = (min + max) / 2
    min = Math.max(0, Math.floor(center - 24))
    max = Math.min(254, Math.ceil(center + 24))
  }
  min = Math.min(min, 120)
  max = Math.max(max, 144)
  return { min, max }
})
const midiPitchTicks = computed(() => {
  const range = midiPitchRange.value
  const firstClass = Math.max(0, Math.floor(range.min))
  const lastClass = Math.min(254, Math.ceil(range.max))
  return Array.from({ length: Math.max(0, lastClass - firstClass + 1) }, (_, index) => {
    const classId = firstClass + index
    return {
      classId,
      label: classId % 24 === 0 ? midiPitchName(classId) : '',
      semitone: classId % 2 === 0,
      octave: classId % 24 === 0,
    }
  })
})
const midiEditorLabel = computed(() => midiEditor.value.asFlow
  ? `FLOW -> ${midiClassLabel(midiEditor.value.midiClass)}`
  : midiClassLabel(midiEditor.value.midiClass))
const durationLabel = computed(() => formatTime(modelDuration.value))
const hoveredHEntry = computed(() => hoveredHTokenId.value == null ? null : V5P_H_TOKEN_BY_ID.get(hoveredHTokenId.value) ?? null)
const pickerCurrentTokenId = computed(() => (
  synthesis.value?.hTokenTrack.events.find(event => event.frame === hPicker.value.frame)?.tokenId ?? null
))
const selectedSegment = computed(() => {
  const selection = editorSelection.value
  return selection?.type === 'segment'
    ? synthesis.value?.segmentTrack.items.find(item => item.id === selection.id) ?? null
    : null
})
const selectedKana = computed(() => {
  const selection = editorSelection.value
  return selection?.type === 'kana'
    ? synthesis.value?.kanaTrack.units.find(item => item.id === selection.id) ?? null
    : null
})
const selectedHFrame = computed(() => editorSelection.value?.type === 'h' ? editorSelection.value.frame : null)
const selectedHEvent = computed(() => selectedHFrame.value == null ? null
  : synthesis.value?.hTokenTrack.events.find(event => event.frame === selectedHFrame.value) ?? null)
const selectedHEntry = computed(() => selectedHEvent.value
  ? V5P_H_TOKEN_BY_ID.get(selectedHEvent.value.tokenId) ?? null
  : null)
const selectedMidiFrame = computed(() => editorSelection.value?.type === 'midi-p' ? editorSelection.value.frame : null)
const selectedMidiClass = computed(() => selectedMidiFrame.value == null ? null
  : synthesis.value?.midiPTokenTrack.classes[selectedMidiFrame.value] ?? null)
const selectedMidiIsFlow = computed(() => selectedMidiFrame.value != null && isMidiFlowFrame(selectedMidiFrame.value))
const analysisJob = computed(() => analysis.stateFor(props.objectId))
const textAnalysisRunning = computed(() => analysisJob.value.running && ['segment', 'kana', 'h'].includes(analysisJob.value.kind ?? ''))
const midiAnalysisRunning = computed(() => analysisJob.value.running && analysisJob.value.kind === 'midi-p')
const analysisProgress = computed(() => Math.max(0, Math.min(100, Math.round(analysisJob.value.progress))))
const analysisBusy = computed(() => analysisJob.value.running)
const segmentMenuOptions = computed(() => [
  { label: '自动对齐至 Kana', key: 'kana', disabled: analysisJob.value.running },
  { label: '自动对齐至 H Token', key: 'h', disabled: analysisJob.value.running },
])
const kanaMenuOptions = computed(() => [
  { label: '自动对齐至 H Token', key: 'h', disabled: analysisJob.value.running },
  { label: '映射至 H Token', key: 'map-h', disabled: analysisJob.value.running },
])
const guideMenuOptions = computed(() => [
  { label: 'GAME 自动生成 MIDI-P', key: 'midi-p', disabled: analysisJob.value.running },
  { label: '自动转录为 Segment', key: 'segment', disabled: analysisJob.value.running },
])
const timelineScrollRef = ref<HTMLElement | null>(null)

watch(guideBlob, loadGuide, { immediate: true })
watch(referenceGuideBlob, loadReferenceGuide, { immediate: true })
watch(activeTakeBlob, loadActiveTake, { immediate: true })
watch(() => synthesis.value?.activeTakeId, takeId => {
  if (takeId && activeTakeBlob.value) auditionSource.value = 'take'
})
watch(pxPerFrame, () => nextTick(drawWaveform))
watch(() => props.objectId, () => {
  stopPlayback()
  playheadFrame.value = 0
  editorSelection.value = { type: 'guide' }
})
watch(auditionSource, () => {
  const frame = playheadFrame.value
  stopPlayback()
  playheadFrame.value = Math.min(frameCount.value - 1, Math.max(0, frame))
  syncAudioPlaybackPosition()
})
watch(playbackRate, () => {
  syncAudioPlaybackRate()
  if (auditionSource.value === 'midi-p' && playing.value) restartMidiPlayback()
})
watch(() => midiEditor.value.midiClass, (value, previous) => {
  if (midiEditor.value.show && value !== previous) previewMidiClass(value)
})

onMounted(() => {
  ;(window as any).__synthesisUnitEditorActive = true
  ;(window as any).__playbackStop?.()
  syncAudioPlaybackRate()
  window.addEventListener('keydown', handleEditorKeydown, true)
})

async function loadGuide(blob: Blob | null) {
  const generation = ++guideLoadGeneration
  stopPlayback()
  waveform.value = null
  if (guideUrl.value) URL.revokeObjectURL(guideUrl.value)
  guideUrl.value = blob ? URL.createObjectURL(blob) : ''
  if (!blob) return
  const context = new AudioContext()
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer())
    if (generation !== guideLoadGeneration) return
    const mono = new Float32Array(decoded.length)
    for (let channelIndex = 0; channelIndex < decoded.numberOfChannels; channelIndex++) {
      const channel = decoded.getChannelData(channelIndex)
      for (let index = 0; index < channel.length; index++) mono[index] += channel[index] / decoded.numberOfChannels
    }
    waveform.value = mono
    await nextTick()
    drawWaveform()
  } finally {
    await context.close()
  }
}

function loadReferenceGuide(blob: Blob | null) {
  stopReferencePlayback()
  if (referenceGuideUrl.value) URL.revokeObjectURL(referenceGuideUrl.value)
  referenceGuideUrl.value = blob ? URL.createObjectURL(blob) : ''
}

function loadActiveTake(blob: Blob | null) {
  stopPrimaryPlayback()
  if (takeUrl.value) URL.revokeObjectURL(takeUrl.value)
  takeUrl.value = blob ? URL.createObjectURL(blob) : ''
  if (!blob && auditionSource.value === 'take') auditionSource.value = 'guide'
}

function syncAudioPlaybackPosition() {
  const time = playheadFrame.value / frameRate.value
  if (audioElement.value) audioElement.value.currentTime = time
  if (takeAudioElement.value) takeAudioElement.value.currentTime = time
}

function syncAudioPlaybackRate() {
  if (audioElement.value) audioElement.value.playbackRate = playbackRate.value
  if (takeAudioElement.value) takeAudioElement.value.playbackRate = playbackRate.value
}

function chooseReferenceUnit(key: string | number) {
  bindReferenceUnit(String(key))
}

function resolveReferenceUnitId(nodeId: string): string | null {
  const node = objectTree.node(nodeId)
  if (node?.kind === 'synthesisUnit') return node.id
  if (node?.kind !== 'trackObject') return null
  const source = objectTree.node(node.trackObject.sourceObjectId)
  return source?.kind === 'synthesisUnit' ? source.id : null
}

function bindReferenceUnit(referenceNodeId: string) {
  if (!unit.value) return
  const referenceUnitId = resolveReferenceUnitId(referenceNodeId)
  if (!referenceUnitId) {
    flashStatus('A 区参考只接受合成单元或其时间线 OBJ')
    return
  }
  const reference = objectTree.node(referenceUnitId)
  const before = objectTree.snapshotTree()
  const result = objectTree.bindSynthesisReferenceUnit(unit.value.id, referenceUnitId)
  if (!result.ok) {
    flashStatus(result.reason ?? 'A 区参考绑定失败')
    return
  }
  history.push({
    description: `绑定 A 区参考 · ${reference?.name ?? referenceUnitId}`,
    patches: [],
    inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  flashStatus(`A 区参考 · ${reference?.name ?? referenceUnitId} · 完整 Guide · 跟随最新`)
}

function unbindReferenceUnit() {
  if (!unit.value) return
  const referenceName = referenceUnit.value?.name ?? '失效引用'
  const before = objectTree.snapshotTree()
  const result = objectTree.unbindSynthesisReferenceUnit(unit.value.id)
  if (!result.ok) {
    flashStatus(result.reason ?? 'A 区参考解除失败')
    return
  }
  history.push({
    description: `解除 A 区参考 · ${referenceName}`,
    patches: [],
    inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  flashStatus('A 区参考已解除')
}

function handleReferenceDragOver(event: DragEvent) {
  if (!event.dataTransfer?.types.includes('application/x-aisvc-node-id')) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'copy'
  referenceDropActive.value = true
}

function handleReferenceDrop(event: DragEvent) {
  referenceDropActive.value = false
  const referenceUnitId = event.dataTransfer?.getData('application/x-aisvc-node-id')
  if (!referenceUnitId) return
  event.preventDefault()
  bindReferenceUnit(referenceUnitId)
}

function openReferenceUnit() {
  const reference = referenceUnit.value
  if (!reference) return
  editorWorkspace.openSynthesisUnitTab(reference.id, reference.name)
}

async function toggleReferenceGuide() {
  const audio = referenceAudioElement.value
  if (!audio || !referenceGuideUrl.value) {
    flashStatus('A 区完整 Guide 不可读')
    return
  }
  if (referencePlaying.value) {
    audio.pause()
    referencePlaying.value = false
    return
  }
  stopPrimaryPlayback()
  if (audio.ended || audio.currentTime >= (referenceUnit.value?.synthesisUnit.guide.duration ?? 0)) {
    audio.currentTime = 0
  }
  try {
    await audio.play()
    referencePlaying.value = true
  } catch (error: any) {
    flashStatus(error?.message || 'A 区 Guide 播放失败')
  }
}

function drawWaveform() {
  const canvas = waveformCanvas.value
  const samples = waveform.value
  if (!canvas || !samples) return
  const cssWidth = timelineWidth.value
  const cssHeight = 72
  canvas.width = Math.min(8192, Math.max(640, Math.round(cssWidth)))
  canvas.height = cssHeight * Math.min(2, window.devicePixelRatio || 1)
  const context = canvas.getContext('2d')
  if (!context) return
  const width = canvas.width
  const height = canvas.height
  context.clearRect(0, 0, width, height)
  context.fillStyle = '#151a20'
  context.fillRect(0, 0, width, height)
  context.strokeStyle = '#5dc9b1'
  context.lineWidth = 1
  const middle = height / 2
  const samplesPerPixel = samples.length / width
  context.beginPath()
  for (let x = 0; x < width; x++) {
    const start = Math.floor(x * samplesPerPixel)
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((x + 1) * samplesPerPixel)))
    let min = 1
    let max = -1
    for (let index = start; index < end; index++) {
      min = Math.min(min, samples[index])
      max = Math.max(max, samples[index])
    }
    context.moveTo(x + 0.5, middle + min * middle * 0.84)
    context.lineTo(x + 0.5, middle + max * middle * 0.84)
  }
  context.stroke()
}

async function togglePlayback() {
  stopReferencePlayback()
  if (auditionSource.value === 'midi-p') {
    await toggleMidiPPlayback()
    return
  }
  const audio = auditionSource.value === 'take' ? takeAudioElement.value : audioElement.value
  if (!audio) return
  syncAudioPlaybackRate()
  if (playing.value) {
    audio.pause()
    playing.value = false
    cancelAnimationFrame(animationFrame)
    return
  }
  if (audio.currentTime >= modelDuration.value) audio.currentTime = 0
  await audio.play()
  playing.value = true
  tickPlayback()
}

function stopPrimaryPlayback() {
  midiPlaybackGeneration++
  midiPlaybackStarting = false
  for (const audio of [audioElement.value, takeAudioElement.value]) {
    if (!audio) continue
    audio.pause()
    audio.currentTime = 0
  }
  cancelAnimationFrame(animationFrame)
  stopScheduledMidiNodes()
  playing.value = false
  playheadFrame.value = 0
}

function stopReferencePlayback() {
  const audio = referenceAudioElement.value
  if (audio) {
    audio.pause()
    audio.currentTime = 0
  }
  referencePlaying.value = false
}

function stopPlayback() {
  stopPrimaryPlayback()
  stopReferencePlayback()
}

async function toggleMidiPPlayback() {
  if (!midiReady.value || midiPlaybackStarting) return
  const generation = ++midiPlaybackGeneration
  midiPlaybackStarting = true
  try {
    const context = await ensureMidiAudioContext()
    if (generation !== midiPlaybackGeneration) return
    if (playing.value) {
      const elapsed = Math.max(0, context.currentTime - midiPlaybackStartTime)
      playheadFrame.value = Math.min(frameCount.value - 1, midiPlaybackStartFrame + Math.floor(elapsed * frameRate.value))
      stopScheduledMidiNodes()
      cancelAnimationFrame(animationFrame)
      playing.value = false
      return
    }
    const classes = synthesis.value?.midiPTokenTrack.classes ?? []
    const flowFrames = midiFlowFrameSet.value
    if (playheadFrame.value >= frameCount.value - 1) playheadFrame.value = 0
    midiPlaybackStartFrame = playheadFrame.value
    midiPlaybackStartTime = context.currentTime + 0.04
    let runStart = midiPlaybackStartFrame
    while (runStart < classes.length) {
      const midiClass = classes[runStart]
      let runEnd = runStart + 1
      while (runEnd < classes.length
        && classes[runEnd] === midiClass
        && (midiClass >= 255 || flowFrames.has(runEnd))) runEnd++
      if (midiClass < 255) {
        schedulePianoTone(
          midiClass,
          midiPlaybackStartTime + (runStart - midiPlaybackStartFrame) / frameRate.value / playbackRate.value,
          (runEnd - runStart) / frameRate.value / playbackRate.value,
          true,
        )
      }
      runStart = runEnd
    }
    playing.value = true
    tickMidiPlayback()
  } finally {
    if (generation === midiPlaybackGeneration) midiPlaybackStarting = false
  }
}

function restartMidiPlayback() {
  if (!midiAudioContext || !playing.value) return
  const elapsed = Math.max(0, midiAudioContext.currentTime - midiPlaybackStartTime)
  playheadFrame.value = Math.min(
    frameCount.value - 1,
    midiPlaybackStartFrame + Math.floor(elapsed * frameRate.value * playbackRate.value),
  )
  stopScheduledMidiNodes()
  cancelAnimationFrame(animationFrame)
  playing.value = false
  void toggleMidiPPlayback()
}

function tickMidiPlayback() {
  if (!playing.value || auditionSource.value !== 'midi-p' || !midiAudioContext) return
  const elapsedFrames = Math.floor(Math.max(0, midiAudioContext.currentTime - midiPlaybackStartTime) * frameRate.value * playbackRate.value)
  const frame = midiPlaybackStartFrame + elapsedFrames
  if (frame >= frameCount.value) {
    stopPlayback()
    return
  }
  playheadFrame.value = Math.max(midiPlaybackStartFrame, frame)
  animationFrame = requestAnimationFrame(tickMidiPlayback)
}

async function ensureMidiAudioContext() {
  midiAudioContext ??= new AudioContext()
  if (midiAudioContext.state === 'suspended') await midiAudioContext.resume()
  return midiAudioContext
}

function previewMidiClass(midiClass: number) {
  if (midiClass >= 255 || midiClass < 0) return
  void ensureMidiAudioContext().then(context => {
    schedulePianoTone(midiClass, context.currentTime, 0.28, false)
  })
}

function schedulePianoTone(midiClass: number, startTime: number, duration: number, tracked: boolean) {
  const context = midiAudioContext
  if (!context || midiClass >= 255) return
  const frequency = 440 * 2 ** ((midiClass / 2 - 69) / 12)
  const gain = context.createGain()
  gain.gain.setValueAtTime(0.0001, startTime)
  gain.gain.exponentialRampToValueAtTime(0.16, startTime + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + Math.max(0.08, duration + 0.08))
  gain.connect(context.destination)
  for (const [multiple, level] of [[1, 1], [2, 0.24]] as const) {
    const oscillator = context.createOscillator()
    const harmonicGain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(frequency * multiple, startTime)
    harmonicGain.gain.value = level
    oscillator.connect(harmonicGain).connect(gain)
    oscillator.start(startTime)
    oscillator.stop(startTime + Math.max(0.1, duration + 0.1))
    if (tracked) scheduledMidiNodes.push(oscillator)
  }
}

function stopScheduledMidiNodes() {
  for (const node of scheduledMidiNodes) {
    try { node.stop() } catch {}
  }
  scheduledMidiNodes = []
}

function tickPlayback() {
  const audio = auditionSource.value === 'take' ? takeAudioElement.value : audioElement.value
  if (!audio || !playing.value) return
  if (audio.currentTime >= modelDuration.value || audio.ended) {
    stopPlayback()
    return
  }
  playheadFrame.value = Math.min(frameCount.value - 1, Math.floor(audio.currentTime * frameRate.value))
  animationFrame = requestAnimationFrame(tickPlayback)
}

function seekFromPointer(event: MouseEvent) {
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
  const frame = Math.min(frameCount.value - 1, Math.floor(ratio * frameCount.value))
  playheadFrame.value = frame
  if (audioElement.value) audioElement.value.currentTime = frame / frameRate.value
  if (takeAudioElement.value) takeAudioElement.value.currentTime = frame / frameRate.value
}

function seekGuideFromPointer(event: MouseEvent) {
  editorSelection.value = { type: 'guide' }
  const restartMidi = playing.value && auditionSource.value === 'midi-p'
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
  const frame = Math.min(frameCount.value - 1, Math.floor(ratio * frameCount.value))
  const time = frame / frameRate.value
  playheadFrame.value = frame
  if (restartMidi) {
    stopScheduledMidiNodes()
    cancelAnimationFrame(animationFrame)
    playing.value = false
  }
  if (takeAudioElement.value) {
    takeAudioElement.value.pause()
    takeAudioElement.value.currentTime = time
  }
  if (audioElement.value) {
    audioElement.value.currentTime = time
  }
  if (restartMidi) void toggleMidiPPlayback()
}

function handleTimelineWheel(event: WheelEvent) {
  const el = event.currentTarget instanceof HTMLElement ? event.currentTarget : timelineScrollRef.value
  if (!el) return
  event.preventDefault()
  const unit = event.deltaMode === 1 ? 40 : 1
  const speed = event.altKey ? 3 : 1
  const delta = event.deltaX || event.deltaY
  el.scrollLeft += delta * unit * speed
}

async function generateTake() {
  if (!unit.value || !referenceUnit.value || !guideBlob.value || !referenceGuideBlob.value) {
    flashStatus('请先绑定可用的 A 区参考和完整 Guide')
    return
  }
  if (takeGeneration.value.running) return
  if (forceCapacity.value) {
    forceCapacity.value = false
    await generateTakeCore()
    return
  }
  const durationSeconds = unit.value.synthesisUnit.guide.duration ?? 0
  const prepared = await gpuRuntime.prepareRuntime('V5P_40K_EMA', durationSeconds) as any
  if (!prepared.ok) {
    if (prepared.busy) {
      flashStatus(prepared.reason || '模型正在运行其他任务')
      return
    }
    if (prepared.action === 'confirm') {
      capacityRetry.value = 'v5p'
      capacityDialog.value = {
        modelId: 'V5P_40K_EMA',
        requiredMiB: prepared.required,
        freeMiB: prepared.policy.freeMiB,
        insufficient: false,
        estimate: prepared.policy.estimate,
        evictions: prepared.evictions,
      }
      return
    }
    if (prepared.insufficient) {
      capacityRetry.value = 'v5p'
      capacityDialog.value = {
        modelId: 'V5P_40K_EMA',
        requiredMiB: prepared.required,
        freeMiB: prepared.policy.freeMiB,
        insufficient: true,
        estimate: prepared.policy.estimate,
        evictions: [],
      }
      return
    }
    flashStatus(prepared.reason || '显存策略检查失败')
    return
  }
  await generateTakeCore()
}

async function generateTakeCore() {
  if (!unit.value || !referenceUnit.value || !guideBlob.value || !referenceGuideBlob.value) {
    flashStatus('请先绑定可用的 A 区参考和完整 Guide')
    return
  }
  if (takeGeneration.value.running) return
  let snapshot: ReturnType<typeof createSynthesisMaterialSnapshot>
  try {
    snapshot = createSynthesisMaterialSnapshot(referenceUnit.value, unit.value)
  } catch (error: any) {
    flashStatus(error?.message || 'V5-P 合成材料尚未准备完成')
    return
  }
  const targetUnitId = unit.value.id
  const takeId = `take:${crypto.randomUUID()}`
  const queued = objectTree.queueSynthesisTake(targetUnitId, {
    id: takeId,
    name: `Take ${(synthesis.value?.takes.length ?? 0) + 1}`,
    status: 'running',
    targetUnitRevision: snapshot.target.unitRevision,
    referenceUnitId: snapshot.reference.unitId,
    referenceUnitRevision: snapshot.reference.unitRevision,
    presetId: 'V5P_40K_EMA',
    checkpointSHA256: '3a532f5bd5965dff7d011996b7ca72d7884c5494a2d44d6c28b0bab21bace96c',
    vaeSHA256: 'dc2c4a8ec9731594951a27eff4a188a89b82859649c341c51d050101d1ce0b39',
    adapterSHA256: 'a61f6c9987b718555375b92ac4395384085d3f03c016d8cbb961f19f8ea7db38',
    seed: 42,
    createdAt: new Date().toISOString(),
  })
  if (!queued.ok) {
    flashStatus(queued.reason ?? 'Take 创建失败')
    return
  }
  takeGeneration.value = { running: true, progress: 0, message: '准备 V5-P' }
  try {
    const { result, blob } = await runSynthesisV5P({
      referenceBlob: referenceGuideBlob.value,
      targetBlob: guideBlob.value,
      snapshot,
      steps: 32,
      cfg: 1,
      seed: 42,
      onProgress: (progress, message) => {
        takeGeneration.value = { running: true, progress, message }
      },
    })
    const completed = await objectTree.completeSynthesisTake(targetUnitId, takeId, blob, result)
    if (!completed.ok) throw new Error(completed.reason ?? 'Take 落库失败')
    auditionSource.value = 'take'
    flashStatus(`${activeTake.value?.name ?? 'Take'} 已完成 · snapshot ${result.snapshotSHA256.slice(0, 10)}`)
  } catch (error: any) {
    const message = error?.message || 'V5-P 合成失败'
    if (message.includes('用户已取消 GPU 任务')) objectTree.cancelSynthesisTake(targetUnitId, takeId, message)
    else objectTree.failSynthesisTake(targetUnitId, takeId, message)
    flashStatus(message)
  } finally {
    takeGeneration.value = { running: false, progress: 0, message: '' }
  }
}

async function evictFromCapacityDialog() {
  const dialog = capacityDialog.value
  if (!dialog) return
  const evicted = await gpuRuntime.evictUntilFit(dialog.modelId, dialog.requiredMiB, dialog.evictions)
  if (!evicted) {
    capacityDialog.value = { ...dialog, insufficient: true, evictions: [] }
    return
  }
  capacityDialog.value = null
  await runCapacityRetry()
}

function forceRunFromCapacityDialog() {
  capacityDialog.value = null
  forceCapacity.value = true
  void runCapacityRetry()
}

function closeCapacityDialog() {
  capacityDialog.value = null
}

async function ensureAnalysisCapacity(
  requests: Array<{ modelId: string }>,
  kind: 'transcribe' | 'sofa' | 'game',
  context?: { segmentId?: string; target?: SegmentTextControlTarget; kanaUnitId?: string },
): Promise<boolean> {
  if (forceCapacity.value) {
    forceCapacity.value = false
    gpuRuntime.clearActiveStageReleases()
    return true
  }
  const durationSeconds = unit.value?.synthesisUnit.guide.duration ?? 0
  const prepared = await gpuRuntime.prepareCompositeTask(
    requests.map(request => request.modelId),
    durationSeconds,
  ) as any
  if (prepared.ok) {
    pendingAnalysis.value = null
    gpuRuntime.setActiveStageReleases(prepared.stageReleases ?? [])
    return true
  }
  if (prepared.busy) {
    flashStatus(prepared.reason || '模型正在运行其他任务')
    return false
  }
  pendingAnalysis.value = { kind, ...context }
  capacityRetry.value = kind
  if (prepared.action === 'confirm') {
    capacityDialog.value = {
      modelId: requests[0].modelId,
      requiredMiB: prepared.required,
      freeMiB: prepared.policy.freeMiB,
      insufficient: false,
      estimate: prepared.policy.estimate,
      evictions: prepared.evictions,
    }
    return false
  }
  if (prepared.insufficient) {
    capacityDialog.value = {
      modelId: requests[0].modelId,
      requiredMiB: prepared.required,
      freeMiB: prepared.policy.freeMiB,
      insufficient: true,
      estimate: prepared.policy.estimate,
      evictions: [],
    }
    return false
  }
  flashStatus(prepared.reason || '显存策略检查失败')
  return false
}

async function runCapacityRetry() {
  const kind = capacityRetry.value
  if (kind === 'v5p') {
    await generateTake()
    return
  }
  if (kind === 'transcribe') {
    await transcribeSegmentTrack()
    return
  }
  if (kind === 'game') {
    await generateMidiPTrack()
    return
  }
  const pending = pendingAnalysis.value
  if (pending?.kanaUnitId) await executeKanaAlignment(pending.kanaUnitId)
  else if (pending?.segmentId && pending.target) await executeSegmentAlignment(pending.segmentId, pending.target)
}

function selectTake(takeId: string) {
  const result = objectTree.setActiveSynthesisTake(props.objectId, takeId)
  if (!result.ok) {
    flashStatus(result.reason ?? 'Take 尚不可试听')
    return
  }
  auditionSource.value = 'take'
}

async function exportActiveTake() {
  const take = activeTake.value
  const blob = activeTakeBlob.value
  if (!take || !blob || take.status !== 'ready') {
    flashStatus('当前没有可导出的 Take')
    return
  }
  const before = objectTree.snapshotTree()
  const tracksBefore = tracks.snapshotState()
  const result = await objectTree.addRenderedAudioToTimeline({
    blob,
    outputFileName: `${unit.value?.name ?? 'V5-P'}_${take.name}.wav`,
    renderKind: 'v5p',
    timelineStart: synthesis.value?.defaultTimelineStart ?? 0,
  })
  if (result.ok && result.renderObjectId) {
    const renderObject = objectTree.node(result.renderObjectId)
    const trackSourceObject = result.trackSourceObjectId ? objectTree.node(result.trackSourceObjectId) : null
    const blobKeys = [
      renderObject?.kind === 'audio'
      ? objectTree.tree.assets[renderObject.audio.assetId]?.blobKey
      : undefined,
      trackSourceObject?.kind === 'audio'
        ? objectTree.tree.assets[trackSourceObject.audio.assetId]?.blobKey
        : undefined,
    ].filter((key): key is string => Boolean(key))
    history.push({
      description: '导出 V5-P Take',
      patches: [],
      inversePatches: [],
      objectTree: {
        kind: 'snapshot',
        before,
        after: objectTree.snapshotTree(),
        tracksBefore,
        tracksAfter: tracks.snapshotState(),
        blobChanges: blobKeys.map(key => ({ key, before: null, after: blob })),
      },
    })
  }
  flashStatus(result.ok ? `${take.name} 已导出到正式音轨` : (result.reason ?? 'Take 导出失败'))
}

function frameFromPointer(event: MouseEvent | PointerEvent) {
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  return Math.max(0, Math.min(frameCount.value - 1, Math.floor((event.clientX - rect.left) / pxPerFrame.value)))
}

function selectHFrame(frame: number) {
  editorSelection.value = { type: 'h', frame }
  playheadFrame.value = frame
  const time = frame / frameRate.value
  if (audioElement.value) audioElement.value.currentTime = time
  if (takeAudioElement.value) takeAudioElement.value.currentTime = time
}

function selectHFrameFromPointer(event: MouseEvent) {
  selectHFrame(frameFromPointer(event))
}

function openHTokenPickerAtFrame(frame: number) {
  selectHFrame(frame)
  hPicker.value = { show: true, frame }
}

function openHTokenPicker(event: MouseEvent, frame?: number) {
  event.preventDefault()
  event.stopPropagation()
  openHTokenPickerAtFrame(frame ?? frameFromPointer(event))
}

function chooseHToken(entry: V5PHTokenCatalogEntry | null) {
  if (!unit.value) return
  const before = objectTree.snapshotTree()
  const result = objectTree.setSynthesisHTokenAtFrame(
    unit.value.id,
    hPicker.value.frame,
    entry ? { tokenId: entry.id, symbol: entry.token } : null,
  )
  if (!result.ok) {
    flashStatus(result.reason ?? 'H Token 修改失败')
    return
  }
  history.push({
    description: entry ? `替换 H Token · frame ${hPicker.value.frame}` : `清除 H Token · frame ${hPicker.value.frame}`,
    patches: [],
    inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  flashStatus(entry ? `${entry.chineseName} · ${entry.token} · frame ${hPicker.value.frame}` : `frame ${hPicker.value.frame} 已恢复为 0 filler`)
}

async function transcribeSegmentTrack() {
  const ok = await ensureAnalysisCapacity([
    { modelId: 'Whisper large-v3' },
    { modelId: 'SOFA Japanese' },
  ], 'transcribe')
  if (!ok) return
  try {
    const result = await analysis.transcribeSegmentTrack(props.objectId)
    flashStatus(result.ok ? analysisJob.value.message : result.reason ?? 'Whisper + SOFA 失败')
  } finally {
    gpuRuntime.clearActiveStageReleases()
  }
}

function openGuideMenu(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  guideMenu.value = { show: false, x: event.clientX, y: event.clientY }
  nextTick(() => { guideMenu.value.show = true })
}

function chooseGuideMenu(key: string) {
  guideMenu.value.show = false
  if (key === 'segment') void transcribeSegmentTrack()
  if (key === 'midi-p') requestMidiPGeneration()
}

function requestMidiPGeneration() {
  const manualCount = synthesis.value?.midiPTokenTrack.manualFrames?.length ?? 0
  if (manualCount > 0) {
    midiGenerationConfirm.value = { show: true, manualCount }
    return
  }
  void generateMidiPTrack()
}

async function confirmMidiPGeneration() {
  midiGenerationConfirm.value.show = false
  await generateMidiPTrack()
}

async function generateMidiPTrack() {
  const ok = await ensureAnalysisCapacity([{ modelId: 'GAME-1.0-medium' }], 'game')
  if (!ok) return
  const result = await analysis.generateMidiPTrack(props.objectId)
  flashStatus(result.ok ? analysisJob.value.message : result.reason ?? 'GAME MIDI-P 失败')
}

function openMidiEditor(event: MouseEvent, frame?: number) {
  event.preventDefault()
  event.stopPropagation()
  const targetFrame = frame ?? frameFromPointer(event)
  openMidiEditorAtFrame(targetFrame)
}

function selectMidiFrame(frame: number) {
  editorSelection.value = { type: 'midi-p', frame }
  playheadFrame.value = frame
  const time = frame / frameRate.value
  if (audioElement.value) audioElement.value.currentTime = time
  if (takeAudioElement.value) takeAudioElement.value.currentTime = time
}

function selectMidiFrameFromPointer(event: MouseEvent) {
  selectMidiFrame(frameFromPointer(event))
}

function openMidiEditorAtFrame(targetFrame: number) {
  selectMidiFrame(targetFrame)
  const currentClass = synthesis.value?.midiPTokenTrack.classes[targetFrame]
  if (currentClass == null) return
  midiEditor.value = {
    show: true,
    frame: targetFrame,
    midiClass: currentClass,
    asFlow: isMidiFlowFrame(targetFrame),
  }
  if (currentClass < 255) previewMidiClass(currentClass)
}

function setSelectedMidiRest() {
  const frame = selectedMidiFrame.value
  const currentClass = selectedMidiClass.value
  if (!unit.value || frame == null || currentClass == null || currentClass === 255) return
  const before = objectTree.snapshotTree()
  const result = objectTree.setSynthesisMidiPFrame(unit.value.id, frame, 255, false)
  if (!result.ok) {
    flashStatus(result.reason ?? 'MIDI-P 修改失败')
    return
  }
  history.push({
    description: `写入 MIDI-P REST · frame ${frame}`,
    patches: [], inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  flashStatus(`frame ${frame} 已写入 REST`)
}

function adjustMidiEditor(delta: number) {
  const current = midiEditor.value.midiClass
  const pitch = current >= 255 ? 120 : current
  midiEditor.value.asFlow = false
  midiEditor.value.midiClass = Math.max(0, Math.min(254, pitch + delta))
  previewMidiClass(midiEditor.value.midiClass)
}

function setMidiEditorRest() {
  midiEditor.value.asFlow = false
  midiEditor.value.midiClass = 255
}

function setMidiEditorFlow() {
  const frame = midiEditor.value.frame
  const previousClass = synthesis.value?.midiPTokenTrack.classes[frame - 1]
  if (frame === 0 || previousClass == null || previousClass >= 255) {
    flashStatus('FLOW 前必须有一个有音高的 MIDI-P token')
    return
  }
  midiEditor.value.asFlow = true
  midiEditor.value.midiClass = previousClass
  previewMidiClass(previousClass)
}

function setMidiEditorClass(value: number | null) {
  if (value == null) return
  midiEditor.value.asFlow = false
  midiEditor.value.midiClass = value
  previewMidiClass(value)
}

function saveMidiEditor() {
  if (!unit.value) return
  const currentClass = synthesis.value?.midiPTokenTrack.classes[midiEditor.value.frame]
  const currentIsFlow = isMidiFlowFrame(midiEditor.value.frame)
  if (currentClass === midiEditor.value.midiClass && currentIsFlow === midiEditor.value.asFlow) {
    midiEditor.value.show = false
    return
  }
  const before = objectTree.snapshotTree()
  const result = objectTree.setSynthesisMidiPFrame(
    unit.value.id,
    midiEditor.value.frame,
    midiEditor.value.midiClass,
    midiEditor.value.asFlow,
  )
  if (!result.ok) {
    flashStatus(result.reason ?? 'MIDI-P 修改失败')
    return
  }
  history.push({
    description: `${midiEditor.value.asFlow ? '写入 FLOW' : '替换 MIDI-P'} · frame ${midiEditor.value.frame}`,
    patches: [], inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  if (midiEditor.value.midiClass < 255) previewMidiClass(midiEditor.value.midiClass)
  midiEditor.value.show = false
  flashStatus(`frame ${midiEditor.value.frame} · ${midiEditorLabel.value}`)
}

function beginMidiClassDrag(event: PointerEvent, frame: number, sourceClass: number) {
  if (event.button !== 0 || sourceClass >= 255) return
  if (isMidiFlowFrame(frame)) {
    flashStatus(`frame ${frame} 是 FLOW；请拖动 frame ${midiFlowHeadFrame(frame)} 的头 token`)
    return
  }
  event.preventDefault()
  event.stopPropagation()
  midiDrag.value = {
    sourceFrame: frame,
    targetFrame: frame,
    sourceClass,
    targetClass: sourceClass,
    startX: event.clientX,
    startY: event.clientY,
  }
  window.addEventListener('pointermove', updateMidiClassDrag)
  window.addEventListener('pointerup', finishMidiClassDrag, { once: true })
  window.addEventListener('pointercancel', cancelMidiClassDrag, { once: true })
}

function updateMidiClassDrag(event: PointerEvent) {
  const drag = midiDrag.value
  if (!drag) return
  const nextFrame = Math.max(0, Math.min(
    frameCount.value - 1,
    drag.sourceFrame + Math.round((event.clientX - drag.startX) / pxPerFrame.value),
  ))
  const nextClass = Math.max(0, Math.min(254, drag.sourceClass - Math.round((event.clientY - drag.startY) / 6)))
  if (nextClass === drag.targetClass && nextFrame === drag.targetFrame) return
  drag.targetFrame = nextFrame
  drag.targetClass = nextClass
  previewMidiClass(nextClass)
}

function finishMidiClassDrag() {
  const drag = midiDrag.value
  clearMidiDragListeners()
  if (!drag || !unit.value) return
  if (drag.targetFrame === drag.sourceFrame && drag.targetClass === drag.sourceClass) return
  const targetIsManual = drag.targetFrame !== drag.sourceFrame
    && (synthesis.value?.midiPTokenTrack.manualFrames ?? []).includes(drag.targetFrame)
  if (targetIsManual) {
    midiMoveConfirm.value = {
      show: true,
      sourceFrame: drag.sourceFrame,
      targetFrame: drag.targetFrame,
      targetClass: drag.targetClass,
    }
    return
  }
  commitMidiDrag(drag.sourceFrame, drag.targetFrame, drag.targetClass, false)
}

function confirmMidiMove() {
  const move = midiMoveConfirm.value
  move.show = false
  commitMidiDrag(move.sourceFrame, move.targetFrame, move.targetClass, true)
}

function commitMidiDrag(sourceFrame: number, targetFrame: number, targetClass: number, forceReplace: boolean) {
  if (!unit.value) return
  const before = objectTree.snapshotTree()
  const result = objectTree.moveSynthesisMidiPFrame(
    unit.value.id,
    sourceFrame,
    targetFrame,
    targetClass,
    forceReplace,
  )
  if (!result.ok) {
    flashStatus(result.reason ?? 'MIDI-P 修改失败')
    return
  }
  const moved = sourceFrame !== targetFrame
  history.push({
    description: moved
      ? `移动 MIDI-P · frame ${sourceFrame} -> ${targetFrame}`
      : `拖动 MIDI-P 音高 · frame ${sourceFrame}`,
    patches: [], inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  previewMidiClass(targetClass)
  flashStatus(moved
    ? `frame ${sourceFrame} -> ${targetFrame} · ${midiClassLabel(targetClass)} · 源 frame = REST`
    : `frame ${sourceFrame} · ${midiClassLabel(targetClass)}`)
}

function cancelMidiClassDrag() {
  clearMidiDragListeners()
}

function clearMidiDragListeners() {
  window.removeEventListener('pointermove', updateMidiClassDrag)
  window.removeEventListener('pointerup', finishMidiClassDrag)
  window.removeEventListener('pointercancel', cancelMidiClassDrag)
  midiDrag.value = null
}

function midiClassAt(frame: number, fallback: number) {
  const drag = midiDrag.value
  if (!drag) return fallback
  if (drag.sourceFrame === drag.targetFrame && midiFlowHeadFrame(frame) === drag.sourceFrame) return drag.targetClass
  if (frame === drag.sourceFrame) return 255
  if (frame === drag.targetFrame) return drag.targetClass
  return fallback
}

function isMidiFlowFrame(frame: number): boolean {
  return midiFlowFrameSet.value.has(frame)
}

function midiFlowHeadFrame(frame: number): number {
  let headFrame = frame
  while (headFrame > 0 && midiFlowFrameSet.value.has(headFrame)) headFrame--
  return headFrame
}

function midiCellTitle(frame: number, midiClass: number): string {
  const label = midiClassLabel(midiClassAt(frame, midiClass))
  return isMidiFlowFrame(frame)
    ? `frame ${frame} · FLOW -> ${label} · head frame ${midiFlowHeadFrame(frame)}`
    : `frame ${frame} · ${label}`
}

function midiCellStyle(frame: number, midiClass: number) {
  const value = midiClassAt(frame, midiClass)
  if (value === 255) return { left: `${frame * pxPerFrame.value}px`, width: `${pxPerFrame.value}px`, top: '606px', height: '6px' }
  if (value === 256) return { left: `${frame * pxPerFrame.value}px`, width: `${pxPerFrame.value}px`, top: '630px', height: '4px' }
  return {
    left: `${frame * pxPerFrame.value}px`,
    width: `${pxPerFrame.value}px`,
    top: midiPitchTop(value),
    height: '8px',
  }
}

function midiPitchTop(midiClass: number): string {
  const range = midiPitchRange.value
  const ratio = (range.max - midiClass) / Math.max(1, range.max - range.min)
  return `${36 + Math.max(0, Math.min(1, ratio)) * 522}px`
}

function midiClassLabel(midiClass: number) {
  if (midiClass === 255) return 'REST'
  if (midiClass === 256) return 'PAD'
  return `${midiPitchName(midiClass)} · class ${midiClass}`
}

function midiPitchName(midiClass: number) {
  if (midiClass === 255) return 'REST'
  if (midiClass === 256) return 'PAD'
  const midi = midiClass / 2
  const note = Math.floor(midi)
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const cents = midi - note >= 0.5 ? '+50' : ''
  return `${names[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}${cents}`
}

function handleEditorKeydown(event: KeyboardEvent) {
  const targetElement = event.target instanceof HTMLElement ? event.target : null
  const isEditorTabTarget = Boolean(targetElement?.closest('.editor-tab'))
  if (isEditableTarget(event.target) && !isEditorTabTarget) return
  const ctrl = event.ctrlKey || event.metaKey
  if (ctrl && event.key.toLocaleLowerCase() === 'z') {
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.shiftKey) redoEditor()
    else undoEditor()
    return
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (!editorSelection.value || editorSelection.value.type === 'guide') return
    event.preventDefault()
    event.stopImmediatePropagation()
    deleteSelectedEditorObject()
    return
  }
  if ((event.code !== 'Space' && event.key !== ' ') || event.repeat) return
  event.preventDefault()
  event.stopImmediatePropagation()
  void togglePlayback()
}

function undoEditor() {
  if (!history.canUndo) return
  history.undo()
  flashStatus('已撤销')
}

function redoEditor() {
  if (!history.canRedo) return
  history.redo()
  flashStatus('已重做')
}

function deleteSelectedEditorObject() {
  const selection = editorSelection.value
  if (!unit.value || !selection || selection.type === 'guide') return
  if (selection.type === 'h') {
    clearSelectedHToken()
    return
  }
  if (selection.type === 'midi-p') {
    setSelectedMidiRest()
    return
  }
  const before = objectTree.snapshotTree()
  const result = selection.type === 'segment'
    ? objectTree.deleteSynthesisSegment(unit.value.id, selection.id)
    : objectTree.deleteSynthesisKana(unit.value.id, selection.id)
  if (!result.ok) {
    flashStatus(result.reason ?? '对象删除失败')
    return
  }
  history.push({
    description: selection.type === 'segment' ? '删除 Segment' : '删除 Kana',
    patches: [], inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  editorSelection.value = { type: 'guide' }
  flashStatus(selection.type === 'segment' ? 'Segment 已删除；其他轨保持不变' : 'Kana 已删除；其他轨保持不变')
}

function isEditableTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null
  return Boolean(element?.closest('input, textarea, select, button, [contenteditable="true"]'))
}

function openSegmentMenu(event: MouseEvent, segmentId: string) {
  event.preventDefault()
  event.stopPropagation()
  segmentMenu.value = { show: false, x: event.clientX, y: event.clientY, segmentId }
  nextTick(() => { segmentMenu.value.show = true })
}

function selectSegment(segmentId: string) {
  editorSelection.value = { type: 'segment', id: segmentId }
}

function selectKana(kanaUnitId: string) {
  editorSelection.value = { type: 'kana', id: kanaUnitId }
}

function segmentOwnedEnd(segmentId: string): number {
  const items = [...(synthesis.value?.segmentTrack.items ?? [])].sort((left, right) => left.startFrame - right.startFrame)
  const index = items.findIndex(item => item.id === segmentId)
  return index < 0 ? frameCount.value : items[index + 1]?.startFrame ?? frameCount.value
}

function segmentAtFrame(frame: number) {
  return [...(synthesis.value?.segmentTrack.items ?? [])]
    .sort((left, right) => left.startFrame - right.startFrame)
    .find(segment => frame >= segment.startFrame && frame < segmentOwnedEnd(segment.id)) ?? null
}

function kanaAtFrame(frame: number) {
  return synthesis.value?.kanaTrack.units.find(kana => (
    frame >= kana.startFrame && frame < kana.endFrameExclusive
  )) ?? null
}

function midiFrameOrigin(frame: number): string {
  return (synthesis.value?.midiPTokenTrack.manualFrames ?? []).includes(frame)
    ? 'user'
    : synthesis.value?.midiPTokenTrack.origin ?? 'empty'
}

function clearSelectedHToken() {
  const frame = selectedHFrame.value
  if (frame == null || !selectedHEvent.value) return
  hPicker.value = { show: false, frame }
  chooseHToken(null)
}

function fillPulsesAfterFrame(frame: number) {
  if (!unit.value) return
  const before = objectTree.snapshotTree()
  const result = objectTree.fillSynthesisPulsesAfterFrame(unit.value.id, frame)
  if (!result.ok) {
    flashStatus(result.reason ?? 'PUL 填充失败')
    return
  }
  if (!result.affectedFrames) {
    flashStatus('后方紧邻其他 H Token，没有可填充的 PUL frame')
    return
  }
  history.push({
    description: `PUL 刷 · frame ${frame}`,
    patches: [], inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  flashStatus(`已填充 ${result.affectedFrames} 个 PUL frame`)
}

function clearPulsesAfterFrame(frame: number) {
  if (!unit.value) return
  const before = objectTree.snapshotTree()
  const result = objectTree.clearSynthesisPulsesAfterFrame(unit.value.id, frame)
  if (!result.ok) {
    flashStatus(result.reason ?? 'PUL 清除失败')
    return
  }
  if (!result.affectedFrames) {
    flashStatus('后方没有连续 PUL frame')
    return
  }
  history.push({
    description: `清除连续 PUL · frame ${frame}`,
    patches: [], inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  flashStatus(`已清除 ${result.affectedFrames} 个连续 PUL frame`)
}

function alignSelectedSegment(target: SegmentTextControlTarget) {
  if (!selectedSegmentId.value) {
    flashStatus('请先点击一个 Segment，再执行对齐')
    return
  }
  chooseSegmentMenuFor(selectedSegmentId.value, target)
}

function chooseSegmentMenuFor(segmentId: string, target: SegmentTextControlTarget) {
  segmentMenu.value.segmentId = segmentId
  chooseSegmentMenu(target)
}

function chooseSegmentMenu(target: SegmentTextControlTarget) {
  segmentMenu.value.show = false
  const synthesisUnit = synthesis.value
  if (!synthesisUnit) return
  const items = [...synthesisUnit.segmentTrack.items].sort((left, right) => left.startFrame - right.startFrame)
  const index = items.findIndex(item => item.id === segmentMenu.value.segmentId)
  if (index < 0) return
  const segment = items[index]
  const startFrame = segment.startFrame
  const endFrameExclusive = target === 'kana'
    ? segment.speechEndFrameExclusive
    : items[index + 1]?.startFrame ?? frameCount.value
  const affected = target === 'kana'
    ? synthesisUnit.kanaTrack.units.filter(item => item.startFrame < endFrameExclusive && startFrame < item.endFrameExclusive)
    : synthesisUnit.hTokenTrack.events.filter(item => item.frame >= startFrame && item.frame < endFrameExclusive)
  const manualCount = affected.filter(item => item.origin === 'user').length
  if (manualCount > 0) {
    alignmentConfirm.value = {
      show: true,
      segmentId: segment.id,
      target,
      startFrame,
      endFrameExclusive,
      objectCount: affected.length,
      manualCount,
    }
    return
  }
  void executeSegmentAlignment(segment.id, target)
}

async function confirmSegmentAlignment() {
  const confirmation = { ...alignmentConfirm.value }
  alignmentConfirm.value.show = false
  await executeSegmentAlignment(confirmation.segmentId, confirmation.target)
}

async function executeSegmentAlignment(segmentId: string, target: SegmentTextControlTarget) {
  const ok = await ensureAnalysisCapacity([{ modelId: 'SOFA Japanese' }], 'sofa', { segmentId, target })
  if (!ok) return
  const result = await analysis.alignSegmentTextControl(props.objectId, segmentId, target)
  flashStatus(result.ok ? analysisJob.value.message : result.reason ?? 'Text Control 对齐失败')
}

function openKanaMenu(event: MouseEvent, kanaUnitId: string) {
  event.preventDefault()
  event.stopPropagation()
  kanaMenu.value = { show: false, x: event.clientX, y: event.clientY, kanaUnitId }
  nextTick(() => { kanaMenu.value.show = true })
}

function chooseKanaMenu(key: string) {
  kanaMenu.value.show = false
  if (key === 'map-h') {
    mapKanaToHTokens(kanaMenu.value.kanaUnitId)
    return
  }
  requestKanaAlignment(kanaMenu.value.kanaUnitId)
}

function mapKanaToHTokens(kanaUnitId: string) {
  if (!unit.value) return
  const kana = synthesis.value?.kanaTrack.units.find(item => item.id === kanaUnitId)
  if (!kana) {
    flashStatus('KanaUnit 不存在')
    return
  }
  let mapped
  try {
    mapped = kanaToHTokens(kana.kana)
  } catch (error: any) {
    flashStatus(error?.message || 'Kana 无法映射至 H token')
    return
  }
  if (mapped.length === 0) {
    flashStatus('当前 Kana 为空，无法映射至 H token')
    return
  }
  const width = kana.endFrameExclusive - kana.startFrame
  if (mapped.length > width) {
    flashStatus(`Kana 宽度不足：需要 ${mapped.length} 帧，当前只有 ${width} 帧`)
    return
  }
  const before = objectTree.snapshotTree()
  const events: SynthesisHTokenEvent[] = mapped.map((token, offset) => ({
    id: `h:direct:${crypto.randomUUID()}`,
    frame: kana.startFrame + offset,
    tokenId: token.tokenId,
    symbol: token.symbol,
    origin: 'user',
  }))
  const result = objectTree.replaceSynthesisHTokenTrackRange(
    unit.value.id,
    kana.startFrame,
    kana.endFrameExclusive,
    events,
    undefined,
    undefined,
    'Kana -> H 直接映射',
    'kana',
    undefined,
    'user',
  )
  if (!result.ok) {
    flashStatus(result.reason ?? 'Kana 映射 H token 失败')
    return
  }
  history.push({
    description: 'Kana 映射至 H Token', patches: [], inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  flashStatus(`已映射 ${mapped.length} 个 H token；仅覆盖当前 Kana frame 范围`)
}

function alignSelectedKana() {
  if (!selectedKanaUnitId.value) {
    flashStatus('请先点击一个 Kana，再执行对齐')
    return
  }
  requestKanaAlignment(selectedKanaUnitId.value)
}

function requestKanaAlignment(kanaUnitId: string) {
  const synthesisUnit = synthesis.value
  if (!synthesisUnit) return
  try {
    const range = getKanaControlRange(synthesisUnit.kanaTrack, kanaUnitId, frameCount.value)
    const affected = synthesisUnit.hTokenTrack.events.filter(event => (
      event.frame >= range.startFrame && event.frame < range.endFrameExclusive
    ))
    const manualCount = affected.filter(event => event.origin === 'user').length
    if (manualCount > 0) {
      kanaAlignmentConfirm.value = {
        show: true,
        kanaUnitId,
        kana: range.unit.kana,
        startFrame: range.startFrame,
        endFrameExclusive: range.endFrameExclusive,
        objectCount: affected.length,
        manualCount,
      }
      return
    }
    void executeKanaAlignment(kanaUnitId)
  } catch (error: any) {
    flashStatus(error?.message || 'Kana control range 无效')
  }
}

async function confirmKanaAlignment() {
  const kanaUnitId = kanaAlignmentConfirm.value.kanaUnitId
  kanaAlignmentConfirm.value.show = false
  await executeKanaAlignment(kanaUnitId)
}

async function executeKanaAlignment(kanaUnitId: string) {
  const ok = await ensureAnalysisCapacity([{ modelId: 'SOFA Japanese' }], 'sofa', { kanaUnitId })
  if (!ok) return
  const result = await analysis.alignKanaTextControl(props.objectId, kanaUnitId)
  flashStatus(result.ok ? analysisJob.value.message : result.reason ?? 'Kana → H 对齐失败')
}

function beginHTokenDrag(event: PointerEvent, eventId: string, sourceFrame: number) {
  if (event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  hDrag.value = { eventId, sourceFrame, targetFrame: sourceFrame, startX: event.clientX }
  window.addEventListener('pointermove', updateHTokenDrag)
  window.addEventListener('pointerup', finishHTokenDrag, { once: true })
  window.addEventListener('pointercancel', cancelHTokenDrag, { once: true })
}

function updateHTokenDrag(event: PointerEvent) {
  const drag = hDrag.value
  if (!drag) return
  const delta = Math.round((event.clientX - drag.startX) / pxPerFrame.value)
  drag.targetFrame = Math.max(0, Math.min(frameCount.value - 1, drag.sourceFrame + delta))
}

function finishHTokenDrag() {
  const drag = hDrag.value
  clearHTokenDragListeners()
  if (!drag || !unit.value || drag.targetFrame === drag.sourceFrame) return
  const before = objectTree.snapshotTree()
  const result = objectTree.moveSynthesisHToken(unit.value.id, drag.eventId, drag.targetFrame)
  if (!result.ok) {
    flashStatus(result.reason ?? 'H Token 移动失败')
    return
  }
  history.push({
    description: `移动 H Token · ${drag.sourceFrame} → ${drag.targetFrame}`,
    patches: [],
    inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  flashStatus(`H Token 已移动到 frame ${drag.targetFrame}`)
}

function cancelHTokenDrag() {
  clearHTokenDragListeners()
}

function clearHTokenDragListeners() {
  window.removeEventListener('pointermove', updateHTokenDrag)
  window.removeEventListener('pointerup', finishHTokenDrag)
  window.removeEventListener('pointercancel', cancelHTokenDrag)
  hDrag.value = null
}

function hEventStyle(eventId: string, frame: number) {
  const drag = hDrag.value
  const target = drag?.eventId === eventId ? drag.targetFrame : frame
  return {
    left: `${target * pxPerFrame.value}px`,
    width: `${Math.max(2, pxPerFrame.value - 1)}px`,
  }
}

function flashStatus(message: string) {
  statusNotice.value = message
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    if (statusNotice.value === message) statusNotice.value = ''
  }, 2400)
}

function openSegmentEditor(segmentId: string) {
  const segment = synthesis.value?.segmentTrack.items.find(item => item.id === segmentId)
  if (!segment) return
  segmentEditor.value = {
    show: true,
    id: segment.id,
    text: segment.text,
    kana: segment.kana,
    romaji: segment.romaji,
    startFrame: segment.startFrame,
    speechEndFrameExclusive: segment.speechEndFrameExclusive,
  }
}

function updateSegmentEditorKana(value: string) {
  segmentEditor.value.kana = value
  segmentEditor.value.romaji = kanaToRomaji(value)
}

function updateSegmentEditorRomaji(value: string) {
  segmentEditor.value.romaji = value
  segmentEditor.value.kana = romajiToKana(value)
}

function saveSegmentEditor() {
  if (!unit.value) return
  const before = objectTree.snapshotTree()
  const edit = segmentEditor.value
  const result = objectTree.updateSynthesisSegment(unit.value.id, edit.id, {
    text: edit.text,
    kana: edit.kana,
    romaji: edit.romaji,
    startFrame: edit.startFrame,
    speechEndFrameExclusive: edit.speechEndFrameExclusive,
  }, 'edit Segment content and range')
  if (!result.ok) {
    flashStatus(result.reason ?? 'Segment 修改失败')
    return
  }
  history.push({
    description: '编辑 Segment', patches: [], inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  segmentEditor.value.show = false
  flashStatus('Segment 已更新；Kana/H/MIDI-P 保持不变')
}

function beginSegmentBoundaryDrag(event: PointerEvent, segmentId: string, edge: 'start' | 'end') {
  if (event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  const items = [...(synthesis.value?.segmentTrack.items ?? [])].sort((left, right) => left.startFrame - right.startFrame)
  const index = items.findIndex(item => item.id === segmentId)
  if (index < 0) return
  const segment = items[index]
  segmentDrag.value = {
    segmentId,
    edge,
    startX: event.clientX,
    originalStart: segment.startFrame,
    originalEnd: segment.speechEndFrameExclusive,
    previewStart: segment.startFrame,
    previewEnd: segment.speechEndFrameExclusive,
    minStart: items[index - 1]?.speechEndFrameExclusive ?? 0,
    maxEnd: items[index + 1]?.startFrame ?? frameCount.value,
  }
  window.addEventListener('pointermove', updateSegmentBoundaryDrag)
  window.addEventListener('pointerup', finishSegmentBoundaryDrag, { once: true })
  window.addEventListener('pointercancel', cancelSegmentBoundaryDrag, { once: true })
}

function updateSegmentBoundaryDrag(event: PointerEvent) {
  const drag = segmentDrag.value
  if (!drag) return
  const delta = Math.round((event.clientX - drag.startX) / pxPerFrame.value)
  if (drag.edge === 'start') {
    drag.previewStart = Math.max(drag.minStart, Math.min(drag.originalEnd - 1, drag.originalStart + delta))
  } else {
    drag.previewEnd = Math.max(drag.originalStart + 1, Math.min(drag.maxEnd, drag.originalEnd + delta))
  }
}

function finishSegmentBoundaryDrag() {
  const drag = segmentDrag.value
  clearSegmentDragListeners()
  if (!drag || !unit.value) return
  if (drag.previewStart === drag.originalStart && drag.previewEnd === drag.originalEnd) return
  const before = objectTree.snapshotTree()
  const result = objectTree.updateSynthesisSegment(unit.value.id, drag.segmentId, {
    startFrame: drag.previewStart,
    speechEndFrameExclusive: drag.previewEnd,
  }, `drag Segment ${drag.edge} boundary`)
  if (!result.ok) {
    flashStatus(result.reason ?? 'Segment 边界修改失败')
    return
  }
  history.push({
    description: '拖动 Segment 边界', patches: [], inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  flashStatus('Segment 边界已更新；其他轨保持不变')
}

function cancelSegmentBoundaryDrag() {
  clearSegmentDragListeners()
}

function clearSegmentDragListeners() {
  window.removeEventListener('pointermove', updateSegmentBoundaryDrag)
  window.removeEventListener('pointerup', finishSegmentBoundaryDrag)
  window.removeEventListener('pointercancel', cancelSegmentBoundaryDrag)
  segmentDrag.value = null
}

function segmentStart(segmentId: string, fallback: number) {
  return segmentDrag.value?.segmentId === segmentId ? segmentDrag.value.previewStart : fallback
}

function segmentEnd(segmentId: string, fallback: number) {
  return segmentDrag.value?.segmentId === segmentId ? segmentDrag.value.previewEnd : fallback
}

function openKanaEditor(kanaUnitId: string) {
  const kana = synthesis.value?.kanaTrack.units.find(item => item.id === kanaUnitId)
  if (!kana) return
  kanaEditor.value = { show: true, id: kana.id, kana: kana.kana, romaji: kana.romaji }
}

function updateKanaEditorKana(value: string) {
  kanaEditor.value.kana = value
  kanaEditor.value.romaji = kanaToRomaji(value)
}

function updateKanaEditorRomaji(value: string) {
  kanaEditor.value.romaji = value
  kanaEditor.value.kana = romajiToKana(value)
}

function saveKanaEditor() {
  if (!unit.value) return
  const before = objectTree.snapshotTree()
  const result = objectTree.updateSynthesisKana(unit.value.id, kanaEditor.value.id, {
    kana: kanaEditor.value.kana,
    romaji: kanaEditor.value.romaji,
  })
  if (!result.ok) {
    flashStatus(result.reason ?? 'Kana 修改失败')
    return
  }
  history.push({
    description: '编辑 Kana', patches: [], inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  kanaEditor.value.show = false
  flashStatus('Kana 已更新；Segment/H/MIDI-P 保持不变')
}

function beginKanaBoundaryDrag(event: PointerEvent, kanaUnitId: string, edge: 'start' | 'end') {
  if (event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  const units = [...(synthesis.value?.kanaTrack.units ?? [])].sort((left, right) => left.startFrame - right.startFrame)
  const index = units.findIndex(item => item.id === kanaUnitId)
  if (index < 0) return
  const current = units[index]
  kanaDrag.value = {
    unitId: kanaUnitId,
    edge,
    startX: event.clientX,
    originalFrame: edge === 'start' ? current.startFrame : current.endFrameExclusive,
    previewFrame: edge === 'start' ? current.startFrame : current.endFrameExclusive,
    minFrame: edge === 'start' ? 0 : current.startFrame + 1,
    maxFrame: edge === 'start' ? current.endFrameExclusive - 1 : frameCount.value,
  }
  window.addEventListener('pointermove', updateKanaBoundaryDrag)
  window.addEventListener('pointerup', finishKanaBoundaryDrag, { once: true })
  window.addEventListener('pointercancel', cancelKanaBoundaryDrag, { once: true })
}

function updateKanaBoundaryDrag(event: PointerEvent) {
  const drag = kanaDrag.value
  if (!drag) return
  const delta = Math.round((event.clientX - drag.startX) / pxPerFrame.value)
  drag.previewFrame = Math.max(drag.minFrame, Math.min(drag.maxFrame, drag.originalFrame + delta))
}

function finishKanaBoundaryDrag() {
  const drag = kanaDrag.value
  clearKanaDragListeners()
  clearMidiDragListeners()
  stopScheduledMidiNodes()
  if (midiAudioContext) void midiAudioContext.close()
  if (!drag || !unit.value || drag.previewFrame === drag.originalFrame) return
  const before = objectTree.snapshotTree()
  const result = objectTree.moveSynthesisKanaBoundary(unit.value.id, drag.unitId, drag.edge, drag.previewFrame)
  if (!result.ok) {
    flashStatus(result.reason ?? 'Kana 边界修改失败')
    return
  }
  history.push({
    description: '拖动 Kana 边界', patches: [], inversePatches: [],
    objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
  })
  flashStatus(`Kana 边界已移动到 frame ${drag.previewFrame}；其他轨保持不变`)
}

function cancelKanaBoundaryDrag() {
  clearKanaDragListeners()
}

function clearKanaDragListeners() {
  window.removeEventListener('pointermove', updateKanaBoundaryDrag)
  window.removeEventListener('pointerup', finishKanaBoundaryDrag)
  window.removeEventListener('pointercancel', cancelKanaBoundaryDrag)
  kanaDrag.value = null
}

function kanaStart(kanaUnitId: string, fallback: number) {
  const drag = kanaDrag.value
  if (!drag) return fallback
  return drag.unitId === kanaUnitId && drag.edge === 'start' ? drag.previewFrame : fallback
}

function kanaEnd(kanaUnitId: string, fallback: number) {
  const drag = kanaDrag.value
  if (!drag) return fallback
  return drag.unitId === kanaUnitId && drag.edge === 'end' ? drag.previewFrame : fallback
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00.000'
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${(seconds % 60).toFixed(3).padStart(6, '0')}`
}

function hTokenLabel(tokenId: number, symbol?: string) {
  if (tokenId === 365) return 'SEP'
  if (tokenId === 366) return 'PUL'
  return symbol || String(tokenId)
}

function showHTokenTooltip(event: MouseEvent, tokenId: number, frame: number) {
  hoveredHTokenId.value = tokenId
  hTokenTooltip.value = {
    show: true,
    x: Math.min(event.clientX + 14, window.innerWidth - 300),
    y: Math.min(event.clientY + 14, window.innerHeight - 170),
    frame,
  }
}

function hideHTokenTooltip() {
  hoveredHTokenId.value = null
  hTokenTooltip.value.show = false
}

onBeforeUnmount(() => {
  ;(window as any).__synthesisUnitEditorActive = false
  window.removeEventListener('keydown', handleEditorKeydown, true)
  stopPlayback()
  clearHTokenDragListeners()
  clearSegmentDragListeners()
  clearKanaDragListeners()
  window.clearTimeout(noticeTimer)
  if (guideUrl.value) URL.revokeObjectURL(guideUrl.value)
  if (referenceGuideUrl.value) URL.revokeObjectURL(referenceGuideUrl.value)
  if (takeUrl.value) URL.revokeObjectURL(takeUrl.value)
})
</script>

<template>
  <main v-if="unit && synthesis" class="synthesis-editor" tabindex="0">
    <header class="editor-toolbar">
      <div class="transport">
        <NButton quaternary circle :title="playing ? '暂停' : '播放'" @click="togglePlayback">
          <template #icon><NIcon><Pause v-if="playing" /><Play v-else /></NIcon></template>
        </NButton>
        <NButton quaternary circle title="停止" @click="stopPlayback">
          <template #icon><NIcon><Stop /></NIcon></template>
        </NButton>
        <span class="time-readout">{{ formatTime(playheadFrame / frameRate) }} / {{ durationLabel }}</span>
      </div>
      <NRadioGroup v-model:value="auditionSource" size="small">
        <NRadioButton value="guide">Guide</NRadioButton>
        <NRadioButton value="midi-p" :disabled="!midiReady">MIDI-P</NRadioButton>
        <NRadioButton value="take" :disabled="!activeTakeBlob">Take</NRadioButton>
      </NRadioGroup>
      <div class="zoom-control">
        <span>Frame</span>
        <NSlider v-model:value="pxPerFrame" :min="6" :max="24" :step="1" :tooltip="false" />
        <span>{{ pxPerFrame }}px</span>
      </div>
      <div class="speed-control">
        <span>速度</span>
        <NSlider v-model:value="playbackRate" :min="0.1" :max="1.5" :step="0.1" :tooltip="false" />
        <span>{{ playbackRate.toFixed(1) }}x</span>
      </div>
      <div class="toolbar-spacer" />
    </header>

    <section
      class="reference-strip"
      :class="{ active: referenceDropActive, empty: !synthesis.reference }"
      @dragover="handleReferenceDragOver"
      @dragleave.self="referenceDropActive = false"
      @drop="handleReferenceDrop"
    >
      <div class="reference-heading">
        <NIcon><LinkOutline /></NIcon>
        <span>A 区参考</span>
        <small>完整 Guide · 跟随最新</small>
      </div>
      <template v-if="referenceUnit">
        <NDropdown trigger="click" :options="referenceMenuOptions" @select="chooseReferenceUnit">
          <button type="button" class="reference-main" title="更换 A 区参考">
            <strong>{{ referenceUnit.name }}</strong>
            <span>
              {{ formatTime(referenceUnit.synthesisUnit.guide.duration) }} · unit r{{ referenceUnit.synthesisUnit.unitRevision }} · H r{{ referenceUnit.synthesisUnit.hTokenTrack.revision }}
            </span>
          </button>
        </NDropdown>
        <span class="reference-state" :class="{ warning: referenceStatus.warning }">{{ referenceStatus.label }}</span>
        <NButton quaternary circle size="small" :disabled="!referenceGuideUrl" :title="referencePlaying ? '暂停 A 区完整 Guide' : '试听 A 区完整 Guide'" @click="toggleReferenceGuide">
          <template #icon><NIcon><Pause v-if="referencePlaying" /><Play v-else /></NIcon></template>
        </NButton>
        <NButton quaternary circle size="small" title="打开参考合成单元" @click="openReferenceUnit">
          <template #icon><NIcon><OpenOutline /></NIcon></template>
        </NButton>
        <NButton quaternary circle size="small" title="解除 A 区参考" @click="unbindReferenceUnit">
          <template #icon><NIcon><UnlinkOutline /></NIcon></template>
        </NButton>
      </template>
      <template v-else-if="synthesis.reference">
        <div class="reference-main invalid">
          <strong>引用对象不存在</strong>
          <span>{{ synthesis.reference.unitId }}</span>
        </div>
        <span class="reference-state warning">{{ referenceStatus.label }}</span>
        <NButton quaternary circle size="small" title="解除失效引用" @click="unbindReferenceUnit">
          <template #icon><NIcon><UnlinkOutline /></NIcon></template>
        </NButton>
      </template>
      <template v-else>
        <span class="reference-empty-state">未绑定</span>
        <NDropdown trigger="click" :options="referenceMenuOptions" @select="chooseReferenceUnit">
          <NButton size="small" secondary :disabled="referenceMenuOptions.length === 0">
            <template #icon><NIcon><LinkOutline /></NIcon></template>
            选择合成单元
          </NButton>
        </NDropdown>
      </template>
      <NButton
        circle
        size="small"
        type="primary"
        :loading="takeGeneration.running"
        :disabled="!referenceUnit || !guideBlob || !referenceGuideBlob"
        title="生成 V5-P Take"
        @click="generateTake"
      >
        <template #icon><NIcon><ColorWandOutline /></NIcon></template>
      </NButton>
    </section>

    <section class="unit-summary">
      <div class="unit-identity">
        <strong>{{ unit.name }}</strong>
        <span>r{{ synthesis.unitRevision }}</span>
      </div>
      <span>{{ frameCount }} frames</span>
      <span>{{ synthesis.guide.sampleCount.toLocaleString() }} samples</span>
      <span
        v-if="synthesis.frameContract.trailingSampleCount"
        class="warning"
        :title="`尾部 ${synthesis.frameContract.trailingSampleCount} samples 不进入 VAE frame`"
      >
        尾部 {{ synthesis.frameContract.trailingSampleCount }} samples
      </span>
      <span v-if="takeGeneration.running" class="status-notice">{{ Math.round(takeGeneration.progress) }}% · {{ takeGeneration.message }}</span>
      <span v-else-if="analysisJob.running" class="status-notice">{{ Math.round(analysisJob.progress) }}% · {{ analysisJob.message }}</span>
      <span v-else-if="statusNotice" class="status-notice">{{ statusNotice }}</span>
      <span
        v-else-if="hoveredHEntry"
        class="token-readout"
        :title="`${hoveredHEntry.chineseName}：${hoveredHEntry.explanation}`"
      >
        {{ hoveredHEntry.chineseName }} · {{ hoveredHEntry.token }} · ID {{ hoveredHEntry.id }} · {{ hoveredHEntry.v5p40kSeen ? 'V5-P 训练见过' : 'V5-P 未见' }}
      </span>
      <span v-else class="hash">Guide {{ synthesis.guide.audioSHA256.slice(0, 10) }}</span>
    </section>

    <section v-if="synthesis.takes.length" class="take-strip">
      <div class="take-heading">
        <span>Takes</span>
        <small>{{ synthesis.takes.length }}</small>
      </div>
      <div class="take-list">
        <button
          v-for="take in synthesis.takes"
          :key="take.id"
          type="button"
          class="take-item"
          :class="{ active: take.id === synthesis.activeTakeId, failed: take.status === 'failed' }"
          :disabled="take.status !== 'ready'"
          :title="take.error || `${take.name} · target r${take.targetUnitRevision} · reference r${take.referenceUnitRevision}`"
          @click="selectTake(take.id)"
        >
          <strong>{{ take.name }}</strong>
          <span>{{ take.status === 'ready' ? formatTime(take.duration ?? 0) : take.status }}</span>
        </button>
      </div>
      <NButton
        quaternary
        circle
        size="small"
        :disabled="!activeTakeBlob"
        :title="playing && auditionSource === 'take' ? '暂停当前 Take' : '试听当前 Take'"
        @click="auditionSource = 'take'; togglePlayback()"
      >
        <template #icon><NIcon><Pause v-if="playing && auditionSource === 'take'" /><Play v-else /></NIcon></template>
      </NButton>
      <NButton quaternary circle size="small" :disabled="!activeTakeBlob" title="导出当前 Take 到正式音轨" @click="exportActiveTake">
        <template #icon><NIcon><DownloadOutline /></NIcon></template>
      </NButton>
    </section>

    <section class="editor-workspace">
    <section ref="timelineScrollRef" class="timeline-scroll" @wheel="handleTimelineWheel">
      <div class="timeline-content" :style="{ width: `${timelineWidth + 132}px`, '--grid-size': `${pxPerFrame}px` }">
        <div class="timeline-row ruler-row">
          <div class="track-label ruler-label">Frame / Time</div>
          <div class="track-space ruler" :style="{ width: `${timelineWidth}px` }" @click="seekFromPointer">
            <div
              v-for="frame in frameTicks"
              :key="frame"
              class="frame-tick"
              :class="{ major: frame % majorTickEvery === 0 }"
              :style="{ left: `${frame * pxPerFrame}px` }"
            >
              <span v-if="frame % majorTickEvery === 0">{{ frame }}</span>
            </div>
          </div>
        </div>

        <div class="group-band">Source</div>
        <div class="timeline-row guide-row">
          <div class="track-label">
            <span>Guide Audio</span>
            <small>owned</small>
          </div>
          <div
            class="track-space guide-space"
            :class="{ selected: editorSelection?.type === 'guide' }"
            :style="{ width: `${timelineWidth}px` }"
            @click="seekGuideFromPointer"
            @contextmenu="openGuideMenu"
          >
            <canvas ref="waveformCanvas" :style="{ width: `${timelineWidth}px` }" />
          </div>
        </div>

        <div class="group-band">Text</div>
        <div class="timeline-row segment-row">
          <div class="track-label control-label">
            <span>Segment</span>
            <small>r{{ synthesis.segmentTrack.revision }}</small>
            <div class="row-actions">
              <NButton size="tiny" secondary class="row-action" :loading="textAnalysisRunning" :disabled="analysisBusy && !textAnalysisRunning" @click.stop="transcribeSegmentTrack">
                <template #icon><NIcon><MicOutline /></NIcon></template>转录
              </NButton>
              <NButton size="tiny" secondary class="row-action" :disabled="analysisBusy" @click.stop="alignSelectedSegment('kana')">Kana</NButton>
              <NButton size="tiny" secondary class="row-action" :disabled="analysisBusy" @click.stop="alignSelectedSegment('h')">H</NButton>
            </div>
          </div>
          <div class="track-space grid-space" :style="{ width: `${timelineWidth}px` }" @click="seekFromPointer">
            <div
              v-for="segment in synthesis.segmentTrack.items"
              :key="segment.id"
              class="segment-object"
              :style="{
                left: `${segmentStart(segment.id, segment.startFrame) * pxPerFrame}px`,
                width: `${(segmentEnd(segment.id, segment.speechEndFrameExclusive) - segmentStart(segment.id, segment.startFrame)) * pxPerFrame}px`,
              }"
              :class="{ selected: selectedSegmentId === segment.id }"
              @click.stop="selectSegment(segment.id)"
              @dblclick.stop="openSegmentEditor(segment.id)"
              @contextmenu="openSegmentMenu($event, segment.id)"
            >
              <button
                type="button"
                class="boundary-handle start"
                title="拖动句首 frame"
                @pointerdown="beginSegmentBoundaryDrag($event, segment.id, 'start')"
              />
              <strong>{{ segment.text || segment.kana }}</strong>
              <span>{{ segment.romaji }}</span>
              <button
                type="button"
                class="segment-actions"
                title="Segment 操作"
                @click="openSegmentMenu($event, segment.id)"
              ><NIcon><EllipsisHorizontal /></NIcon></button>
              <button
                type="button"
                class="boundary-handle end"
                title="拖动句尾 frame"
                @pointerdown="beginSegmentBoundaryDrag($event, segment.id, 'end')"
              />
            </div>
            <div v-if="textAnalysisRunning" class="analysis-progress">
              <div class="analysis-progress-track">
                <div class="analysis-progress-bar" :style="{ width: `${analysisProgress}%` }" />
              </div>
              <span>{{ analysisProgress }}% · {{ analysisJob.message }}</span>
            </div>
          </div>
        </div>

        <div class="timeline-row kana-row">
          <div class="track-label">
            <span>Kana</span>
            <small>r{{ synthesis.kanaTrack.revision }}</small>
            <NButton size="tiny" secondary class="row-action kana-action" :disabled="analysisBusy" @click.stop="alignSelectedKana">H</NButton>
          </div>
          <div class="track-space grid-space" :style="{ width: `${timelineWidth}px` }" @click="seekFromPointer">
            <div
              v-for="kana in synthesis.kanaTrack.units"
              :key="kana.id"
              class="kana-object"
              :style="{
                left: `${kanaStart(kana.id, kana.startFrame) * pxPerFrame}px`,
                width: `${(kanaEnd(kana.id, kana.endFrameExclusive) - kanaStart(kana.id, kana.startFrame)) * pxPerFrame}px`,
              }"
              :class="{ selected: selectedKanaUnitId === kana.id }"
              @click.stop="selectKana(kana.id)"
              title="双击编辑 Kana；右键对齐所选 Kana 的 H Token"
              @dblclick.stop="openKanaEditor(kana.id)"
              @contextmenu="openKanaMenu($event, kana.id)"
            >
              <strong>{{ kana.kana }}</strong><span>{{ kana.romaji }}</span>
              <button
                type="button"
                class="boundary-handle start kana-boundary"
                title="拖动 Kana 起始边界"
                @pointerdown="beginKanaBoundaryDrag($event, kana.id, 'start')"
              />
              <button
                type="button"
                class="boundary-handle end kana-boundary"
                title="拖动 Kana 结束边界"
                @pointerdown="beginKanaBoundaryDrag($event, kana.id, 'end')"
              />
            </div>
            <div
              v-for="boundary in synthesis.kanaTrack.boundaries"
              :key="boundary.id"
              class="kana-seg"
              :style="{ left: `${boundary.frame * pxPerFrame}px` }"
            >SEG</div>
            <span v-if="synthesis.kanaTrack.status === 'empty'" class="empty-track">尚未生成 Kana</span>
          </div>
        </div>

        <div class="timeline-row h-row">
          <div class="track-label">
            <span>H Token</span>
            <small>r{{ synthesis.hTokenTrack.revision }}</small>
          </div>
          <div
            class="track-space grid-space"
            :style="{ width: `${timelineWidth}px` }"
            @click="selectHFrameFromPointer"
            @contextmenu="openHTokenPicker"
          >
            <div
              v-if="selectedHFrame != null"
              class="h-selection"
              :style="{ left: `${selectedHFrame * pxPerFrame}px`, width: `${pxPerFrame}px` }"
            />
            <div
              v-for="event in synthesis.hTokenTrack.events"
              :key="event.id"
              class="h-event"
              :class="{ special: event.tokenId >= 365, dragging: hDrag?.eventId === event.id, selected: selectedHFrame === event.frame }"
              :style="hEventStyle(event.id, event.frame)"
              :title="`${hTokenLabel(event.tokenId, event.symbol)} · ID ${event.tokenId} · frame ${event.frame}`"
              @mouseenter="showHTokenTooltip($event, event.tokenId, event.frame)"
              @mouseleave="hideHTokenTooltip"
              @click.stop="selectHFrame(event.frame)"
              @pointerdown="beginHTokenDrag($event, event.id, event.frame)"
              @dblclick="openHTokenPicker($event, event.frame)"
              @contextmenu="openHTokenPicker($event, event.frame)"
            >{{ hTokenLabel(event.tokenId, event.symbol) }}</div>
            <span v-if="synthesis.hTokenTrack.status === 'empty'" class="empty-track">尚未生成 H Token</span>
          </div>
        </div>

        <div class="group-band">Melody</div>
        <div class="timeline-row midi-row">
          <div class="track-label control-label">
            <span>MIDI-P</span>
            <small>r{{ synthesis.midiPTokenTrack.revision }}</small>
            <NButton
              size="tiny"
              secondary
              class="row-action"
              :loading="midiAnalysisRunning"
              :disabled="analysisBusy && !midiAnalysisRunning"
              @click.stop="requestMidiPGeneration"
            >
              <template #icon><NIcon><MusicalNotesOutline /></NIcon></template>
              GAME
            </NButton>
          </div>
          <div
            class="track-space midi-space"
            :style="{ width: `${timelineWidth}px` }"
            @click="selectMidiFrameFromPointer"
            @contextmenu="openMidiEditor"
          >
            <div
              v-for="tick in midiPitchTicks"
              :key="tick.classId"
              class="midi-pitch-line"
              :class="{ semitone: tick.semitone, octave: tick.octave }"
              :style="{ top: midiPitchTop(tick.classId) }"
            >
              <span v-if="tick.label">{{ tick.label }}</span>
            </div>
            <template v-if="midiReady">
              <div
                v-for="(midiClass, frame) in synthesis.midiPTokenTrack.classes"
                :key="frame"
                class="midi-cell"
                :class="{
                  rest: midiClassAt(frame, midiClass) === 255,
                  pad: midiClassAt(frame, midiClass) === 256,
                  flow: isMidiFlowFrame(frame),
                  manual: synthesis.midiPTokenTrack.manualFrames?.includes(frame),
                  dragging: midiDrag && (midiDrag.sourceFrame === frame || midiDrag.targetFrame === frame),
                  selected: selectedMidiFrame === frame,
                }"
                :style="midiCellStyle(frame, midiClass)"
                :title="midiCellTitle(frame, midiClass)"
                @click.stop="selectMidiFrame(frame)"
                @pointerdown="beginMidiClassDrag($event, frame, midiClass)"
                @contextmenu="openMidiEditor($event, frame)"
              />
            </template>
            <div v-if="midiAnalysisRunning" class="analysis-progress">
              <div class="analysis-progress-track">
                <div class="analysis-progress-bar midi" :style="{ width: `${analysisProgress}%` }" />
              </div>
              <span>{{ analysisProgress }}% · {{ analysisJob.message }}</span>
            </div>
          </div>
        </div>

        <div class="playhead" :style="{ left: `${132 + playheadFrame * pxPerFrame}px` }" />
      </div>

      <aside
        v-if="hTokenTooltip.show && hoveredHEntry"
        class="h-token-tooltip"
        :style="{ left: `${hTokenTooltip.x}px`, top: `${hTokenTooltip.y}px` }"
      >
        <div class="h-token-tooltip-heading">
          <strong>{{ hoveredHEntry.chineseName }}</strong>
          <code>{{ hoveredHEntry.token }}</code>
        </div>
        <p>{{ hoveredHEntry.explanation }}</p>
        <small>frame {{ hTokenTooltip.frame }} · ID {{ hoveredHEntry.id }} · {{ hoveredHEntry.editorVisibility }}</small>
        <small :class="hoveredHEntry.v5p40kSeen ? 'seen' : 'unseen'">
          V5-P 40K：{{ hoveredHEntry.trainingEvidence }}
        </small>
      </aside>
    </section>

    <aside class="editor-inspector">
      <template v-if="editorSelection?.type === 'guide'">
        <header class="inspector-header"><strong>Guide Audio</strong><span>Source · owned</span></header>
        <dl class="inspector-properties">
          <dt>时长</dt><dd>{{ formatTime(synthesis.guide.duration) }}</dd>
          <dt>采样率</dt><dd>{{ synthesis.guide.sampleRate }} Hz</dd>
          <dt>模型帧</dt><dd>{{ frameCount }}</dd>
          <dt>有效 samples</dt><dd>{{ synthesis.frameContract.modelSampleCount.toLocaleString() }}</dd>
        </dl>
        <div class="inspector-commands">
          <NButton size="small" secondary :disabled="analysisBusy" @click="transcribeSegmentTrack">转录 Segment</NButton>
          <NButton size="small" secondary :disabled="analysisBusy" @click="requestMidiPGeneration">生成 MIDI-P</NButton>
        </div>
      </template>

      <template v-else-if="editorSelection?.type === 'segment' && selectedSegment">
        <header class="inspector-header"><strong>Segment</strong><span>{{ selectedSegment.origin }}</span></header>
        <dl class="inspector-properties">
          <dt>原文</dt><dd>{{ selectedSegment.text || '-' }}</dd>
          <dt>Kana</dt><dd>{{ selectedSegment.kana || '-' }}</dd>
          <dt>Romaji</dt><dd>{{ selectedSegment.romaji || '-' }}</dd>
          <dt>发声范围</dt><dd>{{ selectedSegment.startFrame }}..{{ selectedSegment.speechEndFrameExclusive - 1 }}</dd>
          <dt>H 控制范围</dt><dd>{{ selectedSegment.startFrame }}..{{ segmentOwnedEnd(selectedSegment.id) - 1 }}</dd>
          <dt>SEP</dt><dd>frame {{ segmentOwnedEnd(selectedSegment.id) - 1 }}</dd>
        </dl>
        <div class="inspector-commands">
          <NButton size="small" secondary @click="openSegmentEditor(selectedSegment.id)">编辑</NButton>
          <NButton size="small" secondary :disabled="analysisBusy" @click="alignSelectedSegment('kana')">对齐 Kana</NButton>
          <NButton size="small" secondary :disabled="analysisBusy" @click="alignSelectedSegment('h')">对齐 H</NButton>
        </div>
      </template>

      <template v-else-if="editorSelection?.type === 'kana' && selectedKana">
        <header class="inspector-header"><strong>Kana</strong><span>{{ selectedKana.origin }}</span></header>
        <dl class="inspector-properties">
          <dt>Kana</dt><dd>{{ selectedKana.kana }}</dd>
          <dt>Romaji</dt><dd>{{ selectedKana.romaji || '-' }}</dd>
          <dt>Frame 范围</dt><dd>{{ selectedKana.startFrame }}..{{ selectedKana.endFrameExclusive - 1 }}</dd>
          <dt>时长</dt><dd>{{ formatTime((selectedKana.endFrameExclusive - selectedKana.startFrame) / frameRate) }}</dd>
        </dl>
        <div class="inspector-commands">
          <NButton size="small" secondary @click="openKanaEditor(selectedKana.id)">编辑</NButton>
          <NButton size="small" secondary :disabled="analysisBusy" @click="alignSelectedKana">对齐 H</NButton>
        </div>
      </template>

      <template v-else-if="editorSelection?.type === 'h'">
        <header class="inspector-header"><strong>H Token · {{ selectedHEntry?.token ?? '0' }}</strong><span>frame {{ selectedHFrame }}</span></header>
        <dl class="inspector-properties">
          <dt>中文</dt><dd>{{ selectedHEntry?.chineseName ?? '空 frame / filler' }}</dd>
          <dt>说明</dt><dd>{{ selectedHEntry?.explanation ?? '本 frame 没有显式 H token 事件。' }}</dd>
          <dt>Token / ID</dt><dd>{{ selectedHEntry ? `${selectedHEntry.token} · ${selectedHEntry.id}` : '0 · filler' }}</dd>
          <dt>训练</dt><dd :class="{ seen: selectedHEntry?.v5p40kSeen, unseen: selectedHEntry && !selectedHEntry.v5p40kSeen }">{{ selectedHEntry?.trainingEvidence ?? '-' }}</dd>
          <dt>来源</dt><dd>{{ selectedHEvent?.origin ?? 'filler' }}</dd>
          <dt>Segment</dt><dd>{{ segmentAtFrame(selectedHFrame ?? 0)?.text || '-' }}</dd>
          <dt>Kana</dt><dd>{{ kanaAtFrame(selectedHFrame ?? 0)?.kana || '-' }}</dd>
        </dl>
        <div class="inspector-commands">
          <NButton size="small" secondary @click="openHTokenPickerAtFrame(selectedHFrame ?? 0)">替换 Token</NButton>
          <NButton size="small" secondary :disabled="!selectedHEvent" @click="clearSelectedHToken">清为 0</NButton>
          <NButton size="small" secondary @click="fillPulsesAfterFrame(selectedHFrame ?? 0)">PUL 刷</NButton>
          <NButton size="small" secondary @click="clearPulsesAfterFrame(selectedHFrame ?? 0)">清后续 PUL</NButton>
        </div>
      </template>

      <template v-else-if="editorSelection?.type === 'midi-p'">
        <header class="inspector-header"><strong>MIDI-P</strong><span>frame {{ selectedMidiFrame }}</span></header>
        <dl class="inspector-properties">
          <dt>Class</dt><dd>{{ selectedMidiClass ?? '-' }}</dd>
          <dt>音高</dt><dd>{{ selectedMidiClass == null ? '-' : midiPitchName(selectedMidiClass) }}</dd>
          <dt>MIDI</dt><dd>{{ selectedMidiClass == null || selectedMidiClass >= 255 ? '-' : (selectedMidiClass / 2).toFixed(1) }}</dd>
          <dt>类型</dt><dd>{{ selectedMidiIsFlow ? `FLOW → head frame ${midiFlowHeadFrame(selectedMidiFrame ?? 0)}` : '实体音高 token' }}</dd>
          <dt>来源</dt><dd>{{ selectedMidiFrame == null ? '-' : midiFrameOrigin(selectedMidiFrame) }}</dd>
          <dt>Segment</dt><dd>{{ segmentAtFrame(selectedMidiFrame ?? 0)?.text || '-' }}</dd>
        </dl>
        <div class="inspector-commands">
          <NButton size="small" secondary @click="openMidiEditorAtFrame(selectedMidiFrame ?? 0)">替换</NButton>
          <NButton size="small" secondary :disabled="selectedMidiClass == null" @click="setSelectedMidiRest">REST</NButton>
        </div>
      </template>

      <footer class="inspector-revisions">
        S r{{ synthesis.segmentTrack.revision }} · K r{{ synthesis.kanaTrack.revision }} · H r{{ synthesis.hTokenTrack.revision }} · M r{{ synthesis.midiPTokenTrack.revision }}
      </footer>
    </aside>
    </section>

    <audio ref="audioElement" :src="guideUrl" preload="auto" @ended="stopPlayback" />
    <audio ref="takeAudioElement" :src="takeUrl" preload="auto" @ended="stopPlayback" />
    <audio ref="referenceAudioElement" :src="referenceGuideUrl" preload="metadata" @ended="referencePlaying = false" />
    <HTokenPicker
      v-model:show="hPicker.show"
      :frame="hPicker.frame"
      :current-token-id="pickerCurrentTokenId"
      @select="chooseHToken"
      @pul-fill="fillPulsesAfterFrame(hPicker.frame)"
      @pul-clear="clearPulsesAfterFrame(hPicker.frame)"
    />
    <NDropdown
      trigger="manual"
      placement="bottom-start"
      :show="segmentMenu.show"
      :x="segmentMenu.x"
      :y="segmentMenu.y"
      :options="segmentMenuOptions"
      @select="chooseSegmentMenu"
      @clickoutside="segmentMenu.show = false"
    />
    <NDropdown
      trigger="manual"
      placement="bottom-start"
      :show="guideMenu.show"
      :x="guideMenu.x"
      :y="guideMenu.y"
      :options="guideMenuOptions"
      @select="chooseGuideMenu"
      @clickoutside="guideMenu.show = false"
    />
    <NDropdown
      trigger="manual"
      placement="bottom-start"
      :show="kanaMenu.show"
      :x="kanaMenu.x"
      :y="kanaMenu.y"
      :options="kanaMenuOptions"
      @select="chooseKanaMenu"
      @clickoutside="kanaMenu.show = false"
    />
    <NModal v-model:show="midiGenerationConfirm.show" preset="card" title="覆盖手工 MIDI-P" class="alignment-confirm-modal">
      <div class="alignment-confirm-content">
        <div class="overwrite-range">frame 0..{{ frameCount - 1 }}</div>
        <div>当前 MIDI-P 有 {{ midiGenerationConfirm.manualCount }} 个经过手工修改的 frame。</div>
        <div>GAME 将覆盖完整 MIDI-P 轨；Segment、Kana、H 和 Guide 保持不变。</div>
        <div class="modal-actions">
          <NButton @click="midiGenerationConfirm.show = false">取消</NButton>
          <NButton type="warning" @click="confirmMidiPGeneration">强制覆盖</NButton>
        </div>
      </div>
    </NModal>
    <NModal v-model:show="midiMoveConfirm.show" preset="card" title="移动并覆盖手工 MIDI-P" class="alignment-confirm-modal">
      <div class="alignment-confirm-content">
        <div class="overwrite-range">frame {{ midiMoveConfirm.sourceFrame }} -> {{ midiMoveConfirm.targetFrame }}</div>
        <div>目标 frame 已经有手工修改：{{ midiClassLabel(midiMoveConfirm.targetClass) }}。</div>
        <div>确认后目标接收新音高，源 frame 写为 REST；其他 MIDI-P frame 和 Text 轨保持不变。</div>
        <div class="modal-actions">
          <NButton @click="midiMoveConfirm.show = false">取消</NButton>
          <NButton type="warning" @click="confirmMidiMove">强制移动</NButton>
        </div>
      </div>
    </NModal>
    <NModal v-model:show="alignmentConfirm.show" preset="card" title="覆盖手工 Text Control" class="alignment-confirm-modal">
      <div class="alignment-confirm-content">
        <div class="overwrite-range">frame {{ alignmentConfirm.startFrame }}..{{ alignmentConfirm.endFrameExclusive - 1 }}</div>
        <div>当前范围有 {{ alignmentConfirm.objectCount }} 个对象，其中 {{ alignmentConfirm.manualCount }} 个经过手工修改。</div>
        <div>本次只覆盖 {{ alignmentConfirm.target === 'kana' ? 'KanaTrack' : 'HTokenTrack' }}；其他轨保持不变。</div>
        <div class="modal-actions">
          <NButton @click="alignmentConfirm.show = false">取消</NButton>
          <NButton type="warning" @click="confirmSegmentAlignment">强制覆盖</NButton>
        </div>
      </div>
    </NModal>
    <NModal v-model:show="kanaAlignmentConfirm.show" preset="card" title="覆盖手工 H Token" class="alignment-confirm-modal">
      <div class="alignment-confirm-content">
        <div class="overwrite-range">Kana {{ kanaAlignmentConfirm.kana }} · frame {{ kanaAlignmentConfirm.startFrame }}..{{ kanaAlignmentConfirm.endFrameExclusive - 1 }}</div>
        <div>当前范围有 {{ kanaAlignmentConfirm.objectCount }} 个 H 事件，其中 {{ kanaAlignmentConfirm.manualCount }} 个经过手工修改。</div>
        <div>本次只覆盖这个 Kana control range 的 HTokenTrack；Segment、Kana、MIDI-P 和其他 H frame 保持不变。</div>
        <div class="modal-actions">
          <NButton @click="kanaAlignmentConfirm.show = false">取消</NButton>
          <NButton type="warning" @click="confirmKanaAlignment">强制覆盖</NButton>
        </div>
      </div>
    </NModal>
    <NModal v-model:show="segmentEditor.show" preset="card" title="编辑 Segment" class="segment-editor-modal">
      <div class="segment-form">
        <label><span>原文</span><NInput v-model:value="segmentEditor.text" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" /></label>
        <label><span>Kana</span><NInput :value="segmentEditor.kana" @update:value="updateSegmentEditorKana" /></label>
        <label><span>Romaji</span><NInput :value="segmentEditor.romaji" @update:value="updateSegmentEditorRomaji" /></label>
        <div class="frame-fields">
          <label><span>Start frame</span><NInputNumber v-model:value="segmentEditor.startFrame" :min="0" :max="frameCount - 1" /></label>
          <label><span>End frame</span><NInputNumber v-model:value="segmentEditor.speechEndFrameExclusive" :min="segmentEditor.startFrame + 1" :max="frameCount" /></label>
        </div>
        <div class="modal-actions">
          <NButton @click="segmentEditor.show = false">取消</NButton>
          <NButton type="primary" @click="saveSegmentEditor">保存 Segment</NButton>
        </div>
      </div>
    </NModal>
    <NModal v-model:show="kanaEditor.show" preset="card" title="编辑 Kana" class="kana-editor-modal">
      <div class="segment-form">
        <label><span>Kana / Mora</span><NInput :value="kanaEditor.kana" @update:value="updateKanaEditorKana" /></label>
        <label><span>Romaji</span><NInput :value="kanaEditor.romaji" @update:value="updateKanaEditorRomaji" /></label>
        <div class="modal-actions">
          <NButton @click="kanaEditor.show = false">取消</NButton>
          <NButton type="primary" @click="saveKanaEditor">保存 Kana</NButton>
        </div>
      </div>
    </NModal>
    <NModal v-model:show="midiEditor.show" preset="card" title="替换 MIDI-P" class="midi-editor-modal">
      <div class="midi-editor-form">
        <div class="midi-editor-readout">
          <span>frame {{ midiEditor.frame }}</span>
          <strong>{{ midiEditorLabel }}</strong>
        </div>
        <NInputNumber
          :value="midiEditor.midiClass"
          :min="0"
          :max="255"
          :step="1"
          :disabled="midiEditor.asFlow"
          @update:value="setMidiEditorClass"
        />
        <div class="midi-stepper">
          <NButton circle secondary title="降低 0.5 半音" @click="adjustMidiEditor(-1)">
            <template #icon><NIcon><Remove /></NIcon></template>
          </NButton>
          <NButton circle secondary title="升高 0.5 半音" @click="adjustMidiEditor(1)">
            <template #icon><NIcon><Add /></NIcon></template>
          </NButton>
          <NButton
            secondary
            :type="midiEditor.asFlow ? 'primary' : 'default'"
            title="继承前一个 MIDI-P token 的音高；只存在于编辑器"
            @click="setMidiEditorFlow"
          >FLOW</NButton>
          <NButton secondary @click="setMidiEditorRest">REST</NButton>
        </div>
        <div class="modal-actions">
          <NButton @click="midiEditor.show = false">取消</NButton>
          <NButton type="primary" @click="saveMidiEditor">强制替换</NButton>
        </div>
      </div>
    </NModal>
    <NModal :show="capacityDialog !== null" preset="card" title="显存容量检查" class="capacity-modal" @update:show="closeCapacityDialog">
      <div v-if="capacityDialog" class="capacity-content">
        <div class="capacity-summary">
          <span>需要约 {{ (capacityDialog.requiredMiB / 1024).toFixed(1) }} GB</span>
          <span>当前可用 {{ (capacityDialog.freeMiB / 1024).toFixed(1) }} GB</span>
          <span>估算来自 {{ capacityDialog.estimate.sampleSeconds }}s / {{ capacityDialog.estimate.steps ?? 1 }}步标定</span>
        </div>
        <div v-if="capacityDialog.insufficient" class="capacity-insufficient">您的显存实在不足。</div>
        <div v-else-if="capacityDialog.evictions.length > 0" class="capacity-evictions">
          共需释放以下模型：{{ capacityDialog.evictions.map(item => item.modelId).join('、') }}
        </div>
        <div v-else class="capacity-evictions">没有可删除的其他常驻模型。</div>
        <div class="modal-actions">
          <NButton v-if="!capacityDialog.insufficient" @click="closeCapacityDialog">取消运行</NButton>
          <NButton v-if="!capacityDialog.insufficient" type="warning" @click="evictFromCapacityDialog">删除最久未使用</NButton>
          <NButton type="error" ghost @click="forceRunFromCapacityDialog">强制运行</NButton>
          <NButton v-if="capacityDialog.insufficient" @click="closeCapacityDialog">放弃运行</NButton>
        </div>
      </div>
    </NModal>
  </main>
  <div v-else class="missing-unit">合成单元不存在或已被删除</div>
</template>

<style scoped>
.synthesis-editor {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #101419;
  color: #d8dee7;
  letter-spacing: 0;
  container-type: inline-size;
}

.editor-toolbar {
  flex: 0 0 44px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  border-bottom: 1px solid #2a313a;
  background: #171c22;
}

.transport,
.zoom-control,
.unit-summary,
.unit-identity {
  display: flex;
  align-items: center;
}

.transport { gap: 2px; }
.time-readout { min-width: 126px; margin-left: 6px; color: #aeb8c5; font: 11px ui-monospace, SFMono-Regular, Consolas, monospace; }
.zoom-control { width: 190px; gap: 8px; color: #8e99a8; font-size: 11px; }
.zoom-control :deep(.n-slider) { flex: 1; }
.speed-control { width: 156px; display: flex; align-items: center; gap: 8px; color: #8e99a8; font-size: 11px; }
.speed-control :deep(.n-slider) { flex: 1; }
.toolbar-spacer { flex: 1; }

.reference-strip {
  flex: 0 0 46px;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 0 12px;
  border-bottom: 1px solid #2a313a;
  background: #141a20;
  transition: background-color 120ms ease, box-shadow 120ms ease;
}
.reference-strip.active {
  background: #182620;
  box-shadow: inset 0 0 0 1px #5dc9b1;
}
.reference-heading {
  flex: 0 0 170px;
  display: grid;
  grid-template-columns: 18px auto;
  align-items: center;
  column-gap: 7px;
  color: #cbd3dc;
  font-size: 11px;
}
.reference-heading small {
  grid-column: 2;
  color: #778392;
  font-size: 9px;
}
.reference-main {
  width: clamp(240px, 34vw, 460px);
  min-width: 0;
  display: grid;
  gap: 2px;
  padding: 3px 7px;
  border: 0;
  border-left: 2px solid #5dc9b1;
  background: transparent;
  color: #d8dee7;
  text-align: left;
  cursor: pointer;
}
.reference-main:hover { background: #1c232a; }
.reference-main.invalid { border-left-color: #d28b68; cursor: default; }
.reference-main strong,
.reference-main span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.reference-main strong { font-size: 11px; }
.reference-main span { color: #8693a1; font: 9px ui-monospace, SFMono-Regular, Consolas, monospace; }
.reference-state {
  margin-left: auto;
  color: #5dc9b1;
  font-size: 10px;
  white-space: nowrap;
}
.reference-empty-state {
  flex: 1;
  color: #778392;
  font-size: 10px;
}

.unit-summary {
  flex: 0 0 34px;
  gap: 18px;
  padding: 0 14px;
  border-bottom: 1px solid #252c34;
  background: #12171c;
  color: #8e99a8;
  font-size: 11px;
  overflow: hidden;
  white-space: nowrap;
}

.unit-summary > span { flex: 0 0 auto; }
.unit-identity { flex: 1 1 260px; min-width: 120px; gap: 8px; color: #d8dee7; overflow: hidden; }
.unit-identity strong { font-size: 12px; }
.unit-identity strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.unit-identity span { color: #5dc9b1; }
.warning { color: #e7b45d; }
.hash { margin-left: auto; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.status-notice,
.token-readout { min-width: 0; margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status-notice { color: #5dc9b1; }
.token-readout { color: #c7b7dc; }

.take-strip {
  flex: 0 0 42px;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 0 10px 0 14px;
  border-bottom: 1px solid #252c34;
  background: #14191f;
}
.take-heading {
  flex: 0 0 92px;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  color: #aeb8c5;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
}
.take-heading small { color: #697584; font-size: 9px; }
.take-list {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 4px;
  overflow-x: auto;
}
.take-item {
  flex: 0 0 108px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 0 7px;
  border: 1px solid #303944;
  border-radius: 3px;
  background: #1a2027;
  color: #b8c1cc;
  cursor: pointer;
}
.take-item strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
.take-item span { color: #788493; font: 9px ui-monospace, SFMono-Regular, Consolas, monospace; }
.take-item.active { border-color: #5dc9b1; background: #1c2c29; color: #e1f2ee; }
.take-item.failed { border-color: #805467; color: #d9a7b8; }
.take-item:disabled { cursor: default; opacity: 0.75; }

.editor-workspace {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
}
.timeline-scroll {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow: auto;
  overscroll-behavior: contain;
  background: #101419;
  scrollbar-gutter: stable;
}
.editor-inspector {
  flex: 0 0 292px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: auto;
  border-left: 1px solid #303844;
  background: #151a20;
}
.inspector-header {
  display: grid;
  gap: 3px;
  padding: 14px 14px 12px;
  border-bottom: 1px solid #303844;
}
.inspector-header strong { color: #e0e6ed; font-size: 13px; }
.inspector-header span { color: #7f8d9b; font: 10px ui-monospace, SFMono-Regular, Consolas, monospace; }
.inspector-properties {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 9px 10px;
  margin: 0;
  padding: 14px;
  font-size: 11px;
}
.inspector-properties dt { color: #7e8b99; }
.inspector-properties dd { min-width: 0; margin: 0; color: #c9d2dc; overflow-wrap: anywhere; line-height: 1.45; }
.inspector-properties dd.seen { color: #5dc9b1; }
.inspector-properties dd.unseen { color: #e7b45d; }
.inspector-commands { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; padding: 0 14px 14px; }
.inspector-commands :deep(.n-button) { min-width: 0; }
.inspector-revisions { margin-top: auto; padding: 10px 14px; border-top: 1px solid #2b333d; color: #788594; font: 9px ui-monospace, SFMono-Regular, Consolas, monospace; }

.timeline-content { min-height: 100%; position: relative; }
.timeline-row { display: grid; grid-template-columns: 132px auto; position: relative; border-bottom: 1px solid #252c34; }
.track-label {
  position: sticky;
  left: 0;
  z-index: 8;
  padding: 0 10px;
  background: #171c22;
  border-right: 1px solid #303844;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: #cad1da;
}
.control-label {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  align-content: center;
  gap: 3px 8px;
}
.control-label span,
.control-label small {
  grid-column: 1;
}
.control-label .row-action {
  grid-column: 2;
  grid-row: 1 / span 2;
  align-self: center;
  justify-self: end;
  min-width: 52px;
}
.row-actions {
  grid-column: 2;
  grid-row: 1 / span 2;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
}
.row-actions .row-action { min-width: 48px; }
.kana-action { grid-column: 2; grid-row: 1 / span 2; min-width: 28px; }
.track-label small { color: #737f8d; font-size: 9px; }
.track-space { grid-column: 2; position: relative; overflow: hidden; }
.grid-space,
.midi-space {
  background-color: #11161b;
  background-image: repeating-linear-gradient(90deg, #303943 0, #303943 1px, transparent 1px, transparent var(--grid-size, 14px));
  background-size: var(--grid-size, 14px) 100%;
  background-repeat: repeat-x;
}

.ruler-row { height: 30px; position: sticky; top: 0; z-index: 12; }
.ruler-label { background: #171c22; color: #778392; }
.ruler { background: #171c22; cursor: pointer; }
.frame-tick { position: absolute; top: 17px; bottom: 0; border-left: 1px solid #323b46; }
.frame-tick.major { top: 10px; border-left-color: #556170; }
.frame-tick span { position: absolute; top: -9px; left: 3px; color: #7f8b99; font: 9px ui-monospace, SFMono-Regular, Consolas, monospace; }

.group-band {
  position: sticky;
  left: 0;
  z-index: 9;
  width: 132px;
  height: 22px;
  box-sizing: border-box;
  padding: 4px 10px;
  border-right: 1px solid #303844;
  border-bottom: 1px solid #252c34;
  background: #0d1115;
  color: #5dc9b1;
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
}

.guide-row { height: 72px; }
.guide-space { cursor: pointer; background: #151a20; }
.guide-space.selected { box-shadow: inset 0 0 0 1px #f0c45c; }
.guide-space canvas { height: 72px; display: block; }
.segment-row { height: 60px; }
.kana-row { height: 52px; }
.h-row { height: 52px; }
.midi-row { height: 660px; }

.segment-object,
.kana-object {
  position: absolute;
  top: 9px;
  bottom: 9px;
  min-width: 2px;
  overflow: hidden;
  border: 1px solid #4b83a6;
  border-radius: 3px;
  background: #1d3545;
  padding: 4px 6px;
  box-sizing: border-box;
  white-space: nowrap;
}
.segment-object strong,
.segment-object span { display: block; overflow: hidden; text-overflow: ellipsis; }
.segment-object strong { font-size: 11px; }
.segment-object span { color: #9ab0bf; font-size: 9px; }
.segment-actions {
  position: absolute;
  top: 3px;
  right: 8px;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  background: rgba(14, 26, 35, 0.72);
  color: #b8c7d2;
  cursor: pointer;
}
.segment-actions:hover { background: #31556b; color: #fff; }
.segment-object.selected,
.kana-object.selected { border-color: #f0c45c; box-shadow: 0 0 0 1px rgba(240, 196, 92, 0.35); }
.boundary-handle { position: absolute; top: 0; bottom: 0; width: 7px; padding: 0; border: 0; background: transparent; cursor: ew-resize; }
.boundary-handle.start { left: 0; border-left: 2px solid #79b3d5; }
.boundary-handle.end { right: 0; border-right: 2px solid #79b3d5; }
.boundary-handle:hover { background: rgba(121, 179, 213, 0.2); }
.kana-boundary { border-right-color: #c3a2eb; }
.kana-boundary.start { border-right: 0; border-left: 2px solid #c3a2eb; }
.kana-object { top: 8px; bottom: 8px; display: flex; gap: 5px; align-items: center; border-color: #8f72b8; background: #322746; }
.kana-object strong { font-size: 12px; }
.kana-object span { color: #b8a9cc; font-size: 9px; }
.kana-seg { position: absolute; top: 2px; bottom: 2px; border-left: 1px dashed #d2a85b; color: #d2a85b; font-size: 8px; padding-left: 2px; }

.h-event {
  position: absolute;
  top: 13px;
  min-width: 0;
  height: 24px;
  padding: 0 2px;
  box-sizing: border-box;
  border: 1px solid #d0778f;
  border-radius: 3px;
  background: #482634;
  color: #ffd3de;
  font: 10px/22px ui-monospace, SFMono-Regular, Consolas, monospace;
  text-align: center;
  overflow: hidden;
  text-overflow: clip;
  white-space: nowrap;
}
.h-selection { position: absolute; top: 0; bottom: 0; z-index: 1; border: 1px solid rgba(240, 196, 92, 0.8); background: rgba(240, 196, 92, 0.13); pointer-events: none; }
.h-event { z-index: 2; }
.h-event.selected { border-color: #f0c45c; box-shadow: 0 0 0 1px rgba(240, 196, 92, 0.4); }
.h-event.special { border-color: #d2a85b; background: #45391f; color: #f4d48c; }
.h-event.dragging { z-index: 5; border-color: #5dc9b1; background: #25453f; cursor: grabbing; }
.h-token-tooltip {
  position: fixed;
  z-index: 30;
  width: 276px;
  padding: 10px 12px;
  border: 1px solid #53606c;
  border-radius: 4px;
  background: #171d23;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.38);
  pointer-events: none;
}
.h-token-tooltip-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.h-token-tooltip-heading strong { color: #f0d8df; font-size: 12px; }
.h-token-tooltip-heading code { color: #f1b7c7; font: 15px ui-monospace, SFMono-Regular, Consolas, monospace; }
.h-token-tooltip p { margin: 7px 0; color: #c2ccd5; font-size: 11px; line-height: 1.5; }
.h-token-tooltip small { display: block; margin-top: 3px; color: #82909e; font: 10px ui-monospace, SFMono-Regular, Consolas, monospace; }
.h-token-tooltip .seen { color: #5dc9b1; }
.h-token-tooltip .unseen { color: #e7b45d; }

.midi-cell { position: absolute; box-sizing: border-box; border-right: 1px solid #11161b; background: #4a91ad; cursor: move; }
.midi-cell.flow { background: #9a6fab; cursor: context-menu; }
.midi-cell.rest { background: #4c5662; cursor: context-menu; }
.midi-cell.pad { background: #8e5665; cursor: not-allowed; }
.midi-cell.manual { outline: 1px solid #f0c45c; outline-offset: -1px; }
.midi-cell.dragging { z-index: 5; background: #5dc9b1; }
.midi-cell.selected { outline: 1px solid #f0c45c; outline-offset: -1px; box-shadow: inset 0 0 0 1px rgba(240, 196, 92, 0.45); }
.midi-pitch-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  border-top: 1px solid rgba(125, 150, 164, 0.16);
  pointer-events: none;
  z-index: 1;
}
.midi-pitch-line.semitone { border-top-color: rgba(143, 170, 184, 0.28); }
.midi-pitch-line.octave { border-top-color: rgba(178, 205, 216, 0.46); }
.midi-pitch-line span {
  position: absolute;
  left: 5px;
  top: -11px;
  padding: 1px 3px;
  border-radius: 2px;
  background: rgba(17, 22, 27, 0.84);
  color: #b6cad2;
  font: 10px ui-monospace, SFMono-Regular, Consolas, monospace;
}
.midi-cell { z-index: 2; }

.empty-track { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #66717f; font-size: 10px; }
.analysis-progress {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 6px;
  display: grid;
  gap: 4px;
  pointer-events: none;
}
.analysis-progress-track {
  height: 4px;
  border-radius: 999px;
  background: #29313a;
  overflow: hidden;
}
.analysis-progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #58a6ff, #5dc9b1);
  transition: width 0.14s ease;
}
.analysis-progress-bar.midi {
  background: linear-gradient(90deg, #79c0ff, #f0c45c);
}
.analysis-progress span {
  color: #8e99a8;
  font-size: 9px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.playhead { position: absolute; top: 0; bottom: 0; width: 1px; z-index: 7; background: #f0c45c; pointer-events: none; }
audio { display: none; }
.missing-unit { flex: 1; display: grid; place-items: center; color: #8e99a8; background: #101419; }

:global(.segment-editor-modal.n-card) { width: min(560px, calc(100vw - 48px)); border-radius: 6px; background: #171c22; }
:global(.kana-editor-modal.n-card) { width: 420px; border-radius: 6px; background: #171c22; }
:global(.midi-editor-modal.n-card) { width: 400px; border-radius: 6px; background: #171c22; }
.midi-editor-form { display: grid; gap: 14px; }
.midi-editor-readout { display: flex; justify-content: space-between; align-items: baseline; color: #8f9baa; font-size: 11px; }
.midi-editor-readout strong { color: #d8dee7; font: 13px ui-monospace, SFMono-Regular, Consolas, monospace; }
.midi-stepper { display: flex; gap: 8px; align-items: center; }
:global(.alignment-confirm-modal.n-card) { width: 440px; border-radius: 6px; background: #171c22; }
.alignment-confirm-content { display: grid; gap: 10px; color: #b6c0cc; font-size: 12px; }
.overwrite-range { color: #e7b45d; font: 12px ui-monospace, SFMono-Regular, Consolas, monospace; }
.segment-form { display: grid; gap: 12px; }
.segment-form label { display: grid; gap: 5px; color: #98a4b2; font-size: 11px; }
.frame-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 4px; }
.capacity-content { display: grid; gap: 12px; color: #b6c0cc; font-size: 12px; }
.capacity-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.capacity-summary span { padding: 8px; border: 1px solid color-mix(in srgb, var(--app-border) 70%, transparent); border-radius: 4px; }
.capacity-insufficient { color: #f28b94; }
.capacity-evictions { color: #d6a86a; }

@container (max-width: 760px) {
  .unit-summary { gap: 12px; }
  .hash { display: none; }
  .zoom-control,
  .speed-control { display: none; }
  .reference-heading { flex-basis: 94px; }
  .reference-heading small,
  .reference-state { display: none; }
  .reference-main { flex: 1; width: auto; min-width: 72px; }
}

@container (max-width: 620px) {
  .warning { display: none; }
  .time-readout { min-width: 92px; }
}
</style>

import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import type { RenderInputRef, RenderPanelMode, RenderSlotId } from '@/object-workbench'
import { makeRenderInputRef, normalizeSvsText, validateRenderSlot } from '@/object-workbench'
import { kanaToRomaji, romajiToKana } from '@/utils/kanaRomaji'
import { useObjectTreeStore } from './objectTree'

export type SvcRenderStatus = 'idle' | 'running' | 'done' | 'failed'
export type SvsRenderStatus = 'idle' | 'running' | 'done' | 'failed'
export type ToolRunStatus = 'idle' | 'running' | 'done' | 'failed'
export type LocalProcessingTool = 'svc' | 'svs' | 'whisper' | 'msst'

export const useRenderPanelStore = defineStore('renderPanel', () => {
  const mode = ref<RenderPanelMode>('svc')
  const svcStatus = ref<SvcRenderStatus>('idle')
  const svcProgress = ref(0)
  const svcMessage = ref('')
  const currentJobId = ref<string | null>(null)
  const svsStatus = ref<SvsRenderStatus>('idle')
  const svsProgress = ref(0)
  const svsMessage = ref('')
  const currentSvsJobId = ref<string | null>(null)
  const localProcessingTool = ref<LocalProcessingTool | null>(null)
  const whisperStatus = ref<ToolRunStatus>('idle')
  const whisperProgress = ref(0)
  const whisperMessage = ref('')
  const msstStatus = ref<ToolRunStatus>('idle')
  const msstProgress = ref(0)
  const msstMessage = ref('')
  const svc = reactive({
    condAudio: null as RenderInputRef | null,
    sourceAudio: null as RenderInputRef | null,
    outputName: '',
    cfg: 0.7,
    steps: 100,
  })
  const svs = reactive({
    timbreAudio: null as RenderInputRef | null,
    melody: null as RenderInputRef | null,
    textRef: null as RenderInputRef | null,
    manualText: '',
    manualRomaji: '',
    textMode: 'manual' as 'manual' | 'ref',
    outputName: '',
    cfg: 3.0,
    steps: 32,
    seed: 42,
    device: 'cuda:0',
  })
  const whisper = reactive({
    audio: null as RenderInputRef | null,
    outputName: '',
    language: 'auto' as 'auto' | 'ja' | 'zh' | 'en',
    vad: true,
  })
  const msst = reactive({
    audio: null as RenderInputRef | null,
    outputName: '',
    outputMode: 'vocals_accompaniment' as 'vocals' | 'accompaniment' | 'vocals_accompaniment' | 'denoise' | 'other',
    backfillAll: true,
  })

  const isLocalProcessingRunning = computed(() => localProcessingTool.value !== null)

  const canRunSvc = computed(() => {
    const objectTree = useObjectTreeStore()
    return !isLocalProcessingRunning.value
      && validateRenderSlot(objectTree.tree, 'svc.condAudio', svc.condAudio).ok
      && validateRenderSlot(objectTree.tree, 'svc.sourceAudio', svc.sourceAudio).ok
  })

  const canRunSvs = computed(() => {
    const objectTree = useObjectTreeStore()
    const textOk = svs.textMode === 'manual'
      ? normalizeSvsText(svs.manualText).length > 0
      : validateRenderSlot(objectTree.tree, 'svs.text', svs.textRef).ok
    return !isLocalProcessingRunning.value
      && validateRenderSlot(objectTree.tree, 'svs.timbreAudio', svs.timbreAudio).ok
      && validateRenderSlot(objectTree.tree, 'svs.melody', svs.melody).ok
      && textOk
  })

  const canRunWhisper = computed(() => {
    const objectTree = useObjectTreeStore()
    return !isLocalProcessingRunning.value
      && validateRenderSlot(objectTree.tree, 'whisper.audio', whisper.audio).ok
  })

  const canRunMsst = computed(() => {
    const objectTree = useObjectTreeStore()
    return !isLocalProcessingRunning.value
      && validateRenderSlot(objectTree.tree, 'msst.audio', msst.audio).ok
  })

  function setMode(nextMode: RenderPanelMode) {
    mode.value = nextMode
  }

  function setSlot(slotId: RenderSlotId, input: RenderInputRef | null): { ok: boolean; reason?: string } {
    const objectTree = useObjectTreeStore()
    const validation = validateRenderSlot(objectTree.tree, slotId, input)
    if (!validation.ok) return { ok: false, reason: validation.reason }

    if (slotId === 'svc.condAudio') svc.condAudio = input
    if (slotId === 'svc.sourceAudio') svc.sourceAudio = input
    if (slotId === 'svs.timbreAudio') svs.timbreAudio = input
    if (slotId === 'svs.melody') svs.melody = input
    if (slotId === 'svs.text') {
      svs.textRef = input
      svs.textMode = 'ref'
    }
    if (slotId === 'whisper.audio') whisper.audio = input
    if (slotId === 'msst.audio') msst.audio = input
    return { ok: true }
  }

  function setSlotFromNode(slotId: RenderSlotId, id: string): { ok: boolean; reason?: string } {
    const objectTree = useObjectTreeStore()
    const node = objectTree.node(id)
    if (!node) return { ok: false, reason: '原对象不存在' }
    const acceptsAudioObject = slotId === 'svc.condAudio'
      || slotId === 'svs.timbreAudio'
      || slotId === 'whisper.audio'
      || slotId === 'msst.audio'
    if (node.kind !== 'trackObject' && node.kind !== 'group' && !(acceptsAudioObject && node.kind === 'audio')) {
      return { ok: false, reason: acceptsAudioObject ? '该槽位只接受 AudioObject/TrackObject/GroupObject' : '槽位只接受 TrackObject 或 GroupObject' }
    }
    const kind = node.kind === 'group' ? 'group' : node.kind === 'audio' ? 'audioObject' : 'trackObject'
    return setSlot(slotId, makeRenderInputRef(objectTree.tree, kind, id))
  }

  function clearSlot(slotId: RenderSlotId) {
    if (slotId === 'svc.condAudio') svc.condAudio = null
    if (slotId === 'svc.sourceAudio') svc.sourceAudio = null
    if (slotId === 'svs.timbreAudio') svs.timbreAudio = null
    if (slotId === 'svs.melody') svs.melody = null
    if (slotId === 'svs.text') svs.textRef = null
    if (slotId === 'whisper.audio') whisper.audio = null
    if (slotId === 'msst.audio') msst.audio = null
  }

  function setSvsManualKana(value: string) {
    svs.manualText = value
    svs.manualRomaji = kanaToRomaji(value)
    svs.textMode = 'manual'
  }

  function setSvsManualRomaji(value: string) {
    svs.manualRomaji = value
    svs.manualText = romajiToKana(value)
    svs.textMode = 'manual'
  }

  function beginLocalProcessing(tool: LocalProcessingTool): boolean {
    if (localProcessingTool.value && localProcessingTool.value !== tool) return false
    localProcessingTool.value = tool
    return true
  }

  function endLocalProcessing(tool: LocalProcessingTool) {
    if (localProcessingTool.value === tool) localProcessingTool.value = null
  }

  function setSvcRunning(jobId: string, message = '准备 SVC') {
    if (!beginLocalProcessing('svc')) return false
    currentJobId.value = jobId
    svcStatus.value = 'running'
    svcProgress.value = 0
    svcMessage.value = message
    return true
  }

  function updateSvcProgress(progress: number, message?: string) {
    svcProgress.value = Math.max(0, Math.min(100, Math.round(progress)))
    if (message !== undefined) svcMessage.value = message
  }

  function setSvcDone(message = 'SVC 完成') {
    svcStatus.value = 'done'
    svcProgress.value = 100
    svcMessage.value = message
    endLocalProcessing('svc')
  }

  function setSvcFailed(message: string) {
    svcStatus.value = 'failed'
    svcMessage.value = message
    endLocalProcessing('svc')
  }

  function setSvsRunning(jobId: string, message = '准备 SVS') {
    if (!beginLocalProcessing('svs')) return false
    currentSvsJobId.value = jobId
    svsStatus.value = 'running'
    svsProgress.value = 0
    svsMessage.value = message
    return true
  }

  function updateSvsProgress(progress: number, message?: string) {
    svsProgress.value = Math.max(0, Math.min(100, Math.round(progress)))
    if (message !== undefined) svsMessage.value = message
  }

  function setSvsDone(message = 'SVS dryRun 完成') {
    svsStatus.value = 'done'
    svsProgress.value = 100
    svsMessage.value = message
    endLocalProcessing('svs')
  }

  function setSvsFailed(message: string) {
    svsStatus.value = 'failed'
    svsMessage.value = message
    endLocalProcessing('svs')
  }

  function setWhisperRunning(message = '准备 Whisper') {
    if (!beginLocalProcessing('whisper')) return false
    whisperStatus.value = 'running'
    whisperProgress.value = 0
    whisperMessage.value = message
    return true
  }

  function updateWhisperProgress(progress: number, message?: string) {
    whisperProgress.value = Math.max(0, Math.min(100, Math.round(progress)))
    if (message !== undefined) whisperMessage.value = message
  }

  function setWhisperDone(message = 'Whisper 完成') {
    whisperStatus.value = 'done'
    whisperProgress.value = 100
    whisperMessage.value = message
    endLocalProcessing('whisper')
  }

  function setWhisperFailed(message: string) {
    whisperStatus.value = 'failed'
    whisperMessage.value = message
    endLocalProcessing('whisper')
  }

  function setMsstRunning(message = '准备 MSST') {
    if (!beginLocalProcessing('msst')) return false
    msstStatus.value = 'running'
    msstProgress.value = 0
    msstMessage.value = message
    return true
  }

  function updateMsstProgress(progress: number, message?: string) {
    msstProgress.value = Math.max(0, Math.min(100, Math.round(progress)))
    if (message !== undefined) msstMessage.value = message
  }

  function setMsstDone(message = 'MSST 完成') {
    msstStatus.value = 'done'
    msstProgress.value = 100
    msstMessage.value = message
    endLocalProcessing('msst')
  }

  function setMsstFailed(message: string) {
    msstStatus.value = 'failed'
    msstMessage.value = message
    endLocalProcessing('msst')
  }

  return {
    mode,
    svcStatus,
    svcProgress,
    svcMessage,
    currentJobId,
    svsStatus,
    svsProgress,
    svsMessage,
    currentSvsJobId,
    localProcessingTool,
    isLocalProcessingRunning,
    whisperStatus,
    whisperProgress,
    whisperMessage,
    msstStatus,
    msstProgress,
    msstMessage,
    svc,
    svs,
    whisper,
    msst,
    canRunSvc,
    canRunSvs,
    canRunWhisper,
    canRunMsst,
    setMode,
    setSlot,
    setSlotFromNode,
    clearSlot,
    setSvsManualKana,
    setSvsManualRomaji,
    setSvcRunning,
    updateSvcProgress,
    setSvcDone,
    setSvcFailed,
    setSvsRunning,
    updateSvsProgress,
    setSvsDone,
    setSvsFailed,
    setWhisperRunning,
    updateWhisperProgress,
    setWhisperDone,
    setWhisperFailed,
    setMsstRunning,
    updateMsstProgress,
    setMsstDone,
    setMsstFailed,
  }
})

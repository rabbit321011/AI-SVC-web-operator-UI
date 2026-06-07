import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import type { RenderInputRef, RenderPanelMode, RenderSlotId } from '@/object-workbench'
import { makeRenderInputRef, validateRenderSlot } from '@/object-workbench'
import { useObjectTreeStore } from './objectTree'

export const useRenderPanelStore = defineStore('renderPanel', () => {
  const mode = ref<RenderPanelMode>('svc')
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
    textMode: 'manual' as 'manual' | 'ref',
    outputName: '',
    cfg: 3.0,
    steps: 32,
    seed: 42,
    device: 'cuda:0',
  })

  const canRunSvc = computed(() => {
    const objectTree = useObjectTreeStore()
    return validateRenderSlot(objectTree.tree, 'svc.condAudio', svc.condAudio).ok
      && validateRenderSlot(objectTree.tree, 'svc.sourceAudio', svc.sourceAudio).ok
  })

  const canRunSvs = computed(() => {
    const objectTree = useObjectTreeStore()
    const textOk = svs.textMode === 'manual'
      ? svs.manualText.trim().length > 0
      : validateRenderSlot(objectTree.tree, 'svs.text', svs.textRef).ok
    return validateRenderSlot(objectTree.tree, 'svs.timbreAudio', svs.timbreAudio).ok
      && validateRenderSlot(objectTree.tree, 'svs.melody', svs.melody).ok
      && textOk
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
    return { ok: true }
  }

  function setSlotFromNode(slotId: RenderSlotId, id: string): { ok: boolean; reason?: string } {
    const objectTree = useObjectTreeStore()
    const node = objectTree.node(id)
    if (!node) return { ok: false, reason: '原对象不存在' }
    if (node.kind !== 'trackObject' && node.kind !== 'group') {
      return { ok: false, reason: '槽位只接受 TrackObject 或 GroupObject' }
    }
    return setSlot(slotId, makeRenderInputRef(objectTree.tree, node.kind === 'group' ? 'group' : 'trackObject', id))
  }

  function clearSlot(slotId: RenderSlotId) {
    if (slotId === 'svc.condAudio') svc.condAudio = null
    if (slotId === 'svc.sourceAudio') svc.sourceAudio = null
    if (slotId === 'svs.timbreAudio') svs.timbreAudio = null
    if (slotId === 'svs.melody') svs.melody = null
    if (slotId === 'svs.text') svs.textRef = null
  }

  return {
    mode,
    svc,
    svs,
    canRunSvc,
    canRunSvs,
    setMode,
    setSlot,
    setSlotFromNode,
    clearSlot,
  }
})

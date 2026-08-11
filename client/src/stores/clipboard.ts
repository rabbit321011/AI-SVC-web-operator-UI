import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { DeepCopySegment, SegmentId } from '@/types'
import type { SynthesisClipboardItem } from '@/object-workbench'

export const useClipboardStore = defineStore('clipboard', () => {
  const items = ref<DeepCopySegment[]>([])
  const synthesisItems = ref<SynthesisClipboardItem[]>([])

  const hasContent = computed(() => items.value.length > 0 || synthesisItems.value.length > 0)

  function copy() {
    const selectionStore = useSelectionStore()
    const tracksStore = useTracksStore()
    const objectTree = useObjectTreeStore()
    const objectTreeUi = useObjectTreeUiStore()

    items.value = []
    synthesisItems.value = []
    const synthesisUnitIds = new Set<string>()
    for (const id of [...objectTreeUi.selectedIds, ...selectionStore.ids]) {
      const node = objectTree.node(id)
      if (node?.kind === 'synthesisUnit') synthesisUnitIds.add(node.id)
      if (node?.kind === 'trackObject') {
        const source = objectTree.node(node.trackObject.sourceObjectId)
        if (source?.kind === 'synthesisUnit') synthesisUnitIds.add(source.id)
      }
    }
    for (const unitId of synthesisUnitIds) {
      const snapshot = objectTree.copySynthesisUnitToClipboard(unitId)
      if (snapshot) synthesisItems.value.push(snapshot)
    }
    if (synthesisItems.value.length > 0) return
    if (!selectionStore.hasSegment) return

    for (const sid of selectionStore.ids) {
      if (!sid.startsWith('seg_')) continue
      const seg = tracksStore.getSegment(sid as SegmentId)
      if (!seg) continue
      items.value.push({
        sourceFile: seg.sourceFile,
        srcStartSample: seg.srcStartSample,
        srcEndSample: seg.srcEndSample,
        timelineStart: seg.timelineStart,
        timelineEnd: seg.timelineEnd,
        color: seg.color,
        f0Data: seg.f0Data ? [...seg.f0Data] : null,
        originalTrackId: seg.trackId,
      })
    }
  }

  function clear() {
    items.value = []
    synthesisItems.value = []
  }

  return { items, synthesisItems, hasContent, copy, clear }
})

import { useSelectionStore } from './selection'
import { useTracksStore } from './tracks'
import { useObjectTreeStore } from './objectTree'
import { useObjectTreeUiStore } from './objectTreeUi'

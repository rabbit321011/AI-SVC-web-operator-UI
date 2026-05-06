import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { DeepCopySegment, SegmentId } from '@/types'

export const useClipboardStore = defineStore('clipboard', () => {
  const items = ref<DeepCopySegment[]>([])

  const hasContent = computed(() => items.value.length > 0)

  function copy() {
    const selectionStore = useSelectionStore()
    const tracksStore = useTracksStore()

    if (!selectionStore.hasSegment) return

    items.value = []
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
  }

  return { items, hasContent, copy, clear }
})

import { useSelectionStore } from './selection'
import { useTracksStore } from './tracks'

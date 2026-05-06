import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { TrackId, SegmentId, CompGroupId, SelectionType } from '@/types'

export const useSelectionStore = defineStore('selection', () => {
  const selected = ref<Set<string>>(new Set())
  const type = ref<SelectionType>('none')

  function select(id: string, additive = false) {
    if (!additive) {
      selected.value = new Set([id])
    } else {
      const next = new Set(selected.value)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      selected.value = next
    }
    recomputeType()
  }

  function selectAll(items: string[], t: 'tracks' | 'segments' | 'compGroups') {
    selected.value = new Set(items)
    type.value = t
  }

  function deselect(id: string) {
    const next = new Set(selected.value)
    next.delete(id)
    selected.value = next
    recomputeType()
  }

  function clear() {
    selected.value = new Set()
    type.value = 'none'
  }

  function isSelected(id: string): boolean {
    return selected.value.has(id)
  }

  function recomputeType() {
    const items = [...selected.value]
    if (items.length === 0) {
      type.value = 'none'
      return
    }
    const hasTrack = items.some(s => s.startsWith('trk_'))
    const hasSeg = items.some(s => s.startsWith('seg_'))
    const hasCgrp = items.some(s => s.startsWith('cgrp_'))
    const types = [hasTrack, hasSeg, hasCgrp].filter(Boolean).length
    if (types > 1) {
      type.value = 'mixed'
    } else if (hasTrack) {
      type.value = 'tracks'
    } else if (hasSeg) {
      type.value = 'segments'
    } else if (hasCgrp) {
      type.value = 'compGroups'
    }
  }

  const isMixed = computed(() => type.value === 'mixed')
  const count = computed(() => selected.value.size)
  const ids = computed(() => [...selected.value])

  const hasTrack = computed(() => ids.value.some(s => s.startsWith('trk_')))
  const hasSegment = computed(() => ids.value.some(s => s.startsWith('seg_')))

  return {
    selected, type, isMixed, count, ids, hasTrack, hasSegment,
    select, selectAll, deselect, clear, isSelected, recomputeType,
  }
})

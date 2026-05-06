import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import type { CompGroup, CompGroupId, GroupElementSnapshot, TrackId, AudioSegment } from '@/types'

function makeCgrpId(): CompGroupId {
  return 'cgrp_' + crypto.randomUUID().slice(0, 8)
}

export const useCompGroupsStore = defineStore('compGroups', () => {
  const compGroups = reactive<Record<CompGroupId, CompGroup>>({})
  const compGroupOrder = ref<CompGroupId[]>([])

  function create(elements: GroupElementSnapshot[]): CompGroupId {
    const id = makeCgrpId()
    const n = compGroupOrder.value.length + 1

    const group: CompGroup = {
      id,
      name: `合成组 ${n}`,
      elements: [...elements],
      combinedAudio: null,
      svcResult: null,
      collapsed: false,
      expanded: false,
    }

    compGroups[id] = group
    compGroupOrder.value.push(id)
    return id
  }

  function updateCombinedAudio(id: CompGroupId, audio: CompGroup['combinedAudio']) {
    if (compGroups[id]) compGroups[id].combinedAudio = audio
  }

  function updateSvcResult(id: CompGroupId, result: CompGroup['svcResult']) {
    if (compGroups[id]) compGroups[id].svcResult = result
  }

  function updateSvcProgress(id: CompGroupId, progress: number, eta: number) {
    const group = compGroups[id]
    if (!group || !group.svcResult) return
    group.svcResult.progress = progress
    group.svcResult.eta = eta
    if (progress >= 100) group.svcResult.status = 'done'
  }

  function rename(id: CompGroupId, newName: string) {
    if (compGroups[id]) compGroups[id].name = newName
  }

  function toggleExpand(id: CompGroupId) {
    if (compGroups[id]) compGroups[id].expanded = !compGroups[id].expanded
  }

  function remove(id: CompGroupId) {
    const group = compGroups[id]
    if (group?.svcResult?.trackId) {
      const tracksStore = useTracksStore()
      tracksStore.removeTrack(group.svcResult.trackId)
    }
    delete compGroups[id]
    compGroupOrder.value = compGroupOrder.value.filter(c => c !== id)
  }

  function checkIntegrity(id: CompGroupId): boolean {
    const group = compGroups[id]
    if (!group) return false

    const tracksStore = useTracksStore()

    for (const snap of group.elements) {
      if (snap.type === 'segment') {
        const seg = tracksStore.getSegment(snap.id)
        if (!seg) return false
        if (seg.timelineStart !== snap.startTime || seg.timelineEnd !== snap.endTime) return false
      } else {
        const track = tracksStore.tracks[snap.id as TrackId]
        if (!track) return false
      }
    }
    return true
  }

  function buildElementsFromSelection(): GroupElementSnapshot[] {
    const selectionStore = useSelectionStore()
    const tracksStore = useTracksStore()
    const elements: GroupElementSnapshot[] = []

    for (const id of selectionStore.ids) {
      if (id.startsWith('seg_')) {
        const seg = tracksStore.getSegment(id)
        if (seg) {
          elements.push({ type: 'segment', id, startTime: seg.timelineStart, endTime: seg.timelineEnd })
        }
      } else if (id.startsWith('trk_')) {
        const track = tracksStore.tracks[id as TrackId]
        if (track) {
          const segs = tracksStore.getTrackSegments(id as TrackId)
          const start = segs.length > 0 ? Math.min(...segs.map(s => s.timelineStart)) : 0
          const end = segs.length > 0 ? Math.max(...segs.map(s => s.timelineEnd)) : 0
          elements.push({ type: 'track', id, startTime: start, endTime: end })
        }
      }
    }
    return elements
  }

  return {
    compGroups, compGroupOrder,
    create, updateCombinedAudio, updateSvcResult, updateSvcProgress,
    rename, toggleExpand, remove, checkIntegrity, buildElementsFromSelection,
  }
})

import { useTracksStore } from './tracks'
import { useSelectionStore } from './selection'

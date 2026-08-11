import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Patch, Command } from '@/types'
import type { ProjectObjectTree } from '@/object-workbench'
import type { SplitSegmentObjectTreeSnapshot } from './objectTree'

const MAX_HISTORY = 200

export const useHistoryStore = defineStore('history', () => {
  const stack = ref<(Command & { id: string; timestamp: number })[]>([])
  const pointer = ref(-1)

  const canUndo = computed(() => pointer.value >= 0)
  const canRedo = computed(() => pointer.value < stack.value.length - 1)

  function push(command: Command) {
    if (pointer.value < stack.value.length - 1) {
      stack.value = stack.value.slice(0, pointer.value + 1)
    }
    stack.value.push({
      ...command,
      id: crypto.randomUUID().slice(0, 8),
      timestamp: Date.now(),
    })
    pointer.value = stack.value.length - 1

    if (stack.value.length > MAX_HISTORY) {
      stack.value.shift()
      pointer.value--
    }
  }

  function resolveTarget(parts: string[]): { obj: any; field: string } | null {
    const tracksStore = useTracksStore()
    const selectionStore = useSelectionStore()
    const compGroupsStore = useCompGroupsStore()

    if (parts[0] === 'tracks' && parts[1]) {
      const track = tracksStore.tracks[parts[1]]
      if (!track) return null
      if (parts.length === 2) {
        return { obj: tracksStore.tracks, field: parts[1] }
      }
      return { obj: track, field: parts[2] }
    }
    if (parts[0] === 'trackOrder') {
      return { obj: tracksStore, field: 'trackOrder' }
    }
    if (parts[0] === 'segments' && parts[1]) {
      if (parts.length === 2) {
        return { obj: tracksStore.segmentsMap, field: parts[1] }
      }
      const seg = tracksStore.segmentsMap[parts[1]]
      if (!seg) return null
      return { obj: seg, field: parts[2] }
    }
    if (parts[0] === 'compGroups' && parts[1]) {
      if (parts.length === 2) {
        return { obj: compGroupsStore.compGroups, field: parts[1] }
      }
      const cg = compGroupsStore.compGroups[parts[1]]
      if (!cg) return null
      return { obj: cg, field: parts[2] }
    }
    if (parts[0] === 'selection') {
      return { obj: selectionStore, field: parts[1] || 'selected' }
    }
    return null
  }

  function applyPatches(patches: Patch[]) {
    const tracksStore = useTracksStore()

    for (const patch of patches) {
      const parts = patch.path.split('.')
      const target = resolveTarget(parts)
      if (!target) continue
      const { obj, field } = target

      switch (patch.op) {
        case 'replace':
          obj[field] = patch.value
          break
        case 'add':
          if (Array.isArray(obj[field])) {
            obj[field].push(patch.value)
          } else {
            obj[field] = patch.value
          }
          break
        case 'remove':
          if (Array.isArray(obj[field])) {
            obj[field] = obj[field].filter((v: unknown) => v !== patch.oldValue)
          } else {
            delete obj[field]
          }
          break
      }
    }

    // resort all track segments after any modification
    for (const trackId of tracksStore.trackOrder) {
      const track = tracksStore.tracks[trackId]
      if (!track) continue
      track.segments.sort((a, b) => {
        const sa = tracksStore.segmentsMap[a]
        const sb = tracksStore.segmentsMap[b]
        return (sa?.timelineStart ?? 0) - (sb?.timelineStart ?? 0)
      })
    }
  }

  function undo() {
    if (!canUndo.value) return
    const cmd = stack.value[pointer.value]
    applyPatches(cmd.inversePatches)
    applyObjectTreeUndo(cmd)
    pointer.value--
  }

  function redo() {
    if (!canRedo.value) return
    pointer.value++
    const cmd = stack.value[pointer.value]
    applyPatches(cmd.patches)
    applyObjectTreeRedo(cmd)
  }

  function applyObjectTreeUndo(command: Command) {
    if (command.objectTree?.kind === 'snapshot') {
      useObjectTreeStore().restoreTree(command.objectTree.before as ProjectObjectTree)
      applyBlobChanges(command.objectTree.blobChanges, 'before')
      return
    }
    if (command.objectTree?.kind !== 'splitSegment' || !command.objectTree.splitSnapshot) return
    useObjectTreeStore().syncUndoSplitSegment(command.objectTree.splitSnapshot as SplitSegmentObjectTreeSnapshot)
  }

  function applyObjectTreeRedo(command: Command) {
    if (command.objectTree?.kind === 'snapshot') {
      useObjectTreeStore().restoreTree(command.objectTree.after as ProjectObjectTree)
      applyBlobChanges(command.objectTree.blobChanges, 'after')
      return
    }
    if (command.objectTree?.kind !== 'splitSegment') return
    const result = useObjectTreeStore().syncSplitSegment(command.objectTree.oldSegment, command.objectTree.newSegments)
    if (result.snapshot) command.objectTree.splitSnapshot = result.snapshot
  }

  function applyBlobChanges(
    changes: Extract<NonNullable<Command['objectTree']>, { kind: 'snapshot' }>['blobChanges'],
    side: 'before' | 'after',
  ) {
    if (!changes) return
    const blobs = useTracksStore().sourceBlobs
    for (const change of changes) {
      const value = change[side]
      if (value) blobs.set(change.key, value)
      else blobs.delete(change.key)
    }
  }

  function clear() {
    stack.value = []
    pointer.value = -1
  }

  return { stack, pointer, canUndo, canRedo, push, undo, redo, clear }
})

import { useTracksStore } from './tracks'
import { useSelectionStore } from './selection'
import { useCompGroupsStore } from './compGroups'
import { useObjectTreeStore } from './objectTree'

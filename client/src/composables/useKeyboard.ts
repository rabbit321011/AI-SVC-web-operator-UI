import { nextTick, onMounted, onUnmounted } from 'vue'
import { useHistoryStore } from '@/stores/history'
import { useSelectionStore } from '@/stores/selection'
import { useClipboardStore } from '@/stores/clipboard'
import { useTracksStore } from '@/stores/tracks'
import { useCompGroupsStore } from '@/stores/compGroups'
import { useProjectStore } from '@/stores/project'
import { useObjectTreeStore } from '@/stores/objectTree'
import { useObjectTreeUiStore } from '@/stores/objectTreeUi'
import { float32ToWavBlob } from '@/api/wav'
import { getAudioBlobMeta } from '@/utils/audioMeta'
import type { AudioObjectNode, NodeId, TrackObjectNode } from '@/object-workbench'
import type { AudioSegment, SegmentId, TrackId, DeepCopySegment, F0Frame, Patch } from '@/types'

export function useKeyboard() {
  const history = useHistoryStore()
  const selection = useSelectionStore()
  const clipboard = useClipboardStore()

  function handler(e: KeyboardEvent) {
    const ctrl = e.ctrlKey || e.metaKey
    const altLocate = e.altKey && !ctrl && !e.shiftKey
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

    if (e.key === ' ') { e.preventDefault(); handleSpacebar(); return }
    if (altLocate && e.key.toLowerCase() === 'n') { e.preventDefault(); locateTrackObjectShortcut(); return }
    if (altLocate && e.key.toLowerCase() === 'l') { e.preventDefault(); locateAudioShortcut(); return }
    if (altLocate && e.key.toLowerCase() === 'm') { e.preventDefault(); locateBoundObjectShortcut('midi'); return }
    if (altLocate && e.key.toLowerCase() === 'k') { e.preventDefault(); locateBoundObjectShortcut('text'); return }
    if (ctrl && e.key === 'z' && !e.shiftKey) { e.preventDefault(); history.undo(); return }
    if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); history.redo(); return }
    if (ctrl && e.key === 's') { e.preventDefault(); saveProject(); return }
    if (ctrl && e.key === 'o') { e.preventDefault(); loadProject(); return }
    if (ctrl && e.key === 'ArrowUp') { e.preventDefault(); moveSelectedTimelineObjects(-1); return }
    if (ctrl && e.key === 'ArrowDown') { e.preventDefault(); moveSelectedTimelineObjects(1); return }
    if (ctrl && e.key === 'c') { e.preventDefault(); clipboard.copy(); return }
    if (ctrl && e.key === 'v') { e.preventDefault(); pasteFromClipboard(); return }
    if (ctrl && e.key === 'b') { e.preventDefault(); mergeSelected(); return }
    if (e.key === 'Delete' || e.key === 'Del') { e.preventDefault(); deleteSelected(); return }

    if (e.key === 'Enter') {
      e.preventDefault()
      const compGroups = useCompGroupsStore()
      const elements = compGroups.buildElementsFromSelection()
      if (elements.length > 0) {
        const groupId = compGroups.create(elements)
        useObjectTreeStore().createGroupFromLegacyElements(groupId, compGroups.compGroups[groupId]?.name ?? groupId, elements)
        selection.clear()
      }
      return
    }
  }

  function pasteFromClipboard() {
    if (!clipboard.hasContent) return
    const tracks = useTracksStore()
    const objectTree = useObjectTreeStore()
    const objectTreeUi = useObjectTreeUiStore()
    const newSegs: AudioSegment[] = []

    // always paste to a new track
    const pasteTrackId = tracks.makeTrackId()
    const num = tracks.trackOrder.length + 1
    tracks.tracks[pasteTrackId] = {
      id: pasteTrackId,
      name: `粘贴 ${num}`,
      trackType: 'audio',
      color: tracks.nextColor(),
      segments: [],
      sourceFile: clipboard.items[0]?.sourceFile ?? '',
      sampleRate: 44100,
      totalSamples: 0,
      f0Cache: null,
      f0Pending: 0,
      f0Total: 0,
      collapsed: false, muted: false, solo: false, volume: 1, ignored: false,
      boundCompGroupId: null,
    }
    tracks.trackOrder.push(pasteTrackId)

    for (const item of clipboard.items) {
      const newId = tracks.makeSegmentId()
      const seg: AudioSegment = {
        id: newId,
        trackId: pasteTrackId,
        sourceFile: item.sourceFile,
        srcStartSample: item.srcStartSample,
        srcEndSample: item.srcEndSample,
        timelineStart: item.timelineStart,
        timelineEnd: item.timelineEnd,
        f0Data: item.f0Data ? [...item.f0Data] : null,
        f0Extracted: item.f0Data !== null,
        color: tracks.tracks[pasteTrackId].color,
        ignored: false,
      }
      newSegs.push(seg)
      tracks.insertSegment(seg)
    }

    const beforeTree = objectTree.snapshotTree()
    objectTree.syncPastedTrack(pasteTrackId, newSegs)
    const afterTree = objectTree.snapshotTree()
    import('@/commands/copyPaste').then(m => {
      const newTrack = tracks.tracks[pasteTrackId]
      if (!newTrack) return
      const cmd = m.buildPasteCommand({ items: clipboard.items, newSegments: newSegs, newTrack: { ...newTrack, segments: [] } })
      cmd.objectTree = { kind: 'snapshot', before: beforeTree, after: afterTree }
      history.push(cmd)
    })

    objectTreeUi.clearSelection()
    selection.selectAll(newSegs.map(s => s.id), 'segments')
  }

  function mergeSelected() {
    if (selection.count === 0) return
    const tracks = useTracksStore()

    const selectedSegIds: SegmentId[] = []
    const selectedTrackIds: TrackId[] = []
    for (const id of selection.ids) {
      if (id.startsWith('seg_')) selectedSegIds.push(id as SegmentId)
      else if (id.startsWith('trk_')) selectedTrackIds.push(id as TrackId)
    }

    const allSegs = selectedSegIds.map(sid => tracks.getSegment(sid)).filter(Boolean) as AudioSegment[]

    // Case 1: All segments from same track, consecutive
    if (selectedTrackIds.length === 0 && allSegs.length >= 2) {
      const trackId = allSegs[0].trackId
      const allSameTrack = allSegs.every(s => s.trackId === trackId)
      if (allSameTrack) {
        const trackSegs = tracks.getTrackSegments(trackId)
        const indices = allSegs.map(s => trackSegs.indexOf(s)).sort((a, b) => a - b)
        const consecutive = indices.length > 1 && indices.every((v, i) => i === 0 || v === indices[i - 1] + 1)
        if (consecutive) {
          // Merge within track — sort by timelineStart
          const sortedSegs = [...allSegs].sort((a, b) => a.timelineStart - b.timelineStart)
          const tracksStore = useTracksStore()
          const first = sortedSegs[0]
          const last = sortedSegs[sortedSegs.length - 1]
          const mergedId = tracks.makeSegmentId()

          // Check if all segments share the same source file AND don't overlap
          const allSameSource = sortedSegs.every(s => s.sourceFile === first.sourceFile)
          const hasOverlap = checkOverlap(sortedSegs)
          if (!allSameSource || hasOverlap) {
            // Different source files or overlapping → pre-blend audio
            preBlendAndMerge(trackId, sortedSegs, first, last, mergedId, selectedSegIds)
            return
          }

          // No overlap, same source → simple concat
          const mergedF0 = concatF0(sortedSegs, first.timelineStart)

          const merged: AudioSegment = {
            id: mergedId,
            trackId,
            sourceFile: first.sourceFile,
            srcStartSample: Math.min(...sortedSegs.map(s => s.srcStartSample)),
            srcEndSample: Math.max(...sortedSegs.map(s => s.srcEndSample)),
            timelineStart: first.timelineStart,
            timelineEnd: Math.max(...sortedSegs.map(s => s.timelineEnd)),
            f0Data: mergedF0,
            f0Extracted: sortedSegs.some(s => s.f0Extracted),
            color: first.color,
            ignored: false,
          }
          const oldSegs = sortedSegs.map(s => ({ ...s }))
          const objectTree = useObjectTreeStore()
          const beforeTree = objectTree.snapshotTree()
          const sync = objectTree.syncMergedSegments(oldSegs, merged)
          if (!sync.ok) {
            useObjectTreeUiStore().flashNotice(sync.reason || '对象树合并同步失败')
            return
          }
          const afterTree = objectTree.snapshotTree()
          tracks.replaceSegments(trackId, selectedSegIds, [merged])
          selection.select(mergedId, false)

          import('@/commands/merge').then(m => {
            const cmd = m.buildMergeWithinTrackCommand(trackId, oldSegs, merged)
            cmd.objectTree = { kind: 'snapshot', before: beforeTree, after: afterTree }
            history.push(cmd)
          })
          return
        }
      }
    }

    // Cases 2-4: Move all to a new or existing track
    const existingFullTracks = selectedTrackIds.filter(tid => tracks.tracks[tid])
    let targetTrackId: TrackId

    if (existingFullTracks.length > 0) {
      targetTrackId = existingFullTracks[0]
    } else {
      targetTrackId = tracks.makeTrackId()
      tracks.tracks[targetTrackId] = {
        id: targetTrackId,
        name: `合并音轨 ${tracks.trackOrder.length + 1}`,
        trackType: 'audio',
        color: tracks.nextColor(),
        segments: [],
        sourceFile: allSegs[0]?.sourceFile ?? '',
        sampleRate: 44100,
        totalSamples: 0,
        f0Cache: null,
      f0Pending: 0,
      f0Total: 0,
        collapsed: false, muted: false, solo: false, volume: 1, ignored: false,
        boundCompGroupId: null,
      }
      tracks.trackOrder.push(targetTrackId)
    }

    // Move all segments to target track
    for (const seg of allSegs) {
      const oldTrack = tracks.tracks[seg.trackId]
      if (oldTrack) {
        oldTrack.segments = oldTrack.segments.filter(s => s !== seg.id)
      }
      seg.trackId = targetTrackId
      tracks.tracks[targetTrackId].segments.push(seg.id)
    }
    tracks.tracks[targetTrackId].segments.sort((a, b) => {
      const sa = tracks.getSegment(a), sb = tracks.getSegment(b)
      return (sa?.timelineStart ?? 0) - (sb?.timelineStart ?? 0)
    })
    useObjectTreeStore().syncMovedSegments(allSegs)

    selection.selectAll(allSegs.map(s => s.id), 'segments')
  }

  async function preBlendAndMerge(
    trackId: TrackId,
    allSegs: AudioSegment[],
    first: AudioSegment,
    last: AudioSegment,
    mergedId: SegmentId,
    selectedSegIds: SegmentId[],
  ) {
    const tracks = useTracksStore()
    const minTimeline = Math.min(...allSegs.map(s => s.timelineStart))
    const maxTimeline = Math.max(...allSegs.map(s => s.timelineEnd))
    const totalDuration = maxTimeline - minTimeline
    // Use the first segment's track sample rate, fallback 44100
    const firstTrack = tracks.tracks[allSegs[0]?.trackId]
    const outputSr = firstTrack?.sampleRate || 44100
    const totalSamples = Math.round(totalDuration * outputSr)
    const mixed = new Float32Array(totalSamples)

    for (const seg of allSegs) {
      const blob = tracks.sourceBlobs.get(seg.sourceFile)
      if (!blob) continue
      const audioCtx = new AudioContext()
      try {
        const buf = await audioCtx.decodeAudioData(await blob.arrayBuffer())
        const channel = buf.getChannelData(0)
        const actualSr = buf.sampleRate
        const meta = await getAudioBlobMeta(blob)
        const trackSr = meta.sampleRate || tracks.tracks[seg.trackId]?.sampleRate || outputSr
        const startActual = seg.srcStartSample * (actualSr / trackSr)
        const srcLenActual = (seg.srcEndSample - seg.srcStartSample) * (actualSr / trackSr)
        const segLenOut = Math.round((srcLenActual / actualSr) * outputSr)
        const targetStart = Math.round((seg.timelineStart - minTimeline) * outputSr)

        for (let i = 0; i < segLenOut && (targetStart + i) < totalSamples; i++) {
          const srcIdx = Math.round(startActual + (i / Math.max(1, segLenOut - 1)) * srcLenActual)
          if (srcIdx >= 0 && srcIdx < channel.length) {
            mixed[targetStart + i] += channel[srcIdx]
          }
        }
      } finally { audioCtx.close() }
    }

    const syntheticKey = `_merged_${mergedId}.wav`
    const outputBlob = float32ToWavBlob(mixed, outputSr)
    tracks.sourceBlobs.set(syntheticKey, outputBlob)

    // Always re-extract for cross-source merges (new audio)
    const merged: AudioSegment = {
      id: mergedId,
      trackId,
      sourceFile: syntheticKey,
      srcStartSample: 0,
      srcEndSample: totalSamples,
      timelineStart: minTimeline,
      timelineEnd: maxTimeline,
      f0Data: null,
      f0Extracted: false,
      color: first.color,
      ignored: false,
    }
    const oldSegs = allSegs.map(s => ({ ...s }))
    const objectTree = useObjectTreeStore()
    const beforeTree = objectTree.snapshotTree()
    const sync = objectTree.syncMergedSegments(oldSegs, merged)
    if (!sync.ok) {
      useObjectTreeUiStore().flashNotice(sync.reason || '对象树合并同步失败')
      return
    }
    const afterTree = objectTree.snapshotTree()
    tracks.replaceSegments(trackId, selectedSegIds, [merged])
    selection.select(mergedId, false)

    scheduleMergeF0Extraction(merged, trackId)

    import('@/commands/merge').then(m => {
      const cmd = m.buildMergeWithinTrackCommand(trackId, oldSegs, merged)
      cmd.objectTree = { kind: 'snapshot', before: beforeTree, after: afterTree }
      history.push(cmd)
    })
  }

  function deleteSelected() {
    const tracks = useTracksStore()
    const compGroups = useCompGroupsStore()
    const objectTree = useObjectTreeStore()

    for (const id of selection.ids) {
      if (id.startsWith('trk_')) {
        objectTree.syncDeletedTrack(id as TrackId)
        tracks.removeTrack(id as TrackId)
      } else if (id.startsWith('seg_')) {
        const seg = tracks.getSegment(id as SegmentId)
        if (seg) {
          objectTree.syncDeletedSegment({ ...seg })
          const track = tracks.tracks[seg.trackId]
          if (track) {
            track.segments = track.segments.filter(s => s !== seg.id)
          }
          delete tracks.segmentsMap[id as SegmentId]
        }
      } else if (id.startsWith('cgrp_')) {
        const group = compGroups.compGroups[id]
        if (group?.svcResult?.trackId) {
          objectTree.syncDeletedTrack(group.svcResult.trackId)
          tracks.removeTrack(group.svcResult.trackId)
        }
        compGroups.remove(id)
      }
    }
    selection.clear()
  }

  function moveSelectedTimelineObjects(delta: -1 | 1) {
    const tracks = useTracksStore()
    const objectTree = useObjectTreeStore()
    const ui = useObjectTreeUiStore()
    const ids = selection.ids
    if (ids.length === 0) {
      ui.flashNotice('请选择要移动的片段')
      return
    }

    const beforeTree = objectTree.snapshotTree()
    const patches: Patch[] = []
    const inversePatches: Patch[] = []
    let moved = false
    let blocked = false

    for (const id of ids) {
      if (id.startsWith('seg_')) {
        const seg = tracks.getSegment(id as SegmentId)
        if (!seg) continue
        const targetTrackId = adjacentCompatibleTrackId(seg.trackId, delta, 'audio')
        if (!targetTrackId) { blocked = true; continue }
        const oldTrackId = seg.trackId
        const oldColor = seg.color
        const oldTrack = tracks.tracks[seg.trackId]
        const targetTrack = tracks.tracks[targetTrackId]
        const oldTrackSegmentsBefore = oldTrack ? [...oldTrack.segments] : []
        const targetTrackSegmentsBefore = targetTrack ? [...targetTrack.segments] : []
        if (oldTrack) oldTrack.segments = oldTrack.segments.filter(item => item !== seg.id)
        seg.trackId = targetTrackId
        seg.color = tracks.tracks[targetTrackId]?.color ?? seg.color
        if (targetTrack && !targetTrack.segments.includes(seg.id)) {
          targetTrack.segments.push(seg.id)
          targetTrack.segments.sort((a, b) => (tracks.getSegment(a)?.timelineStart ?? 0) - (tracks.getSegment(b)?.timelineStart ?? 0))
        }
        if (oldTrack) {
          patches.push({ op: 'replace', path: `tracks.${oldTrackId}.segments`, value: [...oldTrack.segments] })
          inversePatches.push({ op: 'replace', path: `tracks.${oldTrackId}.segments`, value: oldTrackSegmentsBefore })
        }
        if (targetTrack) {
          patches.push({ op: 'replace', path: `tracks.${targetTrackId}.segments`, value: [...targetTrack.segments] })
          inversePatches.push({ op: 'replace', path: `tracks.${targetTrackId}.segments`, value: targetTrackSegmentsBefore })
        }
        patches.push({ op: 'replace', path: `segments.${seg.id}.trackId`, value: targetTrackId })
        inversePatches.push({ op: 'replace', path: `segments.${seg.id}.trackId`, value: oldTrackId })
        patches.push({ op: 'replace', path: `segments.${seg.id}.color`, value: seg.color })
        inversePatches.push({ op: 'replace', path: `segments.${seg.id}.color`, value: oldColor })
        moved = true
        continue
      }

      if (id.startsWith('node:trackObject:')) {
        const node = objectTree.node(id)
        if (!node || node.kind !== 'trackObject') continue
        const parentId = objectTree.index.parentById[id]
        const currentTrackId = parentId?.startsWith('node:trackFolder:') ? parentId.slice('node:trackFolder:'.length) : null
        if (!currentTrackId) { blocked = true; continue }
        const targetTrackId = adjacentCompatibleTrackId(currentTrackId, delta, node.trackObject.contentType)
        if (!targetTrackId) { blocked = true; continue }
        const result = objectTree.moveNode(id, `node:trackFolder:${targetTrackId}`)
        if (!result.ok) { blocked = true; continue }
        moved = true
      }
    }

    if (!moved) {
      ui.flashNotice(blocked ? '相邻音轨类型不匹配或不存在' : '没有可移动的片段')
      return
    }

    const movedSegments = ids
      .filter(id => id.startsWith('seg_'))
      .map(id => tracks.getSegment(id as SegmentId))
      .filter((seg): seg is AudioSegment => Boolean(seg))
    if (movedSegments.length > 0) objectTree.syncMovedSegments(movedSegments)

    const afterTree = objectTree.snapshotTree()
    history.push({
      description: delta < 0 ? '上移片段到上一音轨' : '下移片段到下一音轨',
      patches,
      inversePatches,
      objectTree: { kind: 'snapshot', before: beforeTree, after: afterTree },
    })
    useProjectStore().bumpRedraw()
    if (blocked) ui.flashNotice('部分片段未移动：相邻音轨类型不匹配或不存在')
  }

  function adjacentCompatibleTrackId(currentTrackId: TrackId, delta: -1 | 1, contentType: 'audio' | 'midi' | 'text'): TrackId | null {
    const tracks = useTracksStore()
    const currentIndex = tracks.trackOrder.indexOf(currentTrackId)
    if (currentIndex < 0) return null
    const targetId = tracks.trackOrder[currentIndex + delta]
    if (!targetId) return null
    const targetTrack = tracks.tracks[targetId]
    const targetType = targetTrack?.trackType ?? 'audio'
    return targetType === contentType ? targetId : null
  }

  function handleSpacebar() {
    ;(window as any).__playbackPlay?.()
  }

  function saveProject() {
    ;(window as any).__saveProject?.()
  }

  function loadProject() {
    ;(window as any).__loadProject?.()
  }

  function locateTrackObjectShortcut() {
    const objectTree = useObjectTreeStore()
    const ui = useObjectTreeUiStore()
    const leftNodeId = singleObjectTreeSelection()
    const leftNode = leftNodeId ? objectTree.node(leftNodeId) : null
    if (!leftNode && leftNodeId?.startsWith('node:trackObject:')) {
      const segmentId = segmentIdFromTrackObjectId(leftNodeId)
      if (segmentId) {
        ;(window as any).__timelineLocateSegment?.(segmentId)
        return
      }
    }
    if (leftNode?.kind === 'trackObject') {
      const segmentId = leftNode.legacy?.segmentId
      if (segmentId) {
        ;(window as any).__timelineLocateSegment?.(segmentId)
        return
      }
      ;(window as any).__timelineLocateTrackObject?.(leftNode.id)
      return
    }
    if (leftNode?.kind === 'audio') {
      const ref = trackObjectReferencingSource(leftNode.id)
      if (ref) {
        const segmentId = ref.legacy?.segmentId
        if (segmentId) {
          ;(window as any).__timelineLocateSegment?.(segmentId)
          return
        }
        ;(window as any).__timelineLocateTrackObject?.(ref.id)
        return
      }
    }

    const trackObjectId = trackObjectIdFromLegacySelection()
    if (trackObjectId) {
      if (objectTree.node(trackObjectId)) {
        locateInL2(trackObjectId)
        return
      }
      return
    }

    ui.flashNotice('请选择一个时间线对象')
  }

  function locateAudioShortcut() {
    const ui = useObjectTreeUiStore()
    const audio = currentAudioObject()
    if (!audio) {
      ui.flashNotice('当前选择无法定位音频')
      return
    }
    locateInL2(audio.id)
  }

  function locateBoundObjectShortcut(kind: 'midi' | 'text') {
    const ui = useObjectTreeUiStore()
    const objectTree = useObjectTreeStore()
    const audio = currentAudioObject()
    if (!audio) {
      ui.flashNotice('当前选择无法追溯音频')
      return
    }
    const targetId = kind === 'midi' ? audio.audio.midiObjectId : audio.audio.textObjectId
    if (!targetId || !objectTree.node(targetId)) {
      ui.flashNotice(kind === 'midi' ? '该音频尚未生成 MIDI' : '该音频尚未关联歌词')
      return
    }
    locateInL2(targetId)
  }

  function currentAudioObject(): AudioObjectNode | null {
    const objectTree = useObjectTreeStore()
    const selectedNodeId = singleObjectTreeSelection()
    const selectedNode = selectedNodeId ? objectTree.node(selectedNodeId) : null
    if (selectedNode?.kind === 'audio') return selectedNode
    if (selectedNode?.kind === 'trackObject') return sourceAudioFromTrackObject(selectedNode)

    const trackObjectId = trackObjectIdFromLegacySelection()
    const trackObject = trackObjectId ? objectTree.node(trackObjectId) : null
    if (trackObject?.kind === 'trackObject') return sourceAudioFromTrackObject(trackObject)
    return null
  }

  function sourceAudioFromTrackObject(trackObject: TrackObjectNode): AudioObjectNode | null {
    const objectTree = useObjectTreeStore()
    const source = objectTree.node(trackObject.trackObject.sourceObjectId)
    return source?.kind === 'audio' ? source : null
  }

  function trackObjectReferencingSource(sourceObjectId: NodeId): TrackObjectNode | null {
    const objectTree = useObjectTreeStore()
    const nodes = Object.values(objectTree.index.nodes)
    return nodes.find((node): node is TrackObjectNode => {
      return node.kind === 'trackObject' && node.trackObject.sourceObjectId === sourceObjectId
    }) ?? null
  }

  function singleObjectTreeSelection(): NodeId | null {
    const ui = useObjectTreeUiStore()
    return ui.selectedIds.length === 1 ? ui.selectedIds[0] : null
  }

  function trackObjectIdFromLegacySelection(): NodeId | null {
    if (selection.ids.length !== 1) return null
    const objectTree = useObjectTreeStore()
    const selected = selection.ids[0]
    if (selected.startsWith('node:trackObject:')) return selected
    if (selected.startsWith('seg_')) {
      return objectTree.legacyMaps?.trackObjectIdBySegmentId[selected] ?? `node:trackObject:${selected}`
    }
    return null
  }

  function segmentIdFromTrackObjectId(trackObjectId: NodeId): string | null {
    const objectTree = useObjectTreeStore()
    const trackObject = objectTree.node(trackObjectId)
    if (trackObject?.kind === 'trackObject') return trackObject.legacy?.segmentId ?? null
    const prefix = 'node:trackObject:'
    return trackObjectId.startsWith(prefix) ? trackObjectId.slice(prefix.length) : null
  }

  function locateInL2(id: NodeId) {
    const objectTree = useObjectTreeStore()
    const ui = useObjectTreeUiStore()
    ui.locateInL2(objectTree.index.parentById, id)
    nextTick(() => {
      document.getElementById(rowDomId('L2', id))?.scrollIntoView({ block: 'nearest' })
    })
  }

  function rowDomId(pane: 'L1' | 'L2', id: NodeId) {
    return `tree-row-${pane}-${cssSafeId(id)}`
  }

  function cssSafeId(id: NodeId) {
    return id.replace(/[^a-zA-Z0-9_-]/g, '_')
  }

  // ── F0 merge helpers ──

  function checkOverlap(segs: AudioSegment[]): boolean {
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const a = segs[i], b = segs[j]
        if (a.timelineEnd > b.timelineStart && b.timelineEnd > a.timelineStart) return true
      }
    }
    return false
  }

  function concatF0(segs: AudioSegment[], baseTimeline: number): F0Frame[] | null {
    let result: F0Frame[] | null = null
    for (const seg of segs) {
      if (!seg.f0Data) continue
      const offset = seg.timelineStart - baseTimeline
      for (const f of seg.f0Data) {
        if (!result) result = []
        result.push({ ...f, t: f.t + offset })
      }
    }
    return result
  }

  async function scheduleMergeF0Extraction(merged: AudioSegment, trackId: TrackId) {
    const tracks = useTracksStore()
    const blob = tracks.sourceBlobs.get(merged.sourceFile)
    if (!blob) {
      merged.f0Extracted = true
      tracks.tracks[trackId] && tracks.reconcileF0ForTrack(trackId)
      return
    }

    try {
      const totalDuration = merged.timelineEnd - merged.timelineStart
      const b64 = await new Promise<string>(resolve => {
        const r = new FileReader()
        r.onload = () => resolve((r.result as string).split(',')[1])
        r.readAsDataURL(blob)
      })

      const body = { wavBase64: b64, sourceFile: merged.sourceFile, startSec: 0, endSec: totalDuration }

      const resp = await fetch('/api/f0/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await resp.json()
      if (json.data?.length) {
        merged.f0Data = json.data
      }
    } catch {} finally {
      merged.f0Extracted = true
      if (tracks.tracks[trackId]) {
        const t = tracks.tracks[trackId]
        t.f0Pending = Math.max(0, (t.f0Pending || 0) - 1)
        useProjectStore().bumpRedraw()
      }
    }
  }

  onMounted(() => document.addEventListener('keydown', handler))
  onUnmounted(() => document.removeEventListener('keydown', handler))
}


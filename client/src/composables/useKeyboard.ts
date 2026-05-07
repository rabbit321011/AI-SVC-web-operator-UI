import { onMounted, onUnmounted } from 'vue'
import { useHistoryStore } from '@/stores/history'
import { useSelectionStore } from '@/stores/selection'
import { useClipboardStore } from '@/stores/clipboard'
import { useTracksStore } from '@/stores/tracks'
import { useCompGroupsStore } from '@/stores/compGroups'
import { useProjectStore } from '@/stores/project'
import { float32ToWavBlob } from '@/api/wav'
import type { AudioSegment, SegmentId, TrackId, DeepCopySegment, F0Frame } from '@/types'

export function useKeyboard() {
  const history = useHistoryStore()
  const selection = useSelectionStore()
  const clipboard = useClipboardStore()

  function handler(e: KeyboardEvent) {
    const ctrl = e.ctrlKey || e.metaKey
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

    if (e.key === ' ') { e.preventDefault(); handleSpacebar(); return }
    if (ctrl && e.key === 'z' && !e.shiftKey) { e.preventDefault(); history.undo(); return }
    if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); history.redo(); return }
    if (ctrl && e.key === 's') { e.preventDefault(); saveProject(); return }
    if (ctrl && e.key === 'o') { e.preventDefault(); loadProject(); return }
    if (ctrl && e.key === 'c') { e.preventDefault(); clipboard.copy(); return }
    if (ctrl && e.key === 'v') { e.preventDefault(); pasteFromClipboard(); return }
    if (ctrl && e.key === 'b') { e.preventDefault(); mergeSelected(); return }
    if (e.key === 'Delete' || e.key === 'Del') { e.preventDefault(); deleteSelected(); return }

    if (e.key === 'Enter') {
      e.preventDefault()
      const compGroups = useCompGroupsStore()
      const elements = compGroups.buildElementsFromSelection()
      if (elements.length > 0) {
        compGroups.create(elements)
        selection.clear()
      }
      return
    }
  }

  function pasteFromClipboard() {
    if (!clipboard.hasContent) return
    const tracks = useTracksStore()
    const newSegs: AudioSegment[] = []

    // always paste to a new track
    const pasteTrackId = tracks.makeTrackId()
    const num = tracks.trackOrder.length + 1
    tracks.tracks[pasteTrackId] = {
      id: pasteTrackId,
      name: `粘贴 ${num}`,
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

    import('@/commands/copyPaste').then(m => {
      history.push(m.buildPasteCommand({ items: clipboard.items, newSegments: newSegs }))
    })

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
          tracks.replaceSegments(trackId, selectedSegIds, [merged])
          selection.select(mergedId, false)

          const oldSegs = sortedSegs.map(s => ({ ...s }))
          import('@/commands/merge').then(m => {
            history.push(m.buildMergeWithinTrackCommand(trackId, oldSegs, merged))
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
        // Source sample count → normalize to actual decode rate
        const trackSr = tracks.tracks[seg.trackId]?.sampleRate || outputSr
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
    tracks.replaceSegments(trackId, selectedSegIds, [merged])
    selection.select(mergedId, false)

    scheduleMergeF0Extraction(merged, trackId)

    const oldSegs = allSegs.map(s => ({ ...s }))
    import('@/commands/merge').then(m => {
      history.push(m.buildMergeWithinTrackCommand(trackId, oldSegs, merged))
    })
  }

  function deleteSelected() {
    const tracks = useTracksStore()
    const compGroups = useCompGroupsStore()

    for (const id of selection.ids) {
      if (id.startsWith('trk_')) {
        tracks.removeTrack(id as TrackId)
      } else if (id.startsWith('seg_')) {
        const seg = tracks.getSegment(id as SegmentId)
        if (seg) {
          const track = tracks.tracks[seg.trackId]
          if (track) {
            track.segments = track.segments.filter(s => s !== seg.id)
          }
          delete tracks.segmentsMap[id as SegmentId]
        }
      } else if (id.startsWith('cgrp_')) {
        const group = compGroups.compGroups[id]
        if (group?.svcResult?.trackId) {
          tracks.removeTrack(group.svcResult.trackId)
        }
        compGroups.remove(id)
      }
    }
    selection.clear()
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

      let url = '/api/f0/extract'
      let body: any = { wavBase64: b64, sourceFile: merged.sourceFile }

      if (totalDuration <= 60) {
        body = { wavBase64: b64, sourceFile: merged.sourceFile }
      } else {
        body = { wavBase64: b64, sourceFile: merged.sourceFile }
        url = '/api/f0/extract-overlap'
        // Extract just the overlap region + buffer
        const overlapStart = Math.max(0, merged.timelineStart)
        const overlapEnd = merged.timelineEnd
        body.startSec = Math.max(0, overlapStart - 2)
        body.endSec = overlapEnd + 2
      }

      const resp = await fetch(url, {
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


import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import type { Track, TrackId, SegmentId, AudioSegment } from '@/types'

const TRACK_COLORS = [
  '#58a6ff', '#f78166', '#7ee787', '#d2a8ff',
  '#ffa28b', '#a5d6ff', '#ffcc66', '#56d4dd',
  '#e6edf3', '#f0883e', '#b392f0', '#79c0ff',
]

let colorIdx = 0
function nextColor(): string {
  return TRACK_COLORS[colorIdx++ % TRACK_COLORS.length]
}

function makeSegmentId(): SegmentId {
  return 'seg_' + crypto.randomUUID().slice(0, 8)
}
function makeTrackId(): TrackId {
  return 'trk_' + crypto.randomUUID().slice(0, 8)
}

export const useTracksStore = defineStore('tracks', () => {
  const tracks = reactive<Record<TrackId, Track>>({})
  const trackOrder = ref<TrackId[]>([])

  const segmentsMap = reactive<Record<SegmentId, AudioSegment>>({})
  const sourceBlobs = new Map<string, Blob>()

  function addTrack(sourceFile: string, sampleRate: number, totalSamples: number, name?: string, sourceBlob?: Blob): TrackId {
    const id = makeTrackId()
    const color = nextColor()
    const segId = makeSegmentId()
    const duration = totalSamples / sampleRate

    const seg: AudioSegment = {
      id: segId,
      trackId: id,
      sourceFile,
      srcStartSample: 0,
      srcEndSample: totalSamples,
      timelineStart: 0,
      timelineEnd: duration,
      f0Data: null,
      f0Extracted: false,
      color,
      ignored: false,
    }

    const trkNum = trackOrder.value.length + 1
    const track: Track = {
      id,
      name: name || `音轨 ${trkNum}`,
      color,
      segments: [segId],
      sourceFile,
      sampleRate,
      totalSamples,
      f0Cache: null,
      f0Pending: 0,
      f0Total: 0,
      collapsed: false,
      muted: false,
      solo: false,
      volume: 1,
      ignored: false,
      boundCompGroupId: null,
    }

    tracks[id] = track
    trackOrder.value.push(id)
    segmentsMap[segId] = seg
    if (sourceBlob) sourceBlobs.set(sourceFile, sourceBlob)

    return id
  }

  function removeTrack(id: TrackId) {
    const track = tracks[id]
    if (!track) return
    for (const sid of track.segments) {
      delete segmentsMap[sid]
    }
    delete tracks[id]
    trackOrder.value = trackOrder.value.filter(t => t !== id)
  }

  function renameTrack(id: TrackId, newName: string) {
    if (tracks[id]) tracks[id].name = newName
  }

  function reorderTracks(fromIdx: number, toIdx: number) {
    const arr = trackOrder.value
    if (fromIdx < 0 || fromIdx >= arr.length || toIdx < 0 || toIdx >= arr.length) return
    const [moved] = arr.splice(fromIdx, 1)
    arr.splice(toIdx, 0, moved)
  }

  function getSegment(sid: SegmentId): AudioSegment | undefined {
    return segmentsMap[sid]
  }

  function updateSegment(sid: SegmentId, patch: Partial<AudioSegment>) {
    const seg = segmentsMap[sid]
    if (seg) Object.assign(seg, patch)
  }

  function replaceSegments(trackId: TrackId, oldIds: SegmentId[], newSegs: AudioSegment[]) {
    const track = tracks[trackId]
    if (!track) return
    for (const oid of oldIds) delete segmentsMap[oid]
    for (const ns of newSegs) segmentsMap[ns.id] = ns
    track.segments = track.segments.filter(s => !oldIds.includes(s))
    track.segments.push(...newSegs.map(ns => ns.id))
    track.segments.sort((a, b) => {
      const sa = segmentsMap[a], sb = segmentsMap[b]
      return (sa?.timelineStart ?? 0) - (sb?.timelineStart ?? 0)
    })
  }

  function insertSegment(seg: AudioSegment) {
    segmentsMap[seg.id] = seg
    const track = tracks[seg.trackId]
    if (track) {
      track.segments.push(seg.id)
      track.segments.sort((a, b) => {
        const sa = segmentsMap[a], sb = segmentsMap[b]
        return (sa?.timelineStart ?? 0) - (sb?.timelineStart ?? 0)
      })
    }
  }

  function getAllSegments(): AudioSegment[] {
    return Object.values(segmentsMap)
  }

  function getTrackSegments(trackId: TrackId): AudioSegment[] {
    const track = tracks[trackId]
    if (!track) return []
    return track.segments.map(sid => segmentsMap[sid]).filter(Boolean) as AudioSegment[]
  }

  // F0 reconciliation — called after track segments change (import/paste/merge/load/SVC)
  let f0RunningForTrack: string | null = null

  function getSegBlob(seg: AudioSegment): Blob | undefined {
    return sourceBlobs.get(seg.sourceFile) || sourceBlobs.get(seg.trackId)
  }

  async function reconcileF0ForTrack(trackId: TrackId) {
    const track = tracks[trackId]
    if (!track) return

    if (f0RunningForTrack === trackId) return

    const segs = getTrackSegments(trackId)
    const needsExtraction = segs.filter(s => !s.f0Extracted && s.sourceFile && getSegBlob(s))

    track.f0Total = needsExtraction.length
    track.f0Pending = needsExtraction.length

    if (needsExtraction.length === 0) {
      projectBump()
      return
    }

    f0RunningForTrack = trackId
    for (const seg of needsExtraction) {
      if (!tracks[trackId]) { f0RunningForTrack = null; return }
      try {
        const blob = getSegBlob(seg)
        if (!blob || blob.size > 100 * 1024 * 1024) {
          track.f0Pending = Math.max(0, track.f0Pending - 1)
          seg.f0Extracted = true
          projectBump()
          continue
        }
        const b64 = await blobToBase64(blob)
        const resp = await fetch('/api/f0/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wavBase64: b64, sourceFile: seg.sourceFile, sampleRate: track.sampleRate }),
        })
        const json = await resp.json()
        if (json.data?.length) {
          seg.f0Data = json.data
          seg.f0Extracted = true
        } else {
          seg.f0Extracted = true
        }
      } catch {
        seg.f0Extracted = true
      } finally {
        if (tracks[trackId]) {
          track.f0Pending = Math.max(0, track.f0Pending - 1)
          projectBump()
        }
      }
    }
    f0RunningForTrack = null
  }

  function blobToBase64(blob: Blob): Promise<string> {
    return new Promise(resolve => {
      const r = new FileReader()
      r.onload = () => resolve((r.result as string).split(',')[1])
      r.readAsDataURL(blob)
    })
  }

  function projectBump() { useProjectStore().bumpRedraw() }

  return {
    tracks, trackOrder, segmentsMap, sourceBlobs,
    addTrack, removeTrack, renameTrack, reorderTracks,
    getSegment, updateSegment, replaceSegments, insertSegment,
    getAllSegments, getTrackSegments,
    reconcileF0ForTrack,
    makeSegmentId, makeTrackId, nextColor,
  }
})

import { useProjectStore } from './project'
function useProjectBump() { useProjectStore().bumpRedraw() }

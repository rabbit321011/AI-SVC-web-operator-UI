import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import type { Track, TrackId, SegmentId, AudioSegment } from '@/types'
import { getAudioBlobMeta } from '@/utils/audioMeta'

export interface TracksStateSnapshot {
  tracks: Record<TrackId, Track>
  trackOrder: TrackId[]
  segmentsMap: Record<SegmentId, AudioSegment>
}

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
      trackType: 'audio',
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

  function addObjectTrack(trackType: 'audio' | 'midi' | 'text', name?: string): TrackId {
    const id = makeTrackId()
    const color = trackType === 'text' ? '#56d4dd' : nextColor()
    const trkNum = trackOrder.value.length + 1
    tracks[id] = {
      id,
      name: name || `${trackType} ${trkNum}`,
      trackType,
      color,
      segments: [],
      sourceFile: '',
      sampleRate: 0,
      totalSamples: 0,
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
    trackOrder.value.push(id)
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

  function setTrackColor(id: TrackId, color: string) {
    const track = tracks[id]
    if (!track) return
    track.color = color
    for (const segmentId of track.segments) {
      if (segmentsMap[segmentId]) segmentsMap[segmentId].color = color
    }
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

  function snapshotState(): TracksStateSnapshot {
    return JSON.parse(JSON.stringify({ tracks, trackOrder: trackOrder.value, segmentsMap })) as TracksStateSnapshot
  }

  function restoreState(snapshot: TracksStateSnapshot) {
    for (const key of Object.keys(tracks)) delete tracks[key]
    for (const key of Object.keys(segmentsMap)) delete segmentsMap[key]
    Object.assign(tracks, JSON.parse(JSON.stringify(snapshot.tracks)))
    Object.assign(segmentsMap, JSON.parse(JSON.stringify(snapshot.segmentsMap)))
    trackOrder.value = [...snapshot.trackOrder]
  }

  // F0 reconciliation — called after track segments change (import/paste/merge/load/SVC)
  let f0RunningForTrack: string | null = null

  function getSegBlob(seg: AudioSegment): Blob | undefined {
    return sourceBlobs.get(seg.sourceFile) || sourceBlobs.get(seg.trackId)
  }

  async function reconcileF0ForTrack(trackId: TrackId, force = false) {
    const track = tracks[trackId]
    if (!track) return

    if (f0RunningForTrack === trackId) return

    const segs = getTrackSegments(trackId)
    const needsExtraction = segs.filter(s => (!s.f0Extracted || hasStaleF0Window(s)) && s.sourceFile && getSegBlob(s))

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
        if (!blob || (blob.size > 100 * 1024 * 1024 && !force)) {
          track.f0Pending = Math.max(0, track.f0Pending - 1)
          seg.f0Extracted = true
          projectBump()
          continue
        }
        const meta = await getAudioBlobMeta(blob)
        const sourceSampleRate = meta.sampleRate || track.sampleRate || 44100
        const startSec = Math.max(0, seg.srcStartSample / sourceSampleRate)
        const endSec = Math.max(startSec, seg.srcEndSample / sourceSampleRate)
        const segmentDuration = Math.max(0, seg.timelineEnd - seg.timelineStart)
        const b64 = await blobToBase64(blob)
        const resp = await fetch('/api/f0/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wavBase64: b64, sourceFile: seg.sourceFile, startSec, endSec }),
        })
        if (!resp.ok) throw new Error(`F0 extraction failed (${resp.status})`)
        const json = await resp.json()
        if (Array.isArray(json.data) && json.data.length > 0) {
          seg.f0Data = json.data
            .map((frame: { t: number; freq: number; prob: number }) => ({
              ...frame,
              t: Math.max(0, Number((frame.t - startSec).toFixed(6))),
            }))
            .filter((frame: { t: number }) => frame.t <= segmentDuration + 0.05)
          seg.f0Extracted = true
        } else {
          seg.f0Data = null
          seg.f0Extracted = false
        }
      } catch {
        seg.f0Data = null
        seg.f0Extracted = false
      } finally {
        if (tracks[trackId]) {
          track.f0Pending = Math.max(0, track.f0Pending - 1)
          projectBump()
        }
      }
    }
    f0RunningForTrack = null
  }

  async function forceReconcileF0ForTrack(trackId: TrackId) {
    const track = tracks[trackId]
    if (!track || (track.trackType ?? 'audio') !== 'audio') return
    for (const segment of getTrackSegments(trackId)) {
      segment.f0Data = null
      segment.f0Extracted = false
    }
    track.f0Cache = null
    track.f0Pending = 0
    track.f0Total = 0
    projectBump()
    await reconcileF0ForTrack(trackId, true)
  }

  function blobToBase64(blob: Blob): Promise<string> {
    return new Promise(resolve => {
      const r = new FileReader()
      r.onload = () => resolve((r.result as string).split(',')[1])
      r.readAsDataURL(blob)
    })
  }

  function hasStaleF0Window(seg: AudioSegment): boolean {
    if (!seg.f0Data?.length) return false
    const duration = Math.max(0, seg.timelineEnd - seg.timelineStart)
    const maxT = Math.max(...seg.f0Data.map(frame => frame.t))
    return maxT > duration + 0.25
  }

  function projectBump() { useProjectStore().bumpRedraw() }

  return {
    tracks, trackOrder, segmentsMap, sourceBlobs,
    addTrack, addObjectTrack, removeTrack, renameTrack, setTrackColor, reorderTracks,
    getSegment, updateSegment, replaceSegments, insertSegment,
    getAllSegments, getTrackSegments, snapshotState, restoreState,
    reconcileF0ForTrack, forceReconcileF0ForTrack,
    makeSegmentId, makeTrackId, nextColor,
  }
})

import { useProjectStore } from './project'
function useProjectBump() { useProjectStore().bumpRedraw() }

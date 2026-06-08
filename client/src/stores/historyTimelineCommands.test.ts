import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { AudioSegment, Track } from '@/types'
import { buildMergeWithinTrackCommand } from '@/commands/merge'
import { buildSplitCommand } from '@/commands/split'
import { useHistoryStore } from './history'
import { useTracksStore } from './tracks'

describe('timeline history commands', () => {
  it('undoes merge after split back to the split segments, then undoes split back to the original segment', () => {
    setActivePinia(createPinia())
    const tracks = useTracksStore()
    const history = useHistoryStore()
    tracks.tracks.trk_a = track('trk_a', ['seg_a'])
    tracks.trackOrder = ['trk_a']
    tracks.segmentsMap.seg_a = segment('seg_a', 0, 2)

    const original = { ...tracks.segmentsMap.seg_a }
    const segB = segment('seg_b', 0, 1)
    const segC = segment('seg_c', 1, 2)
    tracks.replaceSegments('trk_a', ['seg_a'], [segB, segC])
    history.push(buildSplitCommand({ trackId: 'trk_a', segment: original, cutTime: 1, sampleRate: 48000 }, segB, segC))

    const merged = segment('seg_merged', 0, 2)
    const oldSegs = [segB, segC].map(seg => ({ ...seg }))
    tracks.replaceSegments('trk_a', ['seg_b', 'seg_c'], [merged])
    history.push(buildMergeWithinTrackCommand('trk_a', oldSegs, merged))

    history.undo()
    expect(tracks.tracks.trk_a.segments).toEqual(['seg_b', 'seg_c'])
    expect(Object.keys(tracks.segmentsMap).sort()).toEqual(['seg_b', 'seg_c'])

    history.undo()
    expect(tracks.tracks.trk_a.segments).toEqual(['seg_a'])
    expect(Object.keys(tracks.segmentsMap)).toEqual(['seg_a'])
  })
})

function track(id: string, segments: string[]): Track {
  return {
    id,
    name: 'Track',
    color: '#58a6ff',
    segments,
    sourceFile: 'old.wav',
    sampleRate: 48000,
    totalSamples: 96000,
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
}

function segment(id: string, timelineStart: number, timelineEnd: number): AudioSegment {
  return {
    id,
    trackId: 'trk_a',
    sourceFile: 'old.wav',
    srcStartSample: timelineStart * 48000,
    srcEndSample: timelineEnd * 48000,
    timelineStart,
    timelineEnd,
    f0Data: null,
    f0Extracted: false,
    color: '#58a6ff',
    ignored: false,
  }
}

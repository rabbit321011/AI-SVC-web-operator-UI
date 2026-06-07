import { describe, expect, it } from 'vitest'
import type { Project } from '@/types'
import { legacyProjectToObjectTree, makeRenderInputRef, validateRenderSlot } from './index'

describe('render input slot validation', () => {
  it('accepts audio TrackObject for SVC audio slots', () => {
    const { tree, maps } = legacyProjectToObjectTree(makeProject())
    const input = makeRenderInputRef(tree, 'trackObject', maps.trackObjectIdBySegmentId.seg_a)

    expect(validateRenderSlot(tree, 'svc.condAudio', input)).toMatchObject({ ok: true, mediaType: 'audio' })
    expect(validateRenderSlot(tree, 'svc.sourceAudio', input)).toMatchObject({ ok: true, mediaType: 'audio' })
  })

  it('rejects missing or mismatched refs', () => {
    const { tree, maps } = legacyProjectToObjectTree(makeProject())
    const input = makeRenderInputRef(tree, 'trackObject', maps.trackObjectIdBySegmentId.seg_a)

    expect(validateRenderSlot(tree, 'svs.text', input)).toMatchObject({ ok: false, mediaType: 'audio' })
    expect(validateRenderSlot(tree, 'svc.condAudio', { ...input, id: 'missing' })).toMatchObject({ ok: false, reason: '原对象不存在' })
  })
})

function makeProject(): Project {
  return {
    id: 'project_a',
    name: 'Fixture',
    version: '1.0.0',
    tracks: {
      trk_a: {
        id: 'trk_a',
        name: 'Voice',
        color: '#58a6ff',
        segments: ['seg_a'],
        sourceFile: 'voice.wav',
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
      },
    },
    trackOrder: ['trk_a'],
    segments: {
      seg_a: {
        id: 'seg_a',
        trackId: 'trk_a',
        sourceFile: 'voice.wav',
        srcStartSample: 0,
        srcEndSample: 96000,
        timelineStart: 0,
        timelineEnd: 2,
        f0Data: null,
        f0Extracted: false,
        color: '#58a6ff',
        ignored: false,
      },
    },
    compGroups: {},
    compGroupOrder: [],
    timelineOffset: 0,
    pxPerSec: 60,
    f0Settings: { fmin: 65.4, fmax: 2093, algorithm: 'pyin', hopMs: 16 },
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-01-01T00:00:00.000Z',
  }
}

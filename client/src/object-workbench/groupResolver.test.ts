import { describe, expect, it } from 'vitest'
import type { Project } from '@/types'
import {
  buildNodeIndex,
  createGroupObject,
  getGroupTrackObjectIdsSorted,
  legacyProjectToObjectTree,
  resolveGroupObjectInput,
  resolveTrackObjectInput,
} from './index'

describe('GroupObject creation and render input resolution', () => {
  it('creates a live GroupObject sorted by TrackObject timelineStart', () => {
    const { tree, maps } = legacyProjectToObjectTree(makeProject())
    const group = createGroupObject(tree, {
      id: 'node:group:new',
      name: 'New Group',
      trackObjectIds: [
        maps.trackObjectIdBySegmentId.seg_b,
        maps.trackObjectIdBySegmentId.seg_a,
      ],
    })

    expect(group.group.mediaType).toBe('audio')
    expect(group.group.trackObjectIds).toEqual([
      maps.trackObjectIdBySegmentId.seg_a,
      maps.trackObjectIdBySegmentId.seg_b,
    ])
    expect(buildNodeIndex(tree.root).parentById[group.id]).toBe('project:/groups')
  })

  it('sorts live GroupObject members at read time after TrackObject movement', () => {
    const { tree, maps } = legacyProjectToObjectTree(makeProject())
    const groupId = 'node:group:new'
    createGroupObject(tree, {
      id: groupId,
      name: 'New Group',
      trackObjectIds: [
        maps.trackObjectIdBySegmentId.seg_a,
        maps.trackObjectIdBySegmentId.seg_b,
      ],
    })

    const segA = buildNodeIndex(tree.root).nodes[maps.trackObjectIdBySegmentId.seg_a]
    if (segA?.kind !== 'trackObject') throw new Error('expected TrackObject')
    segA.trackObject.timelineStart = 10
    segA.trackObject.timelineEnd = 12

    expect(getGroupTrackObjectIdsSorted(tree, groupId)).toEqual([
      maps.trackObjectIdBySegmentId.seg_b,
      maps.trackObjectIdBySegmentId.seg_a,
    ])
  })

  it('resolves an audio GroupObject to relative temporary media items', () => {
    const { tree, maps } = legacyProjectToObjectTree(makeProject())
    const group = createGroupObject(tree, {
      id: 'node:group:new',
      name: 'New Group',
      trackObjectIds: [
        maps.trackObjectIdBySegmentId.seg_a,
        maps.trackObjectIdBySegmentId.seg_b,
      ],
    })

    const resolved = resolveGroupObjectInput(tree, group.id)

    expect(resolved.mediaType).toBe('audio')
    expect(resolved.sourceStart).toBe(2)
    expect(resolved.sourceEnd).toBe(8)
    expect(resolved.duration).toBe(6)
    expect(resolved.items.map(item => item.relativeStart)).toEqual([0, 4])
    expect(resolved.items.map(item => item.assetId)).toEqual(['asset:legacy:seg_a', 'asset:legacy:seg_b'])
    expect(resolved.warnings).toEqual([])
  })

  it('skips ignored TrackObjects and returns warnings', () => {
    const { tree, maps } = legacyProjectToObjectTree(makeProject())
    const ignored = buildNodeIndex(tree.root).nodes[maps.trackObjectIdBySegmentId.seg_a]
    if (ignored?.kind !== 'trackObject') throw new Error('expected TrackObject')
    ignored.trackObject.ignored = true

    const group = createGroupObject(tree, {
      id: 'node:group:new',
      name: 'New Group',
      trackObjectIds: [
        maps.trackObjectIdBySegmentId.seg_a,
        maps.trackObjectIdBySegmentId.seg_b,
      ],
    })

    const resolved = resolveGroupObjectInput(tree, group.id)

    expect(resolved.items).toHaveLength(1)
    expect(resolved.items[0].trackObjectId).toBe(maps.trackObjectIdBySegmentId.seg_b)
    expect(resolved.sourceStart).toBe(6)
    expect(resolved.duration).toBe(2)
    expect(resolved.warnings).toEqual([`Ignored TrackObject skipped: ${maps.trackObjectIdBySegmentId.seg_a}`])
  })

  it('resolves a single TrackObject input with zero relative start', () => {
    const { tree, maps } = legacyProjectToObjectTree(makeProject())
    const resolved = resolveTrackObjectInput(tree, maps.trackObjectIdBySegmentId.seg_b)

    expect(resolved.sourceStart).toBe(6)
    expect(resolved.sourceEnd).toBe(8)
    expect(resolved.items).toHaveLength(1)
    expect(resolved.items[0].relativeStart).toBe(0)
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
        segments: ['seg_a', 'seg_b'],
        sourceFile: 'voice.wav',
        sampleRate: 48000,
        totalSamples: 384000,
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
      seg_a: segment('seg_a', 2, 4),
      seg_b: segment('seg_b', 6, 8),
    },
    compGroups: {},
    compGroupOrder: [],
    timelineOffset: 0,
    pxPerSec: 60,
    f0Settings: {
      fmin: 65.4,
      fmax: 2093,
      algorithm: 'pyin',
      hopMs: 16,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-01-01T00:00:00.000Z',
  }
}

function segment(id: string, timelineStart: number, timelineEnd: number): Project['segments'][string] {
  return {
    id,
    trackId: 'trk_a',
    sourceFile: `${id}.wav`,
    srcStartSample: 0,
    srcEndSample: (timelineEnd - timelineStart) * 48000,
    timelineStart,
    timelineEnd,
    f0Data: null,
    f0Extracted: false,
    color: '#58a6ff',
    ignored: false,
  }
}

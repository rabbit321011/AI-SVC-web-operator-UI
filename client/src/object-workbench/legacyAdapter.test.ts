import { describe, expect, it } from 'vitest'
import type { Project } from '@/types'
import { TOP_LEVEL_IDS, buildNodeIndex, legacyProjectToObjectTree } from './index'

describe('legacy project object tree adapter', () => {
  it('adapts legacy tracks and segments into trackSources and tracks', () => {
    const project = makeLegacyProject()
    const result = legacyProjectToObjectTree(project)
    const index = buildNodeIndex(result.tree.root)

    const sourceObjectId = result.maps.sourceObjectIdBySegmentId.seg_a
    const trackObjectId = result.maps.trackObjectIdBySegmentId.seg_a
    const trackFolderId = result.maps.trackFolderIdByTrackId.trk_a

    expect(result.warnings).toEqual([])
    expect(index.parentById[sourceObjectId]).toBe(`${TOP_LEVEL_IDS.trackSources}/audio`)
    expect(index.parentById[trackObjectId]).toBe(trackFolderId)
    expect(index.parentById[trackFolderId]).toBe(TOP_LEVEL_IDS.tracks)
    expect(result.tree.assets['asset:legacy:seg_a']).toMatchObject({
      sampleRate: 48000,
      duration: 2,
      blobKey: 'voice.wav',
    })
  })

  it('adapts legacy comp groups to live track object id lists', () => {
    const project = makeLegacyProject()
    const result = legacyProjectToObjectTree(project)
    const groupObjectId = result.maps.groupObjectIdByCompGroupId.cgrp_a
    const groupNode = buildNodeIndex(result.tree.root).nodes[groupObjectId]

    expect(groupNode?.kind).toBe('group')
    if (groupNode?.kind !== 'group') throw new Error('expected group node')
    expect(groupNode.group.trackObjectIds).toEqual([result.maps.trackObjectIdBySegmentId.seg_a])
  })

  it('records warnings instead of throwing for missing legacy references', () => {
    const project = makeLegacyProject()
    project.tracks.trk_a.segments.push('seg_missing')
    project.compGroups.cgrp_a.elements.push({ type: 'segment', id: 'seg_missing', startTime: 2, endTime: 3 })

    const result = legacyProjectToObjectTree(project)

    expect(result.warnings).toContain('Missing segment referenced by track trk_a: seg_missing')
    expect(result.warnings).toContain('Comp group references missing segment: seg_missing')
  })
})

function makeLegacyProject(): Project {
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
        timelineStart: 1,
        timelineEnd: 3,
        f0Data: null,
        f0Extracted: false,
        color: '#58a6ff',
        ignored: false,
      },
    },
    compGroups: {
      cgrp_a: {
        id: 'cgrp_a',
        name: 'Group A',
        elements: [{ type: 'segment', id: 'seg_a', startTime: 1, endTime: 3 }],
        combinedAudio: null,
        svcResult: null,
        collapsed: false,
        expanded: false,
      },
    },
    compGroupOrder: ['cgrp_a'],
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

import { describe, expect, it } from 'vitest'
import {
  buildDeleteTrackObjectCommand,
  buildMergeTrackObjectsCommand,
  buildMoveTrackObjectCommand,
  buildNodeIndex,
  buildSplitTrackObjectCommand,
  executeSemanticCommand,
  legacyProjectToObjectTree,
  undoSemanticCommand,
} from './index'
import type { Project } from '@/types'
import type { AudioObjectNode, TrackObjectNode } from './types'

describe('TrackObject semantic commands', () => {
  it('moves a TrackObject in time and can undo', () => {
    const { tree, maps } = legacyProjectToObjectTree(makeProject())
    const trackObjectId = maps.trackObjectIdBySegmentId.seg_a
    const cmd = buildMoveTrackObjectCommand({ trackObjectId, timelineStart: 5, timelineEnd: 7 })

    executeSemanticCommand(tree, cmd)
    expect(trackObject(tree, trackObjectId).trackObject.timelineStart).toBe(5)
    expect(trackObject(tree, trackObjectId).trackObject.timelineEnd).toBe(7)
    expect(groupIds(tree)).toEqual([trackObjectId])

    undoSemanticCommand(tree, cmd)
    expect(trackObject(tree, trackObjectId).trackObject.timelineStart).toBe(0)
    expect(trackObject(tree, trackObjectId).trackObject.timelineEnd).toBe(2)
  })

  it('splits a TrackObject, replaces source objects, updates Group refs, and can undo', () => {
    const { tree, maps } = legacyProjectToObjectTree(makeProject())
    const oldTrackObjectId = maps.trackObjectIdBySegmentId.seg_a
    const oldSourceObjectId = maps.sourceObjectIdBySegmentId.seg_a
    const [newA, newB] = splitTrackObjects(oldTrackObjectId, oldSourceObjectId)
    const [srcA, srcB] = splitSources(oldSourceObjectId)
    const cmd = buildSplitTrackObjectCommand({
      oldTrackObjectId,
      newTrackObjects: [newA, newB],
      newSourceObjects: [srcA, srcB],
    })

    executeSemanticCommand(tree, cmd)
    const indexAfter = buildNodeIndex(tree.root)
    expect(indexAfter.nodes[oldTrackObjectId]).toBeUndefined()
    expect(indexAfter.nodes[oldSourceObjectId]).toBeUndefined()
    expect(groupIds(tree)).toEqual([newA.id, newB.id])

    undoSemanticCommand(tree, cmd)
    const indexUndo = buildNodeIndex(tree.root)
    expect(indexUndo.nodes[oldTrackObjectId]?.kind).toBe('trackObject')
    expect(indexUndo.nodes[oldSourceObjectId]?.kind).toBe('audio')
    expect(groupIds(tree)).toEqual([oldTrackObjectId])
  })

  it('merges fully contained TrackObjects, updates Group refs, and can undo', () => {
    const { tree, maps } = legacyProjectToObjectTree(makeProjectWithTwoSegmentsInGroup())
    const oldIds = [maps.trackObjectIdBySegmentId.seg_a, maps.trackObjectIdBySegmentId.seg_b]
    const newSource = audioSource('node:source:audio:merged', 'asset:legacy:merged')
    const newTrackObject = trackObjectNode('node:trackObject:merged', newSource.id, 0, 4)
    const cmd = buildMergeTrackObjectsCommand({
      oldTrackObjectIds: oldIds,
      newTrackObject,
      newSourceObject: newSource,
    })

    executeSemanticCommand(tree, cmd)
    const indexAfter = buildNodeIndex(tree.root)
    expect(indexAfter.nodes[oldIds[0]]).toBeUndefined()
    expect(indexAfter.nodes[oldIds[1]]).toBeUndefined()
    expect(indexAfter.nodes[newTrackObject.id]?.kind).toBe('trackObject')
    expect(groupIds(tree)).toEqual([newTrackObject.id])

    undoSemanticCommand(tree, cmd)
    const indexUndo = buildNodeIndex(tree.root)
    expect(indexUndo.nodes[oldIds[0]]?.kind).toBe('trackObject')
    expect(indexUndo.nodes[oldIds[1]]?.kind).toBe('trackObject')
    expect(indexUndo.nodes[newTrackObject.id]).toBeUndefined()
    expect(groupIds(tree)).toEqual(oldIds)
  })

  it('blocks merge when a Group partially contains the merge set', () => {
    const { tree, maps } = legacyProjectToObjectTree(makeProject())
    const oldIds = [maps.trackObjectIdBySegmentId.seg_a, maps.trackObjectIdBySegmentId.seg_b]
    const cmd = buildMergeTrackObjectsCommand({
      oldTrackObjectIds: oldIds,
      newTrackObject: trackObjectNode('node:trackObject:merged', 'node:source:audio:merged', 0, 4),
      newSourceObject: audioSource('node:source:audio:merged', 'asset:legacy:merged'),
    })

    expect(() => executeSemanticCommand(tree, cmd)).toThrow('only partially contains')
  })

  it('deletes a TrackObject with its source, updates Group refs, and can undo', () => {
    const { tree, maps } = legacyProjectToObjectTree(makeProject())
    const trackObjectId = maps.trackObjectIdBySegmentId.seg_a
    const sourceObjectId = maps.sourceObjectIdBySegmentId.seg_a
    const cmd = buildDeleteTrackObjectCommand({ trackObjectId })

    executeSemanticCommand(tree, cmd)
    const indexAfter = buildNodeIndex(tree.root)
    expect(indexAfter.nodes[trackObjectId]).toBeUndefined()
    expect(indexAfter.nodes[sourceObjectId]).toBeUndefined()
    expect(groupIds(tree)).toEqual([])

    undoSemanticCommand(tree, cmd)
    const indexUndo = buildNodeIndex(tree.root)
    expect(indexUndo.nodes[trackObjectId]?.kind).toBe('trackObject')
    expect(indexUndo.nodes[sourceObjectId]?.kind).toBe('audio')
    expect(groupIds(tree)).toEqual([trackObjectId])
  })
})

function trackObject(tree: ReturnType<typeof legacyProjectToObjectTree>['tree'], id: string): TrackObjectNode {
  const node = buildNodeIndex(tree.root).nodes[id]
  if (node?.kind !== 'trackObject') throw new Error('expected TrackObject')
  return node
}

function groupIds(tree: ReturnType<typeof legacyProjectToObjectTree>['tree']) {
  const group = Object.values(buildNodeIndex(tree.root).nodes).find(node => node.kind === 'group')
  if (group?.kind !== 'group') throw new Error('expected GroupObject')
  return group.group.trackObjectIds
}

function splitTrackObjects(oldTrackObjectId: string, oldSourceObjectId: string): [TrackObjectNode, TrackObjectNode] {
  return [
    trackObjectNode(`${oldTrackObjectId}:a`, `${oldSourceObjectId}:a`, 0, 1),
    trackObjectNode(`${oldTrackObjectId}:b`, `${oldSourceObjectId}:b`, 1, 2),
  ]
}

function splitSources(oldSourceObjectId: string): [AudioObjectNode, AudioObjectNode] {
  return [
    audioSource(`${oldSourceObjectId}:a`, 'asset:legacy:seg_a:a'),
    audioSource(`${oldSourceObjectId}:b`, 'asset:legacy:seg_a:b'),
  ]
}

function trackObjectNode(id: string, sourceObjectId: string, timelineStart: number, timelineEnd: number): TrackObjectNode {
  return {
    id,
    kind: 'trackObject',
    name: id,
    trackObject: {
      contentType: 'audio',
      sourceObjectId,
      timelineStart,
      timelineEnd,
      ignored: false,
    },
  }
}

function audioSource(id: string, assetId: string): AudioObjectNode {
  return {
    id,
    kind: 'audio',
    name: id,
    audio: {
      assetId,
      midiObjectId: null,
      textObjectId: null,
    },
  }
}

function makeProjectWithTwoSegmentsInGroup(): Project {
  const project = makeProject()
  project.compGroups.cgrp_a.elements = [
    { type: 'segment', id: 'seg_a', startTime: 0, endTime: 2 },
    { type: 'segment', id: 'seg_b', startTime: 2, endTime: 4 },
  ]
  return project
}

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
        totalSamples: 192000,
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
      seg_a: segment('seg_a', 0, 2),
      seg_b: segment('seg_b', 2, 4),
    },
    compGroups: {
      cgrp_a: {
        id: 'cgrp_a',
        name: 'Group A',
        elements: [{ type: 'segment', id: 'seg_a', startTime: 0, endTime: 2 }],
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

function segment(id: string, timelineStart: number, timelineEnd: number): Project['segments'][string] {
  return {
    id,
    trackId: 'trk_a',
    sourceFile: 'voice.wav',
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

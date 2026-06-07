import { describe, expect, it } from 'vitest'
import type { Project } from '@/types'
import {
  buildNodeIndex,
  createGroupObject,
  legacyProjectToObjectTree,
  makeRenderInputRef,
  resolveAudioRenderInputToSegmentInputs,
} from './index'

describe('audio render input resolver', () => {
  it('turns an audio TrackObject into combine segment input', async () => {
    const project = makeProject()
    const { tree, maps } = legacyProjectToObjectTree(project)
    const blob = new Blob(['a'])
    const input = makeRenderInputRef(tree, 'trackObject', maps.trackObjectIdBySegmentId.seg_a)

    const resolved = await resolveAudioRenderInputToSegmentInputs({
      tree,
      input,
      sourceBlobs: new Map([['seg_a.wav', blob]]),
      tracks: project.tracks,
      segments: project.segments,
    })

    expect(resolved.sourceStart).toBe(2)
    expect(resolved.sourceEnd).toBe(4)
    expect(resolved.duration).toBe(2)
    expect(resolved.sampleRate).toBe(48000)
    expect(resolved.segmentInputs).toEqual([
      {
        blob,
        startSample: 24000,
        endSample: 120000,
        timelineStart: 0,
        sampleRate: 48000,
        volume: 0.5,
      },
    ])
  })

  it('preserves GroupObject relative gaps and skips ignored members', async () => {
    const project = makeProject()
    const { tree, maps } = legacyProjectToObjectTree(project)
    const ignored = buildNodeIndex(tree.root).nodes[maps.trackObjectIdBySegmentId.seg_b]
    if (ignored?.kind !== 'trackObject') throw new Error('expected TrackObject')
    ignored.trackObject.ignored = true
    const group = createGroupObject(tree, {
      id: 'node:group:render',
      name: 'Render group',
      trackObjectIds: [
        maps.trackObjectIdBySegmentId.seg_a,
        maps.trackObjectIdBySegmentId.seg_b,
        maps.trackObjectIdBySegmentId.seg_c,
      ],
    })

    const resolved = await resolveAudioRenderInputToSegmentInputs({
      tree,
      input: makeRenderInputRef(tree, 'group', group.id),
      sourceBlobs: new Map([
        ['seg_a.wav', new Blob(['a'])],
        ['seg_b.wav', new Blob(['b'])],
        ['seg_c.wav', new Blob(['c'])],
      ]),
      tracks: project.tracks,
      segments: project.segments,
    })

    expect(resolved.sourceStart).toBe(2)
    expect(resolved.sourceEnd).toBe(9)
    expect(resolved.segmentInputs.map(seg => seg.timelineStart)).toEqual([0, 5])
    expect(resolved.segmentInputs.map(seg => seg.startSample)).toEqual([24000, 0])
    expect(resolved.warnings).toEqual([`Ignored TrackObject skipped: ${maps.trackObjectIdBySegmentId.seg_b}`])
  })

  it('uses asset metadata when there is no legacy segment', async () => {
    const { tree } = legacyProjectToObjectTree(makeProject())
    const trackObject = buildNodeIndex(tree.root).nodes['node:trackObject:seg_a']
    const source = buildNodeIndex(tree.root).nodes['node:source:audio:seg_a']
    if (trackObject?.kind !== 'trackObject' || source?.kind !== 'audio') throw new Error('expected fixture nodes')
    delete trackObject.legacy
    delete source.legacy
    tree.assets[source.audio.assetId] = {
      id: source.audio.assetId,
      storage: 'projectBlob',
      blobKey: 'object.wav',
      sampleRate: 32000,
      duration: 1.5,
      channels: 1,
    }

    const resolved = await resolveAudioRenderInputToSegmentInputs({
      tree,
      input: makeRenderInputRef(tree, 'trackObject', trackObject.id),
      sourceBlobs: new Map([['object.wav', new Blob(['x'])]]),
    })

    expect(resolved.segmentInputs[0]).toMatchObject({
      startSample: 0,
      endSample: 48000,
      sampleRate: 32000,
      timelineStart: 0,
    })
  })

  it('uses whole AudioObject input for SVC cond audio', async () => {
    const { tree } = legacyProjectToObjectTree(makeProject())
    const source = buildNodeIndex(tree.root).nodes['node:source:audio:seg_a']
    if (source?.kind !== 'audio') throw new Error('expected audio source')
    tree.assets[source.audio.assetId] = {
      id: source.audio.assetId,
      storage: 'projectBlob',
      blobKey: 'cond.wav',
      sampleRate: 44100,
      duration: 3,
      channels: 1,
    }

    const resolved = await resolveAudioRenderInputToSegmentInputs({
      tree,
      input: makeRenderInputRef(tree, 'audioObject', source.id),
      sourceBlobs: new Map([['cond.wav', new Blob(['cond'])]]),
    })

    expect(resolved.sourceStart).toBe(0)
    expect(resolved.sourceEnd).toBe(3)
    expect(resolved.segmentInputs[0]).toMatchObject({
      startSample: 0,
      endSample: 132300,
      timelineStart: 0,
      sampleRate: 44100,
      volume: 1,
    })
  })

  it('fails clearly when the audio blob is missing', async () => {
    const project = makeProject()
    const { tree, maps } = legacyProjectToObjectTree(project)

    await expect(resolveAudioRenderInputToSegmentInputs({
      tree,
      input: makeRenderInputRef(tree, 'trackObject', maps.trackObjectIdBySegmentId.seg_a),
      sourceBlobs: new Map(),
      tracks: project.tracks,
      segments: project.segments,
    })).rejects.toThrow('Audio blob does not exist')
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
        segments: ['seg_a', 'seg_b', 'seg_c'],
        sourceFile: 'voice.wav',
        sampleRate: 48000,
        totalSamples: 432000,
        f0Cache: null,
        f0Pending: 0,
        f0Total: 0,
        collapsed: false,
        muted: false,
        solo: false,
        volume: 0.5,
        ignored: false,
        boundCompGroupId: null,
      },
    },
    trackOrder: ['trk_a'],
    segments: {
      seg_a: segment('seg_a', 2, 4, 24000, 120000),
      seg_b: segment('seg_b', 5, 6, 0, 48000),
      seg_c: segment('seg_c', 7, 9, 0, 96000),
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

function segment(id: string, timelineStart: number, timelineEnd: number, srcStartSample: number, srcEndSample: number): Project['segments'][string] {
  return {
    id,
    trackId: 'trk_a',
    sourceFile: `${id}.wav`,
    srcStartSample,
    srcEndSample,
    timelineStart,
    timelineEnd,
    f0Data: null,
    f0Extracted: false,
    color: '#58a6ff',
    ignored: false,
  }
}

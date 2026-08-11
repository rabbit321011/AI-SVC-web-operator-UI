import { describe, expect, it } from 'vitest'
import type { Project } from '@/types'
import { legacyProjectToObjectTree } from './legacyAdapter'
import { resolveOwnedGuideSource } from './ownedGuide'

describe('Owned Guide source resolver', () => {
  it('uses a timeline AudioObject effective sample range and timeline start', async () => {
    const project = makeProject()
    const { tree, maps } = legacyProjectToObjectTree(project)
    const resolved = await resolveOwnedGuideSource({
      tree,
      sourceAudioObjectId: maps.sourceObjectIdBySegmentId.seg_a,
      sourceBlobs: new Map([['voice.wav', new Blob(['audio'])]]),
      segments: project.segments,
      tracks: project.tracks,
    })

    expect(resolved.effectiveStartSample).toBe(48000)
    expect(resolved.effectiveEndSampleExclusive).toBe(144000)
    expect(resolved.defaultTimelineStart).toBe(7.5)
    expect(resolved.resolved.duration).toBe(2)
    expect(JSON.parse(resolved.resolverManifest)).toMatchObject({
      schema: 'aisvc.owned-guide-resolver.v1',
      inputKind: 'trackObject',
      sourceTimelineStart: 7.5,
    })
  })

  it('uses the whole asset when the AudioObject is not placed on the timeline', async () => {
    const project = makeProject()
    const { tree, maps } = legacyProjectToObjectTree(project)
    const sourceId = maps.sourceObjectIdBySegmentId.seg_a
    const source = findSource(tree, sourceId)
    delete source.legacy
    removeTrackObject(tree, maps.trackObjectIdBySegmentId.seg_a)
    tree.assets[source.audio.assetId] = {
      id: source.audio.assetId,
      storage: 'projectBlob',
      blobKey: 'whole.wav',
      sampleRate: 44100,
      duration: 3,
      channels: 2,
    }

    const resolved = await resolveOwnedGuideSource({
      tree,
      sourceAudioObjectId: sourceId,
      sourceBlobs: new Map([['whole.wav', new Blob(['audio'])]]),
    })

    expect(resolved.effectiveStartSample).toBe(0)
    expect(resolved.effectiveEndSampleExclusive).toBe(132300)
    expect(resolved.defaultTimelineStart).toBeNull()
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
        totalSamples: 480000,
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
        srcStartSample: 48000,
        srcEndSample: 144000,
        timelineStart: 7.5,
        timelineEnd: 9.5,
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

function findSource(tree: ReturnType<typeof legacyProjectToObjectTree>['tree'], id: string) {
  const sources = tree.root.children.find(node => node.id === 'project:/trackSources')
  if (!sources || sources.kind !== 'folder') throw new Error('missing trackSources')
  const audio = sources.children.find(node => node.kind === 'folder')
  if (!audio || audio.kind !== 'folder') throw new Error('missing audio sources')
  const source = audio.children.find(node => node.id === id)
  if (!source || source.kind !== 'audio') throw new Error('missing audio source')
  return source
}

function removeTrackObject(tree: ReturnType<typeof legacyProjectToObjectTree>['tree'], id: string) {
  const tracks = tree.root.children.find(node => node.id === 'project:/tracks')
  if (!tracks || tracks.kind !== 'folder') throw new Error('missing tracks')
  for (const child of tracks.children) {
    if (child.kind !== 'trackFolder') continue
    child.children = child.children.filter(node => node.id !== id)
  }
}

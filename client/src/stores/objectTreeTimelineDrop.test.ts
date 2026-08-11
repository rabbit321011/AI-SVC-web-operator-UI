import { describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { TOP_LEVEL_IDS, createEmptyProjectObjectTree, createEmptySynthesisUnit } from '@/object-workbench'
import type { AudioObjectNode, FolderNode } from '@/object-workbench'
import { useObjectTreeStore } from './objectTree'
import { useTracksStore } from './tracks'
import { float32ToWavBlob } from '@/api/wav'

describe('AudioObject drag into timeline', () => {
  it('creates a dedicated TrackObject when dragging a workspace SynthesisUnit', async () => {
    setActivePinia(createPinia())
    const objectTree = useObjectTreeStore()
    const tracks = useTracksStore()
    const tree = createEmptyProjectObjectTree()
    const unit = createEmptySynthesisUnit({
      id: 'node:synthesisUnit:workspace',
      name: 'Verse SYN',
      defaultTimelineStart: null,
      guide: {
        assetId: 'asset:guide',
        audioSHA256: 'a'.repeat(64),
        sampleRate: 44100,
        channels: 1,
        sampleCount: 88200,
        duration: 2,
        source: {
          sourceAudioObjectId: 'node:audio:guide',
          sourceAssetId: 'asset:audio:guide',
          effectiveStartSample: 0,
          effectiveEndSampleExclusive: 88200,
          sourceTimelineStart: null,
          resolverManifest: 'fixture',
        },
      },
    })
    workspace(tree).children.push(unit)
    objectTree.loadObjectTree(tree)

    const result = await objectTree.dropAudioObjectToTimeline(unit.id, 4)

    expect(result.ok).toBe(true)
    expect(tracks.trackOrder).toEqual([result.trackId])
    expect(tracks.tracks[result.trackId!].segments).toEqual([])
    expect(unit.synthesisUnit.timelineTrackId).toBe(result.trackId)
    expect(unit.synthesisUnit.defaultTimelineStart).toBe(4)
    const trackObjects = Object.values(objectTree.index.nodes).filter(node => node.kind === 'trackObject')
    expect(trackObjects).toHaveLength(1)
    expect(trackObjects[0]).toMatchObject({
      trackObject: {
        sourceObjectId: unit.id,
        timelineStart: 4,
        timelineEnd: 6,
      },
    })

    expect(objectTree.deleteNode(trackObjects[0]!.id)).toEqual({ ok: true })
    const retainedUnit = objectTree.node(unit.id)
    expect(retainedUnit?.kind).toBe('synthesisUnit')
    expect(retainedUnit?.kind === 'synthesisUnit' ? retainedUnit.synthesisUnit.timelineTrackId : undefined).toBeNull()
    expect(retainedUnit?.kind === 'synthesisUnit' ? retainedUnit.synthesisUnit.defaultTimelineStart : undefined).toBeNull()
    expect(Object.values(objectTree.index.nodes).some(node => node.kind === 'trackObject')).toBe(false)
  })

  it('copies workspace AudioObject to trackSources and creates legacy Track/Segment plus TrackObject', async () => {
    setActivePinia(createPinia())
    mockAudioContext()
    const objectTree = useObjectTreeStore()
    const tracks = useTracksStore()
    const tree = createEmptyProjectObjectTree()
    tree.assets['asset:workspace'] = {
      id: 'asset:workspace',
      storage: 'projectBlob',
      blobKey: 'voice.wav',
      sampleRate: 0,
      duration: 0,
      channels: 0,
    }
    workspace(tree).children.push(audio('node:workspace:audio', 'asset:workspace'))
    objectTree.loadObjectTree(tree)
    tracks.sourceBlobs.set('voice.wav', new Blob(['fake']))

    const result = await objectTree.dropAudioObjectToTimeline('node:workspace:audio', 3)

    expect(result.ok).toBe(true)
    expect(tracks.trackOrder).toHaveLength(1)
    const seg = tracks.getSegment(result.segmentId!)
    expect(seg?.timelineStart).toBe(3)
    expect(seg?.timelineEnd).toBe(5)
    expect(objectTree.index.nodes['node:workspace:audio']).toBeTruthy()
    const trackSourceChildren = workspaceLike(objectTree.tree.root.children.find(child => child.id === TOP_LEVEL_IDS.trackSources)!).children
    expect(trackSourceChildren.some(child => child.kind === 'audio')).toBe(true)
    const tracksChildren = workspaceLike(objectTree.tree.root.children.find(child => child.id === TOP_LEVEL_IDS.tracks)!).children
    expect(tracksChildren.some(child => child.kind === 'trackFolder')).toBe(true)
  })

  it('archives rendered SVC audio and backfills a timeline TrackObject', async () => {
    setActivePinia(createPinia())
    mockAudioContext()
    const objectTree = useObjectTreeStore()
    const tracks = useTracksStore()
    objectTree.loadObjectTree(createEmptyProjectObjectTree())

    const result = await objectTree.addRenderedAudioToTimeline({
      blob: new Blob(['rendered']),
      outputFileName: 'svc result',
      renderKind: 'svc',
      timelineStart: 7,
    })

    expect(result.ok).toBe(true)
    expect(result.outputFileName).toBe('svc result.wav')
    expect(tracks.trackOrder).toHaveLength(1)
    const seg = tracks.getSegment(result.segmentId!)
    expect(seg?.timelineStart).toBe(7)
    expect(seg?.timelineEnd).toBe(9)

    const renderRoot = workspaceLike(objectTree.tree.root.children.find(child => child.id === TOP_LEVEL_IDS.renders)!)
    const svcFolder = workspaceLike(renderRoot.children.find(child => child.name === 'svc')!)
    expect(svcFolder.children.some(child => child.id === result.renderObjectId && child.kind === 'audio')).toBe(true)

    const trackSourcesRoot = workspaceLike(objectTree.tree.root.children.find(child => child.id === TOP_LEVEL_IDS.trackSources)!)
    const audioFolder = workspaceLike(trackSourcesRoot.children.find(child => child.name === 'audio')!)
    expect(audioFolder.children.some(child => child.id === result.trackSourceObjectId && child.kind === 'audio')).toBe(true)
    expect(objectTree.node(result.trackObjectId!)?.kind).toBe('trackObject')
  })

  it('archives rendered MSST audio under renders/msst and backfills audio TrackObject', async () => {
    setActivePinia(createPinia())
    mockAudioContext()
    const objectTree = useObjectTreeStore()
    const tracks = useTracksStore()
    objectTree.loadObjectTree(createEmptyProjectObjectTree())

    const result = await objectTree.addRenderedAudioToTimeline({
      blob: new Blob(['stem']),
      outputFileName: 'vocals',
      renderKind: 'msst',
      timelineStart: 4,
    })

    expect(result.ok).toBe(true)
    expect(tracks.trackOrder).toHaveLength(1)
    expect(tracks.getSegment(result.segmentId!)?.timelineStart).toBe(4)

    const renderRoot = workspaceLike(objectTree.tree.root.children.find(child => child.id === TOP_LEVEL_IDS.renders)!)
    const msstFolder = workspaceLike(renderRoot.children.find(child => child.name === 'msst')!)
    expect(msstFolder.children.some(child => child.id === result.renderObjectId && child.kind === 'audio')).toBe(true)
    expect(objectTree.node(result.trackObjectId!)?.kind).toBe('trackObject')
  })

  it('reads rendered WAV metadata without decoding the full file and stores one shared blob', async () => {
    setActivePinia(createPinia())
    const decodeAudioData = vi.fn(() => { throw new Error('WAV metadata should not require AudioContext') })
    vi.stubGlobal('AudioContext', class {
      decodeAudioData = decodeAudioData
      close = vi.fn()
    })
    try {
      const objectTree = useObjectTreeStore()
      const tracks = useTracksStore()
      objectTree.loadObjectTree(createEmptyProjectObjectTree())
      const blob = float32ToWavBlob(new Float32Array(96_000), 48_000)

      const result = await objectTree.addRenderedAudioToTimeline({
        blob,
        outputFileName: 'large stem',
        renderKind: 'msst',
      })

      expect(result.ok).toBe(true)
      expect(decodeAudioData).not.toHaveBeenCalled()
      expect(tracks.sourceBlobs.size).toBe(1)
      expect(tracks.getSegment(result.segmentId!)?.timelineEnd).toBe(2)
      const render = objectTree.node(result.renderObjectId!) as AudioObjectNode
      const trackSource = objectTree.node(result.trackSourceObjectId!) as AudioObjectNode
      expect(objectTree.tree.assets[render.audio.assetId].blobKey).toBe(objectTree.tree.assets[trackSource.audio.assetId].blobKey)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('archives rendered Whisper text and backfills a text TrackObject', () => {
    setActivePinia(createPinia())
    const objectTree = useObjectTreeStore()
    const tracks = useTracksStore()
    objectTree.loadObjectTree(createEmptyProjectObjectTree())

    const result = objectTree.addRenderedTextToTimeline({
      outputName: 'whisper result',
      renderKind: 'whisper',
      segments: [
        { start: 0, kana: 'きみ', romaji: 'ki mi' },
        { start: 1.5, kana: 'のこえ', romaji: 'no ko e' },
      ],
      sourceAudioObjectId: 'node:source:audio',
      timelineStart: 6,
      timelineEnd: 9,
    })

    expect(result.ok).toBe(true)
    expect(result.outputName).toBe('whisper result')
    expect(tracks.trackOrder).toHaveLength(1)
    const textTrack = tracks.tracks[tracks.trackOrder[0]]
    expect(textTrack.trackType).toBe('text')
    expect(textTrack.name).toBe('whisper result')

    const renderRoot = workspaceLike(objectTree.tree.root.children.find(child => child.id === TOP_LEVEL_IDS.renders)!)
    const whisperFolder = workspaceLike(renderRoot.children.find(child => child.name === 'whisper')!)
    const renderObject = whisperFolder.children.find(child => child.id === result.renderObjectId)
    expect(renderObject?.kind).toBe('text')

    const trackSourcesRoot = workspaceLike(objectTree.tree.root.children.find(child => child.id === TOP_LEVEL_IDS.trackSources)!)
    const textFolder = workspaceLike(trackSourcesRoot.children.find(child => child.name === 'text')!)
    expect(textFolder.children.some(child => child.id === result.trackSourceObjectId && child.kind === 'text')).toBe(true)

    const trackObject = objectTree.node(result.trackObjectId!)
    expect(trackObject?.kind).toBe('trackObject')
    if (trackObject?.kind !== 'trackObject') throw new Error('expected TrackObject')
    expect(trackObject.trackObject.contentType).toBe('text')
    expect(trackObject.trackObject.timelineStart).toBe(6)
    expect(trackObject.trackObject.timelineEnd).toBe(9)

    const trackSource = objectTree.node(result.trackSourceObjectId!)
    expect(trackSource?.kind).toBe('text')
    if (trackSource?.kind !== 'text') throw new Error('expected TextObject')
    expect(trackSource.text.segments[0].id).toBeTruthy()
    expect(trackSource.text.segments[0].end).toBe(1.5)
    expect(trackSource.text.segments[1].end).toBe(2.5)
  })
})

function mockAudioContext() {
  class MockAudioContext {
    async decodeAudioData() {
      return { sampleRate: 48000, duration: 2, numberOfChannels: 1 }
    }
    close = vi.fn()
  }
  vi.stubGlobal('AudioContext', MockAudioContext)
}

function workspace(tree: ReturnType<typeof createEmptyProjectObjectTree>): FolderNode {
  return workspaceLike(tree.root.children.find(child => child.id === TOP_LEVEL_IDS.workspace)!)
}

function workspaceLike(node: unknown): FolderNode {
  if (!node || typeof node !== 'object' || (node as any).kind !== 'folder') throw new Error('expected folder')
  return node as FolderNode
}

function audio(id: string, assetId: string): AudioObjectNode {
  return {
    id,
    kind: 'audio',
    name: 'voice.wav',
    audio: {
      assetId,
      midiObjectId: null,
      textObjectId: null,
    },
  }
}

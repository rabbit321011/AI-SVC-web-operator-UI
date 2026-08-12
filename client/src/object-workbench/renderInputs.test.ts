import { describe, expect, it } from 'vitest'
import type { Project } from '@/types'
import type { AudioObjectNode, MidiObjectNode, ProjectObjectTree, TextObjectNode, TrackFolderNode, TrackObjectContentType, TrackObjectNode } from './types'
import { buildNodeIndex, createEmptyProjectObjectTree, createEmptySynthesisUnit, createGroupObject, legacyProjectToObjectTree, makeRenderInputRef, TOP_LEVEL_IDS, validateRenderSlot } from './index'

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

    expect(validateRenderSlot(tree, 'svs.targetText', input)).toMatchObject({ ok: false, mediaType: 'audio' })
    expect(validateRenderSlot(tree, 'svc.condAudio', { ...input, id: 'missing' })).toMatchObject({ ok: false, reason: '原对象不存在' })
  })

  it('accepts ordinary AudioObject for SVC cond and SVS timbre audio', () => {
    const { tree, maps } = legacyProjectToObjectTree(makeProject())
    const trackObject = buildNodeIndex(tree.root).nodes[maps.trackObjectIdBySegmentId.seg_a]
    if (trackObject?.kind !== 'trackObject') throw new Error('expected TrackObject')
    const input = makeRenderInputRef(tree, 'audioObject', trackObject.trackObject.sourceObjectId)

    expect(validateRenderSlot(tree, 'svc.condAudio', input)).toMatchObject({ ok: true, mediaType: 'audio' })
    expect(validateRenderSlot(tree, 'svs.timbreAudio', input)).toMatchObject({ ok: true, mediaType: 'audio' })
    expect(validateRenderSlot(tree, 'whisper.audio', input)).toMatchObject({ ok: true, mediaType: 'audio' })
    expect(validateRenderSlot(tree, 'msst.audio', input)).toMatchObject({ ok: true, mediaType: 'audio' })
    expect(validateRenderSlot(tree, 'svc.sourceAudio', input)).toMatchObject({ ok: false, mediaType: 'audio' })
    expect(validateRenderSlot(tree, 'svs.melody', input)).toMatchObject({ ok: false, mediaType: 'audio' })
  })

  it('validates SVS timbre, melody, and text slot media types', () => {
    const tree = makeSvsTree()
    const audioTrackObject = makeRenderInputRef(tree, 'trackObject', 'node:trackObject:audio')
    const midiTrackObject = makeRenderInputRef(tree, 'trackObject', 'node:trackObject:midi')
    const textTrackObject = makeRenderInputRef(tree, 'trackObject', 'node:trackObject:text')
    const synthesisTrackObject = makeRenderInputRef(tree, 'trackObject', 'node:trackObject:synthesis')

    const audioGroup = createGroupObject(tree, {
      id: 'node:group:audio',
      name: 'Audio Group',
      trackObjectIds: ['node:trackObject:audio'],
    })
    const midiGroup = createGroupObject(tree, {
      id: 'node:group:midi',
      name: 'Midi Group',
      trackObjectIds: ['node:trackObject:midi'],
    })
    const textGroup = createGroupObject(tree, {
      id: 'node:group:text',
      name: 'Text Group',
      trackObjectIds: ['node:trackObject:text'],
    })

    expect(validateRenderSlot(tree, 'svs.timbreAudio', audioTrackObject)).toMatchObject({ ok: true, mediaType: 'audio' })
    expect(validateRenderSlot(tree, 'whisper.audio', audioTrackObject)).toMatchObject({ ok: true, mediaType: 'audio' })
    expect(validateRenderSlot(tree, 'msst.audio', audioTrackObject)).toMatchObject({ ok: true, mediaType: 'audio' })
    expect(validateRenderSlot(tree, 'whisper.audio', midiTrackObject)).toMatchObject({ ok: false, mediaType: 'midi' })
    expect(validateRenderSlot(tree, 'msst.audio', textTrackObject)).toMatchObject({ ok: false, mediaType: 'text' })
    expect(validateRenderSlot(tree, 'svs.timbreAudio', midiTrackObject)).toMatchObject({ ok: false, mediaType: 'midi' })
    expect(validateRenderSlot(tree, 'svs.melody', audioTrackObject)).toMatchObject({ ok: true, mediaType: 'audio' })
    expect(validateRenderSlot(tree, 'svs.melody', midiTrackObject)).toMatchObject({ ok: true, mediaType: 'midi' })
    expect(validateRenderSlot(tree, 'svs.melody', textTrackObject)).toMatchObject({ ok: false, mediaType: 'text' })
    expect(validateRenderSlot(tree, 'svs.refText', textTrackObject)).toMatchObject({ ok: true, mediaType: 'text' })
    expect(validateRenderSlot(tree, 'svs.targetText', textTrackObject)).toMatchObject({ ok: true, mediaType: 'text' })
    expect(validateRenderSlot(tree, 'svs.targetText', audioTrackObject)).toMatchObject({ ok: false, mediaType: 'audio' })
    expect(validateRenderSlot(tree, 'msst.audio', synthesisTrackObject)).toMatchObject({ ok: false, reason: expect.stringContaining('不接受合成单元') })
    expect(validateRenderSlot(tree, 'svs.timbreAudio', makeRenderInputRef(tree, 'group', audioGroup.id))).toMatchObject({ ok: true, mediaType: 'audio' })
    expect(validateRenderSlot(tree, 'svs.melody', makeRenderInputRef(tree, 'group', midiGroup.id))).toMatchObject({ ok: true, mediaType: 'midi' })
    expect(validateRenderSlot(tree, 'svs.refText', makeRenderInputRef(tree, 'group', textGroup.id))).toMatchObject({ ok: true, mediaType: 'text' })
    expect(validateRenderSlot(tree, 'svs.targetText', makeRenderInputRef(tree, 'group', textGroup.id))).toMatchObject({ ok: true, mediaType: 'text' })
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

function makeSvsTree(): ProjectObjectTree {
  const tree = createEmptyProjectObjectTree()
  const trackSourcesRoot = tree.root.children.find(child => child.id === TOP_LEVEL_IDS.trackSources)
  const tracksRoot = tree.root.children.find(child => child.id === TOP_LEVEL_IDS.tracks)
  if (!trackSourcesRoot || trackSourcesRoot.kind !== 'folder' || !tracksRoot || tracksRoot.kind !== 'folder') {
    throw new Error('missing fixture roots')
  }

  trackSourcesRoot.children.push(
    audioObject('node:audio'),
    midiObject('node:midi'),
    textObject('node:text'),
    createEmptySynthesisUnit({
      id: 'node:synthesis', name: 'Synthesis', defaultTimelineStart: null,
      guide: {
        assetId: 'asset:synthesis', audioSHA256: 'a'.repeat(64), sampleRate: 44100, channels: 1,
        sampleCount: 44100, duration: 1,
        source: {
          sourceAudioObjectId: 'node:audio', sourceAssetId: 'asset:audio',
          effectiveStartSample: 0, effectiveEndSampleExclusive: 44100,
          sourceTimelineStart: null, resolverManifest: '{}',
        },
      },
    }),
  )
  tracksRoot.children.push(
    trackFolder('node:trackFolder:audio', 'audio', trackObject('node:trackObject:audio', 'audio', 'node:audio')),
    trackFolder('node:trackFolder:midi', 'midi', trackObject('node:trackObject:midi', 'midi', 'node:midi')),
    trackFolder('node:trackFolder:text', 'text', trackObject('node:trackObject:text', 'text', 'node:text')),
    trackFolder('node:trackFolder:synthesis', 'audio', trackObject('node:trackObject:synthesis', 'audio', 'node:synthesis')),
  )
  return tree
}

function audioObject(id: string): AudioObjectNode {
  return {
    id,
    kind: 'audio',
    name: 'Audio',
    audio: {
      assetId: 'asset:audio',
      midiObjectId: null,
      textObjectId: null,
    },
  }
}

function midiObject(id: string): MidiObjectNode {
  return {
    id,
    kind: 'midi',
    name: 'Midi',
    midi: {
      sourceAudioObjectId: null,
      versions: [],
      activeVersionId: '',
    },
  }
}

function textObject(id: string): TextObjectNode {
  return {
    id,
    kind: 'text',
    name: 'Text',
    text: {
      sourceAudioObjectId: null,
      segments: [{ start: 0, kana: 'きみ', romaji: 'ki mi' }],
    },
  }
}

function trackFolder(id: string, trackType: TrackObjectContentType, child: TrackObjectNode): TrackFolderNode {
  return {
    id,
    kind: 'trackFolder',
    name: `${trackType} track`,
    trackFolder: { trackType },
    children: [child],
  }
}

function trackObject(id: string, contentType: TrackObjectContentType, sourceObjectId: string): TrackObjectNode {
  return {
    id,
    kind: 'trackObject',
    name: id,
    trackObject: {
      contentType,
      sourceObjectId,
      timelineStart: 0,
      timelineEnd: 1,
      ignored: false,
    },
  }
}

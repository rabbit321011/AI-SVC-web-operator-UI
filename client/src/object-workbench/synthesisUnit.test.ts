import { describe, expect, it } from 'vitest'
import {
  createEmptySynthesisUnit,
  createSynthesisFrameContract,
  validateSynthesisUnit,
  V5P_FRAME_RATE,
} from './synthesisUnit'

describe('SynthesisUnit contract', () => {
  it('matches the official Oobleck floor frame contract', () => {
    expect(createSynthesisFrameContract(131072)).toEqual({
      schema: 'aisvc.v5p-frame.v1',
      sampleRate: 44100,
      hopSamples: 2048,
      frameRate: V5P_FRAME_RATE,
      frameCount: 64,
      modelSampleCount: 131072,
      trailingSampleCount: 0,
      compilerVersion: 'stable-audio2-oobleck-floor.v1',
    })

    expect(createSynthesisFrameContract(131073)).toMatchObject({
      frameCount: 64,
      modelSampleCount: 131072,
      trailingSampleCount: 1,
    })
  })

  it('creates a Guide-only unit without running analysis', () => {
    const unit = createEmptySynthesisUnit({
      id: 'node:synthesisUnit:test',
      name: 'Verse',
      now: '2026-08-10T00:00:00.000Z',
      defaultTimelineStart: 12.5,
      guide: {
        assetId: 'asset:synthesisGuide:test',
        audioSHA256: 'a'.repeat(64),
        sampleRate: 44100,
        channels: 1,
        sampleCount: 131072,
        duration: 131072 / 44100,
        source: {
          sourceAudioObjectId: 'node:audio:test',
          sourceAssetId: 'asset:audio:test',
          effectiveStartSample: 200,
          effectiveEndSampleExclusive: 131272,
          sourceTimelineStart: 12.5,
          resolverManifest: 'render-audio-resolver.v1',
        },
      },
    })

    expect(unit.synthesisUnit.frameContract.frameCount).toBe(64)
    expect(unit.synthesisUnit.segmentTrack).toMatchObject({ status: 'empty', revision: 0, items: [] })
    expect(unit.synthesisUnit.kanaTrack).toMatchObject({ status: 'empty', revision: 0, units: [], boundaries: [] })
    expect(unit.synthesisUnit.hTokenTrack).toMatchObject({ status: 'empty', revision: 0, events: [] })
    expect(unit.synthesisUnit.midiPTokenTrack).toMatchObject({ status: 'empty', revision: 0, classes: [], manualFrames: [] })
    expect(unit.synthesisUnit.reference).toBeNull()
    expect(unit.synthesisUnit.takes).toEqual([])
    expect(validateSynthesisUnit(unit)).toEqual([])
  })

  it('rejects dense control values that cannot be consumed by V5-P', () => {
    const unit = createEmptySynthesisUnit({
      id: 'node:synthesisUnit:test',
      name: 'Verse',
      defaultTimelineStart: null,
      guide: {
        assetId: 'asset:synthesisGuide:test',
        audioSHA256: 'a'.repeat(64),
        sampleRate: 44100,
        channels: 1,
        sampleCount: 4096,
        duration: 4096 / 44100,
        source: {
          sourceAudioObjectId: 'node:audio:test',
          sourceAssetId: 'asset:audio:test',
          effectiveStartSample: 0,
          effectiveEndSampleExclusive: 4096,
          sourceTimelineStart: null,
          resolverManifest: 'render-audio-resolver.v1',
        },
      },
    })
    unit.synthesisUnit.hTokenTrack.events = [
      { id: 'h:1', frame: 0, tokenId: 364, origin: 'user' },
      { id: 'h:2', frame: 0, tokenId: 319, origin: 'user' },
    ]
    unit.synthesisUnit.midiPTokenTrack.status = 'ready'
    unit.synthesisUnit.midiPTokenTrack.classes = [120]

    expect(validateSynthesisUnit(unit)).toEqual([
      'H Token track contains an invalid event',
      'H Token track contains more than one event in a frame',
      'Ready MIDI-P track length does not match frame count',
    ])
  })
})

import { describe, expect, it } from 'vitest'
import type { SynthesisUnitObjectNode } from './types'
import { createEmptySynthesisUnit } from './synthesisUnit'
import { createSynthesisMaterialSnapshot } from './synthesisMaterialSnapshot'

describe('V5-P material snapshot', () => {
  it('freezes A/B revisions and transports only B-local MIDI-P on the joint frame map', () => {
    const reference = readyUnit('node:synthesisUnit:a', 64 * 2048 + 357)
    const target = readyUnit('node:synthesisUnit:b', 64 * 2048 + 357)
    target.synthesisUnit.reference = {
      unitId: reference.id,
      audioSource: 'guide',
      range: 'full-guide',
      revisionPolicy: 'follow-latest',
      boundAt: '2026-08-11T00:00:00.000Z',
    }
    target.synthesisUnit.midiPTokenTrack.classes[7] = 130
    target.synthesisUnit.midiPTokenTrack.classes[8] = 131
    target.synthesisUnit.midiPTokenTrack.manualFrames = [8]

    const snapshot = createSynthesisMaterialSnapshot(reference, target, {
      now: '2026-08-11T01:00:00.000Z',
    })

    expect(snapshot.frameMap.bOffsetFrame).toBe(75)
    expect(snapshot.reference.text.denseHTokens[2]).toBe(46)
    expect(snapshot.target.text.denseHTokens[2]).toBe(46)
    expect(snapshot.hTransport.reference.jointTerminalSepFrame).toBe(76)
    expect(snapshot.hTransport.target.jointTerminalSepFrame).toBe(159)
    expect(snapshot.hTransport.tokens[77]).toBe(46)
    expect(snapshot.midiPTransport).toMatchObject({
      clearEmbeddingStartFrame: 0,
      clearEmbeddingEndFrameExclusive: 75,
      targetStartFrame: 75,
      targetEndFrameExclusive: 139,
      rearStartFrame: 139,
      rearEndFrameExclusive: 160,
      rearClassId: 255,
    })
    expect(snapshot.midiPTransport.classIds.slice(0, 75).every(value => value === 255)).toBe(true)
    expect(snapshot.midiPTransport.classIds[75 + 7]).toBe(130)
    expect(snapshot.midiPTransport.classIds[75 + 8]).toBe(131)
    expect(snapshot.midiPTransport.classIds.slice(139).every(value => value === 255)).toBe(true)

    reference.synthesisUnit.hTokenTrack.events[0].tokenId = 99
    target.synthesisUnit.midiPTokenTrack.classes[7] = 140
    expect(snapshot.reference.text.hEvents[0].tokenId).toBe(46)
    expect(snapshot.target.midiP.classes[7]).toBe(130)
  })

  it('rejects missing material, PAD and a stale reference binding', () => {
    const reference = readyUnit('node:synthesisUnit:a', 64 * 2048)
    const target = readyUnit('node:synthesisUnit:b', 64 * 2048)

    expect(() => createSynthesisMaterialSnapshot(reference, target)).toThrow('尚未绑定')
    target.synthesisUnit.reference = {
      unitId: 'node:synthesisUnit:other',
      audioSource: 'guide',
      range: 'full-guide',
      revisionPolicy: 'follow-latest',
      boundAt: '2026-08-11T00:00:00.000Z',
    }
    expect(() => createSynthesisMaterialSnapshot(reference, target)).toThrow('当前绑定不一致')
    target.synthesisUnit.reference.unitId = reference.id
    target.synthesisUnit.midiPTokenTrack.classes[3] = 256
    expect(() => createSynthesisMaterialSnapshot(reference, target)).toThrow('PAD=256')
  })
})

function readyUnit(id: string, sampleCount: number): SynthesisUnitObjectNode {
  const frameCount = Math.floor(sampleCount / 2048)
  const unit = createEmptySynthesisUnit({
    id,
    name: id,
    defaultTimelineStart: null,
    now: '2026-08-11T00:00:00.000Z',
    guide: {
      assetId: `asset:${id}`,
      audioSHA256: id.endsWith(':a') ? 'a'.repeat(64) : 'b'.repeat(64),
      sampleRate: 44100,
      channels: 1,
      sampleCount,
      duration: sampleCount / 44100,
      source: {
        sourceAudioObjectId: `node:audio:${id}`,
        sourceAssetId: `asset:audio:${id}`,
        effectiveStartSample: 0,
        effectiveEndSampleExclusive: sampleCount,
        sourceTimelineStart: null,
        resolverManifest: 'test',
      },
    },
  })
  unit.synthesisUnit.unitRevision = 4
  unit.synthesisUnit.hTokenTrack = {
    status: 'ready',
    revision: 2,
    origin: 'alignment',
    events: [
      { id: `${id}:h:2`, frame: 2, tokenId: 46, symbol: 'n', origin: 'user' },
      { id: `${id}:h:4`, frame: 4, tokenId: 211, symbol: 'a', origin: 'user' },
      { id: `${id}:sep`, frame: frameCount - 1, tokenId: 365, symbol: '<SEP>', origin: 'segment-align' },
    ],
    revisions: [],
  }
  unit.synthesisUnit.midiPTokenTrack = {
    status: 'ready',
    revision: 3,
    origin: 'game',
    classes: Array(frameCount).fill(255),
    manualFrames: [],
    revisions: [],
  }
  return unit
}

import { describe, expect, it } from 'vitest'
import { createV5PABFrameMap } from './synthesisABFrameMap'
import { compileV5PJointHTransport } from './synthesisDirectH'

describe('V5-P joint H direct control', () => {
  it('relocates only the two context terminal SEPs and preserves lyric frames', () => {
    const result = compileV5PJointHTransport(
      [46, 0, 0, 365],
      [0, 0, 56, 365],
      map(4),
    )

    expect(result.reference).toEqual({
      terminalPlacementMode: 'user',
      sourceTerminalSepFrame: 3,
      jointTerminalSepFrame: 16,
      terminalPulExtendedFrames: 0,
    })
    expect(result.target).toEqual({
      terminalPlacementMode: 'user',
      firstLyricLocalFrame: 2,
      sourceTerminalSepFrame: 3,
      jointTerminalSepFrame: 39,
      terminalPulExtendedFrames: 0,
    })
    expect(result.tokens[0]).toBe(46)
    expect(result.tokens[16]).toBe(365)
    expect(result.tokens[17]).toBe(56)
    expect(result.tokens[39]).toBe(365)
    expect(result.tokens.filter(Boolean)).toEqual([46, 365, 56, 365])
  })

  it('extends terminal PUL spans through the relocated training boundaries', () => {
    const result = compileV5PJointHTransport(
      [46, 366, 366, 365],
      [56, 366, 366, 365],
      map(4),
    )

    expect(result.reference.terminalPulExtendedFrames).toBe(11)
    expect(result.target.terminalPulExtendedFrames).toBe(21)
    expect(result.tokens.slice(1, 14).every(token => token === 366)).toBe(true)
    expect(result.tokens[14]).toBe(365)
    expect(result.tokens[15]).toBe(56)
    expect(result.tokens.slice(16, 39).every(token => token === 366)).toBe(true)
    expect(result.tokens[39]).toBe(365)
  })

  it('rejects ambiguous outer structure instead of silently rebuilding user H', () => {
    expect(() => compileV5PJointHTransport(
      [46, 365, 56, 0],
      [56, 0, 0, 365],
      map(4),
    )).toThrow('terminal SEP 后仍有 H event')
    expect(() => compileV5PJointHTransport(
      [46, 0, 0, 365],
      [366, 56, 0, 365],
      map(4),
    )).toThrow('第一枚发音 token 前')
    expect(() => compileV5PJointHTransport(
      [46, 0, 0, 365],
      [56, 0, 0, 365],
      map(4),
      { referenceTerminalPlacementMode: 'sentence' },
    )).toThrow('sentence placement')
  })
})

function map(frameCount: number) {
  const sampleCount = frameCount * 2048
  return createV5PABFrameMap({
    reference: { sampleRate: 44100, hopSamples: 2048, sampleCount, frameCount },
    target: { sampleRate: 44100, hopSamples: 2048, sampleCount, frameCount },
  })
}

import { describe, expect, it } from 'vitest'
import {
  createV5PABFrameMap,
  V5P_EVALUATOR_REAR_CROP_FRAMES,
  V5P_NOMINAL_REFERENCE_GAP_SAMPLES,
  V5P_TARGET_REAR_SAMPLES,
} from './synthesisABFrameMap'

describe('V5-P A/B frame map', () => {
  it('quantizes the nominal 0.5s gap so B sample zero starts on an exact frame', () => {
    const map = createV5PABFrameMap({
      reference: region(1_548_645),
      target: region(1_548_645),
    })

    expect(V5P_NOMINAL_REFERENCE_GAP_SAMPLES).toBe(22_050)
    expect(V5P_TARGET_REAR_SAMPLES).toBe(44_100)
    expect(V5P_EVALUATOR_REAR_CROP_FRAMES).toBe(21)
    expect(map).toMatchObject({
      schema: 'aisvc.v5p-ab-frame-map.v1',
      reference: {
        ownedFrameCount: 756,
        trailingSampleCount: 357,
        nominalPaddingSampleCount: 22_050,
        paddingSampleCount: 22_171,
        paddingAdjustmentSampleCount: 121,
        paddedFrameCount: 767,
        paddedTrailingSampleCount: 0,
        paddingFrameCount: 11,
      },
      target: {
        ownedFrameCount: 756,
        trailingSampleCount: 357,
        paddingSampleCount: 44_100,
        paddedFrameCount: 777,
        paddingFrameCount: 21,
      },
      bOffsetFrame: 767,
      totalFrameCount: 1_544,
      crop: {
        startFrame: 767,
        endFrameExclusive: 1_523,
        decodedFrameCountBeforeSampleTrim: 756,
        decodedFrameDelta: 0,
        finalSampleCount: 1_548_288,
      },
    })
  })

  it('keeps the aligned gap near 0.5s and handles rear-frame carry', () => {
    const noCarry = createV5PABFrameMap({
      reference: region(64 * 2048 + 1_501),
      target: region(64 * 2048 + 955),
    })
    const carry = createV5PABFrameMap({
      reference: region(64 * 2048 + 1_502),
      target: region(64 * 2048 + 956),
    })

    expect(noCarry.reference.paddingFrameCount).toBe(11)
    expect(noCarry.reference.paddingAdjustmentSampleCount).toBe(-1_023)
    expect(carry.reference.paddingFrameCount).toBe(12)
    expect(carry.reference.paddingAdjustmentSampleCount).toBe(1_024)
    expect(noCarry.reference.paddedTrailingSampleCount).toBe(0)
    expect(carry.reference.paddedTrailingSampleCount).toBe(0)
    expect(noCarry.target.paddingFrameCount).toBe(21)
    expect(carry.target.paddingFrameCount).toBe(22)
    expect(noCarry.crop.decodedFrameDelta).toBe(0)
    expect(carry.crop.decodedFrameDelta).toBe(1)
    expect(carry.crop.finalSampleCount).toBe(64 * 2048)
  })

  it('rejects stale frame contracts and VAE shape disagreements', () => {
    expect(() => createV5PABFrameMap({
      reference: { ...region(131_072), frameCount: 63 },
      target: region(131_072),
    })).toThrow('A frameCount does not match')

    expect(() => createV5PABFrameMap({
      reference: { ...region(131_072), encodedPaddedFrameCount: 74 },
      target: region(131_072),
    })).toThrow('A official VAE frame count mismatch')
  })
})

function region(sampleCount: number) {
  return {
    sampleRate: 44100 as const,
    hopSamples: 2048 as const,
    sampleCount,
    frameCount: Math.floor(sampleCount / 2048),
  }
}

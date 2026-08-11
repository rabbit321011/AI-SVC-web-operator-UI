import type { SynthesisFrameContract } from './types'
import { V5P_HOP_SAMPLES, V5P_SAMPLE_RATE } from './synthesisUnit'

export const V5P_NOMINAL_REFERENCE_GAP_SAMPLES = 22_050 as const
export const V5P_TARGET_REAR_SAMPLES = 44_100 as const
export const V5P_EVALUATOR_REAR_CROP_FRAMES = Math.floor(
  V5P_TARGET_REAR_SAMPLES / V5P_HOP_SAMPLES,
)

export interface V5PABFrameMapInput {
  reference: Pick<SynthesisFrameContract, 'sampleRate' | 'hopSamples' | 'frameCount'> & {
    sampleCount: number
    encodedPaddedFrameCount?: number
  }
  target: Pick<SynthesisFrameContract, 'sampleRate' | 'hopSamples' | 'frameCount'> & {
    sampleCount: number
    encodedPaddedFrameCount?: number
  }
}

export interface V5PABFrameMapRegion {
  ownedSampleCount: number
  ownedFrameCount: number
  nominalPaddingSampleCount: number
  paddingSampleCount: number
  paddingAdjustmentSampleCount: number
  paddedSampleCount: number
  paddedFrameCount: number
  paddingFrameCount: number
  trailingSampleCount: number
  paddedTrailingSampleCount: number
}

export interface V5PABFrameMap {
  schema: 'aisvc.v5p-ab-frame-map.v1'
  sampleRate: 44100
  hopSamples: 2048
  reference: V5PABFrameMapRegion & { paddingKind: 'ab-gap' }
  target: V5PABFrameMapRegion & { paddingKind: 'decode-rear' }
  bOffsetFrame: number
  totalFrameCount: number
  crop: {
    startFrame: number
    endFrameExclusive: number
    evaluatorRearFrameCount: number
    decodedFrameCountBeforeSampleTrim: number
    decodedFrameDelta: number
    finalSampleCount: number
  }
}

export function createV5PABFrameMap(input: V5PABFrameMapInput): V5PABFrameMap {
  validateRegionInput('A', input.reference)
  validateRegionInput('B', input.target)
  const alignedBStartFrame = Math.round(
    (input.reference.sampleCount + V5P_NOMINAL_REFERENCE_GAP_SAMPLES) / V5P_HOP_SAMPLES,
  )
  const alignedReferenceSampleCount = alignedBStartFrame * V5P_HOP_SAMPLES
  const referenceGapSampleCount = alignedReferenceSampleCount - input.reference.sampleCount
  const reference = compileRegion(
    'A',
    input.reference,
    V5P_NOMINAL_REFERENCE_GAP_SAMPLES,
    referenceGapSampleCount,
  )
  const target = compileRegion(
    'B',
    input.target,
    V5P_TARGET_REAR_SAMPLES,
    V5P_TARGET_REAR_SAMPLES,
  )
  const bOffsetFrame = reference.paddedFrameCount
  const totalFrameCount = bOffsetFrame + target.paddedFrameCount
  const endFrameExclusive = totalFrameCount - V5P_EVALUATOR_REAR_CROP_FRAMES
  const decodedFrameCountBeforeSampleTrim = endFrameExclusive - bOffsetFrame

  return {
    schema: 'aisvc.v5p-ab-frame-map.v1',
    sampleRate: V5P_SAMPLE_RATE,
    hopSamples: V5P_HOP_SAMPLES,
    reference: { ...reference, paddingKind: 'ab-gap' },
    target: { ...target, paddingKind: 'decode-rear' },
    bOffsetFrame,
    totalFrameCount,
    crop: {
      startFrame: bOffsetFrame,
      endFrameExclusive,
      evaluatorRearFrameCount: V5P_EVALUATOR_REAR_CROP_FRAMES,
      decodedFrameCountBeforeSampleTrim,
      decodedFrameDelta: decodedFrameCountBeforeSampleTrim - target.ownedFrameCount,
      finalSampleCount: target.ownedFrameCount * V5P_HOP_SAMPLES,
    },
  }
}

function compileRegion(
  label: 'A' | 'B',
  input: V5PABFrameMapInput['reference'],
  nominalPaddingSampleCount: number,
  paddingSampleCount: number,
): V5PABFrameMapRegion {
  validateRegionInput(label, input)
  const ownedFrameCount = Math.floor(input.sampleCount / V5P_HOP_SAMPLES)
  const paddedSampleCount = input.sampleCount + paddingSampleCount
  const paddedFrameCount = Math.floor(paddedSampleCount / V5P_HOP_SAMPLES)
  if (
    input.encodedPaddedFrameCount !== undefined
    && input.encodedPaddedFrameCount !== paddedFrameCount
  ) {
    throw new Error(
      `${label} official VAE frame count mismatch: ${input.encodedPaddedFrameCount} != ${paddedFrameCount}`,
    )
  }
  return {
    ownedSampleCount: input.sampleCount,
    ownedFrameCount,
    nominalPaddingSampleCount,
    paddingSampleCount,
    paddingAdjustmentSampleCount: paddingSampleCount - nominalPaddingSampleCount,
    paddedSampleCount,
    paddedFrameCount,
    paddingFrameCount: paddedFrameCount - ownedFrameCount,
    trailingSampleCount: input.sampleCount % V5P_HOP_SAMPLES,
    paddedTrailingSampleCount: paddedSampleCount % V5P_HOP_SAMPLES,
  }
}

function validateRegionInput(
  label: 'A' | 'B',
  input: V5PABFrameMapInput['reference'],
): void {
  if (input.sampleRate !== V5P_SAMPLE_RATE || input.hopSamples !== V5P_HOP_SAMPLES) {
    throw new Error(`${label} frame contract is not V5-P 44.1kHz/2048`)
  }
  if (!Number.isSafeInteger(input.sampleCount) || input.sampleCount <= 0) {
    throw new Error(`${label} sampleCount must be a positive safe integer`)
  }
  const ownedFrameCount = Math.floor(input.sampleCount / V5P_HOP_SAMPLES)
  if (ownedFrameCount !== input.frameCount || ownedFrameCount < 1) {
    throw new Error(`${label} frameCount does not match its Owned Guide`)
  }
}

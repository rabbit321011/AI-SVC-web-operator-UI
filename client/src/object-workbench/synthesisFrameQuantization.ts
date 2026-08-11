import type { SynthesisSegmentObject } from './types'

export interface SofaPhraseTiming {
  id: string
  text: string
  kana: string
  romaji: string
  start: number
  end: number
}

const MICROS_PER_SECOND = 1_000_000n
const SAMPLE_RATE = 44_100n
const HOP_SAMPLES = 2_048n
const FRAME_DENOMINATOR = HOP_SAMPLES * MICROS_PER_SECOND

export function secondsToV5PStartFrame(seconds: number): number {
  const micros = secondsToMicros(seconds)
  return Number((micros * SAMPLE_RATE) / FRAME_DENOMINATOR)
}

export function secondsToV5PEndFrameExclusive(seconds: number): number {
  const micros = secondsToMicros(seconds)
  const numerator = micros * SAMPLE_RATE
  return Number((numerator + FRAME_DENOMINATOR - 1n) / FRAME_DENOMINATOR)
}

export function sofaPhrasesToSegmentObjects(
  phrases: SofaPhraseTiming[],
  frameCount: number,
): SynthesisSegmentObject[] {
  const result = phrases.map((phrase, index) => {
    const startFrame = clamp(secondsToV5PStartFrame(phrase.start), 0, frameCount - 1)
    const speechEndFrameExclusive = clamp(
      secondsToV5PEndFrameExclusive(phrase.end),
      startFrame + 1,
      frameCount,
    )
    return {
      id: phrase.id || `segment:sofa:${index}`,
      text: phrase.text,
      kana: phrase.kana,
      romaji: phrase.romaji,
      startFrame,
      speechEndFrameExclusive,
      sourceOnsetSeconds: phrase.start,
      sourceEndSeconds: phrase.end,
      origin: 'whisper-sofa' as const,
    }
  }).sort((left, right) => left.startFrame - right.startFrame)

  for (let index = 1; index < result.length; index++) {
    if (result[index].startFrame < result[index - 1].speechEndFrameExclusive) {
      result[index - 1].speechEndFrameExclusive = result[index].startFrame
    }
    if (result[index - 1].speechEndFrameExclusive <= result[index - 1].startFrame) {
      throw new Error(`SOFA phrases ${index - 1} and ${index} collapse into the same V5-P frame`)
    }
  }
  return result
}

function secondsToMicros(seconds: number): bigint {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Time must be a finite non-negative number')
  return BigInt(Math.round(seconds * Number(MICROS_PER_SECOND)))
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

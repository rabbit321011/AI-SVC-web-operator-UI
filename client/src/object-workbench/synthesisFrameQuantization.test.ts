import { describe, expect, it } from 'vitest'
import {
  secondsToV5PEndFrameExclusive,
  secondsToV5PStartFrame,
  sofaPhrasesToSegmentObjects,
} from './synthesisFrameQuantization'

describe('V5-P frame quantization', () => {
  it('uses integer microseconds with floor onset and ceil end policies', () => {
    expect(secondsToV5PStartFrame(0.377)).toBe(8)
    expect(secondsToV5PEndFrameExclusive(2.972)).toBe(64)
    expect(secondsToV5PStartFrame(2048 / 44100)).toBe(1)
  })

  it('converts the real Whisper + SOFA fixture to the frozen Segment range', () => {
    expect(sofaPhrasesToSegmentObjects([{
      id: 'phrase:whisper:0',
      text: '夏の温度に溶けて',
      kana: 'なつのおんどにとけて',
      romaji: 'na tsu no o ndo ni to ke te',
      start: 0.377,
      end: 2.972,
    }], 64)).toEqual([{
      id: 'phrase:whisper:0',
      text: '夏の温度に溶けて',
      kana: 'なつのおんどにとけて',
      romaji: 'na tsu no o ndo ni to ke te',
      startFrame: 8,
      speechEndFrameExclusive: 64,
      sourceOnsetSeconds: 0.377,
      sourceEndSeconds: 2.972,
      origin: 'whisper-sofa',
    }])
  })
})

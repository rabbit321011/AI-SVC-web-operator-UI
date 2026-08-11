import { describe, expect, it } from 'vitest'
import type { SynthesisKanaTrack } from './types'
import { buildKanaPhraseContexts, getKanaControlRange, normalizeKanaMora } from './synthesisKanaControl'

describe('Kana -> H control context', () => {
  it('uses Kana SEG to build phrase context and assigns the tail to the last mora', () => {
    const track = fixtureTrack()
    const phrases = buildKanaPhraseContexts(track, 20)
    expect(phrases.map(phrase => ({
      kana: phrase.kana,
      start: phrase.startFrame,
      speechEnd: phrase.endFrameExclusive,
      controlEnd: phrase.controlEndFrameExclusive,
    }))).toEqual([
      { kana: 'きみ', start: 2, speechEnd: 8, controlEnd: 10 },
      { kana: 'のこ', start: 10, speechEnd: 17, controlEnd: 20 },
    ])
    expect(getKanaControlRange(track, 'kana:a', 20)).toMatchObject({
      moraIndex: 0, startFrame: 2, endFrameExclusive: 5, isPhraseEnd: false,
    })
    expect(getKanaControlRange(track, 'kana:b', 20)).toMatchObject({
      moraIndex: 1, startFrame: 5, endFrameExclusive: 10, isPhraseEnd: true,
    })
  })

  it('rejects a KanaUnit that crosses its own SEG boundary', () => {
    const track = fixtureTrack()
    track.units[1].endFrameExclusive = 11
    expect(() => buildKanaPhraseContexts(track, 20)).toThrow('跨越 SEG boundary')
  })

  it('accepts a terminal SEG when later Kana phrases have not been materialized yet', () => {
    const track = fixtureTrack()
    track.units = track.units.slice(0, 2)
    const phrases = buildKanaPhraseContexts(track, 20)
    expect(phrases).toHaveLength(1)
    expect(phrases[0]).toMatchObject({ kana: 'きみ', controlEndFrameExclusive: 10 })
    expect(getKanaControlRange(track, 'kana:b', 20)).toMatchObject({
      endFrameExclusive: 10,
      isPhraseEnd: true,
    })
  })

  it('normalizes user-facing katakana without changing mora grouping', () => {
    expect(normalizeKanaMora(' ｷｬ ')).toBe('きゃ')
    expect(normalizeKanaMora('ヴァ')).toBe('ゔぁ')
    expect(normalizeKanaMora('カー')).toBe('かー')
  })
})

function fixtureTrack(): SynthesisKanaTrack {
  return {
    status: 'ready', revision: 1, origin: 'user', revisions: [],
    units: [
      { id: 'kana:a', kana: 'き', romaji: 'ki', startFrame: 2, endFrameExclusive: 5, origin: 'user' },
      { id: 'kana:b', kana: 'み', romaji: 'mi', startFrame: 5, endFrameExclusive: 8, origin: 'user' },
      { id: 'kana:c', kana: 'の', romaji: 'no', startFrame: 10, endFrameExclusive: 14, origin: 'user' },
      { id: 'kana:d', kana: 'こ', romaji: 'ko', startFrame: 14, endFrameExclusive: 17, origin: 'user' },
    ],
    boundaries: [{ id: 'seg:a', frame: 10, kind: 'SEG', origin: 'user' }],
  }
}

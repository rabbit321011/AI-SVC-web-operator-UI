import { describe, expect, it } from 'vitest'
import { readWhisperSofaResult, SOFA_ALIGNMENT_METHOD, whisperSofaProgressLabel } from './whisperSofaProtocol'

describe('Whisper -> SOFA protocol', () => {
  it('accepts only phrase timings produced by JPN_Test2_Plus full-segment alignment', () => {
    const result = readWhisperSofaResult({
      type: 'result',
      alignmentMethod: SOFA_ALIGNMENT_METHOD,
      confidence: 0.97,
      phrases: [{ id: 'phrase:1', text: '君', kana: 'きみ', romaji: 'ki mi', start: 0.42, end: 1.8 }],
      phones: [{ label: 'k', start: 0.42, end: 0.5 }],
      textObject: {
        text: {
          segments: [
            { start: 0.42, end: 1.8, kana: 'きみ', romaji: 'ki mi', alignmentMethod: SOFA_ALIGNMENT_METHOD },
            { start: 2.1, end: 3.4, kana: 'のこえ', romaji: 'no ko e', alignmentMethod: SOFA_ALIGNMENT_METHOD },
          ],
        },
      },
    })

    expect(result).toEqual({
      confidence: 0.97,
      phrases: [{ id: 'phrase:1', text: '君', kana: 'きみ', romaji: 'ki mi', start: 0.42, end: 1.8 }],
      phones: [{ label: 'k', start: 0.42, end: 0.5 }],
      segments: [
        { id: undefined, start: 0.42, end: 1.8, kana: 'きみ', romaji: 'ki mi', alignmentMethod: SOFA_ALIGNMENT_METHOD },
        { id: undefined, start: 2.1, end: 3.4, kana: 'のこえ', romaji: 'no ko e', alignmentMethod: SOFA_ALIGNMENT_METHOD },
      ],
    })
  })

  it('rejects a Whisper-only TextObject even when it has timestamps', () => {
    expect(readWhisperSofaResult({
      type: 'result',
      textObject: { text: { segments: [{ start: 0, end: 10, kana: 'きみ', romaji: 'ki mi' }] } },
    })).toBeNull()
  })

  it('rejects malformed or non-monotonic SOFA intervals', () => {
    expect(readWhisperSofaResult({
      type: 'result',
      alignmentMethod: SOFA_ALIGNMENT_METHOD,
      textObject: {
        text: {
          segments: [
            { start: 2, end: 3, kana: 'a', romaji: 'a', alignmentMethod: SOFA_ALIGNMENT_METHOD },
            { start: 1, end: 2, kana: 'b', romaji: 'b', alignmentMethod: SOFA_ALIGNMENT_METHOD },
          ],
        },
      },
    })).toBeNull()

    expect(readWhisperSofaResult({
      type: 'result',
      alignmentMethod: SOFA_ALIGNMENT_METHOD,
      textObject: {
        text: {
          segments: [
            { start: 1, end: 2, kana: 'a', romaji: 'a', alignmentMethod: SOFA_ALIGNMENT_METHOD },
            { start: 1.5, end: 3, kana: 'b', romaji: 'b', alignmentMethod: SOFA_ALIGNMENT_METHOD },
          ],
        },
      },
    })).toBeNull()
  })

  it('labels Whisper and SOFA progress separately', () => {
    expect(whisperSofaProgressLabel({ stage: 'whisper' })).toBe('Whisper 日语转写中')
    expect(whisperSofaProgressLabel({ stage: 'sofa' })).toBe('SOFA 全段对齐中')
  })
})

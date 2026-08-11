import { describe, expect, it } from 'vitest'
import { readSynthesisTextControlResult } from './synthesisTextControlProtocol'

describe('Synthesis Text Control protocol', () => {
  it('accepts bounded Kana and sparse H output', () => {
    const result = readSynthesisTextControlResult({
      type: 'text-control-result',
      result: {
        schema: 'aisvc.v5p-text-control.v1',
        frameRate: 44100 / 2048,
        frameCount: 16,
        kanaUnits: [{
          id: 'kana:a:0', kana: 'き', romaji: 'ki', startFrame: 2,
          endFrameExclusive: 7, origin: 'segment-align', phraseId: 'segment:a',
        }],
        kanaBoundaries: [],
        phraseRanges: [{ phraseId: 'segment:a', startFrame: 2, speechEndFrameExclusive: 7, maxAbsShift: 0 }],
        hEvents: [
          { id: 'h:2:32', frame: 2, tokenId: 32, symbol: 'k', origin: 'segment-align', phraseId: 'segment:a', moraIndex: 0, phoneIndex: 0 },
          { id: 'h:15:365', frame: 15, tokenId: 365, symbol: '<SEP>', origin: 'segment-align', phraseId: 'segment:a' },
        ],
        hAudit: {
          phonePhraseCount: 1, pulPhraseCount: 0, exactControlPhraseCount: 0,
          pulFrameCount: 0, lockedEventTokenSHA256: 'abc',
          phraseModes: [{ phraseId: 'segment:a', placementMode: 'phone', fallbackReason: null }],
        },
        runtimeHashes: { vocab: 'def' },
        compilerSHA256: 'ghi',
      },
    }, 16)
    expect(result?.kanaUnits[0].phraseId).toBe('segment:a')
    expect(result?.hEvents.map(event => event.frame)).toEqual([2, 15])
    expect(result?.hEvents[0]).toMatchObject({ phraseId: 'segment:a', moraIndex: 0, phoneIndex: 0 })
  })

  it('rejects H collisions and forbidden PUNCT', () => {
    const base = {
      type: 'text-control-result',
      result: {
        schema: 'aisvc.v5p-text-control.v1', frameRate: 44100 / 2048, frameCount: 4,
        kanaUnits: [], kanaBoundaries: [], phraseRanges: [],
        hAudit: { phonePhraseCount: 0, pulPhraseCount: 0, exactControlPhraseCount: 0, pulFrameCount: 0, lockedEventTokenSHA256: 'a', phraseModes: [] },
        runtimeHashes: { vocab: 'b' }, compilerSHA256: 'c',
      },
    }
    expect(() => readSynthesisTextControlResult({
      ...base,
      result: { ...base.result, hEvents: [{ id: 'x', frame: 1, tokenId: 364, symbol: '<PUNCT>' }] },
    }, 4)).toThrow(/runtime 合同/)
    expect(readSynthesisTextControlResult({
      ...base,
      result: {
        ...base.result,
        hEvents: [
          { id: 'x', frame: 1, tokenId: 32, symbol: 'k' },
          { id: 'y', frame: 1, tokenId: 56, symbol: 'i' },
        ],
      },
    }, 4)).toBeNull()
  })
})

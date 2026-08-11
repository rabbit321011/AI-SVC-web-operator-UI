import { describe, expect, it } from 'vitest'
import { readSynthesisMidiPResult } from './synthesisMidiPProtocol'

describe('Synthesis MIDI-P protocol', () => {
  it('accepts a dense pitch/REST layer without PAD', () => {
    const result = readSynthesisMidiPResult(message([255, 130, 130, 134]), 4)
    expect(result?.classes).toEqual([255, 130, 130, 134])
    expect(result?.runtimeHashes.game_model).toBe('model-hash')
  })

  it('rejects PAD in the effective B-local layer', () => {
    expect(() => readSynthesisMidiPResult(message([255, 130, 256, 134]), 4)).toThrow(/PAD/)
    expect(readSynthesisMidiPResult(message([255, 130]), 4)).toBeNull()
  })
})

function message(classes: number[]) {
  return {
    type: 'midi-p-result',
    result: {
      schema: 'aisvc.v5p-midi-p.v1', sourceSHA256: 'source-hash', sourceSampleCount: 8192,
      frameCount: classes.length, classes, noteIds: classes.map((_, index) => index + 1),
      rawNotes: [{ duration: 1, presence: true, score: 65, class: 130, valid: true }],
      baseSeed: 20260730, effectiveSeed: 42, language: 'ja', languageId: 2,
      gameCommit: 'commit', runtimeHashes: { game_model: 'model-hash' }, compilerSHA256: 'compiler-hash',
    },
  }
}

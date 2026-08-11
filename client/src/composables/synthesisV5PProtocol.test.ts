import { describe, expect, it } from 'vitest'
import { readSynthesisV5PResult } from './synthesisV5PProtocol'

describe('V5-P result protocol', () => {
  it('accepts a hash-bound immutable Take result', () => {
    expect(readSynthesisV5PResult({
      type: 'v5p-result',
      result: fixture(),
    }, 'v5p-job-test')).toEqual(fixture())
  })

  it('rejects another job or malformed output hash', () => {
    expect(readSynthesisV5PResult({ type: 'v5p-result', result: fixture() }, 'other-job')).toBeNull()
    expect(readSynthesisV5PResult({
      type: 'v5p-result', result: { ...fixture(), outputSHA256: 'bad' },
    }, 'v5p-job-test')).toBeNull()
  })
})

function fixture() {
  return {
    schema: 'aisvc.v5p-direct-result.v1',
    jobId: 'v5p-job-test',
    snapshotSHA256: 'a'.repeat(64),
    outputWav: 'E:/take.wav',
    outputSHA256: 'b'.repeat(64),
    sampleRate: 44100,
    sampleCount: 2048,
    duration: 2048 / 44100,
    auditFile: 'E:/audit.json',
    presetId: 'V5P_40K_EMA',
    checkpointSHA256: 'c'.repeat(64),
    vaeSHA256: 'd'.repeat(64),
    adapterSHA256: 'e'.repeat(64),
    seed: 42,
  }
}

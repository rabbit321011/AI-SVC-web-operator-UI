import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSynthesisTextControlJob,
  validateSynthesisTextControlRequest,
  type SynthesisTextControlRequest,
} from './synthesis-text-control.service.js'

test('Text Control job preserves the integer Segment frame contract', () => {
  const request = fixture()
  const job = buildSynthesisTextControlJob(request)
  assert.equal(job.mode, 'b_only')
  assert.deepEqual(job.targetPhrases.map(phrase => ({
    id: phrase.id,
    startFrame: phrase.startFrame,
    endFrameExclusive: phrase.endFrameExclusive,
  })), [
    { id: 'segment:a', startFrame: 8, endFrameExclusive: 24 },
    { id: 'segment:b', startFrame: 28, endFrameExclusive: 52 },
  ])
  assert.equal(job.targetPhrases[0].start, 8 * 2048 / 44100)
  assert.equal(job.targetPhrases[1].end, 52 * 2048 / 44100)
})

test('Text Control job preserves a terminal Kana H control boundary', () => {
  const request = fixture({
    sourceTrack: 'kana',
    phrases: [{
      id: 'kana-phrase:a',
      kana: 'なつ',
      startFrame: 8,
      endFrameExclusive: 24,
      controlEndFrameExclusive: 32,
    }],
  })
  const job = buildSynthesisTextControlJob(request)
  assert.equal(job.targetPhrases[0].controlEndFrameExclusive, 32)
})

test('Text Control rejects a terminal control boundary before speech end', () => {
  assert.throws(() => validateSynthesisTextControlRequest(fixture({
    sourceTrack: 'kana',
    phrases: [{
      id: 'kana-phrase:a',
      kana: 'なつ',
      startFrame: 8,
      endFrameExclusive: 24,
      controlEndFrameExclusive: 23,
    }],
  })), /H control 范围无效/)
})

test('Text Control requires exact Kana SEG control boundaries', () => {
  assert.throws(() => validateSynthesisTextControlRequest(fixture({
    sourceTrack: 'kana',
    phrases: [{
      id: 'kana-phrase:a', kana: 'なつ', startFrame: 8, endFrameExclusive: 24,
    }],
  })), /缺少 SEG control boundary/)
  assert.throws(() => validateSynthesisTextControlRequest(fixture({
    sourceTrack: 'kana',
    phrases: [
      {
        id: 'kana-phrase:a', kana: 'なつ', startFrame: 8, endFrameExclusive: 24,
        controlEndFrameExclusive: 31,
      },
      {
        id: 'kana-phrase:b', kana: 'の', startFrame: 32, endFrameExclusive: 48,
        controlEndFrameExclusive: 52,
      },
    ],
  })), /下一句起点不一致/)
})

test('Text Control rejects overlapping or non-frame Segment ranges', () => {
  assert.throws(() => validateSynthesisTextControlRequest(fixture({
    phrases: [
      { id: 'segment:a', kana: 'なつ', startFrame: 8, endFrameExclusive: 30 },
      { id: 'segment:b', kana: 'の', startFrame: 29, endFrameExclusive: 52 },
    ],
  })), /重叠/)
  assert.throws(() => validateSynthesisTextControlRequest(fixture({
    phrases: [{ id: 'segment:a', kana: 'なつ', startFrame: 8.5, endFrameExclusive: 30 }],
  })), /整数 frame/)
})

function fixture(overrides: Partial<SynthesisTextControlRequest> = {}): SynthesisTextControlRequest {
  return {
    jobId: 'text-control-test',
    inputWav: 'E:/fixture.wav',
    guideSHA256: 'a'.repeat(64),
    frameCount: 64,
    sourceTrack: 'segment',
    sourceRevision: 1,
    phrases: [
      { id: 'segment:a', kana: 'なつ', startFrame: 8, endFrameExclusive: 24 },
      { id: 'segment:b', kana: 'の', startFrame: 28, endFrameExclusive: 52 },
    ],
    sofaEscapeSeconds: 0,
    ...overrides,
  }
}

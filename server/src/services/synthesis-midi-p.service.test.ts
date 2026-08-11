import assert from 'node:assert/strict'
import test from 'node:test'
import { validateSynthesisMidiPRequest } from './synthesis-midi-p.service.js'

test('MIDI-P request accepts an empty target revision and fixed frame contract', () => {
  assert.doesNotThrow(() => validateSynthesisMidiPRequest({
    jobId: 'midi-p-test',
    inputWav: 'E:/guide.wav',
    guideSHA256: 'a'.repeat(64),
    frameCount: 64,
    midiPRevision: 0,
  }))
})

test('MIDI-P request rejects malformed revisions and frame counts', () => {
  assert.throws(() => validateSynthesisMidiPRequest({
    jobId: 'midi-p-test', inputWav: 'E:/guide.wav', guideSHA256: 'a'.repeat(64),
    frameCount: 0, midiPRevision: 0,
  }), /frameCount/)
  assert.throws(() => validateSynthesisMidiPRequest({
    jobId: 'midi-p-test', inputWav: 'E:/guide.wav', guideSHA256: 'a'.repeat(64),
    frameCount: 64, midiPRevision: -1,
  }), /revision/)
})

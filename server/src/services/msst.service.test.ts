import assert from 'node:assert/strict'
import test from 'node:test'
import { parseMsstEvent } from './msst.service'

test('MSST runner protocol parses structured events', () => {
  assert.deepEqual(parseMsstEvent('MSST_EVENT {"type":"progress","progress":33,"stage":"dereverb"}'), {
    type: 'progress', progress: 33, stage: 'dereverb',
  })
})

test('MSST runner protocol ignores normal logs and malformed events', () => {
  assert.equal(parseMsstEvent('loading model'), null)
  assert.equal(parseMsstEvent('MSST_EVENT nope'), null)
})

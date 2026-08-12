import assert from 'node:assert/strict'
import test from 'node:test'
import { getModelCatalog } from './model-catalog.service.js'

test('model catalog includes all configured SVS families instead of only V5-P', () => {
  const ids = new Set(getModelCatalog().map(item => item.id))
  for (const id of [
    'plus_ja_sft_v4c step24k',
    'V4fg_10k',
    'V4vf_12k',
    'V4vf_24k',
    'V4vf_30k',
    'V4vfg_6k',
    'V4vfg_10k',
    'V4H_24k',
    'V4H_30k',
    'V4Hg_10k',
    'V5P_40K_EMA',
  ]) assert.equal(ids.has(id), true, id)
})

test('catalog keeps PH/PUL and direct-control engines distinct', () => {
  const catalog = new Map(getModelCatalog().map(item => [item.id, item]))
  assert.equal(catalog.get('V4H_24k')?.engine, 'v4h_phone_pul')
  assert.equal(catalog.get('V5P_40K_EMA')?.engine, 'v5p_direct')
})

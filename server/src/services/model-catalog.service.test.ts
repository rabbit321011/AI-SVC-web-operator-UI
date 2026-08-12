import assert from 'node:assert/strict'
import test from 'node:test'
import { getModelCatalog } from './model-catalog.service.js'

test('model catalog only exposes the managed SVS families', () => {
  const ids = new Set(getModelCatalog().map(item => item.id))
  for (const id of [
    'V4fg_10k',
    'V4Hg_10k',
    'V5P_40K_EMA',
  ]) assert.equal(ids.has(id), true, id)
  for (const id of [
    'plus_ja_sft_v4c step24k',
    'V4H_24k',
    'V4H_30k',
    'V4PH',
    'V4iph_30k',
    'v4ijph_30k',
    'V4Sf_30k',
  ]) assert.equal(ids.has(id), false, id)
})

test('catalog keeps PH/PUL and direct-control engines distinct', () => {
  const catalog = new Map(getModelCatalog().map(item => [item.id, item]))
  assert.equal(catalog.get('V4Hg_10k')?.engine, 'v4h_phone_pul')
  assert.equal(catalog.get('V4fg_10k')?.engine, 't1')
  assert.equal(catalog.get('V5P_40K_EMA')?.engine, 'v5p_direct')
})

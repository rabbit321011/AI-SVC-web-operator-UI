import assert from 'node:assert/strict'
import test from 'node:test'
import { chooseEvictions, estimateGpuMemory, evictionOrder } from './gpu-policy.service.js'
import type { ModelRuntimeStatus } from './model-runtime.service.js'

test('duration estimate uses the next larger calibrated sample and falls back to max', () => {
  const short = estimateGpuMemory('V5P_40K_EMA', 35)
  assert.equal(short.sampleSeconds, 60)
  const beyond = estimateGpuMemory('V5P_40K_EMA', 500)
  assert.equal(beyond.sampleSeconds, 60)
})

test('eviction order excludes the active model and sorts by last use', () => {
  const runtimes: ModelRuntimeStatus[] = [
    runtime('V4fg_10k', '2026-08-12T10:00:00Z'),
    runtime('V4Hg_10k', '2026-08-12T11:00:00Z'),
    runtime('V5P_40K_EMA', '2026-08-12T09:00:00Z'),
  ]
  const order = evictionOrder(runtimes, 'V5P_40K_EMA')
  assert.deepEqual(order.map(item => item.modelId), ['V4fg_10k', 'V4Hg_10k'])
})

test('chooseEvictions keeps evicting until enough memory is available', () => {
  const runtimes: ModelRuntimeStatus[] = [
    { ...runtime('V4fg_10k', '2026-08-12T10:00:00Z'), residentMiB: 2810 },
    { ...runtime('V4Hg_10k', '2026-08-12T11:00:00Z'), residentMiB: 2810 },
  ]
  const evicted = chooseEvictions(runtimes, 'V5P_40K_EMA', 6000, 1000)
  assert.deepEqual(evicted.map(item => item.modelId), ['V4fg_10k', 'V4Hg_10k'])
  const one = chooseEvictions(runtimes, 'V5P_40K_EMA', 3500, 1000)
  assert.deepEqual(one.map(item => item.modelId), ['V4fg_10k'])
})

function runtime(modelId: string, lastUsedAt: string): ModelRuntimeStatus {
  return {
    id: modelId,
    modelId,
    device: 'cuda:0',
    state: 'ready',
    lastUsedAt,
  }
}

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSvsConfigStore } from './svsConfig'

describe('SVS model metadata', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('preserves explicit checkpoint to VAE bindings', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        V4fg_10k: {
          checkpoint: 'models/v4fg.pt',
          vaeCheckpoint: 'ckpts/autoencoder_285k.ckpt',
        },
        V4H_24k: {
          engine: 'v4h_phone_pul',
          checkpoint: 'models/v4h.pt',
          vaeCheckpoint: 'ckpts/official.ckpt',
        },
        legacy: 'models/legacy.pt',
      }),
    })))
    const store = useSvsConfigStore()

    await store.fetchModels()
    store.selectModel('V4fg_10k')

    expect(store.selectedModel).toMatchObject({
      checkpoint: 'models/v4fg.pt',
      vaeCheckpoint: 'ckpts/autoencoder_285k.ckpt',
    })
    expect(store.models.find(model => model.name === 'legacy')).toEqual({
      name: 'legacy',
      checkpoint: 'models/legacy.pt',
      engine: 't1',
    })
    expect(store.models.find(model => model.name === 'V4H_24k')?.engine).toBe('v4h_phone_pul')
  })
})

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
    })
  })
})

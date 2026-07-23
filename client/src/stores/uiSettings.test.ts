import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useUiSettingsStore } from './uiSettings'

describe('ui settings store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { storage.set(key, value) }),
      removeItem: vi.fn((key: string) => { storage.delete(key) }),
      clear: vi.fn(() => { storage.clear() }),
    })
    localStorage.clear()
  })

  it('persists theme and opacity settings locally', async () => {
    const settings = useUiSettingsStore()

    settings.update('theme', 'cream')
    settings.update('centerOpacity', 0.55)
    await Promise.resolve()

    const stored = JSON.parse(localStorage.getItem('aisvc-ui-settings.v0.32') || '{}')
    expect(stored.theme).toBe('cream')
    expect(stored.centerOpacity).toBe(0.55)
    expect(settings.rootClass).toBe('theme-cream')
    expect(settings.cssVars['--center-opacity-percent']).toBe('55%')
  })

  it('stores backend background image urls instead of large local data urls', () => {
    const settings = useUiSettingsStore()
    const result = settings.setBackgroundImageUrl('/api/projects/demo/ui/background.png')

    expect(result.ok).toBe(true)
    expect(settings.settings.backgroundImageUrl).toBe('/api/projects/demo/ui/background.png')
    expect(settings.settings.backgroundImageDataUrl).toBe('')
    expect(settings.cssVars['--workbench-bg-image']).toBe('url("/api/projects/demo/ui/background.png")')

    settings.clearBackgroundImage()
    expect(settings.settings.backgroundImageUrl).toBe('')
    expect(settings.settings.backgroundImageEnabled).toBe(false)
  })

  it('ignores localStorage quota failures while keeping in-memory settings', async () => {
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota') })
    const settings = useUiSettingsStore()

    settings.update('theme', 'light')
    await Promise.resolve()

    expect(settings.settings.theme).toBe('light')
    spy.mockRestore()
  })
})

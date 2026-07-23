import { computed, reactive, watch } from 'vue'
import { defineStore } from 'pinia'

export type WorkbenchTheme = 'night' | 'light' | 'cream'

const STORAGE_KEY = 'aisvc-ui-settings.v0.32'
export interface UiSettingsState {
  theme: WorkbenchTheme
  autoSaveIntervalMinutes: number
  svcDefaultModel: string
  svcDefaultSteps: number
  svcDefaultCfg: number
  svsDefaultModel: string
  svsDefaultSteps: number
  centerOpacity: number
  sideOpacity: number
  topbarOpacity: number
  backgroundImageEnabled: boolean
  backgroundImageUrl: string
  backgroundImageDataUrl: string
  sidebarGlassEnabled: boolean
  centerGlassEnabled: boolean
  l1Collapsed: boolean
  l2Collapsed: boolean
}

const defaults: UiSettingsState = {
  theme: 'night',
  autoSaveIntervalMinutes: 5,
  svcDefaultModel: '',
  svcDefaultSteps: 100,
  svcDefaultCfg: 0.7,
  svsDefaultModel: '',
  svsDefaultSteps: 32,
  centerOpacity: 1,
  sideOpacity: 1,
  topbarOpacity: 1,
  backgroundImageEnabled: false,
  backgroundImageUrl: '',
  backgroundImageDataUrl: '',
  sidebarGlassEnabled: false,
  centerGlassEnabled: false,
  l1Collapsed: false,
  l2Collapsed: false,
}

export const useUiSettingsStore = defineStore('uiSettings', () => {
  const settings = reactive<UiSettingsState>(loadSettings())

  const rootClass = computed(() => `theme-${settings.theme}`)
  const cssVars = computed(() => ({
    '--topbar-opacity': String(clamp01(settings.topbarOpacity)),
    '--side-opacity': String(clamp01(settings.sideOpacity)),
    '--center-opacity': String(clamp01(settings.centerOpacity)),
    '--topbar-opacity-percent': `${Math.round(clamp01(settings.topbarOpacity) * 100)}%`,
    '--side-opacity-percent': `${Math.round(clamp01(settings.sideOpacity) * 100)}%`,
    '--center-opacity-percent': `${Math.round(clamp01(settings.centerOpacity) * 100)}%`,
    '--track-canvas-bg-alpha': String(clamp01(settings.centerOpacity)),
    '--workbench-bg-image': settings.backgroundImageEnabled && settings.backgroundImageDataUrl
      ? `url("${settings.backgroundImageDataUrl}")`
      : settings.backgroundImageEnabled && settings.backgroundImageUrl
        ? `url("${settings.backgroundImageUrl}")`
      : 'none',
  }))

  watch(settings, () => persistSettings(settings), { deep: true })

  function update<K extends keyof UiSettingsState>(key: K, value: UiSettingsState[K]) {
    ;(settings[key] as UiSettingsState[K]) = value
    normalize()
    return true
  }

  function setBackgroundImageUrl(url: string): { ok: boolean; reason?: string } {
    if (!url.trim()) return { ok: false, reason: '背景图片地址为空' }
    settings.backgroundImageUrl = url
    settings.backgroundImageDataUrl = ''
    settings.backgroundImageEnabled = true
    return { ok: true }
  }

  function setBackgroundImageDataUrl(dataUrl: string): { ok: boolean; reason?: string } {
    settings.backgroundImageDataUrl = dataUrl
    settings.backgroundImageUrl = ''
    settings.backgroundImageEnabled = true
    return { ok: true }
  }

  function clearBackgroundImage() {
    settings.backgroundImageUrl = ''
    settings.backgroundImageDataUrl = ''
    settings.backgroundImageEnabled = false
  }

  function reset() {
    Object.assign(settings, defaults)
  }

  function normalize() {
    settings.autoSaveIntervalMinutes = clampNumber(settings.autoSaveIntervalMinutes, 1, 120)
    settings.svcDefaultSteps = clampNumber(settings.svcDefaultSteps, 1, 200)
    settings.svcDefaultCfg = clampNumber(settings.svcDefaultCfg, 0, 10)
    settings.svsDefaultSteps = clampNumber(settings.svsDefaultSteps, 1, 200)
    settings.centerOpacity = clamp01(settings.centerOpacity)
    settings.sideOpacity = clamp01(settings.sideOpacity)
    settings.topbarOpacity = clamp01(settings.topbarOpacity)
  }

  return {
    settings,
    rootClass,
    cssVars,
    update,
    setBackgroundImageUrl,
    setBackgroundImageDataUrl,
    clearBackgroundImage,
    reset,
  }
})

function loadSettings(): UiSettingsState {
  if (typeof localStorage === 'undefined') return { ...defaults }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...defaults }
    const parsed = JSON.parse(raw) as Partial<UiSettingsState>
    return { ...defaults, ...parsed }
  } catch {
    return { ...defaults }
  }
}

function persistSettings(settings: UiSettingsState) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Ignore storage quota errors; the in-memory settings still apply.
  }
}

function clamp01(value: number): number {
  return clampNumber(value, 0.2, 1)
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

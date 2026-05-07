import { defineStore } from 'pinia'
import { reactive } from 'vue'
import type { SvcRuntimeConfig } from '@/types'

const BASE = 'E:/AIscene/AISVCs/temp/temp_0502/output_models'
const TARGET = 'E:/AIscene/AISVCs/YingMusic_fork/花丸-平-voice.mp3'
const CONFIG = 'E:/AIscene/AISVCs/YingMusic-SVC/configs/YingMusic-SVC.yml'

const DEFAULT_CONFIG: SvcRuntimeConfig = {
  modelName: 'v3 20k campplus',
  checkpoint: `${BASE}/spkemb_v3_lr3e-5_20k/ft_model.pth`,
  configYml: CONFIG,
  targetAudio: TARGET,
  diffusionSteps: 100,
  inferenceCfgRate: 0.7,
  f0Condition: true,
  semiToneShift: null,
  device: '0',
  fp16: true,
}

const PRESETS: SvcRuntimeConfig[] = [
  DEFAULT_CONFIG,
  {
    modelName: '默认模型 (未微调)',
    checkpoint: 'E:/AIscene/AISVCs/YingMusic-SVC/YingMusic-SVC-full.pt',
    configYml: CONFIG,
    targetAudio: TARGET,
    diffusionSteps: 100,
    inferenceCfgRate: 0.7,
    f0Condition: true,
    semiToneShift: null,
    device: '0',
    fp16: true,
  },
  {
    modelName: 'cosine 3000',
    checkpoint: `${BASE}/yingmusic_cosine/ft_model.pth`,
    configYml: CONFIG,
    targetAudio: TARGET,
    diffusionSteps: 30,
    inferenceCfgRate: 0.7,
    f0Condition: true,
    semiToneShift: null,
    device: '0',
    fp16: true,
  },
  {
    modelName: 'exp1 12000',
    checkpoint: `${BASE}/yingmusic_exp1/ft_model.pth`,
    configYml: CONFIG,
    targetAudio: TARGET,
    diffusionSteps: 50,
    inferenceCfgRate: 0.7,
    f0Condition: true,
    semiToneShift: null,
    device: '0',
    fp16: true,
  },
  {
    modelName: 'spkemb 60k',
    checkpoint: `${BASE}/yingmusic_spkemb_60k/ft_model.pth`,
    configYml: CONFIG,
    targetAudio: TARGET,
    diffusionSteps: 50,
    inferenceCfgRate: 0.7,
    f0Condition: true,
    semiToneShift: null,
    device: '0',
    fp16: true,
  },
]

export const useSvcConfigStore = defineStore('svcConfig', () => {
  const config = reactive<SvcRuntimeConfig>({ ...DEFAULT_CONFIG })

  const presets = PRESETS

  function updateField<K extends keyof SvcRuntimeConfig>(key: K, value: SvcRuntimeConfig[K]) {
    config[key] = value
  }

  function selectPreset(name: string) {
    const preset = presets.find(p => p.modelName === name)
    if (preset) {
      Object.assign(config, preset)
    }
  }

  return { config, presets, updateField, selectPreset }
})

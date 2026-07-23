import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'

export interface SvsModelPreset {
  name: string
  checkpoint: string
  vaeCheckpoint?: string
}

interface SvsModelPayload {
  checkpoint: string
  vaeCheckpoint?: string
}

export const useSvsConfigStore = defineStore('svsConfig', () => {
  const loaded = ref(false)
  const models = reactive<SvsModelPreset[]>([])
  const selectedName = ref('')

  async function fetchModels() {
    if (loaded.value) return
    try {
      const resp = await fetch('/api/svs/models')
      if (!resp.ok) throw new Error('加载 SVS 模型列表失败')
      const data = await resp.json()
      models.length = 0
      for (const [name, value] of Object.entries(data)) {
        if (typeof value === 'string') {
          models.push({ name, checkpoint: value })
          continue
        }
        const preset = value as SvsModelPayload
        if (!preset?.checkpoint) continue
        models.push({
          name,
          checkpoint: String(preset.checkpoint),
          vaeCheckpoint: preset.vaeCheckpoint ? String(preset.vaeCheckpoint) : undefined,
        })
      }
      loaded.value = true
    } catch (err) {
      console.warn('[svsConfig] 无法加载模型列表:', err)
    }
  }

  function selectModel(name: string) {
    selectedName.value = name
  }

  const selectedModel = computed(() => models.find(m => m.name === selectedName.value))
  const selectedCheckpoint = computed(() => selectedModel.value?.checkpoint ?? '')

  return { loaded, models, selectedName, selectedModel, selectedCheckpoint, fetchModels, selectModel }
})

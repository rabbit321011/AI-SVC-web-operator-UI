import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'

export interface SvsModelPreset {
  name: string
  checkpoint: string
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
      for (const [name, checkpoint] of Object.entries(data)) {
        models.push({ name, checkpoint: String(checkpoint) })
      }
      loaded.value = true
    } catch (err) {
      console.warn('[svsConfig] 无法加载模型列表:', err)
    }
  }

  function selectModel(name: string) {
    selectedName.value = name
  }

  const selectedCheckpoint = computed(() => {
    const found = models.find(m => m.name === selectedName.value)
    return found?.checkpoint ?? ''
  })

  return { loaded, models, selectedName, selectedCheckpoint, fetchModels, selectModel }
})

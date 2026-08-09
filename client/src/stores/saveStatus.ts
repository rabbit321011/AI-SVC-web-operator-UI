import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

export const useSaveStatusStore = defineStore('saveStatus', () => {
  const state = ref<'idle' | 'saving' | 'success' | 'error'>('idle')
  const message = ref('')
  const completed = ref(0)
  const total = ref(0)
  let clearTimer: number | null = null

  const percent = computed(() => total.value > 0 ? Math.round(completed.value / total.value * 100) : 0)

  function begin(blobTotal: number) {
    cancelClear()
    state.value = 'saving'
    completed.value = 0
    total.value = blobTotal
    message.value = blobTotal > 0 ? `保存音频 0/${blobTotal}` : '保存项目数据'
  }

  function setBlobProgress(blobCompleted: number, blobTotal: number) {
    state.value = 'saving'
    completed.value = blobCompleted
    total.value = blobTotal
    message.value = `保存音频 ${blobCompleted}/${blobTotal}`
  }

  function setMetadata() {
    state.value = 'saving'
    completed.value = total.value
    message.value = '保存项目数据'
  }

  function succeed() {
    cancelClear()
    state.value = 'success'
    message.value = '项目已保存'
    clearTimer = window.setTimeout(() => {
      state.value = 'idle'
      clearTimer = null
    }, 4000)
  }

  function fail(reason: string) {
    cancelClear()
    state.value = 'error'
    message.value = reason
  }

  function cancelClear() {
    if (clearTimer != null) window.clearTimeout(clearTimer)
    clearTimer = null
  }

  return { state, message, completed, total, percent, begin, setBlobProgress, setMetadata, succeed, fail }
})

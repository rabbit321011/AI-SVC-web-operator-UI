import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const usePlaybackStore = defineStore('playback', () => {
  const isPlaying = ref(false)
  const currentTime = ref(0)
  const totalDuration = ref(0)

  function setPlaying(val: boolean) { isPlaying.value = val }
  function setCurrentTime(t: number) { currentTime.value = t }
  function setTotalDuration(d: number) { totalDuration.value = d }

  function reset() {
    isPlaying.value = false
    currentTime.value = 0
    totalDuration.value = 0
  }

  return {
    isPlaying, currentTime, totalDuration,
    setPlaying, setCurrentTime, setTotalDuration, reset,
  }
})

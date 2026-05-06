<script setup lang="ts">
import { computed } from 'vue'
import { useTracksStore } from '@/stores/tracks'
import { useSelectionStore } from '@/stores/selection'
import TrackHeader from './TrackHeader.vue'
import TrackCanvas from './TrackCanvas.vue'
import type { TrackId } from '@/types'

const props = defineProps<{ trackId: TrackId }>()

const tracks = useTracksStore()
const selection = useSelectionStore()

const track = computed(() => tracks.tracks[props.trackId])

const isSelected = computed(() => selection.isSelected(props.trackId))
const isIgnored = computed(() => track.value?.ignored ?? false)
</script>

<template>
  <div
    v-if="track"
    class="track-row"
    :data-track-id="trackId"
    :class="{
      selected: isSelected,
      ignored: isIgnored,
    }"
  >
    <TrackHeader :track-id="trackId" />
    <TrackCanvas :track-id="trackId" />
  </div>
</template>

<style scoped>
.track-row {
  display: flex;
  border-bottom: 1px solid #21262d;
  min-height: 140px;
  transition: opacity 0.2s;
  width: max-content;
}
.track-row.selected {
  background: rgba(88, 166, 255, 0.04);
}
.track-row.ignored {
  opacity: 0.4;
}
</style>

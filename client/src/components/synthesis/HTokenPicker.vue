<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NInput, NModal, NRadioButton, NRadioGroup } from 'naive-ui'
import {
  V5P_H_TOKEN_BY_ID,
  V5P_H_TOKEN_CATALOG,
  type V5PHTokenCatalogEntry,
} from '@/generated/v5pHTokenCatalog'

const props = defineProps<{
  show: boolean
  frame: number
  currentTokenId: number | null
}>()
const emit = defineEmits<{
  'update:show': [value: boolean]
  select: [entry: V5PHTokenCatalogEntry | null]
}>()

const search = ref('')
const mode = ref<'pronunciation' | 'seen' | 'all'>('pronunciation')
const hoveredId = ref<number | null>(null)

const pronunciationTokens = new Set([
  'p', 'b', 't', 'd', 'k', 'v', 's', 'z', 'm', 'n', 'j', 'i', 'ɾ', 'a', 'o',
  'ɯ', 'e', 'ç', 'ɸ', 'ɰᵝ', 'ɴ', 'g', 'dʑ', 'q',
  'bj', 'tɕ', 'dej', 'gj', 'çj', 'kj', 'mj', 'nj', 'pj', 'ɾj', 'ɕ', 'tsɯ',
])

const entries = computed(() => {
  let source = V5P_H_TOKEN_CATALOG.filter(entry => entry.id !== 0 && entry.id !== 364)
  if (mode.value === 'pronunciation') {
    source = source.filter(entry => pronunciationTokens.has(entry.token))
  } else if (mode.value === 'seen') {
    source = source.filter(entry => entry.v5p40kSeen)
  }
  const term = search.value.trim().toLocaleLowerCase()
  if (!term) return source
  return source.filter(entry => [
    entry.id,
    entry.token,
    entry.chineseName,
    entry.explanation,
    entry.editorVisibility,
  ].some(value => String(value).toLocaleLowerCase().includes(term)))
})

const inspected = computed(() => {
  const id = hoveredId.value ?? props.currentTokenId
  return id == null ? null : V5P_H_TOKEN_BY_ID.get(id) ?? null
})

watch(() => props.show, show => {
  if (!show) return
  search.value = ''
  mode.value = 'pronunciation'
  hoveredId.value = props.currentTokenId
})

function choose(entry: V5PHTokenCatalogEntry | null) {
  emit('select', entry)
  emit('update:show', false)
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    :title="`H Token · frame ${frame}`"
    class="h-picker-modal"
    @update:show="emit('update:show', $event)"
  >
    <div class="picker-toolbar">
      <NRadioGroup v-model:value="mode" size="small">
        <NRadioButton value="pronunciation">发音 36</NRadioButton>
        <NRadioButton value="seen">训练见过 45</NRadioButton>
        <NRadioButton value="all">全部 367</NRadioButton>
      </NRadioGroup>
      <NInput v-model:value="search" size="small" clearable placeholder="中文、symbol 或 ID" />
      <NButton size="small" secondary @click="choose(null)">清除事件</NButton>
    </div>

    <div class="picker-body">
      <div class="token-grid">
        <button
          v-for="entry in entries"
          :key="entry.id"
          type="button"
          class="token-option"
          :class="{ current: entry.id === currentTokenId, unseen: !entry.v5p40kSeen }"
          @mouseenter="hoveredId = entry.id"
          @focus="hoveredId = entry.id"
          @click="choose(entry)"
        >
          <strong>{{ entry.token }}</strong>
          <span>{{ entry.chineseName }}</span>
          <small>ID {{ entry.id }}</small>
        </button>
        <div v-if="entries.length === 0" class="no-results">没有匹配的 Token</div>
      </div>

      <aside class="token-inspector">
        <template v-if="inspected">
          <div class="inspector-heading">
            <strong>{{ inspected.chineseName }}</strong>
            <code>{{ inspected.token }}</code>
          </div>
          <p>{{ inspected.explanation }}</p>
          <dl>
            <dt>Runtime ID</dt><dd>{{ inspected.id }}</dd>
            <dt>日语编辑器</dt><dd>{{ inspected.editorVisibility }}</dd>
            <dt>V5-P 40K</dt><dd :class="{ seen: inspected.v5p40kSeen, unseenText: !inspected.v5p40kSeen }">{{ inspected.trainingEvidence }}</dd>
          </dl>
        </template>
        <p v-else class="inspector-empty">悬停一个 Token 查看中文说明</p>
      </aside>
    </div>
  </NModal>
</template>

<style>
.h-picker-modal.n-card {
  width: min(820px, calc(100vw - 48px));
  height: min(640px, calc(100vh - 48px));
  border-radius: 6px;
  background: #171c22;
  color: #d8dee7;
}
.h-picker-modal .n-card__content { min-height: 0; display: flex; flex-direction: column; }
.picker-toolbar { display: grid; grid-template-columns: auto minmax(180px, 1fr) auto; gap: 10px; align-items: center; padding-bottom: 12px; border-bottom: 1px solid #303844; }
.picker-body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 250px; }
.token-grid { min-height: 0; overflow: auto; padding: 12px 12px 12px 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); align-content: start; gap: 6px; }
.token-option { min-width: 0; height: 58px; display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: 28px 18px; gap: 0 6px; padding: 5px 7px; border: 1px solid #38424d; border-radius: 4px; background: #11161b; color: #d8dee7; text-align: left; cursor: pointer; }
.token-option:hover,
.token-option:focus-visible { border-color: #5dc9b1; outline: none; background: #18242a; }
.token-option.current { border-color: #d2a85b; box-shadow: inset 0 0 0 1px #d2a85b; }
.token-option.unseen { opacity: 0.62; }
.token-option strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; font: 16px/28px ui-monospace, SFMono-Regular, Consolas, monospace; }
.token-option span { grid-column: 1 / -1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #aeb8c5; font-size: 10px; }
.token-option small { color: #6f7b89; font: 9px/28px ui-monospace, SFMono-Regular, Consolas, monospace; }
.token-inspector { min-width: 0; padding: 14px; border-left: 1px solid #303844; background: #13181e; overflow: auto; }
.inspector-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.inspector-heading strong { font-size: 14px; }
.inspector-heading code { color: #f1b7c7; font-size: 17px; }
.token-inspector p { color: #aeb8c5; font-size: 12px; line-height: 1.65; }
.token-inspector dl { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 8px; margin-top: 18px; font-size: 11px; }
.token-inspector dt { color: #6f7b89; }
.token-inspector dd { min-width: 0; margin: 0; color: #c7d0da; overflow-wrap: anywhere; }
.token-inspector .seen { color: #5dc9b1; }
.token-inspector .unseenText { color: #e7b45d; }
.inspector-empty,
.no-results { color: #6f7b89; font-size: 11px; }
.no-results { grid-column: 1 / -1; padding: 20px; text-align: center; }
</style>

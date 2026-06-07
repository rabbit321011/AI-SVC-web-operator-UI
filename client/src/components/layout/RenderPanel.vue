<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NInput, NInputNumber, NSpace, NTag } from 'naive-ui'
import { useRenderPanelStore } from '@/stores/renderPanel'
import { useSelectionStore } from '@/stores/selection'
import { useObjectTreeStore } from '@/stores/objectTree'
import { useProjectStore } from '@/stores/project'
import type { RenderSlotId } from '@/object-workbench'

const renderPanel = useRenderPanelStore()
const selection = useSelectionStore()
const objectTree = useObjectTreeStore()
const project = useProjectStore()
const notice = ref('')

const selectedObjectNodeId = computed(() => {
  const selected = selection.ids[0]
  if (!selected || selection.ids.length !== 1) return null
  if (selected.startsWith('seg_')) return objectTree.legacyMaps?.trackObjectIdBySegmentId[selected] ?? `node:trackObject:${selected}`
  if (selected.startsWith('cgrp_')) return objectTree.legacyMaps?.groupObjectIdByCompGroupId[selected] ?? `node:group:${selected}`
  return selected
})

function pickSelected(slotId: RenderSlotId) {
  objectTree.loadFromLegacyProject(project.toJSON())
  const id = selectedObjectNodeId.value
  if (!id) {
    flash('请选择一个片段或合成组')
    return
  }
  const result = renderPanel.setSlotFromNode(slotId, id)
  flash(result.ok ? '已放入槽位' : result.reason ?? '无法放入槽位')
}

function handleDrop(slotId: RenderSlotId, event: DragEvent) {
  event.preventDefault()
  objectTree.loadFromLegacyProject(project.toJSON())
  const id = event.dataTransfer?.getData('application/x-aisvc-node-id') || event.dataTransfer?.getData('text/plain')
  if (!id) {
    flash('没有可放入的对象')
    return
  }
  const result = renderPanel.setSlotFromNode(slotId, id)
  flash(result.ok ? '已放入槽位' : result.reason ?? '无法放入槽位')
}

function allowDrop(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function flash(message: string) {
  notice.value = message
  window.setTimeout(() => {
    if (notice.value === message) notice.value = ''
  }, 1400)
}

function slotLabel(input: { displayName: string; kind: string } | null) {
  return input ? `${input.kind}: ${input.displayName}` : '未选择'
}
</script>

<template>
  <aside class="render-panel">
    <div class="panel-header">
      <button class="mode-btn" :class="{ active: renderPanel.mode === 'svc' }" @click="renderPanel.setMode('svc')">SVC</button>
      <button class="mode-btn" :class="{ active: renderPanel.mode === 'svs' }" @click="renderPanel.setMode('svs')">SVS</button>
    </div>

    <div v-if="renderPanel.mode === 'svc'" class="panel-body">
      <div class="slot-row" @dragover="allowDrop" @drop="handleDrop('svc.condAudio', $event)">
        <div class="slot-title">cond音频</div>
        <n-tag size="small" :bordered="false">{{ slotLabel(renderPanel.svc.condAudio) }}</n-tag>
        <n-button size="tiny" @click="pickSelected('svc.condAudio')">放入</n-button>
      </div>
      <div class="slot-row" @dragover="allowDrop" @drop="handleDrop('svc.sourceAudio', $event)">
        <div class="slot-title">被变声音频</div>
        <n-tag size="small" :bordered="false">{{ slotLabel(renderPanel.svc.sourceAudio) }}</n-tag>
        <n-button size="tiny" @click="pickSelected('svc.sourceAudio')">放入</n-button>
      </div>
      <n-space vertical :size="8">
        <label class="field-label">输出名</label>
        <n-input v-model:value="renderPanel.svc.outputName" size="small" placeholder="SVC_output" />
        <label class="field-label">cfg</label>
        <n-input-number v-model:value="renderPanel.svc.cfg" size="small" :min="0" :max="1" :step="0.1" />
        <label class="field-label">step</label>
        <n-input-number v-model:value="renderPanel.svc.steps" size="small" :min="10" :max="200" :step="10" />
      </n-space>
      <n-button type="primary" size="small" :disabled="!renderPanel.canRunSvc" block>合成</n-button>
    </div>

    <div v-else class="panel-body">
      <div class="slot-row" @dragover="allowDrop" @drop="handleDrop('svs.timbreAudio', $event)">
        <div class="slot-title">音色音频</div>
        <n-tag size="small" :bordered="false">{{ slotLabel(renderPanel.svs.timbreAudio) }}</n-tag>
        <n-button size="tiny" @click="pickSelected('svs.timbreAudio')">放入</n-button>
      </div>
      <div class="slot-row" @dragover="allowDrop" @drop="handleDrop('svs.melody', $event)">
        <div class="slot-title">旋律音频</div>
        <n-tag size="small" :bordered="false">{{ slotLabel(renderPanel.svs.melody) }}</n-tag>
        <n-button size="tiny" @click="pickSelected('svs.melody')">放入</n-button>
      </div>
      <div class="slot-row" @dragover="allowDrop" @drop="handleDrop('svs.text', $event)">
        <div class="slot-title">target text</div>
        <n-tag size="small" :bordered="false">{{ renderPanel.svs.textMode === 'ref' ? slotLabel(renderPanel.svs.textRef) : '手写' }}</n-tag>
        <n-button size="tiny" @click="pickSelected('svs.text')">引用</n-button>
      </div>
      <n-space vertical :size="8">
        <n-input v-model:value="renderPanel.svs.manualText" type="textarea" size="small" placeholder="假名歌词" @focus="renderPanel.svs.textMode = 'manual'" />
        <label class="field-label">cfg</label>
        <n-input-number v-model:value="renderPanel.svs.cfg" size="small" :min="0" :max="10" :step="0.1" />
        <label class="field-label">step</label>
        <n-input-number v-model:value="renderPanel.svs.steps" size="small" :min="1" :max="200" :step="1" />
      </n-space>
      <n-button type="primary" size="small" :disabled="!renderPanel.canRunSvs" block>合成</n-button>
    </div>

    <div class="notice">{{ notice }}</div>
  </aside>
</template>

<style scoped>
.render-panel {
  width: 230px;
  flex-shrink: 0;
  background: #161b22;
  border-left: 1px solid #21262d;
  display: flex;
  flex-direction: column;
}
.panel-header {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-bottom: 1px solid #21262d;
}
.mode-btn {
  height: 34px;
  border: 0;
  background: transparent;
  color: #8b949e;
  cursor: pointer;
}
.mode-btn.active {
  color: #fff;
  background: #1f6feb;
}
.panel-body {
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.slot-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px;
  align-items: center;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 4px;
}
.slot-row:hover { border-color: #30363d; }
.slot-title {
  grid-column: 1 / -1;
  font-size: 11px;
  color: #8b949e;
}
.field-label {
  font-size: 11px;
  color: #8b949e;
}
.notice {
  min-height: 18px;
  padding: 0 10px 10px;
  font-size: 11px;
  color: #f0b72f;
}
</style>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NCheckbox, NInput, NInputNumber, NSelect, NSpace, NTag } from 'naive-ui'
import { useRenderPanelStore } from '@/stores/renderPanel'
import { useSelectionStore } from '@/stores/selection'
import { useObjectTreeStore } from '@/stores/objectTree'
import { useObjectTreeUiStore } from '@/stores/objectTreeUi'
import { useSvcConfigStore } from '@/stores/svcConfig'
import { useRenderSvcPipeline } from '@/composables/useRenderSvcPipeline'
import { useRenderSvsPipeline } from '@/composables/useRenderSvsPipeline'
import { validateRenderSlot, type RenderInputRef, type RenderSlotId } from '@/object-workbench'

const renderPanel = useRenderPanelStore()
const selection = useSelectionStore()
const objectTree = useObjectTreeStore()
const objectTreeUi = useObjectTreeUiStore()
const svcConfig = useSvcConfigStore()
const renderSvcPipeline = useRenderSvcPipeline()
const renderSvsPipeline = useRenderSvsPipeline()
const notice = ref('')

const selectedObjectNodeId = computed(() => {
  if (objectTreeUi.selectedIds.length === 1) return objectTreeUi.selectedIds[0]
  const selected = selection.ids[0]
  if (!selected || selection.ids.length !== 1) return null
  if (selected.startsWith('seg_')) return objectTree.legacyMaps?.trackObjectIdBySegmentId[selected] ?? `node:trackObject:${selected}`
  if (selected.startsWith('cgrp_')) return objectTree.legacyMaps?.groupObjectIdByCompGroupId[selected] ?? `node:group:${selected}`
  return selected
})

const modelOptions = computed(() => svcConfig.presets.map(p => ({ label: p.modelName, value: p.modelName })))
const msstOutputOptions = [
  { label: '人声 + 伴奏', value: 'vocals_accompaniment' },
  { label: '仅人声', value: 'vocals' },
  { label: '仅伴奏', value: 'accompaniment' },
  { label: '去噪输出', value: 'denoise' },
  { label: '其他 stem', value: 'other' },
]

function pickSelected(slotId: RenderSlotId) {
  if (isSlotLocked(slotId)) {
    flash(localProcessingMessage())
    return
  }
  const id = selectedObjectNodeId.value
  if (!id) {
    flash('请选择一个对象')
    return
  }
  const result = renderPanel.setSlotFromNode(slotId, id)
  flash(result.ok ? '已放入槽位' : result.reason ?? '无法放入槽位')
}

function handleDrop(slotId: RenderSlotId, event: DragEvent) {
  event.preventDefault()
  if (isSlotLocked(slotId)) {
    flash(localProcessingMessage())
    return
  }
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

function slotReason(slotId: RenderSlotId, input: RenderInputRef | null) {
  const validation = validateRenderSlot(objectTree.tree, slotId, input)
  return validation.ok ? '' : validation.reason ?? '槽位不可用'
}

function clearSlot(slotId: RenderSlotId) {
  if (isSlotLocked(slotId)) {
    flash(localProcessingMessage())
    return
  }
  renderPanel.clearSlot(slotId)
}

function isSlotLocked(slotId: RenderSlotId) {
  if (!renderPanel.isLocalProcessingRunning) return false
  if (slotId.startsWith('svc.')) return renderPanel.localProcessingTool !== 'svc'
  if (slotId.startsWith('svs.')) return renderPanel.localProcessingTool !== 'svs'
  if (slotId.startsWith('whisper.')) return renderPanel.localProcessingTool !== 'whisper'
  if (slotId.startsWith('msst.')) return renderPanel.localProcessingTool !== 'msst'
  return true
}

function isToolLocked(tool: 'svc' | 'svs' | 'whisper' | 'msst') {
  return renderPanel.isLocalProcessingRunning && renderPanel.localProcessingTool !== tool
}

function localProcessingMessage() {
  return renderPanel.localProcessingTool ? `${renderPanel.localProcessingTool.toUpperCase()} 运行中` : '本地任务运行中'
}

async function runSvc() {
  await renderSvcPipeline.startSvc()
  if (renderPanel.svcStatus === 'failed') flash(renderPanel.svcMessage || 'SVC 执行失败')
}

async function runSvsDryRun() {
  await renderSvsPipeline.dryRunSvs()
  if (renderPanel.svsStatus === 'failed') flash(renderPanel.svsMessage || 'SVS dryRun 失败')
}

async function runSvs() {
  await renderSvsPipeline.startSvs()
  if (renderPanel.svsStatus === 'failed') flash(renderPanel.svsMessage || 'SVS 执行失败')
}

function runWhisperPlaceholder() {
  if (!renderPanel.canRunWhisper) return
  if (!renderPanel.setWhisperRunning('Whisper 后端尚未接入')) return
  renderPanel.updateWhisperProgress(100, 'Whisper 后端尚未接入')
  renderPanel.setWhisperFailed('Whisper 后端尚未接入')
  flash('Whisper 后端尚未接入')
}

function runMsstPlaceholder() {
  if (!renderPanel.canRunMsst) return
  if (!renderPanel.setMsstRunning('MSST 后端尚未接入')) return
  renderPanel.updateMsstProgress(100, 'MSST 后端尚未接入')
  renderPanel.setMsstFailed('MSST 后端尚未接入')
  flash('MSST 后端尚未接入')
}
</script>

<template>
  <aside class="render-panel">
    <div class="panel-header">
      <button class="mode-btn" :class="{ active: renderPanel.mode === 'svc' }" @click="renderPanel.setMode('svc')">SVC</button>
      <button class="mode-btn" :class="{ active: renderPanel.mode === 'svs' }" @click="renderPanel.setMode('svs')">SVS</button>
      <button class="mode-btn" :class="{ active: renderPanel.mode === 'whisper' }" @click="renderPanel.setMode('whisper')">Whisper</button>
      <button class="mode-btn" :class="{ active: renderPanel.mode === 'msst' }" @click="renderPanel.setMode('msst')">MSST</button>
      <button class="mode-btn" :class="{ active: renderPanel.mode === 'chat' }" @click="renderPanel.setMode('chat')">Chat</button>
    </div>

    <div v-if="renderPanel.mode === 'svc'" class="panel-body">
      <div class="slot-row" @dragover="allowDrop" @drop="handleDrop('svc.condAudio', $event)">
        <div class="slot-title">cond音频</div>
        <n-tag size="small" :bordered="false">{{ slotLabel(renderPanel.svc.condAudio) }}</n-tag>
        <div class="slot-actions">
          <n-button size="tiny" :disabled="isToolLocked('svc') || renderPanel.svcStatus === 'running'" @click="pickSelected('svc.condAudio')">放入</n-button>
          <n-button size="tiny" :disabled="!renderPanel.svc.condAudio || isToolLocked('svc') || renderPanel.svcStatus === 'running'" @click="clearSlot('svc.condAudio')">清空</n-button>
        </div>
        <div v-if="renderPanel.svc.condAudio && slotReason('svc.condAudio', renderPanel.svc.condAudio)" class="slot-error">
          {{ slotReason('svc.condAudio', renderPanel.svc.condAudio) }}
        </div>
      </div>
      <div class="slot-row" @dragover="allowDrop" @drop="handleDrop('svc.sourceAudio', $event)">
        <div class="slot-title">被变声音频</div>
        <n-tag size="small" :bordered="false">{{ slotLabel(renderPanel.svc.sourceAudio) }}</n-tag>
        <div class="slot-actions">
          <n-button size="tiny" :disabled="isToolLocked('svc') || renderPanel.svcStatus === 'running'" @click="pickSelected('svc.sourceAudio')">放入</n-button>
          <n-button size="tiny" :disabled="!renderPanel.svc.sourceAudio || isToolLocked('svc') || renderPanel.svcStatus === 'running'" @click="clearSlot('svc.sourceAudio')">清空</n-button>
        </div>
        <div v-if="renderPanel.svc.sourceAudio && slotReason('svc.sourceAudio', renderPanel.svc.sourceAudio)" class="slot-error">
          {{ slotReason('svc.sourceAudio', renderPanel.svc.sourceAudio) }}
        </div>
      </div>
      <n-space vertical :size="8">
        <label class="field-label">模型</label>
        <n-select
          :value="svcConfig.config.modelName"
          :options="modelOptions"
          size="small"
          @update:value="(v: string) => svcConfig.selectPreset(v)"
        />
        <label class="field-label">输出名</label>
        <n-input v-model:value="renderPanel.svc.outputName" size="small" placeholder="SVC_output" />
        <label class="field-label">cfg</label>
        <n-input-number v-model:value="renderPanel.svc.cfg" size="small" :min="0" :max="1" :step="0.1" />
        <label class="field-label">step</label>
        <n-input-number v-model:value="renderPanel.svc.steps" size="small" :min="10" :max="200" :step="10" />
      </n-space>
      <div v-if="renderPanel.svcStatus !== 'idle'" class="run-status">
        <div class="status-line">
          <span>{{ renderPanel.svcMessage }}</span>
          <span>{{ renderPanel.svcProgress }}%</span>
        </div>
        <div class="progress-track">
          <div class="progress-bar" :style="{ width: `${renderPanel.svcProgress}%` }" />
        </div>
      </div>
      <n-button
        type="primary"
        size="small"
        :disabled="!renderPanel.canRunSvc"
        :loading="renderPanel.svcStatus === 'running'"
        block
        @click="runSvc"
      >
        合成
      </n-button>
    </div>

    <div v-else-if="renderPanel.mode === 'svs'" class="panel-body">
      <div class="slot-row" @dragover="allowDrop" @drop="handleDrop('svs.timbreAudio', $event)">
        <div class="slot-title">音色音频</div>
        <n-tag size="small" :bordered="false">{{ slotLabel(renderPanel.svs.timbreAudio) }}</n-tag>
        <div class="slot-actions">
          <n-button size="tiny" :disabled="isToolLocked('svs') || renderPanel.svsStatus === 'running'" @click="pickSelected('svs.timbreAudio')">放入</n-button>
          <n-button size="tiny" :disabled="!renderPanel.svs.timbreAudio || isToolLocked('svs') || renderPanel.svsStatus === 'running'" @click="clearSlot('svs.timbreAudio')">清空</n-button>
        </div>
        <div v-if="renderPanel.svs.timbreAudio && slotReason('svs.timbreAudio', renderPanel.svs.timbreAudio)" class="slot-error">
          {{ slotReason('svs.timbreAudio', renderPanel.svs.timbreAudio) }}
        </div>
      </div>
      <div class="slot-row" @dragover="allowDrop" @drop="handleDrop('svs.melody', $event)">
        <div class="slot-title">旋律音频</div>
        <n-tag size="small" :bordered="false">{{ slotLabel(renderPanel.svs.melody) }}</n-tag>
        <div class="slot-actions">
          <n-button size="tiny" :disabled="isToolLocked('svs') || renderPanel.svsStatus === 'running'" @click="pickSelected('svs.melody')">放入</n-button>
          <n-button size="tiny" :disabled="!renderPanel.svs.melody || isToolLocked('svs') || renderPanel.svsStatus === 'running'" @click="clearSlot('svs.melody')">清空</n-button>
        </div>
        <div v-if="renderPanel.svs.melody && slotReason('svs.melody', renderPanel.svs.melody)" class="slot-error">
          {{ slotReason('svs.melody', renderPanel.svs.melody) }}
        </div>
      </div>
      <div class="slot-row" @dragover="allowDrop" @drop="handleDrop('svs.text', $event)">
        <div class="slot-title">target text</div>
        <n-tag size="small" :bordered="false">{{ renderPanel.svs.textMode === 'ref' ? slotLabel(renderPanel.svs.textRef) : '手写' }}</n-tag>
        <div class="slot-actions">
          <n-button size="tiny" :disabled="isToolLocked('svs') || renderPanel.svsStatus === 'running'" @click="pickSelected('svs.text')">引用</n-button>
          <n-button size="tiny" :disabled="!renderPanel.svs.textRef || isToolLocked('svs') || renderPanel.svsStatus === 'running'" @click="clearSlot('svs.text')">清空</n-button>
        </div>
        <div v-if="renderPanel.svs.textMode === 'ref' && renderPanel.svs.textRef && slotReason('svs.text', renderPanel.svs.textRef)" class="slot-error">
          {{ slotReason('svs.text', renderPanel.svs.textRef) }}
        </div>
      </div>
      <n-space vertical :size="8">
        <label class="field-label">输出名</label>
        <n-input v-model:value="renderPanel.svs.outputName" size="small" placeholder="SVS_output" />
        <n-input v-model:value="renderPanel.svs.manualText" type="textarea" size="small" placeholder="假名歌词" @focus="renderPanel.svs.textMode = 'manual'" />
        <label class="field-label">cfg</label>
        <n-input-number v-model:value="renderPanel.svs.cfg" size="small" :min="0" :max="10" :step="0.1" />
        <label class="field-label">step</label>
        <n-input-number v-model:value="renderPanel.svs.steps" size="small" :min="1" :max="200" :step="1" />
      </n-space>
      <div v-if="renderPanel.svsStatus !== 'idle'" class="run-status">
        <div class="status-line">
          <span>{{ renderPanel.svsMessage }}</span>
          <span>{{ renderPanel.svsProgress }}%</span>
        </div>
        <div class="progress-track">
          <div class="progress-bar" :style="{ width: `${renderPanel.svsProgress}%` }" />
        </div>
      </div>
      <div class="run-actions">
        <n-button
          size="small"
          :disabled="!renderPanel.canRunSvs"
          :loading="renderPanel.svsStatus === 'running'"
          @click="runSvsDryRun"
        >
          dryRun
        </n-button>
        <n-button
          type="primary"
          size="small"
          :disabled="!renderPanel.canRunSvs"
          :loading="renderPanel.svsStatus === 'running'"
          @click="runSvs"
        >
          合成
        </n-button>
      </div>
    </div>

    <div v-else-if="renderPanel.mode === 'whisper'" class="panel-body">
      <div class="slot-row" @dragover="allowDrop" @drop="handleDrop('whisper.audio', $event)">
        <div class="slot-title">转写音频</div>
        <n-tag size="small" :bordered="false">{{ slotLabel(renderPanel.whisper.audio) }}</n-tag>
        <div class="slot-actions">
          <n-button size="tiny" :disabled="isToolLocked('whisper') || renderPanel.whisperStatus === 'running'" @click="pickSelected('whisper.audio')">放入</n-button>
          <n-button size="tiny" :disabled="!renderPanel.whisper.audio || isToolLocked('whisper') || renderPanel.whisperStatus === 'running'" @click="clearSlot('whisper.audio')">清空</n-button>
        </div>
        <div v-if="renderPanel.whisper.audio && slotReason('whisper.audio', renderPanel.whisper.audio)" class="slot-error">
          {{ slotReason('whisper.audio', renderPanel.whisper.audio) }}
        </div>
      </div>
      <n-space vertical :size="8">
        <label class="field-label">输出名</label>
        <n-input v-model:value="renderPanel.whisper.outputName" size="small" placeholder="Whisper_text" />
        <label class="field-label">语言</label>
        <n-input v-model:value="renderPanel.whisper.language" size="small" placeholder="auto" />
      </n-space>
      <div v-if="renderPanel.whisperStatus !== 'idle'" class="run-status">
        <div class="status-line">
          <span>{{ renderPanel.whisperMessage }}</span>
          <span>{{ renderPanel.whisperProgress }}%</span>
        </div>
        <div class="progress-track">
          <div class="progress-bar" :style="{ width: `${renderPanel.whisperProgress}%` }" />
        </div>
      </div>
      <n-button type="primary" size="small" :disabled="!renderPanel.canRunWhisper" :loading="renderPanel.whisperStatus === 'running'" block @click="runWhisperPlaceholder">
        转写
      </n-button>
    </div>

    <div v-else-if="renderPanel.mode === 'msst'" class="panel-body">
      <div class="slot-row" @dragover="allowDrop" @drop="handleDrop('msst.audio', $event)">
        <div class="slot-title">处理音频</div>
        <n-tag size="small" :bordered="false">{{ slotLabel(renderPanel.msst.audio) }}</n-tag>
        <div class="slot-actions">
          <n-button size="tiny" :disabled="isToolLocked('msst') || renderPanel.msstStatus === 'running'" @click="pickSelected('msst.audio')">放入</n-button>
          <n-button size="tiny" :disabled="!renderPanel.msst.audio || isToolLocked('msst') || renderPanel.msstStatus === 'running'" @click="clearSlot('msst.audio')">清空</n-button>
        </div>
        <div v-if="renderPanel.msst.audio && slotReason('msst.audio', renderPanel.msst.audio)" class="slot-error">
          {{ slotReason('msst.audio', renderPanel.msst.audio) }}
        </div>
      </div>
      <n-space vertical :size="8">
        <label class="field-label">输出名</label>
        <n-input v-model:value="renderPanel.msst.outputName" size="small" placeholder="MSST_output" />
        <label class="field-label">输出</label>
        <n-select v-model:value="renderPanel.msst.outputMode" :options="msstOutputOptions" size="small" />
        <n-checkbox v-model:checked="renderPanel.msst.backfillAll">输出后回填 timeline</n-checkbox>
      </n-space>
      <div v-if="renderPanel.msstStatus !== 'idle'" class="run-status">
        <div class="status-line">
          <span>{{ renderPanel.msstMessage }}</span>
          <span>{{ renderPanel.msstProgress }}%</span>
        </div>
        <div class="progress-track">
          <div class="progress-bar" :style="{ width: `${renderPanel.msstProgress}%` }" />
        </div>
      </div>
      <n-button type="primary" size="small" :disabled="!renderPanel.canRunMsst" :loading="renderPanel.msstStatus === 'running'" block @click="runMsstPlaceholder">
        分离/增强
      </n-button>
    </div>

    <div v-else class="panel-body chat-body">
      <n-input type="textarea" size="small" placeholder="和 LLM 对话" :autosize="{ minRows: 8, maxRows: 14 }" />
      <n-button size="small" block @click="flash('chatWithLLM 暂未接入')">发送</n-button>
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
  grid-template-columns: repeat(5, minmax(0, 1fr));
  border-bottom: 1px solid #21262d;
}
.mode-btn {
  height: 34px;
  border: 0;
  background: transparent;
  color: #8b949e;
  cursor: pointer;
  font-size: 11px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
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
.slot-actions {
  display: flex;
  gap: 4px;
}
.slot-error {
  grid-column: 1 / -1;
  font-size: 11px;
  color: #f0b72f;
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
.run-status {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.run-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.chat-body {
  flex: 1;
}
.status-line {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: #8b949e;
}
.status-line span:first-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.progress-track {
  height: 4px;
  border-radius: 2px;
  background: #21262d;
  overflow: hidden;
}
.progress-bar {
  height: 100%;
  background: #1f6feb;
  transition: width 160ms ease;
}
</style>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NButton, NCheckbox, NInput, NInputNumber, NSelect, NSpace, NSwitch, NTag } from 'naive-ui'
import { useRenderPanelStore } from '@/stores/renderPanel'
import { useSelectionStore } from '@/stores/selection'
import { useObjectTreeStore } from '@/stores/objectTree'
import { useObjectTreeUiStore } from '@/stores/objectTreeUi'
import { useSvcConfigStore } from '@/stores/svcConfig'
import { useSvsConfigStore } from '@/stores/svsConfig'
import { useRenderSvcPipeline } from '@/composables/useRenderSvcPipeline'
import { useRenderSvsPipeline } from '@/composables/useRenderSvsPipeline'
import { useRenderWhisperPipeline } from '@/composables/useRenderWhisperPipeline'
import { useRenderMsstPipeline } from '@/composables/useRenderMsstPipeline'
import { validateRenderSlot, type RenderInputRef, type RenderSlotId } from '@/object-workbench'

const renderPanel = useRenderPanelStore()
const selection = useSelectionStore()
const objectTree = useObjectTreeStore()
const objectTreeUi = useObjectTreeUiStore()
const svcConfig = useSvcConfigStore()
const svsConfig = useSvsConfigStore()
const renderSvcPipeline = useRenderSvcPipeline()
const renderSvsPipeline = useRenderSvsPipeline()
const renderWhisperPipeline = useRenderWhisperPipeline()
const renderMsstPipeline = useRenderMsstPipeline()
const notice = ref('')

watch(
  () => Object.keys(objectTree.index.nodes).sort().join('\0'),
  () => renderPanel.pruneMissingInputs(),
)

const selectedObjectNodeId = computed(() => {
  if (objectTreeUi.selectedIds.length === 1) return objectTreeUi.selectedIds[0]
  const selected = selection.ids[0]
  if (!selected || selection.ids.length !== 1) return null
  if (selected.startsWith('seg_')) return objectTree.legacyMaps?.trackObjectIdBySegmentId[selected] ?? `node:trackObject:${selected}`
  if (selected.startsWith('cgrp_')) return objectTree.legacyMaps?.groupObjectIdByCompGroupId[selected] ?? `node:group:${selected}`
  return selected
})

const modelOptions = computed(() => svcConfig.presets.map(p => ({ label: p.modelName, value: p.modelName })))
const svsModelOptions = computed(() => svsConfig.models.map(m => ({ label: m.name, value: m.name })))
const isV4hSelected = computed(() => svsConfig.selectedModel?.engine === 'v4h_phone_pul')
const msstModelOptions = [
  { label: '人声 / 伴奏分离', value: 'duality' },
  { label: '去混响 / 回声', value: 'dereverb' },
  { label: '降噪', value: 'denoise' },
]
const msstOutputOptions = computed(() => {
  const primary = renderPanel.msst.model === 'duality' ? '人声' : 'Dry'
  const secondary = renderPanel.msst.model === 'duality' ? '伴奏' : 'Other'
  return [
    { label: `${primary} + ${secondary}`, value: 'both' },
    { label: `仅 ${primary}`, value: 'primary' },
    { label: `仅 ${secondary}`, value: 'secondary' },
  ]
})

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

async function measureSvsPitch() {
  await renderSvsPipeline.measurePitchDifference()
}

function setPitchShiftTarget(target: 'melody' | 'reference') {
  if (renderPanel.svs.pitchShiftTarget === target) return
  renderPanel.svs.pitchShiftTarget = target
  renderPanel.svs.pitchShiftSemitones = -renderPanel.svs.pitchShiftSemitones
  if (renderPanel.svs.pitchSuggestion != null) renderPanel.svs.pitchSuggestion = -renderPanel.svs.pitchSuggestion
  if (renderPanel.svs.pitchMeasureStatus === 'done') {
    const suggestion = renderPanel.svs.pitchSuggestion ?? 0
    renderPanel.svs.pitchMeasureMessage = `建议 ${suggestion > 0 ? '+' : ''}${suggestion} 半音`
  }
}

async function runWhisper() {
  await renderWhisperPipeline.startWhisper()
  if (renderPanel.whisperStatus === 'failed') flash(renderPanel.whisperMessage || 'Whisper 执行失败')
}

async function runMsst() {
  await renderMsstPipeline.startMsst()
  if (renderPanel.msstStatus === 'failed') flash(renderPanel.msstMessage || 'MSST 执行失败')
}

onMounted(() => {
  svsConfig.fetchModels()
})
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
      <div class="slot-row" @dragover="allowDrop" @drop="handleDrop('svs.refText', $event)">
        <div class="slot-title">A 参考文本 (T1)</div>
        <n-tag size="small" :bordered="false">{{ slotLabel(renderPanel.svs.refText) }}</n-tag>
        <div class="slot-actions">
          <n-button size="tiny" :disabled="isToolLocked('svs') || renderPanel.svsStatus === 'running'" @click="pickSelected('svs.refText')">放入</n-button>
          <n-button size="tiny" :disabled="!renderPanel.svs.refText || isToolLocked('svs') || renderPanel.svsStatus === 'running'" @click="clearSlot('svs.refText')">清空</n-button>
        </div>
        <div v-if="renderPanel.svs.refText && slotReason('svs.refText', renderPanel.svs.refText)" class="slot-error">
          {{ slotReason('svs.refText', renderPanel.svs.refText) }}
        </div>
      </div>
      <div class="slot-row" @dragover="allowDrop" @drop="handleDrop('svs.targetText', $event)">
        <div class="slot-title">B 目标文本 (T1)</div>
        <n-tag size="small" :bordered="false">{{ slotLabel(renderPanel.svs.targetText) }}</n-tag>
        <div class="slot-actions">
          <n-button size="tiny" :disabled="isToolLocked('svs') || renderPanel.svsStatus === 'running'" @click="pickSelected('svs.targetText')">放入</n-button>
          <n-button size="tiny" :disabled="!renderPanel.svs.targetText || isToolLocked('svs') || renderPanel.svsStatus === 'running'" @click="clearSlot('svs.targetText')">清空</n-button>
        </div>
        <div v-if="renderPanel.svs.targetText && slotReason('svs.targetText', renderPanel.svs.targetText)" class="slot-error">
          {{ slotReason('svs.targetText', renderPanel.svs.targetText) }}
        </div>
      </div>
      <n-space vertical :size="8">
        <label class="field-label">输出名</label>
        <n-input v-model:value="renderPanel.svs.outputName" size="small" placeholder="SVS_output" />
        <label class="field-label">SVS 模型</label>
        <n-select v-model:value="svsConfig.selectedName" size="small" :options="svsModelOptions" placeholder="默认模型" clearable />
        <template v-if="isV4hSelected">
          <label class="field-label">SOFA 逸散程度</label>
          <div class="pitch-controls">
            <n-input-number v-model:value="renderPanel.svs.sofaEscapeSeconds" size="small" :min="0" :max="2" :step="0.05" :precision="2" />
            <span class="pitch-unit">秒</span>
          </div>
        </template>
        <div class="pitch-tool">
          <div class="pitch-tool-head">
            <span class="field-label">整体移调</span>
            <n-switch v-model:value="renderPanel.svs.pitchShiftEnabled" size="small" />
          </div>
          <div class="pitch-targets">
            <n-button size="tiny" :type="renderPanel.svs.pitchShiftTarget === 'melody' ? 'primary' : 'default'" @click="setPitchShiftTarget('melody')">目标旋律</n-button>
            <n-button size="tiny" :type="renderPanel.svs.pitchShiftTarget === 'reference' ? 'primary' : 'default'" @click="setPitchShiftTarget('reference')">参考音频</n-button>
          </div>
          <div class="pitch-controls">
            <n-input-number v-model:value="renderPanel.svs.pitchShiftSemitones" size="small" :min="-24" :max="24" :step="1" />
            <span class="pitch-unit">半音</span>
            <n-button size="tiny" :loading="renderPanel.svs.pitchMeasureStatus === 'running'" :disabled="renderPanel.isLocalProcessingRunning" @click="measureSvsPitch">测量</n-button>
          </div>
          <div v-if="renderPanel.svs.pitchMeasureMessage" class="pitch-message" :class="renderPanel.svs.pitchMeasureStatus">{{ renderPanel.svs.pitchMeasureMessage }}</div>
        </div>
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
        <label class="field-label">对齐语言</label>
        <n-select v-model:value="renderPanel.whisper.language" size="small" :options="[
          { label: '日本語 · SOFA JPN_Test2_Plus', value: 'ja' },
        ]" />
        <label class="field-label">
          <n-switch v-model:value="renderPanel.whisper.vad" size="small" />
          VAD 跳过静音
        </label>
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
      <n-button type="primary" size="small" :disabled="!renderPanel.canRunWhisper" :loading="renderPanel.whisperStatus === 'running'" block @click="runWhisper">
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
        <label class="field-label">模型</label>
        <n-select v-model:value="renderPanel.msst.model" :options="msstModelOptions" size="small" />
        <label class="field-label">输出</label>
        <n-select v-model:value="renderPanel.msst.outputMode" :options="msstOutputOptions" size="small" />
        <n-checkbox v-model:checked="renderPanel.msst.backfillAll">双输出时全部回填 timeline</n-checkbox>
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
      <n-button type="primary" size="small" :disabled="!renderPanel.canRunMsst" :loading="renderPanel.msstStatus === 'running'" block @click="runMsst">
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
  background: color-mix(in srgb, var(--app-panel) var(--side-opacity-percent), transparent);
  border-left: 1px solid var(--app-border);
  backdrop-filter: var(--sidebar-backdrop-filter);
  display: flex;
  flex-direction: column;
}
.panel-header {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  border-bottom: 1px solid var(--app-border);
}
.mode-btn {
  height: 34px;
  border: 0;
  background: transparent;
  color: var(--app-muted);
  cursor: pointer;
  font-size: 11px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mode-btn.active {
  color: #fff;
  background: var(--app-accent);
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
.slot-row:hover { border-color: var(--app-border); }
.slot-title {
  grid-column: 1 / -1;
  font-size: 11px;
  color: var(--app-muted);
}
.slot-actions {
  display: flex;
  gap: 4px;
}
.slot-error {
  grid-column: 1 / -1;
  font-size: 11px;
  color: var(--app-warning);
}
.field-label {
  font-size: 11px;
  color: var(--app-muted);
}
.pitch-tool {
  padding: 8px 0;
  display: grid;
  gap: 6px;
  border-top: 1px solid var(--app-border);
  border-bottom: 1px solid var(--app-border);
}
.pitch-tool-head,
.pitch-controls,
.pitch-targets {
  display: flex;
  align-items: center;
  gap: 6px;
}
.pitch-tool-head { justify-content: space-between; }
.pitch-targets > * { flex: 1; }
.pitch-controls :deep(.n-input-number) { min-width: 0; flex: 1; }
.pitch-unit { flex: 0 0 auto; color: var(--app-muted); font-size: 10px; }
.pitch-message {
  overflow: hidden;
  color: var(--app-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pitch-message.done { color: #3fb950; }
.pitch-message.failed { color: #f85149; }
.notice {
  min-height: 18px;
  padding: 0 10px 10px;
  font-size: 11px;
  color: var(--app-warning);
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
  color: var(--app-muted);
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
  background: var(--app-border);
  overflow: hidden;
}
.progress-bar {
  height: 100%;
  background: var(--app-accent);
  transition: width 160ms ease;
}
</style>

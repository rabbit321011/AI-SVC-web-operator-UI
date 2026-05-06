<script setup lang="ts">
import { useProjectStore } from '@/stores/project'
import { useSvcConfigStore } from '@/stores/svcConfig'
import { useTracksStore } from '@/stores/tracks'
import { useSelectionStore } from '@/stores/selection'
import { NButton, NDropdown, NSelect, NInputNumber, NSwitch, NSpace } from 'naive-ui'
import type { SvcRuntimeConfig } from '@/types'
import { usePlaybackStore } from '@/stores/playback'
import { ref } from 'vue'

const project = useProjectStore()
const svcConfig = useSvcConfigStore()
const tracks = useTracksStore()
const selection = useSelectionStore()
const pb = usePlaybackStore()

const playSelectedOnly = ref(false)

function handlePlay() {
  ;(window as any).__playbackSetSelected?.(playSelectedOnly.value)
  ;(window as any).__playbackPlay?.()
}

function handlePause() { ;(window as any).__playbackPause?.() }
function handleStop() { ;(window as any).__playbackStop?.() }

const fileOptions = [
  { label: '导入 WAV', key: 'import-wav' },
  { label: '导入项目', key: 'import-proj' },
  { type: 'divider' as const, key: 'd1' },
  { label: '新建空音轨', key: 'new-track' },
  { type: 'divider' as const, key: 'd1b' },
  { label: '导出选中', key: 'export-sel' },
  { label: '导出所有', key: 'export-all' },
  { type: 'divider' as const, key: 'd2' },
  { label: '保存项目', key: 'save' },
  { label: '另存为 (.asvcproj)', key: 'save-as' },
  { type: 'divider' as const, key: 'd3' },
  { label: '回到首页', key: 'go-home' },
]

const modelOptions = svcConfig.presets.map(p => ({
  label: p.modelName,
  value: p.modelName,
}))

const stepOptions = [
  { label: '10', value: 10 },
  { label: '30', value: 30 },
  { label: '50', value: 50 },
  { label: '100', value: 100 },
  { label: '150', value: 150 },
  { label: '200', value: 200 },
]

function handleFileSelect(key: string) {
  if (key === 'import-wav') importWavFiles()
  if (key === 'import-proj') loadProjectFile()
  if (key === 'new-track') addEmptyTrack()
  if (key === 'export-sel') exportSelected()
  if (key === 'export-all') exportAll()
  if (key === 'save') saveProject()
  if (key === 'save-as') exportProject()
  if (key === 'go-home') goHome()
}

function importWavFiles() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.wav,.flac,.mp3,.ogg,.m4a'
  input.multiple = true
  input.onchange = async () => {
    if (!input.files) return
    const files = Array.from(input.files)
    for (const file of files) {
      if (file.size > 500 * 1024 * 1024) {
        alert(`文件 "${file.name}" 超过 500MB，可能导致性能问题`)
        continue
      }
      const blob = new Blob([await file.arrayBuffer()], { type: file.type || 'audio/wav' })
      // Decode with AudioContext for accurate metadata (works for PCM/float/FLAC/MP3/OGG)
      const audioCtx = new AudioContext()
      const audioBuf = await audioCtx.decodeAudioData(await blob.arrayBuffer())
      const duration = audioBuf.duration
      const sampleRate = audioBuf.sampleRate
      const totalSamples = Math.round(duration * sampleRate)
      audioCtx.close()

      const trackId = tracks.addTrack(file.name, sampleRate, totalSamples, file.name, blob)
      const seg = tracks.getTrackSegments(trackId)[0]
      if (seg) {
        seg.timelineEnd = duration
        seg.srcEndSample = totalSamples
      }

      // Use reconcileF0 (handles pending tracking + progress bar)
      tracks.reconcileF0ForTrack(trackId)
    }
    ;(window as any).__syncProject?.()
  }
  input.click()
}

function addEmptyTrack() {
  const id = tracks.makeTrackId()
  const num = tracks.trackOrder.length + 1
  tracks.tracks[id] = {
    id,
    name: `空音轨 ${num}`,
    color: tracks.nextColor(),
    segments: [],
    sourceFile: '',
    sampleRate: 44100,
    totalSamples: 0,
    f0Cache: null,
      f0Pending: 0,
      f0Total: 0,
    collapsed: false, muted: false, solo: false, volume: 1, ignored: false,
    boundCompGroupId: null,
  }
  tracks.trackOrder.push(id)
}

async function saveProject() {
  ;(window as any).__saveProject?.()
}

async function exportProject() {
  ;(window as any).__exportProject?.()
}

async function loadProjectFile() {
  ;(window as any).__loadProject?.()
}

function goHome() {
  ;(window as any).__goHome?.()
}

async function buildProjectPayload(): Promise<any> {
  const base64BySource: Record<string, string> = {}
  for (const [sourceFile, blob] of tracks.sourceBlobs) {
    if (blob.size < 50 * 1024 * 1024) {
      base64BySource[sourceFile] = await blobToBase64(blob)
    }
  }
  return { ...project.toJSON(), _sourceBlobsBase64: base64BySource }
}

async function restoreProject(data: any) {
  const { _sourceBlobsBase64, ...projectData } = data
  project.load(projectData)
  if (_sourceBlobsBase64) {
    for (const [k, b64] of Object.entries(_sourceBlobsBase64) as [string, string][]) {
      try {
        const bin = atob(b64)
        const arr = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
        tracks.sourceBlobs.set(k, new Blob([arr], { type: 'audio/wav' }))
      } catch {}
    }
  }
  ;(window as any).__projectOnChange?.()
}

function exportSelected() {
  const segs = tracks.getAllSegments().filter(s => selection.isSelected(s.id))
  exportSegments(segs.length ? segs : [])
}
function exportAll() { exportSegments(tracks.getAllSegments().filter(s => !s.ignored)) }

async function exportSegments(segs: import('@/types').AudioSegment[]) {
  if (segs.length === 0) { alert('没有可导出的片段'); return }
  const segInputs = segs.map(seg => {
    const track = tracks.tracks[seg.trackId]
    const sr = track?.sampleRate || 44100
    return {
      blob: (tracks.sourceBlobs.get(seg.sourceFile) || tracks.sourceBlobs.get(seg.trackId))!,
      startSample: seg.srcStartSample,
      endSample: seg.srcEndSample,
      timelineStart: seg.timelineStart,
      sampleRate: sr,
      volume: track?.volume ?? 1,
    }
  })
  const valid = segInputs.filter(s => s.blob)
  if (valid.length === 0) { alert('片段无音频数据'); return }
  const allStarts = valid.map(s => s.timelineStart)
  const allEnds = valid.map(s => s.timelineStart + (s.endSample - s.startSample) / s.sampleRate)
  const outSr = valid[0]?.sampleRate || 44100
  const minStart = Math.min(...allStarts)
  const totalDuration = Math.max(...allEnds) - minStart
  try {
    const { combineSegmentsToBlob } = await import('@/api/wav')
    const blob = await combineSegmentsToBlob(valid, totalDuration, outSr, minStart)
    downloadBlob('export.wav', blob)
  } catch (e: any) {
    alert('导出失败: ' + e.message)
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise(resolve => {
    const r = new FileReader()
    r.onload = () => resolve((r.result as string).split(',')[1])
    r.readAsDataURL(blob)
  })
}

function downloadJson(filename: string, data: any) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  downloadBlob(filename, blob)
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function handleSvc() {
  const compGroupIds = [...selection.ids].filter(id => id.startsWith('cgrp_'))
  if (compGroupIds.length === 0) return
  ;(window as any).__svcStart?.(compGroupIds[0])
}
</script>

<template>
  <div class="topbar">
    <div class="topbar-left">
      <span class="logo">🎵 AISVC</span>

      <n-space :size="4">
        <n-button size="tiny" @click="handlePlay" :disabled="pb.isPlaying">▶</n-button>
        <n-button size="tiny" @click="handlePause" :disabled="!pb.isPlaying">⏸</n-button>
        <n-button size="tiny" @click="handleStop">⏹</n-button>
        <n-switch
          :value="playSelectedOnly"
          size="small"
          @update:value="(v: boolean) => playSelectedOnly = v"
        />
        <span class="param-label" style="font-size:11px">播放选中</span>
      </n-space>

      <n-dropdown trigger="hover" :options="fileOptions" @select="handleFileSelect">
        <n-button text class="menu-btn">文件</n-button>
      </n-dropdown>
    </div>

    <div class="topbar-center">
      <n-space align="center" :size="12">
        <n-select
          :value="svcConfig.config.modelName"
          :options="modelOptions"
          size="small"
          style="width: 160px"
          @update:value="(v: string) => svcConfig.selectPreset(v)"
        />
        <n-input-number
          :value="svcConfig.config.diffusionSteps"
          :min="10" :max="200" :step="10"
          size="small"
          style="width: 80px"
          @update:value="(v: number|null) => v && svcConfig.updateField('diffusionSteps', v)"
        />
        <span class="param-label">cfg</span>
        <n-input-number
          :value="svcConfig.config.inferenceCfgRate"
          :min="0" :max="1.0" :step="0.1"
          size="small"
          style="width: 80px"
          @update:value="(v: number|null) => v !== null && svcConfig.updateField('inferenceCfgRate', v)"
        />
        <span class="param-label">F0</span>
        <n-switch
          :value="svcConfig.config.f0Condition"
          size="small"
          @update:value="(v: boolean) => svcConfig.updateField('f0Condition', v)"
        />
        <n-button type="primary" size="small" @click="handleSvc">🎤 合成</n-button>
      </n-space>
    </div>

    <div class="topbar-right">
      <span class="project-name">{{ project.name || '未命名项目' }}</span>
    </div>
  </div>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  padding: 6px 16px;
  background: #161b22;
  border-bottom: 1px solid #21262d;
  gap: 16px;
  flex-shrink: 0;
  min-height: 40px;
}
.topbar-left { display: flex; align-items: center; gap: 8px; }
.topbar-center { flex: 1; display: flex; justify-content: center; }
.topbar-right { display: flex; align-items: center; }
.logo { font-size: 15px; font-weight: 700; color: #58a6ff; margin-right: 8px; }
.menu-btn { font-size: 13px; }
.param-label { font-size: 11px; color: #8b949e; }
.project-name { font-size: 12px; color: #6e7681; }
</style>


<script setup lang="ts">
import { useProjectStore } from '@/stores/project'
import { useTracksStore } from '@/stores/tracks'
import { useSelectionStore } from '@/stores/selection'
import { NButton, NDropdown, NSwitch, NSpace } from 'naive-ui'
import { usePlaybackStore } from '@/stores/playback'
import { ref } from 'vue'
import { useEditorWorkspaceStore } from '@/stores/editorWorkspace'
import { useSaveStatusStore } from '@/stores/saveStatus'
import { getAudioBlobMeta } from '@/utils/audioMeta'

const project = useProjectStore()
const tracks = useTracksStore()
const selection = useSelectionStore()
const pb = usePlaybackStore()
const editorWorkspace = useEditorWorkspaceStore()
const saveStatus = useSaveStatusStore()

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
    trackType: 'audio',
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
  const segInputs = await Promise.all(segs.map(async seg => {
    const track = tracks.tracks[seg.trackId]
    const blob = tracks.sourceBlobs.get(seg.sourceFile) || tracks.sourceBlobs.get(seg.trackId)
    let sr = track?.sampleRate || 44100
    if (blob) {
      try { sr = (await getAudioBlobMeta(blob)).sampleRate || sr } catch {}
    }
    return {
      blob: blob!,
      startSample: seg.srcStartSample,
      endSample: seg.srcEndSample,
      timelineStart: seg.timelineStart,
      sampleRate: sr,
      volume: track?.volume ?? 1,
    }
  }))
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

</script>

<template>
  <div class="topbar">
    <div class="topbar-left">
      <span class="logo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Zm0 2.3L6 8.7v6.6l6 3.4 6-3.4V8.7l-6-3.4Zm0 3.2a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z" /></svg>AISVC</span>

      <n-space :size="4">
        <n-button size="tiny" class="icon-button" @click="handlePlay" :disabled="pb.isPlaying" title="播放"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.8 12.5 8 4 13.2V2.8Z" /></svg></n-button>
        <n-button size="tiny" class="icon-button" @click="handlePause" :disabled="!pb.isPlaying" title="暂停"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3h3v10H4V3Zm5 0h3v10H9V3Z" /></svg></n-button>
        <n-button size="tiny" class="icon-button" @click="handleStop" title="停止"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4h8v8H4V4Z" /></svg></n-button>
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
      <span class="project-name center-name">{{ project.name || '未命名项目' }}</span>
    </div>

    <div class="topbar-right">
      <div v-if="saveStatus.state !== 'idle'" class="save-status" :class="saveStatus.state" :title="saveStatus.message">
        <svg v-if="saveStatus.state === 'saving'" class="save-spinner" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2a6 6 0 1 0 6 6h-2a4 4 0 1 1-4-4V2Z" /></svg>
        <svg v-else-if="saveStatus.state === 'success'" viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7 1 1-8 8-4-4 1-1Z" /></svg>
        <svg v-else viewBox="0 0 16 16" aria-hidden="true"><path d="M7.25 3h1.5v6h-1.5V3Zm0 8h1.5v2h-1.5v-2Z" /></svg>
        <span class="save-message">{{ saveStatus.message }}</span>
        <span v-if="saveStatus.state === 'saving' && saveStatus.total > 0" class="save-percent">{{ saveStatus.percent }}%</span>
        <span v-if="saveStatus.state === 'saving' && saveStatus.total > 0" class="save-progress"><i :style="{ width: `${saveStatus.percent}%` }" /></span>
      </div>
      <n-space :size="6">
        <n-button size="tiny" class="icon-button" title="键位教学" @click="editorWorkspace.openKeymapTab"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12v8H2V4Zm1.5 1.5v5h9v-5h-9ZM4 7h1v1H4V7Zm2 0h1v1H6V7Zm2 0h1v1H8V7Zm2 0h1v1h-1V7ZM5 9h6v1H5V9Z" /></svg></n-button>
        <n-button size="tiny" class="icon-button" title="设置" @click="editorWorkspace.openSettingsTab"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7.2 1.8h1.6l.35 1.55c.35.12.68.25.98.43l1.34-.85 1.13 1.13-.85 1.34c.18.3.31.63.43.98l1.55.35v1.6l-1.55.35c-.12.35-.25.68-.43.98l.85 1.34-1.13 1.13-1.34-.85c-.3.18-.63.31-.98.43l-.35 1.55H7.2l-.35-1.55a4.8 4.8 0 0 1-.98-.43l-1.34.85L3.4 10.97l.85-1.34a4.8 4.8 0 0 1-.43-.98L2.27 8.3V6.7l1.55-.35c.12-.35.25-.68.43-.98L3.4 4.03 4.53 2.9l1.34.85c.3-.18.63-.31.98-.43L7.2 1.8ZM8 5.4a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2Z" /></svg></n-button>
      </n-space>
    </div>
  </div>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  padding: 6px 16px;
  background: color-mix(in srgb, var(--app-panel) var(--topbar-opacity-percent), transparent);
  border-bottom: 1px solid var(--app-border);
  gap: 16px;
  flex-shrink: 0;
  min-height: 40px;
}
.topbar-left { display: flex; align-items: center; gap: 8px; }
.topbar-center { flex: 1; display: flex; justify-content: center; min-width: 0; }
.topbar-right { display: flex; align-items: center; }
.save-status {
  min-width: 142px;
  max-width: 300px;
  height: 26px;
  margin-right: 10px;
  display: grid;
  grid-template-columns: 14px minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  color: var(--app-muted);
  font-size: 11px;
}
.save-status svg { width: 14px; height: 14px; fill: currentColor; }
.save-status.success { color: #3fb950; }
.save-status.error { color: #f85149; }
.save-message { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.save-percent { min-width: 30px; text-align: right; }
.save-progress {
  grid-column: 2 / 4;
  height: 2px;
  overflow: hidden;
  background: var(--app-border);
}
.save-progress i { display: block; height: 100%; background: var(--app-accent); transition: width 0.15s ease; }
.save-spinner { animation: save-spin 0.8s linear infinite; }
@keyframes save-spin { to { transform: rotate(360deg); } }
.logo { font-size: 15px; font-weight: 700; color: var(--app-accent); margin-right: 8px; display: inline-flex; align-items: center; gap: 6px; }
.logo svg { width: 18px; height: 18px; fill: currentColor; }
.menu-btn { font-size: 13px; }
.param-label { font-size: 11px; color: var(--app-muted); }
.project-name { font-size: 12px; color: var(--app-muted); }
.center-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.icon-button svg { width: 14px; height: 14px; fill: currentColor; }
</style>


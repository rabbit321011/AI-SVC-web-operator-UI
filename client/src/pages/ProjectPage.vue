<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useKeyboard } from '@/composables/useKeyboard'
import { usePlayback } from '@/composables/usePlayback'
import { useSvcPipeline } from '@/composables/useSvcPipeline'
import { useTracksStore } from '@/stores/tracks'
import { useProjectStore } from '@/stores/project'
import { usePlaybackStore } from '@/stores/playback'
import TopBar from '@/components/layout/TopBar.vue'
import LeftSidebar from '@/components/layout/LeftSidebar.vue'
import MainCanvas from '@/components/layout/MainCanvas.vue'
import StatusBar from '@/components/layout/StatusBar.vue'

const route = useRoute()
const router = useRouter()

useKeyboard()

const playback = usePlayback()
const svcPipeline = useSvcPipeline()
const project = useProjectStore()
const tracks = useTracksStore()
const pb = usePlaybackStore()

function syncProject() {
  let maxEnd = 0
  for (const s of tracks.getAllSegments()) { if (s.timelineEnd > maxEnd) maxEnd = s.timelineEnd }
  pb.setTotalDuration(maxEnd || 10)
  project.bumpLoad()
  // Reconcile F0 for tracks with missing data (background)
  for (const tid of tracks.trackOrder) {
    tracks.reconcileF0ForTrack(tid)
  }
}

;(window as any).__playbackPlay = () => playback.play()
;(window as any).__playbackPause = () => playback.pause()
;(window as any).__playbackStop = () => playback.stop()
;(window as any).__playbackSetSelected = (v: boolean) => playback.setPlaySelected(v)
;(window as any).__playbackSeek = (t: number) => playback.seekTo(t)
;(window as any).__svcStart = (gid: string) => svcPipeline.startSvc(gid)
;(window as any).__syncProject = syncProject

// ── P10: Save to internal server directory (Ctrl+S) ──
;(window as any).__saveProject = async () => {
  const base64BySource: Record<string, string> = {}
  for (const [sf, blob] of tracks.sourceBlobs) {
    base64BySource[sf] = await new Promise<string>(resolve => {
      const r = new FileReader()
      r.onload = () => resolve((r.result as string).split(',')[1])
      r.readAsDataURL(blob)
    })
  }
  const data = { ...project.toJSON(), _sourceBlobsBase64: base64BySource }
  try {
    const resp = await fetch(`/api/projects/${encodeURIComponent(project.name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!resp.ok) throw new Error('save failed')
    console.log('[save] saved to server')
  } catch (e: any) {
    alert('保存失败: ' + e.message)
  }
}

// ── P10: Export as downloadable .asvcproj (另存为) ──
;(window as any).__exportProject = async () => {
  const base64BySource: Record<string, string> = {}
  for (const [sf, blob] of tracks.sourceBlobs) {
    base64BySource[sf] = await new Promise<string>(resolve => {
      const r = new FileReader()
      r.onload = () => resolve((r.result as string).split(',')[1])
      r.readAsDataURL(blob)
    })
  }
  const data = { ...project.toJSON(), _sourceBlobsBase64: base64BySource }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${project.name || 'project'}.asvcproj`
  a.click()
}

// ── P10: Load from external file into current project ──
;(window as any).__loadProject = () => {
  const input = document.createElement('input')
  input.type = 'file'; input.accept = '.asvcproj,application/json'
  input.onchange = async () => {
    const f = input.files?.[0]; if (!f) return
    const { _sourceBlobsBase64, ...data } = JSON.parse(await f.text())
    project.load(data)
    if (_sourceBlobsBase64) {
      for (const [k, b64] of Object.entries(_sourceBlobsBase64) as [string, string][]) {
        const bin = atob(b64); const arr = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
        tracks.sourceBlobs.set(k, new Blob([arr], { type: 'audio/wav' }))
      }
    }
    syncProject()
  }
  input.click()
}

// ── P10: Navigate back to home ──
;(window as any).__goHome = () => router.push('/')

onMounted(async () => {
  const projectName = route.params.name as string
  if (!projectName) { router.push('/'); return }

  try {
    const resp = await fetch(`/api/projects/${encodeURIComponent(projectName)}`)
    if (!resp.ok) throw new Error('not found')
    const data = await resp.json()
    const { _sourceBlobsBase64, ...projectData } = data
    project.load(projectData)
    if (_sourceBlobsBase64) {
      for (const [k, b64] of Object.entries(_sourceBlobsBase64) as [string, string][]) {
        const bin = atob(b64); const arr = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
        tracks.sourceBlobs.set(k, new Blob([arr], { type: 'audio/wav' }))
      }
    }
    syncProject()
  } catch {
    alert(`项目 "${projectName}" 未找到`)
    router.push('/')
  }
})
</script>

<template>
  <div class="app-root">
    <TopBar />
    <div class="body">
      <LeftSidebar />
      <MainCanvas />
    </div>
    <StatusBar />
  </div>
</template>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  background: #0d1117;
  color: #c9d1d9;
  overflow: hidden;
}

.app-root {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.body {
  display: flex;
  flex: 1;
  overflow: hidden;
}
</style>

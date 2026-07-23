<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useKeyboard } from '@/composables/useKeyboard'
import { usePlayback } from '@/composables/usePlayback'
import { useSvcPipeline } from '@/composables/useSvcPipeline'
import { useTracksStore } from '@/stores/tracks'
import { useProjectStore } from '@/stores/project'
import { usePlaybackStore } from '@/stores/playback'
import { useUiSettingsStore } from '@/stores/uiSettings'
import { useObjectTreeStore } from '@/stores/objectTree'
import { getAudioBlobMeta } from '@/utils/audioMeta'
import type { AudioSegment } from '@/types'
import TopBar from '@/components/layout/TopBar.vue'
import LeftSidebar from '@/components/layout/LeftSidebar.vue'
import EditorWorkspace from '@/components/layout/EditorWorkspace.vue'
import RenderPanel from '@/components/layout/RenderPanel.vue'
import StatusBar from '@/components/layout/StatusBar.vue'

const route = useRoute()
const router = useRouter()

useKeyboard()

const playback = usePlayback()
const svcPipeline = useSvcPipeline()
const project = useProjectStore()
const tracks = useTracksStore()
const pb = usePlaybackStore()
const uiSettings = useUiSettingsStore()
const objectTree = useObjectTreeStore()

async function syncProject() {
  await normalizeSegmentTimingFromSamples()
  let maxEnd = 0
  for (const s of tracks.getAllSegments()) { if (s.timelineEnd > maxEnd) maxEnd = s.timelineEnd }
  pb.setTotalDuration(maxEnd || 10)
  project.bumpLoad()
  // Reconcile F0 for tracks with missing data (background)
  for (const tid of tracks.trackOrder) {
    tracks.reconcileF0ForTrack(tid)
  }
}

async function normalizeSegmentTimingFromSamples() {
  const changedSegments: AudioSegment[] = []
  for (const trackId of tracks.trackOrder) {
    const segs = tracks.getTrackSegments(trackId).sort((a, b) => a.timelineStart - b.timelineStart)
    let previous: AudioSegment | null = null
    for (const seg of segs) {
      const blob = tracks.sourceBlobs.get(seg.sourceFile) ?? tracks.sourceBlobs.get(seg.trackId)
      if (!blob || seg.srcEndSample <= seg.srcStartSample) {
        previous = seg
        continue
      }

      let sourceSampleRate = tracks.tracks[seg.trackId]?.sampleRate || 44100
      try {
        sourceSampleRate = (await getAudioBlobMeta(blob)).sampleRate || sourceSampleRate
      } catch {}

      const sourceDuration = (seg.srcEndSample - seg.srcStartSample) / sourceSampleRate
      let nextStart = seg.timelineStart
      if (previous && previous.sourceFile === seg.sourceFile && previous.srcEndSample === seg.srcStartSample) {
        nextStart = previous.timelineEnd
      }
      const nextEnd = nextStart + sourceDuration

      if (Math.abs(seg.timelineStart - nextStart) > 0.001 || Math.abs(seg.timelineEnd - nextEnd) > 0.001) {
        seg.timelineStart = nextStart
        seg.timelineEnd = nextEnd
        seg.f0Data = null
        seg.f0Extracted = false
        changedSegments.push(seg)
      }
      previous = seg
    }
  }
  if (changedSegments.length > 0) objectTree.syncMovedSegments(changedSegments)
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
  try {
    for (const [sourceFile, blob] of tracks.sourceBlobs) {
      const blobResp = await fetch(`/api/projects/${encodeURIComponent(project.name)}/blobs`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-blob-key': encodeURIComponent(sourceFile),
        },
        body: blob,
      })
      if (!blobResp.ok) {
        const err = await blobResp.json().catch(() => null)
        throw new Error(err?.error || `blob save failed: ${sourceFile}`)
      }
    }

    const resp = await fetch(`/api/projects/${encodeURIComponent(project.name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project.toJSON()),
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
    await syncProject()
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
    await syncProject()
  } catch {
    alert(`项目 "${projectName}" 未找到`)
    router.push('/')
  }
})
</script>

<template>
  <div
    class="app-root"
    :class="[
      uiSettings.rootClass,
      {
        'sidebar-glass': uiSettings.settings.sidebarGlassEnabled,
        'center-glass': uiSettings.settings.centerGlassEnabled,
      },
    ]"
    :style="uiSettings.cssVars"
  >
    <TopBar />
    <div class="body">
      <LeftSidebar />
      <EditorWorkspace />
      <RenderPanel />
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
  --app-surface: #0d1117;
  --app-panel: #161b22;
  --app-border: #21262d;
  --app-text: #c9d1d9;
  --app-muted: #8b949e;
  --app-accent: #58a6ff;
  --app-hover: #21262d;
  --app-selected: #1f3a5f;
  --app-located: #3a2f14;
  --app-warning: #f0b72f;
  --center-backdrop-filter: none;
  --sidebar-backdrop-filter: none;
  background-color: var(--app-surface);
  background-image: var(--workbench-bg-image);
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  color: var(--app-text);
  position: relative;
}

.app-root.theme-light {
  --app-surface: #f4f6f8;
  --app-panel: #ffffff;
  --app-border: #d7dde4;
  --app-text: #1f2328;
  --app-muted: #59636e;
  --app-accent: #0969da;
  --app-hover: #e7edf3;
  --app-selected: #d8ebff;
  --app-located: #fff1bd;
  --app-warning: #9a6700;
}

.app-root.theme-cream {
  --app-surface: #f6edcf;
  --app-panel: #fff8dc;
  --app-border: #d7c58f;
  --app-text: #2f2517;
  --app-muted: #75613c;
  --app-accent: #8a5a12;
  --app-hover: #efe1b8;
  --app-selected: #ead49a;
  --app-located: #f1d68a;
  --app-warning: #8a5a12;
}

.app-root.sidebar-glass {
  --sidebar-backdrop-filter: blur(14px) saturate(1.15);
}

.app-root.center-glass {
  --center-backdrop-filter: blur(14px) saturate(1.15);
}

.body {
  display: flex;
  flex: 1;
  overflow: hidden;
}
</style>

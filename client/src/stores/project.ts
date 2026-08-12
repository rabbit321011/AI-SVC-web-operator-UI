import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Project, ProjectId, F0Frame } from '@/types'

const DEFAULT_F0 = { fmin: 65.4, fmax: 2093.0, algorithm: 'pyin' as const, hopMs: 16 }

export function assertValidProject(value: unknown): asserts value is Project {
  if (!value || typeof value !== 'object') throw new Error('项目文件不是对象')
  const project = value as Record<string, any>
  for (const key of ['id', 'name', 'version', 'createdAt', 'modifiedAt']) {
    if (typeof project[key] !== 'string') throw new Error(`项目字段 ${key} 无效`)
  }
  for (const key of ['tracks', 'segments', 'compGroups']) {
    if (!project[key] || typeof project[key] !== 'object' || Array.isArray(project[key])) {
      throw new Error(`项目字段 ${key} 无效`)
    }
  }
  for (const key of ['trackOrder', 'compGroupOrder']) {
    if (!Array.isArray(project[key]) || project[key].some((item: unknown) => typeof item !== 'string')) {
      throw new Error(`项目字段 ${key} 无效`)
    }
  }
  if (!Number.isFinite(project.timelineOffset) || !Number.isFinite(project.pxPerSec) || project.pxPerSec <= 0) {
    throw new Error('项目时间线参数无效')
  }
  if (!project.f0Settings || typeof project.f0Settings !== 'object'
    || !Number.isFinite(project.f0Settings.fmin) || !Number.isFinite(project.f0Settings.fmax)
    || !Number.isFinite(project.f0Settings.hopMs)) {
    throw new Error('项目 F0 设置无效')
  }
  if (project.objectTree !== undefined) {
    if (project.objectTree?.schemaVersion !== 'object-workbench.v1'
      || project.objectTree?.root?.kind !== 'folder'
      || !Array.isArray(project.objectTree.root.children)
      || !project.objectTree.assets
      || typeof project.objectTree.assets !== 'object') {
      throw new Error('项目对象树结构无效')
    }
  }
}

export const useProjectStore = defineStore('project', () => {
  const id = ref<ProjectId>('')
  const name = ref('未命名项目')
  const version = ref('1.0.0')
  const timelineOffset = ref(0)
  const pxPerSec = ref(60)
  const f0Settings = ref<Project['f0Settings']>({ ...DEFAULT_F0 })
  const createdAt = ref('')
  const modifiedAt = ref('')
  const redrawTick = ref(0)
  const loadTick = ref(0)

  function bumpRedraw() { redrawTick.value++ }
  function bumpLoad() { loadTick.value++; bumpRedraw() }

  function create(projectName: string) {
    const now = new Date().toISOString()
    id.value = crypto.randomUUID()
    name.value = projectName
    version.value = '1.0.0'
    createdAt.value = now
    modifiedAt.value = now
    useObjectTreeStore().createEmpty()
  }

  function toJSON(): Project {
    const tracksStore = useTracksStore()
    const compGroupsStore = useCompGroupsStore()
    const objectTreeStore = useObjectTreeStore()
    return {
      id: id.value,
      name: name.value,
      version: version.value,
      objectTree: objectTreeStore.tree,
      tracks: { ...tracksStore.tracks },
      trackOrder: [...tracksStore.trackOrder],
      segments: { ...tracksStore.segmentsMap },
      compGroups: { ...compGroupsStore.compGroups },
      compGroupOrder: [...compGroupsStore.compGroupOrder],
      timelineOffset: timelineOffset.value,
      pxPerSec: pxPerSec.value,
      f0Settings: { ...f0Settings.value },
      createdAt: createdAt.value,
      modifiedAt: new Date().toISOString(),
    }
  }

  function load(project: Project) {
    assertValidProject(project)
    if (typeof window !== 'undefined') (window as any).__playbackStop?.()
    usePlaybackStore().reset()
    useEditorWorkspaceStore().resetToProjectTimeline()
    useHistoryStore().clear()
    useSelectionStore().clear()
    useObjectTreeUiStore().clearSelection()
    useRenderPanelStore().resetForProject()
    id.value = project.id
    name.value = project.name
    version.value = project.version
    timelineOffset.value = project.timelineOffset
    pxPerSec.value = project.pxPerSec
    f0Settings.value = { ...project.f0Settings }
    createdAt.value = project.createdAt
    modifiedAt.value = project.modifiedAt

    const tracksStore = useTracksStore()
    const compGroupsStore = useCompGroupsStore()
    const objectTreeStore = useObjectTreeStore()

    // Clear everything
    tracksStore.trackOrder.splice(0, tracksStore.trackOrder.length)
    compGroupsStore.compGroupOrder.splice(0, compGroupsStore.compGroupOrder.length)
    for (const k of Object.keys(tracksStore.tracks)) delete tracksStore.tracks[k]
    for (const k of Object.keys(tracksStore.segmentsMap)) delete tracksStore.segmentsMap[k]
    for (const k of Object.keys(compGroupsStore.compGroups)) delete compGroupsStore.compGroups[k]
    tracksStore.sourceBlobs.clear()

    // Restore tracks one by one (triggers reactivity properly)
    for (const [tid, t] of Object.entries(project.tracks)) {
      tracksStore.tracks[tid] = t as any
    }
    tracksStore.trackOrder.push(...project.trackOrder)

    // Restore segments one by one
    if (project.segments) {
      for (const [sid, seg] of Object.entries(project.segments)) {
        tracksStore.segmentsMap[sid] = seg as any
      }
    }

    // Restore comp groups
    for (const [gid, g] of Object.entries(project.compGroups)) {
      compGroupsStore.compGroups[gid] = g as any
    }
    compGroupsStore.compGroupOrder.push(...project.compGroupOrder)
    if (project.objectTree) {
      objectTreeStore.loadObjectTree(project.objectTree)
    } else {
      objectTreeStore.loadFromLegacyProject(project)
    }

    console.log('[load] tracks:', Object.keys(tracksStore.tracks).length,
      'segments:', Object.keys(tracksStore.segmentsMap).length,
      'order:', tracksStore.trackOrder.length)
    const firstSeg = Object.values(tracksStore.segmentsMap)[0] as any
    if (firstSeg) console.log('[load] first segment timelineEnd:', firstSeg.timelineEnd, 'srcEndSample:', firstSeg.srcEndSample)

    bumpLoad()
  }

  const formattedTime = computed(() => {
    const d = new Date(createdAt.value)
    return d.toLocaleString('zh-CN')
  })

  return { id, name, version, timelineOffset, pxPerSec, f0Settings, createdAt, modifiedAt, redrawTick, loadTick, create, toJSON, load, formattedTime, bumpRedraw, bumpLoad }
})

// circular import resolved by lazy access
import { useTracksStore } from './tracks'
import { useCompGroupsStore } from './compGroups'
import { useObjectTreeStore } from './objectTree'
import { useEditorWorkspaceStore } from './editorWorkspace'
import { useHistoryStore } from './history'
import { useSelectionStore } from './selection'
import { useObjectTreeUiStore } from './objectTreeUi'
import { usePlaybackStore } from './playback'
import { useRenderPanelStore } from './renderPanel'

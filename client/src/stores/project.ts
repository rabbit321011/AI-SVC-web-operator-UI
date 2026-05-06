import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Project, ProjectId, F0Frame } from '@/types'

const DEFAULT_F0 = { fmin: 65.4, fmax: 2093.0, algorithm: 'pyin' as const, hopMs: 16 }

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
  }

  function toJSON(): Project {
    const tracksStore = useTracksStore()
    const compGroupsStore = useCompGroupsStore()
    return {
      id: id.value,
      name: name.value,
      version: version.value,
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

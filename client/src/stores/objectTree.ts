import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { AudioSegment, Project } from '@/types'
import type { AudioObjectNode, FolderNode, LegacyObjectTreeMaps, NodeId, ProjectObjectTree, TrackFolderNode, TrackObjectNode, TreeNode } from '@/object-workbench'
import {
  buildNodeIndex,
  canDragIntoTimeline,
  canCreateFolderIn,
  canDeleteTreeNode,
  canImportFilesInto,
  canTransferTreeNode,
  createEmptyProjectObjectTree,
  getNode,
  getParent,
  insertChild,
  isDescendantOf,
  legacyProjectToObjectTree,
  removeNode,
  replaceNode,
  TOP_LEVEL_IDS,
} from '@/object-workbench'
import { useTracksStore } from './tracks'

export const useObjectTreeStore = defineStore('objectTree', () => {
  const tree = ref<ProjectObjectTree>(createEmptyProjectObjectTree())
  const legacyWarnings = ref<string[]>([])
  const legacyMaps = ref<LegacyObjectTreeMaps | null>(null)

  const index = computed(() => buildNodeIndex(tree.value.root))

  function createEmpty() {
    tree.value = createEmptyProjectObjectTree()
    legacyWarnings.value = []
    legacyMaps.value = null
  }

  function loadFromLegacyProject(project: Project) {
    const result = legacyProjectToObjectTree(project)
    tree.value = result.tree
    legacyWarnings.value = result.warnings
    legacyMaps.value = result.maps
  }

  function loadObjectTree(nextTree: ProjectObjectTree) {
    tree.value = nextTree
    legacyWarnings.value = []
    legacyMaps.value = null
  }

  function node(id: NodeId) {
    return getNode(index.value, id)
  }

  function parent(id: NodeId) {
    return getParent(index.value, id)
  }

  function isDescendant(id: NodeId, ancestorId: NodeId) {
    return isDescendantOf(index.value, id, ancestorId)
  }

  function moveNode(nodeId: NodeId, targetParentId: NodeId): { ok: boolean; reason?: string } {
    const currentIndex = index.value
    const nodeToMove = currentIndex.nodes[nodeId]
    const targetParent = currentIndex.nodes[targetParentId]
    if (!nodeToMove || !targetParent) return { ok: false, reason: '节点不存在' }
    if (nodeId === targetParentId || isDescendantOf(currentIndex, targetParentId, nodeId)) {
      return { ok: false, reason: '不能移动到自身或子节点内' }
    }

    const policy = canTransferTreeNode(currentIndex, nodeToMove, targetParent, 'move')
    if (!policy.ok) return policy

    const removed = removeNode(tree.value.root, nodeId)
    if (!removed) return { ok: false, reason: '移动源节点不存在' }
    const nextIndex = buildNodeIndex(tree.value.root)
    const refreshedTarget = nextIndex.nodes[targetParentId]
    if (!refreshedTarget || (refreshedTarget.kind !== 'folder' && refreshedTarget.kind !== 'trackFolder')) {
      insertChild(tree.value.root, removed)
      return { ok: false, reason: '目标不是文件夹' }
    }
    insertChild(refreshedTarget, removed)
    return { ok: true }
  }

  function createFolder(parentId: NodeId, name: string): { ok: boolean; reason?: string; id?: NodeId } {
    const currentIndex = index.value
    const targetParent = currentIndex.nodes[parentId]
    if (!targetParent) return { ok: false, reason: '目标目录不存在' }
    const policy = canCreateFolderIn(currentIndex, targetParent)
    if (!policy.ok) return policy
    if (targetParent.kind !== 'folder' && targetParent.kind !== 'trackFolder') return { ok: false, reason: '目标不是文件夹' }
    const trimmed = name.trim()
    if (!trimmed) return { ok: false, reason: '文件夹名不能为空' }
    const id = `node:folder:${crypto.randomUUID()}`
    insertChild(targetParent, { id, kind: 'folder', name: trimmed, children: [] })
    return { ok: true, id }
  }

  function renameNode(nodeId: NodeId, name: string): { ok: boolean; reason?: string } {
    const nodeToRename = index.value.nodes[nodeId]
    if (!nodeToRename) return { ok: false, reason: '节点不存在' }
    if (nodeToRename.id.startsWith('project:/')) return { ok: false, reason: '固定顶层目录不能重命名' }
    const trimmed = name.trim()
    if (!trimmed) return { ok: false, reason: '名称不能为空' }
    nodeToRename.name = trimmed
    return { ok: true }
  }

  function deleteNode(nodeId: NodeId): { ok: boolean; reason?: string } {
    const currentIndex = index.value
    const nodeToDelete = currentIndex.nodes[nodeId]
    if (!nodeToDelete) return { ok: false, reason: '节点不存在' }
    const policy = canDeleteTreeNode(currentIndex, nodeToDelete)
    if (!policy.ok) return policy
    if (nodeToDelete.kind === 'audio') {
      const assetId = nodeToDelete.audio.assetId
      const blobKey = tree.value.assets[assetId]?.blobKey
      if (blobKey) useTracksStore().sourceBlobs.delete(blobKey)
      delete tree.value.assets[assetId]
    }
    removeNode(tree.value.root, nodeId)
    return { ok: true }
  }

  async function importFilesToFolder(parentId: NodeId, files: File[]): Promise<{ ok: boolean; reason?: string; ids?: NodeId[] }> {
    const currentIndex = index.value
    const targetParent = currentIndex.nodes[parentId]
    if (!targetParent) return { ok: false, reason: '目标目录不存在' }
    const policy = canImportFilesInto(currentIndex, targetParent)
    if (!policy.ok) return policy
    if (targetParent.kind !== 'folder' && targetParent.kind !== 'trackFolder') return { ok: false, reason: '目标不是文件夹' }

    const tracksStore = useTracksStore()
    const ids: NodeId[] = []
    for (const file of files) {
      const assetId = `asset:import:${crypto.randomUUID()}`
      const nodeId = `node:audio:${crypto.randomUUID()}`
      tree.value.assets[assetId] = {
        id: assetId,
        storage: 'projectBlob',
        blobKey: file.name,
        sampleRate: 0,
        duration: 0,
        channels: 0,
      }
      tracksStore.sourceBlobs.set(file.name, file)
      insertChild(targetParent, {
        id: nodeId,
        kind: 'audio',
        name: file.name,
        audio: {
          assetId,
          midiObjectId: null,
          textObjectId: null,
        },
      })
      ids.push(nodeId)
    }
    return { ok: true, ids }
  }

  async function dropAudioObjectToTimeline(nodeId: NodeId, timelineStart = 0): Promise<{ ok: boolean; reason?: string; trackId?: string; segmentId?: string }> {
    const currentIndex = index.value
    const sourceNode = currentIndex.nodes[nodeId]
    if (!sourceNode) return { ok: false, reason: '对象不存在' }
    const policy = canDragIntoTimeline(sourceNode, currentIndex)
    if (!policy.ok) return policy
    if (sourceNode.kind !== 'audio') return { ok: false, reason: '第一版只支持 audio 对象拖入时间线' }

    const asset = tree.value.assets[sourceNode.audio.assetId]
    if (!asset?.blobKey) return { ok: false, reason: '音频对象没有可用 blob' }
    const tracksStore = useTracksStore()
    const blob = tracksStore.sourceBlobs.get(asset.blobKey)
    if (!blob) return { ok: false, reason: '音频 blob 不存在' }

    const meta = await decodeAudioMeta(blob)
    const trackSourceAssetId = `asset:trackSource:${crypto.randomUUID()}`
    const trackSourceObjectId = `node:trackSource:audio:${crypto.randomUUID()}`
    const sourceFile = `${trackSourceObjectId}:${sourceNode.name}`
    tree.value.assets[trackSourceAssetId] = {
      ...asset,
      id: trackSourceAssetId,
      storage: 'projectBlob',
      blobKey: sourceFile,
      sampleRate: meta.sampleRate,
      duration: meta.duration,
      channels: meta.channels,
    }
    tracksStore.sourceBlobs.set(sourceFile, blob)

    const trackSourceObject: AudioObjectNode = {
      id: trackSourceObjectId,
      kind: 'audio',
      name: sourceNode.name,
      audio: {
        assetId: trackSourceAssetId,
        midiObjectId: sourceNode.audio.midiObjectId,
        textObjectId: sourceNode.audio.textObjectId,
      },
    }
    insertIntoFirstFolder(TOP_LEVEL_IDS.trackSources, trackSourceObject)

    const trackId = tracksStore.addTrack(sourceFile, meta.sampleRate, meta.totalSamples, sourceNode.name, blob)
    const segment = tracksStore.getTrackSegments(trackId)[0]
    if (!segment) return { ok: false, reason: '创建时间线片段失败' }
    segment.timelineStart = timelineStart
    segment.timelineEnd = timelineStart + meta.duration
    segment.srcEndSample = meta.totalSamples

    const trackObjectId = `node:trackObject:${segment.id}`
    const trackFolder: TrackFolderNode = {
      id: `node:trackFolder:${trackId}`,
      kind: 'trackFolder',
      name: sourceNode.name,
      trackFolder: {
        trackType: 'audio',
        color: tracksStore.tracks[trackId]?.color,
        muted: false,
        solo: false,
        volume: 1,
      },
      children: [],
      legacy: { trackId },
    }
    const trackObject: TrackObjectNode = {
      id: trackObjectId,
      kind: 'trackObject',
      name: sourceNode.name,
      trackObject: {
        contentType: 'audio',
        sourceObjectId: trackSourceObjectId,
        timelineStart: segment.timelineStart,
        timelineEnd: segment.timelineEnd,
        ignored: false,
      },
      legacy: { segmentId: segment.id, trackId },
    }
    trackFolder.children.push(trackObject)
    insertIntoFirstFolder(TOP_LEVEL_IDS.tracks, trackFolder)
    tracksStore.reconcileF0ForTrack(trackId)
    return { ok: true, trackId, segmentId: segment.id }
  }

  async function addRenderedAudioToTimeline(options: {
    blob: Blob
    outputFileName: string
    renderKind: 'svc' | 'svs'
    timelineStart?: number
  }): Promise<{
    ok: boolean
    reason?: string
    trackId?: string
    segmentId?: string
    renderObjectId?: NodeId
    trackSourceObjectId?: NodeId
    trackObjectId?: NodeId
    outputFileName?: string
  }> {
    const tracksStore = useTracksStore()
    const meta = await decodeAudioMeta(options.blob)
    const timelineStart = options.timelineStart ?? 0
    const renderFolder = getOrCreateChildFolder(TOP_LEVEL_IDS.renders, options.renderKind)
    const outputFileName = uniqueChildName(renderFolder, ensureWavFileName(options.outputFileName))

    const renderAssetId = `asset:render:${options.renderKind}:${crypto.randomUUID()}`
    const renderObjectId = `node:render:${options.renderKind}:audio:${crypto.randomUUID()}`
    const renderBlobKey = `${renderObjectId}:${outputFileName}`
    tree.value.assets[renderAssetId] = {
      id: renderAssetId,
      storage: 'projectBlob',
      blobKey: renderBlobKey,
      sampleRate: meta.sampleRate,
      duration: meta.duration,
      channels: meta.channels,
    }
    tracksStore.sourceBlobs.set(renderBlobKey, options.blob)
    insertChild(renderFolder, {
      id: renderObjectId,
      kind: 'audio',
      name: outputFileName,
      audio: {
        assetId: renderAssetId,
        midiObjectId: null,
        textObjectId: null,
        tags: [options.renderKind],
      },
    })

    const trackSourceAssetId = `asset:trackSource:${crypto.randomUUID()}`
    const trackSourceObjectId = `node:trackSource:audio:${crypto.randomUUID()}`
    const trackSourceBlobKey = `${trackSourceObjectId}:${outputFileName}`
    tree.value.assets[trackSourceAssetId] = {
      id: trackSourceAssetId,
      storage: 'projectBlob',
      blobKey: trackSourceBlobKey,
      sampleRate: meta.sampleRate,
      duration: meta.duration,
      channels: meta.channels,
    }
    tracksStore.sourceBlobs.set(trackSourceBlobKey, options.blob)

    const trackId = tracksStore.addTrack(trackSourceBlobKey, meta.sampleRate, meta.totalSamples, outputFileName, options.blob)
    const segment = tracksStore.getTrackSegments(trackId)[0]
    if (!segment) return { ok: false, reason: '创建时间线片段失败' }
    segment.timelineStart = timelineStart
    segment.timelineEnd = timelineStart + meta.duration
    segment.srcEndSample = meta.totalSamples

    const trackSourceObject: AudioObjectNode = {
      id: trackSourceObjectId,
      kind: 'audio',
      name: outputFileName,
      audio: {
        assetId: trackSourceAssetId,
        midiObjectId: null,
        textObjectId: null,
        tags: [options.renderKind],
      },
      legacy: { segmentId: segment.id, trackId },
    }
    insertChild(getOrCreateChildFolder(TOP_LEVEL_IDS.trackSources, 'audio'), trackSourceObject)

    const trackObjectId = `node:trackObject:${segment.id}`
    const trackFolder: TrackFolderNode = {
      id: `node:trackFolder:${trackId}`,
      kind: 'trackFolder',
      name: outputFileName,
      trackFolder: {
        trackType: 'audio',
        color: tracksStore.tracks[trackId]?.color,
        muted: false,
        solo: false,
        volume: 1,
      },
      children: [{
        id: trackObjectId,
        kind: 'trackObject',
        name: outputFileName,
        trackObject: {
          contentType: 'audio',
          sourceObjectId: trackSourceObjectId,
          timelineStart: segment.timelineStart,
          timelineEnd: segment.timelineEnd,
          ignored: false,
        },
        legacy: { segmentId: segment.id, trackId },
      }],
      legacy: { trackId },
    }
    insertIntoFirstFolder(TOP_LEVEL_IDS.tracks, trackFolder)
    tracksStore.reconcileF0ForTrack(trackId)

    return {
      ok: true,
      trackId,
      segmentId: segment.id,
      renderObjectId,
      trackSourceObjectId,
      trackObjectId,
      outputFileName,
    }
  }

  function syncTrackFolderName(trackId: string, name: string): { ok: boolean; reason?: string } {
    const trackFolderId = `node:trackFolder:${trackId}`
    const trackFolder = index.value.nodes[trackFolderId]
    if (!trackFolder || trackFolder.kind !== 'trackFolder') return { ok: false, reason: '对象树中没有对应 TrackFolder' }
    trackFolder.name = name
    return { ok: true }
  }

  function syncSplitSegment(oldSegment: AudioSegment, newSegments: [AudioSegment, AudioSegment]): { ok: boolean; reason?: string } {
    const oldTrackObjectId = `node:trackObject:${oldSegment.id}`
    const oldTrackObject = index.value.nodes[oldTrackObjectId]
    if (!oldTrackObject || oldTrackObject.kind !== 'trackObject') return { ok: false, reason: '对象树中没有对应 TrackObject' }
    const oldSourceId = oldTrackObject.trackObject.sourceObjectId
    const oldSource = index.value.nodes[oldSourceId]
    if (!oldSource || oldSource.kind !== 'audio') return { ok: false, reason: '对象树中没有对应源对象' }

    const newSources: AudioObjectNode[] = newSegments.map(seg => {
      const assetId = `asset:trackSource:${seg.id}`
      tree.value.assets[assetId] = {
        id: assetId,
        storage: 'projectBlob',
        blobKey: seg.sourceFile,
        sampleRate: inferSampleRate(seg),
        duration: Math.max(0, seg.timelineEnd - seg.timelineStart),
        channels: 1,
      }
      return {
        id: `node:trackSource:audio:${seg.id}`,
        kind: 'audio',
        name: `${oldSource.name}-${seg.id}`,
        audio: {
          assetId,
          midiObjectId: oldSource.audio.midiObjectId,
          textObjectId: oldSource.audio.textObjectId,
        },
        legacy: { segmentId: seg.id, trackId: seg.trackId },
      }
    })

    const newTrackObjects: TrackObjectNode[] = newSegments.map((seg, idx) => ({
      id: `node:trackObject:${seg.id}`,
      kind: 'trackObject',
      name: `${oldTrackObject.name}-${idx + 1}`,
      trackObject: {
        contentType: 'audio',
        sourceObjectId: newSources[idx].id,
        timelineStart: seg.timelineStart,
        timelineEnd: seg.timelineEnd,
        ignored: seg.ignored,
      },
      legacy: { segmentId: seg.id, trackId: seg.trackId },
    }))

    replaceNode(tree.value.root, oldTrackObjectId, newTrackObjects)
    replaceNode(tree.value.root, oldSourceId, newSources)
    deleteStaleAssetForSource(oldSource)
    return { ok: true }
  }

  function inferSampleRate(seg: AudioSegment): number {
    const length = Math.max(1, seg.srcEndSample - seg.srcStartSample)
    const duration = Math.max(0.001, seg.timelineEnd - seg.timelineStart)
    return Math.round(length / duration)
  }

  function deleteStaleAssetForSource(source: AudioObjectNode) {
    delete tree.value.assets[source.audio.assetId]
  }

  function insertIntoFirstFolder(parentId: NodeId, child: TreeNode) {
    const parent = buildNodeIndex(tree.value.root).nodes[parentId]
    if (!parent || parent.kind !== 'folder') throw new Error(`Missing folder ${parentId}`)
    insertChild(parent, child)
  }

  function getOrCreateChildFolder(parentId: NodeId, name: string): FolderNode {
    const currentIndex = buildNodeIndex(tree.value.root)
    const parent = currentIndex.nodes[parentId]
    if (!parent || parent.kind !== 'folder') throw new Error(`Missing folder ${parentId}`)
    const existing = parent.children.find((child): child is FolderNode => child.kind === 'folder' && child.name === name)
    if (existing) return existing
    const preferredId = `${parentId}/${name}`
    const folder: FolderNode = {
      id: currentIndex.nodes[preferredId] ? `node:folder:${crypto.randomUUID()}` : preferredId,
      kind: 'folder',
      name,
      children: [],
    }
    insertChild(parent, folder)
    return folder
  }

  return {
    tree,
    legacyWarnings,
    legacyMaps,
    index,
    createEmpty,
    loadFromLegacyProject,
    loadObjectTree,
    node,
    parent,
    isDescendant,
    moveNode,
    createFolder,
    renameNode,
    deleteNode,
    importFilesToFolder,
    dropAudioObjectToTimeline,
    addRenderedAudioToTimeline,
    syncTrackFolderName,
    syncSplitSegment,
  }
})

async function decodeAudioMeta(blob: Blob): Promise<{ sampleRate: number; totalSamples: number; duration: number; channels: number }> {
  const root = globalThis as typeof globalThis & { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
  const AudioContextCtor = root.AudioContext || root.webkitAudioContext
  if (!AudioContextCtor) {
    return { sampleRate: 44100, totalSamples: Math.max(1, Math.round(blob.size / 2)), duration: Math.max(0.01, blob.size / 88200), channels: 1 }
  }
  const audioCtx = new AudioContextCtor()
  try {
    const audioBuf = await audioCtx.decodeAudioData(await blob.arrayBuffer())
    return {
      sampleRate: audioBuf.sampleRate,
      totalSamples: Math.round(audioBuf.duration * audioBuf.sampleRate),
      duration: audioBuf.duration,
      channels: audioBuf.numberOfChannels,
    }
  } finally {
    audioCtx.close()
  }
}

function ensureWavFileName(name: string): string {
  const clean = sanitizeFileName(name) || 'SVC_output'
  return /\.wav$/i.test(clean) ? clean : `${clean}.wav`
}

function sanitizeFileName(name: string): string {
  return name.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
}

function uniqueChildName(parent: FolderNode, preferred: string): string {
  const taken = new Set(parent.children.map(child => child.name))
  if (!taken.has(preferred)) return preferred
  const match = preferred.match(/^(.*?)(\.[^.]+)?$/)
  const stem = match?.[1] || preferred
  const ext = match?.[2] || ''
  for (let index = 2; index < 10000; index++) {
    const candidate = `${stem} (${index})${ext}`
    if (!taken.has(candidate)) return candidate
  }
  return `${stem} (${crypto.randomUUID().slice(0, 8)})${ext}`
}

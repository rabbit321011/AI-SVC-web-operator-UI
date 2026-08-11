import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import type { AudioSegment, GroupElementSnapshot, Project } from '@/types'
import type { AudioObjectNode, FolderNode, GroupObjectNode, LegacyObjectTreeMaps, NodeId, ProjectObjectTree, SynthesisHPlacementRange, SynthesisHTokenEvent, SynthesisKanaSegmentBoundary, SynthesisKanaUnit, SynthesisSegmentObject, SynthesisTake, SynthesisUnitObjectNode, TextSegment, TrackFolderNode, TrackObjectContentType, TrackObjectNode, TreeNode } from '@/object-workbench'
import {
  buildNodeIndex,
  canDragIntoTimeline,
  canCreateFolderIn,
  canDeleteTreeNode,
  canImportFilesInto,
  canTransferTreeNode,
  createEmptySynthesisUnit,
  createEmptyProjectObjectTree,
  findNodeLocation,
  getProjectArea,
  getNode,
  getParent,
  insertChild,
  isDescendantOf,
  legacyProjectToObjectTree,
  removeNode,
  moveHTokenEvent as applyMoveHTokenEvent,
  moveKanaSharedBoundary as applyMoveKanaSharedBoundary,
  moveMidiPFrame as applyMoveMidiPFrame,
  replaceHTokenTrackRange as applyReplaceHTokenTrackRange,
  replaceKanaTrackRange as applyReplaceKanaTrackRange,
  replaceMidiPFrame as applyReplaceMidiPFrame,
  replaceMidiPTrack as applyReplaceMidiPTrack,
  replaceSegmentTrack as applyReplaceSegmentTrack,
  updateSegmentObject as applyUpdateSegmentObject,
  updateKanaUnit as applyUpdateKanaUnit,
  resolveOwnedGuideSource,
  replaceNode,
  TOP_LEVEL_IDS,
  V5P_SAMPLE_RATE,
} from '@/object-workbench'
import { useTracksStore } from './tracks'
import { useCompGroupsStore } from './compGroups'
import { getAudioBlobMeta } from '@/utils/audioMeta'
import { combineSegmentsToBlob } from '@/api/wav'

interface CreateSynthesisUnitDependencies {
  renderGuide?: typeof combineSegmentsToBlob
  hashBlob?: (blob: Blob) => Promise<string>
  now?: string
}

export interface CreateSynthesisUnitResult {
  ok: boolean
  reason?: string
  unitId?: NodeId
  unit?: SynthesisUnitObjectNode
  guideAssetId?: string
  guideBlobKey?: string
  guideBlob?: Blob
  warnings?: string[]
}

export interface SplitSegmentObjectTreeSnapshot {
  oldTrackObject: TrackObjectNode
  oldSource: AudioObjectNode
  oldAsset: ProjectObjectTree['assets'][string] | undefined
  oldTrackParentId: NodeId
  oldTrackIndex: number
  oldSourceParentId: NodeId
  oldSourceIndex: number
  newTrackObjectIds: [NodeId, NodeId]
  newSourceIds: [NodeId, NodeId]
  newAssetIds: [string, string]
  groups: Array<{ groupId: NodeId; trackObjectIds: NodeId[] }>
}

export const useObjectTreeStore = defineStore('objectTree', () => {
  const tree = ref<ProjectObjectTree>(createEmptyProjectObjectTree())
  const legacyWarnings = ref<string[]>([])
  const legacyMaps = ref<LegacyObjectTreeMaps | null>(null)
  const textEditRevision = ref(0)
  const textEditRevisionBySource = reactive<Record<string, number>>({})

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

  function snapshotTree(): ProjectObjectTree {
    return clonePlain(tree.value)
  }

  function restoreTree(snapshot: ProjectObjectTree) {
    tree.value = clonePlain(snapshot)
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
    if (removed.kind === 'trackObject' && refreshedTarget.kind === 'trackFolder') {
      syncMovedTrackObjectToLegacy(removed, refreshedTarget)
    }
    return { ok: true }
  }

  function syncMovedTrackObjectToLegacy(trackObject: TrackObjectNode, targetFolder: TrackFolderNode) {
    const targetTrackId = targetFolder.legacy?.trackId ?? trackIdFromTrackFolderId(targetFolder.id)
    if (!targetTrackId) return
    const oldTrackId = trackObject.legacy?.trackId
    const segmentId = trackObject.legacy?.segmentId ?? segmentIdFromTrackObjectId(trackObject.id)
    if (!segmentId) return
    trackObject.legacy = { ...(trackObject.legacy ?? {}), segmentId, trackId: targetTrackId }

    const source = index.value.nodes[trackObject.trackObject.sourceObjectId]
    if (source?.kind === 'audio') {
      source.legacy = { ...(source.legacy ?? {}), segmentId, trackId: targetTrackId }
    }

    const tracksStore = useTracksStore()
    const segment = tracksStore.segmentsMap[segmentId]
    if (!segment) return
    if (oldTrackId && tracksStore.tracks[oldTrackId]) {
      tracksStore.tracks[oldTrackId].segments = tracksStore.tracks[oldTrackId].segments.filter(id => id !== segmentId)
    }
    segment.trackId = targetTrackId
    if (tracksStore.tracks[targetTrackId] && !tracksStore.tracks[targetTrackId].segments.includes(segmentId)) {
      tracksStore.tracks[targetTrackId].segments.push(segmentId)
      tracksStore.tracks[targetTrackId].segments.sort((a, b) => (tracksStore.segmentsMap[a]?.timelineStart ?? 0) - (tracksStore.segmentsMap[b]?.timelineStart ?? 0))
    }
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
    if (nodeToRename.kind === 'trackFolder' && nodeToRename.legacy?.trackId) {
      useTracksStore().renameTrack(nodeToRename.legacy.trackId, trimmed)
    }
    if (nodeToRename.kind === 'group' && nodeToRename.legacy?.compGroupId) {
      useCompGroupsStore().rename(nodeToRename.legacy.compGroupId, trimmed)
    }
    return { ok: true }
  }

  function deleteNode(nodeId: NodeId): { ok: boolean; reason?: string } {
    const currentIndex = index.value
    const nodeToDelete = currentIndex.nodes[nodeId]
    if (!nodeToDelete) return { ok: false, reason: '节点不存在' }

    if (nodeToDelete.kind === 'trackObject') return deleteTrackObjectFromObjectTree(nodeToDelete)
    if (nodeToDelete.kind === 'trackFolder') return deleteTrackFolderFromObjectTree(nodeToDelete)
    if (nodeToDelete.kind === 'group') return deleteGroupObjectFromObjectTree(nodeToDelete)
    if (nodeToDelete.kind === 'synthesisUnit') return deleteSynthesisUnitFromObjectTree(nodeToDelete)
    if (nodeToDelete.kind === 'audio' && getProjectArea(currentIndex, nodeToDelete.id) === 'trackSources') {
      return deleteTrackSourceFromObjectTree(nodeToDelete)
    }

    const policy = canDeleteTreeNode(currentIndex, nodeToDelete)
    if (!policy.ok) return policy
    if (nodeToDelete.kind === 'audio') {
      deleteAudioAssetAndBlob(nodeToDelete)
    }
    removeNode(tree.value.root, nodeId)
    return { ok: true }
  }

  function deleteTrackObjectFromObjectTree(trackObject: TrackObjectNode): { ok: boolean; reason?: string } {
    const segmentId = trackObject.legacy?.segmentId ?? segmentIdFromTrackObjectId(trackObject.id)
    const trackId = trackObject.legacy?.trackId ?? findParentTrackId(trackObject.id)
    const sourceId = trackObject.trackObject.sourceObjectId
    const source = index.value.nodes[sourceId]
    if (source?.kind === 'audio') deleteAudioAssetAndBlob(source)
    removeNode(tree.value.root, trackObject.id)
    removeNode(tree.value.root, sourceId)
    removeTrackObjectFromGroups(trackObject.id)
    removeLegacySegmentFromCompGroups(segmentId)
    pruneEmptyGroups()

    const tracksStore = useTracksStore()
    if (segmentId) delete tracksStore.segmentsMap[segmentId]
    if (trackId && tracksStore.tracks[trackId]) {
      tracksStore.tracks[trackId].segments = tracksStore.tracks[trackId].segments.filter(id => id !== segmentId)
    }
    return { ok: true }
  }

  function deleteTrackFolderFromObjectTree(trackFolder: TrackFolderNode): { ok: boolean; reason?: string } {
    const trackObjects = trackFolder.children.map(child => clonePlain(child))
    for (const nodeToDelete of trackObjects) {
      const result = deleteTrackObjectFromObjectTree(nodeToDelete)
      if (!result.ok) return result
    }

    const trackId = trackFolder.legacy?.trackId ?? trackIdFromTrackFolderId(trackFolder.id)
    removeLegacyTrackFromCompGroups(trackId)
    if (trackId) useTracksStore().removeTrack(trackId)
    removeNode(tree.value.root, trackFolder.id)
    pruneEmptyGroups()
    return { ok: true }
  }

  function deleteTrackSourceFromObjectTree(source: AudioObjectNode): { ok: boolean; reason?: string } {
    const refs = collectTrackObjects().filter(trackObject => trackObject.trackObject.sourceObjectId === source.id)
    if (refs.length === 0) {
      deleteAudioAssetAndBlob(source)
      removeNode(tree.value.root, source.id)
      return { ok: true }
    }
    for (const ref of refs) {
      const result = deleteTrackObjectFromObjectTree(ref)
      if (!result.ok) return result
    }
    return { ok: true }
  }

  function deleteGroupObjectFromObjectTree(group: GroupObjectNode): { ok: boolean; reason?: string } {
    if (group.legacy?.compGroupId) useCompGroupsStore().remove(group.legacy.compGroupId)
    removeNode(tree.value.root, group.id)
    return { ok: true }
  }

  function deleteSynthesisUnitFromObjectTree(unit: SynthesisUnitObjectNode): { ok: boolean; reason?: string } {
    const referencing = Object.values(index.value.nodes).filter(node => (
      node.kind === 'synthesisUnit'
      && node.id !== unit.id
      && node.synthesisUnit.reference?.unitId === unit.id
    ))
    if (referencing.length > 0) {
      return { ok: false, reason: `该合成单元仍被 ${referencing.length} 个 A 区参考绑定` }
    }
    deleteAssetAndBlob(unit.synthesisUnit.guide.assetId)
    for (const take of unit.synthesisUnit.takes) {
      if (take.outputAssetId) deleteAssetAndBlob(take.outputAssetId)
    }
    removeNode(tree.value.root, unit.id)
    return { ok: true }
  }

  function canBindSynthesisReferenceUnit(
    unitId: NodeId,
    referenceUnitId: NodeId,
  ): { ok: boolean; reason?: string } {
    const unit = index.value.nodes[unitId]
    const referenceUnit = index.value.nodes[referenceUnitId]
    if (!unit || unit.kind !== 'synthesisUnit') return { ok: false, reason: '目标合成单元不存在' }
    if (!referenceUnit || referenceUnit.kind !== 'synthesisUnit') {
      return { ok: false, reason: 'A 区参考只接受合成单元' }
    }
    if (unitId === referenceUnitId) return { ok: false, reason: '合成单元不能绑定自身作为 A 区参考' }
    if (unit.synthesisUnit.reference?.unitId === referenceUnitId) {
      return { ok: false, reason: '已经绑定该 A 区参考' }
    }

    const visited = new Set<NodeId>()
    let cursor: NodeId | null = referenceUnitId
    while (cursor) {
      if (cursor === unitId) return { ok: false, reason: '该绑定会形成合成单元循环引用' }
      if (visited.has(cursor)) return { ok: false, reason: '候选参考链中已经存在循环引用' }
      visited.add(cursor)
      const current: TreeNode | undefined = index.value.nodes[cursor]
      if (!current || current.kind !== 'synthesisUnit') break
      cursor = current.synthesisUnit.reference?.unitId ?? null
    }
    return { ok: true }
  }

  function bindSynthesisReferenceUnit(
    unitId: NodeId,
    referenceUnitId: NodeId,
    now?: string,
  ): { ok: boolean; reason?: string } {
    const policy = canBindSynthesisReferenceUnit(unitId, referenceUnitId)
    if (!policy.ok) return policy
    const unit = index.value.nodes[unitId]
    if (!unit || unit.kind !== 'synthesisUnit') return { ok: false, reason: '目标合成单元不存在' }
    const timestamp = now ?? new Date().toISOString()
    unit.synthesisUnit.reference = {
      unitId: referenceUnitId,
      audioSource: 'guide',
      range: 'full-guide',
      revisionPolicy: 'follow-latest',
      boundAt: timestamp,
    }
    unit.synthesisUnit.unitRevision += 1
    unit.synthesisUnit.updatedAt = timestamp
    return { ok: true }
  }

  function unbindSynthesisReferenceUnit(
    unitId: NodeId,
    now?: string,
  ): { ok: boolean; reason?: string } {
    const unit = index.value.nodes[unitId]
    if (!unit || unit.kind !== 'synthesisUnit') return { ok: false, reason: '目标合成单元不存在' }
    if (!unit.synthesisUnit.reference) return { ok: false, reason: '尚未绑定 A 区参考' }
    const timestamp = now ?? new Date().toISOString()
    unit.synthesisUnit.reference = null
    unit.synthesisUnit.unitRevision += 1
    unit.synthesisUnit.updatedAt = timestamp
    return { ok: true }
  }

  function queueSynthesisTake(unitId: NodeId, take: SynthesisTake): { ok: boolean; reason?: string } {
    const unit = index.value.nodes[unitId]
    if (!unit || unit.kind !== 'synthesisUnit') return { ok: false, reason: '合成单元不存在' }
    if (unit.synthesisUnit.takes.some(item => item.id === take.id)) return { ok: false, reason: 'Take ID 重复' }
    if (take.status !== 'queued' && take.status !== 'running') return { ok: false, reason: '新 Take 状态无效' }
    unit.synthesisUnit.takes.push(structuredClone(take))
    unit.synthesisUnit.activeTakeId = take.id
    return { ok: true }
  }

  async function completeSynthesisTake(
    unitId: NodeId,
    takeId: string,
    blob: Blob,
    result: {
      outputSHA256: string
      snapshotSHA256: string
      sampleRate: 44100
      sampleCount: number
      duration: number
      checkpointSHA256: string
      vaeSHA256: string
      adapterSHA256: string
      seed: number
    },
    completedAt?: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    const unit = index.value.nodes[unitId]
    if (!unit || unit.kind !== 'synthesisUnit') return { ok: false, reason: '合成单元不存在' }
    const take = unit.synthesisUnit.takes.find(item => item.id === takeId)
    if (!take) return { ok: false, reason: 'Take 不存在' }
    if (take.status === 'ready') return { ok: false, reason: '已完成 Take 不可覆盖' }
    const meta = await getAudioBlobMeta(blob)
    if (
      meta.sampleRate !== result.sampleRate
      || meta.totalSamples !== result.sampleCount
      || Math.abs(meta.duration - result.duration) > 1 / result.sampleRate
    ) return { ok: false, reason: 'Take Blob 与服务端结果合同不一致' }
    const assetId = `asset:synthesisTake:${crypto.randomUUID()}`
    const blobKey = `synthesis-take_${takeId}.wav`
    tree.value.assets[assetId] = {
      id: assetId,
      storage: 'projectBlob',
      blobKey,
      sampleRate: result.sampleRate,
      sampleCount: result.sampleCount,
      duration: result.duration,
      channels: meta.channels,
      sha256: result.outputSHA256,
    }
    useTracksStore().sourceBlobs.set(blobKey, blob)
    Object.assign(take, {
      status: 'ready',
      outputAssetId: assetId,
      outputSHA256: result.outputSHA256,
      snapshotSHA256: result.snapshotSHA256,
      sampleRate: result.sampleRate,
      sampleCount: result.sampleCount,
      duration: result.duration,
      checkpointSHA256: result.checkpointSHA256,
      vaeSHA256: result.vaeSHA256,
      adapterSHA256: result.adapterSHA256,
      seed: result.seed,
      completedAt: completedAt ?? new Date().toISOString(),
      error: undefined,
    })
    unit.synthesisUnit.activeTakeId = take.id
    return { ok: true }
  }

  function failSynthesisTake(
    unitId: NodeId,
    takeId: string,
    error: string,
  ): { ok: boolean; reason?: string } {
    const unit = index.value.nodes[unitId]
    if (!unit || unit.kind !== 'synthesisUnit') return { ok: false, reason: '合成单元不存在' }
    const take = unit.synthesisUnit.takes.find(item => item.id === takeId)
    if (!take) return { ok: false, reason: 'Take 不存在' }
    if (take.status === 'ready') return { ok: false, reason: '已完成 Take 不可改为失败' }
    take.status = 'failed'
    take.error = error
    take.completedAt = new Date().toISOString()
    return { ok: true }
  }

  function setActiveSynthesisTake(unitId: NodeId, takeId: string): { ok: boolean; reason?: string } {
    const unit = index.value.nodes[unitId]
    if (!unit || unit.kind !== 'synthesisUnit') return { ok: false, reason: '合成单元不存在' }
    const take = unit.synthesisUnit.takes.find(item => item.id === takeId)
    if (!take || take.status !== 'ready') return { ok: false, reason: 'Take 尚未完成' }
    unit.synthesisUnit.activeTakeId = take.id
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

  async function createSynthesisUnitFromAudioObject(
    sourceAudioObjectId: NodeId,
    dependencies: CreateSynthesisUnitDependencies = {},
  ): Promise<CreateSynthesisUnitResult> {
    try {
      const tracksStore = useTracksStore()
      const source = await resolveOwnedGuideSource({
        tree: tree.value,
        sourceAudioObjectId,
        sourceBlobs: tracksStore.sourceBlobs,
        segments: tracksStore.segmentsMap,
        tracks: tracksStore.tracks,
      })
      const sampleCount = Math.round(source.resolved.duration * V5P_SAMPLE_RATE)
      if (sampleCount < 2048) {
        return { ok: false, reason: '有效音频区间短于一个 V5-P frame（2048 samples）' }
      }

      const renderGuide = dependencies.renderGuide ?? combineSegmentsToBlob
      const guideBlob = await renderGuide(
        source.resolved.segmentInputs,
        source.resolved.duration,
        V5P_SAMPLE_RATE,
      )
      const hashBlob = dependencies.hashBlob ?? sha256Blob
      const guideSHA256 = await hashBlob(guideBlob)
      const idSuffix = crypto.randomUUID()
      const guideAssetId = `asset:synthesisGuide:${idSuffix}`
      const guideBlobKey = `synthesis-guide_${idSuffix}.wav`

      const folder = getOrCreateChildFolder(TOP_LEVEL_IDS.workspace, 'Synthesis Units')
      const unitName = uniqueChildName(folder, synthesisUnitName(source.source.name))
      const unit = createEmptySynthesisUnit({
        id: `node:synthesisUnit:${idSuffix}`,
        name: unitName,
        now: dependencies.now,
        defaultTimelineStart: source.defaultTimelineStart,
        guide: {
          assetId: guideAssetId,
          audioSHA256: guideSHA256,
          sampleRate: V5P_SAMPLE_RATE,
          channels: 1,
          sampleCount,
          duration: sampleCount / V5P_SAMPLE_RATE,
          source: {
            sourceAudioObjectId: source.source.id,
            sourceAssetId: source.asset.id,
            sourceAssetSHA256: source.asset.sha256,
            effectiveStartSample: source.effectiveStartSample,
            effectiveEndSampleExclusive: source.effectiveEndSampleExclusive,
            sourceTimelineStart: source.defaultTimelineStart,
            resolverManifest: source.resolverManifest,
          },
        },
      })

      tree.value.assets[guideAssetId] = {
        id: guideAssetId,
        storage: 'projectBlob',
        blobKey: guideBlobKey,
        sampleRate: V5P_SAMPLE_RATE,
        duration: sampleCount / V5P_SAMPLE_RATE,
        channels: 1,
        sampleCount,
        sha256: guideSHA256,
      }
      tracksStore.sourceBlobs.set(guideBlobKey, guideBlob)
      insertChild(folder, unit)

      return {
        ok: true,
        unitId: unit.id,
        unit,
        guideAssetId,
        guideBlobKey,
        guideBlob,
        warnings: source.resolved.warnings,
      }
    } catch (error: any) {
      return { ok: false, reason: error?.message || '创建合成单元失败' }
    }
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

    const meta = await getAudioBlobMeta(blob)
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
    renderKind: 'svc' | 'svs' | 'msst' | 'v5p'
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
    const meta = await getAudioBlobMeta(options.blob)
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
    tree.value.assets[trackSourceAssetId] = {
      id: trackSourceAssetId,
      storage: 'projectBlob',
      blobKey: renderBlobKey,
      sampleRate: meta.sampleRate,
      duration: meta.duration,
      channels: meta.channels,
    }
    const trackId = tracksStore.addTrack(renderBlobKey, meta.sampleRate, meta.totalSamples, outputFileName, options.blob)
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

  function syncPastedTrack(
    trackId: string,
    segments: AudioSegment[],
    originTag: 'paste' | 'import' = 'paste',
  ): { ok: boolean; reason?: string; trackObjectIds?: NodeId[] } {
    const tracksStore = useTracksStore()
    const track = tracksStore.tracks[trackId]
    if (!track) return { ok: false, reason: '时间线音轨不存在' }
    if (segments.length === 0) return { ok: false, reason: '没有可同步的片段' }

    const currentIndex = buildNodeIndex(tree.value.root)
    if (currentIndex.nodes[`node:trackFolder:${trackId}`]) {
      return { ok: false, reason: '对象树中已存在对应 TrackFolder' }
    }

    const trackObjectIds: NodeId[] = []
    const audioFolder = getOrCreateChildFolder(TOP_LEVEL_IDS.trackSources, 'audio')
    const trackFolder: TrackFolderNode = {
      id: `node:trackFolder:${trackId}`,
      kind: 'trackFolder',
      name: track.name,
      trackFolder: {
        trackType: 'audio',
        color: track.color,
        muted: track.muted,
        solo: track.solo,
        volume: track.volume,
      },
      children: [],
      legacy: { trackId },
    }

    for (const seg of [...segments].sort((a, b) => a.timelineStart - b.timelineStart)) {
      const assetId = `asset:trackSource:${seg.id}`
      const sourceObjectId = `node:trackSource:audio:${seg.id}`
      const sourceName = `${track.name}-${seg.id}.wav`
      const sampleRate = track.sampleRate || inferSampleRate(seg)
      const duration = Math.max(0.001, seg.timelineEnd - seg.timelineStart)
      tree.value.assets[assetId] = {
        id: assetId,
        storage: 'projectBlob',
        blobKey: seg.sourceFile,
        sampleRate,
        duration,
        channels: 1,
      }
      insertChild(audioFolder, {
        id: sourceObjectId,
        kind: 'audio',
        name: sourceName,
        audio: {
          assetId,
          midiObjectId: null,
          textObjectId: null,
          tags: [originTag],
        },
        legacy: { segmentId: seg.id, trackId },
      })

      const trackObjectId = `node:trackObject:${seg.id}`
      trackObjectIds.push(trackObjectId)
      trackFolder.children.push({
        id: trackObjectId,
        kind: 'trackObject',
        name: sourceName,
        trackObject: {
          contentType: 'audio',
          sourceObjectId,
          timelineStart: seg.timelineStart,
          timelineEnd: seg.timelineEnd,
          ignored: seg.ignored,
        },
        legacy: { segmentId: seg.id, trackId },
      })
    }

    insertIntoFirstFolder(TOP_LEVEL_IDS.tracks, trackFolder)
    return { ok: true, trackObjectIds }
  }

  function syncTrackFolderName(trackId: string, name: string): { ok: boolean; reason?: string } {
    const trackFolderId = `node:trackFolder:${trackId}`
    const trackFolder = index.value.nodes[trackFolderId]
    if (!trackFolder || trackFolder.kind !== 'trackFolder') return { ok: false, reason: '对象树中没有对应 TrackFolder' }
    trackFolder.name = name
    return { ok: true }
  }

  function syncTrackFolderColor(trackId: string, color: string): { ok: boolean; reason?: string } {
    const trackFolderId = `node:trackFolder:${trackId}`
    const trackFolder = index.value.nodes[trackFolderId]
    if (!trackFolder || trackFolder.kind !== 'trackFolder') return { ok: false, reason: '对象树中没有对应 TrackFolder' }
    trackFolder.trackFolder.color = color
    return { ok: true }
  }

  function syncTrackFolderOrder(trackOrder: string[]): { ok: boolean; reason?: string } {
    const tracksRoot = index.value.nodes[TOP_LEVEL_IDS.tracks]
    if (!tracksRoot || tracksRoot.kind !== 'folder') return { ok: false, reason: '对象树中没有 tracks 根目录' }
    const orderById = new Map(trackOrder.map((trackId, order) => [`node:trackFolder:${trackId}`, order]))
    tracksRoot.children.sort((a, b) => {
      const left = orderById.get(a.id)
      const right = orderById.get(b.id)
      if (left == null && right == null) return 0
      if (left == null) return 1
      if (right == null) return -1
      return left - right
    })
    return { ok: true }
  }

  function createGroupFromLegacyElements(groupId: string, name: string, elements: GroupElementSnapshot[]): { ok: boolean; reason?: string; groupObjectId?: NodeId } {
    const trackObjectIds: NodeId[] = []
    const tracksStore = useTracksStore()
    for (const element of elements) {
      if (element.type === 'segment') {
        trackObjectIds.push(`node:trackObject:${element.id}`)
      } else {
        const track = tracksStore.tracks[element.id]
        if (track) trackObjectIds.push(...track.segments.map(segmentId => `node:trackObject:${segmentId}`))
      }
    }

    const uniqueIds = [...new Set(trackObjectIds)].filter(id => index.value.nodes[id]?.kind === 'trackObject')
    if (uniqueIds.length === 0) return { ok: false, reason: '没有可加入 GroupObject 的 TrackObject' }

    const trackObjects = uniqueIds.map(id => index.value.nodes[id]).filter((node): node is TrackObjectNode => node?.kind === 'trackObject')
    const mediaType = trackObjects[0].trackObject.contentType
    if (trackObjects.some(node => node.trackObject.contentType !== mediaType)) return { ok: false, reason: 'GroupObject 只能包含同类型 TrackObject' }

    const groupObjectId = `node:group:${groupId}`
    if (index.value.nodes[groupObjectId]) return { ok: true, groupObjectId }
    const group: GroupObjectNode = {
      id: groupObjectId,
      kind: 'group',
      name,
      group: {
        mediaType,
        trackObjectIds: trackObjects
          .sort((a, b) => a.trackObject.timelineStart - b.trackObject.timelineStart || a.id.localeCompare(b.id))
          .map(node => node.id),
      },
      legacy: { compGroupId: groupId },
    }
    insertIntoFirstFolder(TOP_LEVEL_IDS.groups, group)
    return { ok: true, groupObjectId }
  }

  function syncMovedSegments(segments: AudioSegment[]): { ok: boolean; reason?: string } {
    for (const seg of segments) {
      const result = syncMovedSegment(seg)
      if (!result.ok) return result
    }
    return { ok: true }
  }

  function syncMovedSegment(seg: AudioSegment): { ok: boolean; reason?: string } {
    const trackObjectId = `node:trackObject:${seg.id}`
    const trackObject = index.value.nodes[trackObjectId]
    if (!trackObject || trackObject.kind !== 'trackObject') return { ok: false, reason: '对象树中没有对应 TrackObject' }

    trackObject.trackObject.timelineStart = seg.timelineStart
    trackObject.trackObject.timelineEnd = seg.timelineEnd
    trackObject.trackObject.ignored = seg.ignored
    trackObject.legacy = { ...(trackObject.legacy ?? {}), segmentId: seg.id, trackId: seg.trackId }

    const source = index.value.nodes[trackObject.trackObject.sourceObjectId]
    if (source?.kind === 'audio') {
      source.legacy = { ...(source.legacy ?? {}), segmentId: seg.id, trackId: seg.trackId }
    }

    const parentId = index.value.parentById[trackObjectId]
    const targetFolderId = `node:trackFolder:${seg.trackId}`
    if (parentId === targetFolderId) return { ok: true }

    const targetFolder = getOrCreateTrackFolderForLegacyTrack(seg.trackId)
    if (!targetFolder) return { ok: false, reason: '对象树中没有目标 TrackFolder' }
    if (targetFolder.trackFolder.trackType !== trackObject.trackObject.contentType) return { ok: false, reason: '目标 TrackFolder 类型不匹配' }

    const removed = removeNode(tree.value.root, trackObjectId)
    if (!removed || removed.kind !== 'trackObject') return { ok: false, reason: '移动 TrackObject 失败' }
    insertChild(targetFolder, removed)
    sortTrackFolderChildren(targetFolder)
    return { ok: true }
  }

  function syncDeletedSegment(seg: AudioSegment): { ok: boolean; reason?: string } {
    return syncDeletedSegments([seg])
  }

  function syncDeletedTrack(trackId: string): { ok: boolean; reason?: string } {
    const trackFolderId = `node:trackFolder:${trackId}`
    const trackFolder = index.value.nodes[trackFolderId]
    if (!trackFolder || trackFolder.kind !== 'trackFolder') return { ok: false, reason: '对象树中没有对应 TrackFolder' }
    return syncDeletedSegments(trackFolder.children.map(child => child.legacy?.segmentId).filter((id): id is string => Boolean(id)), trackId)
  }

  function syncDeletedSegments(segmentsOrIds: Array<AudioSegment | string>, trackId?: string): { ok: boolean; reason?: string } {
    for (const item of segmentsOrIds) {
      const segmentId = typeof item === 'string' ? item : item.id
      const trackObjectId = `node:trackObject:${segmentId}`
      const trackObject = index.value.nodes[trackObjectId]
      if (!trackObject || trackObject.kind !== 'trackObject') continue
      const sourceId = trackObject.trackObject.sourceObjectId
      const source = index.value.nodes[sourceId]
      if (source?.kind === 'audio') deleteStaleAssetForSource(source)
      removeNode(tree.value.root, trackObjectId)
      removeNode(tree.value.root, sourceId)
      removeTrackObjectFromGroups(trackObjectId)
    }

    if (trackId) removeNode(tree.value.root, `node:trackFolder:${trackId}`)
    pruneEmptyGroups()
    return { ok: true }
  }

  function syncMergedSegments(oldSegments: AudioSegment[], newSegment: AudioSegment): { ok: boolean; reason?: string } {
    if (oldSegments.length === 0) return { ok: false, reason: '没有可合并的旧片段' }
    const currentIndex = index.value
    const firstOldTrackObject = currentIndex.nodes[`node:trackObject:${oldSegments[0].id}`]
    if (!firstOldTrackObject || firstOldTrackObject.kind !== 'trackObject') return { ok: false, reason: '对象树中没有旧 TrackObject' }
    const firstOldSource = currentIndex.nodes[firstOldTrackObject.trackObject.sourceObjectId]
    if (!firstOldSource || firstOldSource.kind !== 'audio') return { ok: false, reason: '对象树中没有旧源对象' }
    const sourceLocation = findNodeLocation(tree.value.root, firstOldSource.id)
    const trackLocation = findNodeLocation(tree.value.root, firstOldTrackObject.id)
    if (!sourceLocation || !trackLocation) return { ok: false, reason: '对象树位置缺失' }

    const oldTrackObjectIds = oldSegments.map(seg => `node:trackObject:${seg.id}`)
    const partialGroup = findPartiallyContainingGroup(oldTrackObjectIds)
    if (partialGroup) return { ok: false, reason: `Group ${partialGroup} 只包含部分合并对象` }

    const sourceObjectId = `node:trackSource:audio:${newSegment.id}`
    const assetId = `asset:trackSource:${newSegment.id}`
    tree.value.assets[assetId] = {
      id: assetId,
      storage: 'projectBlob',
      blobKey: newSegment.sourceFile,
      sampleRate: inferSampleRate(newSegment),
      duration: Math.max(0.001, newSegment.timelineEnd - newSegment.timelineStart),
      channels: 1,
    }
    const sourceName = `${firstOldSource.name}-${newSegment.id}`
    const newSource: AudioObjectNode = {
      id: sourceObjectId,
      kind: 'audio',
      name: sourceName,
      audio: {
        assetId,
        midiObjectId: firstOldSource.audio.midiObjectId,
        textObjectId: firstOldSource.audio.textObjectId,
      },
      legacy: { segmentId: newSegment.id, trackId: newSegment.trackId },
    }
    const newTrackObject: TrackObjectNode = {
      id: `node:trackObject:${newSegment.id}`,
      kind: 'trackObject',
      name: sourceName,
      trackObject: {
        contentType: 'audio',
        sourceObjectId,
        timelineStart: newSegment.timelineStart,
        timelineEnd: newSegment.timelineEnd,
        ignored: newSegment.ignored,
      },
      legacy: { segmentId: newSegment.id, trackId: newSegment.trackId },
    }

    const oldSourceIds: string[] = []
    for (const seg of oldSegments) {
      const oldTrackObject = index.value.nodes[`node:trackObject:${seg.id}`]
      if (oldTrackObject?.kind === 'trackObject') oldSourceIds.push(oldTrackObject.trackObject.sourceObjectId)
    }
    for (const id of oldTrackObjectIds) removeNode(tree.value.root, id)
    for (const id of oldSourceIds) {
      const source = index.value.nodes[id]
      if (source?.kind === 'audio') deleteStaleAssetForSource(source)
      removeNode(tree.value.root, id)
    }

    insertChild(sourceLocation.parent, newSource, sourceLocation.index)
    const targetTrackFolder = index.value.nodes[`node:trackFolder:${newSegment.trackId}`]
    const trackParent = targetTrackFolder?.kind === 'trackFolder' ? targetTrackFolder : trackLocation.parent
    insertChild(trackParent, newTrackObject, trackLocation.index)
    if (trackParent.kind === 'trackFolder') sortTrackFolderChildren(trackParent)
    replaceTrackObjectsInGroups(oldTrackObjectIds, [newTrackObject.id])
    return { ok: true }
  }

  function syncSplitSegment(oldSegment: AudioSegment, newSegments: [AudioSegment, AudioSegment]): { ok: boolean; reason?: string; snapshot?: SplitSegmentObjectTreeSnapshot } {
    const oldTrackObjectId = `node:trackObject:${oldSegment.id}`
    const oldTrackObject = index.value.nodes[oldTrackObjectId]
    if (!oldTrackObject || oldTrackObject.kind !== 'trackObject') return { ok: false, reason: '对象树中没有对应 TrackObject' }
    const oldSourceId = oldTrackObject.trackObject.sourceObjectId
    const oldSource = index.value.nodes[oldSourceId]
    if (!oldSource || oldSource.kind !== 'audio') return { ok: false, reason: '对象树中没有对应源对象' }
    const oldTrackLocation = findNodeLocation(tree.value.root, oldTrackObjectId)
    const oldSourceLocation = findNodeLocation(tree.value.root, oldSourceId)
    if (!oldTrackLocation || !oldSourceLocation) return { ok: false, reason: '对象树位置缺失' }
    const oldAsset = tree.value.assets[oldSource.audio.assetId]
    const groupSnapshot = snapshotGroups()

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
    replaceTrackObjectsInGroups([oldTrackObjectId], newTrackObjects.map(node => node.id))
    deleteStaleAssetForSource(oldSource)
    return {
      ok: true,
      snapshot: {
        oldTrackObject: clonePlain(oldTrackObject),
        oldSource: clonePlain(oldSource),
        oldAsset: oldAsset ? clonePlain(oldAsset) : undefined,
        oldTrackParentId: oldTrackLocation.parent.id,
        oldTrackIndex: oldTrackLocation.index,
        oldSourceParentId: oldSourceLocation.parent.id,
        oldSourceIndex: oldSourceLocation.index,
        newTrackObjectIds: [newTrackObjects[0].id, newTrackObjects[1].id],
        newSourceIds: [newSources[0].id, newSources[1].id],
        newAssetIds: [newSources[0].audio.assetId, newSources[1].audio.assetId],
        groups: groupSnapshot,
      },
    }
  }

  function addRenderedTextToTimeline(options: {
    outputName: string
    renderKind: 'whisper'
    segments: TextSegment[]
    sourceAudioObjectId?: NodeId | null
    timelineStart?: number
    timelineEnd?: number
  }): {
    ok: boolean
    reason?: string
    renderObjectId?: NodeId
    trackSourceObjectId?: NodeId
    trackObjectId?: NodeId
    outputName?: string
  } {
    const timelineStart = options.timelineStart ?? 0
    const normalizedSegments = normalizeTextSegments(options.segments)
    const durationFromSegments = Math.max(0, ...normalizedSegments.map(segment => segment.end ?? segment.start))
    const timelineEnd = Math.max(options.timelineEnd ?? timelineStart + Math.max(1, durationFromSegments), timelineStart + 0.001)
    const renderFolder = getOrCreateChildFolder(TOP_LEVEL_IDS.renders, options.renderKind)
    const outputName = uniqueChildName(renderFolder, sanitizeFileName(options.outputName) || 'whisper_text')

    const renderObjectId = `node:render:${options.renderKind}:text:${crypto.randomUUID()}`
    const renderObject = {
      id: renderObjectId,
      kind: 'text' as const,
      name: outputName,
      text: {
        sourceAudioObjectId: options.sourceAudioObjectId ?? null,
        segments: clonePlain(normalizedSegments),
      },
    }
    insertChild(renderFolder, renderObject)

    const trackSourceObjectId = `node:trackSource:text:${crypto.randomUUID()}`
    const trackSourceObject = {
      id: trackSourceObjectId,
      kind: 'text' as const,
      name: outputName,
      text: {
        sourceAudioObjectId: options.sourceAudioObjectId ?? null,
        segments: clonePlain(normalizedSegments),
      },
    }
    insertChild(getOrCreateChildFolder(TOP_LEVEL_IDS.trackSources, 'text'), trackSourceObject)

    const tracksStore = useTracksStore()
    const trackId = tracksStore.addObjectTrack('text', outputName)
    const trackObjectId = `node:trackObject:text:${crypto.randomUUID()}`
    const trackFolder = createObjectTrackFolder('text', outputName, trackId)
    insertChild(trackFolder, {
      id: trackObjectId,
      kind: 'trackObject',
      name: outputName,
      trackObject: {
        contentType: 'text',
        sourceObjectId: trackSourceObjectId,
        timelineStart,
        timelineEnd,
        ignored: false,
      },
    })

    return {
      ok: true,
      renderObjectId,
      trackSourceObjectId,
      trackObjectId,
      outputName,
    }
  }

  function syncUndoSplitSegment(snapshot: SplitSegmentObjectTreeSnapshot): { ok: boolean; reason?: string } {
    for (const id of snapshot.newTrackObjectIds) removeNode(tree.value.root, id)
    for (const id of snapshot.newSourceIds) removeNode(tree.value.root, id)
    for (const id of snapshot.newAssetIds) delete tree.value.assets[id]

    const currentIndex = buildNodeIndex(tree.value.root)
    const trackParent = currentIndex.nodes[snapshot.oldTrackParentId]
    const sourceParent = currentIndex.nodes[snapshot.oldSourceParentId]
    if (!trackParent || (trackParent.kind !== 'folder' && trackParent.kind !== 'trackFolder')) return { ok: false, reason: '旧 TrackObject 父节点不存在' }
    if (!sourceParent || (sourceParent.kind !== 'folder' && sourceParent.kind !== 'trackFolder')) return { ok: false, reason: '旧源对象父节点不存在' }

    if (snapshot.oldAsset) tree.value.assets[snapshot.oldAsset.id] = clonePlain(snapshot.oldAsset)
    insertChild(trackParent, clonePlain(snapshot.oldTrackObject), snapshot.oldTrackIndex)
    insertChild(sourceParent, clonePlain(snapshot.oldSource), snapshot.oldSourceIndex)
    restoreGroups(snapshot.groups)
    return { ok: true }
  }

  function updateTextSegmentTiming(sourceObjectId: NodeId, segmentId: string, start: number, end: number): { ok: boolean; reason?: string } {
    const source = index.value.nodes[sourceObjectId]
    if (!source || source.kind !== 'text') return { ok: false, reason: 'TextObject 不存在' }
    const segment = source.text.segments.find(item => item.id === segmentId)
    if (!segment) return { ok: false, reason: '句子不存在' }
    segment.start = Math.max(0, start)
    segment.end = Math.max(segment.start + 0.1, end)
    source.text.segments.sort((a, b) => a.start - b.start)
    markTextEdited(sourceObjectId)
    return { ok: true }
  }

  function setSynthesisHTokenAtFrame(
    unitId: NodeId,
    frame: number,
    token: { tokenId: number; symbol?: string } | null,
  ): { ok: boolean; reason?: string } {
    const unit = index.value.nodes[unitId]
    if (!unit || unit.kind !== 'synthesisUnit') return { ok: false, reason: '合成单元不存在' }
    try {
      applyReplaceHTokenTrackRange(unit, {
        operation: token ? 'replace H token' : 'clear H event',
        origin: 'user',
        startFrame: frame,
        endFrameExclusive: frame + 1,
        events: token ? [{
          id: `h:${crypto.randomUUID()}`,
          frame,
          tokenId: token.tokenId,
          symbol: token.symbol,
          origin: 'user',
        }] : [],
      })
      return { ok: true }
    } catch (error: any) {
      return { ok: false, reason: error?.message || 'H Token 修改失败' }
    }
  }

  function replaceSynthesisSegmentTrack(
    unitId: NodeId,
    items: SynthesisSegmentObject[],
    operation = 'Guide -> Whisper + SOFA -> SegmentTrack',
  ): { ok: boolean; reason?: string } {
    const unit = index.value.nodes[unitId]
    if (!unit || unit.kind !== 'synthesisUnit') return { ok: false, reason: '合成单元不存在' }
    try {
      applyReplaceSegmentTrack(unit, {
        operation,
        origin: 'whisper-sofa',
        items,
        sourceRefs: [{ unitId, guideSHA256: unit.synthesisUnit.guide.audioSHA256 }],
      })
      return { ok: true }
    } catch (error: any) {
      return { ok: false, reason: error?.message || 'SegmentTrack 替换失败' }
    }
  }

  function replaceSynthesisKanaTrackRange(
    unitId: NodeId,
    startFrame: number,
    endFrameExclusive: number,
    units: SynthesisKanaUnit[],
    boundaries: SynthesisKanaSegmentBoundary[],
    boundaryEndFrameExclusive = endFrameExclusive,
    operation = 'Segment -> Kana',
  ): { ok: boolean; reason?: string } {
    const unit = index.value.nodes[unitId]
    if (!unit || unit.kind !== 'synthesisUnit') return { ok: false, reason: '合成单元不存在' }
    try {
      applyReplaceKanaTrackRange(unit, {
        operation,
        origin: 'alignment',
        startFrame,
        endFrameExclusive,
        units,
        boundaries,
        boundaryEndFrameExclusive,
        sourceRefs: [{
          unitId,
          track: 'segment',
          revision: unit.synthesisUnit.segmentTrack.revision,
          guideSHA256: unit.synthesisUnit.guide.audioSHA256,
        }],
      })
      return { ok: true }
    } catch (error: any) {
      return { ok: false, reason: error?.message || 'KanaTrack 替换失败' }
    }
  }

  function replaceSynthesisHTokenTrackRange(
    unitId: NodeId,
    startFrame: number,
    endFrameExclusive: number,
    events: SynthesisHTokenEvent[],
    vocabHash?: string,
    compilerHash?: string,
    operation = 'Segment -> H',
    sourceTrack: 'segment' | 'kana' = 'segment',
    placementRanges?: SynthesisHPlacementRange[],
  ): { ok: boolean; reason?: string } {
    const unit = index.value.nodes[unitId]
    if (!unit || unit.kind !== 'synthesisUnit') return { ok: false, reason: '合成单元不存在' }
    try {
      applyReplaceHTokenTrackRange(unit, {
        operation,
        origin: 'alignment',
        startFrame,
        endFrameExclusive,
        events,
        placementRanges,
        vocabHash,
        compilerHash,
        sourceRefs: [{
          unitId,
          track: sourceTrack,
          revision: sourceTrack === 'kana'
            ? unit.synthesisUnit.kanaTrack.revision
            : unit.synthesisUnit.segmentTrack.revision,
          guideSHA256: unit.synthesisUnit.guide.audioSHA256,
        }],
      })
      return { ok: true }
    } catch (error: any) {
      return { ok: false, reason: error?.message || 'HTokenTrack 替换失败' }
    }
  }

  function updateSynthesisSegment(
    unitId: NodeId,
    segmentId: string,
    patch: Partial<Pick<SynthesisSegmentObject, 'text' | 'kana' | 'romaji' | 'startFrame' | 'speechEndFrameExclusive'>>,
    operation = 'edit Segment',
  ): { ok: boolean; reason?: string } {
    const unit = index.value.nodes[unitId]
    if (!unit || unit.kind !== 'synthesisUnit') return { ok: false, reason: '合成单元不存在' }
    try {
      applyUpdateSegmentObject(unit, { segmentId, patch, operation })
      return { ok: true }
    } catch (error: any) {
      return { ok: false, reason: error?.message || 'Segment 修改失败' }
    }
  }

  function updateSynthesisKana(
    unitId: NodeId,
    kanaUnitId: string,
    patch: Partial<Pick<SynthesisKanaUnit, 'kana' | 'romaji'>>,
  ): { ok: boolean; reason?: string } {
    const unit = index.value.nodes[unitId]
    if (!unit || unit.kind !== 'synthesisUnit') return { ok: false, reason: '合成单元不存在' }
    try {
      applyUpdateKanaUnit(unit, { unitId: kanaUnitId, patch })
      return { ok: true }
    } catch (error: any) {
      return { ok: false, reason: error?.message || 'Kana 修改失败' }
    }
  }

  function moveSynthesisKanaSharedBoundary(
    unitId: NodeId,
    leftUnitId: string,
    rightUnitId: string,
    targetFrame: number,
  ): { ok: boolean; reason?: string } {
    const unit = index.value.nodes[unitId]
    if (!unit || unit.kind !== 'synthesisUnit') return { ok: false, reason: '合成单元不存在' }
    try {
      applyMoveKanaSharedBoundary(unit, { leftUnitId, rightUnitId, targetFrame })
      return { ok: true }
    } catch (error: any) {
      return { ok: false, reason: error?.message || 'Kana 边界修改失败' }
    }
  }

  function moveSynthesisHToken(
    unitId: NodeId,
    eventId: string,
    targetFrame: number,
    forceReplace = false,
  ): { ok: boolean; reason?: string } {
    const unit = index.value.nodes[unitId]
    if (!unit || unit.kind !== 'synthesisUnit') return { ok: false, reason: '合成单元不存在' }
    try {
      applyMoveHTokenEvent(unit, { eventId, targetFrame, forceReplace })
      return { ok: true }
    } catch (error: any) {
      return { ok: false, reason: error?.message || 'H Token 移动失败' }
    }
  }

  function setSynthesisMidiPFrame(
    unitId: NodeId,
    frame: number,
    midiClass: number,
  ): { ok: boolean; reason?: string } {
    const unit = index.value.nodes[unitId]
    if (!unit || unit.kind !== 'synthesisUnit') return { ok: false, reason: '合成单元不存在' }
    try {
      applyReplaceMidiPFrame(unit, { frame, midiClass })
      return { ok: true }
    } catch (error: any) {
      return { ok: false, reason: error?.message || 'MIDI-P 修改失败' }
    }
  }

  function moveSynthesisMidiPFrame(
    unitId: NodeId,
    sourceFrame: number,
    targetFrame: number,
    targetClass: number,
    forceReplace = false,
  ): { ok: boolean; reason?: string } {
    const unit = index.value.nodes[unitId]
    if (!unit || unit.kind !== 'synthesisUnit') return { ok: false, reason: '合成单元不存在' }
    try {
      applyMoveMidiPFrame(unit, {
        sourceFrame,
        targetFrame,
        targetClass,
        forceReplace,
      })
      return { ok: true }
    } catch (error: any) {
      return { ok: false, reason: error?.message || 'MIDI-P 移动失败' }
    }
  }

  function replaceSynthesisMidiPTrack(
    unitId: NodeId,
    classes: number[],
    gameModelHash?: string,
    compilerHash?: string,
    operation = 'Guide -> GAME K=4 -> MIDI-P',
  ): { ok: boolean; reason?: string } {
    const unit = index.value.nodes[unitId]
    if (!unit || unit.kind !== 'synthesisUnit') return { ok: false, reason: '合成单元不存在' }
    try {
      applyReplaceMidiPTrack(unit, {
        operation,
        origin: 'game',
        classes,
        gameModelHash,
        compilerHash,
        sourceRefs: [{ unitId, guideSHA256: unit.synthesisUnit.guide.audioSHA256 }],
      })
      return { ok: true }
    } catch (error: any) {
      return { ok: false, reason: error?.message || 'MIDI-P Track 替换失败' }
    }
  }

  function updateTextSegmentContent(sourceObjectId: NodeId, segmentId: string, patch: Partial<Pick<TextSegment, 'kana' | 'romaji'>>): { ok: boolean; reason?: string } {
    const source = index.value.nodes[sourceObjectId]
    if (!source || source.kind !== 'text') return { ok: false, reason: 'TextObject 不存在' }
    const segment = source.text.segments.find(item => item.id === segmentId)
    if (!segment) return { ok: false, reason: '句子不存在' }
    if (patch.kana !== undefined) segment.kana = patch.kana
    if (patch.romaji !== undefined) segment.romaji = patch.romaji
    markTextEdited(sourceObjectId)
    return { ok: true }
  }

  function addTextSegment(sourceObjectId: NodeId, segment: TextSegment): { ok: boolean; reason?: string; segmentId?: string } {
    const source = index.value.nodes[sourceObjectId]
    if (!source || source.kind !== 'text') return { ok: false, reason: 'TextObject 不存在' }
    const next = clonePlain(segment)
    next.id ||= `textseg:${crypto.randomUUID()}`
    if (source.text.segments.some(item => item.id === next.id)) return { ok: false, reason: '句子 ID 已存在' }
    source.text.segments.push(next)
    source.text.segments.sort((a, b) => a.start - b.start)
    markTextEdited(sourceObjectId)
    return { ok: true, segmentId: next.id }
  }

  function deleteTextSegment(sourceObjectId: NodeId, segmentId: string): { ok: boolean; reason?: string } {
    const source = index.value.nodes[sourceObjectId]
    if (!source || source.kind !== 'text') return { ok: false, reason: 'TextObject 不存在' }
    const indexToDelete = source.text.segments.findIndex(item => item.id === segmentId)
    if (indexToDelete < 0) return { ok: false, reason: '句子不存在' }
    source.text.segments.splice(indexToDelete, 1)
    markTextEdited(sourceObjectId)
    return { ok: true }
  }

  function markTextEdited(sourceObjectId: NodeId) {
    textEditRevision.value++
    textEditRevisionBySource[sourceObjectId] = (textEditRevisionBySource[sourceObjectId] ?? 0) + 1
  }

  function textRevision(sourceObjectId: NodeId): number {
    return textEditRevisionBySource[sourceObjectId] ?? 0
  }

  function snapshotGroups() {
    return collectGroups().map(group => ({
      groupId: group.id,
      trackObjectIds: [...group.group.trackObjectIds],
    }))
  }

  function restoreGroups(snapshots: Array<{ groupId: NodeId; trackObjectIds: NodeId[] }>) {
    const byId = new Map(snapshots.map(snapshot => [snapshot.groupId, snapshot.trackObjectIds]))
    for (const group of collectGroups()) {
      const ids = byId.get(group.id)
      if (ids) group.group.trackObjectIds = [...ids]
    }
  }

  function removeTrackObjectFromGroups(trackObjectId: NodeId) {
    for (const group of collectGroups()) {
      group.group.trackObjectIds = group.group.trackObjectIds.filter(id => id !== trackObjectId)
    }
  }

  function replaceTrackObjectsInGroups(oldIds: NodeId[], newIds: NodeId[]) {
    const oldSet = new Set(oldIds)
    for (const group of collectGroups()) {
      const next: NodeId[] = []
      let inserted = false
      for (const id of group.group.trackObjectIds) {
        if (!oldSet.has(id)) {
          next.push(id)
          continue
        }
        if (!inserted) {
          next.push(...newIds)
          inserted = true
        }
      }
      group.group.trackObjectIds = [...new Set(next)]
    }
  }

  function findPartiallyContainingGroup(oldIds: NodeId[]): NodeId | null {
    const oldSet = new Set(oldIds)
    for (const group of collectGroups()) {
      const contained = group.group.trackObjectIds.filter(id => oldSet.has(id)).length
      if (contained > 0 && contained < oldSet.size) return group.id
    }
    return null
  }

  function pruneEmptyGroups() {
    for (const group of collectGroups()) {
      if (group.group.trackObjectIds.length === 0) deleteGroupObjectFromObjectTree(group)
    }
  }

  function removeLegacySegmentFromCompGroups(segmentId: string | null) {
    if (!segmentId) return
    const compGroupsStore = useCompGroupsStore()
    for (const group of Object.values(compGroupsStore.compGroups)) {
      group.elements = group.elements.filter(element => !(element.type === 'segment' && element.id === segmentId))
    }
  }

  function removeLegacyTrackFromCompGroups(trackId: string | null) {
    if (!trackId) return
    const compGroupsStore = useCompGroupsStore()
    for (const group of Object.values(compGroupsStore.compGroups)) {
      group.elements = group.elements.filter(element => !(element.type === 'track' && element.id === trackId))
    }
  }

  function collectTrackObjects() {
    const trackObjects: TrackObjectNode[] = []
    function visit(node: TreeNode) {
      if (node.kind === 'trackObject') trackObjects.push(node)
      if (node.kind === 'folder' || node.kind === 'trackFolder') node.children.forEach(visit)
    }
    visit(tree.value.root)
    return trackObjects
  }

  function collectGroups() {
    const groups: Extract<TreeNode, { kind: 'group' }>[] = []
    function visit(node: TreeNode) {
      if (node.kind === 'group') groups.push(node)
      if (node.kind === 'folder' || node.kind === 'trackFolder') node.children.forEach(visit)
    }
    visit(tree.value.root)
    return groups
  }

  function sortTrackFolderChildren(trackFolder: TrackFolderNode) {
    trackFolder.children.sort((a, b) => {
      const byStart = a.trackObject.timelineStart - b.trackObject.timelineStart
      return byStart !== 0 ? byStart : a.id.localeCompare(b.id)
    })
  }

  function normalizeTextSegments(segments: TextSegment[]): TextSegment[] {
    const sorted = clonePlain(segments)
      .map((segment, index) => ({
        ...segment,
        id: segment.id || `textseg:${crypto.randomUUID()}`,
        start: Math.max(0, Number.isFinite(segment.start) ? segment.start : index),
      }))
      .sort((a, b) => a.start - b.start)

    return sorted.map((segment, index) => {
      const nextStart = sorted[index + 1]?.start
      const preferredEnd = segment.end ?? nextStart ?? segment.start + 1
      return {
        ...segment,
        end: Math.max(segment.start + 0.1, preferredEnd),
      }
    })
  }

  function clonePlain<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
  }

  function inferSampleRate(seg: AudioSegment): number {
    const length = Math.max(1, seg.srcEndSample - seg.srcStartSample)
    const duration = Math.max(0.001, seg.timelineEnd - seg.timelineStart)
    return Math.round(length / duration)
  }

  function deleteStaleAssetForSource(source: AudioObjectNode) {
    delete tree.value.assets[source.audio.assetId]
  }

  function deleteAudioAssetAndBlob(source: AudioObjectNode) {
    deleteAssetAndBlob(source.audio.assetId)
  }

  function deleteAssetAndBlob(assetId: string) {
    const blobKey = tree.value.assets[assetId]?.blobKey
    if (blobKey) useTracksStore().sourceBlobs.delete(blobKey)
    delete tree.value.assets[assetId]
  }

  function segmentIdFromTrackObjectId(trackObjectId: NodeId): string | null {
    return trackObjectId.startsWith('node:trackObject:') ? trackObjectId.slice('node:trackObject:'.length) : null
  }

  function trackIdFromTrackFolderId(trackFolderId: NodeId): string | null {
    return trackFolderId.startsWith('node:trackFolder:') ? trackFolderId.slice('node:trackFolder:'.length) : null
  }

  function findParentTrackId(trackObjectId: NodeId): string | null {
    const parentId = buildNodeIndex(tree.value.root).parentById[trackObjectId]
    return parentId ? trackIdFromTrackFolderId(parentId) : null
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

  function getOrCreateTrackFolderForLegacyTrack(trackId: string): TrackFolderNode | null {
    const existing = buildNodeIndex(tree.value.root).nodes[`node:trackFolder:${trackId}`]
    if (existing?.kind === 'trackFolder') return existing
    const tracksStore = useTracksStore()
    const track = tracksStore.tracks[trackId]
    if (!track) return null
    const folder: TrackFolderNode = {
      id: `node:trackFolder:${trackId}`,
      kind: 'trackFolder',
      name: track.name,
      trackFolder: {
        trackType: 'audio',
        color: track.color,
        muted: track.muted,
        solo: track.solo,
        volume: track.volume,
      },
      children: [],
      legacy: { trackId },
    }
    insertIntoFirstFolder(TOP_LEVEL_IDS.tracks, folder)
    return folder
  }

  function createObjectTrackFolder(trackType: TrackObjectContentType, name: string, trackId?: string): TrackFolderNode {
    const folder: TrackFolderNode = {
      id: trackId ? `node:trackFolder:${trackId}` : `node:trackFolder:${trackType}:${crypto.randomUUID()}`,
      kind: 'trackFolder',
      name,
      trackFolder: {
        trackType,
        color: trackId ? useTracksStore().tracks[trackId]?.color : undefined,
        muted: false,
        solo: false,
        volume: 1,
      },
      children: [],
      legacy: trackId ? { trackId } : undefined,
    }
    insertIntoFirstFolder(TOP_LEVEL_IDS.tracks, folder)
    return folder
  }

  return {
    tree,
    legacyWarnings,
    legacyMaps,
    textEditRevision,
    textRevision,
    index,
    createEmpty,
    loadFromLegacyProject,
    loadObjectTree,
    snapshotTree,
    restoreTree,
    node,
    parent,
    isDescendant,
    moveNode,
    createFolder,
    renameNode,
    deleteNode,
    importFilesToFolder,
    createSynthesisUnitFromAudioObject,
    canBindSynthesisReferenceUnit,
    bindSynthesisReferenceUnit,
    unbindSynthesisReferenceUnit,
    queueSynthesisTake,
    completeSynthesisTake,
    failSynthesisTake,
    setActiveSynthesisTake,
    dropAudioObjectToTimeline,
    addRenderedAudioToTimeline,
    addRenderedTextToTimeline,
    syncPastedTrack,
    syncTrackFolderName,
    syncTrackFolderColor,
    syncTrackFolderOrder,
    createGroupFromLegacyElements,
    syncMovedSegments,
    syncMovedSegment,
    syncDeletedSegment,
    syncDeletedTrack,
    syncDeletedSegments,
    syncMergedSegments,
    syncSplitSegment,
    syncUndoSplitSegment,
    updateTextSegmentTiming,
    updateTextSegmentContent,
    addTextSegment,
    deleteTextSegment,
    setSynthesisHTokenAtFrame,
    replaceSynthesisSegmentTrack,
    replaceSynthesisKanaTrackRange,
    replaceSynthesisHTokenTrackRange,
    updateSynthesisSegment,
    updateSynthesisKana,
    moveSynthesisKanaSharedBoundary,
    moveSynthesisHToken,
    setSynthesisMidiPFrame,
    moveSynthesisMidiPFrame,
    replaceSynthesisMidiPTrack,
  }
})

function ensureWavFileName(name: string): string {
  const clean = sanitizeFileName(name) || 'SVC_output'
  return /\.wav$/i.test(clean) ? clean : `${clean}.wav`
}

function synthesisUnitName(sourceName: string): string {
  const base = sourceName.replace(/\.[^.\\/]+$/, '').trim()
  return `${base || 'Guide'} - 合成单元`
}

async function sha256Blob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
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

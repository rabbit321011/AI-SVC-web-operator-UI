import type { NodeId, RuntimeTreeIndex, TreeNode } from './types'
import { isDescendantOf, TOP_LEVEL_IDS } from './objectTree'

export type ProjectArea = 'workspace' | 'resource' | 'trackSources' | 'tracks' | 'groups' | 'renders' | 'root' | 'unknown'
export type TreeTransferAction = 'move' | 'copy'

export interface TreePolicyResult {
  ok: boolean
  reason?: string
}

export function getProjectArea(index: RuntimeTreeIndex, id: NodeId): ProjectArea {
  if (id === TOP_LEVEL_IDS.root) return 'root'
  for (const [area, areaId] of Object.entries({
    workspace: TOP_LEVEL_IDS.workspace,
    resource: TOP_LEVEL_IDS.resource,
    trackSources: TOP_LEVEL_IDS.trackSources,
    tracks: TOP_LEVEL_IDS.tracks,
    groups: TOP_LEVEL_IDS.groups,
    renders: TOP_LEVEL_IDS.renders,
  }) as Array<[ProjectArea, NodeId]>) {
    if (id === areaId || isDescendantOf(index, id, areaId)) return area
  }
  return 'unknown'
}

export function canSelectTreeNode(node: TreeNode): boolean {
  return node.kind !== 'folder'
}

export function canDropIntoRenderSlot(node: TreeNode): TreePolicyResult {
  if (node.kind === 'trackObject' || node.kind === 'group') return { ok: true }
  return { ok: false, reason: '右侧槽位只接受 TrackObject 或 GroupObject' }
}

export function canDragIntoTimeline(node: TreeNode, index: RuntimeTreeIndex): TreePolicyResult {
  const area = getProjectArea(index, node.id)
  if (node.kind === 'group') return { ok: false, reason: 'GroupObject 不能拖入中间时间线' }
  if (node.kind === 'synthesisUnit') {
    return area === 'workspace' || area === 'resource'
      ? { ok: true }
      : { ok: false, reason: '只有 Workspace/Resource 中的合成单元可拖入时间线' }
  }
  if (node.kind === 'folder' || node.kind === 'trackFolder' || node.kind === 'trackObject') {
    return { ok: false, reason: '该节点不能作为普通素材拖入时间线' }
  }
  if (area === 'workspace' || area === 'resource' || area === 'renders') return { ok: true }
  return { ok: false, reason: '只有 workspace/resource/renders 内的普通素材可拖入时间线' }
}

export function canTransferTreeNode(
  index: RuntimeTreeIndex,
  node: TreeNode,
  targetParent: TreeNode,
  action: TreeTransferAction,
): TreePolicyResult {
  if (!isContainer(targetParent)) return { ok: false, reason: '目标不是文件夹' }

  const sourceArea = getProjectArea(index, node.id)
  const targetArea = getProjectArea(index, targetParent.id)

  if (sourceArea === 'trackSources') {
    return targetArea === 'trackSources'
      ? { ok: true }
      : { ok: false, reason: 'trackSources 对象不能移动或复制到外部' }
  }

  if (targetArea === 'trackSources') {
    return { ok: false, reason: '外部对象不能手动复制或移动进 trackSources' }
  }

  if (sourceArea === 'groups' || node.kind === 'group') {
    return targetArea === 'groups'
      ? { ok: true }
      : { ok: false, reason: 'GroupObject 只能留在 groups 内' }
  }

  if (targetArea === 'groups') {
    return node.kind === 'folder'
      ? { ok: true }
      : { ok: false, reason: 'groups 只允许 GroupObject 和 folder' }
  }

  if (targetArea === 'renders') {
    return { ok: false, reason: 'renders 只接收模型输出，不能手动放入对象' }
  }

  if (node.kind === 'trackObject') {
    const source = index.nodes[node.trackObject.sourceObjectId]
    if (source?.kind === 'audio' || source?.kind === 'synthesisUnit') {
      if (action === 'copy' && (targetArea === 'workspace' || targetArea === 'resource')) return { ok: true }
      if (targetParent.kind === 'trackFolder' && targetParent.trackFolder.trackType === 'audio') return { ok: true }
    }
  }

  if (sourceArea === 'renders') {
    return targetArea === 'workspace' || targetArea === 'resource'
      ? { ok: true }
      : { ok: false, reason: 'renders 对象只允许移动或复制到 workspace/resource' }
  }

  if (sourceArea === 'workspace' || sourceArea === 'resource') {
    return targetArea === 'workspace' || targetArea === 'resource'
      ? { ok: true }
      : { ok: false, reason: 'workspace/resource 普通素材只能互相移动或复制' }
  }

  if (sourceArea === 'tracks' || node.kind === 'trackObject' || node.kind === 'trackFolder') {
    return validateTracksTransfer(node, targetParent, action)
  }

  return { ok: false, reason: '暂不支持该树操作' }
}

export function canCreateFolderIn(index: RuntimeTreeIndex, targetParent: TreeNode): TreePolicyResult {
  if (!isContainer(targetParent)) return { ok: false, reason: '目标不是文件夹' }
  const targetArea = getProjectArea(index, targetParent.id)
  if (targetArea === 'workspace' || targetArea === 'resource' || targetArea === 'trackSources' || targetArea === 'groups') {
    return { ok: true }
  }
  return { ok: false, reason: '该目录不允许手动新建文件夹' }
}

export function canDeleteTreeNode(index: RuntimeTreeIndex, node: TreeNode): TreePolicyResult {
  const area = getProjectArea(index, node.id)
  if (node.id.startsWith('project:/')) return { ok: false, reason: '固定顶层目录不能删除' }
  if (area === 'workspace' || area === 'resource' || area === 'groups' || area === 'renders') return { ok: true }
  if (area === 'trackSources') return { ok: false, reason: 'trackSources 删除需要专用时间线语义命令' }
  if (area === 'tracks') return { ok: false, reason: 'tracks 删除需要专用时间线语义命令' }
  return { ok: false, reason: '该节点不能删除' }
}

export function canImportFilesInto(index: RuntimeTreeIndex, targetParent: TreeNode): TreePolicyResult {
  if (!isContainer(targetParent)) return { ok: false, reason: '目标不是文件夹' }
  const targetArea = getProjectArea(index, targetParent.id)
  if (targetArea === 'workspace' || targetArea === 'resource') return { ok: true }
  return { ok: false, reason: '只能拖入文件到 workspace/resource' }
}

function validateTracksTransfer(node: TreeNode, targetParent: TreeNode, action: TreeTransferAction): TreePolicyResult {
  if (action === 'copy' && node.kind === 'trackObject') {
    return { ok: false, reason: 'TrackObject 复制需要专用语义命令' }
  }

  if (node.kind === 'trackFolder') {
    return targetParent.id === TOP_LEVEL_IDS.tracks
      ? { ok: true }
      : { ok: false, reason: 'TrackFolder 只能位于 tracks 顶层' }
  }

  if (node.kind === 'trackObject') {
    if (targetParent.kind !== 'trackFolder') return { ok: false, reason: 'TrackObject 只能放入 TrackFolder' }
    return targetParent.trackFolder.trackType === node.trackObject.contentType
      ? { ok: true }
      : { ok: false, reason: 'TrackObject 只能移动到同类型 TrackFolder' }
  }

  return { ok: false, reason: 'tracks 只允许 TrackFolder 和 TrackObject' }
}

function isContainer(node: TreeNode): boolean {
  return node.kind === 'folder' || node.kind === 'trackFolder'
}

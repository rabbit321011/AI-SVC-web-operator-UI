import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { AudioAsset, NodeId, TreeNode } from '@/object-workbench'
import { TOP_LEVEL_IDS } from '@/object-workbench'
import { useObjectTreeStore } from './objectTree'
import { useTracksStore } from './tracks'

export const useGlobalResourcesStore = defineStore('globalResources', () => {
  const globalIds = ref<Set<NodeId>>(new Set())

  function isGlobal(nodeId: NodeId): boolean {
    return globalIds.value.has(nodeId)
  }

  function isResourceItem(nodeId: NodeId): boolean {
    if (nodeId === TOP_LEVEL_IDS.resource) return false
    const objectTree = useObjectTreeStore()
    let current = objectTree.index.parentById[nodeId]
    while (current) {
      if (current === TOP_LEVEL_IDS.resource) return true
      current = objectTree.index.parentById[current]
    }
    return false
  }

  function canPublish(node: TreeNode): boolean {
    if (!isResourceItem(node.id)) return false
    return canPublishTreeNode(node)
  }

  async function refresh(): Promise<void> {
    const response = await fetch('/api/global-resources')
    if (!response.ok) throw new Error(await readError(response) || '无法读取全局 Resource')
    const entries = await response.json() as Array<{ id: string }>
    globalIds.value = new Set(entries.map(entry => entry.id))
  }

  async function syncProject(projectName: string): Promise<{ added: string[] }> {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectName)}/resources/sync`, { method: 'POST' })
    if (!response.ok) throw new Error(await readError(response) || '全局 Resource 同步失败')
    const result = await response.json() as { added?: string[]; globalIds?: string[] }
    globalIds.value = new Set(result.globalIds ?? [])
    return { added: result.added ?? [] }
  }

  async function publish(nodeId: NodeId): Promise<void> {
    const objectTree = useObjectTreeStore()
    const tracks = useTracksStore()
    const node = objectTree.node(nodeId)
    if (!node || !canPublish(node)) throw new Error('只支持发布 Resource 中的 AudioObject、SynthesisUnit 或由它们组成的文件夹')
    const assets: Record<string, AudioAsset> = {}
    const blobs = new Map<string, Blob>()
    const ancestors = collectResourceAncestors(node.id, objectTree)
    collectResourcePayload(node, node.id, objectTree.tree.assets, tracks.sourceBlobs, assets, blobs)

    for (const [key, blob] of blobs) {
      const response = await fetch(`/api/global-resources/${encodeURIComponent(node.id)}/blobs`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', 'x-blob-key': encodeURIComponent(key) },
        body: blob,
      })
      if (!response.ok) throw new Error(await readError(response) || `全局 Resource 文件上传失败: ${key}`)
    }
    const response = await fetch(`/api/global-resources/${encodeURIComponent(node.id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node: cloneSerializable(node), ancestors, assets, blobKeys: [...blobs.keys()] }),
    })
    if (!response.ok) throw new Error(await readError(response) || '加入全局 Resource 失败')
    globalIds.value = new Set([...globalIds.value, node.id])
  }

  async function unpublish(nodeId: NodeId): Promise<void> {
    const response = await fetch(`/api/global-resources/${encodeURIComponent(nodeId)}`, { method: 'DELETE' })
    if (!response.ok) throw new Error(await readError(response) || '移出全局 Resource 失败')
    const next = new Set(globalIds.value)
    next.delete(nodeId)
    globalIds.value = next
  }

  async function updatePathsForSubtree(nodeId: NodeId): Promise<void> {
    const objectTree = useObjectTreeStore()
    const root = objectTree.node(nodeId)
    if (!root) return
    const subtreeIds = collectNodeIds(root)
    const affected = [...globalIds.value].filter(id => subtreeIds.has(id) && isResourceItem(id))
    for (const id of affected) {
      const response = await fetch(`/api/global-resources/${encodeURIComponent(id)}/path`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ancestors: collectResourceAncestors(id, objectTree) }),
      })
      if (!response.ok) throw new Error(await readError(response) || '全局 Resource 路径更新失败')
    }
  }

  return { globalIds, isGlobal, isResourceItem, canPublish, refresh, syncProject, publish, unpublish, updatePathsForSubtree }
})

function canPublishTreeNode(node: TreeNode): boolean {
  return node.kind === 'audio'
    || node.kind === 'synthesisUnit'
    || (node.kind === 'folder' && node.children.every(canPublishTreeNode))
}

function collectResourceAncestors(nodeId: NodeId, objectTree: ReturnType<typeof useObjectTreeStore>) {
  const ancestors: Array<{ id: NodeId; kind: 'folder'; name: string; children: [] }> = []
  let parentId = objectTree.index.parentById[nodeId]
  while (parentId && parentId !== TOP_LEVEL_IDS.resource) {
    const parent = objectTree.node(parentId)
    if (!parent || parent.kind !== 'folder') throw new Error('Resource 路径包含无效的父级')
    ancestors.unshift({ id: parent.id, kind: 'folder', name: parent.name, children: [] })
    parentId = objectTree.index.parentById[parentId]
  }
  if (parentId !== TOP_LEVEL_IDS.resource) throw new Error('Resource 不在项目 Resource 目录中')
  return ancestors
}

function collectNodeIds(node: TreeNode, ids = new Set<NodeId>()): Set<NodeId> {
  ids.add(node.id)
  if (node.kind === 'folder') {
    for (const child of node.children) collectNodeIds(child, ids)
  }
  return ids
}

function collectResourcePayload(
  node: TreeNode,
  resourceId: NodeId,
  projectAssets: Record<string, AudioAsset>,
  sourceBlobs: Map<string, Blob>,
  assets: Record<string, AudioAsset>,
  blobs: Map<string, Blob>,
) {
  if (node.kind === 'audio') {
    collectAudioAsset(node.audio.assetId, node.name, resourceId, projectAssets, sourceBlobs, assets, blobs)
    return
  }
  if (node.kind === 'synthesisUnit') {
    collectAudioAsset(
      node.synthesisUnit.guide.assetId,
      `${node.name} / Owned Guide`,
      resourceId,
      projectAssets,
      sourceBlobs,
      assets,
      blobs,
    )
    for (const take of node.synthesisUnit.takes) {
      if (!take.outputAssetId) continue
      collectAudioAsset(
        take.outputAssetId,
        `${node.name} / ${take.name}`,
        resourceId,
        projectAssets,
        sourceBlobs,
        assets,
        blobs,
      )
    }
    return
  }
  if (node.kind === 'folder') {
    for (const child of node.children) collectResourcePayload(child, resourceId, projectAssets, sourceBlobs, assets, blobs)
  }
}

function collectAudioAsset(
  assetId: string,
  label: string,
  resourceId: NodeId,
  projectAssets: Record<string, AudioAsset>,
  sourceBlobs: Map<string, Blob>,
  assets: Record<string, AudioAsset>,
  blobs: Map<string, Blob>,
) {
  const asset = projectAssets[assetId]
  if (!asset) throw new Error(`Resource asset 不存在：${label} (${assetId})`)
  if (!asset.blobKey) throw new Error(`Resource asset 没有 Blob：${label} (${assetId})`)
  const blob = sourceBlobs.get(asset.blobKey)
  if (!blob) throw new Error(`Resource Blob 不存在：${label} (${asset.blobKey})`)
  const globalBlobKey = `global-resource:${resourceId}:${asset.id}:${asset.blobKey}`
  assets[asset.id] = { ...cloneSerializable(asset), storage: 'projectBlob', blobKey: globalBlobKey }
  blobs.set(globalBlobKey, blob)
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json()
    return body.error || body.message || ''
  } catch {
    return response.statusText
  }
}

function cloneSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

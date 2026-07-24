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
    if (!node || !canPublish(node)) throw new Error('第一版只支持发布 Resource 中的音频或纯音频文件夹')
    const assets: Record<string, AudioAsset> = {}
    const blobs = new Map<string, Blob>()
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
      body: JSON.stringify({ node: cloneSerializable(node), assets, blobKeys: [...blobs.keys()] }),
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

  return { globalIds, isGlobal, isResourceItem, canPublish, refresh, syncProject, publish, unpublish }
})

function canPublishTreeNode(node: TreeNode): boolean {
  return node.kind === 'audio' || (node.kind === 'folder' && node.children.every(canPublishTreeNode))
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
    const asset = projectAssets[node.audio.assetId]
    if (!asset) throw new Error(`Resource asset 不存在: ${node.audio.assetId}`)
    if (!asset.blobKey) throw new Error(`Resource 没有 blob: ${node.name}`)
    const blob = sourceBlobs.get(asset.blobKey)
    if (!blob) throw new Error(`Resource blob 不存在: ${node.name}`)
    const globalBlobKey = `global-resource:${resourceId}:${asset.id}:${asset.blobKey}`
    assets[asset.id] = { ...cloneSerializable(asset), storage: 'projectBlob', blobKey: globalBlobKey }
    blobs.set(globalBlobKey, blob)
    return
  }
  if (node.kind === 'folder') {
    for (const child of node.children) collectResourcePayload(child, resourceId, projectAssets, sourceBlobs, assets, blobs)
  }
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

import type {
  AudioObjectNode,
  FolderNode,
  GroupObjectNode,
  NodeId,
  ProjectObjectTree,
  RuntimeTreeIndex,
  TrackObjectContentType,
  TrackObjectNode,
  TreeNode,
} from './types'
import { buildNodeIndex, insertChild, TOP_LEVEL_IDS } from './objectTree'

export interface CreateGroupObjectOptions {
  id: NodeId
  name: string
  trackObjectIds: NodeId[]
  parentFolderId?: NodeId
}

export interface ResolvedRenderMedia {
  mediaType: TrackObjectContentType
  sourceStart: number
  sourceEnd: number
  duration: number
  items: ResolvedRenderItem[]
  warnings: string[]
}

export interface ResolvedRenderItem {
  trackObjectId: NodeId
  sourceObjectId: NodeId
  assetId?: string
  timelineStart: number
  timelineEnd: number
  relativeStart: number
  relativeEnd: number
}

export function createGroupObject(tree: ProjectObjectTree, options: CreateGroupObjectOptions): GroupObjectNode {
  const index = buildNodeIndex(tree.root)
  if (options.trackObjectIds.length === 0) {
    throw new Error('GroupObject requires at least one TrackObject')
  }

  const trackObjects = options.trackObjectIds.map(id => requireTrackObject(index, id))
  const mediaType = trackObjects[0].trackObject.contentType
  if (trackObjects.some(node => node.trackObject.contentType !== mediaType)) {
    throw new Error('GroupObject can only contain TrackObjects with the same content type')
  }

  const group: GroupObjectNode = {
    id: options.id,
    kind: 'group',
    name: options.name,
    group: {
      mediaType,
      trackObjectIds: sortTrackObjectIdsByTimeline(trackObjects),
    },
  }

  const parent = requireFolder(index, options.parentFolderId ?? TOP_LEVEL_IDS.groups)
  insertChild(parent, group)
  return group
}

export function resolveTrackObjectInput(tree: ProjectObjectTree, trackObjectId: NodeId): ResolvedRenderMedia {
  const index = buildNodeIndex(tree.root)
  const trackObject = requireTrackObject(index, trackObjectId)
  return resolveTrackObjects(index, [trackObject])
}

export function resolveGroupObjectInput(tree: ProjectObjectTree, groupObjectId: NodeId): ResolvedRenderMedia {
  const index = buildNodeIndex(tree.root)
  const group = requireGroupObject(index, groupObjectId)
  const trackObjects = group.group.trackObjectIds.map(id => requireTrackObject(index, id))

  if (trackObjects.some(node => node.trackObject.contentType !== group.group.mediaType)) {
    throw new Error(`GroupObject ${groupObjectId} contains a TrackObject with mismatched content type`)
  }

  return resolveTrackObjects(index, trackObjects)
}

export function getGroupTrackObjectIdsSorted(tree: ProjectObjectTree, groupObjectId: NodeId): NodeId[] {
  const index = buildNodeIndex(tree.root)
  const group = requireGroupObject(index, groupObjectId)
  const trackObjects = group.group.trackObjectIds.map(id => requireTrackObject(index, id))
  return sortTrackObjectIdsByTimeline(trackObjects)
}

function resolveTrackObjects(index: RuntimeTreeIndex, trackObjects: TrackObjectNode[]): ResolvedRenderMedia {
  if (trackObjects.length === 0) {
    throw new Error('Cannot resolve empty TrackObject input')
  }

  const mediaType = trackObjects[0].trackObject.contentType
  if (trackObjects.some(node => node.trackObject.contentType !== mediaType)) {
    throw new Error('Cannot resolve mixed TrackObject content types')
  }

  const warnings: string[] = []
  const active = sortTrackObjectsByTimeline(trackObjects).filter(node => {
    if (node.trackObject.ignored) {
      warnings.push(`Ignored TrackObject skipped: ${node.id}`)
      return false
    }
    return true
  })

  if (active.length === 0) {
    throw new Error('No active TrackObjects to resolve')
  }

  const sourceStart = Math.min(...active.map(node => node.trackObject.timelineStart))
  const sourceEnd = Math.max(...active.map(node => node.trackObject.timelineEnd))
  const items = active.map(node => {
    const source = requireSourceObject(index, node.trackObject.sourceObjectId)
    return {
      trackObjectId: node.id,
      sourceObjectId: source.id,
      assetId: source.kind === 'audio' ? source.audio.assetId : undefined,
      timelineStart: node.trackObject.timelineStart,
      timelineEnd: node.trackObject.timelineEnd,
      relativeStart: node.trackObject.timelineStart - sourceStart,
      relativeEnd: node.trackObject.timelineEnd - sourceStart,
    }
  })

  return {
    mediaType,
    sourceStart,
    sourceEnd,
    duration: sourceEnd - sourceStart,
    items,
    warnings,
  }
}

function sortTrackObjectIdsByTimeline(trackObjects: TrackObjectNode[]): NodeId[] {
  return sortTrackObjectsByTimeline(trackObjects).map(node => node.id)
}

function sortTrackObjectsByTimeline(trackObjects: TrackObjectNode[]): TrackObjectNode[] {
  return [...trackObjects].sort((a, b) => {
    const byStart = a.trackObject.timelineStart - b.trackObject.timelineStart
    return byStart !== 0 ? byStart : a.id.localeCompare(b.id)
  })
}

function requireTrackObject(index: RuntimeTreeIndex, id: NodeId): TrackObjectNode {
  const node = index.nodes[id]
  if (!node || node.kind !== 'trackObject') {
    throw new Error(`Expected TrackObject: ${id}`)
  }
  return node
}

function requireGroupObject(index: RuntimeTreeIndex, id: NodeId): GroupObjectNode {
  const node = index.nodes[id]
  if (!node || node.kind !== 'group') {
    throw new Error(`Expected GroupObject: ${id}`)
  }
  return node
}

function requireFolder(index: RuntimeTreeIndex, id: NodeId): FolderNode {
  const node = index.nodes[id]
  if (!node || node.kind !== 'folder') {
    throw new Error(`Expected folder: ${id}`)
  }
  return node
}

function requireSourceObject(index: RuntimeTreeIndex, id: NodeId): AudioObjectNode | Extract<TreeNode, { kind: 'midi' | 'text' }> {
  const node = index.nodes[id]
  if (!node || (node.kind !== 'audio' && node.kind !== 'midi' && node.kind !== 'text')) {
    throw new Error(`Expected media source object: ${id}`)
  }
  return node
}

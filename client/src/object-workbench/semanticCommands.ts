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
import {
  buildNodeIndex,
  findNodeLocation,
  insertChild,
  removeNode,
  replaceNode,
} from './objectTree'

export interface SemanticCommand {
  description: string
  apply(tree: ProjectObjectTree): void
  undo(tree: ProjectObjectTree): void
}

export interface MoveTrackObjectCommandPayload {
  trackObjectId: NodeId
  timelineStart: number
  timelineEnd: number
  targetTrackFolderId?: NodeId
}

export interface SplitTrackObjectCommandPayload {
  oldTrackObjectId: NodeId
  newTrackObjects: [TrackObjectNode, TrackObjectNode]
  newSourceObjects: [AudioObjectNode, AudioObjectNode]
}

export interface MergeTrackObjectsCommandPayload {
  oldTrackObjectIds: NodeId[]
  newTrackObject: TrackObjectNode
  newSourceObject: AudioObjectNode
}

export interface DeleteTrackObjectCommandPayload {
  trackObjectId: NodeId
}

export function buildMoveTrackObjectCommand(payload: MoveTrackObjectCommandPayload): SemanticCommand {
  let before: {
    trackObject: TrackObjectNode
    parentId: NodeId
    index: number
  } | null = null

  return {
    description: `Move TrackObject ${payload.trackObjectId}`,
    apply(tree) {
      const index = buildNodeIndex(tree.root)
      const node = requireTrackObject(index, payload.trackObjectId)
      const location = requireLocation(tree.root, payload.trackObjectId)
      before = {
        trackObject: clone(node),
        parentId: location.parent.id,
        index: location.index,
      }

      if (payload.targetTrackFolderId && payload.targetTrackFolderId !== location.parent.id) {
        const target = requireTrackFolder(index, payload.targetTrackFolderId)
        if (target.trackFolder.trackType !== node.trackObject.contentType) {
          throw new Error(`Cannot move ${node.trackObject.contentType} TrackObject to ${target.trackFolder.trackType} TrackFolder`)
        }
        removeNode(tree.root, payload.trackObjectId)
        insertChild(target, node)
      }

      node.trackObject.timelineStart = payload.timelineStart
      node.trackObject.timelineEnd = payload.timelineEnd
    },
    undo(tree) {
      if (!before) return
      removeNode(tree.root, payload.trackObjectId)
      const index = buildNodeIndex(tree.root)
      const parent = requireTrackFolder(index, before.parentId)
      insertChild(parent, clone(before.trackObject), before.index)
    },
  }
}

export function buildSplitTrackObjectCommand(payload: SplitTrackObjectCommandPayload): SemanticCommand {
  let snapshot: ReplaceSnapshot | null = null

  return {
    description: `Split TrackObject ${payload.oldTrackObjectId}`,
    apply(tree) {
      const index = buildNodeIndex(tree.root)
      const oldTrackObject = requireTrackObject(index, payload.oldTrackObjectId)
      ensureTrackObjectsMatch(oldTrackObject.trackObject.contentType, payload.newTrackObjects)
      snapshot = snapshotTrackObjectWithSource(tree, index, payload.oldTrackObjectId)

      const parent = requireLocation(tree.root, payload.oldTrackObjectId).parent
      if (parent.kind === 'trackFolder') {
        for (const trackObject of payload.newTrackObjects) {
          if (trackObject.trackObject.contentType !== parent.trackFolder.trackType) {
            throw new Error('Split TrackObject content type does not match parent TrackFolder')
          }
        }
      }

      replaceNode(tree.root, payload.oldTrackObjectId, payload.newTrackObjects.map(clone))
      replaceNode(tree.root, oldTrackObject.trackObject.sourceObjectId, payload.newSourceObjects.map(clone))
      replaceTrackObjectIdsInGroups(tree.root, [payload.oldTrackObjectId], payload.newTrackObjects.map(node => node.id))
    },
    undo(tree) {
      if (!snapshot) return
      replaceNode(tree.root, payload.newTrackObjects[0].id, [])
      removeNode(tree.root, payload.newTrackObjects[1].id)
      insertChild(snapshot.trackParent, clone(snapshot.trackObject), snapshot.trackIndex)
      replaceNode(tree.root, payload.newSourceObjects[0].id, [])
      removeNode(tree.root, payload.newSourceObjects[1].id)
      insertChild(snapshot.sourceParent, clone(snapshot.sourceObject), snapshot.sourceIndex)
      restoreGroups(tree.root, snapshot.groups)
    },
  }
}

export function buildMergeTrackObjectsCommand(payload: MergeTrackObjectsCommandPayload): SemanticCommand {
  let snapshots: ReplaceSnapshot[] = []

  return {
    description: `Merge ${payload.oldTrackObjectIds.length} TrackObjects`,
    apply(tree) {
      if (payload.oldTrackObjectIds.length < 2) {
        throw new Error('Merge requires at least two TrackObjects')
      }

      const index = buildNodeIndex(tree.root)
      const oldTrackObjects = payload.oldTrackObjectIds.map(id => requireTrackObject(index, id))
      ensureTrackObjectsMatch(oldTrackObjects[0].trackObject.contentType, oldTrackObjects)
      if (payload.newTrackObject.trackObject.contentType !== oldTrackObjects[0].trackObject.contentType) {
        throw new Error('Merged TrackObject content type does not match source TrackObjects')
      }
      ensureGroupsFullyContainMergeSet(tree.root, payload.oldTrackObjectIds)

      snapshots = payload.oldTrackObjectIds.map(id => snapshotTrackObjectWithSource(tree, buildNodeIndex(tree.root), id))
      const firstLocation = requireLocation(tree.root, payload.oldTrackObjectIds[0])
      const firstParent = firstLocation.parent
      if (firstParent.kind === 'trackFolder' && firstParent.trackFolder.trackType !== payload.newTrackObject.trackObject.contentType) {
        throw new Error('Merged TrackObject content type does not match parent TrackFolder')
      }

      removeMany(tree.root, payload.oldTrackObjectIds)
      removeMany(tree.root, oldTrackObjects.map(node => node.trackObject.sourceObjectId))
      insertChild(firstParent, clone(payload.newTrackObject), firstLocation.index)

      const firstSourceSnapshot = snapshots[0]
      insertChild(firstSourceSnapshot.sourceParent, clone(payload.newSourceObject), firstSourceSnapshot.sourceIndex)
      replaceTrackObjectIdsInGroups(tree.root, payload.oldTrackObjectIds, [payload.newTrackObject.id])
    },
    undo(tree) {
      if (snapshots.length === 0) return
      removeNode(tree.root, payload.newTrackObject.id)
      removeNode(tree.root, payload.newSourceObject.id)

      for (const snapshot of [...snapshots].sort((a, b) => a.trackIndex - b.trackIndex)) {
        insertChild(snapshot.trackParent, clone(snapshot.trackObject), snapshot.trackIndex)
      }
      for (const snapshot of [...snapshots].sort((a, b) => a.sourceIndex - b.sourceIndex)) {
        insertChild(snapshot.sourceParent, clone(snapshot.sourceObject), snapshot.sourceIndex)
      }
      restoreGroups(tree.root, snapshots[0].groups)
    },
  }
}

export function buildDeleteTrackObjectCommand(payload: DeleteTrackObjectCommandPayload): SemanticCommand {
  let snapshot: ReplaceSnapshot | null = null

  return {
    description: `Delete TrackObject ${payload.trackObjectId}`,
    apply(tree) {
      const index = buildNodeIndex(tree.root)
      snapshot = snapshotTrackObjectWithSource(tree, index, payload.trackObjectId)
      removeNode(tree.root, payload.trackObjectId)
      removeNode(tree.root, snapshot.trackObject.trackObject.sourceObjectId)
      removeTrackObjectIdFromGroups(tree.root, payload.trackObjectId)
    },
    undo(tree) {
      if (!snapshot) return
      insertChild(snapshot.trackParent, clone(snapshot.trackObject), snapshot.trackIndex)
      insertChild(snapshot.sourceParent, clone(snapshot.sourceObject), snapshot.sourceIndex)
      restoreGroups(tree.root, snapshot.groups)
    },
  }
}

export function executeSemanticCommand(tree: ProjectObjectTree, command: SemanticCommand) {
  command.apply(tree)
}

export function undoSemanticCommand(tree: ProjectObjectTree, command: SemanticCommand) {
  command.undo(tree)
}

interface GroupSnapshot {
  groupId: NodeId
  trackObjectIds: NodeId[]
}

interface ReplaceSnapshot {
  trackObject: TrackObjectNode
  trackParent: FolderNode | Extract<TreeNode, { kind: 'trackFolder' }>
  trackIndex: number
  sourceObject: AudioObjectNode
  sourceParent: FolderNode | Extract<TreeNode, { kind: 'trackFolder' }>
  sourceIndex: number
  groups: GroupSnapshot[]
}

function snapshotTrackObjectWithSource(tree: ProjectObjectTree, index: RuntimeTreeIndex, trackObjectId: NodeId): ReplaceSnapshot {
  const trackObject = requireTrackObject(index, trackObjectId)
  const sourceObject = requireAudioObject(index, trackObject.trackObject.sourceObjectId)
  const trackLocation = requireLocation(tree.root, trackObjectId)
  const sourceLocation = requireLocation(tree.root, sourceObject.id)

  return {
    trackObject: clone(trackObject),
    trackParent: trackLocation.parent,
    trackIndex: trackLocation.index,
    sourceObject: clone(sourceObject),
    sourceParent: sourceLocation.parent,
    sourceIndex: sourceLocation.index,
    groups: snapshotGroups(tree.root),
  }
}

function requireTrackObject(index: RuntimeTreeIndex, id: NodeId): TrackObjectNode {
  const node = index.nodes[id]
  if (!node || node.kind !== 'trackObject') {
    throw new Error(`Expected TrackObject: ${id}`)
  }
  return node
}

function requireAudioObject(index: RuntimeTreeIndex, id: NodeId): AudioObjectNode {
  const node = index.nodes[id]
  if (!node || node.kind !== 'audio') {
    throw new Error(`Expected AudioObject source: ${id}`)
  }
  return node
}

function requireTrackFolder(index: RuntimeTreeIndex, id: NodeId): Extract<TreeNode, { kind: 'trackFolder' }> {
  const node = index.nodes[id]
  if (!node || node.kind !== 'trackFolder') {
    throw new Error(`Expected TrackFolder: ${id}`)
  }
  return node
}

function requireLocation(root: FolderNode, id: NodeId) {
  const location = findNodeLocation(root, id)
  if (!location) {
    throw new Error(`Cannot find node location: ${id}`)
  }
  return location
}

function ensureTrackObjectsMatch(contentType: TrackObjectContentType, nodes: TrackObjectNode[]) {
  if (nodes.some(node => node.trackObject.contentType !== contentType)) {
    throw new Error('TrackObjects must have the same content type')
  }
}

function removeMany(root: FolderNode, ids: NodeId[]) {
  for (const id of ids) removeNode(root, id)
}

function collectGroups(root: FolderNode): GroupObjectNode[] {
  const groups: GroupObjectNode[] = []
  function visit(node: TreeNode) {
    if (node.kind === 'group') groups.push(node)
    if (node.kind === 'folder' || node.kind === 'trackFolder') {
      for (const child of node.children) visit(child)
    }
  }
  visit(root)
  return groups
}

function snapshotGroups(root: FolderNode): GroupSnapshot[] {
  return collectGroups(root).map(group => ({
    groupId: group.id,
    trackObjectIds: [...group.group.trackObjectIds],
  }))
}

function restoreGroups(root: FolderNode, snapshots: GroupSnapshot[]) {
  const byId = new Map(snapshots.map(snapshot => [snapshot.groupId, snapshot.trackObjectIds]))
  for (const group of collectGroups(root)) {
    const ids = byId.get(group.id)
    if (ids) group.group.trackObjectIds = [...ids]
  }
}

function replaceTrackObjectIdsInGroups(root: FolderNode, oldIds: NodeId[], newIds: NodeId[]) {
  const oldSet = new Set(oldIds)
  for (const group of collectGroups(root)) {
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
    group.group.trackObjectIds = unique(next)
  }
}

function removeTrackObjectIdFromGroups(root: FolderNode, trackObjectId: NodeId) {
  for (const group of collectGroups(root)) {
    group.group.trackObjectIds = group.group.trackObjectIds.filter(id => id !== trackObjectId)
  }
}

function ensureGroupsFullyContainMergeSet(root: FolderNode, oldIds: NodeId[]) {
  const oldSet = new Set(oldIds)
  for (const group of collectGroups(root)) {
    const contained = group.group.trackObjectIds.filter(id => oldSet.has(id)).length
    if (contained > 0 && contained < oldSet.size) {
      throw new Error(`Group ${group.id} only partially contains merged TrackObjects`)
    }
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

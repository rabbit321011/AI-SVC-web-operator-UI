import type {
  FolderNode,
  NodeId,
  ObjectWorkbenchTopLevelIds,
  ProjectObjectTree,
  RuntimeTreeIndex,
  TreeNode,
} from './types'

export const TOP_LEVEL_IDS: ObjectWorkbenchTopLevelIds = {
  root: 'project:/',
  workspace: 'project:/workspace',
  resource: 'project:/resource',
  trackSources: 'project:/trackSources',
  tracks: 'project:/tracks',
  groups: 'project:/groups',
  renders: 'project:/renders',
}

export function createEmptyProjectObjectTree(): ProjectObjectTree {
  return {
    schemaVersion: 'object-workbench.v1',
    root: folder(TOP_LEVEL_IDS.root, 'project', [
      folder(TOP_LEVEL_IDS.workspace, 'workspace'),
      folder(TOP_LEVEL_IDS.resource, 'resource'),
      folder(TOP_LEVEL_IDS.trackSources, 'trackSources'),
      folder(TOP_LEVEL_IDS.tracks, 'tracks'),
      folder(TOP_LEVEL_IDS.groups, 'groups'),
      folder(TOP_LEVEL_IDS.renders, 'renders'),
    ]),
    assets: {},
  }
}

export function buildNodeIndex(root: FolderNode): RuntimeTreeIndex {
  const nodes: Record<NodeId, TreeNode> = {}
  const parentById: Record<NodeId, NodeId | null> = {}
  const pathById: Record<NodeId, string> = {}

  function visit(node: TreeNode, parentId: NodeId | null, parentPath: string) {
    if (nodes[node.id]) {
      throw new Error(`Duplicate tree node id: ${node.id}`)
    }

    nodes[node.id] = node
    parentById[node.id] = parentId
    pathById[node.id] = parentId === null ? 'project:/' : `${parentPath}/${node.name}`

    if (hasChildren(node)) {
      for (const child of node.children) {
        visit(child, node.id, pathById[node.id])
      }
    }
  }

  visit(root, null, '')
  return { nodes, parentById, pathById }
}

export function getNode(index: RuntimeTreeIndex, id: NodeId): TreeNode | undefined {
  return index.nodes[id]
}

export function getParent(index: RuntimeTreeIndex, id: NodeId): TreeNode | undefined {
  const parentId = index.parentById[id]
  return parentId ? index.nodes[parentId] : undefined
}

export function isDescendantOf(index: RuntimeTreeIndex, id: NodeId, ancestorId: NodeId): boolean {
  let current: NodeId | null | undefined = index.parentById[id]
  while (current) {
    if (current === ancestorId) return true
    current = index.parentById[current]
  }
  return false
}

export function findChildByName(parent: FolderNode, name: string): TreeNode | undefined {
  return parent.children.find(child => child.name === name)
}

export function getChildren(node: TreeNode): TreeNode[] {
  return hasChildren(node) ? node.children : []
}

export function requireFolder(index: RuntimeTreeIndex, id: NodeId): FolderNode {
  const node = index.nodes[id]
  if (!node || node.kind !== 'folder') {
    throw new Error(`Expected folder node: ${id}`)
  }
  return node
}

export interface TreeNodeLocation {
  parent: FolderNode | Extract<TreeNode, { kind: 'trackFolder' }>
  index: number
}

export function findNodeLocation(root: FolderNode, id: NodeId): TreeNodeLocation | null {
  function visit(parent: FolderNode | Extract<TreeNode, { kind: 'trackFolder' }>): TreeNodeLocation | null {
    const index = parent.children.findIndex(child => child.id === id)
    if (index >= 0) return { parent, index }

    for (const child of parent.children) {
      if (!hasChildren(child)) continue
      const found = visit(child)
      if (found) return found
    }
    return null
  }

  return visit(root)
}

export function insertChild(
  parent: FolderNode | Extract<TreeNode, { kind: 'trackFolder' }>,
  child: TreeNode,
  index = parent.children.length,
) {
  parent.children.splice(index, 0, child)
}

export function removeNode(root: FolderNode, id: NodeId): TreeNode | null {
  const location = findNodeLocation(root, id)
  if (!location) return null
  const [removed] = location.parent.children.splice(location.index, 1)
  return removed ?? null
}

export function replaceNode(root: FolderNode, oldId: NodeId, replacements: TreeNode[]): TreeNode | null {
  const location = findNodeLocation(root, oldId)
  if (!location) return null
  const [removed] = location.parent.children.splice(location.index, 1, ...replacements)
  return removed ?? null
}

export function hasChildren(node: TreeNode): node is FolderNode | Extract<TreeNode, { kind: 'trackFolder' }> {
  return node.kind === 'folder' || node.kind === 'trackFolder'
}

function folder(id: NodeId, name: string, children: TreeNode[] = []): FolderNode {
  return { id, kind: 'folder', name, children }
}

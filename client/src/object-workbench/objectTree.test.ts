import { describe, expect, it } from 'vitest'
import {
  TOP_LEVEL_IDS,
  buildNodeIndex,
  createEmptyProjectObjectTree,
  getNode,
  getParent,
  isDescendantOf,
} from './index'

describe('object workbench tree index', () => {
  it('indexes the fixed top-level project folders', () => {
    const tree = createEmptyProjectObjectTree()
    const index = buildNodeIndex(tree.root)

    expect(getNode(index, TOP_LEVEL_IDS.workspace)?.name).toBe('workspace')
    expect(getNode(index, TOP_LEVEL_IDS.resource)?.name).toBe('resource')
    expect(getNode(index, TOP_LEVEL_IDS.trackSources)?.name).toBe('trackSources')
    expect(getNode(index, TOP_LEVEL_IDS.tracks)?.name).toBe('tracks')
    expect(getNode(index, TOP_LEVEL_IDS.groups)?.name).toBe('groups')
    expect(getNode(index, TOP_LEVEL_IDS.renders)?.name).toBe('renders')
    expect(getParent(index, TOP_LEVEL_IDS.workspace)?.id).toBe(TOP_LEVEL_IDS.root)
  })

  it('detects descendant relationships by uid instead of path text', () => {
    const tree = createEmptyProjectObjectTree()
    const index = buildNodeIndex(tree.root)

    expect(isDescendantOf(index, TOP_LEVEL_IDS.groups, TOP_LEVEL_IDS.root)).toBe(true)
    expect(isDescendantOf(index, TOP_LEVEL_IDS.groups, TOP_LEVEL_IDS.tracks)).toBe(false)
  })

  it('rejects duplicate node ids', () => {
    const tree = createEmptyProjectObjectTree()
    tree.root.children.push({ id: TOP_LEVEL_IDS.workspace, kind: 'folder', name: 'duplicate', children: [] })

    expect(() => buildNodeIndex(tree.root)).toThrow('Duplicate tree node id')
  })
})

import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { TOP_LEVEL_IDS, createEmptyProjectObjectTree } from '@/object-workbench'
import type { AudioObjectNode, FolderNode, GroupObjectNode } from '@/object-workbench'
import { useObjectTreeStore } from './objectTree'

describe('object tree guarded move action', () => {
  it('moves workspace objects into resource', () => {
    setActivePinia(createPinia())
    const store = useObjectTreeStore()
    const tree = fixtureTree()
    store.loadObjectTree(tree)

    const result = store.moveNode('node:workspace:audio', TOP_LEVEL_IDS.resource)

    expect(result.ok).toBe(true)
    expect(store.parent('node:workspace:audio')?.id).toBe(TOP_LEVEL_IDS.resource)
  })

  it('blocks moving trackSources outside', () => {
    setActivePinia(createPinia())
    const store = useObjectTreeStore()
    store.loadObjectTree(fixtureTree())

    const result = store.moveNode('node:trackSource:audio', TOP_LEVEL_IDS.workspace)

    expect(result.ok).toBe(false)
    expect(store.parent('node:trackSource:audio')?.id).toBe(TOP_LEVEL_IDS.trackSources)
  })

  it('keeps GroupObject inside groups', () => {
    setActivePinia(createPinia())
    const store = useObjectTreeStore()
    store.loadObjectTree(fixtureTree())

    expect(store.moveNode('node:group:a', TOP_LEVEL_IDS.workspace).ok).toBe(false)
    expect(store.moveNode('node:group:a', 'node:groups:folder').ok).toBe(true)
    expect(store.parent('node:group:a')?.id).toBe('node:groups:folder')
  })
})

function fixtureTree() {
  const tree = createEmptyProjectObjectTree()
  folder(tree, TOP_LEVEL_IDS.workspace).children.push(audio('node:workspace:audio'))
  folder(tree, TOP_LEVEL_IDS.trackSources).children.push(audio('node:trackSource:audio'))
  const groupsFolder: FolderNode = { id: 'node:groups:folder', kind: 'folder', name: 'folder', children: [] }
  folder(tree, TOP_LEVEL_IDS.groups).children.push(groupsFolder, group('node:group:a'))
  return tree
}

function folder(tree: ReturnType<typeof createEmptyProjectObjectTree>, id: string): FolderNode {
  const node = tree.root.children.find(child => child.id === id)
  if (!node || node.kind !== 'folder') throw new Error(`missing folder ${id}`)
  return node
}

function audio(id: string): AudioObjectNode {
  return {
    id,
    kind: 'audio',
    name: id,
    audio: { assetId: id, midiObjectId: null, textObjectId: null },
  }
}

function group(id: string): GroupObjectNode {
  return {
    id,
    kind: 'group',
    name: id,
    group: { mediaType: 'audio', trackObjectIds: [] },
  }
}

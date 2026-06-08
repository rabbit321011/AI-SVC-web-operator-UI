import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createEmptyProjectObjectTree, TOP_LEVEL_IDS } from '@/object-workbench'
import type { Command } from '@/types'
import { useHistoryStore } from './history'
import { useObjectTreeStore } from './objectTree'

describe('history object tree snapshots', () => {
  it('restores objectTree snapshots on undo and redo', () => {
    setActivePinia(createPinia())
    const objectTree = useObjectTreeStore()
    const history = useHistoryStore()

    const before = createEmptyProjectObjectTree()
    const after = createEmptyProjectObjectTree()
    const groups = after.root.children.find(child => child.id === TOP_LEVEL_IDS.groups)
    if (!groups || groups.kind !== 'folder') throw new Error('missing groups folder')
    groups.children.push({
      id: 'node:group:test',
      kind: 'group',
      name: 'Test Group',
      group: { mediaType: 'audio', trackObjectIds: [] },
    })

    objectTree.loadObjectTree(after)
    const command: Command = {
      description: 'snapshot command',
      patches: [],
      inversePatches: [],
      objectTree: { kind: 'snapshot', before, after },
    }
    history.push(command)

    history.undo()
    expect(objectTree.node('node:group:test')).toBeUndefined()

    history.redo()
    expect(objectTree.node('node:group:test')?.name).toBe('Test Group')
  })
})

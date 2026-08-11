import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createEmptyProjectObjectTree, TOP_LEVEL_IDS } from '@/object-workbench'
import type { Command } from '@/types'
import { useHistoryStore } from './history'
import { useObjectTreeStore } from './objectTree'
import { useTracksStore } from './tracks'

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

  it('restores project blobs together with an object-tree snapshot', () => {
    setActivePinia(createPinia())
    const objectTree = useObjectTreeStore()
    const history = useHistoryStore()
    const tracks = useTracksStore()
    const before = createEmptyProjectObjectTree()
    const after = createEmptyProjectObjectTree()
    const guide = new Blob(['guide'])
    tracks.sourceBlobs.set('guide.wav', guide)
    objectTree.loadObjectTree(after)
    history.push({
      description: 'create owned guide',
      patches: [],
      inversePatches: [],
      objectTree: {
        kind: 'snapshot',
        before,
        after,
        blobChanges: [{ key: 'guide.wav', before: null, after: guide }],
      },
    })

    history.undo()
    expect(tracks.sourceBlobs.has('guide.wav')).toBe(false)
    history.redo()
    expect(tracks.sourceBlobs.get('guide.wav')).toBe(guide)
  })
})

import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useObjectTreeUiStore } from './objectTreeUi'
import type { FolderNode, TrackObjectNode } from '@/object-workbench'

describe('object tree UI selection state', () => {
  it('does not select folders', () => {
    setActivePinia(createPinia())
    const ui = useObjectTreeUiStore()
    ui.selectNode(folder('project:/workspace', 'workspace'))

    expect(ui.selectedIds).toEqual([])
  })

  it('shares NodeId selection across panes', () => {
    setActivePinia(createPinia())
    const ui = useObjectTreeUiStore()
    const node = trackObject('node:trackObject:seg_a')

    ui.selectNode(node)
    expect(ui.isSelected(node.id)).toBe(true)

    ui.selectNode(trackObject('node:trackObject:seg_b'), true)
    expect(ui.selectedIds.sort()).toEqual(['node:trackObject:seg_a', 'node:trackObject:seg_b'])
  })

  it('keeps L1 and L2 expansion independent', () => {
    setActivePinia(createPinia())
    const ui = useObjectTreeUiStore()

    ui.toggleExpanded('L1', 'project:/tracks')
    expect(ui.isExpanded('L1', 'project:/tracks')).toBe(true)
    expect(ui.isExpanded('L2', 'project:/tracks')).toBe(false)
  })
})

function folder(id: string, name: string): FolderNode {
  return { id, name, kind: 'folder', children: [] }
}

function trackObject(id: string): TrackObjectNode {
  return {
    id,
    name: id,
    kind: 'trackObject',
    trackObject: {
      contentType: 'audio',
      sourceObjectId: 'node:source:audio:seg_a',
      timelineStart: 0,
      timelineEnd: 1,
      ignored: false,
    },
  }
}

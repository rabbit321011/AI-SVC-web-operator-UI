import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEditorWorkspaceStore, PROJECT_ROOT_EDITOR_ID, PROJECT_ROOT_OBJECT_ID } from './editorWorkspace'
import { useObjectTreeUiStore } from './objectTreeUi'

describe('editor workspace state', () => {
  it('starts with the project root timeline editor as the active tab', () => {
    setActivePinia(createPinia())
    const workspace = useEditorWorkspaceStore()

    expect(workspace.tabs).toHaveLength(1)
    expect(workspace.activeTabId).toBe(PROJECT_ROOT_EDITOR_ID)
    expect(workspace.activeTab?.kind).toBe('timeline')
    expect(workspace.activeContextObjectId).toBe(PROJECT_ROOT_OBJECT_ID)
    expect(workspace.hasOnlyTimeline).toBe(true)
  })

  it('rejects activating a missing editor tab', () => {
    setActivePinia(createPinia())
    const workspace = useEditorWorkspaceStore()

    expect(workspace.activateTab('editor:missing')).toBe(false)
    expect(workspace.activeTabId).toBe(PROJECT_ROOT_EDITOR_ID)
  })

  it('keeps active editor context separate from object tree selection', () => {
    setActivePinia(createPinia())
    const workspace = useEditorWorkspaceStore()
    const objectTreeUi = useObjectTreeUiStore()

    objectTreeUi.selectById('node:text:lyrics-a')

    expect(objectTreeUi.selectedIds).toEqual(['node:text:lyrics-a'])
    expect(workspace.activeTabId).toBe(PROJECT_ROOT_EDITOR_ID)
    expect(workspace.activeContextObjectId).toBe(PROJECT_ROOT_OBJECT_ID)
  })
})

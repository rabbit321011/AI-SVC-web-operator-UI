import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEditorWorkspaceStore, PROJECT_KEYMAP_EDITOR_ID, PROJECT_ROOT_EDITOR_ID, PROJECT_ROOT_OBJECT_ID, PROJECT_SETTINGS_EDITOR_ID } from './editorWorkspace'
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

  it('opens settings and keymap as singleton closeable root tabs', () => {
    setActivePinia(createPinia())
    const workspace = useEditorWorkspaceStore()

    workspace.openSettingsTab()
    workspace.openSettingsTab()
    expect(workspace.tabs.filter(tab => tab.id === PROJECT_SETTINGS_EDITOR_ID)).toHaveLength(1)
    expect(workspace.activeTabId).toBe(PROJECT_SETTINGS_EDITOR_ID)
    expect(workspace.activeTab?.kind).toBe('settings')
    expect(workspace.activeTab?.closable).toBe(true)

    workspace.openKeymapTab()
    expect(workspace.tabs.filter(tab => tab.id === PROJECT_KEYMAP_EDITOR_ID)).toHaveLength(1)
    expect(workspace.activeTabId).toBe(PROJECT_KEYMAP_EDITOR_ID)
    expect(workspace.activeTab?.kind).toBe('keymap')

    expect(workspace.closeTab(PROJECT_ROOT_EDITOR_ID)).toBe(false)
    expect(workspace.closeTab(PROJECT_KEYMAP_EDITOR_ID)).toBe(true)
    expect(workspace.activeTabId).toBe(PROJECT_SETTINGS_EDITOR_ID)
  })

  it('opens TextObject editors as singleton object tabs', () => {
    setActivePinia(createPinia())
    const workspace = useEditorWorkspaceStore()

    workspace.openTextObjectTab('node:text:lyrics-a', 'Lyrics A')
    workspace.openTextObjectTab('node:text:lyrics-a', 'Lyrics A')

    expect(workspace.tabs.filter(tab => tab.contextObjectId === 'node:text:lyrics-a')).toHaveLength(1)
    expect(workspace.activeTab).toMatchObject({
      kind: 'object',
      objectKind: 'text',
      title: 'Lyrics A',
      contextObjectId: 'node:text:lyrics-a',
      closable: true,
    })
  })

  it('keeps timeline scroll state while switching editor tabs', () => {
    setActivePinia(createPinia())
    const workspace = useEditorWorkspaceStore()

    workspace.setTimelineScroll(120, 40)
    workspace.openSettingsTab()
    workspace.activateTab(PROJECT_ROOT_EDITOR_ID)

    expect(workspace.timelineScroll).toEqual({ left: 120, top: 40 })
  })
})

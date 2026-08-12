import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

export type EditorTabKind = 'timeline' | 'object' | 'settings' | 'keymap' | 'gpu'
export type EditorObjectKind = 'midi' | 'text' | 'synthesisUnit' | 'pitch' | 'analysis' | 'unknown'

export interface EditorTab {
  id: string
  kind: EditorTabKind
  title: string
  contextObjectId: string
  objectKind?: EditorObjectKind
  closable: boolean
}

export const PROJECT_ROOT_EDITOR_ID = 'editor:project-root'
export const PROJECT_SETTINGS_EDITOR_ID = 'editor:project-settings'
export const PROJECT_KEYMAP_EDITOR_ID = 'editor:project-keymap'
export const PROJECT_GPU_EDITOR_ID = 'editor:gpu-runtime'
export const PROJECT_ROOT_OBJECT_ID = 'project/root'

export function objectEditorId(objectId: string): string {
  return `editor:object:${objectId}`
}

function createProjectRootTimelineTab(): EditorTab {
  return {
    id: PROJECT_ROOT_EDITOR_ID,
    kind: 'timeline',
    title: 'Timeline',
    contextObjectId: PROJECT_ROOT_OBJECT_ID,
    closable: false,
  }
}

export const useEditorWorkspaceStore = defineStore('editorWorkspace', () => {
  const tabs = ref<EditorTab[]>([createProjectRootTimelineTab()])
  const activeTabId = ref(PROJECT_ROOT_EDITOR_ID)
  const timelineScroll = ref({ left: 0, top: 0 })

  const activeTab = computed(() => tabs.value.find(tab => tab.id === activeTabId.value) ?? tabs.value[0])
  const activeContextObjectId = computed(() => activeTab.value?.contextObjectId ?? PROJECT_ROOT_OBJECT_ID)
  const hasOnlyTimeline = computed(() => tabs.value.length === 1 && tabs.value[0]?.kind === 'timeline')

  function activateTab(tabId: string): boolean {
    if (!tabs.value.some(tab => tab.id === tabId)) return false
    activeTabId.value = tabId
    return true
  }

  function openSettingsTab() {
    openSingletonTab({
      id: PROJECT_SETTINGS_EDITOR_ID,
      kind: 'settings',
      title: 'Settings',
      contextObjectId: PROJECT_ROOT_OBJECT_ID,
      closable: true,
    })
  }

  function openKeymapTab() {
    openSingletonTab({
      id: PROJECT_KEYMAP_EDITOR_ID,
      kind: 'keymap',
      title: 'Keymap',
      contextObjectId: PROJECT_ROOT_OBJECT_ID,
      closable: true,
    })
  }

  function openGpuTab() {
    openSingletonTab({
      id: PROJECT_GPU_EDITOR_ID,
      kind: 'gpu',
      title: '显存',
      contextObjectId: PROJECT_ROOT_OBJECT_ID,
      closable: true,
    })
  }

  function openTextObjectTab(objectId: string, title: string) {
    openSingletonTab({
      id: objectEditorId(objectId),
      kind: 'object',
      title,
      contextObjectId: objectId,
      objectKind: 'text',
      closable: true,
    })
  }

  function openSynthesisUnitTab(objectId: string, title: string) {
    openSingletonTab({
      id: objectEditorId(objectId),
      kind: 'object',
      title,
      contextObjectId: objectId,
      objectKind: 'synthesisUnit',
      closable: true,
    })
  }

  function closeTab(tabId: string): boolean {
    const tab = tabs.value.find(item => item.id === tabId)
    if (!tab || !tab.closable) return false
    const index = tabs.value.findIndex(item => item.id === tabId)
    tabs.value = tabs.value.filter(item => item.id !== tabId)
    if (activeTabId.value === tabId) {
      activeTabId.value = tabs.value[Math.max(0, index - 1)]?.id ?? PROJECT_ROOT_EDITOR_ID
    }
    return true
  }

  function openSingletonTab(tab: EditorTab) {
    if (!tabs.value.some(item => item.id === tab.id)) tabs.value.push(tab)
    activeTabId.value = tab.id
  }

  function resetToProjectTimeline() {
    tabs.value = [createProjectRootTimelineTab()]
    activeTabId.value = PROJECT_ROOT_EDITOR_ID
  }

  function setTimelineScroll(left: number, top: number) {
    timelineScroll.value = {
      left: Math.max(0, left),
      top: Math.max(0, top),
    }
  }

  return {
    tabs,
    activeTabId,
    activeTab,
    activeContextObjectId,
    hasOnlyTimeline,
    timelineScroll,
    activateTab,
    openSettingsTab,
    openKeymapTab,
    openGpuTab,
    openTextObjectTab,
    openSynthesisUnitTab,
    setTimelineScroll,
    closeTab,
    resetToProjectTimeline,
  }
})

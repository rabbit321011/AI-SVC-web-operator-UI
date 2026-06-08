import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

export type EditorTabKind = 'timeline' | 'object'
export type EditorObjectKind = 'midi' | 'text' | 'pitch' | 'analysis' | 'unknown'

export interface EditorTab {
  id: string
  kind: EditorTabKind
  title: string
  contextObjectId: string
  objectKind?: EditorObjectKind
  closable: boolean
}

export const PROJECT_ROOT_EDITOR_ID = 'editor:project-root'
export const PROJECT_ROOT_OBJECT_ID = 'project/root'

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

  const activeTab = computed(() => tabs.value.find(tab => tab.id === activeTabId.value) ?? tabs.value[0])
  const activeContextObjectId = computed(() => activeTab.value?.contextObjectId ?? PROJECT_ROOT_OBJECT_ID)
  const hasOnlyTimeline = computed(() => tabs.value.length === 1 && tabs.value[0]?.kind === 'timeline')

  function activateTab(tabId: string): boolean {
    if (!tabs.value.some(tab => tab.id === tabId)) return false
    activeTabId.value = tabId
    return true
  }

  function resetToProjectTimeline() {
    tabs.value = [createProjectRootTimelineTab()]
    activeTabId.value = PROJECT_ROOT_EDITOR_ID
  }

  return {
    tabs,
    activeTabId,
    activeTab,
    activeContextObjectId,
    hasOnlyTimeline,
    activateTab,
    resetToProjectTimeline,
  }
})

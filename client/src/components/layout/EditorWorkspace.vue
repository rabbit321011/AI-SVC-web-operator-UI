<script setup lang="ts">
import { useEditorWorkspaceStore } from '@/stores/editorWorkspace'
import MainCanvas from '@/components/layout/MainCanvas.vue'

const editorWorkspace = useEditorWorkspaceStore()
</script>

<template>
  <section class="editor-workspace" aria-label="Rich media editor workspace">
    <div class="editor-tabs" role="tablist" aria-label="Open editors">
      <button
        v-for="tab in editorWorkspace.tabs"
        :key="tab.id"
        class="editor-tab"
        :class="{ active: tab.id === editorWorkspace.activeTabId }"
        type="button"
        role="tab"
        :aria-selected="tab.id === editorWorkspace.activeTabId"
        @click="editorWorkspace.activateTab(tab.id)"
      >
        {{ tab.title }}
      </button>
    </div>

    <div class="editor-surface">
      <MainCanvas v-if="editorWorkspace.activeTab?.kind === 'timeline'" />
      <div v-else class="empty-editor">Editor unavailable</div>
    </div>
  </section>
</template>

<style scoped>
.editor-workspace {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: #0d1117;
}

.editor-tabs {
  flex: 0 0 32px;
  display: flex;
  align-items: flex-end;
  gap: 2px;
  padding: 4px 8px 0;
  border-bottom: 1px solid #30363d;
  background: #0d1117;
}

.editor-tab {
  height: 28px;
  min-width: 96px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-bottom: 0;
  border-radius: 6px 6px 0 0;
  background: transparent;
  color: #8b949e;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.editor-tab.active {
  border-color: #30363d;
  background: #161b22;
  color: #c9d1d9;
}

.editor-surface {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
}

.empty-editor {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #8b949e;
}
</style>

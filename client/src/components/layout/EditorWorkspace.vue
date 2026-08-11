<script setup lang="ts">
import { useEditorWorkspaceStore } from '@/stores/editorWorkspace'
import MainCanvas from '@/components/layout/MainCanvas.vue'
import SettingsPage from '@/components/settings/SettingsPage.vue'
import KeymapHelpPage from '@/components/settings/KeymapHelpPage.vue'
import TextObjectEditor from '@/components/text/TextObjectEditor.vue'
import SynthesisUnitEditor from '@/components/synthesis/SynthesisUnitEditor.vue'

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
        <span>{{ tab.title }}</span>
        <span
          v-if="tab.closable"
          class="tab-close"
          role="button"
          tabindex="0"
          aria-label="Close tab"
          @click.stop="editorWorkspace.closeTab(tab.id)"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.2 4.2 8 8l3.8-3.8 1 1L9 9l3.8 3.8-1 1L8 10l-3.8 3.8-1-1L7 9 3.2 5.2l1-1Z" /></svg>
        </span>
      </button>
    </div>

    <div class="editor-surface">
      <MainCanvas v-show="editorWorkspace.activeTab?.kind === 'timeline'" />
      <SettingsPage v-if="editorWorkspace.activeTab?.kind === 'settings'" />
      <KeymapHelpPage v-if="editorWorkspace.activeTab?.kind === 'keymap'" />
      <TextObjectEditor v-if="editorWorkspace.activeTab?.kind === 'object' && editorWorkspace.activeTab.objectKind === 'text'" :object-id="editorWorkspace.activeTab.contextObjectId" />
      <SynthesisUnitEditor v-if="editorWorkspace.activeTab?.kind === 'object' && editorWorkspace.activeTab.objectKind === 'synthesisUnit'" :object-id="editorWorkspace.activeTab.contextObjectId" />
      <div v-if="editorWorkspace.activeTab?.kind !== 'timeline' && editorWorkspace.activeTab?.kind !== 'settings' && editorWorkspace.activeTab?.kind !== 'keymap' && !(editorWorkspace.activeTab?.kind === 'object' && (editorWorkspace.activeTab.objectKind === 'text' || editorWorkspace.activeTab.objectKind === 'synthesisUnit'))" class="empty-editor">Editor unavailable</div>
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
  background: color-mix(in srgb, var(--app-surface) var(--center-opacity-percent), transparent);
  backdrop-filter: var(--center-backdrop-filter);
}

.editor-tabs {
  flex: 0 0 32px;
  display: flex;
  align-items: flex-end;
  gap: 2px;
  padding: 4px 8px 0;
  border-bottom: 1px solid var(--app-border);
  background: color-mix(in srgb, var(--app-surface) var(--center-opacity-percent), transparent);
}

.editor-tab {
  height: 28px;
  min-width: 96px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-bottom: 0;
  border-radius: 6px 6px 0 0;
  background: transparent;
  color: var(--app-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.editor-tab.active {
  border-color: var(--app-border);
  background: var(--app-panel);
  color: var(--app-text);
}

.tab-close {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
}
.tab-close:hover { background: color-mix(in srgb, var(--app-border) 60%, transparent); }
.tab-close svg { width: 12px; height: 12px; fill: currentColor; }

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
  color: var(--app-muted);
}
</style>

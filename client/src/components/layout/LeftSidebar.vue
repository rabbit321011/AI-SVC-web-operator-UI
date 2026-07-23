<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useObjectTreeStore } from '@/stores/objectTree'
import { useObjectTreeUiStore } from '@/stores/objectTreeUi'
import { useSelectionStore } from '@/stores/selection'
import { useUiSettingsStore } from '@/stores/uiSettings'
import { useEditorWorkspaceStore } from '@/stores/editorWorkspace'
import type { NodeId, TreeNode } from '@/object-workbench'
import ObjectTreeRows from './ObjectTreeRows.vue'

const objectTree = useObjectTreeStore()
const ui = useObjectTreeUiStore()
const selection = useSelectionStore()
const uiSettings = useUiSettingsStore()
const editorWorkspace = useEditorWorkspaceStore()
const menu = ref<{ visible: boolean; x: number; y: number; node: TreeNode | null }>({ visible: false, x: 0, y: 0, node: null })

const rootChildren = computed(() => objectTree.tree.root.children)
const sidebarStyle = computed(() => ({
  width: uiSettings.settings.l1Collapsed && uiSettings.settings.l2Collapsed ? '80px' : uiSettings.settings.l1Collapsed || uiSettings.settings.l2Collapsed ? '160px' : '260px',
  gridTemplateColumns: `${uiSettings.settings.l1Collapsed ? '34px' : 'minmax(0, 1fr)'} ${uiSettings.settings.l2Collapsed ? '34px' : 'minmax(0, 1fr)'}`,
}))

function hasChildren(node: TreeNode): node is Extract<TreeNode, { children: TreeNode[] }> {
  return (node.kind === 'folder' || node.kind === 'trackFolder') && node.children.length > 0
}

function icon(node: TreeNode) {
  if (node.kind === 'folder') return 'dir'
  if (node.kind === 'trackFolder') return 'trk'
  if (node.kind === 'trackObject') return 'obj'
  if (node.kind === 'group') return 'grp'
  return node.kind
}

function handleNodeClick(pane: 'L1' | 'L2', node: TreeNode, event: MouseEvent) {
  selection.clear()
  if (node.kind === 'folder' || node.kind === 'trackFolder') {
    ui.toggleExpanded(pane, node.id)
    return
  }
  ui.selectNode(node, event.ctrlKey || event.metaKey)
}

function handleNodeDblClick(node: TreeNode) {
  if (node.kind === 'text') editorWorkspace.openTextObjectTab(node.id, node.name)
}

function handleNodeDrop(pane: 'L1' | 'L2', target: TreeNode, event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer?.files?.length) {
    importDroppedFiles(pane, target, Array.from(event.dataTransfer.files))
    return
  }
  const sourceId = event.dataTransfer?.getData('application/x-aisvc-node-id') || event.dataTransfer?.getData('text/plain')
  if (!sourceId) return
  const result = objectTree.moveNode(sourceId, target.id)
  if (result.ok) {
    if (target.kind === 'folder' || target.kind === 'trackFolder') ui.expanded[pane].add(target.id)
    flash('已移动')
  } else {
    flash(result.reason ?? '无法移动')
  }
}

async function importDroppedFiles(pane: 'L1' | 'L2', target: TreeNode, files: File[]) {
  const result = await objectTree.importFilesToFolder(target.id, files)
  if (result.ok) {
    if (target.kind === 'folder' || target.kind === 'trackFolder') ui.expanded[pane].add(target.id)
    flash(`已导入 ${result.ids?.length ?? 0} 个文件`)
  } else {
    flash(result.reason ?? '无法导入')
  }
}

function allowTreeDrop(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}

function flash(message: string) {
  ui.flashNotice(message)
}

function handleContextMenu(node: TreeNode, event: MouseEvent) {
  event.preventDefault()
  menu.value = { visible: true, x: event.clientX, y: event.clientY, node }
  setTimeout(() => window.addEventListener('click', closeMenu, { once: true }), 0)
}

function closeMenu() {
  menu.value.visible = false
}

function createFolderHere() {
  const node = menu.value.node
  closeMenu()
  if (!node || (node.kind !== 'folder' && node.kind !== 'trackFolder')) return
  const name = window.prompt('新建文件夹名称', '新建文件夹')
  if (name == null) return
  const result = objectTree.createFolder(node.id, name)
  flash(result.ok ? '已新建文件夹' : result.reason ?? '无法新建文件夹')
}

function renameNode() {
  const node = menu.value.node
  closeMenu()
  if (!node) return
  const name = window.prompt('重命名', node.name)
  if (name == null) return
  const result = objectTree.renameNode(node.id, name)
  flash(result.ok ? '已重命名' : result.reason ?? '无法重命名')
}

function deleteFolder() {
  const node = menu.value.node
  closeMenu()
  if (!node) return
  if (!window.confirm(`删除 "${node.name}"？`)) return
  const result = objectTree.deleteNode(node.id)
  flash(result.ok ? '已删除' : result.reason ?? '无法删除')
}

function openTextEditor() {
  const node = menu.value.node
  closeMenu()
  if (node?.kind === 'text') editorWorkspace.openTextObjectTab(node.id, node.name)
}

function locateInL2(id: NodeId) {
  ui.locateInL2(objectTree.index.parentById, id)
  nextTick(() => {
    document.getElementById(rowDomId('L2', id))?.scrollIntoView({ block: 'nearest' })
  })
}

function rowDomId(pane: 'L1' | 'L2', id: NodeId) {
  return `tree-row-${pane}-${cssSafeId(id)}`
}

function cssSafeId(id: NodeId) {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_')
}
</script>

<template>
  <div class="sidebar" :style="sidebarStyle">
    <div class="tree-pane" :class="{ collapsed: uiSettings.settings.l1Collapsed }">
      <div class="pane-header">
        <span>L1</span>
        <div class="pane-actions">
          <button v-if="!uiSettings.settings.l1Collapsed" class="mini-btn" :disabled="ui.selectedIds.length !== 1" @click="locateInL2(ui.selectedIds[0])">L2</button>
          <button class="collapse-btn" title="收起/展开 L1" @click="uiSettings.settings.l1Collapsed = !uiSettings.settings.l1Collapsed">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path :d="uiSettings.settings.l1Collapsed ? 'M6 3l5 5-5 5V3Z' : 'M10 3 5 8l5 5V3Z'" /></svg>
          </button>
        </div>
      </div>
      <div v-if="!uiSettings.settings.l1Collapsed" class="tree-scroll">
        <ObjectTreeRows
          v-for="node in rootChildren"
          :key="'l1-' + node.id"
          pane="L1"
          :node="node"
          :depth="0"
          :has-children="hasChildren"
          :icon="icon"
          :handle-node-click="handleNodeClick"
          :handle-node-drop="handleNodeDrop"
          :allow-tree-drop="allowTreeDrop"
          :handle-context-menu="handleContextMenu"
          :handle-node-dbl-click="handleNodeDblClick"
          :row-dom-id="rowDomId"
        />
      </div>
    </div>

    <div class="tree-pane" :class="{ collapsed: uiSettings.settings.l2Collapsed }">
      <div class="pane-header">
        <span>L2</span>
        <button class="collapse-btn" title="收起/展开 L2" @click="uiSettings.settings.l2Collapsed = !uiSettings.settings.l2Collapsed">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path :d="uiSettings.settings.l2Collapsed ? 'M10 3 5 8l5 5V3Z' : 'M6 3l5 5-5 5V3Z'" /></svg>
        </button>
      </div>
      <div v-if="!uiSettings.settings.l2Collapsed" class="tree-scroll">
        <ObjectTreeRows
          v-for="node in rootChildren"
          :key="'l2-' + node.id"
          pane="L2"
          :node="node"
          :depth="0"
          :has-children="hasChildren"
          :icon="icon"
          :handle-node-click="handleNodeClick"
          :handle-node-drop="handleNodeDrop"
          :allow-tree-drop="allowTreeDrop"
          :handle-context-menu="handleContextMenu"
          :handle-node-dbl-click="handleNodeDblClick"
          :row-dom-id="rowDomId"
        />
      </div>
    </div>
    <div class="tree-notice">{{ ui.notice }}</div>
    <Teleport to="body">
      <div
        v-if="menu.visible"
        class="tree-context-menu"
        :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
        @click.stop
      >
        <div v-if="menu.node?.kind === 'folder' || menu.node?.kind === 'trackFolder'" class="tree-menu-item" @click="createFolderHere">新建文件夹</div>
        <div v-if="menu.node && !menu.node.id.startsWith('project:/')" class="tree-menu-item" @click="renameNode">重命名</div>
        <div v-if="menu.node?.kind === 'text'" class="tree-menu-item" @click="openTextEditor">打开文本编辑器</div>
        <div v-if="menu.node?.kind === 'folder' || menu.node?.kind === 'trackFolder'" class="tree-menu-item danger" @click="deleteFolder">删除文件夹</div>
        <div v-if="menu.node?.kind === 'audio' || menu.node?.kind === 'group' || menu.node?.kind === 'trackObject' || menu.node?.kind === 'trackFolder'" class="tree-menu-item danger" @click="deleteFolder">删除</div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.sidebar {
  background: color-mix(in srgb, var(--app-panel) var(--side-opacity-percent), transparent);
  border-right: 1px solid var(--app-border);
  backdrop-filter: var(--sidebar-backdrop-filter);
  display: grid;
  grid-template-rows: 1fr auto;
  flex-shrink: 0;
  width: 260px;
  min-width: 80px;
}
.tree-notice {
  grid-column: 1 / -1;
  min-height: 18px;
  padding: 2px 8px 6px;
  font-size: 11px;
  color: var(--app-warning, #b7791f);
  border-top: 1px solid var(--app-border);
}
.tree-pane {
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--app-border);
}
.tree-pane.collapsed {
  min-width: 32px;
}
.tree-pane:last-child { border-right: 0; }
.pane-header {
  height: 34px;
  padding: 0 8px;
  border-bottom: 1px solid var(--app-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--app-muted);
  font-weight: 600;
}
.tree-pane.collapsed .pane-header {
  padding: 0 4px;
  writing-mode: vertical-rl;
  gap: 6px;
}
.pane-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.tree-scroll {
  flex: 1;
  overflow: auto;
  padding: 4px 0;
}
.mini-btn {
  border: 1px solid var(--app-border);
  background: var(--app-surface);
  color: var(--app-muted);
  border-radius: 3px;
  font-size: 10px;
  padding: 1px 4px;
}
.collapse-btn {
  width: 20px;
  height: 20px;
  border: 1px solid var(--app-border);
  border-radius: 3px;
  background: var(--app-surface);
  color: var(--app-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  cursor: pointer;
}
.collapse-btn svg { width: 12px; height: 12px; fill: currentColor; }
.mini-btn:disabled {
  opacity: 0.35;
}
</style>

<style>
.tree-row {
  display: grid;
  grid-template-columns: 12px 28px minmax(0, 1fr) 20px;
  align-items: center;
  gap: 4px;
  height: 24px;
  font-size: 12px;
  color: var(--app-text);
  cursor: default;
  user-select: none;
}
.tree-row:hover { background: var(--app-hover); }
.tree-row.selected { background: var(--app-selected); outline: 1px solid var(--app-accent); }
.tree-row.located { background: var(--app-located); }
.tree-row.folder { color: var(--app-muted); }
.tree-row.virtual-member { color: var(--app-muted); font-size: 11px; }
.twisty { color: var(--app-muted); text-align: center; font-size: 13px; }
.twisty svg { width: 12px; height: 12px; fill: currentColor; transition: transform 120ms ease; }
.twisty svg.expanded { transform: rotate(90deg); }
.kind {
  font-size: 9px;
  color: var(--app-muted);
  text-transform: uppercase;
}
.name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.tree-play-btn {
  width: 18px;
  height: 18px;
  border: 1px solid var(--app-border);
  border-radius: 3px;
  background: var(--app-surface);
  color: var(--app-muted);
  font-size: 9px;
  line-height: 16px;
  padding: 0;
  cursor: pointer;
}
.tree-play-btn svg { width: 11px; height: 11px; fill: currentColor; }
.tree-play-btn:hover {
  border-color: var(--app-accent);
  color: var(--app-text);
}
.tree-context-menu {
  position: fixed;
  z-index: 10000;
  min-width: 130px;
  padding: 4px 0;
  background: var(--app-panel);
  border: 1px solid var(--app-border);
  border-radius: 4px;
  box-shadow: 0 6px 18px rgba(0,0,0,0.35);
}
.tree-menu-item {
  padding: 6px 12px;
  font-size: 12px;
  color: var(--app-text);
  cursor: pointer;
}
.tree-menu-item:hover { background: var(--app-hover); }
.tree-menu-item.danger { color: #f85149; }
</style>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { useObjectTreeStore } from '@/stores/objectTree'
import { useObjectTreeUiStore } from '@/stores/objectTreeUi'
import { useSelectionStore } from '@/stores/selection'
import { useUiSettingsStore } from '@/stores/uiSettings'
import { useEditorWorkspaceStore } from '@/stores/editorWorkspace'
import { useGlobalResourcesStore } from '@/stores/globalResources'
import type { NodeId, TreeNode } from '@/object-workbench'
import ObjectTreeRows from './ObjectTreeRows.vue'

const objectTree = useObjectTreeStore()
const ui = useObjectTreeUiStore()
const selection = useSelectionStore()
const uiSettings = useUiSettingsStore()
const editorWorkspace = useEditorWorkspaceStore()
const globalResources = useGlobalResourcesStore()
const menu = ref<{ visible: boolean; x: number; y: number; node: TreeNode | null }>({ visible: false, x: 0, y: 0, node: null })

const rootChildren = computed(() => objectTree.tree.root.children)
const l2Width = computed(() => uiSettings.settings.sidebarWidth - uiSettings.settings.l1Width)
const sidebarStyle = computed(() => {
  const l1 = uiSettings.settings.l1Collapsed ? 34 : uiSettings.settings.l1Width
  const l2 = uiSettings.settings.l2Collapsed ? 34 : l2Width.value
  return {
    width: `${l1 + l2}px`,
    gridTemplateColumns: `${l1}px ${l2}px`,
  }
})
const paneDividerStyle = computed(() => ({ left: `${uiSettings.settings.l1Width}px` }))

let stopResize: (() => void) | null = null

function beginSidebarResize(event: PointerEvent) {
  if (uiSettings.settings.l1Collapsed && uiSettings.settings.l2Collapsed) return
  const startX = event.clientX
  const startSidebarWidth = uiSettings.settings.sidebarWidth
  const startL1Width = uiSettings.settings.l1Width
  const startL2Width = l2Width.value
  beginResize(event, currentX => {
    const delta = currentX - startX
    if (uiSettings.settings.l1Collapsed) {
      const nextL2 = clamp(startL2Width + delta, 100, 370)
      uiSettings.settings.sidebarWidth = startL1Width + nextL2
    } else {
      const nextTotal = clamp(startSidebarWidth + delta, 240, 600)
      uiSettings.settings.sidebarWidth = nextTotal
      uiSettings.settings.l1Width = clamp(nextTotal - startL2Width, 140, nextTotal - 100)
    }
  })
}

function beginPaneResize(event: PointerEvent) {
  const startX = event.clientX
  const startL1Width = uiSettings.settings.l1Width
  beginResize(event, currentX => {
    uiSettings.settings.l1Width = clamp(startL1Width + currentX - startX, 140, uiSettings.settings.sidebarWidth - 100)
  })
}

function beginResize(event: PointerEvent, move: (clientX: number) => void) {
  event.preventDefault()
  stopResize?.()
  const handle = event.currentTarget as HTMLElement
  handle.setPointerCapture(event.pointerId)
  document.body.classList.add('resizing-sidebar')
  const onMove = (moveEvent: PointerEvent) => move(moveEvent.clientX)
  const onUp = () => stopResize?.()
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
  stopResize = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
    document.body.classList.remove('resizing-sidebar')
    stopResize = null
  }
}

function resetSidebarWidth() {
  uiSettings.settings.sidebarWidth = 360
  uiSettings.settings.l1Width = 230
}

function resetPaneWidths() {
  uiSettings.settings.l1Width = clamp(230, 140, uiSettings.settings.sidebarWidth - 100)
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

onBeforeUnmount(() => stopResize?.())

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

async function toggleGlobalResource() {
  const node = menu.value.node
  closeMenu()
  if (!node) return
  try {
    if (globalResources.isGlobal(node.id)) {
      await globalResources.unpublish(node.id)
      flash('已移出全局 Resource；项目副本保持不变')
    } else {
      await globalResources.publish(node.id)
      flash('已加入全局 Resource')
    }
  } catch (error: any) {
    flash(error?.message || '全局 Resource 操作失败')
  }
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
    <div class="tree-pane l1-pane" :class="{ collapsed: uiSettings.settings.l1Collapsed }">
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

    <div class="tree-pane l2-pane" :class="{ collapsed: uiSettings.settings.l2Collapsed }">
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
    <div
      v-if="!uiSettings.settings.l1Collapsed && !uiSettings.settings.l2Collapsed"
      class="pane-resize-handle"
      :style="paneDividerStyle"
      title="拖动调整 L1/L2 宽度；双击恢复默认"
      @pointerdown="beginPaneResize"
      @dblclick="resetPaneWidths"
    />
    <div
      v-if="!uiSettings.settings.l1Collapsed || !uiSettings.settings.l2Collapsed"
      class="sidebar-resize-handle"
      title="拖动调整侧栏宽度；双击恢复默认"
      @pointerdown="beginSidebarResize"
      @dblclick="resetSidebarWidth"
    />
    <div class="tree-notice">{{ ui.notice }}</div>
    <Teleport to="body">
      <div
        v-if="menu.visible"
        :class="['tree-context-menu', uiSettings.rootClass]"
        :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
        @click.stop
      >
        <div v-if="menu.node?.kind === 'folder' || menu.node?.kind === 'trackFolder'" class="tree-menu-item" @click="createFolderHere">新建文件夹</div>
        <div v-if="menu.node && !menu.node.id.startsWith('project:/')" class="tree-menu-item" @click="renameNode">重命名</div>
        <div v-if="menu.node?.kind === 'text'" class="tree-menu-item" @click="openTextEditor">打开文本编辑器</div>
        <div v-if="menu.node && (globalResources.isGlobal(menu.node.id) || globalResources.canPublish(menu.node))" class="tree-menu-item" @click="toggleGlobalResource">{{ globalResources.isGlobal(menu.node.id) ? '移出全局 Resource' : '加入全局 Resource' }}</div>
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
  position: relative;
  z-index: 2;
}
.pane-resize-handle,
.sidebar-resize-handle {
  position: absolute;
  z-index: 20;
  top: 0;
  bottom: 0;
  width: 12px;
  cursor: col-resize;
  touch-action: none;
}
.pane-resize-handle { transform: translateX(-6px); }
.sidebar-resize-handle { right: -6px; }
.pane-resize-handle:hover::after,
.sidebar-resize-handle:hover::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 5px;
  width: 1px;
  background: var(--app-accent);
}
.tree-notice {
  grid-column: 1 / -1;
  grid-row: 2;
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
.l1-pane {
  grid-column: 1;
  grid-row: 1;
}
.l2-pane {
  grid-column: 2;
  grid-row: 1;
  border-right: 0;
}
.tree-pane.collapsed {
  min-width: 32px;
}
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
  grid-template-columns: 12px 40px minmax(0, 1fr) 20px;
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
  min-width: 0;
  overflow: hidden;
  font-size: 9px;
  color: var(--app-muted);
  text-transform: uppercase;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.global-resource-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 6px;
  border-radius: 50%;
  background: #000;
  border: 1px solid rgba(255, 255, 255, 0.72);
  box-sizing: border-box;
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
  --menu-bg: #161b22;
  --menu-border: #30363d;
  --menu-text: #c9d1d9;
  --menu-hover: #21262d;
  position: fixed;
  z-index: 10000;
  min-width: 130px;
  padding: 4px 0;
  background: var(--menu-bg);
  border: 1px solid var(--menu-border);
  border-radius: 4px;
  box-shadow: 0 6px 18px rgba(0,0,0,0.35);
}
.tree-context-menu.theme-light {
  --menu-bg: #ffffff;
  --menu-border: #d7dde4;
  --menu-text: #1f2328;
  --menu-hover: #e7edf3;
}
.tree-context-menu.theme-cream {
  --menu-bg: #fff8dc;
  --menu-border: #d7c58f;
  --menu-text: #2f2517;
  --menu-hover: #efe1b8;
}
.tree-menu-item {
  padding: 6px 12px;
  font-size: 12px;
  color: var(--menu-text);
  cursor: pointer;
}
.tree-menu-item:hover { background: var(--menu-hover); }
.tree-menu-item.danger { color: #f85149; }
body.resizing-sidebar {
  cursor: col-resize;
  user-select: none;
}
</style>

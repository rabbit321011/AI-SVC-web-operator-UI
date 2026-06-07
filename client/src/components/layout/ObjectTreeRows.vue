<script setup lang="ts">
import { computed } from 'vue'
import { useObjectTreeUiStore } from '@/stores/objectTreeUi'
import type { TreeNode } from '@/object-workbench'

const props = defineProps<{
  pane: 'L1' | 'L2'
  node: TreeNode
  depth: number
  hasChildren: (node: TreeNode) => node is Extract<TreeNode, { children: TreeNode[] }>
  icon: (node: TreeNode) => string
  handleNodeClick: (pane: 'L1' | 'L2', node: TreeNode, event: MouseEvent) => void
  handleNodeDrop: (pane: 'L1' | 'L2', node: TreeNode, event: DragEvent) => void
  allowTreeDrop: (event: DragEvent) => void
  handleContextMenu: (node: TreeNode, event: MouseEvent) => void
  rowDomId: (pane: 'L1' | 'L2', id: string) => string
}>()

const ui = useObjectTreeUiStore()
const expandable = computed(() => props.hasChildren(props.node) || (props.node.kind === 'group' && props.node.group.trackObjectIds.length > 0))
const expanded = computed(() => ui.isExpanded(props.pane, props.node.id))
const children = computed(() => props.hasChildren(props.node) ? props.node.children : [])
const groupMemberIds = computed(() => props.node.kind === 'group' && expanded.value ? props.node.group.trackObjectIds : [])

function toggleExpanded(event: MouseEvent) {
  event.stopPropagation()
  if (expandable.value) ui.toggleExpanded(props.pane, props.node.id)
}

function handleDragStart(event: DragEvent) {
  event.dataTransfer?.setData('application/x-aisvc-node-id', props.node.id)
  event.dataTransfer?.setData('text/plain', props.node.id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copyMove'
}

function handleVirtualMemberClick(trackObjectId: string, event: MouseEvent) {
  ui.selectById(trackObjectId, event.ctrlKey || event.metaKey)
  ui.locateHighlight[props.pane] = trackObjectId
  window.setTimeout(() => {
    if (ui.locateHighlight[props.pane] === trackObjectId) ui.locateHighlight[props.pane] = null
  }, 500)
}
</script>

<template>
  <div>
    <div
      :id="rowDomId(pane, node.id)"
      class="tree-row"
      :class="{
        selected: ui.isSelected(node.id),
        located: ui.locateHighlight[pane] === node.id,
        folder: node.kind === 'folder',
      }"
      :style="{ paddingLeft: `${8 + depth * 12}px` }"
      :title="node.name"
      draggable="true"
      @click="handleNodeClick(pane, node, $event)"
      @dragstart="handleDragStart"
      @dragover="(node.kind === 'folder' || node.kind === 'trackFolder') ? allowTreeDrop($event) : undefined"
      @drop="(node.kind === 'folder' || node.kind === 'trackFolder') ? handleNodeDrop(pane, node, $event) : undefined"
      @contextmenu="handleContextMenu(node, $event)"
    >
      <span class="twisty" @click="toggleExpanded">{{ expandable ? (expanded ? '▾' : '▸') : '·' }}</span>
      <span class="kind">{{ icon(node) }}</span>
      <span class="name">{{ node.name }}</span>
    </div>
    <div
      v-for="memberId in groupMemberIds"
      :id="rowDomId(pane, memberId)"
      :key="`${pane}-${node.id}-${memberId}`"
      class="tree-row virtual-member"
      :class="{ selected: ui.isSelected(memberId), located: ui.locateHighlight[pane] === memberId }"
      :style="{ paddingLeft: `${8 + (depth + 1) * 12}px` }"
      :title="memberId"
      @click.stop="handleVirtualMemberClick(memberId, $event)"
    >
      <span class="twisty">·</span>
      <span class="kind">mem</span>
      <span class="name">{{ memberId }}</span>
    </div>
    <ObjectTreeRows
      v-if="expandable && expanded"
      v-for="child in children"
      :key="`${pane}-${child.id}`"
      :pane="pane"
      :node="child"
      :depth="depth + 1"
      :has-children="hasChildren"
      :icon="icon"
      :handle-node-click="handleNodeClick"
      :handle-node-drop="handleNodeDrop"
      :allow-tree-drop="allowTreeDrop"
      :handle-context-menu="handleContextMenu"
      :row-dom-id="rowDomId"
    />
  </div>
</template>

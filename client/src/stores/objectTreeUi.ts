import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import type { NodeId, TreeNode } from '@/object-workbench'

type PaneId = 'L1' | 'L2'

export const useObjectTreeUiStore = defineStore('objectTreeUi', () => {
  const selected = ref<Set<NodeId>>(new Set())
  const expanded = reactive<Record<PaneId, Set<NodeId>>>({
    L1: new Set(),
    L2: new Set(),
  })
  const locateHighlight = reactive<Record<PaneId, NodeId | null>>({
    L1: null,
    L2: null,
  })

  const selectedIds = computed(() => [...selected.value])

  function isSelectable(node: TreeNode): boolean {
    return node.kind !== 'folder'
  }

  function isSelected(id: NodeId): boolean {
    return selected.value.has(id)
  }

  function selectNode(node: TreeNode, additive = false) {
    if (!isSelectable(node)) return
    if (!additive) {
      selected.value = new Set([node.id])
      return
    }
    const next = new Set(selected.value)
    if (next.has(node.id)) next.delete(node.id)
    else next.add(node.id)
    selected.value = next
  }

  function clearSelection() {
    selected.value = new Set()
  }

  function isExpanded(pane: PaneId, id: NodeId): boolean {
    return expanded[pane].has(id)
  }

  function toggleExpanded(pane: PaneId, id: NodeId) {
    if (expanded[pane].has(id)) expanded[pane].delete(id)
    else expanded[pane].add(id)
  }

  function expandPath(pane: PaneId, parentById: Record<NodeId, NodeId | null>, id: NodeId) {
    let current = parentById[id]
    while (current) {
      expanded[pane].add(current)
      current = parentById[current]
    }
  }

  function locateInL2(parentById: Record<NodeId, NodeId | null>, id: NodeId) {
    expandPath('L2', parentById, id)
    locateHighlight.L2 = id
    window.setTimeout(() => {
      if (locateHighlight.L2 === id) locateHighlight.L2 = null
    }, 500)
  }

  function selectById(id: NodeId, additive = false) {
    if (!additive) {
      selected.value = new Set([id])
      return
    }
    const next = new Set(selected.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selected.value = next
  }

  return {
    selected,
    selectedIds,
    expanded,
    locateHighlight,
    isSelectable,
    isSelected,
    selectNode,
    selectById,
    clearSelection,
    isExpanded,
    toggleExpanded,
    expandPath,
    locateInL2,
  }
})

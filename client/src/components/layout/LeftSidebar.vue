<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { useCompGroupsStore } from '@/stores/compGroups'
import { useSelectionStore } from '@/stores/selection'
import { useTracksStore } from '@/stores/tracks'
import { usePlaybackStore } from '@/stores/playback'
import { NButton, NProgress, NTag } from 'naive-ui'

const compGroups = useCompGroupsStore()
const selection = useSelectionStore()
const tracks = useTracksStore()
const playback = usePlaybackStore()

const editingGid = ref<string | null>(null)
const editGroupName = ref('')

function handleClick(groupId: string, e: MouseEvent) {
  if (e.detail === 2) {
    compGroups.toggleExpand(groupId)
    return
  }
  if (!selection.isSelected(groupId)) {
    selection.select(groupId, false)
  }
}

function handleGroupDblClick(groupId: string) {
  const group = compGroups.compGroups[groupId]
  if (!group) return
  editGroupName.value = group.name
  editingGid.value = groupId
  nextTick(() => {
    const el = document.querySelector('.group-name-input') as HTMLInputElement
    el?.focus()
    el?.select()
  })
}

function finishGroupRename() {
  const name = editGroupName.value.trim()
  const gid = editingGid.value
  if (name && gid) {
    compGroups.rename(gid, name)
    // Sync bound result track name if any
    const group = compGroups.compGroups[gid]
    if (group?.svcResult?.trackId) {
      tracks.renameTrack(group.svcResult.trackId, `${name} (SVC)`)
    }
  }
  editingGid.value = null
}

function cancelGroupRename() {
  editingGid.value = null
}

function handleLocate(groupId: string) {
  const group = compGroups.compGroups[groupId]
  if (!group) return
  const firstStart = Math.min(...group.elements.map(e => e.startTime))
  if (firstStart < Infinity) {
    playback.setCurrentTime(firstStart)
  }
}

function handleSpaceClick(groupId: string) {
  const ok = compGroups.checkIntegrity(groupId)
  if (ok) {
    const group = compGroups.compGroups[groupId]
    if (!group) return
    const ids = group.elements.map(e => e.id)
    selection.selectAll(ids, 'segments')
  }
}

function getStatusTag(gid: string) {
  const svc = compGroups.compGroups[gid]?.svcResult
  if (!svc) return null
  switch (svc.status) {
    case 'running': return { type: 'warning' as const, text: '合成中' }
    case 'done': return { type: 'success' as const, text: '✅ 完成' }
    case 'failed': return { type: 'error' as const, text: '❌ 失败' }
    default: return { type: 'default' as const, text: svc.status }
  }
}
</script>

<template>
  <div class="sidebar" :class="{ collapsed: false }">
    <div class="sidebar-header">
      <span class="sidebar-title">合成组</span>
    </div>
    <div class="group-list">
      <div
        v-for="gid in compGroups.compGroupOrder"
        :key="gid"
        class="group-item"
        :class="{
          selected: selection.isSelected(gid),
          expanded: compGroups.compGroups[gid]?.expanded,
        }"
        @click="handleClick(gid, $event)"
      >
        <div class="group-row">
          <span
            v-if="editingGid !== gid"
            class="group-name"
            :title="compGroups.compGroups[gid]?.name ?? ''"
            @dblclick.stop="handleGroupDblClick(gid)"
          >{{ compGroups.compGroups[gid]?.name }}</span>
          <input
            v-else
            v-model="editGroupName"
            class="group-name-input"
            maxlength="40"
            @keyup.enter="finishGroupRename"
            @keyup.escape="cancelGroupRename"
            @blur="finishGroupRename"
            @click.stop
          />
          <button
            class="locate-btn"
            title="定位到合成组"
            @click.stop="handleLocate(gid)"
          >●</button>
          <button
            class="delete-group-btn"
            title="删除合成组"
            @click.stop="compGroups.remove(gid)"
          >×</button>
        </div>
        <div class="group-meta">
          <span class="elem-count">{{ compGroups.compGroups[gid]?.elements?.length ?? 0 }} 元素</span>
        </div>
        <div
          v-if="compGroups.compGroups[gid]?.svcResult"
          class="svc-info"
        >
          <div class="svc-row">
            <n-tag
              v-if="getStatusTag(gid)"
              size="tiny"
              :type="getStatusTag(gid)!.type"
              :bordered="false"
            >{{ getStatusTag(gid)!.text }}</n-tag>
            <span v-if="compGroups.compGroups[gid]?.svcResult?.progress === 100" class="svc-model">
              {{ compGroups.compGroups[gid]?.svcResult?.modelName }}
            </span>
          </div>
          <n-progress
            v-if="compGroups.compGroups[gid]?.svcResult?.status === 'running'"
            type="line"
            :percentage="compGroups.compGroups[gid]?.svcResult?.progress ?? 0"
            :height="4"
            :indicator-placement="'inside'"
            processing
          />
        </div>
      </div>
      <div v-if="compGroups.compGroupOrder.length === 0" class="empty-hint">
        选中片段后按 Enter 创建合成组
      </div>
    </div>
  </div>
</template>

<style scoped>
.sidebar {
  width: 180px;
  background: #161b22;
  border-right: 1px solid #21262d;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.sidebar.collapsed { width: 40px; }
.sidebar-header {
  padding: 10px 12px;
  border-bottom: 1px solid #21262d;
  display: flex;
  align-items: center;
  gap: 6px;
}
.sidebar-title { font-size: 12px; font-weight: 600; color: #8b949e; text-transform: uppercase; }
.group-list { flex: 1; overflow-y: auto; padding: 6px; }
.group-item {
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 4px;
  transition: background 0.15s;
}
.group-item:hover { background: #21262d; }
.group-item.selected { background: #1f3a5f; border: 1px solid #58a6ff; }
.group-item.expanded { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
.group-row { display: flex; align-items: center; gap: 4px; }
.group-name { font-size: 13px; color: #c9d1d9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; cursor: default; }
.group-name-input {
  font-size: 13px; background: #0d1117; border: 1px solid #58a6ff;
  border-radius: 3px; color: #c9d1d9; padding: 2px 4px;
  outline: none; flex: 1; width: 100%;
}
.locate-btn {
  width: 16px; height: 16px; font-size: 8px;
  border: none; background: #0d1117; color: #58a6ff;
  border-radius: 50%; cursor: pointer; padding: 0;
  display: flex; align-items: center; justify-content: center;
  opacity: 0;
  transition: opacity 0.15s;
}
.group-item:hover .locate-btn { opacity: 1; }
.group-item:hover .delete-group-btn { opacity: 0.6; }
.delete-group-btn {
  width: 16px; height: 16px; font-size: 14px; line-height: 14px;
  border: none; background: transparent; color: #484f58;
  cursor: pointer; padding: 0; opacity: 0;
  transition: opacity 0.15s;
}
.delete-group-btn:hover { color: #f85149 !important; opacity: 1 !important; }
.group-meta { margin-top: 2px; }
.elem-count { font-size: 10px; color: #484f58; }
.svc-info { margin-top: 4px; }
.svc-row { display: flex; align-items: center; gap: 4px; }
.svc-model { font-size: 10px; color: #6e7681; }
.empty-hint { font-size: 12px; color: #484f58; text-align: center; padding: 20px 8px; }
</style>

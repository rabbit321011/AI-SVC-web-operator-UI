<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NCard, NInput, NSpace, NModal, NGrid, NGridItem, NIcon, NPopconfirm } from 'naive-ui'

const router = useRouter()
const projects = ref<Array<{ name: string; modifiedAt: string }>>([])
const newName = ref('')
const showNewModal = ref(false)
const loading = ref(false)

async function fetchProjects() {
  try {
    const resp = await fetch('/api/projects')
    projects.value = await resp.json()
  } catch { projects.value = [] }
}

onMounted(fetchProjects)

async function createProject() {
  const name = newName.value.trim()
  if (!name) return
  loading.value = true
  try {
    const resp = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!resp.ok) {
      const err = await resp.json()
      alert(err.error || '创建失败')
      return
    }
    const project = await resp.json()
    showNewModal.value = false
    newName.value = ''
    router.push(`/project/${project.name}`)
  } finally { loading.value = false }
}

function openProject(name: string) {
  router.push(`/project/${name}`)
}

async function deleteProject(name: string) {
  await fetch(`/api/projects/${name}`, { method: 'DELETE' })
  fetchProjects()
}

function importProject() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.asvcproj,application/json'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const resp = await fetch('/api/projects/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!resp.ok) { alert('导入失败'); return }
      const result = await resp.json()
      router.push(`/project/${result.name}`)
    } catch (e: any) {
      alert('无法读取项目文件: ' + e.message)
    }
  }
  input.click()
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('zh-CN')
}
</script>

<template>
  <div class="home-root">
    <div class="home-header">
      <h1 class="home-title">🎵 AISVC Midi</h1>
      <p class="home-subtitle">歌词转歌声合成工作站</p>
    </div>

    <div class="home-actions">
      <n-button type="primary" size="large" @click="showNewModal = true">📁 新建项目</n-button>
      <n-button size="large" @click="importProject">📥 导入项目</n-button>
    </div>

    <div class="home-projects" v-if="projects.length > 0">
      <h3>最近项目</h3>
      <n-grid :cols="3" :x-gap="16" :y-gap="16">
        <n-grid-item v-for="p in projects" :key="p.name">
          <n-card hoverable @click="openProject(p.name)">
            <div class="project-card-content">
              <span class="project-icon">📁</span>
              <span class="project-name">{{ p.name }}</span>
            </div>
            <template #footer>
              <div class="project-footer">
                <span class="project-date">{{ formatDate(p.modifiedAt) }}</span>
                <n-popconfirm @positive-click="deleteProject(p.name)">
                  <template #trigger>
                    <n-button text size="tiny" type="error" @click.stop>删除</n-button>
                  </template>
                  确定删除项目「{{ p.name }}」？
                </n-popconfirm>
              </div>
            </template>
          </n-card>
        </n-grid-item>
      </n-grid>
    </div>

    <div class="home-empty" v-else>
      <p>还没有项目，新建一个或导入外部项目文件开始</p>
    </div>

    <n-modal v-model:show="showNewModal" preset="card" title="新建项目" style="width: 400px">
      <n-space vertical>
        <n-input v-model:value="newName" placeholder="输入项目名称" @keyup.enter="createProject" />
        <n-button type="primary" :loading="loading" block @click="createProject">创建</n-button>
      </n-space>
    </n-modal>
  </div>
</template>

<style scoped>
.home-root {
  min-height: 100vh;
  background: #0d1117;
  color: #c9d1d9;
  padding: 60px 80px;
}
.home-header { text-align: center; margin-bottom: 40px; }
.home-title { font-size: 36px; margin: 0; color: #f0f6fc; }
.home-subtitle { font-size: 16px; color: #8b949e; margin-top: 8px; }
.home-actions { display: flex; gap: 16px; justify-content: center; margin-bottom: 48px; }
.home-projects h3 { margin-bottom: 16px; font-size: 18px; color: #8b949e; }
.project-card-content { display: flex; align-items: center; gap: 12px; font-size: 16px; }
.project-icon { font-size: 24px; }
.project-name { color: #c9d1d9; }
.project-footer { display: flex; justify-content: space-between; align-items: center; }
.project-date { font-size: 12px; color: #484f58; }
.home-empty { text-align: center; padding: 60px 0; color: #484f58; font-size: 16px; }
:deep(.n-card) { background: #161b22; border-color: #21262d; cursor: pointer; }
:deep(.n-card:hover) { border-color: #58a6ff; }
</style>

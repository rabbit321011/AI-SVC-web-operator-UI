<script setup lang="ts">
import { NButton, NInput, NInputNumber, NSelect, NSlider, NSwitch, NSpace } from 'naive-ui'
import { useProjectStore } from '@/stores/project'
import { useSvcConfigStore } from '@/stores/svcConfig'
import { useUiSettingsStore, type WorkbenchTheme } from '@/stores/uiSettings'

const uiSettings = useUiSettingsStore()
const project = useProjectStore()
const svcConfig = useSvcConfigStore()

const themeOptions: Array<{ label: string; value: WorkbenchTheme }> = [
  { label: 'Light', value: 'light' },
  { label: 'Night', value: 'night' },
  { label: '奶黄', value: 'cream' },
]

const modelOptions = svcConfig.presets.map(p => ({ label: p.modelName, value: p.modelName }))

function importBackgroundImage() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    if (!project.name) {
      window.alert('当前项目名称为空，无法保存背景图片')
      return
    }
    try {
      const dataUrl = await readFileAsDataUrl(file)
      const resp = await fetch(`/api/projects/${encodeURIComponent(project.name)}/ui/background`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type,
          dataBase64: dataUrl,
        }),
      })
      const result = await resp.json()
      if (!resp.ok) throw new Error(result.error || '上传失败')
      const saved = uiSettings.setBackgroundImageUrl(result.url)
      if (!saved.ok) throw new Error(saved.reason || '保存背景图片失败')
    } catch (error: any) {
      window.alert(`背景图片上传失败: ${error.message}`)
    }
  }
  input.click()
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}
</script>

<template>
  <div class="settings-page">
    <header class="settings-head">
      <h1>设置</h1>
      <p>工作台外观、默认参数和本地偏好。</p>
    </header>

    <section class="settings-section">
      <h2>外观</h2>
      <div class="settings-grid">
        <label>Theme</label>
        <n-select v-model:value="uiSettings.settings.theme" :options="themeOptions" size="small" />

        <label>中栏透明度</label>
        <n-slider v-model:value="uiSettings.settings.centerOpacity" :min="0.2" :max="1" :step="0.05" />

        <label>左右栏透明度</label>
        <n-slider v-model:value="uiSettings.settings.sideOpacity" :min="0.2" :max="1" :step="0.05" />

        <label>顶栏透明度</label>
        <n-slider v-model:value="uiSettings.settings.topbarOpacity" :min="0.2" :max="1" :step="0.05" />

        <label>背景图片</label>
        <n-space>
          <n-switch v-model:value="uiSettings.settings.backgroundImageEnabled" />
          <n-button size="small" @click="importBackgroundImage">导入</n-button>
          <n-button size="small" :disabled="!uiSettings.settings.backgroundImageUrl && !uiSettings.settings.backgroundImageDataUrl" @click="uiSettings.clearBackgroundImage">清除</n-button>
        </n-space>

        <label>左右栏毛玻璃</label>
        <n-switch v-model:value="uiSettings.settings.sidebarGlassEnabled" />

        <label>中栏毛玻璃</label>
        <n-switch v-model:value="uiSettings.settings.centerGlassEnabled" />
      </div>
    </section>

    <section class="settings-section">
      <h2>自动保存</h2>
      <div class="settings-grid compact">
        <label>间隔分钟</label>
        <n-input-number v-model:value="uiSettings.settings.autoSaveIntervalMinutes" size="small" :min="1" :max="120" :step="1" />
      </div>
    </section>

    <section class="settings-section">
      <h2>默认推理参数</h2>
      <div class="settings-grid">
        <label>SVC 默认模型</label>
        <n-select v-model:value="uiSettings.settings.svcDefaultModel" :options="modelOptions" size="small" clearable />

        <label>SVC 默认 step</label>
        <n-input-number v-model:value="uiSettings.settings.svcDefaultSteps" size="small" :min="1" :max="200" :step="1" />

        <label>SVC 默认 cfg</label>
        <n-input-number v-model:value="uiSettings.settings.svcDefaultCfg" size="small" :min="0" :max="10" :step="0.1" />

        <label>SVS 默认模型</label>
        <n-input v-model:value="uiSettings.settings.svsDefaultModel" size="small" placeholder="SVS model" />

        <label>SVS 默认 step</label>
        <n-input-number v-model:value="uiSettings.settings.svsDefaultSteps" size="small" :min="1" :max="200" :step="1" />
      </div>
    </section>

    <footer class="settings-foot">
      <n-button size="small" @click="uiSettings.reset">恢复默认</n-button>
    </footer>
  </div>
</template>

<style scoped>
.settings-page {
  flex: 1;
  overflow: auto;
  padding: 24px 28px;
  color: var(--app-text);
}
.settings-head {
  margin-bottom: 22px;
}
.settings-head h1 {
  font-size: 22px;
  font-weight: 650;
  margin: 0 0 4px;
}
.settings-head p {
  margin: 0;
  font-size: 13px;
  color: var(--app-muted);
}
.settings-section {
  max-width: 760px;
  padding: 16px 0;
  border-top: 1px solid var(--app-border);
}
.settings-section h2 {
  font-size: 14px;
  margin: 0 0 12px;
  color: var(--app-text);
}
.settings-grid {
  display: grid;
  grid-template-columns: 150px minmax(220px, 360px);
  gap: 12px 16px;
  align-items: center;
}
.settings-grid.compact {
  grid-template-columns: 150px 180px;
}
.settings-grid label {
  font-size: 12px;
  color: var(--app-muted);
}
.settings-foot {
  max-width: 760px;
  padding-top: 16px;
  border-top: 1px solid var(--app-border);
}
</style>

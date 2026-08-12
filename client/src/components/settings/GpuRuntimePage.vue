<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { NButton, NProgress, NTag } from 'naive-ui'
import { useGpuRuntimeStore, type ModelCatalogItem } from '@/stores/gpuRuntime'

const gpuRuntime = useGpuRuntimeStore()
const notice = ref('')
const manualRefreshing = ref(false)
let timer = 0

const devices = computed(() => gpuRuntime.status?.gpus ?? [])
const processes = computed(() => (gpuRuntime.status?.processes ?? [])
  .filter(item => item.status === 'running' || item.status === 'releasing'))
const runtimes = computed(() => gpuRuntime.runtimes)
const svsModels = computed(() => (gpuRuntime.status?.catalog ?? []).filter(item => item.family === 'svs'))
const analysisModels = computed(() => (gpuRuntime.status?.catalog ?? []).filter(item => item.family === 'analysis'))

onMounted(() => {
  void gpuRuntime.refresh()
  void gpuRuntime.fetchRuntimeMode()
  timer = window.setInterval(() => void gpuRuntime.refresh(), 2000)
})
onUnmounted(() => window.clearInterval(timer))

async function releaseProcess(id: string) {
  if (!window.confirm('取消该 GPU 任务并释放其显存？未完成的输出不会作为结果使用。')) return
  try {
    await gpuRuntime.releaseProcess(id)
    flash('释放命令已发送')
  } catch (error: any) {
    flash(error?.message || '释放失败')
  }
}

async function releaseAll() {
  if (processes.value.length === 0 && runtimes.value.length === 0) return flash('当前没有本应用 GPU 任务或常驻模型')
  if (processes.value.length > 0 && !window.confirm('取消所有本应用 GPU 任务并释放显存？')) return
  try {
    const result = await gpuRuntime.releaseAll()
    const runtimeCount = result.runtimes?.released?.length ?? 0
    flash(`已释放 ${result.released.length} 个任务、${runtimeCount} 个常驻模型`)
  } catch (error: any) {
    flash(error?.message || '释放失败')
  }
}

async function loadRuntime(id: string) {
  try {
    await gpuRuntime.loadRuntime(id)
    flash('模型加载中，完成后可重复生成')
  } catch (error: any) {
    flash(error?.message || '模型加载失败')
  }
}

async function unloadRuntime(id: string) {
  const runtime = runtimes.value.find(item => item.id === id)
  if (runtime?.state === 'busy' && !window.confirm('该模型正在推理，释放会取消当前任务。确定继续？')) return
  try {
    await gpuRuntime.unloadRuntime(id)
    flash('模型已释放')
  } catch (error: any) {
    flash(error?.message || '模型释放失败')
  }
}

function flash(message: string) {
  notice.value = message
  window.setTimeout(() => { if (notice.value === message) notice.value = '' }, 2400)
}

async function setMode(mode: 'manual' | 'auto') {
  try {
    await gpuRuntime.setRuntimeMode(mode)
    flash(mode === 'auto' ? '自动模式：显存不足时自动释放最久未使用模型' : '手动模式：显存不足时先询问')
  } catch (error: any) {
    flash(error?.message || '模式设置失败')
  }
}

async function manualRefresh() {
  manualRefreshing.value = true
  try {
    await gpuRuntime.refresh()
  } finally {
    manualRefreshing.value = false
  }
}

function memoryLabel(mib?: number) {
  return mib == null ? '等待 GPU 统计' : `${(mib / 1024).toFixed(2)} GB`
}

function engineLabel(engine: string) {
  if (engine === 'v5p_direct') return 'V5-P Direct Control'
  if (engine === 'v4h_phone_pul') return 'PH / PUL'
  if (engine === 't1') return 'T1'
  return engine
}

function runtimeLabel(state: string) {
  return {
    unloaded: '未加载',
    loading: '加载中',
    ready: '已就绪',
    busy: '推理中',
    releasing: '释放中',
    error: '异常',
  }[state] ?? state
}

function runtimeResidentLabel(runtime: NonNullable<typeof gpuRuntime.runtimes>[number]) {
  const profile = gpuRuntime.status?.catalog.find(item => item.id === runtime.id)?.vramProfile
  const mib = runtime.residentMiB ?? profile?.residentMiB
  return mib != null ? `${(mib / 1024).toFixed(2)} GB` : '等待统计'
}

function profileLabel(profile: ModelCatalogItem['vramProfile']) {
  if (!profile) return '尚未标定'
  const steps = profile.steps ? ` / ${profile.steps}步` : ''
  const curve = profile.samples?.length
    ? profile.samples.map(item => `${item.seconds}s ${((item.peakDeltaMiB ?? 0) / 1024).toFixed(1)}GB`).join(' · ')
    : ''
  return curve ? `${curve}${steps}` : `峰值增量 ${((profile.peakDeltaMiB ?? 0) / 1024).toFixed(1)} GB${steps}`
}

function residentLabel(profile: ModelCatalogItem['vramProfile']) {
  return profile?.residentMiB != null ? `常驻 ${(profile.residentMiB / 1024).toFixed(1)}GB` : '常驻 --'
}
</script>

<template>
  <div class="gpu-page">
    <header class="page-head">
      <div>
        <h1>显存</h1>
        <p>本机 GPU、已配置模型和本应用推理进程。</p>
      </div>
      <div class="head-actions">
        <span v-if="notice" class="notice">{{ notice }}</span>
        <div class="mode-toggle">
          <button type="button" :class="{ active: gpuRuntime.runtimeMode === 'manual' }" @click="setMode('manual')">手动</button>
          <button type="button" :class="{ active: gpuRuntime.runtimeMode === 'auto' }" @click="setMode('auto')">自动</button>
        </div>
        <n-button size="small" :loading="manualRefreshing" @click="manualRefresh">刷新</n-button>
        <n-button size="small" type="error" ghost :disabled="processes.length === 0 && runtimes.length === 0" @click="releaseAll">释放本应用全部显存</n-button>
      </div>
    </header>

    <section v-if="gpuRuntime.error && devices.length === 0" class="error-band">{{ gpuRuntime.error }}</section>

    <section class="gpu-band">
      <article v-for="gpu in devices" :key="gpu.index" class="gpu-device">
        <div class="device-title">
          <strong>GPU {{ gpu.index }}</strong>
          <span>{{ gpu.name }}</span>
          <span class="device-memory">{{ memoryLabel(gpu.usedMiB) }} / {{ memoryLabel(gpu.totalMiB) }}</span>
        </div>
        <n-progress type="line" :percentage="Math.round(gpu.usedMiB / gpu.totalMiB * 100)" :height="10" :show-indicator="false" />
        <div class="device-meta"><span>可用 {{ memoryLabel(gpu.freeMiB) }}</span><span>GPU {{ gpu.utilizationPercent ?? 0 }}%</span></div>
      </article>
    </section>

    <section class="page-section">
      <div class="section-head"><h2>本应用 GPU 任务</h2><span>{{ processes.length }} 个</span></div>
      <div v-if="processes.length === 0" class="empty-row">当前没有运行中的 GPU 任务。现有一次性 Runtime 会在任务结束后自动退出并释放。</div>
      <div v-else class="process-table">
        <div v-for="process in processes" :key="process.id" class="process-row">
          <div><strong>{{ process.modelId || process.kind }}</strong><small>{{ process.id }}</small></div>
          <n-tag size="small" :bordered="false" :type="process.status === 'running' ? 'success' : 'warning'">{{ process.status }}</n-tag>
          <span>PID {{ process.pid }}</span>
          <span>{{ memoryLabel(process.usedGpuMemoryMiB) }}</span>
          <n-button size="tiny" type="error" ghost :disabled="process.status !== 'running'" @click="releaseProcess(process.id)">取消并释放</n-button>
        </div>
      </div>
    </section>

    <section class="page-section">
      <div class="section-head"><h2>驻留 Runtime</h2><span>{{ runtimes.length }} 个</span></div>
      <div v-if="runtimes.length === 0" class="empty-row">尚未加载任何常驻模型。当前一次性 Runtime 仍可正常完成任务。</div>
      <div v-else class="model-table">
        <div v-for="runtime in runtimes" :key="runtime.id" class="runtime-row">
          <div><strong>{{ runtime.modelId }}</strong><small>{{ runtime.device }} · PID {{ runtime.pid ?? '--' }}</small></div>
          <n-tag size="small" :bordered="false" :type="runtime.state === 'ready' ? 'success' : runtime.state === 'busy' ? 'warning' : runtime.state === 'error' ? 'error' : 'default'">
            {{ runtimeLabel(runtime.state) }}
          </n-tag>
          <span>{{ runtimeResidentLabel(runtime) }}</span>
          <span>{{ runtime.activeJobId ? `任务 ${runtime.activeJobId}` : '空闲' }}</span>
          <div class="runtime-actions">
            <n-button size="tiny" type="error" ghost :disabled="runtime.state === 'unloaded' || runtime.state === 'loading' || runtime.state === 'releasing'" @click="unloadRuntime(runtime.id)">释放模型</n-button>
          </div>
        </div>
      </div>
    </section>

    <section class="page-section">
      <div class="section-head"><h2>SVS 模型目录</h2><span>{{ svsModels.length }} 个 preset</span></div>
      <div class="model-table">
        <div v-for="model in svsModels" :key="model.id" class="model-row">
          <div><strong>{{ model.id }}</strong><small>{{ model.checkpoint }}</small></div>
          <span>{{ engineLabel(model.engine) }}</span>
          <n-tag size="small" :bordered="false" :type="model.runtimeState === 'configured' ? 'success' : 'error'">
            {{ model.runtimeState === 'configured' ? '已配置' : '资源缺失' }}
          </n-tag>
          <span class="runtime-kind">{{ profileLabel(model.vramProfile) }}</span>
          <span class="resident-badge">{{ residentLabel(model.vramProfile) }}</span>
          <n-button
            v-if="['V5P_40K_EMA', 'V4Hg_10k', 'V4fg_10k', 'Whisper large-v3', 'SOFA Japanese', 'GAME-1.0-medium'].includes(model.id)"
            size="tiny"
            type="primary"
            ghost
            :loading="runtimes.some(item => item.id === model.id && item.state === 'loading')"
            :disabled="runtimes.some(item => item.id === model.id && item.state !== 'unloaded' && item.state !== 'error')"
            @click="loadRuntime(model.id)"
          >加载模型</n-button>
        </div>
      </div>
      <p class="section-note">显存管理当前只管理 V5-P、V4Hg_10k 和 V4fg_10k；旧 SVS 面板的其他模型仍可运行，但不进入本页管理。</p>
    </section>

    <section class="page-section">
      <div class="section-head"><h2>分析 Runtime</h2><span>{{ analysisModels.length }} 个</span></div>
      <div class="model-table">
        <div v-for="model in analysisModels" :key="model.id" class="model-row analysis-row">
          <div><strong>{{ model.id }}</strong><small>{{ model.capabilities.join(' / ') }}</small></div>
          <span>{{ engineLabel(model.engine) }}</span>
          <n-tag size="small" :bordered="false" type="success">已注册</n-tag>
          <span class="runtime-kind">{{ profileLabel(model.vramProfile) }}</span>
          <span class="resident-badge">{{ residentLabel(model.vramProfile) }}</span>
          <n-button
            size="tiny"
            type="primary"
            ghost
            :loading="runtimes.some(item => item.id === model.id && item.state === 'loading')"
            :disabled="runtimes.some(item => item.id === model.id && item.state !== 'unloaded' && item.state !== 'error')"
            @click="loadRuntime(model.id)"
          >加载模型</n-button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.gpu-page { flex: 1; overflow: auto; padding: 22px 28px 36px; color: var(--app-text); }
.page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; max-width: 1120px; }
.page-head h1 { margin: 0 0 4px; font-size: 22px; }
.page-head p, .section-note { margin: 0; color: var(--app-muted); font-size: 12px; }
.head-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.head-actions :deep(.n-button) { min-width: 56px; }
.mode-toggle { flex: 0 0 96px; display: inline-flex; border: 1px solid var(--app-border); border-radius: 4px; overflow: hidden; }
.mode-toggle button { flex: 1; min-width: 0; height: 24px; padding: 0 6px; border: 0; background: transparent; color: var(--app-muted); font: inherit; font-size: 11px; cursor: pointer; white-space: nowrap; }
.mode-toggle button.active { background: var(--app-accent); color: #fff; }
.notice { flex: 0 1 150px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--app-accent); font-size: 12px; }
.error-band { max-width: 1120px; margin-top: 18px; padding: 10px 12px; border: 1px solid #8f3f46; color: #f28b94; }
.gpu-band { max-width: 1120px; margin-top: 20px; }
.gpu-device { padding: 15px 0; border-top: 1px solid var(--app-border); }
.device-title { display: grid; grid-template-columns: 64px minmax(220px, 1fr) auto; align-items: baseline; gap: 12px; margin-bottom: 9px; }
.device-title span { font-size: 12px; color: var(--app-muted); }
.device-memory { color: var(--app-text) !important; font-variant-numeric: tabular-nums; }
.device-meta { display: flex; justify-content: space-between; margin-top: 5px; color: var(--app-muted); font-size: 11px; }
.page-section { max-width: 1120px; margin-top: 26px; border-top: 1px solid var(--app-border); }
.section-head { height: 44px; display: flex; align-items: center; justify-content: space-between; }
.section-head h2 { margin: 0; font-size: 14px; }
.section-head span { color: var(--app-muted); font-size: 11px; }
.empty-row { padding: 14px 0; color: var(--app-muted); font-size: 12px; }
.process-row, .model-row { min-height: 48px; display: grid; align-items: center; gap: 14px; border-top: 1px solid color-mix(in srgb, var(--app-border) 65%, transparent); font-size: 12px; }
.process-row { grid-template-columns: minmax(180px, 1fr) 80px 72px 96px auto; }
.model-row { grid-template-columns: minmax(180px, 1fr) minmax(80px, 120px) 70px minmax(120px, 180px) 88px 84px; }
.runtime-row { min-height: 52px; display: grid; grid-template-columns: minmax(220px, 1fr) 90px 100px minmax(120px, 1fr) auto; align-items: center; gap: 14px; border-top: 1px solid color-mix(in srgb, var(--app-border) 65%, transparent); font-size: 12px; }
.process-row > div, .model-row > div { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.process-row small, .model-row small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--app-muted); }
.process-row > span, .model-row > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.resident-badge { color: var(--app-accent); }
.runtime-row > div:first-child { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.runtime-row > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.runtime-actions { display: flex; justify-content: flex-end; }
.runtime-kind { color: var(--app-muted); }
.section-note { margin-top: 12px; max-width: 840px; line-height: 1.6; }
</style>

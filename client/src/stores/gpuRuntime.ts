import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

export interface GpuDeviceStatus {
  index: number
  name: string
  totalMiB: number
  usedMiB: number
  freeMiB: number
  utilizationPercent?: number
}

export interface GpuProcessStatus {
  id: string
  kind: string
  modelId?: string
  device: string
  pid: number
  status: 'running' | 'releasing' | 'finished' | 'failed' | 'cancelled'
  startedAt: string
  usedGpuMemoryMiB?: number
}

export interface ModelCatalogItem {
  id: string
  family: 'svs' | 'analysis' | 'svc' | 'msst'
  engine: string
  checkpoint?: string
  vaeCheckpoint?: string
  runtimeState: 'configured' | 'unavailable'
  capabilities: string[]
  vramProfile?: { device?: string; peakUsedMiB?: number; peakDeltaMiB?: number; sampleSeconds?: number; measuredAt?: string }
}

export interface ModelRuntimeStatus {
  id: string
  modelId: string
  device: string
  state: 'unloaded' | 'loading' | 'ready' | 'busy' | 'releasing' | 'error'
  pid?: number
  residentMiB?: number
  activeJobId?: string
  startedAt?: string
  lastError?: string
}

interface GpuStatusPayload {
  ok: boolean
  commandAvailable: boolean
  gpus: GpuDeviceStatus[]
  processes: GpuProcessStatus[]
  catalog: ModelCatalogItem[]
  runtimes?: ModelRuntimeStatus[]
  updatedAt: string
  error?: string
}

export const useGpuRuntimeStore = defineStore('gpuRuntime', () => {
  const loading = ref(false)
  const status = ref<GpuStatusPayload | null>(null)
  const error = ref('')
  const runtimes = ref<ModelRuntimeStatus[]>([])
  let pending: Promise<void> | null = null

  const primaryGpu = computed(() => status.value?.gpus[0] ?? null)
  const usageLabel = computed(() => {
    const gpu = primaryGpu.value
    if (!gpu) return 'GPU --'
    return `GPU ${formatGiB(gpu.usedMiB)} / ${formatGiB(gpu.totalMiB)}`
  })

  async function refresh() {
    if (pending) return pending
    loading.value = true
    pending = (async () => {
      try {
        const response = await fetch('/api/gpu/status', { cache: 'no-store' })
        const payload = await response.json() as GpuStatusPayload
        if (!response.ok) throw new Error(payload.error || `GPU 状态读取失败 (${response.status})`)
        status.value = payload
        runtimes.value = payload.runtimes ?? []
        error.value = payload.error || ''
      } catch (cause: any) {
        error.value = cause?.message || 'GPU 状态读取失败'
      } finally {
        loading.value = false
        pending = null
      }
    })()
    return pending
  }

  async function releaseProcess(id: string) {
    const response = await fetch(`/api/gpu/processes/${encodeURIComponent(id)}/release`, { method: 'POST' })
    const result = await response.json()
    if (!response.ok || !result.ok) throw new Error(result.reason || 'GPU 任务释放失败')
    await refresh()
  }

  async function releaseAll() {
    const response = await fetch('/api/gpu/release-all', { method: 'POST' })
    const result = await response.json()
    if (!response.ok || !result.ok) throw new Error(result.reason || '本应用显存释放失败')
    await refresh()
    return result as { released: string[]; failed: Array<{ id: string; reason: string }> }
  }

  async function loadRuntime(id: string) {
    const response = await fetch(`/api/gpu/runtimes/${encodeURIComponent(id)}/load`, { method: 'POST' })
    const result = await response.json()
    if (!response.ok || !result.ok) throw new Error(result.reason || 'Runtime 加载失败')
    await refresh()
    return result.runtime as ModelRuntimeStatus
  }

  async function unloadRuntime(id: string) {
    const response = await fetch(`/api/gpu/runtimes/${encodeURIComponent(id)}/unload`, { method: 'POST' })
    const result = await response.json()
    if (!response.ok || !result.ok) throw new Error(result.reason || 'Runtime 释放失败')
    await refresh()
  }

  return {
    loading,
    status,
    error,
    runtimes,
    primaryGpu,
    usageLabel,
    refresh,
    releaseProcess,
    releaseAll,
    loadRuntime,
    unloadRuntime,
  }
})

function formatGiB(mib: number): string {
  return `${(mib / 1024).toFixed(1)} GB`
}

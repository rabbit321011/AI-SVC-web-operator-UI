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
  vramProfile?: {
    device?: string
    steps?: number
    residentMiB?: number
    peakUsedMiB?: number
    peakDeltaMiB?: number
    sampleSeconds?: number
    measuredAt?: string
    samples?: Array<{ seconds: number; peakUsedMiB?: number; peakDeltaMiB?: number }>
  }
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
  lastUsedAt?: string
  lastError?: string
}

export interface GpuPolicyEstimate {
  modelId: string
  durationSeconds: number
  sampleSeconds: number
  peakDeltaMiB: number
  residentMiB?: number
  inferenceDeltaMiB: number
  steps?: number
  requiredIfLoadedMiB: number
  requiredIfUnloadedMiB: number
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
  const runtimeMode = ref<'manual' | 'auto'>('manual')
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

  async function fetchRuntimeMode() {
    try {
      const response = await fetch('/api/gpu/policy/mode', { cache: 'no-store' })
      if (response.ok) runtimeMode.value = (await response.json()).mode
    } catch {}
  }

  async function setRuntimeMode(mode: 'manual' | 'auto') {
    const response = await fetch('/api/gpu/policy/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    })
    if (!response.ok) throw new Error(await readApiError(response) || '模式设置失败')
    runtimeMode.value = mode
  }

  async function estimatePolicy(modelId: string, durationSeconds: number) {
    const response = await fetch('/api/gpu/policy/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId, durationSeconds }),
    })
    const payload = await response.json()
    if (!response.ok || !payload.ok) throw new Error(payload.reason || '显存策略估算失败')
    runtimes.value = payload.runtimes ?? []
    runtimeMode.value = payload.mode ?? runtimeMode.value
    return payload as {
      freeMiB: number
      estimate: GpuPolicyEstimate
      runtimes: ModelRuntimeStatus[]
    }
  }

  async function prepareRuntime(modelId: string, durationSeconds: number) {
    await refresh()
    const policy = await estimatePolicy(modelId, durationSeconds)
    const runtime = runtimes.value.find(item => item.modelId === modelId
      && (item.state === 'ready' || item.state === 'busy'))
    if (runtime?.state === 'busy') {
      return { ok: false as const, busy: true, reason: `${modelId} 正在运行其他任务` }
    }
    const required = runtime ? policy.estimate.requiredIfLoadedMiB : policy.estimate.requiredIfUnloadedMiB
    if (policy.freeMiB >= required) {
      if (!runtime) await loadRuntime(modelId)
      return { ok: true as const, policy, required, loaded: Boolean(runtime) }
    }
    const evictions = evictionOrder(runtimes.value, modelId)
    let available = policy.freeMiB
    const needed: ModelRuntimeStatus[] = []
    for (const item of evictions) {
      if (available >= required) break
      available += item.residentMiB ?? 0
      needed.push(item)
    }
    if (runtimeMode.value === 'auto') {
      for (const item of needed) await unloadRuntime(item.id)
      const after = await estimatePolicy(modelId, durationSeconds)
      if (after.freeMiB < required) {
        return { ok: false as const, insufficient: true, policy, required, evictions: needed }
      }
      if (!runtimes.value.some(item => item.modelId === modelId && item.state === 'ready')) {
        await loadRuntime(modelId)
      }
      return { ok: true as const, policy, required, evictions: needed, loaded: true }
    }
    return {
      ok: false as const,
      action: 'confirm' as const,
      policy,
      required,
      evictions: needed,
      loaded: Boolean(runtime),
    }
  }

  async function prepareTransientTask(modelId: string, durationSeconds: number) {
    await refresh()
    const policy = await estimatePolicy(modelId, durationSeconds)
    const runtime = runtimes.value.find(item => item.modelId === modelId
      && (item.state === 'ready' || item.state === 'busy'))
    if (runtime?.state === 'busy') {
      return { ok: false as const, busy: true, reason: `${modelId} 正在运行其他任务` }
    }
    const required = runtime
      ? policy.estimate.requiredIfLoadedMiB
      : policy.estimate.peakDeltaMiB
    if (policy.freeMiB >= required) {
      return { ok: true as const, policy, required }
    }
    const evictions = evictionOrder(runtimes.value, modelId)
    let available = policy.freeMiB
    const needed: ModelRuntimeStatus[] = []
    for (const item of evictions) {
      if (available >= required) break
      available += item.residentMiB ?? 0
      needed.push(item)
    }
    if (runtimeMode.value === 'auto') {
      for (const item of needed) await unloadRuntime(item.id)
      const after = await estimatePolicy(modelId, durationSeconds)
      if (after.freeMiB < required) {
        return { ok: false as const, insufficient: true, policy, required, evictions: needed }
      }
      return { ok: true as const, policy, required, evictions: needed }
    }
    return {
      ok: false as const,
      action: 'confirm' as const,
      policy,
      required,
      evictions: needed,
    }
  }

  async function prepareCompositeTask(modelIds: string[], durationSeconds: number) {
    await refresh()
    if (runtimes.value.some(item => item.state === 'busy')) {
      return { ok: false as const, busy: true, reason: '存在正在运行的其他模型' }
    }
    const freeMiB = status.value?.gpus[0]?.freeMiB ?? 0
    let available = freeMiB
    const releaseSet = new Map<string, ModelRuntimeStatus>()
    const stageReleases: ModelRuntimeStatus[][] = modelIds.map(() => [])
    let policyForDialog: GpuPolicyEstimate | null = null
    let required = 0
    for (let index = 0; index < modelIds.length; index++) {
      const modelId = modelIds[index]
      const policy = await estimatePolicy(modelId, durationSeconds)
      policyForDialog = policy.estimate
      const runtime = runtimes.value.find(item => item.modelId === modelId
        && (item.state === 'ready' || item.state === 'busy'))
      const stageRequired = runtime
        ? policy.estimate.requiredIfLoadedMiB
        : policy.estimate.peakDeltaMiB
      required = Math.max(required, stageRequired)
      if (available >= stageRequired) continue
      const futureModels = new Set(modelIds.slice(index + 1))
      const candidates = evictionOrderExcluding(runtimes.value, [
        modelId,
        ...futureModels,
        ...[...releaseSet.values()].map(item => item.modelId),
      ])
      for (const item of candidates) {
        if (available >= stageRequired) break
        if (releaseSet.has(item.id)) continue
        releaseSet.set(item.id, item)
        stageReleases[index].push(item)
        available += item.residentMiB ?? 0
      }
      if (available < stageRequired) {
        return {
          ok: false as const,
          insufficient: true,
          required: stageRequired,
          freeMiB,
          policy: policyForDialog,
          evictions: [...releaseSet.values()],
        }
      }
    }
    const needed = [...releaseSet.values()]
    if (needed.length === 0) {
      return { ok: true as const, required: 0, freeMiB, policy: policyForDialog }
    }
    if (runtimeMode.value === 'auto') {
      for (const item of needed) await unloadRuntime(item.id)
      await refresh()
      return { ok: true as const, required, freeMiB, policy: policyForDialog, evictions: needed }
    }
    return {
      ok: false as const,
      action: 'confirm' as const,
      required,
      freeMiB,
      policy: policyForDialog,
      evictions: needed,
      stageReleases,
    }
  }

  async function evictUntilFit(modelId: string, requiredMiB: number, evictions: Array<{ id: string; residentMiB?: number }>) {
    for (const item of evictions) await unloadRuntime(item.id)
    await refresh()
    if ((status.value?.gpus[0]?.freeMiB ?? 0) < requiredMiB) return false
    if (!runtimes.value.some(item => item.modelId === modelId && item.state === 'ready')) {
      await loadRuntime(modelId)
    }
    return true
  }

  return {
    loading,
    status,
    error,
    runtimes,
    runtimeMode,
    primaryGpu,
    usageLabel,
    refresh,
    releaseProcess,
    releaseAll,
    loadRuntime,
    unloadRuntime,
    fetchRuntimeMode,
    setRuntimeMode,
    estimatePolicy,
    prepareRuntime,
    prepareTransientTask,
    prepareCompositeTask,
    evictUntilFit,
  }
})

function evictionOrder(runtimes: ModelRuntimeStatus[], activeModelId: string): ModelRuntimeStatus[] {
  return evictionOrderExcluding(runtimes, [activeModelId])
}

function evictionOrderExcluding(runtimes: ModelRuntimeStatus[], excludedModelIds: string[]): ModelRuntimeStatus[] {
  const excluded = new Set(excludedModelIds)
  return runtimes
    .filter(item => !excluded.has(item.modelId))
    .filter(item => item.state === 'ready' || item.state === 'busy')
    .sort((left, right) => (
      Date.parse(left.lastUsedAt || left.startedAt || '0') - Date.parse(right.lastUsedAt || right.startedAt || '0')
    ))
}

async function readApiError(response: Response): Promise<string> {
  try {
    const json = await response.json()
    return json.reason || json.error || json.message || ''
  } catch {
    return ''
  }
}

function formatGiB(mib: number): string {
  return `${(mib / 1024).toFixed(1)} GB`
}

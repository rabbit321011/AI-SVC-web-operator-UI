import { readGpuStatus } from './gpu-runtime.service.js'
import { getModelCatalog } from './model-catalog.service.js'
import type { ModelRuntimeStatus } from './model-runtime.service.js'
import fs from 'node:fs'
import path from 'node:path'

export type GpuRuntimeMode = 'manual' | 'auto'

const MODE_FILE = path.resolve('E:/AIscene/AISVC-midi-web/data/vram-profile/runtime-mode.json')

export interface GpuEstimate {
  modelId: string
  durationSeconds: number
  sampleSeconds: number
  peakDeltaMiB: number
  residentMiB?: number
  steps?: number
  requiredIfLoadedMiB: number
  requiredIfUnloadedMiB: number
}

export function estimateGpuMemory(modelId: string, durationSeconds: number): GpuEstimate {
  const model = getModelCatalog().find(item => item.id === modelId)
  if (!model?.vramProfile) throw new Error(`${modelId} 尚未标定显存`)
  const samples = [...(model.vramProfile.samples ?? [])].sort((left, right) => left.seconds - right.seconds)
  if (samples.length === 0) throw new Error(`${modelId} 缺少可用的标定时长`)
  const selected = samples.find(item => item.seconds >= durationSeconds) ?? samples[samples.length - 1]
  const peakDeltaMiB = selected.peakDeltaMiB ?? model.vramProfile.peakDeltaMiB ?? 0
  const residentMiB = model.vramProfile.residentMiB
  return {
    modelId,
    durationSeconds,
    sampleSeconds: selected.seconds,
    peakDeltaMiB,
    residentMiB,
    steps: model.vramProfile.steps,
    requiredIfLoadedMiB: peakDeltaMiB,
    requiredIfUnloadedMiB: peakDeltaMiB + (residentMiB ?? peakDeltaMiB),
  }
}

export async function currentFreeMiB(): Promise<number> {
  const status = await readGpuStatus()
  return status.gpus[0]?.freeMiB ?? 0
}

export function evictionOrder(
  runtimes: ModelRuntimeStatus[],
  activeModelId: string,
): ModelRuntimeStatus[] {
  return runtimes
    .filter(runtime => runtime.modelId !== activeModelId)
    .filter(runtime => runtime.state === 'ready' || runtime.state === 'busy')
    .sort((left, right) => {
      const leftTime = Date.parse(left.lastUsedAt || left.startedAt || '0')
      const rightTime = Date.parse(right.lastUsedAt || right.startedAt || '0')
      return leftTime - rightTime
    })
}

export function chooseEvictions(
  runtimes: ModelRuntimeStatus[],
  activeModelId: string,
  requiredFreeMiB: number,
  currentFreeMiBValue: number,
): ModelRuntimeStatus[] {
  let available = currentFreeMiBValue
  const evicted: ModelRuntimeStatus[] = []
  for (const runtime of evictionOrder(runtimes, activeModelId)) {
    if (available >= requiredFreeMiB) break
    available += runtime.residentMiB ?? 0
    evicted.push(runtime)
  }
  return evicted
}

export function readRuntimeMode(): GpuRuntimeMode {
  try {
    const mode = String(JSON.parse(fs.readFileSync(MODE_FILE, 'utf8')).mode || 'manual')
    return mode === 'auto' ? 'auto' : 'manual'
  } catch {
    return 'manual'
  }
}

export function setRuntimeMode(mode: GpuRuntimeMode): GpuRuntimeMode {
  try {
    fs.mkdirSync(path.dirname(MODE_FILE), { recursive: true })
    fs.writeFileSync(MODE_FILE, `${JSON.stringify({ schema: 'aisvc.gpu-runtime-mode.v1', mode }, null, 2)}\n`, 'utf8')
  } catch {
    // In-memory mode still applies for the current server session.
  }
  return mode
}

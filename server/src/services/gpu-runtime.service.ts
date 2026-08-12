import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ChildProcess } from 'node:child_process'
import type { WebSocket } from 'ws'
import { getModelCatalog, type ModelCatalogEntry } from './model-catalog.service.js'

const execFileAsync = promisify(execFile)
export const GPU_PROCESS_CANCELLED_MESSAGE = '用户已取消 GPU 任务并释放显存'
const releasedChildren = new WeakSet<ChildProcess>()

export interface GpuProcessRecord {
  id: string
  kind: string
  modelId?: string
  device: string
  pid: number
  status: 'running' | 'releasing' | 'finished' | 'failed' | 'cancelled'
  startedAt: string
  usedGpuMemoryMiB?: number
  exitCode?: number | null
}

interface GpuRecord extends GpuProcessRecord {
  child: ChildProcess
}

export interface GpuStatus {
  ok: boolean
  commandAvailable: boolean
  gpus: Array<{
    index: number
    name: string
    totalMiB: number
    usedMiB: number
    freeMiB: number
    utilizationPercent?: number
  }>
  processes: GpuProcessRecord[]
  catalog: ModelCatalogEntry[]
  updatedAt: string
  error?: string
}

const processes = new Map<string, GpuRecord>()

export function registerGpuProcess(
  child: ChildProcess,
  meta: { id: string; kind: string; modelId?: string; device?: string },
): void {
  if (meta.device === 'cpu') return
  if (!child.pid) return
  const uniqueId = processes.has(meta.id) ? `${meta.id}:${child.pid}` : meta.id
  const record: GpuRecord = {
    ...meta,
    id: uniqueId,
    device: meta.device || 'cuda:0',
    pid: child.pid,
    status: 'running',
    startedAt: new Date().toISOString(),
    child,
  }
  processes.set(record.id, record)
  child.once('close', (code, signal) => {
    const current = processes.get(record.id)
    if (!current) return
    current.status = current.status === 'releasing' || signal ? 'cancelled' : code === 0 ? 'finished' : 'failed'
    current.exitCode = code
    const cleanupTimer = setTimeout(() => {
      if (processes.get(record.id) === current) processes.delete(record.id)
    }, 60_000)
    cleanupTimer.unref()
  })
  child.once('error', () => {
    const current = processes.get(record.id)
    if (current) current.status = 'failed'
  })
}

export function unregisterGpuProcess(id: string): void {
  processes.delete(id)
}

export function wasGpuProcessReleased(child: ChildProcess): boolean {
  return releasedChildren.has(child)
}

export async function releaseGpuProcess(id: string): Promise<{ ok: boolean; reason?: string }> {
  const record = processes.get(id)
  if (!record) return { ok: false, reason: 'GPU 任务不存在或已经结束' }
  if (record.status !== 'running') return { ok: false, reason: 'GPU 任务已经结束' }
  record.status = 'releasing'
  releasedChildren.add(record.child)
  if (process.platform === 'win32') {
    try {
      await execFileAsync('taskkill', ['/PID', String(record.pid), '/T', '/F'], { windowsHide: true })
    } catch (error: any) {
      record.status = 'failed'
      return { ok: false, reason: error?.message || '无法结束 GPU 任务' }
    }
  } else {
    record.child.kill('SIGTERM')
  }
  return { ok: true }
}

export async function releaseAllGpuProcesses(): Promise<{ released: string[]; failed: Array<{ id: string; reason: string }> }> {
  const released: string[] = []
  const failed: Array<{ id: string; reason: string }> = []
  for (const record of [...processes.values()]) {
    if (record.status !== 'running') continue
    const result = await releaseGpuProcess(record.id)
    if (result.ok) released.push(record.id)
    else failed.push({ id: record.id, reason: result.reason || '释放失败' })
  }
  return { released, failed }
}

export async function readGpuStatus(): Promise<GpuStatus> {
  const updatedAt = new Date().toISOString()
  try {
    const gpuResult = await execFileAsync('nvidia-smi', [
      '--query-gpu=index,name,memory.total,memory.used,memory.free,utilization.gpu',
      '--format=csv,noheader,nounits',
    ], { windowsHide: true, timeout: 5000 })
    const gpus = String(gpuResult.stdout).split(/\r?\n/).map(parseGpuLine).filter(Boolean) as GpuStatus['gpus']
    try {
      const processResult = await execFileAsync('nvidia-smi', [
        '--query-compute-apps=pid,process_name,used_gpu_memory',
        '--format=csv,noheader,nounits',
      ], { windowsHide: true, timeout: 5000 })
      const byPid = new Map<number, number>()
      for (const line of String(processResult.stdout).split(/\r?\n/)) {
        const fields = line.split(',').map(item => item.trim())
        const pid = Number(fields[0])
        const memory = Number(fields[2])
        if (Number.isInteger(pid) && pid > 0 && Number.isFinite(memory)) byPid.set(pid, memory)
      }
      for (const record of processes.values()) record.usedGpuMemoryMiB = byPid.get(record.pid)
    } catch {
      // nvidia-smi returns a non-zero code when no compute process exists.
    }
    return { ok: true, commandAvailable: true, gpus, processes: publicProcesses(), catalog: getModelCatalog(), updatedAt }
  } catch (error: any) {
    return {
      ok: false,
      commandAvailable: false,
      gpus: [],
      processes: publicProcesses(),
      catalog: getModelCatalog(),
      updatedAt,
      error: error?.message || 'nvidia-smi 不可用',
    }
  }
}

function publicProcesses(): GpuProcessRecord[] {
  return [...processes.values()].map(({ child: _child, ...record }) => ({ ...record }))
}

function parseGpuLine(line: string): GpuStatus['gpus'][number] | null {
  const fields = line.split(',').map(item => item.trim())
  if (fields.length < 6) return null
  const index = Number(fields[0])
  const totalMiB = Number(fields[2])
  const usedMiB = Number(fields[3])
  const freeMiB = Number(fields[4])
  const utilization = Number(fields[5])
  if (!Number.isInteger(index) || ![totalMiB, usedMiB, freeMiB].every(Number.isFinite)) return null
  return {
    index,
    name: fields[1],
    totalMiB,
    usedMiB,
    freeMiB,
    utilizationPercent: Number.isFinite(utilization) ? utilization : undefined,
  }
}

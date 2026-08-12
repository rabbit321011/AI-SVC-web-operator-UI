import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { V5P_DIRECT_PRESET } from './v5p-preset.js'

const execFileAsync = promisify(execFile)
const PROJECT_ROOT = 'E:/AIscene/AISVC-midi-web'
const SINGER_ROOT = V5P_DIRECT_PRESET.singerRoot
const RUNTIME_DIR = path.join(PROJECT_ROOT, 'data', 'v5p-runtime')
const WORKER = path.join(PROJECT_ROOT, 'server', 'scripts', 'v5p_resident_worker.py')
const V5P_RUNTIME_ID = 'V5P_40K_EMA'

export type ModelRuntimeState = 'unloaded' | 'loading' | 'ready' | 'busy' | 'releasing' | 'error'

export interface ModelRuntimeStatus {
  id: string
  modelId: string
  device: string
  state: ModelRuntimeState
  pid?: number
  residentMiB?: number
  activeJobId?: string
  startedAt?: string
  lastUsedAt?: string
  lastError?: string
}

interface V5PRuntimeRecord extends ModelRuntimeStatus {
  child?: ChildProcessWithoutNullStreams
  presetFile: string
  pendingLoad?: { resolve: (value: ModelRuntimeStatus) => void; reject: (error: Error) => void }
  pendingInfer?: {
    jobId: string
    resolve: (resultFile: string) => void
    reject: (error: Error) => void
    onEvent?: (event: Record<string, any>) => void
  }
  shuttingDown: boolean
}

const runtimes = new Map<string, V5PRuntimeRecord>()

export function readModelRuntimeStatus(): ModelRuntimeStatus[] {
  return [...runtimes.values()].map(publicRuntime)
}

export function getV5PRuntimeStatus(): ModelRuntimeStatus {
  return publicRuntime(runtimes.get(V5P_RUNTIME_ID) ?? {
    id: V5P_RUNTIME_ID,
    modelId: V5P_DIRECT_PRESET.id,
    device: 'cuda:0',
    state: 'unloaded',
    presetFile: '',
    shuttingDown: false,
  })
}

export function isV5PRuntimeReady(): boolean {
  const runtime = runtimes.get(V5P_RUNTIME_ID)
  return runtime?.state === 'ready'
}

export async function loadV5PRuntime(device = 'cuda:0'): Promise<ModelRuntimeStatus> {
  const existing = runtimes.get(V5P_RUNTIME_ID)
  if (existing) {
    if (existing.state === 'loading') {
      return new Promise((resolve, reject) => {
        existing.pendingLoad = { resolve, reject }
      })
    }
    if (existing.state === 'ready' || existing.state === 'busy') return publicRuntime(existing)
    if (existing.state === 'releasing') throw new Error('V5-P Runtime 正在释放，请稍后再加载')
  }

  fs.mkdirSync(RUNTIME_DIR, { recursive: true })
  const presetFile = path.join(RUNTIME_DIR, `${V5P_RUNTIME_ID}.preset.json`)
  const resources = await buildV5PResources()
  const preset = {
    schema: 'aisvc.v5p-runtime-preset.v1',
    preset: {
      id: V5P_DIRECT_PRESET.id,
      checkpointSchema: V5P_DIRECT_PRESET.checkpointSchema,
      checkpointStep: V5P_DIRECT_PRESET.checkpointStep,
      weightSource: V5P_DIRECT_PRESET.weightSource,
      trainingCodeSHA256: V5P_DIRECT_PRESET.trainingCodeSHA256,
    },
    device,
    resources,
  }
  fs.writeFileSync(presetFile, `${JSON.stringify(preset, null, 2)}\n`, { encoding: 'utf-8', flag: 'w' })

  const record: V5PRuntimeRecord = {
    id: V5P_RUNTIME_ID,
    modelId: V5P_DIRECT_PRESET.id,
    device,
    state: 'loading',
    presetFile,
    shuttingDown: false,
    startedAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
  }
  runtimes.set(V5P_RUNTIME_ID, record)

  try {
    const child = spawn(V5P_DIRECT_PRESET.python, [WORKER, '--preset-file', presetFile], {
      cwd: SINGER_ROOT,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        HF_HUB_OFFLINE: process.env.HF_HUB_OFFLINE ?? '1',
        TRANSFORMERS_OFFLINE: process.env.TRANSFORMERS_OFFLINE ?? '1',
        HF_DATASETS_OFFLINE: process.env.HF_DATASETS_OFFLINE ?? '1',
      },
    })
    record.child = child
    record.pid = child.pid
    let stdoutBuffer = ''
    let stderrBuffer = ''
    child.stdout.on('data', data => {
      stdoutBuffer += data.toString()
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() ?? ''
      for (const line of lines) handleWorkerLine(record, line)
    })
    child.stderr.on('data', data => {
      stderrBuffer += data.toString()
      console.error(`[V5P Runtime] ${data.toString().trimEnd()}`)
    })
    child.on('error', error => {
      failRuntime(record, error.message || 'V5-P Runtime 启动失败')
    })
    child.on('close', code => {
      if (record.state === 'releasing' || record.shuttingDown) {
        runtimes.delete(V5P_RUNTIME_ID)
        return
      }
      const detail = stderrBuffer.split(/\r?\n/).filter(Boolean).slice(-3).join(' | ')
      failRuntime(record, detail || `V5-P Runtime exited with code ${code}`)
    })
    return await waitForRuntimeReady(record)
  } catch (error: any) {
    failRuntime(record, error?.message || String(error))
    throw error
  }
}

export async function unloadV5PRuntime(): Promise<{ ok: boolean; reason?: string }> {
  const record = runtimes.get(V5P_RUNTIME_ID)
  if (!record) return { ok: false, reason: 'V5-P Runtime 未加载' }
  if (record.state === 'releasing') return { ok: false, reason: 'V5-P Runtime 正在释放' }
  record.state = 'releasing'
  record.shuttingDown = true
  if (record.pendingInfer) {
    record.pendingInfer.reject(new Error('用户已取消 GPU 任务并释放显存'))
    record.pendingInfer = undefined
  }
  const pendingLoad = record.pendingLoad
  record.pendingLoad = undefined
  pendingLoad?.reject(new Error('用户已取消 GPU 任务并释放显存'))
  try {
    if (process.platform === 'win32') {
      await execFileAsync('taskkill', ['/PID', String(record.pid), '/T', '/F'], { windowsHide: true })
    } else {
      record.child?.kill('SIGTERM')
    }
  } catch {
    // The process may already have exited.
  }
  runtimes.delete(V5P_RUNTIME_ID)
  return { ok: true }
}

export async function unloadAllModelRuntimes(): Promise<{ released: string[]; failed: Array<{ id: string; reason: string }> }> {
  const released: string[] = []
  const failed: Array<{ id: string; reason: string }> = []
  for (const id of [...runtimes.keys()]) {
    const record = runtimes.get(id)
    if (!record) continue
    const result = await unloadV5PRuntime()
    if (result.ok) released.push(id)
    else failed.push({ id, reason: result.reason || '释放失败' })
  }
  return { released, failed }
}

export async function runV5PResidentInfer(
  jobFile: string,
  expectedJobSha256: string,
  outputDir: string,
  onEvent?: (event: Record<string, any>) => void,
): Promise<string> {
  const record = runtimes.get(V5P_RUNTIME_ID)
  if (!record || (record.state !== 'ready' && record.state !== 'busy')) {
    throw new Error('V5-P Runtime 未加载；请先在显存页面加载模型')
  }
  if (record.pendingInfer) throw new Error('V5-P Runtime 正在执行其他任务')
  if (!record.child || record.child.exitCode != null) throw new Error('V5-P Runtime 已退出')

  const job = JSON.parse(fs.readFileSync(jobFile, 'utf8')) as Record<string, any>
  const jobId = String(job.jobId || '')
  return await new Promise<string>((resolve, reject) => {
    record.state = 'busy'
    record.activeJobId = jobId
    record.lastUsedAt = new Date().toISOString()
    record.pendingInfer = { jobId, resolve, reject, onEvent }
    record.child?.stdin.write(`${JSON.stringify({
      type: 'infer',
      jobFile,
      expectedJobSha256,
      outputDir,
    })}\n`)
  })
}

function waitForRuntimeReady(record: V5PRuntimeRecord): Promise<ModelRuntimeStatus> {
  return new Promise((resolve, reject) => {
    if (record.state === 'ready') {
      resolve(publicRuntime(record))
      return
    }
    if (record.state === 'error' || record.state === 'releasing') {
      reject(new Error(record.lastError || 'V5-P Runtime 加载失败'))
      return
    }
    record.pendingLoad = { resolve, reject }
  })
}

function handleWorkerLine(record: V5PRuntimeRecord, line: string): void {
  let event: Record<string, any>
  try {
    event = JSON.parse(line.trim())
  } catch {
    return
  }
  if (event.type === 'runtime_ready') {
    record.residentMiB = Number(event.residentMiB) || undefined
    if (record.residentMiB) persistResidentProfile(record.modelId, record.residentMiB)
    record.state = 'ready'
    record.lastError = undefined
    record.lastUsedAt = new Date().toISOString()
    const pending = record.pendingLoad
    record.pendingLoad = undefined
    pending?.resolve(publicRuntime(record))
    return
  }
  if (event.type === 'error') {
    record.lastError = String(event.message || 'V5-P Runtime 错误')
    if (record.state === 'loading') {
      const pending = record.pendingLoad
      record.pendingLoad = undefined
      pending?.reject(new Error(record.lastError))
      failRuntime(record, record.lastError)
    }
    const pendingInfer = record.pendingInfer
    if (pendingInfer) {
      record.pendingInfer = undefined
      record.state = record.state === 'busy' ? 'ready' : record.state
      record.activeJobId = undefined
      pendingInfer.onEvent?.(event)
      pendingInfer.reject(new Error(record.lastError))
    }
    return
  }
  if (event.type === 'complete') {
    record.pendingInfer?.onEvent?.(event)
    return
  }
  if (event.type === 'infer_done') {
    const pending = record.pendingInfer
    record.pendingInfer = undefined
    record.state = 'ready'
    record.activeJobId = undefined
    pending?.resolve(String(event.resultFile || ''))
    return
  }
  if (event.type === 'infer_failed') {
    const pending = record.pendingInfer
    record.pendingInfer = undefined
    record.state = 'ready'
    record.activeJobId = undefined
    pending?.reject(new Error(record.lastError || 'V5-P 常驻推理失败'))
    return
  }
  if (event.type === 'validated_job' || event.type === 'loading_checkpoint'
    || event.type === 'loaded_checkpoint' || event.type === 'loading_vae'
    || event.type === 'loaded_vae' || event.type === 'encoding_reference'
    || event.type === 'sampling' || event.type === 'decoding') {
    record.pendingInfer?.onEvent?.(event)
  }
}

function failRuntime(record: V5PRuntimeRecord, message: string): void {
  record.state = 'error'
  record.lastError = message
  const pendingLoad = record.pendingLoad
  const pendingInfer = record.pendingInfer
  record.pendingLoad = undefined
  record.pendingInfer = undefined
  pendingLoad?.reject(new Error(message))
  pendingInfer?.reject(new Error(message))
}

function publicRuntime(record: V5PRuntimeRecord): ModelRuntimeStatus {
  return {
    id: record.id,
    modelId: record.modelId,
    device: record.device,
    state: record.state,
    pid: record.pid,
    residentMiB: record.residentMiB,
    activeJobId: record.activeJobId,
    startedAt: record.startedAt,
    lastUsedAt: record.lastUsedAt,
    lastError: record.lastError,
  }
}

async function buildV5PResources(): Promise<Record<string, { path: string; sha256?: string }>> {
  const midiModule = `${SINGER_ROOT}/src/YingMusicSinger/melody/midi_p_v4ph.py`
  return {
    checkpoint: {
      path: V5P_DIRECT_PRESET.checkpoint,
      sha256: V5P_DIRECT_PRESET.checkpointSHA256,
    },
    modelConfig: {
      path: V5P_DIRECT_PRESET.modelConfig,
      sha256: V5P_DIRECT_PRESET.modelConfigSHA256,
    },
    vaeConfig: {
      path: V5P_DIRECT_PRESET.vaeConfig,
      sha256: V5P_DIRECT_PRESET.vaeConfigSHA256,
    },
    vaeCheckpoint: {
      path: V5P_DIRECT_PRESET.vaeCheckpoint,
      sha256: V5P_DIRECT_PRESET.vaeCheckpointSHA256,
    },
    placement: {
      path: V5P_DIRECT_PRESET.placement,
      sha256: V5P_DIRECT_PRESET.placementSHA256,
    },
    directControlAdapter: {
      path: V5P_DIRECT_PRESET.directControlAdapter,
      sha256: await sha256File(V5P_DIRECT_PRESET.directControlAdapter),
    },
    runner: {
      path: V5P_DIRECT_PRESET.directRunner,
      sha256: await sha256File(V5P_DIRECT_PRESET.directRunner),
    },
    midiPModule: {
      path: midiModule,
      sha256: V5P_DIRECT_PRESET.melodyHashes['midi_p_v4ph.py'],
    },
    singerRoot: { path: SINGER_ROOT },
  }
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

function persistResidentProfile(modelId: string, residentMiB: number): void {
  try {
    const file = path.join(RUNTIME_DIR, '..', 'vram-profile', `${modelId}.resident.json`)
    fs.writeFileSync(file, `${JSON.stringify({
      schema: 'aisvc.gpu-resident-profile.v1',
      modelId,
      device: 'cuda:0',
      residentMiB,
      measuredAt: new Date().toISOString(),
    }, null, 2)}\n`, { encoding: 'utf-8' })
  } catch {
    // Resident calibration is best-effort; load/unload still works without it.
  }
}

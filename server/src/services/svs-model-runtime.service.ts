import { execFile } from 'node:child_process'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { ModelRuntimeStatus } from './model-runtime.service.js'

const execFileAsync = promisify(execFile)
const PROJECT_ROOT = 'E:/AIscene/AISVC-midi-web'
const SINGER_ROOT = 'E:/AIscene/YingMusic_Singer_Plus'
const APP_PYTHON = 'E:/AIscene/AISVCs/.venv/Scripts/python.exe'
const WORKER = path.join(PROJECT_ROOT, 'server', 'scripts', 'svs_resident_worker.py')
const RUNTIME_DIR = path.join(PROJECT_ROOT, 'data', 'svs-runtime')
const FFMPEG_SHARED_BIN = 'C:/ffmpeg-shared/ffmpeg-8.1.1-full_build-shared/bin'

const SVS_PRESETS = {
  V4fg_10k: {
    engine: 't1',
    checkpoint: 'E:/MyProject/重要模型保存/V4fg_10k/step_010000.pt',
    vaeCheckpoint: 'E:/AIscene/YingMusic_Singer_Plus/ckpts/autoencoder_285k.ckpt',
  },
  V4Hg_10k: {
    engine: 'v4h',
    checkpoint: 'E:/MyProject/重要模型保存/V4Hg_10k/step_010000_ema_inference.pt',
    vaeCheckpoint: 'E:/AIscene/YingMusic_Singer_Plus/ckpts/autoencoder_285k.ckpt',
    runtime: 'E:/MyProject/重要模型保存/V4Hg_10k/runtime_20260730',
  },
} as const

interface SvsRuntimeRecord extends ModelRuntimeStatus {
  child?: ChildProcessWithoutNullStreams
  presetFile: string
  pendingLoad?: { resolve: (value: ModelRuntimeStatus) => void; reject: (error: Error) => void }
  pendingInfer?: {
    resolve: () => void
    reject: (error: Error) => void
    onEvent?: (event: Record<string, any>) => void
  }
  shuttingDown: boolean
}

const runtimes = new Map<string, SvsRuntimeRecord>()

export function readSvsRuntimeStatus(): ModelRuntimeStatus[] {
  return [...runtimes.values()].map(publicRuntime)
}

export function getSvsRuntimeStatus(id: string): ModelRuntimeStatus {
  return publicRuntime(runtimes.get(id) ?? {
    id,
    modelId: id,
    device: 'cuda:0',
    state: 'unloaded',
    presetFile: '',
    shuttingDown: false,
  })
}

export function isSvsRuntimeReady(id: string): boolean {
  return runtimes.get(id)?.state === 'ready'
}

export async function loadSvsRuntime(id: string): Promise<ModelRuntimeStatus> {
  const preset = SVS_PRESETS[id as keyof typeof SVS_PRESETS]
  if (!preset) throw new Error(`未管理 SVS Runtime: ${id}`)
  const existing = runtimes.get(id)
  if (existing) {
    if (existing.state === 'loading') return new Promise((resolve, reject) => { existing.pendingLoad = { resolve, reject } })
    if (existing.state === 'ready' || existing.state === 'busy') return publicRuntime(existing)
    if (existing.state === 'releasing') throw new Error(`${id} 正在释放`)
  }

  fs.mkdirSync(RUNTIME_DIR, { recursive: true })
  const presetFile = path.join(RUNTIME_DIR, `${id}.preset.json`)
  fs.writeFileSync(presetFile, `${JSON.stringify({
    schema: 'aisvc.svs-runtime-preset.v1',
    modelId: id,
    engine: preset.engine,
    device: 'cuda:0',
    checkpoint: preset.checkpoint,
    vaeCheckpoint: preset.vaeCheckpoint,
    midiCheckpoint: `${SINGER_ROOT}/ckpts/model_ckpt_steps_100000_simplified.ckpt`,
    singerRoot: SINGER_ROOT,
    runtime: 'runtime' in preset ? preset.runtime : undefined,
  }, null, 2)}\n`, { encoding: 'utf-8', flag: 'w' })

  const record: SvsRuntimeRecord = {
    id,
    modelId: id,
    device: 'cuda:0',
    state: 'loading',
    presetFile,
    shuttingDown: false,
    startedAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
  }
  runtimes.set(id, record)
  try {
    const child = spawn(APP_PYTHON, [WORKER, '--preset-file', presetFile], {
      cwd: SINGER_ROOT,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PHONEMIZER_ESPEAK_LIBRARY: process.env.PHONEMIZER_ESPEAK_LIBRARY
          ?? 'C:\\Program Files\\eSpeak NG\\libespeak-ng.dll',
        PATH: addPathPrefix(process.env.PATH ?? '', FFMPEG_SHARED_BIN),
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
      console.error(`[SVS Runtime ${id}] ${data.toString().trimEnd()}`)
    })
    child.on('error', error => failRuntime(record, error.message || 'SVS Runtime 启动失败'))
    child.on('close', code => {
      if (record.state === 'releasing' || record.shuttingDown) {
        runtimes.delete(id)
        return
      }
      failRuntime(record, stderrBuffer.split(/\r?\n/).filter(Boolean).slice(-3).join(' | ') || `SVS Runtime exited with code ${code}`)
    })
    return await waitForReady(record)
  } catch (error: any) {
    failRuntime(record, error?.message || String(error))
    throw error
  }
}

export async function unloadSvsRuntime(id: string): Promise<{ ok: boolean; reason?: string }> {
  const record = runtimes.get(id)
  if (!record) return { ok: false, reason: `${id} Runtime 未加载` }
  if (record.state === 'releasing') return { ok: false, reason: `${id} Runtime 正在释放` }
  record.state = 'releasing'
  record.shuttingDown = true
  record.pendingInfer?.reject(new Error('用户已取消 GPU 任务并释放显存'))
  record.pendingInfer = undefined
  record.pendingLoad?.reject(new Error('用户已取消 GPU 任务并释放显存'))
  record.pendingLoad = undefined
  try {
    if (process.platform === 'win32') {
      await execFileAsync('taskkill', ['/PID', String(record.pid), '/T', '/F'], { windowsHide: true })
    } else {
      record.child?.kill('SIGTERM')
    }
  } catch {}
  runtimes.delete(id)
  return { ok: true }
}

export async function unloadAllSvsRuntimes(): Promise<{ released: string[]; failed: Array<{ id: string; reason: string }> }> {
  const released: string[] = []
  const failed: Array<{ id: string; reason: string }> = []
  for (const id of [...runtimes.keys()]) {
    const result = await unloadSvsRuntime(id)
    if (result.ok) released.push(id)
    else failed.push({ id, reason: result.reason || '释放失败' })
  }
  return { released, failed }
}

export async function runSvsResidentInfer(
  id: string,
  request: Record<string, unknown>,
  onEvent?: (event: Record<string, any>) => void,
): Promise<void> {
  const record = runtimes.get(id)
  if (!record || record.state !== 'ready' || !record.child || record.child.exitCode != null) {
    throw new Error(`${id} Runtime 未加载`)
  }
  if (record.pendingInfer) throw new Error(`${id} Runtime 正在执行其他任务`)
  record.state = 'busy'
  record.lastUsedAt = new Date().toISOString()
  await new Promise<void>((resolve, reject) => {
    record.pendingInfer = { resolve, reject, onEvent }
    record.child?.stdin.write(`${JSON.stringify({ type: 'infer', ...request })}\n`)
  })
}

function waitForReady(record: SvsRuntimeRecord): Promise<ModelRuntimeStatus> {
  return new Promise((resolve, reject) => {
    if (record.state === 'ready') return resolve(publicRuntime(record))
    if (record.state === 'error' || record.state === 'releasing') return reject(new Error(record.lastError || 'SVS Runtime 加载失败'))
    record.pendingLoad = { resolve, reject }
  })
}

function handleWorkerLine(record: SvsRuntimeRecord, line: string): void {
  let event: Record<string, any>
  try { event = JSON.parse(line.trim()) } catch { return }
  if (event.type === 'runtime_ready') {
    record.residentMiB = Number(event.residentMiB) || undefined
    if (record.residentMiB) persistResidentProfile(record.modelId, record.residentMiB)
    record.state = 'ready'
    record.lastUsedAt = new Date().toISOString()
    record.pendingLoad?.resolve(publicRuntime(record))
    record.pendingLoad = undefined
    return
  }
  if (event.type === 'error') {
    record.lastError = String(event.message || 'SVS Runtime 错误')
    if (record.state === 'loading') {
      const pending = record.pendingLoad
      record.pendingLoad = undefined
      pending?.reject(new Error(record.lastError))
      failRuntime(record, record.lastError)
    }
    record.pendingInfer?.onEvent?.(event)
    record.pendingInfer?.reject(new Error(record.lastError))
    record.pendingInfer = undefined
    record.state = 'ready'
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
    pending?.resolve()
    return
  }
  if (event.type === 'infer_failed') {
    const pending = record.pendingInfer
    record.pendingInfer = undefined
    record.state = 'ready'
    pending?.reject(new Error(record.lastError || 'SVS 常驻推理失败'))
    return
  }
}

function failRuntime(record: SvsRuntimeRecord, message: string): void {
  record.state = 'error'
  record.lastError = message
  record.pendingLoad?.reject(new Error(message))
  record.pendingLoad = undefined
  record.pendingInfer?.reject(new Error(message))
  record.pendingInfer = undefined
}

function publicRuntime(record: SvsRuntimeRecord): ModelRuntimeStatus {
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

function persistResidentProfile(modelId: string, residentMiB: number): void {
  try {
    fs.writeFileSync(path.join(PROJECT_ROOT, 'data', 'vram-profile', `${modelId}.resident.json`), `${JSON.stringify({
      schema: 'aisvc.gpu-resident-profile.v1',
      modelId,
      device: 'cuda:0',
      residentMiB,
      measuredAt: new Date().toISOString(),
    }, null, 2)}\n`, { encoding: 'utf-8' })
  } catch {}
}

function addPathPrefix(currentPath: string, prefix: string): string {
  const parts = currentPath.split(path.delimiter).filter(Boolean)
  return parts.some(part => part.toLowerCase() === prefix.toLowerCase())
    ? currentPath
    : [prefix, ...parts].join(path.delimiter)
}

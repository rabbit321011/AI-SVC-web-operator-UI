import { execFile } from 'node:child_process'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { ModelRuntimeStatus } from './model-runtime.service.js'
import { readGpuStatus } from './gpu-runtime.service.js'

const execFileAsync = promisify(execFile)
const PROJECT_ROOT = 'E:/AIscene/AISVC-midi-web'
const APP_PYTHON = 'E:/AIscene/AISVCs/.venv/Scripts/python.exe'
const SOFA_PYTHON = 'E:/AIscene/SOFA-Japanese/.venv-gpu/Scripts/python.exe'
const RUNTIME_DIR = path.join(PROJECT_ROOT, 'data', 'analysis-runtime')
const WHISPER_WORKER = path.join(PROJECT_ROOT, 'server', 'scripts', 'whisper_resident_worker.py')
const SOFA_WORKER = path.join(PROJECT_ROOT, 'server', 'scripts', 'sofa_resident_worker.py')
const GAME_WORKER = path.join(PROJECT_ROOT, 'server', 'scripts', 'game_resident_worker.py')
const MSST_WORKER = path.join(PROJECT_ROOT, 'server', 'scripts', 'msst_resident_worker.py')
const MSST_PYTHON = 'E:/MyProject/cyanAI/nodeServer/src/utility/MSST/msst_webui/venv/Scripts/python.exe'

const ANALYSIS_PRESETS = {
  'Whisper large-v3': {
    python: APP_PYTHON,
    worker: WHISPER_WORKER,
    requestType: 'transcribe',
    args: (device: string) => ['--device', device, '--compute-type', 'float16'],
  },
  'SOFA Japanese': {
    python: SOFA_PYTHON,
    worker: SOFA_WORKER,
    requestType: 'align',
    args: (device: string) => [
      '--repo', 'E:/AIscene/SOFA-Japanese/Voicebank2DiffSinger-main',
      '--ckpt', 'E:/AIscene/SOFA-Japanese/Voicebank2DiffSinger-main/community_models/JPN_Test2_Plus/step.100000.server-practiced.ckpt',
      '--device', device,
    ],
  },
  'GAME-1.0-medium': {
    python: APP_PYTHON,
    worker: GAME_WORKER,
    requestType: 'extract',
    args: (device: string) => [
      '--game-repo', 'E:/MyProject/ToLinuxServer/TEMP/source_robustness_repos/GAME',
      '--game-deps', 'E:/MyProject/ToLinuxServer/TEMP/game_v4pf_deps',
      '--game-model', 'E:/MyProject/ToLinuxServer/TEMP/GAME-1.0-medium/GAME-1.0-medium/model.pt',
      '--singer-repo', 'E:/MyProject/ToLinuxServer/YingMusic-Singer-Plus-src',
      '--device', device,
    ],
  },
  MSST_duality: {
    python: MSST_PYTHON,
    worker: MSST_WORKER,
    requestType: 'separate',
    args: (device: string) => ['--model', 'duality', '--device', device],
  },
  MSST_dereverb: {
    python: MSST_PYTHON,
    worker: MSST_WORKER,
    requestType: 'separate',
    args: (device: string) => ['--model', 'dereverb', '--device', device],
  },
  MSST_denoise: {
    python: MSST_PYTHON,
    worker: MSST_WORKER,
    requestType: 'separate',
    args: (device: string) => ['--model', 'denoise', '--device', device],
  },
} as const

interface AnalysisRuntimeRecord extends ModelRuntimeStatus {
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

const runtimes = new Map<string, AnalysisRuntimeRecord>()

export function readAnalysisRuntimeStatus(): ModelRuntimeStatus[] {
  return [...runtimes.values()].map(publicRuntime)
}

export function getAnalysisRuntimeStatus(id: string): ModelRuntimeStatus {
  return publicRuntime(runtimes.get(id) ?? {
    id,
    modelId: id,
    device: 'cuda',
    state: 'unloaded',
    presetFile: '',
    shuttingDown: false,
  })
}

export function isAnalysisRuntimeReady(id: string): boolean {
  return runtimes.get(id)?.state === 'ready'
}

export async function loadAnalysisRuntime(id: string): Promise<ModelRuntimeStatus> {
  const preset = ANALYSIS_PRESETS[id as keyof typeof ANALYSIS_PRESETS]
  if (!preset) throw new Error(`未管理分析 Runtime: ${id}`)
  const existing = runtimes.get(id)
  if (existing) {
    if (existing.state === 'loading') return new Promise((resolve, reject) => { existing.pendingLoad = { resolve, reject } })
    if (existing.state === 'ready' || existing.state === 'busy') return publicRuntime(existing)
    if (existing.state === 'releasing') throw new Error(`${id} 正在释放`)
  }
  fs.mkdirSync(RUNTIME_DIR, { recursive: true })
  const device = id === 'SOFA Japanese' ? 'cuda' : 'cuda'
  const record: AnalysisRuntimeRecord = {
    id,
    modelId: id,
    device,
    state: 'loading',
    presetFile: path.join(RUNTIME_DIR, `${id}.json`),
    shuttingDown: false,
    startedAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
  }
  runtimes.set(id, record)
  try {
    const baselineUsedMiB = (await readGpuStatus()).gpus[0]?.usedMiB
    const child = spawn(preset.python, [preset.worker, ...preset.args(device)], {
      cwd: PROJECT_ROOT,
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
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
      console.error(`[Analysis Runtime ${id}] ${data.toString().trimEnd()}`)
    })
    child.on('error', error => failRuntime(record, error.message || 'Analysis Runtime 启动失败'))
    child.on('close', code => {
      if (record.state === 'releasing' || record.shuttingDown) {
        runtimes.delete(id)
        return
      }
      failRuntime(record, stderrBuffer.split(/\r?\n/).filter(Boolean).slice(-3).join(' | ') || `Analysis Runtime exited with code ${code}`)
    })
    const ready = await waitForReady(record)
    if (record.residentMiB == null && baselineUsedMiB != null) {
      const currentUsedMiB = (await readGpuStatus()).gpus[0]?.usedMiB
      if (currentUsedMiB != null) {
        record.residentMiB = Math.max(0, currentUsedMiB - baselineUsedMiB)
        persistResidentProfile(record.modelId, record.residentMiB)
      }
    }
    return ready
  } catch (error: any) {
    failRuntime(record, error?.message || String(error))
    throw error
  }
}

export async function unloadAnalysisRuntime(id: string): Promise<{ ok: boolean; reason?: string }> {
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

export async function unloadAllAnalysisRuntimes(): Promise<{ released: string[]; failed: Array<{ id: string; reason: string }> }> {
  const released: string[] = []
  const failed: Array<{ id: string; reason: string }> = []
  for (const id of [...runtimes.keys()]) {
    const result = await unloadAnalysisRuntime(id)
    if (result.ok) released.push(id)
    else failed.push({ id, reason: result.reason || '释放失败' })
  }
  return { released, failed }
}

export async function runAnalysisInfer(
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
    record.child?.stdin.write(`${JSON.stringify({ type: ANALYSIS_PRESETS[id as keyof typeof ANALYSIS_PRESETS].requestType, ...request })}\n`)
  })
}

function waitForReady(record: AnalysisRuntimeRecord): Promise<ModelRuntimeStatus> {
  return new Promise((resolve, reject) => {
    if (record.state === 'ready') return resolve(publicRuntime(record))
    if (record.state === 'error' || record.state === 'releasing') return reject(new Error(record.lastError || 'Analysis Runtime 加载失败'))
    record.pendingLoad = { resolve, reject }
  })
}

function handleWorkerLine(record: AnalysisRuntimeRecord, line: string): void {
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
    record.lastError = String(event.message || 'Analysis Runtime 错误')
    if (record.state === 'loading') {
      const pending = record.pendingLoad
      record.pendingLoad = undefined
      pending?.reject(new Error(record.lastError))
      failRuntime(record, record.lastError)
      return
    }
    if (record.state === 'busy') {
      record.pendingInfer?.onEvent?.(event)
      record.pendingInfer?.reject(new Error(record.lastError))
      record.pendingInfer = undefined
      record.state = 'ready'
    }
    return
  }
  if (event.type === 'transcribe_done' || event.type === 'align_done'
    || event.type === 'extract_done' || event.type === 'separate_done') {
    const pending = record.pendingInfer
    record.pendingInfer = undefined
    record.state = 'ready'
    pending?.onEvent?.({ type: 'done', ...event })
    pending?.resolve()
    return
  }
  record.pendingInfer?.onEvent?.(event)
}

function failRuntime(record: AnalysisRuntimeRecord, message: string): void {
  record.state = 'error'
  record.lastError = message
  record.pendingLoad?.reject(new Error(message))
  record.pendingLoad = undefined
  record.pendingInfer?.reject(new Error(message))
  record.pendingInfer = undefined
}

function publicRuntime(record: AnalysisRuntimeRecord): ModelRuntimeStatus {
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
      device: 'cuda',
      residentMiB,
      measuredAt: new Date().toISOString(),
    }, null, 2)}\n`, { encoding: 'utf-8' })
  } catch {}
}

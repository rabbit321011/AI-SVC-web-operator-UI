import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import type { WebSocket } from 'ws'
import type { SvsPhrase, SvsRequest } from './svs.service.js'
import { GPU_PROCESS_CANCELLED_MESSAGE, registerGpuProcess, wasGpuProcessReleased } from './gpu-runtime.service.js'

const PROJECT_ROOT = 'E:/AIscene/AISVC-midi-web'
const SOFA_PYTHON = 'E:/AIscene/SOFA-Japanese/.venv-gpu/Scripts/python.exe'
const APP_PYTHON = 'E:/AIscene/AISVCs/.venv/Scripts/python.exe'
const SINGER_ROOT = 'E:/AIscene/YingMusic_Singer_Plus'
const H_RUNNER = 'E:/MyProject/ToLinuxServer/tools/alignment/run_h_v1_full.py'
const SOFA_REPO = 'E:/AIscene/SOFA-Japanese/Voicebank2DiffSinger-main'
const SOFA_CHECKPOINT = `${SOFA_REPO}/community_models/JPN_Test2_Plus/step.100000.server-practiced.ckpt`
const OFFICIAL_VAE = `${SINGER_ROOT}/ckpts/stable_audio_2_0_vae_20hz_official.ckpt`
const ONLINE_285K_VAE = `${SINGER_ROOT}/ckpts/autoencoder_285k.ckpt`
const MIDI_CHECKPOINT = `${SINGER_ROOT}/ckpts/model_ckpt_steps_100000_simplified.ckpt`
const PREPARE_SCRIPT = `${PROJECT_ROOT}/server/scripts/v4h_prepare_job.py`
const INFER_SCRIPT = `${PROJECT_ROOT}/server/scripts/v4h_infer_job.py`
const FFMPEG_SHARED_BIN = 'C:/ffmpeg-shared/ffmpeg-8.1.1-full_build-shared/bin'

interface V4hPreset {
  checkpoint: string
  runtime: string
  vaeCheckpoint: string
}

const V4H_PRESETS: Record<string, V4hPreset> = {
  V4H_24k: {
    checkpoint: 'E:/MyProject/重要模型保存/V4H_24k/step_024000_ema_inference.pt',
    runtime: 'E:/MyProject/重要模型保存/V4H_24k/runtime_20260729',
    vaeCheckpoint: OFFICIAL_VAE,
  },
  V4H_30k: {
    checkpoint: 'E:/MyProject/重要模型保存/V4H_30k/step_030000_ema_inference.pt',
    runtime: 'E:/MyProject/重要模型保存/V4H_30k/runtime_20260729',
    vaeCheckpoint: OFFICIAL_VAE,
  },
  V4Hg_10k: {
    checkpoint: 'E:/MyProject/重要模型保存/V4Hg_10k/step_010000_ema_inference.pt',
    runtime: 'E:/MyProject/重要模型保存/V4Hg_10k/runtime_20260730',
    vaeCheckpoint: ONLINE_285K_VAE,
  },
}

export interface V4hRequest extends SvsRequest {
  sofaEscapeSeconds: number
}

export interface V4hRunOptions {
  dryRun?: boolean
}

interface ProcessEvent {
  type?: string
  code?: string
  message?: string
  region?: string
  index?: number
  total?: number
  phraseCount?: number
  phoneCandidateCount?: number
  fallbackCandidateCount?: number
  phonePhraseCount?: number
  pulPhraseCount?: number
  exactControlPhraseCount?: number
}

export function verifyV4hResources(req: V4hRequest): void {
  const preset = resolveV4hPreset(req.modelId)
  if (normalize(req.checkpoint) !== normalize(preset.checkpoint)) {
    throw new Error(`${req.modelId} must use its verified EMA inference checkpoint`)
  }
  if (normalize(req.vaeCheckpoint) !== normalize(preset.vaeCheckpoint)) {
    throw new Error(`${req.modelId} must use its training-bound VAE`)
  }
  if (!req.melodyAudio) throw new Error('V4H requires melody audio')
  if (!Number.isFinite(req.sofaEscapeSeconds) || req.sofaEscapeSeconds < 0 || req.sofaEscapeSeconds > 2) {
    throw new Error('SOFA 逸散程度必须在 0s 到 2s 之间')
  }
  validateBoundedPhrases(req.refPhrases, 'A 参考文本')
  validateBoundedPhrases(req.targetPhrases, 'B 目标文本')
  for (const file of [
    SOFA_PYTHON,
    APP_PYTHON,
    preset.runtime,
    H_RUNNER,
    SOFA_REPO,
    SOFA_CHECKPOINT,
    preset.checkpoint,
    preset.vaeCheckpoint,
    MIDI_CHECKPOINT,
    PREPARE_SCRIPT,
    INFER_SCRIPT,
  ]) {
    if (!fs.existsSync(file)) throw new Error(`V4H resource is missing: ${file}`)
  }
}

export async function runV4h(req: V4hRequest, ws?: WebSocket, options: V4hRunOptions = {}): Promise<void> {
  try {
    verifyV4hResources(req)
    const preset = resolveV4hPreset(req.modelId)
    const output = path.resolve(req.output)
    const base = output.slice(0, output.length - path.extname(output).length)
    const jobManifest = `${base}.v4h-job.json`
    const alignment = `${base}.v4h-alignment.json`
    const audit = `${base}.v4h-placement.json`
    fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.writeFileSync(jobManifest, JSON.stringify({
      schema: 'aisvc.v4h-web-job.v1',
      modelId: req.modelId,
      refAudio: path.resolve(req.refAudio),
      melodyAudio: path.resolve(req.melodyAudio!),
      refPhrases: req.refPhrases,
      targetPhrases: req.targetPhrases,
    }, null, 2), 'utf-8')

    send(ws, { type: 'progress', progress: 66, message: '校验 V4H 权威资源' })
    let alignedSummary: ProcessEvent = {}
    await runJsonProcess(SOFA_PYTHON, [
      PREPARE_SCRIPT,
      '--job-manifest', jobManifest,
      '--output', alignment,
      '--runtime', preset.runtime,
      '--h-runner', H_RUNNER,
      '--singer-root', SINGER_ROOT,
      '--sofa-repo', SOFA_REPO,
      '--sofa-checkpoint', SOFA_CHECKPOINT,
      '--escape-seconds', String(req.sofaEscapeSeconds),
      '--gpu', deviceIndex(req.device),
    ], event => {
      if (event.type === 'loading_sofa') send(ws, { type: 'progress', progress: 67, message: '加载 SOFA' })
      if (event.type === 'loaded_sofa') send(ws, { type: 'progress', progress: 70, message: 'SOFA 已加载' })
      if (event.type === 'align_phrase') {
        const progress = event.region === 'A' ? 70 : 78
        const fraction = Number(event.index || 0) / Math.max(Number(event.total || 1), 1)
        send(ws, {
          type: 'progress',
          progress: Math.round(progress + fraction * 7),
          message: `SOFA 对齐 ${event.region} 第 ${event.index}/${event.total} 句`,
        })
      }
      if (event.type === 'complete') alignedSummary = event
    }, { id: `v4h-sofa:${path.basename(output)}`, kind: 'analysis', modelId: 'SOFA Japanese', device: req.device || 'cuda:0' })

    if (options.dryRun) {
      send(ws, {
        type: 'dry-run-done',
        alignmentFile: alignment,
        phraseCount: alignedSummary.phraseCount,
        phoneCandidateCount: alignedSummary.phoneCandidateCount,
        fallbackCandidateCount: alignedSummary.fallbackCandidateCount,
      })
      return
    }

    send(ws, { type: 'progress', progress: 86, message: `加载 ${req.modelId}` })
    let inferenceSummary: ProcessEvent = {}
    await runJsonProcess(APP_PYTHON, [
      INFER_SCRIPT,
      '--ref-audio', path.resolve(req.refAudio),
      '--melody-audio', path.resolve(req.melodyAudio!),
      '--alignment', alignment,
      '--output', output,
      '--audit', audit,
      '--runtime', preset.runtime,
      '--singer-root', SINGER_ROOT,
      '--checkpoint', preset.checkpoint,
      '--vae-ckpt', preset.vaeCheckpoint,
      '--midi-ckpt', MIDI_CHECKPOINT,
      '--steps', String(req.steps ?? 32),
      '--cfg', String(req.cfg ?? 3),
      '--seed', String(req.seed ?? 42),
      '--device', req.device || 'cuda:0',
    ], event => {
      if (event.type === 'loaded_model') send(ws, { type: 'progress', progress: 90, message: `${req.modelId} 已加载` })
      if (event.type === 'synthesizing') send(ws, { type: 'progress', progress: 91, message: 'V4H 合成中' })
      if (event.type === 'complete') inferenceSummary = event
    }, { id: `v4h:${path.basename(output)}`, kind: 'svs', modelId: req.modelId, device: req.device || 'cuda:0' })
    if (!fs.existsSync(output) || fs.statSync(output).size <= 44) {
      throw new Error(`V4H finished but output was not found: ${output}`)
    }
    send(ws, {
      type: 'done',
      outputFile: output,
      auditFile: audit,
      phonePhraseCount: inferenceSummary.phonePhraseCount,
      pulPhraseCount: inferenceSummary.pulPhraseCount,
      exactControlPhraseCount: inferenceSummary.exactControlPhraseCount,
    })
  } catch (error: any) {
    send(ws, { type: 'error', message: error?.message || String(error) })
  }
}

function resolveV4hPreset(modelId?: string): V4hPreset {
  const preset = modelId ? V4H_PRESETS[modelId] : undefined
  if (!preset) throw new Error(`V4H engine does not support model preset: ${modelId || '(missing)'}`)
  return preset
}

function validateBoundedPhrases(phrases: SvsPhrase[], label: string) {
  let previousEnd = -Infinity
  phrases.forEach((phrase, index) => {
    if (!Number.isFinite(phrase.start) || !Number.isFinite(phrase.end)
      || phrase.end! <= phrase.start || phrase.start < previousEnd - 1e-6) {
      throw new Error(`${label} 第 ${index + 1} 句缺少有效且不重叠的起止边界`)
    }
    previousEnd = phrase.end!
  })
}

function runJsonProcess(
  command: string,
  args: string[],
  onEvent: (event: ProcessEvent) => void,
  runtime: { id: string; kind: string; modelId?: string; device?: string },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: SINGER_ROOT,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        HF_HUB_OFFLINE: process.env.HF_HUB_OFFLINE ?? '1',
        TRANSFORMERS_OFFLINE: process.env.TRANSFORMERS_OFFLINE ?? '1',
        HF_DATASETS_OFFLINE: process.env.HF_DATASETS_OFFLINE ?? '1',
        PHONEMIZER_ESPEAK_LIBRARY: process.env.PHONEMIZER_ESPEAK_LIBRARY ?? 'C:\\Program Files\\eSpeak NG\\libespeak-ng.dll',
        PATH: addPathPrefix(process.env.PATH ?? '', FFMPEG_SHARED_BIN),
      },
    })
    registerGpuProcess(child, runtime)
    let stdoutBuffer = ''
    let stderr = ''
    let reportedError = ''
    child.stdout.on('data', (data: Buffer) => {
      stdoutBuffer += data.toString()
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() ?? ''
      for (const line of lines) {
        const event = parseEvent(line)
        if (!event) continue
        if (event.type === 'error' && event.code === 'alignment_order') {
          reportedError = '音素对齐错位，请调小SOFA逸散程度后重试'
        } else if (event.type === 'error' && event.message) reportedError = event.message
        onEvent(event)
      }
    })
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString() })
    child.on('error', reject)
    child.on('close', code => {
      const finalEvent = parseEvent(stdoutBuffer)
      if (finalEvent) {
        if (finalEvent.type === 'error' && finalEvent.code === 'alignment_order') {
          reportedError = '音素对齐错位，请调小SOFA逸散程度后重试'
        } else if (finalEvent.type === 'error' && finalEvent.message) reportedError = finalEvent.message
        onEvent(finalEvent)
      }
      if (wasGpuProcessReleased(child)) reject(new Error(GPU_PROCESS_CANCELLED_MESSAGE))
      else if (code === 0) resolve()
      else reject(new Error(reportedError || conciseProcessError(stderr) || `V4H process exited with code ${code}`))
    })
  })
}

function parseEvent(line: string): ProcessEvent | null {
  try { return JSON.parse(line.trim()) as ProcessEvent } catch { return null }
}

function conciseProcessError(stderr: string): string {
  return stderr.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(-4).join(' | ')
}

function normalize(value?: string): string {
  return value ? path.resolve(value).replace(/\\/g, '/').toLowerCase() : ''
}

function deviceIndex(device?: string): string {
  const match = String(device || 'cuda:0').match(/cuda:(\d+)/i)
  return match?.[1] ?? '0'
}

function addPathPrefix(currentPath: string, prefix: string): string {
  const parts = currentPath.split(path.delimiter).filter(Boolean)
  return parts.some(part => part.toLowerCase() === prefix.toLowerCase())
    ? currentPath
    : [prefix, ...parts].join(path.delimiter)
}

function send(ws: WebSocket | undefined, message: Record<string, unknown>) {
  if (!ws || ws.readyState !== 1) return
  try { ws.send(JSON.stringify(message)) } catch {}
}

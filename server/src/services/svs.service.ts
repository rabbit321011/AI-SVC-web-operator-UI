import { spawn } from 'child_process'
import { createHash } from 'crypto'
import path from 'path'
import fs from 'fs'
import type { WebSocket } from 'ws'
import { GPU_PROCESS_CANCELLED_MESSAGE, registerGpuProcess, wasGpuProcessReleased } from './gpu-runtime.service.js'

const PYTHON = 'E:/AIscene/AISVCs/.venv/Scripts/python.exe'
const WORK_DIR = 'E:/AIscene/YingMusic_Singer_Plus'
const INFER_SCRIPT = path.join(WORK_DIR, 'infer_v4_formal.py')
const FFMPEG_SHARED_BIN = 'C:\\ffmpeg-shared\\ffmpeg-8.1.1-full_build-shared\\bin'
const ONLINE_285K_VAE = 'E:/AIscene/YingMusic_Singer_Plus/ckpts/autoencoder_285k.ckpt'
const ONLINE_285K_VAE_SIZE = 624_568_721
const ONLINE_285K_VAE_SHA256 = 'f18aeecacc04173cd2ea73bbdf8edae9e976d18e4ca050c38e2723281c5cba85'
const ONLINE_285K_MODEL_IDS = new Set(['V4fg_10k', 'V4vfg_6k', 'V4vfg_10k', 'V4Hg_10k'])
const DEFAULT_MODEL_ID = 'plus_ja_sft_v4c step24k'
const SVS_MODELS_PATH = 'E:/AIscene/AISVC-midi-web/server/models/svs_models.json'

export type SvsEngine = 't1' | 'v4h_phone_pul'

interface ResolvedSvsPreset {
  modelId: string
  checkpoint: string
  vaeCheckpoint?: string
  engine: SvsEngine
}

let vaeHashCache: { path: string; size: number; mtimeMs: number; sha256: string } | null = null

export interface SvsPhrase {
  start: number
  end?: number
  text: string
}

export interface SvsRequest {
  refAudio: string
  melodyAudio?: string
  refPhrases: SvsPhrase[]
  targetPhrases: SvsPhrase[]
  output: string
  modelId?: string
  checkpoint?: string
  vaeCheckpoint?: string
  steps?: number
  cfg?: number
  seed?: number
  device?: string
}

export interface BuildSvsArgsOptions {
  writeManifest?: boolean
}

export interface SvsResourceVerification {
  modelId?: string
  vaeSha256?: string
  engine?: SvsEngine
}

export function buildSvsArgs(req: SvsRequest, options: BuildSvsArgsOptions = {}): string[] {
  validatePhrases(req.refPhrases, 'refPhrases')
  validatePhrases(req.targetPhrases, 'targetPhrases')
  const preset = assertModelBinding(req)
  if (preset?.engine === 'v4h_phone_pul') {
    throw new Error('V4H must use the phone/PUL inference engine')
  }
  assertVaeBinding(req, preset)
  const t1Manifest = svsT1ManifestPath(req.output)
  if (options.writeManifest !== false) writeSvsT1Manifest(req)
  const args = [
    INFER_SCRIPT,
    '--ref_audio', req.refAudio,
    '--t1_manifest', t1Manifest,
    '--output', req.output,
  ]

  if (req.melodyAudio) args.push('--melody_audio', req.melodyAudio)
  if (preset) args.push('--model_id', preset.modelId)
  if (req.checkpoint) args.push('--checkpoint', req.checkpoint)
  if (req.vaeCheckpoint) args.push('--vae_ckpt', req.vaeCheckpoint)
  if (req.steps != null) args.push('--steps', String(req.steps))
  if (req.cfg != null) args.push('--cfg', String(req.cfg))
  if (req.seed != null) args.push('--seed', String(req.seed))
  if (req.device) args.push('--device', req.device)

  return args
}

export async function verifySvsResources(req: SvsRequest): Promise<SvsResourceVerification> {
  const preset = assertModelBinding(req)
  assertVaeBinding(req, preset)
  if (!preset) return {}

  const checkpointPath = path.resolve(WORK_DIR, preset.checkpoint)
  if (!fs.existsSync(checkpointPath)) {
    throw new Error(`SVS checkpoint is missing: ${checkpointPath}`)
  }
  if (preset.vaeCheckpoint) {
    const presetVaePath = path.resolve(WORK_DIR, preset.vaeCheckpoint)
    if (!fs.existsSync(presetVaePath)) {
      throw new Error(`SVS VAE checkpoint is missing: ${presetVaePath}`)
    }
  }
  if (!ONLINE_285K_MODEL_IDS.has(preset.modelId) || !req.vaeCheckpoint) {
    return { modelId: preset.modelId, engine: preset.engine }
  }

  const vaePath = path.resolve(WORK_DIR, req.vaeCheckpoint)
  const stat = fs.statSync(vaePath)
  const cacheKey = normalizePath(vaePath)
  let sha256: string
  if (vaeHashCache?.path === cacheKey
    && vaeHashCache.size === stat.size
    && vaeHashCache.mtimeMs === stat.mtimeMs) {
    sha256 = vaeHashCache.sha256
  } else {
    sha256 = await sha256File(vaePath)
    vaeHashCache = { path: cacheKey, size: stat.size, mtimeMs: stat.mtimeMs, sha256 }
  }
  if (sha256 !== ONLINE_285K_VAE_SHA256) {
    throw new Error(`${preset.modelId} 285k online VAE SHA-256 mismatch: expected ${ONLINE_285K_VAE_SHA256}, got ${sha256}`)
  }
  return { modelId: preset.modelId, engine: preset.engine, vaeSha256: sha256 }
}

export function resolveSvsEngine(req: SvsRequest): SvsEngine {
  return assertModelBinding(req)?.engine ?? 't1'
}

export function writeSvsT1Manifest(req: SvsRequest): string {
  validatePhrases(req.refPhrases, 'refPhrases')
  validatePhrases(req.targetPhrases, 'targetPhrases')
  const manifestPath = svsT1ManifestPath(req.output)
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
  fs.writeFileSync(manifestPath, JSON.stringify({
    schema: 'yingmusic.svs-t1.v1',
    refPhrases: req.refPhrases,
    targetPhrases: req.targetPhrases,
  }, null, 2), 'utf-8')
  return manifestPath
}

function svsT1ManifestPath(output: string): string {
  const ext = path.extname(output)
  return ext ? output.slice(0, -ext.length) + '.t1.json' : output + '.t1.json'
}

export function runSvs(req: SvsRequest, ws?: WebSocket): void {
  const args = buildSvsArgs(req)
  fs.mkdirSync(path.dirname(req.output), { recursive: true })

  console.log(`[SVS] spawning: python ${args.join(' ')}`)

  const child = spawn(PYTHON, args, {
    cwd: WORK_DIR,
    env: {
      ...process.env,
      HF_HUB_OFFLINE: process.env.HF_HUB_OFFLINE ?? '1',
      TRANSFORMERS_OFFLINE: process.env.TRANSFORMERS_OFFLINE ?? '1',
      HF_DATASETS_OFFLINE: process.env.HF_DATASETS_OFFLINE ?? '1',
      HF_HUB_DISABLE_TELEMETRY: process.env.HF_HUB_DISABLE_TELEMETRY ?? '1',
      PHONEMIZER_ESPEAK_LIBRARY: process.env.PHONEMIZER_ESPEAK_LIBRARY ?? 'C:\\Program Files\\eSpeak NG\\libespeak-ng.dll',
      PATH: addPathPrefix(process.env.PATH ?? '', FFMPEG_SHARED_BIN),
    },
  })
  registerGpuProcess(child, {
    id: `svs:${path.basename(req.output)}`,
    kind: 'svs',
    modelId: req.modelId,
    device: req.device || 'cuda:0',
  })

  let stdoutBuf = ''
  let stderrBuf = ''

  child.stdout.on('data', (data: Buffer) => {
    stdoutBuf += data.toString()
    send(ws, { type: 'log', message: data.toString() })
  })

  child.stderr.on('data', (data: Buffer) => {
    stderrBuf += data.toString()
    send(ws, { type: 'log', message: data.toString() })
  })

  child.on('close', (code) => {
    if (wasGpuProcessReleased(child)) {
      send(ws, { type: 'error', message: GPU_PROCESS_CANCELLED_MESSAGE })
    } else if (code === 0 && fs.existsSync(req.output)) {
      send(ws, { type: 'done', outputFile: req.output })
    } else if (code === 0) {
      send(ws, { type: 'error', message: `SVS finished but output was not found: ${req.output}` })
    } else {
      send(ws, { type: 'error', message: formatSvsError(code, stderrBuf || stdoutBuf) })
    }
  })

  child.on('error', (err) => {
    send(ws, { type: 'error', message: err.message })
  })
}

function addPathPrefix(currentPath: string, prefix: string): string {
  const parts = currentPath.split(path.delimiter).filter(Boolean)
  const hasPrefix = parts.some(part => part.toLowerCase() === prefix.toLowerCase())
  return hasPrefix ? currentPath : [prefix, ...parts].join(path.delimiter)
}

function validatePhrases(phrases: SvsPhrase[], field: string): void {
  if (!Array.isArray(phrases) || phrases.length === 0) {
    throw new Error(`${field} must contain at least one timed phrase`)
  }
  for (const [index, phrase] of phrases.entries()) {
    if (!Number.isFinite(phrase?.start) || phrase.start < 0) {
      throw new Error(`${field}[${index}].start must be a non-negative number`)
    }
    if (phrase.end != null && (!Number.isFinite(phrase.end) || phrase.end < phrase.start)) {
      throw new Error(`${field}[${index}].end must be greater than or equal to start`)
    }
    if (typeof phrase.text !== 'string' || !phrase.text.trim()) {
      throw new Error(`${field}[${index}].text must not be empty`)
    }
  }
}

function assertModelBinding(req: SvsRequest): ResolvedSvsPreset | null {
  const presets = loadSvsPresets()
  if (!req.checkpoint) {
    if (req.modelId || req.vaeCheckpoint) {
      throw new Error('modelId/VAE cannot be provided without a checkpoint')
    }
    const defaultPreset = presets.find(candidate => candidate.modelId === DEFAULT_MODEL_ID)
    if (!defaultPreset) throw new Error(`Default SVS model preset is missing: ${DEFAULT_MODEL_ID}`)
    return defaultPreset
  }

  const preset = presets.find(candidate => (
    normalizePath(candidate.checkpoint) === normalizePath(req.checkpoint!)
  ))
  if (!preset) {
    throw new Error('SVS checkpoint must match a configured model preset')
  }
  if (req.modelId && req.modelId !== preset.modelId) {
    throw new Error(`SVS modelId does not match checkpoint/VAE preset: ${req.modelId}`)
  }
  if (normalizeOptionalPath(preset.vaeCheckpoint) !== normalizeOptionalPath(req.vaeCheckpoint)) {
    if (ONLINE_285K_MODEL_IDS.has(preset.modelId)) {
      throw new Error(`${preset.modelId} requires the 285k online VAE: ${ONLINE_285K_VAE}`)
    }
    throw new Error(`SVS VAE does not match configured preset: ${preset.modelId}`)
  }
  return preset
}

function loadSvsPresets(): ResolvedSvsPreset[] {
  const raw = JSON.parse(fs.readFileSync(SVS_MODELS_PATH, 'utf-8')) as Record<string, string | {
    checkpoint?: string
    vaeCheckpoint?: string
    engine?: SvsEngine
  }>
  const presets: ResolvedSvsPreset[] = []
  for (const [modelId, value] of Object.entries(raw)) {
    if (typeof value === 'string') {
      presets.push({ modelId, checkpoint: value, engine: 't1' })
      continue
    }
    if (!value?.checkpoint) continue
    presets.push({
      modelId,
      checkpoint: String(value.checkpoint),
      vaeCheckpoint: value.vaeCheckpoint ? String(value.vaeCheckpoint) : undefined,
      engine: value.engine === 'v4h_phone_pul' ? 'v4h_phone_pul' : 't1',
    })
  }
  return presets
}

function assertVaeBinding(req: SvsRequest, preset: ResolvedSvsPreset | null): void {
  if (!preset || !ONLINE_285K_MODEL_IDS.has(preset.modelId)) return
  if (!req.vaeCheckpoint || normalizePath(req.vaeCheckpoint) !== normalizePath(ONLINE_285K_VAE)) {
    throw new Error(`${preset.modelId} requires the 285k online VAE: ${ONLINE_285K_VAE}`)
  }
  const vaePath = path.resolve(WORK_DIR, req.vaeCheckpoint)
  if (!fs.existsSync(vaePath)) {
    throw new Error(`${preset.modelId} 285k online VAE is missing: ${vaePath}`)
  }
  const actualSize = fs.statSync(vaePath).size
  if (actualSize !== ONLINE_285K_VAE_SIZE) {
    throw new Error(`${preset.modelId} 285k online VAE size mismatch: expected ${ONLINE_285K_VAE_SIZE}, got ${actualSize}`)
  }
}

function normalizePath(value: string): string {
  return path.resolve(WORK_DIR, value).replace(/\\/g, '/').toLowerCase()
}

function normalizeOptionalPath(value?: string): string {
  return value ? normalizePath(value) : ''
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

function formatSvsError(code: number | null, output: string): string {
  const cleaned = output
    .split(/\r?\n/)
    .map(line => line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim())
    .filter(Boolean)
    .slice(-5)
    .join(' | ')
  const base = `SVS process exited with code ${code}`
  return cleaned ? `${base}: ${cleaned}` : base
}

function send(ws: WebSocket | undefined, message: Record<string, unknown>): void {
  if (!ws || ws.readyState !== 1) return
  try {
    ws.send(JSON.stringify(message))
  } catch {}
}

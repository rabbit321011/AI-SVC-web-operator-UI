import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import type { WebSocket } from 'ws'

const PYTHON = 'E:/AIscene/AISVCs/.venv/Scripts/python.exe'
const WORK_DIR = 'E:/AIscene/YingMusic_Singer_Plus'
const INFER_SCRIPT = path.join(WORK_DIR, 'infer_v4_formal.py')
const FFMPEG_SHARED_BIN = 'C:\\ffmpeg-shared\\ffmpeg-8.1.1-full_build-shared\\bin'

export interface SvsRequest {
  refAudio: string
  melodyAudio?: string
  targetText: string
  output: string
  checkpoint?: string
  steps?: number
  cfg?: number
  seed?: number
  device?: string
}

export function buildSvsArgs(req: SvsRequest): string[] {
  const args = [
    INFER_SCRIPT,
    '--ref_audio', req.refAudio,
    '--target_text', req.targetText,
    '--output', req.output,
  ]

  if (req.melodyAudio) args.push('--melody_audio', req.melodyAudio)
  if (req.checkpoint) args.push('--checkpoint', req.checkpoint)
  if (req.steps != null) args.push('--steps', String(req.steps))
  if (req.cfg != null) args.push('--cfg', String(req.cfg))
  if (req.seed != null) args.push('--seed', String(req.seed))
  if (req.device) args.push('--device', req.device)

  return args
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

  let stdoutBuf = ''
  let stderrBuf = ''

  child.stdout.on('data', (data: Buffer) => {
    stdoutBuf += data.toString()
    ws?.send(JSON.stringify({ type: 'log', message: data.toString() }))
  })

  child.stderr.on('data', (data: Buffer) => {
    stderrBuf += data.toString()
    ws?.send(JSON.stringify({ type: 'log', message: data.toString() }))
  })

  child.on('close', (code) => {
    if (code === 0 && fs.existsSync(req.output)) {
      ws?.send(JSON.stringify({ type: 'done', outputFile: req.output }))
    } else if (code === 0) {
      ws?.send(JSON.stringify({ type: 'error', message: `SVS finished but output was not found: ${req.output}` }))
    } else {
      ws?.send(JSON.stringify({ type: 'error', message: formatSvsError(code, stderrBuf || stdoutBuf) }))
    }
  })

  child.on('error', (err) => {
    ws?.send(JSON.stringify({ type: 'error', message: err.message }))
  })
}

function addPathPrefix(currentPath: string, prefix: string): string {
  const parts = currentPath.split(path.delimiter).filter(Boolean)
  const hasPrefix = parts.some(part => part.toLowerCase() === prefix.toLowerCase())
  return hasPrefix ? currentPath : [prefix, ...parts].join(path.delimiter)
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

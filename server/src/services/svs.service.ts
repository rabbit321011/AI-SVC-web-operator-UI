import { spawn } from 'child_process'
import path from 'path'
import type { WebSocket } from 'ws'

const PYTHON = 'E:/AIscene/AISVCs/.venv/Scripts/python.exe'
const WORK_DIR = 'E:/AIscene/YingMusic_Singer_Plus'
const INFER_SCRIPT = path.join(WORK_DIR, 'infer_v4_formal.py')

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
  const child = spawn(PYTHON, args, {
    cwd: WORK_DIR,
    env: { ...process.env },
  })

  child.stdout.on('data', (data: Buffer) => {
    ws?.send(JSON.stringify({ type: 'log', message: data.toString() }))
  })

  child.stderr.on('data', (data: Buffer) => {
    ws?.send(JSON.stringify({ type: 'log', message: data.toString() }))
  })

  child.on('close', (code) => {
    if (code === 0) {
      ws?.send(JSON.stringify({ type: 'done', outputFile: req.output }))
    } else {
      ws?.send(JSON.stringify({ type: 'error', message: `SVS process exited with code ${code}` }))
    }
  })

  child.on('error', (err) => {
    ws?.send(JSON.stringify({ type: 'error', message: err.message }))
  })
}

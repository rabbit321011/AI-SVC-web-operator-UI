import { spawn } from 'child_process'
import path from 'path'
import type { WebSocket } from 'ws'

const PYTHON = 'E:/AIscene/AISVCs/.venv/Scripts/python.exe'
const PROJECT_ROOT = 'E:/AIscene/AISVC-midi-web'
const RUNNER_SCRIPT = path.resolve(PROJECT_ROOT, 'server', 'scripts', 'whisper_runner.py')

export interface WhisperRequest {
  inputWav: string
  outputDir: string
  outputName: string
  language: 'auto' | 'ja' | 'zh' | 'en'
  vad: boolean
  device: string
  computeType: string
}

export function runWhisper(req: WhisperRequest, ws: WebSocket): void {
  const args = [
    RUNNER_SCRIPT,
    '--input', req.inputWav,
    '--output-dir', req.outputDir,
    '--output-name', req.outputName,
    '--language', req.language || 'auto',
    '--vad', String(req.vad ?? true),
    '--device', req.device || 'cuda',
    '--compute-type', req.computeType || 'float16',
  ]

  console.log(`[Whisper] spawning: python ${args.join(' ')}`)
  const child = spawn(PYTHON, args, {
    cwd: path.dirname(RUNNER_SCRIPT),
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    },
  })

  child.stdout.on('data', (data: Buffer) => {
    for (const line of data.toString().split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        ws.send(trimmed)
      } catch {}
    }
  })

  child.stderr.on('data', (data: Buffer) => {
    const message = data.toString().trim()
    if (message) ws.send(JSON.stringify({ type: 'log', message }))
  })

  child.on('close', (code: number) => {
    if (code !== 0) {
      ws.send(JSON.stringify({ type: 'error', message: `Whisper exited with code ${code}` }))
    }
  })
}

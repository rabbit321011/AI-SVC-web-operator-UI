import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import fs from 'fs'
import path from 'path'
import type { WebSocket } from 'ws'

const PROJECT_ROOT = 'E:/AIscene/AISVC-midi-web'
const WHISPER_RUNNER = path.resolve(PROJECT_ROOT, 'server', 'scripts', 'whisper_runner.py')
const SOFA_RUNNER = path.resolve(PROJECT_ROOT, 'server', 'scripts', 'sofa_runner.py')
const DEFAULT_WHISPER_PYTHON = 'E:/AIscene/AISVCs/.venv/Scripts/python.exe'
const DEFAULT_SOFA_PYTHON = 'E:/AIscene/SOFA-Japanese/.venv-gpu/Scripts/python.exe'
const DEFAULT_SOFA_REPO = 'E:/AIscene/SOFA-Japanese/Voicebank2DiffSinger-main'
const DEFAULT_SOFA_CHECKPOINT = `${DEFAULT_SOFA_REPO}/community_models/JPN_Test2_Plus/step.100000.server-practiced.ckpt`

export const SOFA_ALIGNMENT_METHOD = 'SOFA_JPN_Test2_Plus_full_segment' as const

export interface WhisperRequest {
  inputWav: string
  outputDir: string
  outputName: string
  language: 'ja'
  vad: boolean
  device: string
  computeType: string
}

interface SofaRuntime {
  python: string
  repo: string
  checkpoint: string
}

interface RunnerMessage {
  type?: string
  progress?: number
  message?: string
  transcriptFile?: string
  [key: string]: unknown
}

export function runWhisper(req: WhisperRequest, ws: WebSocket): void {
  let runtime: SofaRuntime
  try {
    runtime = resolveSofaRuntime()
    if (req.language !== 'ja') throw new Error('Whisper -> SOFA transcription only supports Japanese (ja)')
  } catch (error: any) {
    send(ws, { type: 'error', message: error?.message || String(error) })
    return
  }

  const whisperPython = process.env.AISVC_WHISPER_PYTHON?.trim() || DEFAULT_WHISPER_PYTHON
  if (!fs.existsSync(whisperPython)) {
    send(ws, { type: 'error', message: `Whisper Python not found: ${whisperPython}` })
    return
  }

  const args = [
    WHISPER_RUNNER,
    '--input', req.inputWav,
    '--output-dir', req.outputDir,
    '--output-name', req.outputName,
    '--language', 'ja',
    '--vad', String(req.vad ?? true),
    '--device', req.device || 'cuda',
    '--compute-type', req.computeType || 'float16',
  ]
  console.log(`[Whisper] spawning Japanese transcription: ${whisperPython} ${args.join(' ')}`)
  const child = spawnRunner(whisperPython, args, path.dirname(WHISPER_RUNNER))
  let transcriptFile = ''
  let runnerErrored = false

  consumeJsonLines(child, message => {
    if (message.type === 'transcript' && typeof message.transcriptFile === 'string') {
      transcriptFile = message.transcriptFile
      return
    }
    if (message.type === 'error') runnerErrored = true
    if (message.type === 'stage_done' || message.type === 'transcript') return
    forwardStageMessage(ws, message, 'whisper')
  })
  forwardStderr(child, ws, 'Whisper')
  child.on('error', error => send(ws, { type: 'error', message: `Whisper failed to start: ${error.message}` }))
  child.on('close', code => {
    if (code !== 0 || runnerErrored) {
      if (!runnerErrored) send(ws, { type: 'error', message: `Whisper exited with code ${code}` })
      return
    }
    if (!transcriptFile || !fs.existsSync(transcriptFile)) {
      send(ws, { type: 'error', message: 'Whisper did not produce a phrase transcript for SOFA' })
      return
    }
    runSofa(req, runtime, transcriptFile, ws)
  })
}

function runSofa(req: WhisperRequest, runtime: SofaRuntime, transcriptFile: string, ws: WebSocket): void {
  const args = [
    SOFA_RUNNER,
    '--repo', runtime.repo,
    '--ckpt', runtime.checkpoint,
    '--input', req.inputWav,
    '--transcript', transcriptFile,
    '--output-dir', req.outputDir,
    '--output-name', req.outputName,
    '--device', normalizeSofaDevice(req.device),
  ]
  console.log(`[SOFA] spawning ${SOFA_ALIGNMENT_METHOD}: ${runtime.python} ${args.join(' ')}`)
  const child = spawnRunner(runtime.python, args, path.dirname(SOFA_RUNNER))
  let runnerErrored = false
  let alignedResult: RunnerMessage | null = null

  consumeJsonLines(child, message => {
    if (message.type === 'error') runnerErrored = true
    if (message.type === 'result') {
      if (message.alignmentMethod !== SOFA_ALIGNMENT_METHOD) {
        runnerErrored = true
        send(ws, { type: 'error', message: 'SOFA returned an unexpected alignment method' })
        return
      }
      if (alignedResult) {
        runnerErrored = true
        send(ws, { type: 'error', message: 'SOFA returned more than one aligned result' })
        return
      }
      alignedResult = message
      return
    }
    if (message.type === 'done') return
    forwardStageMessage(ws, message, 'sofa')
  })
  forwardStderr(child, ws, 'SOFA')
  child.on('error', error => send(ws, { type: 'error', message: `SOFA failed to start: ${error.message}` }))
  child.on('close', code => {
    if (code !== 0 && !runnerErrored) {
      send(ws, { type: 'error', message: `SOFA exited with code ${code}` })
      return
    }
    if (code === 0 && !runnerErrored && !alignedResult) {
      send(ws, { type: 'error', message: 'SOFA exited without an aligned TextObject' })
      return
    }
    if (code === 0 && !runnerErrored && alignedResult) {
      forwardStageMessage(ws, alignedResult, 'sofa')
      send(ws, {
        type: 'done',
        stage: 'sofa',
        alignmentMethod: SOFA_ALIGNMENT_METHOD,
        outputFile: alignedResult.outputFile,
      })
    }
  })
}

export function resolveSofaRuntime(env: NodeJS.ProcessEnv = process.env): SofaRuntime {
  const python = env.AISVC_SOFA_PYTHON?.trim() || DEFAULT_SOFA_PYTHON
  const repo = env.AISVC_SOFA_REPO?.trim() || DEFAULT_SOFA_REPO
  const checkpoint = env.AISVC_SOFA_JPN_TEST2_PLUS_CKPT?.trim() || DEFAULT_SOFA_CHECKPOINT
  if (!fs.existsSync(python)) throw new Error(`SOFA Python not found: ${python}`)
  if (!fs.existsSync(path.join(repo, 'src', 'SOFA'))) {
    throw new Error(`Voicebank2DiffSinger SOFA source not found: ${path.join(repo, 'src', 'SOFA')}`)
  }
  if (!fs.existsSync(checkpoint)) {
    throw new Error(`Greenleaf2001 JPN_Test2_Plus checkpoint not found: ${checkpoint}`)
  }
  return { python, repo, checkpoint }
}

function spawnRunner(python: string, args: string[], cwd: string): ChildProcessWithoutNullStreams {
  return spawn(python, args, {
    cwd,
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    },
  })
}

function consumeJsonLines(child: ChildProcessWithoutNullStreams, onMessage: (message: RunnerMessage) => void): void {
  let pending = ''
  child.stdout.on('data', (data: Buffer) => {
    pending += data.toString()
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() || ''
    for (const line of lines) parseRunnerLine(line, onMessage)
  })
  child.stdout.on('end', () => parseRunnerLine(pending, onMessage))
}

function parseRunnerLine(line: string, onMessage: (message: RunnerMessage) => void): void {
  const trimmed = line.trim()
  if (!trimmed) return
  try {
    onMessage(JSON.parse(trimmed))
  } catch {
    onMessage({ type: 'log', message: trimmed })
  }
}

function forwardStderr(child: ChildProcessWithoutNullStreams, ws: WebSocket, stage: string): void {
  child.stderr.on('data', (data: Buffer) => {
    const message = data.toString().trim()
    if (message) send(ws, { type: 'log', stage: stage.toLowerCase(), message: `${stage}: ${message}` })
  })
}

function forwardStageMessage(ws: WebSocket, message: RunnerMessage, stage: 'whisper' | 'sofa'): void {
  if (message.type === 'progress') {
    const stageProgress = Math.max(0, Math.min(100, Number(message.progress) || 0))
    const progress = stage === 'whisper' ? stageProgress * 0.5 : 50 + stageProgress * 0.5
    send(ws, { ...message, stage, progress })
    return
  }
  send(ws, { ...message, stage: message.stage || stage })
}

function normalizeSofaDevice(device: string): string {
  if (!device || device === 'cuda') return 'cuda'
  return /^cuda:\d+$/.test(device) ? device : 'cuda'
}

function send(ws: WebSocket, message: Record<string, unknown>): void {
  try {
    ws.send(JSON.stringify(message))
  } catch {}
}

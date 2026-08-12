import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { WebSocket } from 'ws'
import { GPU_PROCESS_CANCELLED_MESSAGE, registerGpuProcess, wasGpuProcessReleased } from './gpu-runtime.service.js'

const PYTHON = 'E:/AIscene/AISVCs/.venv/Scripts/python.exe'
const RUNNER_SCRIPT = 'E:/AIscene/AISVC-midi-web/server/scripts/svc_runner.py'
const WORK_DIR = 'E:/AIscene/AISVCs/YingMusic-SVC'
const OUTPUT_ROOT = 'E:/AIscene/AISVCs/YingMusic-SVC/outputs'

export interface SvcRequest {
  sourceWav: string
  targetWav: string
  checkpoint: string
  configYml: string
  diffusionSteps: number
  inferenceCfgRate: number
  f0Condition: boolean
  semiToneShift: number | null
  device: string
  fp16: boolean
  expname: string
  outputDir: string
}

export function runSvc(req: SvcRequest, ws: WebSocket): void {
  const startedAt = Date.now()
  const args = [
    RUNNER_SCRIPT,
    '--source', req.sourceWav,
    '--target', req.targetWav,
    '--checkpoint', req.checkpoint,
    '--config', req.configYml,
    '--diffusion-steps', String(req.diffusionSteps),
    '--cuda', req.device,
    '--fp16', String(req.fp16),
    '--expname', req.expname,
  ]

  console.log(`[SVC] spawning: python ${args.join(' ')}`)

  const child = spawn(PYTHON, args, {
    cwd: WORK_DIR,
    env: {
      ...process.env,
      HF_HUB_OFFLINE: process.env.HF_HUB_OFFLINE ?? '1',
      TRANSFORMERS_OFFLINE: process.env.TRANSFORMERS_OFFLINE ?? '1',
      HF_DATASETS_OFFLINE: process.env.HF_DATASETS_OFFLINE ?? '1',
      HF_HUB_DISABLE_TELEMETRY: process.env.HF_HUB_DISABLE_TELEMETRY ?? '1',
    },
  })
  registerGpuProcess(child, {
    id: `svc:${req.expname}`,
    kind: 'svc',
    modelId: path.basename(req.checkpoint),
    device: normalizeGpuDevice(req.device),
  })

  let stdoutBuf = ''
  let stderrBuf = ''
  let processFinished = false

  const handleSocketClose = () => {
    if (!processFinished && child.exitCode == null) child.kill()
  }
  ws.once('close', handleSocketClose)

  function send(message: Record<string, unknown>) {
    if (ws.readyState !== WebSocket.OPEN) return
    try { ws.send(JSON.stringify(message)) } catch {}
  }

  function parseProgress(line: string) {
    // tqdm lines look like: " 30%|███       | 6/20 [00:00<00:01, 12.27it/s]"
    const pct = line.match(/(\d+)%/)?.[1]
    if (pct) {
      send({ type: 'progress', progress: Math.min(parseInt(pct), 100) })
      return true
    }
    // YingMusic "auto predicted pitch shift" or "automatic pitch shift" indicates model loaded
    if (line.includes('pitch shift') || line.includes('RTF:')) {
      send({ type: 'log', message: line.trim() })
      return true
    }
    return false
  }

  child.stdout.on('data', (data: Buffer) => {
    stdoutBuf += data.toString()
    const lines = stdoutBuf.split('\n')
    stdoutBuf = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      console.log(`[SVC stdout] ${line}`)
      parseProgress(line)
    }
  })

  child.stderr.on('data', (data: Buffer) => {
    stderrBuf += data.toString()
    const lines = stderrBuf.split('\n')
    stderrBuf = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      // tqdm writes progress bar to stderr
      if (parseProgress(trimmed)) continue
      // Only log real errors, skip ANSI escape sequences
      const clean = trimmed.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim()
      if (clean && !clean.match(/^[│├└─\s|%▏▎▍▌▋▊▉█]+$/)) {
        console.error(`[SVC stderr] ${trimmed}`)
      }
    }
  })

  child.on('close', (code) => {
    processFinished = true
    ws.off('close', handleSocketClose)
    if (wasGpuProcessReleased(child)) {
      send({ type: 'error', message: GPU_PROCESS_CANCELLED_MESSAGE })
    } else if (code === 0) {
      const outDir = path.join(OUTPUT_ROOT, req.expname)
      if (fs.existsSync(outDir)) {
        const files = fs.readdirSync(outDir)
          .filter(file => file.toLowerCase().endsWith('.wav'))
          .map(file => ({ file, mtimeMs: fs.statSync(path.join(outDir, file)).mtimeMs }))
          .filter(file => file.mtimeMs >= startedAt - 1000)
          .sort((left, right) => right.mtimeMs - left.mtimeMs)
        const outFile = files.length > 0 ? path.join(outDir, files[0].file) : null
        send({
          type: 'done',
          outputFile: outFile,
          outputPath: outDir,
        })
      } else {
        send({ type: 'done', outputFile: null })
      }
    } else {
      send({ type: 'error', message: formatSvcError(code, stderrBuf || stdoutBuf) })
    }
  })

  child.on('error', (err) => {
    processFinished = true
    ws.off('close', handleSocketClose)
    send({ type: 'error', message: err.message })
  })
}

function normalizeGpuDevice(device: string): string {
  if (device === 'cpu') return 'cpu'
  return /^cuda:\d+$/i.test(device) ? device : `cuda:${device || '0'}`
}

function formatSvcError(code: number | null, output: string): string {
  const cleaned = output
    .split(/\r?\n/)
    .map(line => line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim())
    .filter(Boolean)
    .slice(-5)
    .join(' | ')
  const base = `SVC process exited with code ${code}`
  return cleaned ? `${base}: ${cleaned}` : base
}

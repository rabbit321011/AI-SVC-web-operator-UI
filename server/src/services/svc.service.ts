import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import type { WebSocket } from 'ws'

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
    env: { ...process.env },
  })

  let stdoutBuf = ''
  let stderrBuf = ''

  function parseProgress(line: string) {
    // tqdm lines look like: " 30%|███       | 6/20 [00:00<00:01, 12.27it/s]"
    const pct = line.match(/(\d+)%/)?.[1]
    if (pct) {
      ws.send(JSON.stringify({ type: 'progress', progress: Math.min(parseInt(pct), 100) }))
      return true
    }
    // YingMusic "auto predicted pitch shift" or "automatic pitch shift" indicates model loaded
    if (line.includes('pitch shift') || line.includes('RTF:')) {
      ws.send(JSON.stringify({ type: 'log', message: line.trim() }))
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
    if (code === 0) {
      // Find output file
      const outDir = path.join(OUTPUT_ROOT, req.expname)
      if (fs.existsSync(outDir)) {
        const files = fs.readdirSync(outDir).filter(f => f.endsWith('.wav'))
        const outFile = files.length > 0 ? path.join(outDir, files[0]) : null
        ws.send(JSON.stringify({
          type: 'done',
          outputFile: outFile,
          outputPath: outDir,
        }))
      } else {
        ws.send(JSON.stringify({ type: 'done', outputFile: null }))
      }
    } else {
      ws.send(JSON.stringify({ type: 'error', message: `SVC process exited with code ${code}` }))
    }
  })

  child.on('error', (err) => {
    ws.send(JSON.stringify({ type: 'error', message: err.message }))
  })
}

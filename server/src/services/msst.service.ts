import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import type { WebSocket } from 'ws'
import { GPU_PROCESS_CANCELLED_MESSAGE, registerGpuProcess, wasGpuProcessReleased } from './gpu-runtime.service.js'

const MSST_ROOT = 'E:/MyProject/cyanAI/nodeServer/src/utility/MSST/msst_webui'
const PYTHON = path.join(MSST_ROOT, 'venv', 'Scripts', 'python.exe')
const RUNNER = 'E:/AIscene/AISVC-midi-web/server/scripts/msst_runner.py'

export const MSST_MODEL_IDS = ['duality', 'dereverb', 'denoise'] as const
export const MSST_OUTPUT_IDS = ['vocals', 'instrumental', 'dry', 'other'] as const
export type MsstModelId = typeof MSST_MODEL_IDS[number]

const REQUIRED_RESOURCES = [
  'configs/vocal_models/melband_roformer_instvox_duality_v2.ckpt.yaml',
  'configs/single_stem_models/dereverb_echo_mbr_fused_0.5_v2_0.25_big_0.25_super.ckpt.yaml',
  'configs/single_stem_models/denoise_mel_band_roformer_aufr33_sdr_27.9959.ckpt.yaml',
  'pretrain/vocal_models/melband_roformer_instvox_duality_v2.ckpt',
  'pretrain/single_stem_models/dereverb_echo_mbr_fused_0.5_v2_0.25_big_0.25_super.ckpt',
  'pretrain/single_stem_models/denoise_mel_band_roformer_aufr33_sdr_27.9959.ckpt',
] as const

export interface MsstRequest {
  model: MsstModelId
  inputWav: string
  outputDir: string
  device?: 'cpu' | 'cuda'
}

export function verifyMsstResources(): void {
  const missing = [PYTHON, RUNNER, ...REQUIRED_RESOURCES.map(item => path.join(MSST_ROOT, item))]
    .filter(item => !fs.existsSync(item))
  if (missing.length > 0) throw new Error(`MSST resource is missing: ${missing[0]}`)
}

export function runMsst(req: MsstRequest, ws: WebSocket): void {
  verifyMsstResources()
  fs.mkdirSync(req.outputDir, { recursive: true })
  const args = [RUNNER, '--model', req.model, '--input', req.inputWav, '--output-dir', req.outputDir, '--device', req.device || 'cuda']
  const child = spawn(PYTHON, args, { cwd: MSST_ROOT, env: { ...process.env, PYTHONUNBUFFERED: '1' } })
  registerGpuProcess(child, {
    id: `msst:${path.basename(req.outputDir)}`,
    kind: 'msst',
    modelId: req.model,
    device: req.device === 'cpu' ? 'cpu' : 'cuda:0',
  })
  let stdoutBuffer = ''
  let stderrBuffer = ''
  let outputs: Record<string, string> | null = null

  child.stdout.on('data', (data: Buffer) => {
    stdoutBuffer += data.toString()
    const lines = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = lines.pop() || ''
    for (const line of lines) {
      const event = parseMsstEvent(line)
      if (!event) continue
      if (event.type === 'result') outputs = event.outputs as Record<string, string>
      send(ws, event)
    }
  })
  child.stderr.on('data', (data: Buffer) => {
    stderrBuffer += data.toString()
    console.error(`[MSST] ${data.toString().trimEnd()}`)
  })
  child.on('close', code => {
    if (wasGpuProcessReleased(child)) {
      send(ws, { type: 'error', message: GPU_PROCESS_CANCELLED_MESSAGE })
      return
    }
    if (code === 0 && outputs) {
      send(ws, { type: 'done', outputs: Object.keys(outputs) })
      return
    }
    send(ws, { type: 'error', message: formatMsstError(code, stderrBuffer || stdoutBuffer) })
  })
  child.on('error', error => send(ws, { type: 'error', message: error.message }))
}

export function parseMsstEvent(line: string): Record<string, unknown> | null {
  if (!line.startsWith('MSST_EVENT ')) return null
  try {
    return JSON.parse(line.slice('MSST_EVENT '.length))
  } catch {
    return null
  }
}

function formatMsstError(code: number | null, output: string): string {
  const detail = output.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(-4).join(' | ')
  return detail ? `MSST process exited with code ${code}: ${detail}` : `MSST process exited with code ${code}`
}

function send(ws: WebSocket, message: Record<string, unknown>) {
  if (ws.readyState !== 1) return
  try { ws.send(JSON.stringify(message)) } catch {}
}

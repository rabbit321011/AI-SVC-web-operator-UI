import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import type { WebSocket } from 'ws'
import { verifyOwnedGuideWav } from './owned-guide-runtime.js'

const PROJECT_ROOT = 'E:/AIscene/AISVC-midi-web'
const TO_LINUX_ROOT = 'E:/MyProject/ToLinuxServer'
const GAME_PYTHON = 'E:/AIscene/AISVCs/.venv/Scripts/python.exe'
const GAME_REPO = `${TO_LINUX_ROOT}/TEMP/source_robustness_repos/GAME`
const GAME_DEPS = `${TO_LINUX_ROOT}/TEMP/game_v4pf_deps`
const GAME_MODEL = `${TO_LINUX_ROOT}/TEMP/GAME-1.0-medium/GAME-1.0-medium/model.pt`
const SINGER_REPO = `${TO_LINUX_ROOT}/YingMusic-Singer-Plus-src`
const RUNNER = `${PROJECT_ROOT}/server/scripts/v5p_generate_midi_p.py`
const FFMPEG_SHARED_BIN = 'C:/ffmpeg-shared/ffmpeg-8.1.1-full_build-shared/bin'

export interface SynthesisMidiPRequest {
  jobId: string
  inputWav: string
  guideSHA256: string
  frameCount: number
  midiPRevision: number
  device?: string
}

interface ProcessEvent {
  type?: string
  message?: string
  noteCount?: number
  voicedNoteCount?: number
  restFrameCount?: number
}

export function validateSynthesisMidiPRequest(req: SynthesisMidiPRequest): void {
  if (!/^[a-zA-Z0-9_-]{4,64}$/.test(req.jobId || '')) throw new Error('MIDI-P jobId 无效')
  if (!req.inputWav?.trim()) throw new Error('MIDI-P 缺少 Owned Guide WAV')
  if (!/^[a-f0-9]{64}$/i.test(req.guideSHA256 || '')) throw new Error('Owned Guide SHA256 无效')
  if (!Number.isInteger(req.frameCount) || req.frameCount < 1) throw new Error('frameCount 必须是正整数')
  if (!Number.isInteger(req.midiPRevision) || req.midiPRevision < 0) throw new Error('MIDI-P revision 无效')
}

export function verifySynthesisMidiPResources(req: SynthesisMidiPRequest): void {
  validateSynthesisMidiPRequest(req)
  for (const resource of [req.inputWav, GAME_PYTHON, GAME_REPO, GAME_DEPS, GAME_MODEL, SINGER_REPO, RUNNER]) {
    if (!fs.existsSync(resource)) throw new Error(`MIDI-P resource is missing: ${resource}`)
  }
  verifyOwnedGuideWav(req.inputWav, req.guideSHA256, req.frameCount)
}

export async function runSynthesisMidiP(req: SynthesisMidiPRequest, ws?: WebSocket): Promise<void> {
  try {
    verifySynthesisMidiPResources(req)
    const outputDir = path.resolve(PROJECT_ROOT, 'data', `render_${req.jobId}_v5p_midi_p`)
    const outputFile = path.join(outputDir, 'midi-p.json')
    fs.mkdirSync(outputDir, { recursive: true })
    fs.rmSync(outputFile, { force: true })
    send(ws, { type: 'progress', progress: 5, message: '校验 GAME medium K=4 运行时' })
    let summary: ProcessEvent = {}
    await runJsonProcess(GAME_PYTHON, [
      RUNNER,
      '--input', path.resolve(req.inputWav),
      '--output', outputFile,
      '--guide-sha256', req.guideSHA256,
      '--frame-count', String(req.frameCount),
      '--game-repo', GAME_REPO,
      '--game-deps', GAME_DEPS,
      '--game-model', GAME_MODEL,
      '--singer-repo', SINGER_REPO,
      '--device', req.device || 'cuda:0',
      '--language', 'ja',
    ], event => {
      if (event.type === 'loading_model') send(ws, { type: 'progress', progress: 15, message: '加载 GAME medium' })
      if (event.type === 'loaded_model') send(ws, { type: 'progress', progress: 55, message: 'GAME medium 已加载' })
      if (event.type === 'extracting') send(ws, { type: 'progress', progress: 65, message: 'GAME K=4 提取音符区域' })
      if (event.type === 'complete') summary = event
    })
    const result = JSON.parse(fs.readFileSync(outputFile, 'utf-8'))
    if (result.schema !== 'aisvc.v5p-midi-p.v1' || result.frameCount !== req.frameCount) {
      throw new Error('GAME runner 返回了不兼容的 MIDI-P 结果')
    }
    send(ws, { type: 'midi-p-result', result })
    send(ws, {
      type: 'done',
      outputFile,
      noteCount: summary.noteCount,
      voicedNoteCount: summary.voicedNoteCount,
      restFrameCount: summary.restFrameCount,
    })
  } catch (error: any) {
    send(ws, { type: 'error', message: error?.message || String(error) })
  }
}

function runJsonProcess(
  command: string,
  args: string[],
  onEvent: (event: ProcessEvent) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: SINGER_REPO,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        HF_HUB_OFFLINE: process.env.HF_HUB_OFFLINE ?? '1',
        TRANSFORMERS_OFFLINE: process.env.TRANSFORMERS_OFFLINE ?? '1',
        HF_DATASETS_OFFLINE: process.env.HF_DATASETS_OFFLINE ?? '1',
        PATH: addPathPrefix(process.env.PATH ?? '', FFMPEG_SHARED_BIN),
      },
    })
    let stdout = ''
    let stderr = ''
    let reportedError = ''
    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
      const lines = stdout.split(/\r?\n/)
      stdout = lines.pop() ?? ''
      for (const line of lines) {
        const event = parseEvent(line)
        if (!event) continue
        if (event.type === 'error' && event.message) reportedError = event.message
        onEvent(event)
      }
    })
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString() })
    child.on('error', reject)
    child.on('close', code => {
      const finalEvent = parseEvent(stdout)
      if (finalEvent) {
        if (finalEvent.type === 'error' && finalEvent.message) reportedError = finalEvent.message
        onEvent(finalEvent)
      }
      if (code === 0) resolve()
      else reject(new Error(reportedError || conciseProcessError(stderr) || `GAME process exited with code ${code}`))
    })
  })
}

function parseEvent(line: string): ProcessEvent | null {
  try { return JSON.parse(line.trim()) as ProcessEvent } catch { return null }
}

function conciseProcessError(stderr: string): string {
  return stderr.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(-4).join(' | ')
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

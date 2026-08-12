import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import type { WebSocket } from 'ws'
import { GPU_PROCESS_CANCELLED_MESSAGE, registerGpuProcess, wasGpuProcessReleased } from './gpu-runtime.service.js'
import { verifyOwnedGuideWav } from './owned-guide-runtime.js'

const PROJECT_ROOT = 'E:/AIscene/AISVC-midi-web'
const TO_LINUX_ROOT = 'E:/MyProject/ToLinuxServer'
const SOFA_PYTHON = 'E:/AIscene/SOFA-Japanese/.venv-gpu/Scripts/python.exe'
const SINGER_ROOT = 'E:/AIscene/YingMusic_Singer_Plus'
const SOFA_REPO = 'E:/AIscene/SOFA-Japanese/Voicebank2DiffSinger-main'
const SOFA_CHECKPOINT = `${SOFA_REPO}/community_models/JPN_Test2_Plus/step.100000.server-practiced.ckpt`
const H_RUNNER = `${TO_LINUX_ROOT}/tools/alignment/run_h_v1_full.py`
const V5P_RUNTIME = `${TO_LINUX_ROOT}/package_v4c_finetune`
const V5P_JAPANESE = `${V5P_RUNTIME}/g2p/japanese.py`
const V5P_VOCAB = `${TO_LINUX_ROOT}/YingMusic-Singer-Plus-src/src/YingMusicSinger/utils/f5_tts/g2p/g2p/vocab.json`
const PREPARE_SCRIPT = `${PROJECT_ROOT}/server/scripts/v4h_prepare_job.py`
const COMPILE_SCRIPT = `${PROJECT_ROOT}/server/scripts/v5p_compile_text_control.py`
const FFMPEG_SHARED_BIN = 'C:/ffmpeg-shared/ffmpeg-8.1.1-full_build-shared/bin'

export interface SynthesisTextControlPhrase {
  id: string
  kana: string
  startFrame: number
  endFrameExclusive: number
  /**
   * The end of this phrase's H control ownership. This can be later than the
   * SOFA speech window when a Kana SEG is already known but later Kana units
   * have not been materialized yet.
   */
  controlEndFrameExclusive?: number
}

export interface SynthesisTextControlRequest {
  jobId: string
  inputWav: string
  guideSHA256: string
  frameCount: number
  sourceTrack: 'segment' | 'kana'
  sourceRevision: number
  phrases: SynthesisTextControlPhrase[]
  sofaEscapeSeconds?: number
  device?: string
}

interface ProcessEvent {
  type?: string
  message?: string
  region?: string
  index?: number
  total?: number
}

export function validateSynthesisTextControlRequest(req: SynthesisTextControlRequest): void {
  if (!/^[a-zA-Z0-9_-]{4,64}$/.test(req.jobId || '')) throw new Error('Text Control jobId 无效')
  if (!req.inputWav?.trim()) throw new Error('Text Control 缺少 Owned Guide WAV')
  if (!/^[a-f0-9]{64}$/i.test(req.guideSHA256 || '')) throw new Error('Owned Guide SHA256 无效')
  if (!Number.isInteger(req.frameCount) || req.frameCount < 1) throw new Error('frameCount 必须是正整数')
  if (req.sourceTrack !== 'segment' && req.sourceTrack !== 'kana') {
    throw new Error('Text Control sourceTrack 必须是 segment 或 kana')
  }
  if (!Number.isInteger(req.sourceRevision) || req.sourceRevision < 1) {
    throw new Error(`${req.sourceTrack === 'kana' ? 'KanaTrack' : 'SegmentTrack'} 尚未生成`)
  }
  const escapeSeconds = req.sofaEscapeSeconds ?? 0
  if (!Number.isFinite(escapeSeconds) || escapeSeconds < 0 || escapeSeconds > 2) {
    throw new Error('SOFA 逸散程度必须在 0s 到 2s 之间')
  }
  if (!Array.isArray(req.phrases) || req.phrases.length === 0) throw new Error('Text Control phrase 为空')

  const ids = new Set<string>()
  let previousEnd = -1
  for (const [index, phrase] of req.phrases.entries()) {
    if (!phrase.id?.trim() || ids.has(phrase.id)) throw new Error(`Phrase ${index + 1} ID 无效或重复`)
    ids.add(phrase.id)
    if (!phrase.kana?.trim()) throw new Error(`Phrase ${index + 1} 缺少 Kana`)
    if (!Number.isInteger(phrase.startFrame) || !Number.isInteger(phrase.endFrameExclusive)) {
      throw new Error(`Phrase ${index + 1} 边界必须是整数 frame`)
    }
    if (
      phrase.startFrame < 0
      || phrase.endFrameExclusive <= phrase.startFrame
      || phrase.endFrameExclusive > req.frameCount
      || phrase.startFrame < previousEnd
    ) {
      throw new Error(`Phrase ${index + 1} frame 范围无效或与前句重叠`)
    }
    if (phrase.controlEndFrameExclusive !== undefined && (
      !Number.isInteger(phrase.controlEndFrameExclusive)
      || phrase.controlEndFrameExclusive < phrase.endFrameExclusive
      || phrase.controlEndFrameExclusive > req.frameCount
    )) {
      throw new Error(`Phrase ${index + 1} H control 范围无效`)
    }
    if (req.sourceTrack === 'kana' && phrase.controlEndFrameExclusive === undefined) {
      throw new Error(`Kana phrase ${index + 1} 缺少 SEG control boundary`)
    }
    const nextPhrase = req.phrases[index + 1]
    if (
      nextPhrase
      && phrase.controlEndFrameExclusive !== undefined
      && phrase.controlEndFrameExclusive !== nextPhrase.startFrame
    ) {
      throw new Error(`Kana phrase ${index + 1} SEG control boundary 与下一句起点不一致`)
    }
    previousEnd = phrase.endFrameExclusive
  }
}

export function buildSynthesisTextControlJob(req: SynthesisTextControlRequest) {
  validateSynthesisTextControlRequest(req)
  return {
    schema: 'aisvc.v5p-text-control-job.v1',
    mode: 'b_only',
    melodyAudio: path.resolve(req.inputWav),
    guideSHA256: req.guideSHA256.toLowerCase(),
    frameCount: req.frameCount,
    sourceTrack: req.sourceTrack,
    sourceRevision: req.sourceRevision,
    targetPhrases: req.phrases.map(phrase => ({
      id: phrase.id,
      text: phrase.kana.trim(),
      start: frameToSeconds(phrase.startFrame),
      end: frameToSeconds(phrase.endFrameExclusive),
      startFrame: phrase.startFrame,
      endFrameExclusive: phrase.endFrameExclusive,
      ...(phrase.controlEndFrameExclusive === undefined
        ? {}
        : { controlEndFrameExclusive: phrase.controlEndFrameExclusive }),
    })),
  }
}

export function verifySynthesisTextControlResources(req: SynthesisTextControlRequest): void {
  validateSynthesisTextControlRequest(req)
  const resources = [
    req.inputWav,
    SOFA_PYTHON,
    SINGER_ROOT,
    SOFA_REPO,
    SOFA_CHECKPOINT,
    H_RUNNER,
    V5P_RUNTIME,
    V5P_JAPANESE,
    V5P_VOCAB,
    PREPARE_SCRIPT,
    COMPILE_SCRIPT,
  ]
  for (const resource of resources) {
    if (!fs.existsSync(resource)) throw new Error(`Text Control resource is missing: ${resource}`)
  }
  verifyOwnedGuideWav(req.inputWav, req.guideSHA256, req.frameCount)
}

export async function runSynthesisTextControl(
  req: SynthesisTextControlRequest,
  ws?: WebSocket,
): Promise<void> {
  try {
    verifySynthesisTextControlResources(req)
    const outputDir = path.resolve(PROJECT_ROOT, 'data', `render_${req.jobId}_v5p_text`)
    const jobManifest = path.join(outputDir, 'job.json')
    const alignmentFile = path.join(outputDir, 'alignment.json')
    const controlFile = path.join(outputDir, 'text-control.json')
    fs.mkdirSync(outputDir, { recursive: true })
    fs.writeFileSync(jobManifest, JSON.stringify(buildSynthesisTextControlJob(req), null, 2), 'utf-8')

    send(ws, { type: 'progress', progress: 5, message: '校验 V5-P Text Control 运行时' })
    await runJsonProcess(SOFA_PYTHON, [
      PREPARE_SCRIPT,
      '--job-manifest', jobManifest,
      '--output', alignmentFile,
      '--runtime', V5P_RUNTIME,
      '--h-runner', H_RUNNER,
      '--singer-root', SINGER_ROOT,
      '--sofa-repo', SOFA_REPO,
      '--sofa-checkpoint', SOFA_CHECKPOINT,
      '--escape-seconds', String(req.sofaEscapeSeconds ?? 0),
      '--japanese', V5P_JAPANESE,
      '--vocab', V5P_VOCAB,
      '--hash-contract', 'v5p-source-20260810',
      '--gpu', deviceIndex(req.device),
    ], event => {
      if (event.type === 'loading_sofa') send(ws, { type: 'progress', progress: 8, message: '加载 SOFA' })
      if (event.type === 'loaded_sofa') send(ws, { type: 'progress', progress: 18, message: 'SOFA 已加载' })
      if (event.type === 'align_phrase') {
        const fraction = Number(event.index || 0) / Math.max(Number(event.total || 1), 1)
        send(ws, {
          type: 'progress',
          progress: Math.round(18 + fraction * 70),
          message: `SOFA 对齐第 ${event.index}/${event.total} 句`,
        })
      }
    }, { id: `text-control:${req.jobId}`, kind: 'analysis', modelId: 'SOFA Japanese', device: req.device || 'cuda:0' })

    send(ws, { type: 'progress', progress: 90, message: '按训练 placement 编译 Kana/H' })
    await runJsonProcess(SOFA_PYTHON, [
      COMPILE_SCRIPT,
      '--alignment', alignmentFile,
      '--output', controlFile,
      '--runtime', V5P_RUNTIME,
      '--vocab', V5P_VOCAB,
      '--frame-count', String(req.frameCount),
    ], () => {}, { id: `text-compile:${req.jobId}`, kind: 'analysis', modelId: 'V5-P Text Compiler', device: 'cpu' })

    const result = JSON.parse(fs.readFileSync(controlFile, 'utf-8'))
    if (result.schema !== 'aisvc.v5p-text-control.v1' || result.frameCount !== req.frameCount) {
      throw new Error('Text Control compiler 返回了不兼容的结果')
    }
    send(ws, { type: 'text-control-result', result })
    send(ws, { type: 'done', controlFile, alignmentFile })
  } catch (error: any) {
    send(ws, { type: 'error', message: error?.message || String(error) })
  }
}

function frameToSeconds(frame: number): number {
  return frame * 2048 / 44100
}

function deviceIndex(device?: string): string {
  return String(device || 'cuda:0').match(/cuda:(\d+)/i)?.[1] ?? '0'
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
    if (runtime.device !== 'cpu') registerGpuProcess(child, runtime)
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
      if (wasGpuProcessReleased(child)) reject(new Error(GPU_PROCESS_CANCELLED_MESSAGE))
      else if (code === 0) resolve()
      else reject(new Error(reportedError || conciseProcessError(stderr) || `Text Control process exited with code ${code}`))
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

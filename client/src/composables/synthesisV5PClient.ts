import type { SynthesisMaterialSnapshot } from '@/object-workbench'
import { readSynthesisV5PResult, type SynthesisV5PResult } from './synthesisV5PProtocol'

export interface RunSynthesisV5POptions {
  referenceBlob: Blob
  targetBlob: Blob
  snapshot: SynthesisMaterialSnapshot
  steps?: number
  cfg?: number
  seed?: number
  onProgress?: (progress: number, message: string) => void
}

export async function runSynthesisV5P(
  options: RunSynthesisV5POptions,
): Promise<{ result: SynthesisV5PResult; blob: Blob }> {
  const jobId = `v5p-${crypto.randomUUID().slice(0, 12)}`
  options.onProgress?.(1, '上传 A/B Owned Guide')
  const [referenceUpload, targetUpload] = await Promise.all([
    uploadTempWav(`render_${jobId}_v5p_a`, options.referenceBlob),
    uploadTempWav(`render_${jobId}_v5p_b`, options.targetBlob),
  ])
  const request = {
    jobId,
    presetId: 'V5P_40K_EMA',
    referenceWav: referenceUpload.path,
    targetWav: targetUpload.path,
    snapshot: options.snapshot,
    steps: options.steps ?? 32,
    cfg: options.cfg ?? 1,
    seed: options.seed ?? 42,
    device: 'cuda:0',
  }
  options.onProgress?.(3, '服务端 preflight')
  const preflight = await fetch('/api/synthesis/v5p/preflight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!preflight.ok) throw new Error(await readError(preflight) || 'V5-P preflight 失败')

  const ws = await openRenderWebSocket(jobId)
  try {
    const done = waitForV5PDone(ws, jobId, options.onProgress)
    const response = await fetch('/api/synthesis/v5p/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
    if (!response.ok) throw new Error(await readError(response) || 'V5-P 启动失败')
    const result = await done
    const audio = await fetch(`/api/synthesis/v5p/jobs/${encodeURIComponent(jobId)}/take.wav`)
    if (!audio.ok) throw new Error(await readError(audio) || 'V5-P Take 音频读取失败')
    return { result, blob: await audio.blob() }
  } finally {
    ws.close()
  }
}

function waitForV5PDone(
  ws: WebSocket,
  jobId: string,
  onProgress?: RunSynthesisV5POptions['onProgress'],
): Promise<SynthesisV5PResult> {
  return new Promise((resolve, reject) => {
    let result: SynthesisV5PResult | null = null
    let settled = false
    ws.onmessage = event => {
      try {
        const message = JSON.parse(event.data)
        if (message.type === 'progress') {
          onProgress?.(Number(message.progress || 0), String(message.message || 'V5-P 合成中'))
          return
        }
        if (message.type === 'v5p-result') {
          result = readSynthesisV5PResult(message, jobId)
          if (!result) finishReject(new Error('V5-P 返回了不兼容的 Take'))
          return
        }
        if (message.type === 'error') return finishReject(new Error(message.message || 'V5-P 合成失败'))
        if (message.type === 'done') {
          if (!result) return finishReject(new Error('V5-P 未返回 Take'))
          settled = true
          onProgress?.(100, 'V5-P Take 完成')
          resolve(result)
        }
      } catch (error: any) {
        finishReject(error)
      }
    }
    ws.onerror = () => finishReject(new Error('V5-P WebSocket 连接失败'))
    ws.onclose = () => { if (!settled) finishReject(new Error('V5-P WebSocket 已断开')) }
    function finishReject(error: Error) {
      if (settled) return
      settled = true
      reject(error)
    }
  })
}

async function uploadTempWav(groupId: string, blob: Blob): Promise<{ path: string }> {
  const response = await fetch('/api/combine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupId, wavBase64: await blobToBase64(blob), sampleRate: 44100 }),
  })
  if (!response.ok) throw new Error(await readError(response) || 'Owned Guide 上传失败')
  return await response.json()
}

async function openRenderWebSocket(jobId: string): Promise<WebSocket> {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${protocol}://${window.location.hostname}:8101/ws/svc`)
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'register', jobId }))
      resolve()
    }
    ws.onerror = () => reject(new Error('V5-P WebSocket 连接失败'))
  })
  return ws
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error ?? new Error('Owned Guide 读取失败'))
    reader.readAsDataURL(blob)
  })
}

async function readError(response: Response): Promise<string> {
  try {
    const json = await response.json()
    return json.error || json.message || ''
  } catch {
    return response.statusText
  }
}

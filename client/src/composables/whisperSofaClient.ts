import { readWhisperSofaResult, whisperSofaProgressLabel, type WhisperSofaResult } from './whisperSofaProtocol'
import { useGpuRuntimeStore } from '@/stores/gpuRuntime'

export interface RunWhisperSofaOptions {
  blob: Blob
  sampleRate: number
  outputName: string
  vad?: boolean
  onProgress?: (progress: number, message: string) => void
}

export async function runWhisperSofa(options: RunWhisperSofaOptions): Promise<WhisperSofaResult> {
  const gpuRuntime = useGpuRuntimeStore()
  const releaseAfterWhisper = gpuRuntime.activeStageReleases[1]?.map(item => item.modelId) ?? []
  const jobId = crypto.randomUUID().slice(0, 8)
  options.onProgress?.(5, '上传 Whisper 音频')
  const upload = await uploadTempWav(`render_${jobId}_whisper`, options.blob, options.sampleRate)
  options.onProgress?.(10, '连接 Whisper')
  const ws = await openRenderWebSocket(jobId)
  try {
    const done = waitForWhisperSofaDone(ws, options.onProgress)
    const response = await fetch('/api/whisper/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobId,
        inputWav: upload.path,
        outputName: options.outputName,
        language: 'ja',
        vad: options.vad ?? true,
        device: 'cuda',
        computeType: 'float16',
        releaseAfterWhisper,
      }),
    })
    if (!response.ok) throw new Error(await readError(response) || 'Whisper 启动失败')
    return await done
  } finally {
    ws.close()
  }
}

function waitForWhisperSofaDone(
  ws: WebSocket,
  onProgress?: RunWhisperSofaOptions['onProgress'],
): Promise<WhisperSofaResult> {
  return new Promise((resolve, reject) => {
    let result: WhisperSofaResult | null = null
    let settled = false
    ws.onmessage = event => {
      try {
        const message = JSON.parse(event.data)
        if (message.type === 'progress') {
          onProgress?.(10 + Number(message.progress || 0) * 0.85, whisperSofaProgressLabel(message))
          return
        }
        if (message.type === 'log' && message.message) {
          onProgress?.(10 + Number(message.progress || 0) * 0.85, String(message.message))
          return
        }
        if (message.type === 'result') {
          result = readWhisperSofaResult(message)
          if (!result) finishReject(new Error('未收到 JPN_Test2_Plus 全段对齐结果'))
          return
        }
        if (message.type === 'error') {
          finishReject(new Error(message.message || 'Whisper 执行失败'))
          return
        }
        if (message.type === 'done') {
          if (!result) {
            finishReject(new Error('SOFA 未返回对齐后的 SegmentTrack'))
            return
          }
          settled = true
          onProgress?.(100, 'Whisper + SOFA 完成')
          resolve(result)
        }
      } catch (error: any) {
        finishReject(error)
      }
    }
    ws.onerror = () => finishReject(new Error('Whisper WebSocket 连接失败'))
    ws.onclose = () => {
      if (!settled) finishReject(new Error('Whisper WebSocket 已断开'))
    }

    function finishReject(error: Error) {
      if (settled) return
      settled = true
      reject(error)
    }
  })
}

async function uploadTempWav(groupId: string, blob: Blob, sampleRate: number): Promise<{ path: string; sampleRate: number }> {
  const response = await fetch('/api/combine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      groupId,
      wavBase64: await blobToBase64(blob),
      sampleRate,
    }),
  })
  if (!response.ok) throw new Error(await readError(response) || '上传临时 WAV 失败')
  return await response.json()
}

async function openRenderWebSocket(jobId: string): Promise<WebSocket> {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${protocol}://${window.location.hostname}:8101/ws/svc`)
  await new Promise<void>((resolve, reject) => {
    let settled = false
    ws.onopen = () => {
      settled = true
      ws.send(JSON.stringify({ type: 'register', jobId }))
      resolve()
    }
    ws.onerror = () => fail(new Error('Whisper WebSocket 连接失败'))
    ws.onclose = () => fail(new Error('Whisper WebSocket 在连接完成前关闭'))
    function fail(error: Error) {
      if (settled) return
      settled = true
      try { ws.close() } catch {}
      reject(error)
    }
  })
  return ws
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error ?? new Error('音频读取失败'))
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

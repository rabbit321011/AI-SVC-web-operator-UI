import {
  readSynthesisTextControlResult,
  type SynthesisTextControlResult,
} from './synthesisTextControlProtocol'

export interface SynthesisTextControlPhraseInput {
  id: string
  kana: string
  startFrame: number
  endFrameExclusive: number
  controlEndFrameExclusive?: number
}

export interface RunSynthesisTextControlOptions {
  blob: Blob
  sampleRate: number
  guideSHA256: string
  frameCount: number
  sourceTrack: 'segment' | 'kana'
  sourceRevision: number
  phrases: SynthesisTextControlPhraseInput[]
  sofaEscapeSeconds?: number
  onProgress?: (progress: number, message: string) => void
}

export async function runSynthesisTextControl(
  options: RunSynthesisTextControlOptions,
): Promise<SynthesisTextControlResult> {
  const jobId = `text-${crypto.randomUUID().slice(0, 12)}`
  options.onProgress?.(2, '上传 Owned Guide')
  const upload = await uploadTempWav(`render_${jobId}_guide`, options.blob, options.sampleRate)
  const ws = await openRenderWebSocket(jobId)
  try {
    const done = waitForTextControlDone(ws, options.frameCount, options.onProgress)
    const response = await fetch('/api/synthesis/text-control/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobId,
        inputWav: upload.path,
        guideSHA256: options.guideSHA256,
        frameCount: options.frameCount,
        sourceTrack: options.sourceTrack,
        sourceRevision: options.sourceRevision,
        phrases: options.phrases,
        sofaEscapeSeconds: options.sofaEscapeSeconds ?? 0,
        device: 'cuda:0',
      }),
    })
    if (!response.ok) throw new Error(await readError(response) || 'Text Control 启动失败')
    return await done
  } finally {
    ws.close()
  }
}

function waitForTextControlDone(
  ws: WebSocket,
  frameCount: number,
  onProgress?: RunSynthesisTextControlOptions['onProgress'],
): Promise<SynthesisTextControlResult> {
  return new Promise((resolve, reject) => {
    let result: SynthesisTextControlResult | null = null
    let settled = false
    ws.onmessage = event => {
      try {
        const message = JSON.parse(event.data)
        if (message.type === 'progress') {
          onProgress?.(Number(message.progress || 0), String(message.message || 'Text Control 处理中'))
          return
        }
        if (message.type === 'text-control-result') {
          result = readSynthesisTextControlResult(message, frameCount)
          if (!result) finishReject(new Error('Text Control 返回了不兼容的数据'))
          return
        }
        if (message.type === 'error') {
          finishReject(new Error(message.message || 'Text Control 编译失败'))
          return
        }
        if (message.type === 'done') {
          if (!result) return finishReject(new Error('Text Control 未返回编译结果'))
          settled = true
          onProgress?.(100, 'Text Control 编译完成')
          resolve(result)
        }
      } catch (error: any) {
        finishReject(error)
      }
    }
    ws.onerror = () => finishReject(new Error('Text Control WebSocket 连接失败'))
    ws.onclose = () => {
      if (!settled) finishReject(new Error('Text Control WebSocket 已断开'))
    }

    function finishReject(error: Error) {
      if (settled) return
      settled = true
      reject(error)
    }
  })
}

async function uploadTempWav(groupId: string, blob: Blob, sampleRate: number): Promise<{ path: string }> {
  const response = await fetch('/api/combine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupId, wavBase64: await blobToBase64(blob), sampleRate }),
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
    ws.onerror = () => reject(new Error('Text Control WebSocket 连接失败'))
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

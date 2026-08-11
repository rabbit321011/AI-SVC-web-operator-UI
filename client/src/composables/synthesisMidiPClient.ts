import { readSynthesisMidiPResult, type SynthesisMidiPResult } from './synthesisMidiPProtocol'

export interface RunSynthesisMidiPOptions {
  blob: Blob
  sampleRate: number
  guideSHA256: string
  frameCount: number
  midiPRevision: number
  onProgress?: (progress: number, message: string) => void
}

export async function runSynthesisMidiP(options: RunSynthesisMidiPOptions): Promise<SynthesisMidiPResult> {
  const jobId = `midi-p-${crypto.randomUUID().slice(0, 12)}`
  options.onProgress?.(2, '上传 Owned Guide')
  const upload = await uploadTempWav(`render_${jobId}_guide`, options.blob, options.sampleRate)
  const ws = await openRenderWebSocket(jobId)
  try {
    const done = waitForMidiPDone(ws, options.frameCount, options.onProgress)
    const response = await fetch('/api/synthesis/midi-p/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobId,
        inputWav: upload.path,
        guideSHA256: options.guideSHA256,
        frameCount: options.frameCount,
        midiPRevision: options.midiPRevision,
        device: 'cuda:0',
      }),
    })
    if (!response.ok) throw new Error(await readError(response) || 'GAME MIDI-P 启动失败')
    return await done
  } finally {
    ws.close()
  }
}

function waitForMidiPDone(
  ws: WebSocket,
  frameCount: number,
  onProgress?: RunSynthesisMidiPOptions['onProgress'],
): Promise<SynthesisMidiPResult> {
  return new Promise((resolve, reject) => {
    let result: SynthesisMidiPResult | null = null
    let settled = false
    ws.onmessage = event => {
      try {
        const message = JSON.parse(event.data)
        if (message.type === 'progress') {
          onProgress?.(Number(message.progress || 0), String(message.message || 'GAME MIDI-P 处理中'))
          return
        }
        if (message.type === 'midi-p-result') {
          result = readSynthesisMidiPResult(message, frameCount)
          if (!result) finishReject(new Error('GAME 返回了不兼容的 MIDI-P 数据'))
          return
        }
        if (message.type === 'error') return finishReject(new Error(message.message || 'GAME MIDI-P 失败'))
        if (message.type === 'done') {
          if (!result) return finishReject(new Error('GAME 未返回 MIDI-P layer'))
          settled = true
          onProgress?.(100, 'GAME MIDI-P 完成')
          resolve(result)
        }
      } catch (error: any) {
        finishReject(error)
      }
    }
    ws.onerror = () => finishReject(new Error('GAME MIDI-P WebSocket 连接失败'))
    ws.onclose = () => { if (!settled) finishReject(new Error('GAME MIDI-P WebSocket 已断开')) }
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
    ws.onerror = () => reject(new Error('GAME MIDI-P WebSocket 连接失败'))
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

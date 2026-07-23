import { combineSegmentsToBlob } from '@/api/wav'
import { resolveAudioRenderInputToSegmentInputs } from '@/object-workbench'
import type { TextSegment } from '@/object-workbench'
import { useObjectTreeStore } from '@/stores/objectTree'
import { useProjectStore } from '@/stores/project'
import { useRenderPanelStore } from '@/stores/renderPanel'
import { useTracksStore } from '@/stores/tracks'
import { readWhisperSofaResult, whisperSofaProgressLabel } from './whisperSofaProtocol'

export function useRenderWhisperPipeline() {
  const renderPanel = useRenderPanelStore()
  const objectTree = useObjectTreeStore()
  const tracks = useTracksStore()
  const project = useProjectStore()

  async function startWhisper() {
    if (renderPanel.isLocalProcessingRunning) return
    const audio = renderPanel.whisper.audio
    if (!audio) {
      renderPanel.setWhisperFailed('Whisper 槽位不完整')
      return
    }

    const jobId = crypto.randomUUID().slice(0, 8)
    if (!renderPanel.setWhisperRunning('解析 Whisper 输入')) return
    let ws: WebSocket | null = null

    try {
      const resolved = await resolveAudioRenderInputToSegmentInputs({
        tree: objectTree.tree,
        input: audio,
        sourceBlobs: tracks.sourceBlobs,
        segments: tracks.segmentsMap,
        tracks: tracks.tracks,
      })
      renderPanel.updateWhisperProgress(10, mergeWarnings('合并转写音频', resolved.warnings))
      const blob = await combineSegmentsToBlob(resolved.segmentInputs, resolved.duration, resolved.sampleRate)
      renderPanel.updateWhisperProgress(20, '上传 Whisper 音频')
      const upload = await uploadTempWav(`render_${jobId}_whisper`, blob, resolved.sampleRate)

      renderPanel.updateWhisperProgress(25, '连接 Whisper')
      ws = await openRenderWebSocket(jobId)
      const done = waitForWhisperDone(ws, resolved.sourceStart, resolved.sourceEnd)

      renderPanel.updateWhisperProgress(30, '启动 Whisper')
      const resp = await fetch('/api/whisper/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          inputWav: upload.path,
          outputName: renderPanel.whisper.outputName || defaultWhisperOutputName(),
          language: 'ja',
          vad: renderPanel.whisper.vad,
          device: 'cuda',
          computeType: 'float16',
        }),
      })
      if (!resp.ok) throw new Error(await readError(resp) || 'Whisper 启动失败')
      await done
    } catch (error: any) {
      renderPanel.setWhisperFailed(error?.message || 'Whisper 执行失败')
    } finally {
      if (ws) ws.close()
    }
  }

  function waitForWhisperDone(ws: WebSocket, timelineStart: number, timelineEnd: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let resultSegments: TextSegment[] | null = null
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'progress') {
            renderPanel.updateWhisperProgress(30 + Number(msg.progress || 0) * 0.6, whisperSofaProgressLabel(msg))
            return
          }
          if (msg.type === 'log' && msg.message) {
            renderPanel.updateWhisperProgress(renderPanel.whisperProgress, String(msg.message))
            return
          }
          if (msg.type === 'result') {
            const aligned = readWhisperSofaResult(msg)
            if (!aligned) {
              reject(new Error('未收到 JPN_Test2_Plus 全段对齐结果'))
              return
            }
            resultSegments = aligned.segments
            return
          }
          if (msg.type === 'error') {
            reject(new Error(msg.message || 'Whisper 执行失败'))
            return
          }
          if (msg.type === 'done') {
            if (!resultSegments) {
              reject(new Error('SOFA 未返回对齐后的 TextObject'))
              return
            }
            renderPanel.updateWhisperProgress(96, '写入 SOFA TextObject')
            const result = objectTree.addRenderedTextToTimeline({
              outputName: renderPanel.whisper.outputName || defaultWhisperOutputName(),
              renderKind: 'whisper',
              segments: resultSegments,
              timelineStart,
              timelineEnd,
            })
            if (!result.ok) throw new Error(result.reason || 'Whisper 文本回填失败')
            project.bumpRedraw()
            renderPanel.setWhisperDone(`Whisper + SOFA 完成: ${result.outputName}`)
            resolve()
          }
        } catch (error: any) {
          reject(error)
        }
      }
      ws.onerror = () => reject(new Error('Whisper WebSocket 连接失败'))
      ws.onclose = () => {
        if (renderPanel.whisperStatus === 'running') reject(new Error('Whisper WebSocket 已断开'))
      }
    })
  }

  function defaultWhisperOutputName() {
    return `${renderPanel.whisper.audio?.displayName || 'audio'}_sofa`
  }

  return { startWhisper }
}

async function uploadTempWav(groupId: string, blob: Blob, sampleRate: number): Promise<{ path: string; sampleRate: number }> {
  const resp = await fetch('/api/combine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      groupId,
      wavBase64: await blobToBase64(blob),
      sampleRate,
    }),
  })
  if (!resp.ok) throw new Error(await readError(resp) || '上传临时 WAV 失败')
  return await resp.json()
}

async function openRenderWebSocket(jobId: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://${window.location.hostname}:8101/ws/svc`)
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'register', jobId }))
      resolve()
    }
    ws.onerror = () => reject(new Error('Whisper WebSocket 连接失败'))
  })
  return ws
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise(resolve => {
    const reader = new FileReader()
    reader.onloadend = () => resolve((reader.result as string).split(',')[1])
    reader.readAsDataURL(blob)
  })
}

async function readError(resp: Response): Promise<string> {
  try {
    const json = await resp.json()
    return json.error || json.message || ''
  } catch {
    return resp.statusText
  }
}

function mergeWarnings(message: string, warnings: string[]): string {
  return warnings.length > 0 ? `${message} (${warnings.length} 个提示)` : message
}

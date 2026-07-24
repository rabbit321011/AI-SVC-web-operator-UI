import { combineSegmentsToBlob } from '@/api/wav'
import { resolveAudioRenderInputToSegmentInputs } from '@/object-workbench'
import { useObjectTreeStore } from '@/stores/objectTree'
import { useProjectStore } from '@/stores/project'
import { useRenderPanelStore } from '@/stores/renderPanel'
import { useTracksStore } from '@/stores/tracks'

type MsstOutputId = 'vocals' | 'instrumental' | 'dry' | 'other'

export function useRenderMsstPipeline() {
  const renderPanel = useRenderPanelStore()
  const objectTree = useObjectTreeStore()
  const tracks = useTracksStore()
  const project = useProjectStore()

  async function startMsst() {
    if (renderPanel.isLocalProcessingRunning) return
    const audio = renderPanel.msst.audio
    if (!audio) {
      renderPanel.setMsstFailed('MSST 槽位不完整')
      return
    }
    const jobId = crypto.randomUUID().slice(0, 8)
    if (!renderPanel.setMsstRunning('解析 MSST 输入')) return
    let ws: WebSocket | null = null
    try {
      const resolved = await resolveAudioRenderInputToSegmentInputs({
        tree: objectTree.tree, input: audio, sourceBlobs: tracks.sourceBlobs,
        segments: tracks.segmentsMap, tracks: tracks.tracks,
      })
      renderPanel.updateMsstProgress(8, '合并 MSST 音频')
      const blob = await combineSegmentsToBlob(resolved.segmentInputs, resolved.duration, resolved.sampleRate)
      const upload = await uploadTempWav(`render_${jobId}_msst_input`, blob, resolved.sampleRate)
      renderPanel.updateMsstProgress(15, '连接 MSST')
      ws = await openRenderWebSocket(jobId)
      const done = waitForDone(ws, jobId, resolved.sourceStart)
      const response = await fetch('/api/msst/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, inputWav: upload.path, model: renderPanel.msst.model, device: 'cuda' }),
      })
      if (!response.ok) throw new Error(await readError(response) || 'MSST 启动失败')
      await done
    } catch (error: any) {
      renderPanel.setMsstFailed(error?.message || 'MSST 执行失败')
    } finally {
      ws?.close()
    }
  }

  function waitForDone(ws: WebSocket, jobId: string, timelineStart: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let available = new Set<MsstOutputId>()
      ws.onmessage = async event => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'progress') {
            const labels: Record<string, string> = { duality: '分离人声/伴奏', dereverb: '去混响/回声', denoise: '降噪', complete: '整理输出' }
            renderPanel.updateMsstProgress(15 + Number(msg.progress || 0) * 0.75, labels[msg.stage] || 'MSST 推理中')
            return
          }
          if (msg.type === 'result') {
            available = new Set(Object.keys(msg.outputs || {}) as MsstOutputId[])
            return
          }
          if (msg.type === 'error') {
            reject(new Error(msg.message || 'MSST 执行失败'))
            return
          }
          if (msg.type !== 'done') return
          const selected = selectedOutputs(renderPanel.msst.model, renderPanel.msst.outputMode).filter(id => available.has(id))
          if (selected.length === 0) throw new Error('MSST 未返回所选输出')
          const outputs = renderPanel.msst.backfillAll ? selected : selected.slice(0, 1)
          const names: string[] = []
          for (const outputId of outputs) {
            const outputLabel = labelOutput(renderPanel.msst.model, outputId)
            renderPanel.updateMsstProgress(92, `回填 ${outputLabel}`)
            const response = await fetch(`/api/msst/result/${jobId}/${outputId}.wav`)
            if (!response.ok) throw new Error(await readError(response) || `下载 ${outputId} 失败`)
            const result = await objectTree.addRenderedAudioToTimeline({
              blob: await response.blob(),
              outputFileName: `${renderPanel.msst.outputName || defaultOutputName()}_${outputLabel}`,
              renderKind: 'msst', timelineStart,
            })
            if (!result.ok) throw new Error(result.reason || `${outputId} 回填失败`)
            names.push(result.outputFileName || outputId)
          }
          project.bumpRedraw()
          renderPanel.setMsstDone(`MSST 完成: ${names.join(', ')}`)
          resolve()
        } catch (error: any) { reject(error) }
      }
      ws.onerror = () => reject(new Error('MSST WebSocket 连接失败'))
      ws.onclose = () => {
        if (renderPanel.msstStatus === 'running') reject(new Error('MSST WebSocket 已断开'))
      }
    })
  }

  function defaultOutputName() {
    return `MSST_${renderPanel.msst.audio?.displayName || 'audio'}`
  }
  return { startMsst }
}

function selectedOutputs(model: string, mode: string): MsstOutputId[] {
  const pair: MsstOutputId[] = model === 'duality' ? ['vocals', 'instrumental'] : ['dry', 'other']
  if (mode === 'primary') return pair.slice(0, 1)
  if (mode === 'secondary') return pair.slice(1)
  return pair
}

function labelOutput(model: string, outputId: MsstOutputId): string {
  if (outputId === 'vocals') return 'Vocals'
  if (outputId === 'instrumental') return 'Instrumental'
  const stage = model === 'dereverb' ? 'Dereverb' : 'Denoise'
  return `${stage}_${outputId === 'dry' ? 'Dry' : 'Other'}`
}

async function uploadTempWav(groupId: string, blob: Blob, sampleRate: number) {
  const response = await fetch('/api/combine', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupId, wavBase64: await blobToBase64(blob), sampleRate }),
  })
  if (!response.ok) throw new Error(await readError(response) || '上传临时 WAV 失败')
  return await response.json() as { path: string }
}

async function openRenderWebSocket(jobId: string) {
  const ws = new WebSocket(`ws://${window.location.hostname}:8101/ws/svc`)
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => { ws.send(JSON.stringify({ type: 'register', jobId })); resolve() }
    ws.onerror = () => reject(new Error('MSST WebSocket 连接失败'))
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

async function readError(response: Response) {
  try { const json = await response.json(); return json.error || json.message || '' } catch { return response.statusText }
}

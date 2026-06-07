import { combineSegmentsToBlob } from '@/api/wav'
import { resolveAudioRenderInputToSegmentInputs } from '@/object-workbench'
import { useObjectTreeStore } from '@/stores/objectTree'
import { useProjectStore } from '@/stores/project'
import { useRenderPanelStore } from '@/stores/renderPanel'
import { useSvcConfigStore } from '@/stores/svcConfig'
import { useTracksStore } from '@/stores/tracks'

export function useRenderSvcPipeline() {
  const renderPanel = useRenderPanelStore()
  const objectTree = useObjectTreeStore()
  const tracks = useTracksStore()
  const svcConfig = useSvcConfigStore()
  const project = useProjectStore()

  async function startSvc() {
    if (renderPanel.svcStatus === 'running') return
    const condAudio = renderPanel.svc.condAudio
    const sourceAudio = renderPanel.svc.sourceAudio
    if (!condAudio || !sourceAudio) {
      renderPanel.setSvcFailed('SVC 槽位不完整')
      return
    }

    const jobId = crypto.randomUUID().slice(0, 8)
    renderPanel.setSvcRunning(jobId, '解析输入')
    let ws: WebSocket | null = null

    try {
      const source = await resolveAudioRenderInputToSegmentInputs({
        tree: objectTree.tree,
        input: sourceAudio,
        sourceBlobs: tracks.sourceBlobs,
        segments: tracks.segmentsMap,
        tracks: tracks.tracks,
      })
      const cond = await resolveAudioRenderInputToSegmentInputs({
        tree: objectTree.tree,
        input: condAudio,
        sourceBlobs: tracks.sourceBlobs,
        segments: tracks.segmentsMap,
        tracks: tracks.tracks,
      })

      renderPanel.updateSvcProgress(5, mergeWarnings('合并被变声音频', source.warnings, cond.warnings))
      const sourceBlob = await combineSegmentsToBlob(source.segmentInputs, source.duration, source.sampleRate)
      renderPanel.updateSvcProgress(10, '上传被变声音频')
      const sourceUpload = await uploadTempWav(`render_${jobId}_source`, sourceBlob, source.sampleRate)

      renderPanel.updateSvcProgress(15, '合并 cond 音频')
      const condBlob = await combineSegmentsToBlob(cond.segmentInputs, cond.duration, cond.sampleRate)
      renderPanel.updateSvcProgress(20, '上传 cond 音频')
      const condUpload = await uploadTempWav(`render_${jobId}_cond`, condBlob, cond.sampleRate)

      renderPanel.updateSvcProgress(25, '连接 SVC')
      ws = await openSvcWebSocket(jobId)
      const done = waitForSvcDone(ws, jobId, source.sourceStart)

      renderPanel.updateSvcProgress(30, '启动 SVC')
      const runResp = await fetch('/api/svc/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          combinedWav: sourceUpload.path,
          targetWav: condUpload.path,
          checkpoint: svcConfig.config.checkpoint,
          configYml: svcConfig.config.configYml,
          diffusionSteps: renderPanel.svc.steps || svcConfig.config.diffusionSteps,
          inferenceCfgRate: renderPanel.svc.cfg ?? svcConfig.config.inferenceCfgRate,
          f0Condition: svcConfig.config.f0Condition,
          semiToneShift: svcConfig.config.semiToneShift,
          device: svcConfig.config.device,
          fp16: svcConfig.config.fp16,
          compGroupId: `render_${jobId}`,
        }),
      })
      if (!runResp.ok) {
        const error = await readError(runResp)
        throw new Error(error || 'SVC 启动失败')
      }

      await done
    } catch (error: any) {
      renderPanel.setSvcFailed(error?.message || 'SVC 执行失败')
    } finally {
      if (ws) ws.close()
    }
  }

  function waitForSvcDone(ws: WebSocket, jobId: string, timelineStart: number): Promise<void> {
    return new Promise((resolve, reject) => {
      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'progress') {
            renderPanel.updateSvcProgress(30 + Number(msg.progress || 0) * 0.6, 'SVC 推理中')
            return
          }
          if (msg.type === 'log' && msg.message) {
            renderPanel.updateSvcProgress(renderPanel.svcProgress, String(msg.message))
            return
          }
          if (msg.type === 'error') {
            reject(new Error(msg.message || 'SVC 执行失败'))
            return
          }
          if (msg.type === 'done') {
            if (!msg.outputFile) {
              reject(new Error('SVC 未生成 WAV 输出'))
              return
            }
            renderPanel.updateSvcProgress(92, '下载 SVC 结果')
            const resp = await fetch(`/api/svc/result/${jobId}.wav`)
            if (!resp.ok) throw new Error(await readError(resp) || '下载 SVC 结果失败')
            const blob = await resp.blob()
            renderPanel.updateSvcProgress(96, '写入对象树')
            const result = await objectTree.addRenderedAudioToTimeline({
              blob,
              outputFileName: renderPanel.svc.outputName || defaultSvcOutputName(),
              renderKind: 'svc',
              timelineStart,
            })
            if (!result.ok) throw new Error(result.reason || 'SVC 结果回填失败')
            project.bumpRedraw()
            renderPanel.setSvcDone(`SVC 完成: ${result.outputFileName}`)
            resolve()
          }
        } catch (error: any) {
          reject(error)
        }
      }
      ws.onerror = () => reject(new Error('SVC WebSocket 连接失败'))
      ws.onclose = () => {
        if (renderPanel.svcStatus === 'running') reject(new Error('SVC WebSocket 已断开'))
      }
    })
  }

  function defaultSvcOutputName() {
    const sourceName = renderPanel.svc.sourceAudio?.displayName || 'source'
    const modelName = svcConfig.config.modelName || 'model'
    return `SVC_${sourceName}_${modelName}`
  }

  return { startSvc }
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
  if (!resp.ok) {
    const error = await readError(resp)
    throw new Error(error || '上传临时 WAV 失败')
  }
  return await resp.json()
}

async function openSvcWebSocket(jobId: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://${window.location.hostname}:8101/ws/svc`)
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'register', jobId }))
      resolve()
    }
    ws.onerror = () => reject(new Error('SVC WebSocket 连接失败'))
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

function mergeWarnings(message: string, ...warnings: string[][]): string {
  const flattened = warnings.flat()
  return flattened.length > 0 ? `${message} (${flattened.length} 个提示)` : message
}

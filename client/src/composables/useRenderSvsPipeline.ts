import { combineSegmentsToBlob } from '@/api/wav'
import { buildNodeIndex, getRenderInputMediaType, normalizeSvsText, resolveAudioRenderInputToSegmentInputs, resolveTextRenderInput } from '@/object-workbench'
import { useObjectTreeStore } from '@/stores/objectTree'
import { useProjectStore } from '@/stores/project'
import { useRenderPanelStore } from '@/stores/renderPanel'
import { useSvsConfigStore } from '@/stores/svsConfig'
import { useTracksStore } from '@/stores/tracks'

export function useRenderSvsPipeline() {
  const renderPanel = useRenderPanelStore()
  const objectTree = useObjectTreeStore()
  const project = useProjectStore()
  const tracks = useTracksStore()
  const svsConfig = useSvsConfigStore()

  async function dryRunSvs() {
    if (renderPanel.isLocalProcessingRunning) return
    const timbreAudio = renderPanel.svs.timbreAudio
    const melody = renderPanel.svs.melody
    if (!timbreAudio || !melody) {
      renderPanel.setSvsFailed('SVS 槽位不完整')
      return
    }

    const jobId = crypto.randomUUID().slice(0, 8)
    if (!renderPanel.setSvsRunning(jobId, '解析 SVS 输入')) return

    try {
      const prepared = await prepareSvsRequest(jobId, { allowMidiMelody: true })
      renderPanel.updateSvsProgress(80, prepared.melodyType === 'midi' ? 'MIDI 旋律 dryRun 暂不上传 melody_audio' : '请求 SVS dryRun')
      const resp = await fetch('/api/svs/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...prepared.body,
          dryRun: true,
        }),
      })
      if (!resp.ok) throw new Error(await readError(resp) || 'SVS dryRun 失败')
      const result = await resp.json()
      const melodyLabel = prepared.body.melodyAudio ? '含 melody_audio' : '未带 melody_audio'
      renderPanel.setSvsDone(`SVS dryRun OK: ${result.args?.length ?? 0} args, ${melodyLabel}`)
    } catch (error: any) {
      renderPanel.setSvsFailed(error?.message || 'SVS dryRun 失败')
    }
  }

  async function startSvs() {
    if (renderPanel.isLocalProcessingRunning) return
    const timbreAudio = renderPanel.svs.timbreAudio
    const melody = renderPanel.svs.melody
    if (!timbreAudio || !melody) {
      renderPanel.setSvsFailed('SVS 槽位不完整')
      return
    }

    const jobId = crypto.randomUUID().slice(0, 8)
    if (!renderPanel.setSvsRunning(jobId, '解析 SVS 输入')) return
    let ws: WebSocket | null = null

    try {
      const prepared = await prepareSvsRequest(jobId, { allowMidiMelody: false })
      renderPanel.updateSvsProgress(70, '连接 SVS')
      ws = await openRenderWebSocket(jobId)
      const done = waitForSvsDone(ws, jobId, prepared.timelineStart)

      renderPanel.updateSvsProgress(75, '启动 SVS')
      const runResp = await fetch('/api/svs/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...prepared.body,
          jobId,
          dryRun: false,
        }),
      })
      if (!runResp.ok) throw new Error(await readError(runResp) || 'SVS 启动失败')

      await done
    } catch (error: any) {
      renderPanel.setSvsFailed(error?.message || 'SVS 执行失败')
    } finally {
      if (ws) ws.close()
    }
  }

  async function prepareSvsRequest(jobId: string, options: { allowMidiMelody: boolean }): Promise<{
    body: {
      refAudio: string
      melodyAudio?: string
      targetText: string
      output: string
      steps: number
      cfg: number
      seed: number
      device: string
      checkpoint?: string
    }
    melodyType: 'audio' | 'midi'
    timelineStart: number
  }> {
    const timbreAudio = renderPanel.svs.timbreAudio
    const melody = renderPanel.svs.melody
    if (!timbreAudio || !melody) throw new Error('SVS 槽位不完整')

    const melodyType = getRenderInputMediaType(buildNodeIndex(objectTree.tree.root), melody)
    if (!melodyType) throw new Error('旋律对象不存在')
    if (melodyType !== 'audio' && melodyType !== 'midi') {
      throw new Error('旋律槽只接受 audio 或 midi TrackObject/GroupObject')
    }
    if (melodyType === 'midi' && !options.allowMidiMelody) {
      throw new Error('真实 SVS 暂未接入 MIDI 旋律转 melody_audio，请先使用 audio TrackObject/GroupObject')
    }

    const timbre = await resolveAudioRenderInputToSegmentInputs({
      tree: objectTree.tree,
      input: timbreAudio,
      sourceBlobs: tracks.sourceBlobs,
      segments: tracks.segmentsMap,
      tracks: tracks.tracks,
    })
    renderPanel.updateSvsProgress(15, mergeWarnings('合并音色音频', timbre.warnings))
    const timbreBlob = await combineSegmentsToBlob(timbre.segmentInputs, timbre.duration, timbre.sampleRate)
    renderPanel.updateSvsProgress(30, '上传音色音频')
    const timbreUpload = await uploadTempWav(`render_${jobId}_svs_timbre`, timbreBlob, timbre.sampleRate)

    let melodyAudioPath: string | undefined
    let timelineStart = 0
    if (melodyType === 'audio') {
      const melodyAudio = await resolveAudioRenderInputToSegmentInputs({
        tree: objectTree.tree,
        input: melody,
        sourceBlobs: tracks.sourceBlobs,
        segments: tracks.segmentsMap,
        tracks: tracks.tracks,
      })
      timelineStart = melodyAudio.sourceStart
      renderPanel.updateSvsProgress(45, mergeWarnings('合并旋律音频', melodyAudio.warnings))
      const melodyBlob = await combineSegmentsToBlob(melodyAudio.segmentInputs, melodyAudio.duration, melodyAudio.sampleRate)
      renderPanel.updateSvsProgress(60, '上传旋律音频')
      melodyAudioPath = (await uploadTempWav(`render_${jobId}_svs_melody`, melodyBlob, melodyAudio.sampleRate)).path
    }

    const targetText = resolveTargetText()
    const output = outputPathBeside(timbreUpload.path, outputWavFileName(renderPanel.svs.outputName || defaultSvsOutputName()))
    return {
      body: {
        refAudio: timbreUpload.path,
        melodyAudio: melodyAudioPath,
        targetText,
        output,
        steps: renderPanel.svs.steps,
        cfg: renderPanel.svs.cfg,
        seed: renderPanel.svs.seed,
        device: renderPanel.svs.device,
        checkpoint: svsConfig.selectedCheckpoint || undefined,
      },
      melodyType,
      timelineStart,
    }
  }

  function waitForSvsDone(ws: WebSocket, jobId: string, timelineStart: number): Promise<void> {
    return new Promise((resolve, reject) => {
      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'log' && msg.message) {
            const message = String(msg.message).trim()
            renderPanel.updateSvsProgress(message.includes('[done]') ? 90 : renderPanel.svsProgress, message || 'SVS 推理中')
            return
          }
          if (msg.type === 'error') {
            reject(new Error(msg.message || 'SVS 执行失败'))
            return
          }
          if (msg.type === 'done') {
            if (!msg.outputFile) {
              reject(new Error('SVS 未生成 WAV 输出'))
              return
            }
            renderPanel.updateSvsProgress(92, '下载 SVS 结果')
            const resp = await fetch(`/api/svs/result/${jobId}.wav`)
            if (!resp.ok) throw new Error(await readError(resp) || '下载 SVS 结果失败')
            const blob = await resp.blob()
            renderPanel.updateSvsProgress(96, '写入对象树')
            const result = await objectTree.addRenderedAudioToTimeline({
              blob,
              outputFileName: renderPanel.svs.outputName || defaultSvsOutputName(),
              renderKind: 'svs',
              timelineStart,
            })
            if (!result.ok) throw new Error(result.reason || 'SVS 结果回填失败')
            project.bumpRedraw()
            renderPanel.setSvsDone(`SVS 完成: ${result.outputFileName}`)
            resolve()
          }
        } catch (error: any) {
          reject(error)
        }
      }
      ws.onerror = () => reject(new Error('SVS WebSocket 连接失败'))
      ws.onclose = () => {
        if (renderPanel.svsStatus === 'running') reject(new Error('SVS WebSocket 已断开'))
      }
    })
  }

  function resolveTargetText(): string {
    if (renderPanel.svs.textMode === 'manual') {
      const text = normalizeSvsText(renderPanel.svs.manualText)
      if (!text) throw new Error('target text 为空')
      return text
    }
    if (!renderPanel.svs.textRef) throw new Error('target text 引用为空')
    return resolveTextRenderInput(objectTree.tree, renderPanel.svs.textRef).text
  }

  function defaultSvsOutputName() {
    const melodyName = renderPanel.svs.melody?.displayName || 'melody'
    return `SVS_${melodyName}_SingerPlus`
  }

  return { dryRunSvs, startSvs }
}

function outputWavFileName(name: string): string {
  const base = (name.trim() || 'output')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .slice(0, 80)
  const wavName = base.toLowerCase().endsWith('.wav') ? base : `${base}.wav`
  return wavName.toLowerCase() === 'combined.wav' ? 'svs_output.wav' : wavName
}

function outputPathBeside(referencePath: string, fileName: string): string {
  const slash = Math.max(referencePath.lastIndexOf('/'), referencePath.lastIndexOf('\\'))
  return slash >= 0 ? `${referencePath.slice(0, slash + 1)}${fileName}` : fileName
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
    ws.onerror = () => reject(new Error('SVS WebSocket 连接失败'))
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

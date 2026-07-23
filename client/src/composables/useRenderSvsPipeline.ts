import { combineSegmentsToBlob } from '@/api/wav'
import {
  buildNodeIndex,
  getRenderInputMediaType,
  rebaseTimedSvsPhrases,
  resolveAudioRenderInputToSegmentInputs,
  resolveGroupObjectInput,
  resolveTextRenderInput,
  resolveTrackObjectInput,
  type TimedSvsPhrase,
} from '@/object-workbench'
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
      const prepared = await prepareSvsRequest(jobId, { allowMidiMelody: true, uploadAudio: false })
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
      const prepared = await prepareSvsRequest(jobId, { allowMidiMelody: false, uploadAudio: true })
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

  async function prepareSvsRequest(jobId: string, options: { allowMidiMelody: boolean; uploadAudio: boolean }): Promise<{
    body: {
      refAudio: string
      melodyAudio?: string
      refPhrases: TimedSvsPhrase[]
      targetPhrases: TimedSvsPhrase[]
      output: string
      modelId?: string
      steps: number
      cfg: number
      seed: number
      device: string
      checkpoint?: string
      vaeCheckpoint?: string
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
    let timbreAudioPath = `dry-run/${jobId}/ref.wav`
    if (options.uploadAudio) {
      renderPanel.updateSvsProgress(15, mergeWarnings('合并音色音频', timbre.warnings))
      const timbreBlob = await combineSegmentsToBlob(timbre.segmentInputs, timbre.duration, timbre.sampleRate)
      renderPanel.updateSvsProgress(30, '上传音色音频')
      timbreAudioPath = (await uploadTempWav(`render_${jobId}_svs_timbre`, timbreBlob, timbre.sampleRate)).path
    } else {
      renderPanel.updateSvsProgress(30, mergeWarnings('校验音色音频', timbre.warnings))
    }

    let melodyAudioPath: string | undefined
    let timelineStart = 0
    let melodyDuration = 0
    if (melodyType === 'audio') {
      const melodyAudio = await resolveAudioRenderInputToSegmentInputs({
        tree: objectTree.tree,
        input: melody,
        sourceBlobs: tracks.sourceBlobs,
        segments: tracks.segmentsMap,
        tracks: tracks.tracks,
      })
      timelineStart = melodyAudio.sourceStart
      melodyDuration = melodyAudio.duration
      if (options.uploadAudio) {
        renderPanel.updateSvsProgress(45, mergeWarnings('合并旋律音频', melodyAudio.warnings))
        const melodyBlob = await combineSegmentsToBlob(melodyAudio.segmentInputs, melodyAudio.duration, melodyAudio.sampleRate)
        renderPanel.updateSvsProgress(60, '上传旋律音频')
        melodyAudioPath = (await uploadTempWav(`render_${jobId}_svs_melody`, melodyBlob, melodyAudio.sampleRate)).path
      } else {
        renderPanel.updateSvsProgress(60, mergeWarnings('校验旋律音频', melodyAudio.warnings))
        melodyAudioPath = `dry-run/${jobId}/melody.wav`
      }
    } else {
      const resolvedMidi = melody.kind === 'group'
        ? resolveGroupObjectInput(objectTree.tree, melody.id)
        : resolveTrackObjectInput(objectTree.tree, melody.id)
      timelineStart = resolvedMidi.sourceStart
      melodyDuration = resolvedMidi.duration
    }

    const { refPhrases, targetPhrases } = resolveT1Phrases(
      timbre.sourceStart,
      timbre.duration,
      timelineStart,
      melodyDuration,
    )
    const output = outputPathBeside(timbreAudioPath, outputWavFileName(renderPanel.svs.outputName || defaultSvsOutputName()))
    const selectedModel = svsConfig.selectedModel
    return {
      body: {
        refAudio: timbreAudioPath,
        melodyAudio: melodyAudioPath,
        refPhrases,
        targetPhrases,
        output,
        steps: renderPanel.svs.steps,
        cfg: renderPanel.svs.cfg,
        seed: renderPanel.svs.seed,
        device: renderPanel.svs.device,
        modelId: selectedModel?.name,
        checkpoint: selectedModel?.checkpoint,
        vaeCheckpoint: selectedModel?.vaeCheckpoint,
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

  function resolveT1Phrases(
    refAudioStart: number,
    refAudioDuration: number,
    melodyStart: number,
    melodyDuration: number,
  ): { refPhrases: TimedSvsPhrase[]; targetPhrases: TimedSvsPhrase[] } {
    if (!renderPanel.svs.refText || !renderPanel.svs.targetText) {
      throw new Error('T1 需要 A 参考文本和 B 目标文本两个带时间戳的 TextObject')
    }
    const refText = resolveTextRenderInput(objectTree.tree, renderPanel.svs.refText)
    const targetText = resolveTextRenderInput(objectTree.tree, renderPanel.svs.targetText)
    return {
      refPhrases: rebaseTimedSvsPhrases(refText, refAudioStart, refAudioDuration, 'A 参考文本'),
      targetPhrases: rebaseTimedSvsPhrases(targetText, melodyStart, melodyDuration, 'B 目标文本'),
    }
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

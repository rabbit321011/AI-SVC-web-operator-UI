import { combineSegmentsToBlob } from '@/api/wav'
import { resolveAudioRenderInputToSegmentInputs } from '@/object-workbench'
import { useObjectTreeStore } from '@/stores/objectTree'
import { useProjectStore } from '@/stores/project'
import { useRenderPanelStore } from '@/stores/renderPanel'
import { useTracksStore } from '@/stores/tracks'
import { runWhisperSofa } from './whisperSofaClient'

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

    if (!renderPanel.setWhisperRunning('解析 Whisper 输入')) return
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
      const resultSegments = await runWhisperSofa({
        blob,
        sampleRate: resolved.sampleRate,
        outputName: renderPanel.whisper.outputName || defaultWhisperOutputName(),
        vad: renderPanel.whisper.vad,
        onProgress: (progress, message) => renderPanel.updateWhisperProgress(20 + progress * 0.75, message),
      })
      renderPanel.updateWhisperProgress(96, '写入 SOFA TextObject')
      const result = objectTree.addRenderedTextToTimeline({
        outputName: renderPanel.whisper.outputName || defaultWhisperOutputName(),
        renderKind: 'whisper',
        segments: resultSegments.segments,
        timelineStart: resolved.sourceStart,
        timelineEnd: resolved.sourceEnd,
      })
      if (!result.ok) throw new Error(result.reason || 'Whisper 文本回填失败')
      project.bumpRedraw()
      renderPanel.setWhisperDone(`Whisper + SOFA 完成: ${result.outputName}`)
    } catch (error: any) {
      renderPanel.setWhisperFailed(error?.message || 'Whisper 执行失败')
    }
  }

  function defaultWhisperOutputName() {
    return `${renderPanel.whisper.audio?.displayName || 'audio'}_sofa`
  }

  return { startWhisper }
}

function mergeWarnings(message: string, warnings: string[]): string {
  return warnings.length > 0 ? `${message} (${warnings.length} 个提示)` : message
}

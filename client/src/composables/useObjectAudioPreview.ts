import { ref } from 'vue'
import { useObjectTreeStore } from '@/stores/objectTree'
import { useObjectTreeUiStore } from '@/stores/objectTreeUi'
import { useTracksStore } from '@/stores/tracks'

const playingNodeId = ref<string | null>(null)
let audioCtx: AudioContext | null = null
let currentSource: AudioBufferSourceNode | null = null

export function useObjectAudioPreview() {
  const objectTree = useObjectTreeStore()
  const objectTreeUi = useObjectTreeUiStore()
  const tracks = useTracksStore()

  async function toggleAudioObject(nodeId: string) {
    if (playingNodeId.value === nodeId) {
      stop()
      return
    }
    stop()

    const node = objectTree.node(nodeId)
    if (!node || node.kind !== 'audio') {
      objectTreeNotice('音频对象不存在')
      return
    }
    const asset = objectTree.tree.assets[node.audio.assetId]
    const blob = asset?.blobKey ? tracks.sourceBlobs.get(asset.blobKey) : undefined
    if (!blob) {
      objectTreeNotice('音频 blob 不存在')
      return
    }

    const ctx = getAudioContext()
    try {
      const buffer = await ctx.decodeAudioData(await blob.arrayBuffer())
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(ctx.destination)
      source.onended = () => {
        if (currentSource === source) {
          currentSource = null
          playingNodeId.value = null
        }
      }
      currentSource = source
      playingNodeId.value = nodeId
      source.start()
    } catch {
      playingNodeId.value = null
      objectTreeNotice('音频播放失败')
    }
  }

  function stop() {
    if (currentSource) {
      try { currentSource.stop() } catch {}
      currentSource = null
    }
    playingNodeId.value = null
  }

  function getAudioContext() {
    if (!audioCtx) audioCtx = new AudioContext()
    if (audioCtx.state === 'suspended') audioCtx.resume()
    return audioCtx
  }

  function objectTreeNotice(message: string) {
    objectTreeUi.flashNotice(message)
  }

  return {
    playingNodeId,
    toggleAudioObject,
    stop,
  }
}

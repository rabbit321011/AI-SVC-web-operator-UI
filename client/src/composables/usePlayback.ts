import { onUnmounted } from 'vue'
import { usePlaybackStore } from '@/stores/playback'
import { useTracksStore } from '@/stores/tracks'
import { useSelectionStore } from '@/stores/selection'
import type { AudioSegment } from '@/types'

export function usePlayback() {
  const pb = usePlaybackStore()
  const tracks = useTracksStore()
  const selection = useSelectionStore()

  let audioCtx: AudioContext | null = null
  let scheduledSources: AudioBufferSourceNode[] = []
  let scheduleBaseWall: number = 0
  let scheduleBaseTimeline: number = 0
  let raf: number | null = null
  let playSelectedOnly = false

  function ctx() {
    if (!audioCtx) audioCtx = new AudioContext()
    if (audioCtx.state === 'suspended') audioCtx.resume()
    return audioCtx
  }

  function killAll() {
    for (const src of scheduledSources) {
      try { src.stop() } catch {}
    }
    scheduledSources = []
  }

  function tick() {
    if (!pb.isPlaying) return
    const t = scheduleBaseTimeline + Math.max(0, ctx().currentTime - scheduleBaseWall)
    pb.setCurrentTime(t)
    if (t >= pb.totalDuration) {
      pause()
      pb.setCurrentTime(0)
      return
    }
    raf = requestAnimationFrame(tick)
  }

  async function play() {
    if (pb.isPlaying) { pause(); return }
    const ac = ctx()
    killAll()

    const list = collectSegments()
    if (list.length === 0) return

    // Use existing totalDuration (set by syncProject from ALL segments)
    const playDuration = pb.totalDuration

    // ---------- decode all unique blobs ----------
    const keyForSeg = (s: AudioSegment) => s.sourceFile || s.trackId
    const blobByKey = new Map<string, Blob>()
    const origSrByKey = new Map<string, number>()
    for (const { seg } of list) {
      const k = keyForSeg(seg)
      if (blobByKey.has(k)) continue
      const b = tracks.sourceBlobs.get(seg.sourceFile) ?? tracks.sourceBlobs.get(seg.trackId)
      if (b) {
        blobByKey.set(k, b)
        // use the ORIGINAL WAV sample rate, NOT AudioContext's resampled rate
        origSrByKey.set(k, tracks.tracks[seg.trackId]?.sampleRate ?? 44100)
      }
    }

    const bufByKey = new Map<string, AudioBuffer>()
    for (const [k, blob] of blobByKey) {
      try {
        const ab = await blob.arrayBuffer()
        bufByKey.set(k, await ac.decodeAudioData(ab))
      } catch {}
    }

    // ---------- schedule ----------
    scheduleBaseWall = ac.currentTime + 0.15
    scheduleBaseTimeline = pb.currentTime

    for (const { seg } of list) {
      const buf = bufByKey.get(keyForSeg(seg))
      if (!buf) continue

      const segDur = seg.timelineEnd - seg.timelineStart
      if (segDur < 0.002) continue

      const srcDurSamples = seg.srcEndSample - seg.srcStartSample
      if (srcDurSamples < 100) continue

      // timeline window this segment should be audible
      const tStart = Math.max(scheduleBaseTimeline, seg.timelineStart)
      const tEnd = seg.timelineEnd
      if (tStart >= tEnd) continue

      // wall time this segment fires
      const wStart = scheduleBaseWall + (tStart - scheduleBaseTimeline)

      // source buffer offset & duration — use ORIGINAL sample rate
      const origSr = origSrByKey.get(keyForSeg(seg)) ?? 44100
      const skipInSource = tStart - seg.timelineStart
      const bufOffset = seg.srcStartSample / origSr + skipInSource
      const playLen = Math.min(tEnd - tStart, srcDurSamples / origSr - skipInSource)
      if (playLen < 0.002) continue

      try {
        const src = ac.createBufferSource()
        src.buffer = buf
        const g = ac.createGain()
        g.gain.value = tracks.tracks[seg.trackId]?.volume ?? 1
        src.connect(g).connect(ac.destination)
        src.start(wStart, bufOffset, playLen)
        scheduledSources.push(src)
      } catch (e) {
        console.warn('[usePlayback] schedule failed', e)
      }
    }

    pb.setPlaying(true)
    raf = requestAnimationFrame(tick)
  }

  function pause() {
    killAll()
    pb.setPlaying(false)
    if (raf) { cancelAnimationFrame(raf); raf = null }
  }

  function stop() {
    pause()
    pb.setCurrentTime(0)
  }

  function seekTo(t: number) {
    const was = pb.isPlaying
    pause()
    pb.setCurrentTime(Math.max(0, Math.min(t, pb.totalDuration)))
    if (was) play()
  }

  function setPlaySelected(v: boolean) { playSelectedOnly = v }

  function collectSegments(): Array<{ seg: AudioSegment }> {
    const all = tracks.getAllSegments()
    const out: Array<{ seg: AudioSegment }> = []

    const hasSolo = tracks.trackOrder.some(tid => {
      const t = tracks.tracks[tid]
      return t && !t.ignored && t.solo
    })

    for (const seg of all) {
      if (seg.ignored) continue
      const t = tracks.tracks[seg.trackId]
      if (!t) continue
      if (t.ignored || t.collapsed || t.muted) continue
      if (hasSolo && !t.solo) continue
      if (!tracks.sourceBlobs.has(seg.sourceFile) && !tracks.sourceBlobs.has(seg.trackId)) continue
      if (playSelectedOnly && !selection.isSelected(seg.id)) continue
      out.push({ seg })
    }
    return out
  }

  onUnmounted(() => {
    pause()
    if (audioCtx) { audioCtx.close(); audioCtx = null }
  })

  return { play, pause, stop, seekTo, setPlaySelected }
}

import { onUnmounted } from 'vue'
import { usePlaybackStore } from '@/stores/playback'
import { useTracksStore } from '@/stores/tracks'
import { useSelectionStore } from '@/stores/selection'
import { useObjectTreeStore } from '@/stores/objectTree'
import type { AudioSegment } from '@/types'
import type { SynthesisUnitObjectNode, TrackObjectNode } from '@/object-workbench'
import { getAudioBlobMeta } from '@/utils/audioMeta'

type SynthesisMidiPlaybackItem = {
  trackId: string
  trackObject: TrackObjectNode
  unit: SynthesisUnitObjectNode
}

export function usePlayback() {
  const pb = usePlaybackStore()
  const tracks = useTracksStore()
  const selection = useSelectionStore()
  const objectTree = useObjectTreeStore()

  let audioCtx: AudioContext | null = null
  let scheduledSources: AudioBufferSourceNode[] = []
  let scheduledMidiNodes: OscillatorNode[] = []
  let scheduleBaseWall: number = 0
  let scheduleBaseTimeline: number = 0
  let raf: number | null = null
  let playSelectedOnly = false
  let isScheduling = false
  const decodedByKey = new Map<string, { blob: Blob; buffer: AudioBuffer; sampleRate: number }>()

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
    for (const node of scheduledMidiNodes) {
      try { node.stop() } catch {}
    }
    scheduledMidiNodes = []
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
    if (isScheduling) return
    isScheduling = true
    const ac = ctx()
    killAll()

    const list = collectSegments()
    const synthesisMidi = collectSynthesisMidi()
    if (list.length === 0 && synthesisMidi.length === 0) { isScheduling = false; return }
    const synthesisEnd = Math.max(0, ...synthesisMidi.map(item => item.trackObject.trackObject.timelineEnd))
    if (synthesisEnd > pb.totalDuration) pb.setTotalDuration(synthesisEnd)

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
      }
    }

    await Promise.all([...blobByKey].map(async ([k, blob]) => {
      try {
        const cached = decodedByKey.get(k)
        if (cached?.blob === blob) {
          origSrByKey.set(k, cached.sampleRate)
          return
        }
        const meta = await getAudioBlobMeta(blob)
        origSrByKey.set(k, meta.sampleRate)
        const ab = await blob.arrayBuffer()
        decodedByKey.set(k, { blob, buffer: await ac.decodeAudioData(ab), sampleRate: meta.sampleRate })
      } catch {}
    }))

    // ---------- schedule ----------
    scheduleBaseWall = ac.currentTime + 0.035
    scheduleBaseTimeline = pb.currentTime

    for (const { seg } of list) {
      const buf = decodedByKey.get(keyForSeg(seg))?.buffer
      if (!buf) continue

      const segDur = seg.timelineEnd - seg.timelineStart
      if (segDur < 0.002) continue

      const srcDurSamples = seg.srcEndSample - seg.srcStartSample
      if (srcDurSamples < 100) continue
      const origSr = origSrByKey.get(keyForSeg(seg)) ?? 44100
      const sourceDuration = srcDurSamples / origSr

      // timeline window this segment should be audible
      const tStart = Math.max(scheduleBaseTimeline, seg.timelineStart)
      const tEnd = Math.min(seg.timelineEnd, seg.timelineStart + sourceDuration)
      if (tStart >= tEnd) continue

      // wall time this segment fires
      const wStart = scheduleBaseWall + (tStart - scheduleBaseTimeline)

      // source buffer offset & duration — use ORIGINAL sample rate
      const skipInSource = tStart - seg.timelineStart
      const bufOffset = seg.srcStartSample / origSr + skipInSource
      const playLen = Math.min(tEnd - tStart, sourceDuration - skipInSource)
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

    scheduleSynthesisMidi(synthesisMidi, ac)

    pb.setPlaying(true)
    isScheduling = false
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

  function isTrackAudible(trackId: string, hasSolo: boolean): boolean {
    const track = tracks.tracks[trackId]
    if (!track) return false
    if (track.ignored || track.collapsed || track.muted) return false
    return !hasSolo || track.solo
  }

  function collectSegments(): Array<{ seg: AudioSegment }> {
    const all = tracks.getAllSegments()
    const out: Array<{ seg: AudioSegment }> = []

    const hasSolo = tracks.trackOrder.some(tid => {
      const t = tracks.tracks[tid]
      return t && !t.ignored && t.solo
    })

    for (const seg of all) {
      if (seg.ignored) continue
      if (!isTrackAudible(seg.trackId, hasSolo)) continue
      if (!tracks.sourceBlobs.has(seg.sourceFile) && !tracks.sourceBlobs.has(seg.trackId)) continue
      if (playSelectedOnly && !selection.isSelected(seg.id)) continue
      out.push({ seg })
    }
    return out
  }

  function collectSynthesisMidi(): SynthesisMidiPlaybackItem[] {
    const hasSolo = tracks.trackOrder.some(trackId => {
      const track = tracks.tracks[trackId]
      return track && !track.ignored && track.solo
    })
    const items: SynthesisMidiPlaybackItem[] = []
    for (const node of Object.values(objectTree.index.nodes)) {
      if (node.kind !== 'trackObject' || node.trackObject.contentType !== 'audio') continue
      if (node.trackObject.ignored) continue
      const trackId = node.legacy?.trackId
      if (!trackId || !isTrackAudible(trackId, hasSolo)) continue
      if (playSelectedOnly && !selection.isSelected(node.id) && !selection.isSelected(node.trackObject.sourceObjectId)) continue

      const source = objectTree.node(node.trackObject.sourceObjectId)
      if (source?.kind !== 'synthesisUnit') continue
      const midi = source.synthesisUnit.midiPTokenTrack
      if (midi.status !== 'ready' || midi.classes.length === 0) continue
      items.push({ trackId, trackObject: node, unit: source })
    }
    return items
  }

  function scheduleSynthesisMidi(items: SynthesisMidiPlaybackItem[], context: AudioContext) {
    for (const item of items) {
      const { trackObject, unit, trackId } = item
      const clipStart = trackObject.trackObject.timelineStart
      const clipEnd = trackObject.trackObject.timelineEnd
      const frameRate = unit.synthesisUnit.frameContract.frameRate
      const classes = unit.synthesisUnit.midiPTokenTrack.classes
      if (!Number.isFinite(frameRate) || frameRate <= 0 || clipEnd <= scheduleBaseTimeline) continue

      const firstFrame = Math.max(0, Math.floor((Math.max(scheduleBaseTimeline, clipStart) - clipStart) * frameRate))
      const lastFrameExclusive = Math.min(classes.length, Math.ceil((clipEnd - clipStart) * frameRate))
      for (let frame = firstFrame; frame < lastFrameExclusive;) {
        const midiClass = classes[frame]
        let runEnd = frame + 1
        while (runEnd < lastFrameExclusive && classes[runEnd] === midiClass) runEnd++

        if (midiClass >= 0 && midiClass < 255) {
          const timelineStart = Math.max(scheduleBaseTimeline, clipStart + frame / frameRate)
          const timelineEnd = Math.min(clipEnd, clipStart + runEnd / frameRate)
          if (timelineEnd > timelineStart) {
            schedulePianoTone(
              context,
              midiClass,
              scheduleBaseWall + (timelineStart - scheduleBaseTimeline),
              timelineEnd - timelineStart,
              tracks.tracks[trackId]?.volume ?? 1,
            )
          }
        }
        frame = runEnd
      }
    }
  }

  function schedulePianoTone(context: AudioContext, midiClass: number, startTime: number, duration: number, volume: number) {
    const frequency = 440 * 2 ** ((midiClass / 2 - 69) / 12)
    const endTime = startTime + Math.max(0.012, duration)
    const attackEnd = Math.min(endTime, startTime + 0.008)
    const releaseStart = Math.max(attackEnd, endTime - 0.035)
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.0001, startTime)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.16 * volume), attackEnd)
    gain.gain.setValueAtTime(Math.max(0.0001, 0.16 * volume), releaseStart)
    gain.gain.exponentialRampToValueAtTime(0.0001, endTime)
    gain.connect(context.destination)

    for (const [multiple, level] of [[1, 1], [2, 0.24]] as const) {
      const oscillator = context.createOscillator()
      const harmonicGain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(frequency * multiple, startTime)
      harmonicGain.gain.value = level
      oscillator.connect(harmonicGain).connect(gain)
      oscillator.start(startTime)
      oscillator.stop(endTime + 0.005)
      scheduledMidiNodes.push(oscillator)
    }
  }

  onUnmounted(() => {
    pause()
    if (audioCtx) { audioCtx.close(); audioCtx = null }
  })

  return { play, pause, stop, seekTo, setPlaySelected }
}

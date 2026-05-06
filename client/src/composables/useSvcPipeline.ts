import { ref } from 'vue'
import { useTracksStore } from '@/stores/tracks'
import { useCompGroupsStore } from '@/stores/compGroups'
import { useSvcConfigStore } from '@/stores/svcConfig'
import { useProjectStore } from '@/stores/project'
import { combineSegmentsToBlob } from '@/api/wav'
import type { CompGroupId, AudioSegment } from '@/types'

export function useSvcPipeline() {
  const isRunning = ref(false)
  const currentJob = ref<{ groupId: CompGroupId; jobId: string } | null>(null)
  let ws: WebSocket | null = null
  const project = useProjectStore()

  async function startSvc(groupId: CompGroupId) {
    const compGroups = useCompGroupsStore()
    const tracks = useTracksStore()
    const svcConfig = useSvcConfigStore()

    const group = compGroups.compGroups[groupId]
    if (!group) return

    const segmentRefs: Array<{
      seg: AudioSegment
      blob: Blob
    }> = []

    let minStart = Infinity
    let maxEnd = 0

    // Collect all segments referenced by the comp group
    for (const snap of group.elements) {
      if (snap.type === 'segment') {
        const seg = tracks.getSegment(snap.id)
        const blob = tracks.sourceBlobs.get(seg?.sourceFile ?? '') ?? tracks.sourceBlobs.get(seg?.trackId ?? '')
        if (seg && blob) {
          segmentRefs.push({ seg, blob })
          if (seg.timelineStart < minStart) minStart = seg.timelineStart
          if (seg.timelineEnd > maxEnd) maxEnd = seg.timelineEnd
        }
      } else if (snap.type === 'track') {
        const track = tracks.tracks[snap.id]
        const trackSegs = tracks.getTrackSegments(snap.id)
        const blob = tracks.sourceBlobs.get(track?.sourceFile ?? '') ?? tracks.sourceBlobs.get(snap.id)
        if (blob) {
          for (const s of trackSegs) {
            segmentRefs.push({ seg: s, blob })
            if (s.timelineStart < minStart) minStart = s.timelineStart
            if (s.timelineEnd > maxEnd) maxEnd = s.timelineEnd
          }
        }
      }
    }

    if (segmentRefs.length === 0) return

    const totalDuration = maxEnd - minStart
    // Use actual track sample rate, not hardcoded 44100
    const firstTrack = tracks.tracks[segmentRefs[0]?.seg.trackId]
    const sampleRate = firstTrack?.sampleRate || 44100

    // Mark status as running
    compGroups.updateSvcResult(groupId, {
      modelName: svcConfig.config.modelName,
      trackId: '',
      status: 'running',
      progress: 0,
      eta: 0,
    })

    isRunning.value = true

    try {
      // Step 1: Combine segments
      const segInputs = segmentRefs.map(({ seg, blob }) => ({
        blob,
        startSample: seg.srcStartSample,
        endSample: seg.srcEndSample,
        timelineStart: seg.timelineStart - minStart,
        sampleRate: tracks.tracks[seg.trackId]?.sampleRate || sampleRate,
      }))

      compGroups.updateSvcProgress(groupId, 5, 0)

      const combined = await combineSegmentsToBlob(segInputs, totalDuration, sampleRate)

      compGroups.updateSvcProgress(groupId, 10, 0)

      // Step 2: Upload combined WAV
      const base64 = await blobToBase64(combined)
      const combineResp = await fetch('/api/combine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, wavBase64: base64, sampleRate }),
      })
      const combineResult = await combineResp.json()

      compGroups.updateSvcProgress(groupId, 15, 0)

      // Step 3: Connect WebSocket
      const wsUrl = `ws://${window.location.hostname}:8101/ws/svc`
      ws = new WebSocket(wsUrl)
      const jobId = crypto.randomUUID().slice(0, 8)
      currentJob.value = { groupId, jobId }

      const wsReady = new Promise<void>((resolve) => {
        ws!.onopen = () => {
          ws!.send(JSON.stringify({ type: 'register', jobId }))
          resolve()
        }
      })

      await wsReady

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.type === 'progress') {
          compGroups.updateSvcProgress(groupId, 15 + msg.progress * 0.8, 0)
        } else if (msg.type === 'done') {
          compGroups.updateSvcProgress(groupId, 100, 0)
          finishSvc(groupId, msg.outputFile)
        } else if (msg.type === 'error') {
          compGroups.updateSvcResult(groupId, {
            ...compGroups.compGroups[groupId]?.svcResult!,
            status: 'failed',
          })
          isRunning.value = false
        }
      }

      // Step 4: Start SVC (pass jobId so server matches the WS)
      await fetch('/api/svc/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          combinedWav: combineResult.path,
          targetWav: svcConfig.config.targetAudio,
          checkpoint: svcConfig.config.checkpoint,
          configYml: svcConfig.config.configYml,
          diffusionSteps: svcConfig.config.diffusionSteps,
          inferenceCfgRate: svcConfig.config.inferenceCfgRate,
          f0Condition: svcConfig.config.f0Condition,
          semiToneShift: svcConfig.config.semiToneShift,
          device: svcConfig.config.device,
          fp16: svcConfig.config.fp16,
          compGroupId: groupId,
        }),
      })
    } catch (e: any) {
      compGroups.updateSvcResult(groupId, {
        ...compGroups.compGroups[groupId]?.svcResult!,
        status: 'failed',
      })
      isRunning.value = false
    }
  }

  async function finishSvc(groupId: CompGroupId, outputFile: string | null) {
    const compGroups = useCompGroupsStore()
    const tracks = useTracksStore()

    if (outputFile) {
      // Download result WAV
      const resp = await fetch(`/api/svc/result/${currentJob.value?.jobId}.wav`)
      const blob = await resp.blob()

      const group = compGroups.compGroups[groupId]
      const name = group?.name ?? '合成结果'
      // Align result track to the comp group's original timeline position
      const minStart = Math.min(...(group?.elements?.map(e => e.startTime) ?? [0]))
      const maxEnd = Math.max(...(group?.elements?.map(e => e.endTime) ?? [0]))
      const timelineStart = minStart < Infinity ? minStart : 0

      const trackId = tracks.makeTrackId()
      const track: import('@/types').Track = {
        id: trackId,
        name: `${name} (SVC)`,
        color: '#e94560',
        segments: [],
        sourceFile: outputFile,
        sampleRate: 44100,
        totalSamples: 0,
        f0Cache: null,
      f0Pending: 0,
      f0Total: 0,
        collapsed: false, muted: false, solo: false, volume: 1, ignored: false,
        boundCompGroupId: groupId,
      }
      tracks.tracks[trackId] = track
      tracks.trackOrder.push(trackId)
      tracks.sourceBlobs.set(outputFile, blob)

      // Create segment aligned to the original position
      const segId = tracks.makeSegmentId()
      const seg: import('@/types').AudioSegment = {
        id: segId,
        trackId,
        sourceFile: outputFile,
        srcStartSample: 0,
        srcEndSample: 44100 * 10, // placeholder, will be updated
        timelineStart,
        timelineEnd: maxEnd, // placeholder, will be updated
        f0Data: null,
        f0Extracted: false,
        color: '#e94560',
        ignored: false,
      }
      tracks.segmentsMap[segId] = seg
      track.segments.push(segId)
      track.totalSamples = 44100 * 10

      // Decode duration — keep timelineStart, update timelineEnd
      try {
        const audioCtx = new AudioContext()
        const buf = await blob.arrayBuffer()
        const audioBuf = await audioCtx.decodeAudioData(buf)
        seg.timelineEnd = timelineStart + audioBuf.duration
        seg.srcEndSample = Math.round(audioBuf.duration * (track.sampleRate || 44100))
        track.totalSamples = seg.srcEndSample
        project.bumpRedraw()
        audioCtx.close()
      } catch {}

      // Reconcile F0 for the result track (background, progress bar)
      tracks.reconcileF0ForTrack(trackId)

      compGroups.updateSvcResult(groupId, {
        modelName: compGroups.compGroups[groupId]?.svcResult?.modelName ?? '',
        trackId,
        status: 'done',
        progress: 100,
        eta: 0,
      })
    } else {
      compGroups.updateSvcResult(groupId, {
        ...compGroups.compGroups[groupId]?.svcResult!,
        status: 'failed',
      })
    }

    isRunning.value = false
    if (ws) { ws.close(); ws = null }
    project.bumpRedraw()
  }

  return { isRunning, startSvc }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      resolve(result.split(',')[1])
    }
    reader.readAsDataURL(blob)
  })
}


import type { AudioSegment, Track } from '@/types'
import type { AudioAsset, AudioObjectNode, ProjectObjectTree, RuntimeTreeIndex } from './types'
import type { RenderInputRef } from './renderInputs'
import { buildNodeIndex } from './objectTree'
import { resolveGroupObjectInput, resolveTrackObjectInput } from './groupResolver'

export interface AudioRenderSegmentInput {
  blob: Blob
  startSample: number
  endSample: number
  timelineStart: number
  sampleRate: number
  volume?: number
}

export interface ResolvedAudioRenderInput {
  segmentInputs: AudioRenderSegmentInput[]
  sourceStart: number
  sourceEnd: number
  duration: number
  sampleRate: number
  warnings: string[]
}

export interface ResolveAudioRenderInputOptions {
  tree: ProjectObjectTree
  input: RenderInputRef
  sourceBlobs: Map<string, Blob>
  segments?: Record<string, AudioSegment>
  tracks?: Record<string, Track>
  defaultSampleRate?: number
  decodeAudioMeta?: (blob: Blob) => Promise<{ sampleRate: number; totalSamples: number; duration: number; channels: number }>
}

export async function resolveAudioRenderInputToSegmentInputs(options: ResolveAudioRenderInputOptions): Promise<ResolvedAudioRenderInput> {
  const defaultSampleRate = options.defaultSampleRate ?? 44100
  if (options.input.kind === 'audioObject') {
    return resolveAudioObjectInput(options)
  }

  const resolved = options.input.kind === 'group'
    ? resolveGroupObjectInput(options.tree, options.input.id)
    : resolveTrackObjectInput(options.tree, options.input.id)

  if (resolved.mediaType !== 'audio') {
    throw new Error('Render input is not audio')
  }

  const index = buildNodeIndex(options.tree.root)
  const prepared = resolved.items.map(item => {
    const source = requireAudioSource(index, item.sourceObjectId)
    const asset = options.tree.assets[source.audio.assetId]
    if (!asset) {
      throw new Error(`Audio asset does not exist: ${source.audio.assetId}`)
    }

    const trackObject = index.nodes[item.trackObjectId]
    const segmentId = trackObject?.kind === 'trackObject'
      ? trackObject.legacy?.segmentId ?? source.legacy?.segmentId
      : source.legacy?.segmentId
    const legacySegment = segmentId ? options.segments?.[segmentId] : undefined
    if (segmentId && !legacySegment) {
      throw new Error(`Legacy timeline segment does not exist: ${segmentId}`)
    }
    const legacyTrack = legacySegment ? options.tracks?.[legacySegment.trackId] : undefined
    if (legacySegment && !legacyTrack) {
      throw new Error(`Legacy timeline track does not exist: ${legacySegment.trackId}`)
    }

    const blob = findBlob(options.sourceBlobs, [
      asset.blobKey,
      legacySegment?.sourceFile,
      legacyTrack?.sourceFile,
      legacySegment?.trackId,
      asset.filePath,
    ])
    if (!blob) {
      throw new Error(`Audio blob does not exist: ${source.name}`)
    }

    const timelineStart = legacySegment?.timelineStart ?? item.timelineStart
    const timelineEnd = legacySegment?.timelineEnd ?? item.timelineEnd
    const sampleRate = legacyTrack?.sampleRate || asset.sampleRate || defaultSampleRate
    const duration = Math.max(0, timelineEnd - timelineStart)
    const startSample = legacySegment?.srcStartSample ?? 0
    const endSample = legacySegment?.srcEndSample ?? inferEndSample(asset.duration || duration, sampleRate)

    if (endSample <= startSample) {
      throw new Error(`Audio segment has invalid sample range: ${source.name}`)
    }

    return {
      trackObjectId: item.trackObjectId,
      ignored: legacySegment?.ignored ?? false,
      blob,
      startSample,
      endSample,
      timelineStart,
      timelineEnd,
      sampleRate,
      volume: legacyTrack?.volume,
    }
  })

  const warnings = [...resolved.warnings]
  const active = prepared
    .filter(item => {
      if (!item.ignored) return true
      warnings.push(`Ignored TrackObject skipped: ${item.trackObjectId}`)
      return false
    })
    .sort((a, b) => {
      const byStart = a.timelineStart - b.timelineStart
      return byStart !== 0 ? byStart : a.trackObjectId.localeCompare(b.trackObjectId)
    })

  if (active.length === 0) {
    throw new Error('No audio segments to render')
  }

  const sourceStart = Math.min(...active.map(item => item.timelineStart))
  const sourceEnd = Math.max(...active.map(item => item.timelineEnd))
  const duration = sourceEnd - sourceStart
  const segmentInputs = active.map(item => ({
    blob: item.blob,
    startSample: item.startSample,
    endSample: item.endSample,
    timelineStart: item.timelineStart - sourceStart,
    sampleRate: item.sampleRate,
    volume: item.volume,
  }))

  if (segmentInputs.length === 0) {
    throw new Error('No audio segments to render')
  }

  return {
    segmentInputs,
    sourceStart,
    sourceEnd,
    duration,
    sampleRate: segmentInputs[0].sampleRate || defaultSampleRate,
    warnings,
  }
}

async function resolveAudioObjectInput(options: ResolveAudioRenderInputOptions): Promise<ResolvedAudioRenderInput> {
  const defaultSampleRate = options.defaultSampleRate ?? 44100
  const index = buildNodeIndex(options.tree.root)
  const node = index.nodes[options.input.id]
  if (!node || node.kind !== 'audio') {
    throw new Error(`Expected AudioObject input: ${options.input.id}`)
  }
  const asset = options.tree.assets[node.audio.assetId]
  if (!asset) throw new Error(`Audio asset does not exist: ${node.audio.assetId}`)
  const blob = findBlob(options.sourceBlobs, [asset.blobKey, asset.filePath])
  if (!blob) throw new Error(`Audio blob does not exist: ${node.name}`)

  const meta = asset.sampleRate > 0 && asset.duration > 0
    ? metaFromAsset(asset)
    : await decodeMeta(blob, options.decodeAudioMeta, defaultSampleRate)
  const sampleRate = meta.sampleRate || defaultSampleRate
  const totalSamples = meta.totalSamples || inferEndSample(meta.duration, sampleRate)
  const duration = meta.duration || totalSamples / sampleRate

  return {
    segmentInputs: [{
      blob,
      startSample: 0,
      endSample: totalSamples,
      timelineStart: 0,
      sampleRate,
      volume: 1,
    }],
    sourceStart: 0,
    sourceEnd: duration,
    duration,
    sampleRate,
    warnings: [],
  }
}

function requireAudioSource(index: RuntimeTreeIndex, id: string): AudioObjectNode {
  const node = index.nodes[id]
  if (!node || node.kind !== 'audio') {
    throw new Error(`Expected AudioObject source: ${id}`)
  }
  return node
}

function findBlob(sourceBlobs: Map<string, Blob>, candidates: Array<string | undefined>): Blob | undefined {
  for (const key of candidates) {
    if (!key) continue
    const blob = sourceBlobs.get(key)
    if (blob) return blob
  }
  return undefined
}

function inferEndSample(duration: number, sampleRate: number): number {
  return Math.max(1, Math.round(Math.max(0.001, duration) * sampleRate))
}

function metaFromAsset(asset: AudioAsset): { sampleRate: number; totalSamples: number; duration: number; channels: number } {
  const sampleRate = asset.sampleRate || 44100
  const duration = asset.duration || 0.001
  return {
    sampleRate,
    totalSamples: inferEndSample(duration, sampleRate),
    duration,
    channels: asset.channels || 1,
  }
}

async function decodeMeta(
  blob: Blob,
  customDecode: ResolveAudioRenderInputOptions['decodeAudioMeta'],
  defaultSampleRate: number,
): Promise<{ sampleRate: number; totalSamples: number; duration: number; channels: number }> {
  if (customDecode) return customDecode(blob)
  const root = globalThis as typeof globalThis & { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
  const AudioContextCtor = root.AudioContext || root.webkitAudioContext
  if (!AudioContextCtor) {
    const totalSamples = Math.max(1, Math.round(blob.size / 2))
    return {
      sampleRate: defaultSampleRate,
      totalSamples,
      duration: totalSamples / defaultSampleRate,
      channels: 1,
    }
  }
  const audioCtx = new AudioContextCtor()
  try {
    const audioBuf = await audioCtx.decodeAudioData(await blob.arrayBuffer())
    return {
      sampleRate: audioBuf.sampleRate,
      totalSamples: Math.round(audioBuf.duration * audioBuf.sampleRate),
      duration: audioBuf.duration,
      channels: audioBuf.numberOfChannels,
    }
  } finally {
    audioCtx.close()
  }
}

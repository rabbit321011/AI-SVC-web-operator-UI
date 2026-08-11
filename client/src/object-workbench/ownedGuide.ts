import type { AudioSegment, Track } from '@/types'
import type { AudioAsset, AudioObjectNode, NodeId, ProjectObjectTree, TrackObjectNode } from './types'
import { buildNodeIndex } from './objectTree'
import { makeRenderInputRef } from './renderInputs'
import {
  resolveAudioRenderInputToSegmentInputs,
  type ResolvedAudioRenderInput,
} from './renderAudioResolver'

export interface ResolveOwnedGuideSourceOptions {
  tree: ProjectObjectTree
  sourceAudioObjectId: NodeId
  sourceBlobs: Map<string, Blob>
  segments?: Record<string, AudioSegment>
  tracks?: Record<string, Track>
  decodeAudioMeta?: (blob: Blob) => Promise<{ sampleRate: number; totalSamples: number; duration: number; channels: number }>
}

export interface ResolvedOwnedGuideSource {
  source: AudioObjectNode
  asset: AudioAsset
  resolved: ResolvedAudioRenderInput
  effectiveStartSample: number
  effectiveEndSampleExclusive: number
  defaultTimelineStart: number | null
  resolverManifest: string
}

export async function resolveOwnedGuideSource(options: ResolveOwnedGuideSourceOptions): Promise<ResolvedOwnedGuideSource> {
  const index = buildNodeIndex(options.tree.root)
  const source = index.nodes[options.sourceAudioObjectId]
  if (!source || source.kind !== 'audio') {
    throw new Error(`Expected AudioObject source: ${options.sourceAudioObjectId}`)
  }
  const asset = options.tree.assets[source.audio.assetId]
  if (!asset) throw new Error(`Audio asset does not exist: ${source.audio.assetId}`)

  const trackObject = findEffectiveTrackObject(index.nodes, source)
  const input = trackObject
    ? makeRenderInputRef(options.tree, 'trackObject', trackObject.id)
    : makeRenderInputRef(options.tree, 'audioObject', source.id)
  const resolved = await resolveAudioRenderInputToSegmentInputs({
    tree: options.tree,
    input,
    sourceBlobs: options.sourceBlobs,
    segments: options.segments,
    tracks: options.tracks,
    decodeAudioMeta: options.decodeAudioMeta,
  })
  if (resolved.segmentInputs.length !== 1) {
    throw new Error('AudioObject must resolve to exactly one effective audio range')
  }
  const segment = resolved.segmentInputs[0]
  const manifest = {
    schema: 'aisvc.owned-guide-resolver.v1',
    inputKind: input.kind,
    inputId: input.id,
    sourceAudioObjectId: source.id,
    sourceAssetId: asset.id,
    effectiveStartSample: segment.startSample,
    effectiveEndSampleExclusive: segment.endSample,
    sourceSampleRate: segment.sampleRate,
    sourceTimelineStart: trackObject ? resolved.sourceStart : null,
    resolvedDuration: resolved.duration,
    outputSampleRate: 44100,
  }

  return {
    source,
    asset,
    resolved,
    effectiveStartSample: segment.startSample,
    effectiveEndSampleExclusive: segment.endSample,
    defaultTimelineStart: trackObject ? resolved.sourceStart : null,
    resolverManifest: JSON.stringify(manifest),
  }
}

function findEffectiveTrackObject(
  nodes: Record<NodeId, import('./types').TreeNode>,
  source: AudioObjectNode,
): TrackObjectNode | null {
  const matches = Object.values(nodes).filter((node): node is TrackObjectNode => (
    node.kind === 'trackObject'
    && node.trackObject.contentType === 'audio'
    && node.trackObject.sourceObjectId === source.id
  ))
  if (matches.length === 0) return null
  if (matches.length === 1) return matches[0]

  if (source.legacy?.segmentId) {
    const exact = matches.find(node => node.legacy?.segmentId === source.legacy?.segmentId)
    if (exact) return exact
  }
  throw new Error('AudioObject is referenced by multiple effective timeline ranges')
}

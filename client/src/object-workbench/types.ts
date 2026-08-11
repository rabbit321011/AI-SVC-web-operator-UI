import type { CompGroupId, SegmentId, TrackId } from '@/types'

export type NodeId = string

export type MediaObjectKind = 'audio' | 'midi' | 'text'
export type TrackObjectContentType = MediaObjectKind
export type TreeNodeKind = 'folder' | MediaObjectKind | 'synthesisUnit' | 'trackObject' | 'trackFolder' | 'group'

export interface BaseTreeNode {
  id: NodeId
  kind: TreeNodeKind
  name: string
}

export interface FolderNode extends BaseTreeNode {
  kind: 'folder'
  children: TreeNode[]
}

export interface AudioAsset {
  id: string
  storage: 'projectBlob' | 'resourceBlob' | 'generatedFile'
  blobKey?: string
  filePath?: string
  sampleRate: number
  duration: number
  channels: number
  sampleCount?: number
  sha256?: string
  legacy?: {
    sourceFile: string
    trackId: TrackId
    segmentId: SegmentId
  }
}

export interface AudioObjectNode extends BaseTreeNode {
  kind: 'audio'
  audio: {
    assetId: string
    midiObjectId: NodeId | null
    textObjectId: NodeId | null
    tags?: string[]
  }
  legacy?: {
    segmentId: SegmentId
    trackId: TrackId
  }
}

export interface MidiObjectNode extends BaseTreeNode {
  kind: 'midi'
  midi: {
    sourceAudioObjectId: NodeId | null
    versions: MidiVersion[]
    activeVersionId: string
  }
}

export interface MidiVersion {
  id: string
  name: string
  createdAt: string
  dataPath?: string
  midiData?: unknown
}

export interface TextObjectNode extends BaseTreeNode {
  kind: 'text'
  text: {
    sourceAudioObjectId: NodeId | null
    segments: TextSegment[]
  }
}

export interface TextSegment {
  id?: string
  start: number
  end?: number
  kana: string
  romaji: string
}

export type SynthesisTrackKind = 'segment' | 'kana' | 'h' | 'midi-p'
export type SynthesisTrackOrigin = 'empty' | 'whisper-sofa' | 'game' | 'alignment' | 'imported' | 'user'

export interface SynthesisSourceRevisionRef {
  unitId: NodeId
  track?: SynthesisTrackKind
  revision?: number
  guideSHA256?: string
}

export interface SynthesisTrackRevision {
  id: string
  revision: number
  track: SynthesisTrackKind
  operation: string
  sourceRefs: SynthesisSourceRevisionRef[]
  affectedStartFrame: number
  affectedEndFrameExclusive: number
  createdAt: string
}

export interface SynthesisSegmentObject {
  id: string
  text: string
  kana: string
  romaji: string
  startFrame: number
  speechEndFrameExclusive: number
  sourceOnsetSeconds?: number
  sourceEndSeconds?: number
  origin: 'whisper-sofa' | 'imported' | 'user'
  generatedFrom?: SynthesisSourceRevisionRef
}

export interface SynthesisKanaUnit {
  id: string
  kana: string
  romaji: string
  startFrame: number
  endFrameExclusive: number
  origin: 'segment-align' | 'imported' | 'user'
  generatedFrom?: SynthesisSourceRevisionRef
}

export interface SynthesisKanaSegmentBoundary {
  id: string
  frame: number
  kind: 'SEG'
  origin: 'segment-align' | 'imported' | 'user'
}

export interface SynthesisHTokenEvent {
  id: string
  frame: number
  tokenId: number
  symbol?: string
  origin: 'segment-align' | 'kana-align' | 'imported' | 'user'
  generatedFrom?: SynthesisSourceRevisionRef
}

export interface SynthesisHPlacementRange {
  phraseId: string
  startFrame: number
  endFrameExclusive: number
  placementMode: 'phone' | 'pul' | 'sentence' | 'unknown'
  fallbackReason: string | null
}

export interface SynthesisSegmentTrack {
  status: 'empty' | 'ready'
  revision: number
  origin: SynthesisTrackOrigin
  items: SynthesisSegmentObject[]
  revisions: SynthesisTrackRevision[]
}

export interface SynthesisKanaTrack {
  status: 'empty' | 'ready'
  revision: number
  origin: SynthesisTrackOrigin
  units: SynthesisKanaUnit[]
  boundaries: SynthesisKanaSegmentBoundary[]
  revisions: SynthesisTrackRevision[]
}

export interface SynthesisHTokenTrack {
  status: 'empty' | 'ready'
  revision: number
  origin: SynthesisTrackOrigin
  events: SynthesisHTokenEvent[]
  revisions: SynthesisTrackRevision[]
  vocabHash?: string
  compilerHash?: string
  placementRanges?: SynthesisHPlacementRange[]
}

export interface SynthesisMidiPTokenTrack {
  status: 'empty' | 'ready'
  revision: number
  origin: SynthesisTrackOrigin
  classes: number[]
  manualFrames: number[]
  revisions: SynthesisTrackRevision[]
  gameModelHash?: string
  compilerHash?: string
}

export interface OwnedGuideAudio {
  assetId: string
  audioSHA256: string
  sampleRate: number
  channels: number
  sampleCount: number
  duration: number
  source: {
    sourceAudioObjectId: NodeId
    sourceAssetId: string
    sourceAssetSHA256?: string
    effectiveStartSample: number
    effectiveEndSampleExclusive: number
    sourceTimelineStart: number | null
    resolverManifest: string
  }
}

export interface SynthesisFrameContract {
  schema: 'aisvc.v5p-frame.v1'
  sampleRate: 44100
  hopSamples: 2048
  frameRate: number
  frameCount: number
  modelSampleCount: number
  trailingSampleCount: number
  compilerVersion: 'stable-audio2-oobleck-floor.v1'
}

export interface SynthesisReferenceBinding {
  unitId: NodeId
  audioSource: 'guide'
  range: 'full-guide'
  revisionPolicy: 'follow-latest'
  boundAt: string
}

export interface SynthesisTake {
  id: string
  name: string
  status: 'queued' | 'running' | 'ready' | 'failed' | 'cancelled'
  outputAssetId?: string
  outputSHA256?: string
  snapshotSHA256?: string
  sampleRate?: 44100
  sampleCount?: number
  duration?: number
  targetUnitRevision: number
  referenceUnitId: NodeId
  referenceUnitRevision: number
  presetId: string
  checkpointSHA256: string
  vaeSHA256: string
  adapterSHA256: string
  seed: number
  createdAt: string
  completedAt?: string
  error?: string
}

export interface SynthesisUnitObjectNode extends BaseTreeNode {
  kind: 'synthesisUnit'
  synthesisUnit: {
    schema: 'aisvc.synthesis-unit.v1'
    guide: OwnedGuideAudio
    frameContract: SynthesisFrameContract
    segmentTrack: SynthesisSegmentTrack
    kanaTrack: SynthesisKanaTrack
    hTokenTrack: SynthesisHTokenTrack
    midiPTokenTrack: SynthesisMidiPTokenTrack
    reference: SynthesisReferenceBinding | null
    unitRevision: number
    takes: SynthesisTake[]
    activeTakeId: string | null
    defaultTimelineStart: number | null
    createdAt: string
    updatedAt: string
  }
}

export interface TrackObjectNode extends BaseTreeNode {
  kind: 'trackObject'
  trackObject: {
    contentType: TrackObjectContentType
    sourceObjectId: NodeId
    timelineStart: number
    timelineEnd: number
    ignored: boolean
  }
  legacy?: {
    segmentId: SegmentId
    trackId: TrackId
  }
}

export interface TrackFolderNode extends BaseTreeNode {
  kind: 'trackFolder'
  trackFolder: {
    trackType: TrackObjectContentType
    muted?: boolean
    solo?: boolean
    volume?: number
    color?: string
  }
  children: TrackObjectNode[]
  legacy?: {
    trackId: TrackId
  }
}

export interface GroupObjectNode extends BaseTreeNode {
  kind: 'group'
  group: {
    mediaType: TrackObjectContentType
    trackObjectIds: NodeId[]
  }
  legacy?: {
    compGroupId: CompGroupId
  }
}

export type TreeNode =
  | FolderNode
  | AudioObjectNode
  | MidiObjectNode
  | TextObjectNode
  | SynthesisUnitObjectNode
  | TrackObjectNode
  | TrackFolderNode
  | GroupObjectNode

export interface ProjectObjectTree {
  schemaVersion: 'object-workbench.v1'
  root: FolderNode
  assets: Record<string, AudioAsset>
}

export interface RuntimeTreeIndex {
  nodes: Record<NodeId, TreeNode>
  parentById: Record<NodeId, NodeId | null>
  pathById: Record<NodeId, string>
}

export interface ObjectWorkbenchTopLevelIds {
  root: NodeId
  workspace: NodeId
  resource: NodeId
  trackSources: NodeId
  tracks: NodeId
  groups: NodeId
  renders: NodeId
}

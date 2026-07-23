import type { CompGroupId, SegmentId, TrackId } from '@/types'

export type NodeId = string

export type MediaObjectKind = 'audio' | 'midi' | 'text'
export type TrackObjectContentType = MediaObjectKind
export type TreeNodeKind = 'folder' | MediaObjectKind | 'trackObject' | 'trackFolder' | 'group'

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

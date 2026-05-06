export type TrackId = string
export type SegmentId = string
export type CompGroupId = string
export type ProjectId = string

export interface F0Frame {
  t: number
  freq: number
  prob: number
}

export interface AudioSegment {
  id: SegmentId
  trackId: TrackId

  sourceFile: string
  srcStartSample: number
  srcEndSample: number

  timelineStart: number
  timelineEnd: number

  f0Data: F0Frame[] | null
  f0Extracted: boolean

  color: string
  ignored: boolean
}

export interface Track {
  id: TrackId
  name: string
  color: string

  segments: SegmentId[]

  sourceFile: string
  sampleRate: number
  totalSamples: number

  f0Cache: F0Frame[] | null
  f0Pending: number
  f0Total: number

  collapsed: boolean
  muted: boolean
  solo: boolean
  volume: number
  ignored: boolean

  boundCompGroupId: CompGroupId | null
}

export interface GroupElementSnapshot {
  type: 'segment' | 'track'
  id: SegmentId | TrackId
  startTime: number
  endTime: number
}

export interface CompGroup {
  id: CompGroupId
  name: string

  elements: GroupElementSnapshot[]

  combinedAudio: {
    filePath: string
    startTime: number
    endTime: number
    duration: number
  } | null

  svcResult: {
    modelName: string
    trackId: TrackId
    status: 'pending' | 'running' | 'done' | 'failed'
    progress: number
    eta: number
  } | null

  collapsed: boolean
  expanded: boolean
}

export interface SvcRuntimeConfig {
  modelName: string
  checkpoint: string
  configYml: string
  targetAudio: string
  diffusionSteps: number
  inferenceCfgRate: number
  f0Condition: boolean
  semiToneShift: number | null
  device: string
  fp16: boolean
}

export interface Project {
  id: ProjectId
  name: string
  version: string

  tracks: Record<TrackId, Track>
  trackOrder: TrackId[]

  segments: Record<SegmentId, AudioSegment>

  compGroups: Record<CompGroupId, CompGroup>
  compGroupOrder: CompGroupId[]

  timelineOffset: number
  pxPerSec: number

  f0Settings: {
    fmin: number
    fmax: number
    algorithm: 'pyin'
    hopMs: number
  }

  createdAt: string
  modifiedAt: string
}

export type PatchOp = 'add' | 'remove' | 'replace'

export interface Patch {
  op: PatchOp
  path: string
  value?: unknown
  oldValue?: unknown
}

export interface Command {
  description: string
  patches: Patch[]
  inversePatches: Patch[]
}

export type SelectionType = 'none' | 'tracks' | 'segments' | 'compGroups' | 'mixed'

export interface DeepCopySegment {
  sourceFile: string
  srcStartSample: number
  srcEndSample: number
  timelineStart: number
  timelineEnd: number
  color: string
  f0Data: F0Frame[] | null
  originalTrackId: TrackId
}

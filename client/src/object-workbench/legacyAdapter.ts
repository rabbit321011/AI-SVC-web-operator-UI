import type { AudioSegment, CompGroup, GroupElementSnapshot, Project, Track } from '@/types'
import type {
  AudioAsset,
  AudioObjectNode,
  FolderNode,
  GroupObjectNode,
  NodeId,
  ProjectObjectTree,
  TrackFolderNode,
  TrackObjectNode,
} from './types'
import { createEmptyProjectObjectTree, TOP_LEVEL_IDS } from './objectTree'

export interface LegacyObjectTreeMaps {
  trackFolderIdByTrackId: Record<string, NodeId>
  trackObjectIdBySegmentId: Record<string, NodeId>
  sourceObjectIdBySegmentId: Record<string, NodeId>
  groupObjectIdByCompGroupId: Record<string, NodeId>
}

export interface LegacyObjectTreeResult {
  tree: ProjectObjectTree
  maps: LegacyObjectTreeMaps
  warnings: string[]
}

export function legacyProjectToObjectTree(project: Project): LegacyObjectTreeResult {
  const tree = createEmptyProjectObjectTree()
  const maps: LegacyObjectTreeMaps = {
    trackFolderIdByTrackId: {},
    trackObjectIdBySegmentId: {},
    sourceObjectIdBySegmentId: {},
    groupObjectIdByCompGroupId: {},
  }
  const warnings: string[] = []

  const trackSources = requireTopFolder(tree, TOP_LEVEL_IDS.trackSources)
  const tracksRoot = requireTopFolder(tree, TOP_LEVEL_IDS.tracks)
  const groupsRoot = requireTopFolder(tree, TOP_LEVEL_IDS.groups)

  const audioSources = folder(`${TOP_LEVEL_IDS.trackSources}/audio`, 'audio')
  trackSources.children.push(audioSources)

  for (const trackId of project.trackOrder) {
    const track = project.tracks[trackId]
    if (!track) {
      warnings.push(`Missing track referenced by trackOrder: ${trackId}`)
      continue
    }
    appendLegacyTrack(track, project, tree, tracksRoot, audioSources, maps, warnings)
  }

  for (const [trackId, track] of Object.entries(project.tracks)) {
    if (project.trackOrder.includes(trackId)) continue
    warnings.push(`Track missing from trackOrder was appended: ${trackId}`)
    appendLegacyTrack(track, project, tree, tracksRoot, audioSources, maps, warnings)
  }

  for (const groupId of project.compGroupOrder) {
    const group = project.compGroups[groupId]
    if (!group) {
      warnings.push(`Missing comp group referenced by compGroupOrder: ${groupId}`)
      continue
    }
    appendLegacyGroup(group, project, groupsRoot, maps, warnings)
  }

  for (const [groupId, group] of Object.entries(project.compGroups)) {
    if (project.compGroupOrder.includes(groupId)) continue
    warnings.push(`Comp group missing from compGroupOrder was appended: ${groupId}`)
    appendLegacyGroup(group, project, groupsRoot, maps, warnings)
  }

  return { tree, maps, warnings }
}

function appendLegacyTrack(
  track: Track,
  project: Project,
  tree: ProjectObjectTree,
  tracksRoot: FolderNode,
  audioSources: FolderNode,
  maps: LegacyObjectTreeMaps,
  warnings: string[],
) {
  const trackFolderId = legacyTrackFolderId(track.id)
  maps.trackFolderIdByTrackId[track.id] = trackFolderId

  const trackFolder: TrackFolderNode = {
    id: trackFolderId,
    kind: 'trackFolder',
    name: track.name,
    trackFolder: {
      trackType: 'audio',
      muted: track.muted,
      solo: track.solo,
      volume: track.volume,
      color: track.color,
    },
    children: [],
    legacy: { trackId: track.id },
  }

  for (const segmentId of track.segments) {
    const segment = project.segments[segmentId]
    if (!segment) {
      warnings.push(`Missing segment referenced by track ${track.id}: ${segmentId}`)
      continue
    }
    appendLegacySegment(segment, track, tree, trackFolder, audioSources, maps)
  }

  tracksRoot.children.push(trackFolder)
}

function appendLegacySegment(
  segment: AudioSegment,
  track: Track,
  tree: ProjectObjectTree,
  trackFolder: TrackFolderNode,
  audioSources: FolderNode,
  maps: LegacyObjectTreeMaps,
) {
  const sourceObjectId = legacySourceObjectId(segment.id)
  const trackObjectId = legacyTrackObjectId(segment.id)
  const assetId = legacyAssetId(segment.id)
  const duration = Math.max(0, segment.timelineEnd - segment.timelineStart)

  const asset: AudioAsset = {
    id: assetId,
    storage: isLikelyFilePath(segment.sourceFile) ? 'generatedFile' : 'projectBlob',
    blobKey: segment.sourceFile,
    filePath: isLikelyFilePath(segment.sourceFile) ? segment.sourceFile : undefined,
    sampleRate: track.sampleRate,
    duration,
    channels: 1,
    legacy: {
      sourceFile: segment.sourceFile,
      trackId: track.id,
      segmentId: segment.id,
    },
  }
  tree.assets[assetId] = asset

  const sourceObject: AudioObjectNode = {
    id: sourceObjectId,
    kind: 'audio',
    name: segment.sourceFile || `${segment.id}.wav`,
    audio: {
      assetId,
      midiObjectId: null,
      textObjectId: null,
    },
    legacy: {
      segmentId: segment.id,
      trackId: track.id,
    },
  }

  const trackObject: TrackObjectNode = {
    id: trackObjectId,
    kind: 'trackObject',
    name: segmentName(segment),
    trackObject: {
      contentType: 'audio',
      sourceObjectId,
      timelineStart: segment.timelineStart,
      timelineEnd: segment.timelineEnd,
      ignored: segment.ignored,
    },
    legacy: {
      segmentId: segment.id,
      trackId: track.id,
    },
  }

  maps.sourceObjectIdBySegmentId[segment.id] = sourceObjectId
  maps.trackObjectIdBySegmentId[segment.id] = trackObjectId
  audioSources.children.push(sourceObject)
  trackFolder.children.push(trackObject)
}

function appendLegacyGroup(
  group: CompGroup,
  project: Project,
  groupsRoot: FolderNode,
  maps: LegacyObjectTreeMaps,
  warnings: string[],
) {
  const trackObjectIds = group.elements.flatMap(element => resolveGroupElement(element, project, maps, warnings))
  const groupId = legacyGroupObjectId(group.id)
  maps.groupObjectIdByCompGroupId[group.id] = groupId

  const groupNode: GroupObjectNode = {
    id: groupId,
    kind: 'group',
    name: group.name,
    group: {
      mediaType: 'audio',
      trackObjectIds: unique(trackObjectIds),
    },
    legacy: {
      compGroupId: group.id,
    },
  }
  groupsRoot.children.push(groupNode)
}

function resolveGroupElement(
  element: GroupElementSnapshot,
  project: Project,
  maps: LegacyObjectTreeMaps,
  warnings: string[],
): NodeId[] {
  if (element.type === 'segment') {
    const trackObjectId = maps.trackObjectIdBySegmentId[element.id]
    if (!trackObjectId) warnings.push(`Comp group references missing segment: ${element.id}`)
    return trackObjectId ? [trackObjectId] : []
  }

  const track = project.tracks[element.id]
  if (!track) {
    warnings.push(`Comp group references missing track: ${element.id}`)
    return []
  }

  return track.segments
    .map(segmentId => maps.trackObjectIdBySegmentId[segmentId])
    .filter((id): id is NodeId => Boolean(id))
}

function requireTopFolder(tree: ProjectObjectTree, id: NodeId): FolderNode {
  const node = tree.root.children.find(child => child.id === id)
  if (!node || node.kind !== 'folder') {
    throw new Error(`Missing object workbench top-level folder: ${id}`)
  }
  return node
}

function folder(id: NodeId, name: string): FolderNode {
  return { id, kind: 'folder', name, children: [] }
}

function segmentName(segment: AudioSegment): string {
  return `${segment.sourceFile || segment.id} [${segment.timelineStart.toFixed(2)}-${segment.timelineEnd.toFixed(2)}]`
}

function isLikelyFilePath(value: string): boolean {
  return value.includes(':') || value.includes('\\') || value.includes('/')
}

function legacyAssetId(segmentId: string): string {
  return `asset:legacy:${segmentId}`
}

function legacySourceObjectId(segmentId: string): NodeId {
  return `node:source:audio:${segmentId}`
}

function legacyTrackObjectId(segmentId: string): NodeId {
  return `node:trackObject:${segmentId}`
}

function legacyTrackFolderId(trackId: string): NodeId {
  return `node:trackFolder:${trackId}`
}

function legacyGroupObjectId(groupId: string): NodeId {
  return `node:group:${groupId}`
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

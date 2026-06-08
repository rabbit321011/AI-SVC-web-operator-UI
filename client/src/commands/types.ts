import type { Patch, Command, TrackId, SegmentId } from '@/types'

export function makeCommand(description: string, patches: Patch[], inversePatches: Patch[]): Command {
  return { description, patches, inversePatches }
}

export function trackPath(trackId: TrackId, field: string): string {
  return field ? `tracks.${trackId}.${field}` : `tracks.${trackId}`
}

export function segPath(segId: SegmentId, field: string): string {
  return field ? `segments.${segId}.${field}` : `segments.${segId}`
}

export function cgrpPath(cgrpId: string, field: string): string {
  return field ? `compGroups.${cgrpId}.${field}` : `compGroups.${cgrpId}`
}

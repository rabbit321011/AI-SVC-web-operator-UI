import type { Patch, Command, TrackId, SegmentId } from '@/types'

export function makeCommand(description: string, patches: Patch[], inversePatches: Patch[]): Command {
  return { description, patches, inversePatches }
}

export function trackPath(trackId: TrackId, field: string): string {
  return `tracks.${trackId}.${field}`
}

export function segPath(segId: SegmentId, field: string): string {
  return `segments.${segId}.${field}`
}

export function cgrpPath(cgrpId: string, field: string): string {
  return `compGroups.${cgrpId}.${field}`
}

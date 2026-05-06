import type { Patch, Command, AudioSegment, TrackId } from '@/types'
import { makeCommand, segPath, trackPath } from './types'

export function buildMergeWithinTrackCommand(
  trackId: TrackId,
  oldSegments: AudioSegment[],
  newSegment: AudioSegment,
): Command {
  const patches: Patch[] = [
    {
      op: 'add',
      path: segPath(newSegment.id, ''),
      value: { ...newSegment },
    },
    {
      op: 'add',
      path: trackPath(trackId, 'segments'),
      value: newSegment.id,
    },
  ]
  for (const seg of oldSegments) {
    patches.push({
      op: 'remove',
      path: trackPath(trackId, 'segments'),
      oldValue: seg.id,
    })
    patches.push({
      op: 'remove',
      path: segPath(seg.id, ''),
      oldValue: { ...seg },
    })
  }

  const inversePatches: Patch[] = []
  for (const seg of oldSegments) {
    inversePatches.push({
      op: 'add',
      path: segPath(seg.id, ''),
      value: { ...seg },
    })
    inversePatches.push({
      op: 'add',
      path: trackPath(trackId, 'segments'),
      value: seg.id,
    })
  }
  inversePatches.push({
    op: 'remove',
    path: segPath(newSegment.id, ''),
    oldValue: { ...newSegment },
  })
  inversePatches.push({
    op: 'remove',
    path: trackPath(trackId, 'segments'),
    oldValue: newSegment.id,
  })

  return makeCommand(`合并 ${oldSegments.length} 个片段`, patches, inversePatches)
}

import type { Patch, Command, DeepCopySegment, AudioSegment, TrackId } from '@/types'
import { makeCommand, segPath, trackPath } from './types'

export interface PasteContext {
  items: DeepCopySegment[]
  newSegments: AudioSegment[]
}

export function buildPasteCommand(ctx: PasteContext): Command {
  const patches: Patch[] = []
  const inversePatches: Patch[] = []

  for (const seg of ctx.newSegments) {
    patches.push({
      op: 'add',
      path: segPath(seg.id, ''),
      value: { ...seg },
    })
    patches.push({
      op: 'add',
      path: trackPath(seg.trackId, 'segments'),
      value: seg.id,
    })
    inversePatches.push({
      op: 'remove',
      path: segPath(seg.id, ''),
      oldValue: { ...seg },
    })
    inversePatches.push({
      op: 'remove',
      path: trackPath(seg.trackId, 'segments'),
      oldValue: seg.id,
    })
  }

  return makeCommand(`粘贴 ${ctx.newSegments.length} 个片段`, patches, inversePatches)
}

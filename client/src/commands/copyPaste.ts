import type { Patch, Command, DeepCopySegment, AudioSegment, Track } from '@/types'
import { makeCommand, segPath, trackPath } from './types'

export interface PasteContext {
  items: DeepCopySegment[]
  newSegments: AudioSegment[]
  newTrack: Track
}

export function buildPasteCommand(ctx: PasteContext): Command {
  const patches: Patch[] = [
    {
      op: 'add',
      path: `tracks.${ctx.newTrack.id}`,
      value: { ...ctx.newTrack },
    },
    {
      op: 'add',
      path: 'trackOrder',
      value: ctx.newTrack.id,
    },
  ]
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

  inversePatches.push({
    op: 'remove',
    path: 'trackOrder',
    oldValue: ctx.newTrack.id,
  })
  inversePatches.push({
    op: 'remove',
    path: `tracks.${ctx.newTrack.id}`,
    oldValue: { ...ctx.newTrack },
  })

  return makeCommand(`粘贴 ${ctx.newSegments.length} 个片段`, patches, inversePatches)
}

import type { Patch, Command, TrackId, SegmentId, AudioSegment } from '@/types'
import { makeCommand, trackPath } from './types'

export interface SplitContext {
  trackId: TrackId
  segment: AudioSegment
  cutTime: number
  sampleRate: number
}

export function buildSplitCommand(ctx: SplitContext, newSegA: AudioSegment, newSegB: AudioSegment): Command {
  const oldSegId = ctx.segment.id

  const patches: Patch[] = [
    {
      op: 'add',
      path: `segments.${newSegA.id}`,
      value: { ...newSegA },
    },
    {
      op: 'add',
      path: `segments.${newSegB.id}`,
      value: { ...newSegB },
    },
    {
      op: 'remove',
      path: trackPath(ctx.trackId, 'segments'),
      oldValue: oldSegId,
    },
    {
      op: 'remove',
      path: `segments.${oldSegId}`,
      oldValue: { ...ctx.segment },
    },
  ]

  const inversePatches: Patch[] = [
    {
      op: 'add',
      path: `segments.${oldSegId}`,
      value: { ...ctx.segment },
    },
    {
      op: 'add',
      path: trackPath(ctx.trackId, 'segments'),
      value: oldSegId,
    },
    {
      op: 'remove',
      path: trackPath(ctx.trackId, 'segments'),
      oldValue: newSegA.id,
    },
    {
      op: 'remove',
      path: trackPath(ctx.trackId, 'segments'),
      oldValue: newSegB.id,
    },
    {
      op: 'remove',
      path: `segments.${newSegA.id}`,
      oldValue: { ...newSegA },
    },
    {
      op: 'remove',
      path: `segments.${newSegB.id}`,
      oldValue: { ...newSegB },
    },
  ]

  return makeCommand(`切分音轨片段 ${oldSegId}`, patches, inversePatches)
}

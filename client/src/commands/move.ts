import type { Patch, Command, AudioSegment } from '@/types'
import { makeCommand, segPath } from './types'

interface DragEntry {
  seg: AudioSegment
  origStart: number
  origEnd: number
}

export function buildMoveCommand(entries: DragEntry[]): Command {
  const patches: Patch[] = []
  const inversePatches: Patch[] = []

  for (const { seg, origStart, origEnd } of entries) {
    patches.push({
      op: 'replace',
      path: segPath(seg.id, 'timelineStart'),
      value: seg.timelineStart,
      oldValue: origStart,
    })
    patches.push({
      op: 'replace',
      path: segPath(seg.id, 'timelineEnd'),
      value: seg.timelineEnd,
      oldValue: origEnd,
    })

    inversePatches.push({
      op: 'replace',
      path: segPath(seg.id, 'timelineStart'),
      value: origStart,
      oldValue: seg.timelineStart,
    })
    inversePatches.push({
      op: 'replace',
      path: segPath(seg.id, 'timelineEnd'),
      value: origEnd,
      oldValue: seg.timelineEnd,
    })
  }

  return makeCommand(`移动 ${entries.length} 个片段`, patches, inversePatches)
}

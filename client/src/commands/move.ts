import type { Patch, Command, AudioSegment } from '@/types'
import { makeCommand, segPath } from './types'

interface DragEntry {
  seg: AudioSegment
  origStart: number
  origEnd: number
  origTrackId: string
  origColor: string
}

export function buildMoveCommand(entries: DragEntry[]): Command {
  const patches: Patch[] = []
  const inversePatches: Patch[] = []

  for (const { seg, origStart, origEnd, origTrackId, origColor } of entries) {
    const movedTrack = seg.trackId !== origTrackId
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
    if (movedTrack) {
      patches.push({ op: 'remove', path: `tracks.${origTrackId}.segments`, oldValue: seg.id })
      patches.push({ op: 'add', path: `tracks.${seg.trackId}.segments`, value: seg.id })
      patches.push({ op: 'replace', path: segPath(seg.id, 'trackId'), value: seg.trackId, oldValue: origTrackId })
      patches.push({ op: 'replace', path: segPath(seg.id, 'color'), value: seg.color, oldValue: origColor })
    }

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
    if (movedTrack) {
      inversePatches.push({ op: 'remove', path: `tracks.${seg.trackId}.segments`, oldValue: seg.id })
      inversePatches.push({ op: 'add', path: `tracks.${origTrackId}.segments`, value: seg.id })
      inversePatches.push({ op: 'replace', path: segPath(seg.id, 'trackId'), value: origTrackId, oldValue: seg.trackId })
      inversePatches.push({ op: 'replace', path: segPath(seg.id, 'color'), value: origColor, oldValue: seg.color })
    }
  }

  return makeCommand(`移动 ${entries.length} 个片段`, patches, inversePatches)
}

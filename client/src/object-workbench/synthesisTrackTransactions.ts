import type {
  SynthesisHTokenEvent,
  SynthesisHPlacementRange,
  SynthesisKanaSegmentBoundary,
  SynthesisKanaUnit,
  SynthesisSegmentObject,
  SynthesisSourceRevisionRef,
  SynthesisTrackOrigin,
  SynthesisTrackRevision,
  SynthesisUnitObjectNode,
} from './types'

interface ReplaceBase {
  operation: string
  origin: SynthesisTrackOrigin
  sourceRefs?: SynthesisSourceRevisionRef[]
  startFrame: number
  endFrameExclusive: number
  now?: string
  revisionId?: string
}

export interface ReplaceSegmentTrackRequest extends Omit<ReplaceBase, 'startFrame' | 'endFrameExclusive'> {
  items: SynthesisSegmentObject[]
}

export interface ReplaceKanaTrackRangeRequest extends ReplaceBase {
  units: SynthesisKanaUnit[]
  boundaries: SynthesisKanaSegmentBoundary[]
  boundaryEndFrameExclusive?: number
}

export interface ReplaceHTokenTrackRangeRequest extends ReplaceBase {
  events: SynthesisHTokenEvent[]
  placementRanges?: SynthesisHPlacementRange[]
  vocabHash?: string
  compilerHash?: string
}

export interface ReplaceMidiPTrackRequest extends Omit<ReplaceBase, 'startFrame' | 'endFrameExclusive'> {
  classes: number[]
  gameModelHash?: string
  compilerHash?: string
}

export interface MoveHTokenEventRequest {
  eventId: string
  targetFrame: number
  forceReplace?: boolean
  operation?: string
  now?: string
  revisionId?: string
}

export interface ReplaceMidiPFrameRequest {
  frame: number
  midiClass: number
  operation?: string
  now?: string
  revisionId?: string
}

export interface MoveMidiPFrameRequest {
  sourceFrame: number
  targetFrame: number
  targetClass: number
  forceReplace?: boolean
  operation?: string
  now?: string
  revisionId?: string
}

export interface UpdateSegmentObjectRequest {
  segmentId: string
  patch: Partial<Pick<SynthesisSegmentObject, 'text' | 'kana' | 'romaji' | 'startFrame' | 'speechEndFrameExclusive'>>
  operation?: string
  now?: string
  revisionId?: string
}

export interface UpdateKanaUnitRequest {
  unitId: string
  patch: Partial<Pick<SynthesisKanaUnit, 'kana' | 'romaji'>>
  operation?: string
  now?: string
  revisionId?: string
}

export interface MoveKanaSharedBoundaryRequest {
  leftUnitId: string
  rightUnitId: string
  targetFrame: number
  operation?: string
  now?: string
  revisionId?: string
}

export function replaceSegmentTrack(unit: SynthesisUnitObjectNode, request: ReplaceSegmentTrackRequest) {
  const frameCount = unit.synthesisUnit.frameContract.frameCount
  validateSegments(request.items, frameCount)
  const track = unit.synthesisUnit.segmentTrack
  const revision = nextRevision(unit, 'segment', request, 0, frameCount)
  track.items = clone(request.items).sort((left, right) => left.startFrame - right.startFrame)
  track.status = 'ready'
  track.origin = request.origin
  track.revision = revision.revision
  track.revisions.push(revision)
  touchUnit(unit, request.now)
}

export function replaceKanaTrackRange(unit: SynthesisUnitObjectNode, request: ReplaceKanaTrackRangeRequest) {
  const range = validateRange(unit, request.startFrame, request.endFrameExclusive)
  const boundaryEndFrameExclusive = request.boundaryEndFrameExclusive ?? range.end
  if (!Number.isInteger(boundaryEndFrameExclusive)
    || boundaryEndFrameExclusive <= range.start
    || boundaryEndFrameExclusive > unit.synthesisUnit.frameContract.frameCount) {
    throw new Error('Kana SEG replacement boundary range is invalid')
  }
  validateKana(request.units, request.boundaries, range.start, range.end, boundaryEndFrameExclusive)
  const track = unit.synthesisUnit.kanaTrack
  const revision = nextRevision(unit, 'kana', request, range.start, Math.max(range.end, boundaryEndFrameExclusive))
  track.units = [
    ...track.units.filter(item => !rangesOverlap(item.startFrame, item.endFrameExclusive, range.start, range.end)),
    ...clone(request.units),
  ].sort((left, right) => left.startFrame - right.startFrame)
  track.boundaries = [
    ...track.boundaries.filter(item => item.frame <= range.start || item.frame >= boundaryEndFrameExclusive),
    ...clone(request.boundaries),
  ].sort((left, right) => left.frame - right.frame)
  track.status = 'ready'
  track.origin = request.origin
  track.revision = revision.revision
  track.revisions.push(revision)
  touchUnit(unit, request.now)
}

export function replaceHTokenTrackRange(unit: SynthesisUnitObjectNode, request: ReplaceHTokenTrackRangeRequest) {
  const range = validateRange(unit, request.startFrame, request.endFrameExclusive)
  validateHEvents(request.events, range.start, range.end)
  const track = unit.synthesisUnit.hTokenTrack
  const revision = nextRevision(unit, 'h', request, range.start, range.end)
  track.events = [
    ...track.events.filter(event => event.frame < range.start || event.frame >= range.end),
    ...clone(request.events),
  ].sort((left, right) => left.frame - right.frame)
  if (request.placementRanges !== undefined) {
    validateHPlacementRanges(request.placementRanges, range.start, range.end)
    track.placementRanges = [
      ...(track.placementRanges ?? []).filter(item => !rangesOverlap(
        item.startFrame,
        item.endFrameExclusive,
        range.start,
        range.end,
      )),
      ...clone(request.placementRanges),
    ].sort((left, right) => left.startFrame - right.startFrame)
  }
  track.status = 'ready'
  track.origin = request.origin
  track.revision = revision.revision
  track.revisions.push(revision)
  if (request.vocabHash !== undefined) track.vocabHash = request.vocabHash
  if (request.compilerHash !== undefined) track.compilerHash = request.compilerHash
  touchUnit(unit, request.now)
}

function validateHPlacementRanges(
  ranges: SynthesisHPlacementRange[],
  startFrame: number,
  endFrameExclusive: number,
): void {
  for (const range of ranges) {
    if (!range.phraseId || !Number.isInteger(range.startFrame) || !Number.isInteger(range.endFrameExclusive)
      || range.startFrame < startFrame || range.endFrameExclusive <= range.startFrame
      || range.endFrameExclusive > endFrameExclusive
      || !['phone', 'pul', 'sentence', 'unknown'].includes(range.placementMode)) {
      throw new Error('H placement provenance 越过替换范围')
    }
  }
}

export function replaceMidiPTrack(unit: SynthesisUnitObjectNode, request: ReplaceMidiPTrackRequest) {
  const frameCount = unit.synthesisUnit.frameContract.frameCount
  if (request.classes.length !== frameCount) {
    throw new Error(`MIDI-P requires ${frameCount} dense classes`)
  }
  if (request.classes.some(value => !Number.isInteger(value) || value < 0 || value > 256)) {
    throw new Error('MIDI-P class must be an integer in 0..256')
  }
  const track = unit.synthesisUnit.midiPTokenTrack
  const revision = nextRevision(unit, 'midi-p', request, 0, frameCount)
  track.classes = [...request.classes]
  track.manualFrames = []
  track.status = 'ready'
  track.origin = request.origin
  track.revision = revision.revision
  track.revisions.push(revision)
  if (request.gameModelHash !== undefined) track.gameModelHash = request.gameModelHash
  if (request.compilerHash !== undefined) track.compilerHash = request.compilerHash
  touchUnit(unit, request.now)
}

export function moveHTokenEvent(unit: SynthesisUnitObjectNode, request: MoveHTokenEventRequest) {
  const track = unit.synthesisUnit.hTokenTrack
  const event = track.events.find(item => item.id === request.eventId)
  if (!event) throw new Error('H event does not exist')
  const frameCount = unit.synthesisUnit.frameContract.frameCount
  if (!Number.isInteger(request.targetFrame) || request.targetFrame < 0 || request.targetFrame >= frameCount) {
    throw new Error('H event target frame is outside the frame contract')
  }
  if (event.frame === request.targetFrame) return
  const occupied = track.events.find(item => item.frame === request.targetFrame && item.id !== event.id)
  if (occupied && !request.forceReplace) {
    throw new Error(`frame ${request.targetFrame} 已有 H token；请显式强制替换`)
  }
  const sourceFrame = event.frame
  if (occupied) track.events = track.events.filter(item => item.id !== occupied.id)
  const moving = track.events.find(item => item.id === event.id)
  if (!moving) throw new Error('H event disappeared during move')
  moving.frame = request.targetFrame
  moving.origin = 'user'
  track.events.sort((left, right) => left.frame - right.frame)
  const revision = nextRevision(unit, 'h', {
    operation: request.operation ?? 'move H token',
    sourceRefs: [],
    now: request.now,
    revisionId: request.revisionId,
  }, Math.min(sourceFrame, request.targetFrame), Math.max(sourceFrame, request.targetFrame) + 1)
  track.revision = revision.revision
  track.origin = 'user'
  track.revisions.push(revision)
  touchUnit(unit, request.now)
}

export function replaceMidiPFrame(unit: SynthesisUnitObjectNode, request: ReplaceMidiPFrameRequest) {
  const track = unit.synthesisUnit.midiPTokenTrack
  const frameCount = unit.synthesisUnit.frameContract.frameCount
  if (track.status !== 'ready' || track.classes.length !== frameCount) {
    throw new Error('MIDI-P track is not a ready dense layer')
  }
  if (!Number.isInteger(request.frame) || request.frame < 0 || request.frame >= frameCount) {
    throw new Error('MIDI-P frame is outside the frame contract')
  }
  if (!Number.isInteger(request.midiClass) || request.midiClass < 0 || request.midiClass > 256) {
    throw new Error('MIDI-P class must be an integer in 0..256')
  }
  if (track.classes[request.frame] === request.midiClass) return
  track.classes[request.frame] = request.midiClass
  track.manualFrames = [...new Set([...(track.manualFrames ?? []), request.frame])].sort((a, b) => a - b)
  const revision = nextRevision(unit, 'midi-p', {
    operation: request.operation ?? 'replace MIDI-P frame',
    sourceRefs: [],
    now: request.now,
    revisionId: request.revisionId,
  }, request.frame, request.frame + 1)
  track.revision = revision.revision
  track.origin = 'user'
  track.revisions.push(revision)
  touchUnit(unit, request.now)
}

export function moveMidiPFrame(unit: SynthesisUnitObjectNode, request: MoveMidiPFrameRequest) {
  const track = unit.synthesisUnit.midiPTokenTrack
  const frameCount = unit.synthesisUnit.frameContract.frameCount
  if (track.status !== 'ready' || track.classes.length !== frameCount) {
    throw new Error('MIDI-P track is not a ready dense layer')
  }
  if (!Number.isInteger(request.sourceFrame) || request.sourceFrame < 0 || request.sourceFrame >= frameCount) {
    throw new Error('MIDI-P source frame is outside the frame contract')
  }
  if (!Number.isInteger(request.targetFrame) || request.targetFrame < 0 || request.targetFrame >= frameCount) {
    throw new Error('MIDI-P target frame is outside the frame contract')
  }
  if (!Number.isInteger(request.targetClass) || request.targetClass < 0 || request.targetClass > 254) {
    throw new Error('MIDI-P moved token must be a pitch class in 0..254')
  }
  if (track.classes[request.sourceFrame] >= 255) {
    throw new Error('只有有音高的 MIDI-P frame 可以拖动')
  }
  if (request.sourceFrame === request.targetFrame) {
    replaceMidiPFrame(unit, {
      frame: request.sourceFrame,
      midiClass: request.targetClass,
      operation: request.operation ?? 'drag MIDI-P pitch',
      now: request.now,
      revisionId: request.revisionId,
    })
    return
  }
  if (
    !request.forceReplace
    && (track.manualFrames ?? []).includes(request.targetFrame)
  ) {
    throw new Error(`frame ${request.targetFrame} 已有手工 MIDI-P；请显式强制移动`)
  }

  const startFrame = Math.min(request.sourceFrame, request.targetFrame)
  const endFrameExclusive = Math.max(request.sourceFrame, request.targetFrame) + 1
  track.classes[request.sourceFrame] = 255
  track.classes[request.targetFrame] = request.targetClass
  track.manualFrames = [...new Set([
    ...(track.manualFrames ?? []),
    request.sourceFrame,
    request.targetFrame,
  ])].sort((left, right) => left - right)
  const revision = nextRevision(unit, 'midi-p', {
    operation: request.operation ?? 'move MIDI-P token',
    sourceRefs: [],
    now: request.now,
    revisionId: request.revisionId,
  }, startFrame, endFrameExclusive)
  track.revision = revision.revision
  track.origin = 'user'
  track.revisions.push(revision)
  touchUnit(unit, request.now)
}

export function updateSegmentObject(unit: SynthesisUnitObjectNode, request: UpdateSegmentObjectRequest) {
  const track = unit.synthesisUnit.segmentTrack
  const index = track.items.findIndex(item => item.id === request.segmentId)
  if (index < 0) throw new Error('Segment does not exist')
  const previous = track.items[index]
  const nextItems = clone(track.items)
  nextItems[index] = { ...nextItems[index], ...request.patch, origin: 'user' }
  validateSegments(nextItems, unit.synthesisUnit.frameContract.frameCount)
  const updated = nextItems[index]
  const revision = nextRevision(unit, 'segment', {
    operation: request.operation ?? 'edit Segment',
    sourceRefs: [],
    now: request.now,
    revisionId: request.revisionId,
  }, Math.min(previous.startFrame, updated.startFrame), Math.max(previous.speechEndFrameExclusive, updated.speechEndFrameExclusive))
  track.items = nextItems.sort((left, right) => left.startFrame - right.startFrame)
  track.revision = revision.revision
  track.origin = 'user'
  track.revisions.push(revision)
  touchUnit(unit, request.now)
}

export function updateKanaUnit(unit: SynthesisUnitObjectNode, request: UpdateKanaUnitRequest) {
  const track = unit.synthesisUnit.kanaTrack
  const index = track.units.findIndex(item => item.id === request.unitId)
  if (index < 0) throw new Error('KanaUnit does not exist')
  const nextUnits = clone(track.units)
  nextUnits[index] = { ...nextUnits[index], ...request.patch, origin: 'user' }
  if (!nextUnits[index].kana.trim()) throw new Error('Kana 不能为空')
  const revision = nextRevision(unit, 'kana', {
    operation: request.operation ?? 'edit Kana',
    sourceRefs: [],
    now: request.now,
    revisionId: request.revisionId,
  }, nextUnits[index].startFrame, nextUnits[index].endFrameExclusive)
  track.units = nextUnits
  track.revision = revision.revision
  track.origin = 'user'
  track.revisions.push(revision)
  touchUnit(unit, request.now)
}

export function moveKanaSharedBoundary(
  unit: SynthesisUnitObjectNode,
  request: MoveKanaSharedBoundaryRequest,
) {
  const track = unit.synthesisUnit.kanaTrack
  const sorted = [...track.units].sort((left, right) => left.startFrame - right.startFrame)
  const leftIndex = sorted.findIndex(item => item.id === request.leftUnitId)
  const rightIndex = sorted.findIndex(item => item.id === request.rightUnitId)
  if (leftIndex < 0 || rightIndex !== leftIndex + 1) throw new Error('Kana shared boundary requires adjacent units')
  const left = sorted[leftIndex]
  const right = sorted[rightIndex]
  if (left.endFrameExclusive !== right.startFrame) throw new Error('Kana units do not share a boundary')
  if (track.boundaries.some(boundary => boundary.frame === left.endFrameExclusive)) {
    throw new Error('Kana SEG 两侧不能使用普通共享边界拖动')
  }
  if (!Number.isInteger(request.targetFrame)
    || request.targetFrame <= left.startFrame
    || request.targetFrame >= right.endFrameExclusive) {
    throw new Error('Kana shared boundary target is outside adjacent units')
  }
  if (request.targetFrame === left.endFrameExclusive) return
  const oldFrame = left.endFrameExclusive
  const nextUnits = clone(track.units)
  const nextLeft = nextUnits.find(item => item.id === left.id)!
  const nextRight = nextUnits.find(item => item.id === right.id)!
  nextLeft.endFrameExclusive = request.targetFrame
  nextRight.startFrame = request.targetFrame
  nextLeft.origin = 'user'
  nextRight.origin = 'user'
  const revision = nextRevision(unit, 'kana', {
    operation: request.operation ?? 'move Kana shared boundary',
    sourceRefs: [],
    now: request.now,
    revisionId: request.revisionId,
  }, Math.min(oldFrame, request.targetFrame), Math.max(oldFrame, request.targetFrame) + 1)
  track.units = nextUnits.sort((a, b) => a.startFrame - b.startFrame)
  track.revision = revision.revision
  track.origin = 'user'
  track.revisions.push(revision)
  touchUnit(unit, request.now)
}

function nextRevision(
  unit: SynthesisUnitObjectNode,
  track: SynthesisTrackRevision['track'],
  request: Pick<ReplaceBase, 'operation' | 'sourceRefs' | 'now' | 'revisionId'>,
  startFrame: number,
  endFrameExclusive: number,
): SynthesisTrackRevision {
  const current = track === 'segment'
    ? unit.synthesisUnit.segmentTrack.revision
    : track === 'kana'
      ? unit.synthesisUnit.kanaTrack.revision
      : track === 'h'
        ? unit.synthesisUnit.hTokenTrack.revision
        : unit.synthesisUnit.midiPTokenTrack.revision
  return {
    id: request.revisionId ?? `revision:${track}:${crypto.randomUUID()}`,
    revision: current + 1,
    track,
    operation: request.operation,
    sourceRefs: clone(request.sourceRefs ?? []),
    affectedStartFrame: startFrame,
    affectedEndFrameExclusive: endFrameExclusive,
    createdAt: request.now ?? new Date().toISOString(),
  }
}

function validateRange(unit: SynthesisUnitObjectNode, start: number, end: number) {
  const frameCount = unit.synthesisUnit.frameContract.frameCount
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > frameCount) {
    throw new Error(`Invalid frame range [${start}, ${end}) for frameCount ${frameCount}`)
  }
  return { start, end }
}

function validateSegments(items: SynthesisSegmentObject[], frameCount: number) {
  const sorted = [...items].sort((left, right) => left.startFrame - right.startFrame)
  for (let index = 0; index < sorted.length; index++) {
    const item = sorted[index]
    if (!Number.isInteger(item.startFrame) || !Number.isInteger(item.speechEndFrameExclusive)) {
      throw new Error('Segment boundaries must be integer frames')
    }
    if (item.startFrame < 0 || item.speechEndFrameExclusive <= item.startFrame || item.speechEndFrameExclusive > frameCount) {
      throw new Error(`Segment ${item.id} is outside the frame contract`)
    }
    if (index > 0 && item.startFrame < sorted[index - 1].speechEndFrameExclusive) {
      throw new Error('Segment speech ranges must not overlap')
    }
  }
}

function validateKana(
  units: SynthesisKanaUnit[],
  boundaries: SynthesisKanaSegmentBoundary[],
  start: number,
  end: number,
  boundaryEndFrameExclusive: number,
) {
  const sorted = [...units].sort((left, right) => left.startFrame - right.startFrame)
  for (let index = 0; index < sorted.length; index++) {
    const unit = sorted[index]
    if (!Number.isInteger(unit.startFrame) || !Number.isInteger(unit.endFrameExclusive)) {
      throw new Error('Kana boundaries must be integer frames')
    }
    if (unit.startFrame < start || unit.endFrameExclusive > end || unit.endFrameExclusive <= unit.startFrame) {
      throw new Error(`Kana ${unit.id} is outside the replacement range`)
    }
    if (index > 0 && unit.startFrame < sorted[index - 1].endFrameExclusive) {
      throw new Error('Kana ranges must not overlap')
    }
  }
  if (boundaries.some(boundary => (
    !Number.isInteger(boundary.frame)
    || boundary.frame <= start
    || boundary.frame >= boundaryEndFrameExclusive
  ))) {
    throw new Error('Kana SEG boundary is outside the replacement range')
  }
  if (new Set(boundaries.map(boundary => boundary.frame)).size !== boundaries.length) {
    throw new Error('Kana SEG boundaries must use distinct frames')
  }
}

function validateHEvents(events: SynthesisHTokenEvent[], start: number, end: number) {
  if (events.some(event => (
    !Number.isInteger(event.frame)
    || event.frame < start
    || event.frame >= end
    || !Number.isInteger(event.tokenId)
    || event.tokenId < 1
    || event.tokenId > 366
    || event.tokenId === 364
  ))) {
    throw new Error('H event is outside the replacement range or token contract')
  }
  if (new Set(events.map(event => event.frame)).size !== events.length) {
    throw new Error('H events must use distinct frames')
  }
}

function touchUnit(unit: SynthesisUnitObjectNode, now?: string) {
  unit.synthesisUnit.unitRevision += 1
  unit.synthesisUnit.updatedAt = now ?? new Date().toISOString()
}

function rangesOverlap(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number) {
  return leftStart < rightEnd && rightStart < leftEnd
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

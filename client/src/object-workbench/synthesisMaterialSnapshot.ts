import type {
  SynthesisHPlacementRange,
  SynthesisHTokenEvent,
  SynthesisUnitObjectNode,
} from './types'
import { createV5PABFrameMap, type V5PABFrameMap } from './synthesisABFrameMap'
import { compileV5PJointHTransport, type V5PJointHTransport } from './synthesisDirectH'
import { validateSynthesisUnit } from './synthesisUnit'

export interface SynthesisMaterialGuideSnapshot {
  assetId: string
  audioSHA256: string
  sampleRate: 44100
  sampleCount: number
  frameCount: number
}

export interface SynthesisMaterialTextSnapshot {
  segmentRevision: number
  kanaRevision: number
  hRevision: number
  hEvents: SynthesisHTokenEvent[]
  denseHTokens: number[]
  placementRanges: SynthesisHPlacementRange[]
  vocabHash?: string
  compilerHash?: string
}

export interface SynthesisMaterialSnapshot {
  schema: 'aisvc.v5p-material-snapshot.v1'
  createdAt: string
  reference: {
    unitId: string
    unitRevision: number
    guide: SynthesisMaterialGuideSnapshot
    text: SynthesisMaterialTextSnapshot
  }
  target: {
    unitId: string
    unitRevision: number
    guide: SynthesisMaterialGuideSnapshot
    text: SynthesisMaterialTextSnapshot
    midiP: {
      revision: number
      classes: number[]
      manualFrames: number[]
      gameModelHash?: string
      compilerHash?: string
    }
  }
  frameMap: V5PABFrameMap
  hTransport: V5PJointHTransport
  midiPTransport: {
    classIds: number[]
    clearEmbeddingStartFrame: 0
    clearEmbeddingEndFrameExclusive: number
    targetStartFrame: number
    targetEndFrameExclusive: number
    rearStartFrame: number
    rearEndFrameExclusive: number
    rearClassId: 255
  }
}

export interface CreateSynthesisMaterialSnapshotOptions {
  now?: string
  referenceEncodedPaddedFrameCount?: number
  targetEncodedPaddedFrameCount?: number
}

export function createSynthesisMaterialSnapshot(
  reference: SynthesisUnitObjectNode,
  target: SynthesisUnitObjectNode,
  options: CreateSynthesisMaterialSnapshotOptions = {},
): SynthesisMaterialSnapshot {
  if (reference.id === target.id) throw new Error('A 区参考不能是 B 自身')
  if (!target.synthesisUnit.reference) throw new Error('B 尚未绑定 A 区参考合成单元')
  if (target.synthesisUnit.reference.unitId !== reference.id) {
    throw new Error('A 区参考与当前绑定不一致')
  }
  assertUnitReady(reference, 'A', false)
  assertUnitReady(target, 'B', true)

  const referenceUnit = reference.synthesisUnit
  const targetUnit = target.synthesisUnit
  const frameMap = createV5PABFrameMap({
    reference: {
      ...referenceUnit.frameContract,
      sampleCount: referenceUnit.guide.sampleCount,
      encodedPaddedFrameCount: options.referenceEncodedPaddedFrameCount,
    },
    target: {
      ...targetUnit.frameContract,
      sampleCount: targetUnit.guide.sampleCount,
      encodedPaddedFrameCount: options.targetEncodedPaddedFrameCount,
    },
  })
  const referenceText = textSnapshot(reference)
  const targetText = textSnapshot(target)
  const hTransport = compileV5PJointHTransport(
    referenceText.denseHTokens,
    targetText.denseHTokens,
    frameMap,
    {
      referenceTerminalPlacementMode: terminalPlacementMode(referenceText),
      targetTerminalPlacementMode: terminalPlacementMode(targetText),
    },
  )
  const targetClasses = [...targetUnit.midiPTokenTrack.classes]
  const classIds = Array(frameMap.totalFrameCount).fill(255)
  classIds.splice(frameMap.bOffsetFrame, targetClasses.length, ...targetClasses)
  const targetEndFrameExclusive = frameMap.bOffsetFrame + targetClasses.length

  return {
    schema: 'aisvc.v5p-material-snapshot.v1',
    createdAt: options.now ?? new Date().toISOString(),
    reference: {
      unitId: reference.id,
      unitRevision: referenceUnit.unitRevision,
      guide: guideSnapshot(reference),
      text: referenceText,
    },
    target: {
      unitId: target.id,
      unitRevision: targetUnit.unitRevision,
      guide: guideSnapshot(target),
      text: targetText,
      midiP: {
        revision: targetUnit.midiPTokenTrack.revision,
        classes: targetClasses,
        manualFrames: [...targetUnit.midiPTokenTrack.manualFrames],
        ...(targetUnit.midiPTokenTrack.gameModelHash
          ? { gameModelHash: targetUnit.midiPTokenTrack.gameModelHash }
          : {}),
        ...(targetUnit.midiPTokenTrack.compilerHash
          ? { compilerHash: targetUnit.midiPTokenTrack.compilerHash }
          : {}),
      },
    },
    frameMap,
    hTransport,
    midiPTransport: {
      classIds,
      clearEmbeddingStartFrame: 0,
      clearEmbeddingEndFrameExclusive: frameMap.bOffsetFrame,
      targetStartFrame: frameMap.bOffsetFrame,
      targetEndFrameExclusive,
      rearStartFrame: targetEndFrameExclusive,
      rearEndFrameExclusive: frameMap.totalFrameCount,
      rearClassId: 255,
    },
  }
}

function assertUnitReady(
  unit: SynthesisUnitObjectNode,
  label: 'A' | 'B',
  requireMidiP: boolean,
): void {
  const errors = validateSynthesisUnit(unit)
  if (errors.length > 0) throw new Error(`${label} 合成单元无效：${errors.join('；')}`)
  const h = unit.synthesisUnit.hTokenTrack
  if (h.status !== 'ready' || h.events.length === 0) {
    throw new Error(`${label} HTokenTrack 尚未准备完成`)
  }
  if (!h.events.some(event => event.tokenId !== 365 && event.tokenId !== 366)) {
    throw new Error(`${label} HTokenTrack 没有发音 token`)
  }
  if (!requireMidiP) return
  const midiP = unit.synthesisUnit.midiPTokenTrack
  if (midiP.status !== 'ready') throw new Error('B MIDI-P 尚未准备完成')
  if (midiP.classes.some(value => value === 256)) {
    throw new Error('B 有效 MIDI-P 不允许 PAD=256')
  }
}

function guideSnapshot(unit: SynthesisUnitObjectNode): SynthesisMaterialGuideSnapshot {
  const { guide, frameContract } = unit.synthesisUnit
  return {
    assetId: guide.assetId,
    audioSHA256: guide.audioSHA256,
    sampleRate: 44100,
    sampleCount: guide.sampleCount,
    frameCount: frameContract.frameCount,
  }
}

function textSnapshot(unit: SynthesisUnitObjectNode): SynthesisMaterialTextSnapshot {
  const synthesisUnit = unit.synthesisUnit
  const track = synthesisUnit.hTokenTrack
  const events = track.events
    .map(event => ({
      ...event,
      ...(event.generatedFrom ? { generatedFrom: { ...event.generatedFrom } } : {}),
    }))
    .sort((left, right) => left.frame - right.frame)
  const denseHTokens = Array(synthesisUnit.frameContract.frameCount).fill(0)
  for (const event of events) denseHTokens[event.frame] = event.tokenId
  return {
    segmentRevision: synthesisUnit.segmentTrack.revision,
    kanaRevision: synthesisUnit.kanaTrack.revision,
    hRevision: track.revision,
    hEvents: events,
    denseHTokens,
    placementRanges: (track.placementRanges ?? []).map(item => ({ ...item })),
    ...(track.vocabHash ? { vocabHash: track.vocabHash } : {}),
    ...(track.compilerHash ? { compilerHash: track.compilerHash } : {}),
  }
}

function terminalPlacementMode(text: SynthesisMaterialTextSnapshot) {
  const terminalSepFrame = text.denseHTokens.lastIndexOf(365)
  const range = text.placementRanges.find(item => (
    item.startFrame <= terminalSepFrame && terminalSepFrame < item.endFrameExclusive
  ))
  return range?.placementMode ?? 'user'
}

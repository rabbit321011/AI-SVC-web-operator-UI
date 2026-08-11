import type {
  NodeId,
  OwnedGuideAudio,
  SynthesisFrameContract,
  SynthesisHTokenTrack,
  SynthesisKanaTrack,
  SynthesisMidiPTokenTrack,
  SynthesisSegmentTrack,
  SynthesisUnitObjectNode,
} from './types'
import type { TrackId } from '@/types'

export const V5P_SAMPLE_RATE = 44100 as const
export const V5P_HOP_SAMPLES = 2048 as const
export const V5P_FRAME_RATE = V5P_SAMPLE_RATE / V5P_HOP_SAMPLES

export interface CreateSynthesisUnitOptions {
  id?: NodeId
  name: string
  guide: OwnedGuideAudio
  timelineTrackId?: TrackId | null
  defaultTimelineStart: number | null
  now?: string
}

export function createSynthesisFrameContract(sampleCount: number): SynthesisFrameContract {
  if (!Number.isSafeInteger(sampleCount) || sampleCount <= 0) {
    throw new Error('Owned Guide sampleCount must be a positive safe integer')
  }
  const frameCount = Math.floor(sampleCount / V5P_HOP_SAMPLES)
  if (frameCount < 1) {
    throw new Error(`Owned Guide is shorter than one V5-P frame (${V5P_HOP_SAMPLES} samples)`)
  }
  const modelSampleCount = frameCount * V5P_HOP_SAMPLES
  return {
    schema: 'aisvc.v5p-frame.v1',
    sampleRate: V5P_SAMPLE_RATE,
    hopSamples: V5P_HOP_SAMPLES,
    frameRate: V5P_FRAME_RATE,
    frameCount,
    modelSampleCount,
    trailingSampleCount: sampleCount - modelSampleCount,
    compilerVersion: 'stable-audio2-oobleck-floor.v1',
  }
}

export function createEmptySynthesisUnit(options: CreateSynthesisUnitOptions): SynthesisUnitObjectNode {
  if (options.guide.sampleRate !== V5P_SAMPLE_RATE) {
    throw new Error(`Owned Guide must be ${V5P_SAMPLE_RATE} Hz`)
  }
  if (options.guide.sampleCount <= 0 || options.guide.duration <= 0) {
    throw new Error('Owned Guide must contain audio')
  }
  const now = options.now ?? new Date().toISOString()
  return {
    id: options.id ?? `node:synthesisUnit:${crypto.randomUUID()}`,
    kind: 'synthesisUnit',
    name: options.name.trim() || 'Synthesis Unit',
    synthesisUnit: {
      schema: 'aisvc.synthesis-unit.v1',
      guide: options.guide,
      frameContract: createSynthesisFrameContract(options.guide.sampleCount),
      segmentTrack: emptySegmentTrack(),
      kanaTrack: emptyKanaTrack(),
      hTokenTrack: emptyHTokenTrack(),
      midiPTokenTrack: emptyMidiPTokenTrack(),
      reference: null,
      unitRevision: 0,
      takes: [],
      activeTakeId: null,
      timelineTrackId: options.timelineTrackId ?? null,
      defaultTimelineStart: options.defaultTimelineStart,
      createdAt: now,
      updatedAt: now,
    },
  }
}

export function validateSynthesisUnit(unit: SynthesisUnitObjectNode): string[] {
  const errors: string[] = []
  const { guide, frameContract, hTokenTrack, midiPTokenTrack } = unit.synthesisUnit
  if (guide.sampleRate !== V5P_SAMPLE_RATE) errors.push('Owned Guide sample rate is not 44100 Hz')
  if (frameContract.frameCount !== Math.floor(guide.sampleCount / V5P_HOP_SAMPLES)) {
    errors.push('Frame count does not match the official Oobleck encoder contract')
  }
  if (frameContract.modelSampleCount !== frameContract.frameCount * V5P_HOP_SAMPLES) {
    errors.push('Model sample count does not match frame count')
  }
  if (frameContract.trailingSampleCount !== guide.sampleCount - frameContract.modelSampleCount) {
    errors.push('Trailing sample count does not match Owned Guide')
  }
  if (hTokenTrack.events.some(event => (
    !Number.isInteger(event.frame)
    || event.frame < 0
    || event.frame >= frameContract.frameCount
    || !Number.isInteger(event.tokenId)
    || event.tokenId < 1
    || event.tokenId > 366
    || event.tokenId === 364
  ))) {
    errors.push('H Token track contains an invalid event')
  }
  if (new Set(hTokenTrack.events.map(event => event.frame)).size !== hTokenTrack.events.length) {
    errors.push('H Token track contains more than one event in a frame')
  }
  if (midiPTokenTrack.status === 'ready') {
    if (midiPTokenTrack.classes.length !== frameContract.frameCount) {
      errors.push('Ready MIDI-P track length does not match frame count')
    }
    if (midiPTokenTrack.classes.some(value => !Number.isInteger(value) || value < 0 || value > 256)) {
      errors.push('MIDI-P track contains an invalid class')
    }
    const flowFrames = midiPTokenTrack.flowFrames ?? []
    if (new Set(flowFrames).size !== flowFrames.length || flowFrames.some(frame => (
      !Number.isInteger(frame)
      || frame <= 0
      || frame >= frameContract.frameCount
      || midiPTokenTrack.classes[frame] >= 255
      || midiPTokenTrack.classes[frame - 1] !== midiPTokenTrack.classes[frame]
    ))) {
      errors.push('MIDI-P track contains an invalid FLOW marker')
    }
  }
  return errors
}

function emptySegmentTrack(): SynthesisSegmentTrack {
  return { status: 'empty', revision: 0, origin: 'empty', items: [], revisions: [] }
}

function emptyKanaTrack(): SynthesisKanaTrack {
  return { status: 'empty', revision: 0, origin: 'empty', units: [], boundaries: [], revisions: [] }
}

function emptyHTokenTrack(): SynthesisHTokenTrack {
  return { status: 'empty', revision: 0, origin: 'empty', events: [], revisions: [], placementRanges: [] }
}

function emptyMidiPTokenTrack(): SynthesisMidiPTokenTrack {
  return { status: 'empty', revision: 0, origin: 'empty', classes: [], flowFrames: [], manualFrames: [], revisions: [] }
}

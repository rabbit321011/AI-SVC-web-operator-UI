import type {
  SynthesisHTokenEvent,
  SynthesisKanaSegmentBoundary,
  SynthesisKanaUnit,
} from '@/object-workbench'

export interface CompiledKanaUnit extends SynthesisKanaUnit {
  phraseId: string
}

export interface CompiledPhraseRange {
  phraseId: string
  startFrame: number
  speechEndFrameExclusive: number
  maxAbsShift: number
}

export interface CompiledHTokenEvent extends SynthesisHTokenEvent {
  phraseId?: string
  moraIndex?: number
  phoneIndex?: number
}

export interface CompiledHPlacementMode {
  phraseId: string
  placementMode: 'phone' | 'pul' | 'sentence' | 'unknown'
  fallbackReason: string | null
}

export interface SynthesisTextControlResult {
  schema: 'aisvc.v5p-text-control.v1'
  frameRate: number
  frameCount: number
  kanaUnits: CompiledKanaUnit[]
  kanaBoundaries: SynthesisKanaSegmentBoundary[]
  phraseRanges: CompiledPhraseRange[]
  hEvents: CompiledHTokenEvent[]
  hAudit: {
    phonePhraseCount: number
    pulPhraseCount: number
    exactControlPhraseCount: number
    pulFrameCount: number
    lockedEventTokenSHA256: string
    phraseModes: CompiledHPlacementMode[]
  }
  runtimeHashes: Record<string, string>
  compilerSHA256: string
}

export function readSynthesisTextControlResult(
  message: unknown,
  expectedFrameCount: number,
): SynthesisTextControlResult | null {
  if (!isRecord(message) || message.type !== 'text-control-result' || !isRecord(message.result)) return null
  const result = message.result
  if (result.schema !== 'aisvc.v5p-text-control.v1' || result.frameCount !== expectedFrameCount) return null
  if (!Number.isFinite(result.frameRate) || Math.abs(result.frameRate - 44100 / 2048) > 1e-9) return null
  if (!Array.isArray(result.kanaUnits) || !Array.isArray(result.kanaBoundaries)
    || !Array.isArray(result.phraseRanges) || !Array.isArray(result.hEvents)) return null

  const kanaUnits = result.kanaUnits.map(value => readKanaUnit(value, expectedFrameCount))
  const kanaBoundaries = result.kanaBoundaries.map(value => readKanaBoundary(value, expectedFrameCount))
  const phraseRanges = result.phraseRanges.map(value => readPhraseRange(value, expectedFrameCount))
  const hEvents = result.hEvents.map(value => readHEvent(value, expectedFrameCount))
  if (!isRecord(result.hAudit) || !Array.isArray(result.hAudit.phraseModes)
    || !isRecord(result.runtimeHashes) || typeof result.compilerSHA256 !== 'string') return null
  if (new Set(hEvents.map(event => event.frame)).size !== hEvents.length) return null

  return {
    schema: 'aisvc.v5p-text-control.v1',
    frameRate: result.frameRate,
    frameCount: result.frameCount,
    kanaUnits,
    kanaBoundaries,
    phraseRanges,
    hEvents,
    hAudit: {
      phonePhraseCount: integer(result.hAudit.phonePhraseCount, 'phonePhraseCount'),
      pulPhraseCount: integer(result.hAudit.pulPhraseCount, 'pulPhraseCount'),
      exactControlPhraseCount: integer(result.hAudit.exactControlPhraseCount, 'exactControlPhraseCount'),
      pulFrameCount: integer(result.hAudit.pulFrameCount, 'pulFrameCount'),
      lockedEventTokenSHA256: string(result.hAudit.lockedEventTokenSHA256, 'lockedEventTokenSHA256'),
      phraseModes: result.hAudit.phraseModes.map(readPhraseMode),
    },
    runtimeHashes: Object.fromEntries(Object.entries(result.runtimeHashes).map(([key, value]) => [key, string(value, key)])),
    compilerSHA256: result.compilerSHA256,
  }
}

function readKanaUnit(value: unknown, frameCount: number): CompiledKanaUnit {
  if (!isRecord(value)) throw new Error('Kana compiler 返回了无效对象')
  const startFrame = integer(value.startFrame, 'Kana startFrame')
  const endFrameExclusive = integer(value.endFrameExclusive, 'Kana endFrameExclusive')
  if (startFrame < 0 || endFrameExclusive <= startFrame || endFrameExclusive > frameCount) {
    throw new Error('Kana compiler 返回了无效范围')
  }
  return {
    id: string(value.id, 'Kana id'),
    kana: string(value.kana, 'Kana'),
    romaji: string(value.romaji, 'Kana romaji'),
    startFrame,
    endFrameExclusive,
    origin: 'segment-align',
    phraseId: string(value.phraseId, 'Kana phraseId'),
  }
}

function readKanaBoundary(value: unknown, frameCount: number): SynthesisKanaSegmentBoundary {
  if (!isRecord(value) || value.kind !== 'SEG') throw new Error('Kana compiler 返回了无效 SEG')
  const frame = integer(value.frame, 'Kana SEG frame')
  if (frame < 0 || frame >= frameCount) throw new Error('Kana SEG 越过 frame 合同')
  return {
    id: string(value.id, 'Kana SEG id'),
    frame,
    kind: 'SEG',
    origin: 'segment-align',
  }
}

function readPhraseRange(value: unknown, frameCount: number): CompiledPhraseRange {
  if (!isRecord(value)) throw new Error('Text Control phrase range 无效')
  const startFrame = integer(value.startFrame, 'phrase startFrame')
  const speechEndFrameExclusive = integer(value.speechEndFrameExclusive, 'phrase endFrameExclusive')
  if (startFrame < 0 || speechEndFrameExclusive <= startFrame || speechEndFrameExclusive > frameCount) {
    throw new Error('Text Control phrase range 越过 frame 合同')
  }
  return {
    phraseId: string(value.phraseId, 'phraseId'),
    startFrame,
    speechEndFrameExclusive,
    maxAbsShift: integer(value.maxAbsShift, 'phrase maxAbsShift'),
  }
}

function readHEvent(value: unknown, frameCount: number): CompiledHTokenEvent {
  if (!isRecord(value)) throw new Error('H compiler 返回了无效事件')
  const frame = integer(value.frame, 'H frame')
  const tokenId = integer(value.tokenId, 'H tokenId')
  if (frame < 0 || frame >= frameCount || tokenId < 1 || tokenId > 366 || tokenId === 364) {
    throw new Error('H compiler 事件越过 runtime 合同')
  }
  const event: CompiledHTokenEvent = {
    id: string(value.id, 'H id'),
    frame,
    tokenId,
    symbol: string(value.symbol, 'H symbol'),
    origin: 'segment-align',
  }
  if (value.phraseId !== undefined) event.phraseId = string(value.phraseId, 'H phraseId')
  if (value.moraIndex !== undefined) {
    event.moraIndex = integer(value.moraIndex, 'H moraIndex')
    if (event.moraIndex < 0) throw new Error('H moraIndex 必须非负')
  }
  if (value.phoneIndex !== undefined) {
    event.phoneIndex = integer(value.phoneIndex, 'H phoneIndex')
    if (event.phoneIndex < 0) throw new Error('H phoneIndex 必须非负')
  }
  return event
}

function readPhraseMode(value: unknown): CompiledHPlacementMode {
  if (!isRecord(value)) throw new Error('H phrase placement mode 无效')
  const placementMode = string(value.placementMode, 'H placementMode')
  if (!['phone', 'pul', 'sentence', 'unknown'].includes(placementMode)) {
    throw new Error('H placementMode 超出合同')
  }
  if (value.fallbackReason !== null && value.fallbackReason !== undefined && typeof value.fallbackReason !== 'string') {
    throw new Error('H fallbackReason 无效')
  }
  return {
    phraseId: string(value.phraseId, 'H phraseId'),
    placementMode: placementMode as CompiledHPlacementMode['placementMode'],
    fallbackReason: value.fallbackReason == null ? null : value.fallbackReason,
  }
}

function integer(value: unknown, label: string): number {
  if (!Number.isInteger(value)) throw new Error(`${label} 必须是整数`)
  return Number(value)
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${label} 必须是非空字符串`)
  return value
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null
}

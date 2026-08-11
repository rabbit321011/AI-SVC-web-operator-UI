export interface SynthesisMidiPRawNote {
  duration: number
  presence: boolean
  score: number
  class: number
  valid: boolean
}

export interface SynthesisMidiPResult {
  schema: 'aisvc.v5p-midi-p.v1'
  sourceSHA256: string
  sourceSampleCount: number
  frameCount: number
  classes: number[]
  noteIds: number[]
  rawNotes: SynthesisMidiPRawNote[]
  baseSeed: number
  effectiveSeed: number
  language: string
  languageId: number
  gameCommit: string
  runtimeHashes: Record<string, string>
  compilerSHA256: string
}

export function readSynthesisMidiPResult(message: unknown, expectedFrameCount: number): SynthesisMidiPResult | null {
  if (!isRecord(message) || message.type !== 'midi-p-result' || !isRecord(message.result)) return null
  const result = message.result
  if (result.schema !== 'aisvc.v5p-midi-p.v1' || result.frameCount !== expectedFrameCount) return null
  if (!Array.isArray(result.classes) || !Array.isArray(result.noteIds)
    || result.classes.length !== expectedFrameCount || result.noteIds.length !== expectedFrameCount) return null
  const classes = result.classes.map(value => integer(value, 'MIDI-P class'))
  const noteIds = result.noteIds.map(value => integer(value, 'MIDI-P noteId'))
  if (classes.some(value => value < 0 || value > 255)) throw new Error('有效 B 区 MIDI-P 不能包含越界 class 或 PAD')
  if (noteIds.some(value => value < 1)) throw new Error('MIDI-P noteId 必须从 1 开始')
  if (!Array.isArray(result.rawNotes) || !isRecord(result.runtimeHashes)) return null
  return {
    schema: 'aisvc.v5p-midi-p.v1',
    sourceSHA256: string(result.sourceSHA256, 'sourceSHA256'),
    sourceSampleCount: integer(result.sourceSampleCount, 'sourceSampleCount'),
    frameCount: expectedFrameCount,
    classes,
    noteIds,
    rawNotes: result.rawNotes.map(readRawNote),
    baseSeed: integer(result.baseSeed, 'baseSeed'),
    effectiveSeed: integer(result.effectiveSeed, 'effectiveSeed'),
    language: string(result.language, 'language'),
    languageId: integer(result.languageId, 'languageId'),
    gameCommit: string(result.gameCommit, 'gameCommit'),
    runtimeHashes: Object.fromEntries(Object.entries(result.runtimeHashes).map(([key, value]) => [key, string(value, key)])),
    compilerSHA256: string(result.compilerSHA256, 'compilerSHA256'),
  }
}

function readRawNote(value: unknown): SynthesisMidiPRawNote {
  if (!isRecord(value)) throw new Error('GAME raw note 无效')
  const duration = number(value.duration, 'note duration')
  const score = number(value.score, 'note score')
  const midiClass = integer(value.class, 'note class')
  if (duration < 0 || midiClass < 0 || midiClass > 256) throw new Error('GAME raw note 越过 adapter 合同')
  if (typeof value.presence !== 'boolean' || typeof value.valid !== 'boolean') throw new Error('GAME raw note mask 无效')
  return { duration, score, class: midiClass, presence: value.presence, valid: value.valid }
}

function integer(value: unknown, label: string): number {
  if (!Number.isInteger(value)) throw new Error(`${label} 必须是整数`)
  return Number(value)
}

function number(value: unknown, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} 必须是有限数`)
  return Number(value)
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${label} 必须是非空字符串`)
  return value
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null
}

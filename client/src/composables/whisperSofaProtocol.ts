import type { TextSegment } from '@/object-workbench'

export const SOFA_ALIGNMENT_METHOD = 'SOFA_JPN_Test2_Plus_full_segment' as const

export interface SofaAlignedTextSegment extends TextSegment {
  alignmentMethod: typeof SOFA_ALIGNMENT_METHOD
}

export interface WhisperSofaResult {
  segments: SofaAlignedTextSegment[]
  phrases: WhisperSofaPhrase[]
  phones: WhisperSofaInterval[]
  confidence?: number
}

export interface WhisperSofaPhrase {
  id: string
  text: string
  kana: string
  romaji: string
  start: number
  end: number
}

export interface WhisperSofaInterval {
  label: string
  start: number
  end: number
}

export function readWhisperSofaResult(message: unknown): WhisperSofaResult | null {
  if (!isRecord(message) || message.type !== 'result') return null
  if (message.alignmentMethod !== SOFA_ALIGNMENT_METHOD) return null
  const textObject = message.textObject
  if (!isRecord(textObject) || !isRecord(textObject.text)) return null
  const sourceSegments = textObject.text.segments
  if (!Array.isArray(sourceSegments) || sourceSegments.length === 0) return null

  const segments: SofaAlignedTextSegment[] = []
  let previousEnd = -1
  for (const value of sourceSegments) {
    if (!isRecord(value)) return null
    const start = Number(value.start)
    const end = Number(value.end)
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return null
    if (start < previousEnd - 1e-3) return null
    if (typeof value.kana !== 'string' || typeof value.romaji !== 'string') return null
    if (value.alignmentMethod !== SOFA_ALIGNMENT_METHOD) return null
    segments.push({
      id: typeof value.id === 'string' ? value.id : undefined,
      start,
      end,
      kana: value.kana,
      romaji: value.romaji,
      alignmentMethod: SOFA_ALIGNMENT_METHOD,
    })
    previousEnd = end
  }

  return {
    segments,
    phrases: readPhrases(message.phrases),
    phones: readIntervals(message.phones),
    confidence: Number.isFinite(Number(message.confidence)) ? Number(message.confidence) : undefined,
  }
}

export function whisperSofaProgressLabel(message: unknown): string {
  if (!isRecord(message)) return '日语转录处理中'
  return message.stage === 'sofa' ? 'SOFA 全段对齐中' : 'Whisper 日语转写中'
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null
}

function readPhrases(value: unknown): WhisperSofaPhrase[] {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`SOFA phrase ${index} is invalid`)
    const start = Number(item.start)
    const end = Number(item.end)
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      throw new Error(`SOFA phrase ${index} has an invalid range`)
    }
    return {
      id: typeof item.id === 'string' ? item.id : `phrase:sofa:${index}`,
      text: String(item.text ?? ''),
      kana: String(item.kana ?? item.text ?? ''),
      romaji: String(item.romaji ?? ''),
      start,
      end,
    }
  })
}

function readIntervals(value: unknown): WhisperSofaInterval[] {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`SOFA phone ${index} is invalid`)
    const start = Number(item.start)
    const end = Number(item.end)
    if (typeof item.label !== 'string' || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
      throw new Error(`SOFA phone ${index} is invalid`)
    }
    return { label: item.label, start, end }
  })
}

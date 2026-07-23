import type { TextSegment } from '@/object-workbench'

export const SOFA_ALIGNMENT_METHOD = 'SOFA_JPN_Test2_Plus_full_segment' as const

export interface SofaAlignedTextSegment extends TextSegment {
  alignmentMethod: typeof SOFA_ALIGNMENT_METHOD
}

export interface WhisperSofaResult {
  segments: SofaAlignedTextSegment[]
  confidence?: number
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

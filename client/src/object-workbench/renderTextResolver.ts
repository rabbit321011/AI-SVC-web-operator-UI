import type { NodeId, ProjectObjectTree, RuntimeTreeIndex, TextObjectNode } from './types'
import type { RenderInputRef } from './renderInputs'
import { buildNodeIndex } from './objectTree'
import { resolveGroupObjectInput, resolveTrackObjectInput } from './groupResolver'

export interface ResolvedTextRenderInput {
  text: string
  phrases: TimedSvsPhrase[]
  sourceStart: number
  sourceEnd: number
  warnings: string[]
}

export interface TimedSvsPhrase {
  start: number
  end?: number
  text: string
}

export function normalizeSvsText(text: string): string {
  return text
    .replace(/\s+/g, '')
    .replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~、。，．？！・：；「」『』（）［］【】…—]+/g, '|')
    .replace(/\|+/g, '|')
    .replace(/^\|+|\|+$/g, '')
}

export function resolveTextRenderInput(tree: ProjectObjectTree, input: RenderInputRef): ResolvedTextRenderInput {
  if (input.kind === 'audioObject') throw new Error('Text input cannot be AudioObject')

  const resolved = input.kind === 'group'
    ? resolveGroupObjectInput(tree, input.id)
    : resolveTrackObjectInput(tree, input.id)
  if (resolved.mediaType !== 'text') throw new Error('Render input is not text')

  const index = buildNodeIndex(tree.root)
  const pieces = resolved.items.map(item => textFromSource(index, item.sourceObjectId)).filter(Boolean)
  const text = normalizeSvsText(pieces.join('|'))
  if (!text) throw new Error('Text input is empty')

  const phrases = resolved.items
    .flatMap(item => phrasesFromSource(index, item.sourceObjectId, item.relativeStart, item.relativeEnd))
    .sort((a, b) => a.start - b.start)
  if (phrases.length === 0) throw new Error('Timed text input has no usable phrases')

  return {
    text,
    phrases,
    sourceStart: resolved.sourceStart,
    sourceEnd: resolved.sourceEnd,
    warnings: resolved.warnings,
  }
}

export function rebaseTimedSvsPhrases(
  input: ResolvedTextRenderInput,
  audioSourceStart: number,
  audioDuration: number,
  label: string,
): TimedSvsPhrase[] {
  if (!Number.isFinite(audioSourceStart) || !Number.isFinite(audioDuration) || audioDuration <= 0) {
    throw new Error(`${label} 音频时间范围无效`)
  }

  return input.phrases.map((phrase, index) => {
    const start = input.sourceStart + phrase.start - audioSourceStart
    const end = phrase.end == null ? undefined : input.sourceStart + phrase.end - audioSourceStart
    if (start < -1e-6 || start >= audioDuration) {
      throw new Error(`${label} 第 ${index + 1} 句起点不在对应音频范围内`)
    }
    if (end != null && (end < start || end > audioDuration + 1e-6)) {
      throw new Error(`${label} 第 ${index + 1} 句终点不在对应音频范围内`)
    }
    return {
      start: Math.max(0, start),
      ...(end == null ? {} : { end: Math.min(audioDuration, end) }),
      text: phrase.text,
    }
  })
}

function textFromSource(index: RuntimeTreeIndex, sourceObjectId: NodeId): string {
  const node = index.nodes[sourceObjectId]
  if (!node || node.kind !== 'text') throw new Error(`Expected TextObject source: ${sourceObjectId}`)
  return textObjectContent(node)
}

function phrasesFromSource(
  index: RuntimeTreeIndex,
  sourceObjectId: NodeId,
  relativeStart: number,
  relativeEnd: number,
): TimedSvsPhrase[] {
  const node = index.nodes[sourceObjectId]
  if (!node || node.kind !== 'text') throw new Error(`Expected TextObject source: ${sourceObjectId}`)
  const clipDuration = relativeEnd - relativeStart
  return node.text.segments.flatMap((segment, index) => {
    const text = normalizeSvsText(segment.kana || segment.romaji).replace(/\|/g, '')
    if (!text) return []
    if (!Number.isFinite(segment.start) || segment.start < 0 || segment.start >= clipDuration) {
      throw new Error(`TextObject ${sourceObjectId} segment ${index + 1} has an invalid T1 start`)
    }
    if (segment.end != null && (!Number.isFinite(segment.end) || segment.end < segment.start || segment.end > clipDuration)) {
      throw new Error(`TextObject ${sourceObjectId} segment ${index + 1} has an invalid T1 end`)
    }
    return [{
      start: relativeStart + segment.start,
      ...(segment.end == null ? {} : { end: relativeStart + segment.end }),
      text,
    }]
  })
}

function textObjectContent(node: TextObjectNode): string {
  return node.text.segments
    .slice()
    .sort((a, b) => a.start - b.start)
    .map(segment => segment.kana || segment.romaji)
    .join('')
}

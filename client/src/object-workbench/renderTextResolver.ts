import type { NodeId, ProjectObjectTree, RuntimeTreeIndex, TextObjectNode } from './types'
import type { RenderInputRef } from './renderInputs'
import { buildNodeIndex } from './objectTree'
import { resolveGroupObjectInput, resolveTrackObjectInput } from './groupResolver'

export interface ResolvedTextRenderInput {
  text: string
  sourceStart: number
  sourceEnd: number
  warnings: string[]
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

  return {
    text,
    sourceStart: resolved.sourceStart,
    sourceEnd: resolved.sourceEnd,
    warnings: resolved.warnings,
  }
}

function textFromSource(index: RuntimeTreeIndex, sourceObjectId: NodeId): string {
  const node = index.nodes[sourceObjectId]
  if (!node || node.kind !== 'text') throw new Error(`Expected TextObject source: ${sourceObjectId}`)
  return textObjectContent(node)
}

function textObjectContent(node: TextObjectNode): string {
  return node.text.segments
    .slice()
    .sort((a, b) => a.start - b.start)
    .map(segment => segment.kana || segment.romaji)
    .join('')
}

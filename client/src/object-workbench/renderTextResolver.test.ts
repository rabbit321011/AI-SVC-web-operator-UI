import { describe, expect, it } from 'vitest'
import type { ProjectObjectTree, TextObjectNode, TrackFolderNode, TrackObjectNode } from './types'
import { createEmptyProjectObjectTree, createGroupObject, normalizeSvsText, rebaseTimedSvsPhrases, resolveTextRenderInput, TOP_LEVEL_IDS } from './index'

describe('SVS text render resolver', () => {
  it('normalizes manual SVS text by removing spaces and converting punctuation to separators', () => {
    expect(normalizeSvsText(' き み の、こえ!  ')).toBe('きみの|こえ')
  })

  it('normalizes whitespace and punctuation-only SVS text to empty', () => {
    expect(normalizeSvsText('  、。 !  ')).toBe('')
  })

  it('preserves TextObject kana punctuation for the V4H training frontend', () => {
    const tree = makeTextTree()
    const source = tree.root.children
      .flatMap(node => node.kind === 'folder' ? node.children : [])
      .find(node => node.id === 'node:text:a')
    if (!source || source.kind !== 'text') throw new Error('missing text source')
    source.text.segments[1].kana = 'きみ、の'

    const resolved = resolveTextRenderInput(tree, {
      kind: 'trackObject',
      id: 'node:trackObject:text_a',
      displayName: 'Text A',
    }, { preservePhrasePunctuation: true, requireKana: true })

    expect(resolved.phrases[0].text).toBe('きみ、の')
  })

  it('does not allow romaji fallback in the V4H text frontend', () => {
    const tree = makeTextTree()
    const source = tree.root.children
      .flatMap(node => node.kind === 'folder' ? node.children : [])
      .find(node => node.id === 'node:text:a')
    if (!source || source.kind !== 'text') throw new Error('missing text source')
    source.text.segments[1].kana = ''

    expect(() => resolveTextRenderInput(tree, {
      kind: 'trackObject',
      id: 'node:trackObject:text_a',
      displayName: 'Text A',
    }, { preservePhrasePunctuation: true, requireKana: true })).toThrow(/requires kana for V4H/)
  })

  it('resolves a text TrackObject by segment start order', () => {
    const tree = makeTextTree()
    const resolved = resolveTextRenderInput(tree, {
      kind: 'trackObject',
      id: 'node:trackObject:text_a',
      displayName: 'Text A',
    })

    expect(resolved.text).toBe('きみのこえ')
    expect(resolved.phrases).toEqual([
      { start: 0, text: 'きみの' },
      { start: 1, text: 'こえ' },
    ])
    expect(resolved.sourceStart).toBe(4)
    expect(resolved.sourceEnd).toBe(6)
  })

  it('resolves a text GroupObject with separators between TextObjects', () => {
    const tree = makeTextTree()
    createGroupObject(tree, {
      id: 'node:group:text',
      name: 'Text Group',
      trackObjectIds: ['node:trackObject:text_b', 'node:trackObject:text_a'],
    })

    const resolved = resolveTextRenderInput(tree, {
      kind: 'group',
      id: 'node:group:text',
      displayName: 'Text Group',
    })

    expect(resolved.text).toBe('きみのこえ|とおく')
    expect(resolved.phrases).toEqual([
      { start: 0, text: 'きみの' },
      { start: 1, text: 'こえ' },
      { start: 3, text: 'とおく' },
    ])
    expect(resolved.sourceStart).toBe(4)
    expect(resolved.sourceEnd).toBe(9)
  })

  it('rebases project-timeline phrases to the matching audio-local timeline', () => {
    const resolved = resolveTextRenderInput(makeTextTree(), {
      kind: 'trackObject',
      id: 'node:trackObject:text_a',
      displayName: 'Text A',
    })

    expect(rebaseTimedSvsPhrases(resolved, 3, 4, 'A')).toEqual([
      { start: 1, text: 'きみの' },
      { start: 2, text: 'こえ' },
    ])
    expect(() => rebaseTimedSvsPhrases(resolved, 5, 4, 'A')).toThrow(/起点不在对应音频范围内/)
  })

  it('clamps a sub-millisecond T1 end rounding error to the clip boundary', () => {
    const tree = makeTextTree()
    const source = tree.root.children
      .flatMap(node => node.kind === 'folder' ? node.children : [])
      .find(node => node.id === 'node:text:a')
    if (!source || source.kind !== 'text') throw new Error('missing text source')
    source.text.segments[0].end = 2.0005

    const resolved = resolveTextRenderInput(tree, {
      kind: 'trackObject',
      id: 'node:trackObject:text_a',
      displayName: 'Text A',
    })

    expect(resolved.phrases.find(phrase => phrase.text === 'こえ')?.end).toBe(2)
  })
})

function makeTextTree(): ProjectObjectTree {
  const tree = createEmptyProjectObjectTree()
  const tracksRoot = tree.root.children.find(child => child.id === TOP_LEVEL_IDS.tracks)
  const trackSourcesRoot = tree.root.children.find(child => child.id === TOP_LEVEL_IDS.trackSources)
  if (!tracksRoot || tracksRoot.kind !== 'folder' || !trackSourcesRoot || trackSourcesRoot.kind !== 'folder') {
    throw new Error('missing fixture roots')
  }

  const textA: TextObjectNode = {
    id: 'node:text:a',
    kind: 'text',
    name: 'Text A',
    text: {
      sourceAudioObjectId: null,
      segments: [
        { start: 1, kana: 'こえ', romaji: 'ko e' },
        { start: 0, kana: 'きみの', romaji: 'ki mi no' },
      ],
    },
  }
  const textB: TextObjectNode = {
    id: 'node:text:b',
    kind: 'text',
    name: 'Text B',
    text: {
      sourceAudioObjectId: null,
      segments: [
        { start: 0, kana: 'とおく', romaji: 'to o ku' },
      ],
    },
  }
  trackSourcesRoot.children.push(textA, textB)

  const trackFolder: TrackFolderNode = {
    id: 'node:trackFolder:text',
    kind: 'trackFolder',
    name: 'Text Track',
    trackFolder: { trackType: 'text' },
    children: [
      trackObject('node:trackObject:text_a', 'node:text:a', 4, 6),
      trackObject('node:trackObject:text_b', 'node:text:b', 7, 9),
    ],
  }
  tracksRoot.children.push(trackFolder)
  return tree
}

function trackObject(id: string, sourceObjectId: string, timelineStart: number, timelineEnd: number): TrackObjectNode {
  return {
    id,
    kind: 'trackObject',
    name: id,
    trackObject: {
      contentType: 'text',
      sourceObjectId,
      timelineStart,
      timelineEnd,
      ignored: false,
    },
  }
}

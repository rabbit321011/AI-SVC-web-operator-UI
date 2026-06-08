import { describe, expect, it } from 'vitest'
import type { ProjectObjectTree, TextObjectNode, TrackFolderNode, TrackObjectNode } from './types'
import { createEmptyProjectObjectTree, createGroupObject, normalizeSvsText, resolveTextRenderInput, TOP_LEVEL_IDS } from './index'

describe('SVS text render resolver', () => {
  it('normalizes manual SVS text by removing spaces and converting punctuation to separators', () => {
    expect(normalizeSvsText(' き み の、こえ!  ')).toBe('きみの|こえ')
  })

  it('normalizes whitespace and punctuation-only SVS text to empty', () => {
    expect(normalizeSvsText('  、。 !  ')).toBe('')
  })

  it('resolves a text TrackObject by segment start order', () => {
    const tree = makeTextTree()
    const resolved = resolveTextRenderInput(tree, {
      kind: 'trackObject',
      id: 'node:trackObject:text_a',
      displayName: 'Text A',
    })

    expect(resolved.text).toBe('きみのこえ')
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
    expect(resolved.sourceStart).toBe(4)
    expect(resolved.sourceEnd).toBe(9)
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

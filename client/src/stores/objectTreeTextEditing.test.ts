import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createEmptyProjectObjectTree, TOP_LEVEL_IDS } from '@/object-workbench'
import type { TextObjectNode } from '@/object-workbench'
import { useObjectTreeStore } from './objectTree'

describe('TextObject editing', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('increments the timeline redraw revision for content and timing edits', () => {
    const store = textStore()

    expect(store.updateTextSegmentContent('node:text:a', 'textseg:a', { kana: 'そら', romaji: 'so ra' }).ok).toBe(true)
    expect(store.textEditRevision).toBe(1)
    expect(store.textRevision('node:text:a')).toBe(1)
    expect(store.textRevision('node:text:other')).toBe(0)
    expect(textSource(store).text.segments[0]).toMatchObject({ kana: 'そら', romaji: 'so ra' })

    expect(store.updateTextSegmentTiming('node:text:a', 'textseg:a', 0.5, 1.5).ok).toBe(true)
    expect(store.textEditRevision).toBe(2)
    expect(store.textRevision('node:text:a')).toBe(2)
    expect(textSource(store).text.segments[0]).toMatchObject({ start: 0.5, end: 1.5 })
  })

  it('routes additions and deletions through the same redraw revision', () => {
    const store = textStore()
    const added = store.addTextSegment('node:text:a', { start: 2, end: 3, kana: 'あ', romaji: 'a' })

    expect(added.ok).toBe(true)
    expect(added.segmentId).toMatch(/^textseg:/)
    expect(store.textEditRevision).toBe(1)
    expect(store.deleteTextSegment('node:text:a', added.segmentId!).ok).toBe(true)
    expect(store.textEditRevision).toBe(2)
    expect(textSource(store).text.segments).toHaveLength(1)
  })

  it('rejects a timing edit that crosses the next sentence', () => {
    const store = textStore()
    store.addTextSegment('node:text:a', { id: 'textseg:b', start: 2, end: 3, kana: 'あ', romaji: 'a' })

    expect(store.updateTextSegmentTiming('node:text:a', 'textseg:a', 0, 2.5)).toEqual({
      ok: false,
      reason: '句子时间范围不能与相邻句重叠',
    })
    expect(textSource(store).text.segments[0]).toMatchObject({ start: 0, end: 1 })
  })
})

function textStore() {
  const store = useObjectTreeStore()
  const tree = createEmptyProjectObjectTree()
  const folder = tree.root.children.find(node => node.id === TOP_LEVEL_IDS.trackSources)
  if (!folder || folder.kind !== 'folder') throw new Error('missing track sources')
  folder.children.push({
    id: 'node:text:a',
    kind: 'text',
    name: 'Lyrics',
    text: {
      sourceAudioObjectId: null,
      segments: [{ id: 'textseg:a', start: 0, end: 1, kana: 'か', romaji: 'ka' }],
    },
  })
  store.loadObjectTree(tree)
  return store
}

function textSource(store: ReturnType<typeof useObjectTreeStore>): TextObjectNode {
  const source = store.node('node:text:a')
  if (!source || source.kind !== 'text') throw new Error('missing text source')
  return source
}

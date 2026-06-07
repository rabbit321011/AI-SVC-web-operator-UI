import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { AudioSegment } from '@/types'
import { TOP_LEVEL_IDS, createEmptyProjectObjectTree } from '@/object-workbench'
import type { AudioObjectNode, TrackFolderNode } from '@/object-workbench'
import { useObjectTreeStore } from './objectTree'

describe('object tree sync from legacy timeline edits', () => {
  it('syncs TrackFolder name from track rename', () => {
    setActivePinia(createPinia())
    const store = useObjectTreeStore()
    const tree = createEmptyProjectObjectTree()
    tracksFolder(tree).children.push(trackFolder())
    store.loadObjectTree(tree)

    expect(store.syncTrackFolderName('trk_a', 'Renamed').ok).toBe(true)
    expect(store.node('node:trackFolder:trk_a')?.name).toBe('Renamed')
  })

  it('syncs split segment into two TrackObjects and two trackSources', () => {
    setActivePinia(createPinia())
    const store = useObjectTreeStore()
    const tree = createEmptyProjectObjectTree()
    tree.assets.asset_old = { id: 'asset_old', storage: 'projectBlob', blobKey: 'old.wav', sampleRate: 48000, duration: 2, channels: 1 }
    trackSourcesFolder(tree).children.push(audioSource('node:trackSource:audio:seg_old', 'asset_old'))
    const folder = trackFolder()
    folder.children.push({
      id: 'node:trackObject:seg_old',
      kind: 'trackObject',
      name: 'old',
      trackObject: { contentType: 'audio', sourceObjectId: 'node:trackSource:audio:seg_old', timelineStart: 0, timelineEnd: 2, ignored: false },
    })
    tracksFolder(tree).children.push(folder)
    store.loadObjectTree(tree)

    const result = store.syncSplitSegment(segment('seg_old', 0, 2), [segment('seg_a', 0, 1), segment('seg_b', 1, 2)])

    expect(result.ok).toBe(true)
    expect(store.node('node:trackObject:seg_old')).toBeUndefined()
    expect(store.node('node:trackObject:seg_a')?.kind).toBe('trackObject')
    expect(store.node('node:trackObject:seg_b')?.kind).toBe('trackObject')
    expect(store.node('node:trackSource:audio:seg_a')?.kind).toBe('audio')
    expect(store.node('node:trackSource:audio:seg_b')?.kind).toBe('audio')
    expect(store.tree.assets.asset_old).toBeUndefined()
  })
})

function tracksFolder(tree: ReturnType<typeof createEmptyProjectObjectTree>) {
  const node = tree.root.children.find(child => child.id === TOP_LEVEL_IDS.tracks)
  if (!node || node.kind !== 'folder') throw new Error('missing tracks')
  return node
}

function trackSourcesFolder(tree: ReturnType<typeof createEmptyProjectObjectTree>) {
  const node = tree.root.children.find(child => child.id === TOP_LEVEL_IDS.trackSources)
  if (!node || node.kind !== 'folder') throw new Error('missing trackSources')
  return node
}

function trackFolder(): TrackFolderNode {
  return {
    id: 'node:trackFolder:trk_a',
    kind: 'trackFolder',
    name: 'Track',
    trackFolder: { trackType: 'audio' },
    children: [],
    legacy: { trackId: 'trk_a' },
  }
}

function audioSource(id: string, assetId: string): AudioObjectNode {
  return {
    id,
    kind: 'audio',
    name: id,
    audio: { assetId, midiObjectId: null, textObjectId: null },
  }
}

function segment(id: string, timelineStart: number, timelineEnd: number): AudioSegment {
  return {
    id,
    trackId: 'trk_a',
    sourceFile: 'old.wav',
    srcStartSample: timelineStart * 48000,
    srcEndSample: timelineEnd * 48000,
    timelineStart,
    timelineEnd,
    f0Data: null,
    f0Extracted: false,
    color: '#58a6ff',
    ignored: false,
  }
}

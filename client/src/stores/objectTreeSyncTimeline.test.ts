import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { AudioSegment } from '@/types'
import { TOP_LEVEL_IDS, createEmptyProjectObjectTree } from '@/object-workbench'
import type { AudioObjectNode, GroupObjectNode, TrackFolderNode } from '@/object-workbench'
import { useObjectTreeStore } from './objectTree'
import { useTracksStore } from './tracks'
import { useCompGroupsStore } from './compGroups'

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

  it('syncs legacy track name when renaming TrackFolder from the object tree', () => {
    setActivePinia(createPinia())
    const store = useObjectTreeStore()
    const tracks = useTracksStore()
    const tree = createEmptyProjectObjectTree()
    tracksFolder(tree).children.push(trackFolder())
    tracks.tracks.trk_a = legacyTrack('trk_a', 'Track', [])
    store.loadObjectTree(tree)

    const result = store.renameNode('node:trackFolder:trk_a', 'Left Renamed')

    expect(result.ok).toBe(true)
    expect(store.node('node:trackFolder:trk_a')?.name).toBe('Left Renamed')
    expect(tracks.tracks.trk_a.name).toBe('Left Renamed')
  })

  it('syncs legacy comp group name when renaming GroupObject from the object tree', () => {
    setActivePinia(createPinia())
    const objectTree = useObjectTreeStore()
    const compGroups = useCompGroupsStore()
    objectTree.loadObjectTree(treeWithTwoSegments())
    compGroups.compGroups.cgrp_ab = {
      id: 'cgrp_ab',
      name: 'AB',
      elements: [],
      combinedAudio: null,
      svcResult: null,
      collapsed: false,
      expanded: false,
    }
    const group = objectTree.node('node:group:ab')
    if (group?.kind !== 'group') throw new Error('expected group')
    group.legacy = { compGroupId: 'cgrp_ab' }

    const result = objectTree.renameNode('node:group:ab', 'Group Renamed')

    expect(result.ok).toBe(true)
    expect(objectTree.node('node:group:ab')?.name).toBe('Group Renamed')
    expect(compGroups.compGroups.cgrp_ab.name).toBe('Group Renamed')
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

  it('restores object tree when undoing a split segment', () => {
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
    if (!result.snapshot) throw new Error('missing split snapshot')

    const undo = store.syncUndoSplitSegment(result.snapshot)

    expect(undo.ok).toBe(true)
    expect(store.node('node:trackObject:seg_old')?.kind).toBe('trackObject')
    expect(store.node('node:trackSource:audio:seg_old')?.kind).toBe('audio')
    expect(store.node('node:trackObject:seg_a')).toBeUndefined()
    expect(store.node('node:trackObject:seg_b')).toBeUndefined()
    expect(store.node('node:trackSource:audio:seg_a')).toBeUndefined()
    expect(store.node('node:trackSource:audio:seg_b')).toBeUndefined()
    expect(store.tree.assets.asset_old?.blobKey).toBe('old.wav')
    expect(store.tree.assets['asset:trackSource:seg_a']).toBeUndefined()
    expect(store.tree.assets['asset:trackSource:seg_b']).toBeUndefined()
  })

  it('syncs a pasted timeline track into trackSources and tracks folders', () => {
    setActivePinia(createPinia())
    const objectTree = useObjectTreeStore()
    const tracks = useTracksStore()
    objectTree.loadObjectTree(createEmptyProjectObjectTree())
    tracks.tracks.trk_paste = {
      id: 'trk_paste',
      name: '粘贴 1',
      color: '#58a6ff',
      segments: ['seg_a', 'seg_b'],
      sourceFile: 'voice.wav',
      sampleRate: 48000,
      totalSamples: 96000,
      f0Cache: null,
      f0Pending: 0,
      f0Total: 0,
      collapsed: false,
      muted: false,
      solo: false,
      volume: 1,
      ignored: false,
      boundCompGroupId: null,
    }

    const result = objectTree.syncPastedTrack('trk_paste', [
      segment('seg_b', 2, 3),
      segment('seg_a', 0, 1),
    ])

    expect(result.ok).toBe(true)
    const trackFolder = objectTree.node('node:trackFolder:trk_paste')
    expect(trackFolder?.kind).toBe('trackFolder')
    if (trackFolder?.kind !== 'trackFolder') throw new Error('expected track folder')
    expect(trackFolder.children.map(child => child.id)).toEqual(['node:trackObject:seg_a', 'node:trackObject:seg_b'])
    expect(objectTree.node('node:trackSource:audio:seg_a')?.kind).toBe('audio')
    expect(objectTree.node('node:trackSource:audio:seg_b')?.kind).toBe('audio')
    expect(objectTree.tree.assets['asset:trackSource:seg_a']?.blobKey).toBe('old.wav')
    expect(objectTree.tree.assets['asset:trackSource:seg_b']?.blobKey).toBe('old.wav')
  })

  it('syncs moved segment timing and target TrackFolder', () => {
    setActivePinia(createPinia())
    const objectTree = useObjectTreeStore()
    const tracks = useTracksStore()
    const tree = treeWithTwoSegments()
    objectTree.loadObjectTree(tree)
    tracks.tracks.trk_b = legacyTrack('trk_b', 'Target', [])

    const moved = { ...segment('seg_a', 4, 6), trackId: 'trk_b' }
    const result = objectTree.syncMovedSegment(moved)

    expect(result.ok).toBe(true)
    const trackObject = objectTree.node('node:trackObject:seg_a')
    expect(trackObject?.kind).toBe('trackObject')
    if (trackObject?.kind !== 'trackObject') throw new Error('expected track object')
    expect(trackObject.trackObject.timelineStart).toBe(4)
    expect(trackObject.trackObject.timelineEnd).toBe(6)
    expect(trackObject.legacy?.trackId).toBe('trk_b')

    const targetFolder = objectTree.node('node:trackFolder:trk_b')
    expect(targetFolder?.kind).toBe('trackFolder')
    if (targetFolder?.kind !== 'trackFolder') throw new Error('expected target folder')
    expect(targetFolder.children.map(child => child.id)).toEqual(['node:trackObject:seg_a'])
  })

  it('syncs deleted segment by removing TrackObject, source, asset, and group reference', () => {
    setActivePinia(createPinia())
    const objectTree = useObjectTreeStore()
    objectTree.loadObjectTree(treeWithTwoSegments())

    const result = objectTree.syncDeletedSegment(segment('seg_a', 0, 1))

    expect(result.ok).toBe(true)
    expect(objectTree.node('node:trackObject:seg_a')).toBeUndefined()
    expect(objectTree.node('node:trackSource:audio:seg_a')).toBeUndefined()
    expect(objectTree.tree.assets.asset_seg_a).toBeUndefined()
    const group = objectTree.node('node:group:ab')
    expect(group?.kind).toBe('group')
    if (group?.kind !== 'group') throw new Error('expected group')
    expect(group.group.trackObjectIds).toEqual(['node:trackObject:seg_b'])
  })

  it('deletes a left-tree TrackObject from timeline, trackSources, assets, and groups', () => {
    setActivePinia(createPinia())
    const objectTree = useObjectTreeStore()
    const tracks = useTracksStore()
    const compGroups = useCompGroupsStore()
    objectTree.loadObjectTree(treeWithTwoSegments())
    seedLegacyTimeline(tracks)
    compGroups.compGroups.cgrp_ab = legacyCompGroup(['seg_a', 'seg_b'])
    compGroups.compGroupOrder.push('cgrp_ab')
    const group = objectTree.node('node:group:ab')
    if (group?.kind !== 'group') throw new Error('expected group')
    group.legacy = { compGroupId: 'cgrp_ab' }

    const result = objectTree.deleteNode('node:trackObject:seg_a')

    expect(result.ok).toBe(true)
    expect(tracks.segmentsMap.seg_a).toBeUndefined()
    expect(tracks.tracks.trk_a.segments).toEqual(['seg_b'])
    expect(objectTree.node('node:trackObject:seg_a')).toBeUndefined()
    expect(objectTree.node('node:trackSource:audio:seg_a')).toBeUndefined()
    expect(objectTree.tree.assets.asset_seg_a).toBeUndefined()
    expect(group.group.trackObjectIds).toEqual(['node:trackObject:seg_b'])
    expect(compGroups.compGroups.cgrp_ab.elements.map(element => element.id)).toEqual(['seg_b'])
  })

  it('deletes a left-tree TrackFolder from timeline, child TrackObjects, sources, and legacy groups', () => {
    setActivePinia(createPinia())
    const objectTree = useObjectTreeStore()
    const tracks = useTracksStore()
    const compGroups = useCompGroupsStore()
    objectTree.loadObjectTree(treeWithTwoSegments())
    seedLegacyTimeline(tracks)
    compGroups.compGroups.cgrp_ab = legacyCompGroup(['seg_a', 'seg_b'], ['trk_a'])
    compGroups.compGroupOrder.push('cgrp_ab')
    const group = objectTree.node('node:group:ab')
    if (group?.kind !== 'group') throw new Error('expected group')
    group.legacy = { compGroupId: 'cgrp_ab' }

    const result = objectTree.deleteNode('node:trackFolder:trk_a')

    expect(result.ok).toBe(true)
    expect(tracks.tracks.trk_a).toBeUndefined()
    expect(tracks.segmentsMap.seg_a).toBeUndefined()
    expect(tracks.segmentsMap.seg_b).toBeUndefined()
    expect(objectTree.node('node:trackFolder:trk_a')).toBeUndefined()
    expect(objectTree.node('node:trackObject:seg_a')).toBeUndefined()
    expect(objectTree.node('node:trackObject:seg_b')).toBeUndefined()
    expect(objectTree.node('node:trackSource:audio:seg_a')).toBeUndefined()
    expect(objectTree.node('node:trackSource:audio:seg_b')).toBeUndefined()
    expect(objectTree.node('node:group:ab')).toBeUndefined()
    expect(compGroups.compGroups.cgrp_ab).toBeUndefined()
  })

  it('turns deletion of a referenced trackSource into semantic TrackObject deletion', () => {
    setActivePinia(createPinia())
    const objectTree = useObjectTreeStore()
    const tracks = useTracksStore()
    objectTree.loadObjectTree(treeWithTwoSegments())
    seedLegacyTimeline(tracks)

    const result = objectTree.deleteNode('node:trackSource:audio:seg_a')

    expect(result.ok).toBe(true)
    expect(tracks.segmentsMap.seg_a).toBeUndefined()
    expect(tracks.tracks.trk_a.segments).toEqual(['seg_b'])
    expect(objectTree.node('node:trackObject:seg_a')).toBeUndefined()
    expect(objectTree.node('node:trackSource:audio:seg_a')).toBeUndefined()
    expect(objectTree.tree.assets.asset_seg_a).toBeUndefined()
  })

  it('deletes a GroupObject from the object tree and legacy CompGroup store', () => {
    setActivePinia(createPinia())
    const objectTree = useObjectTreeStore()
    const compGroups = useCompGroupsStore()
    objectTree.loadObjectTree(treeWithTwoSegments())
    compGroups.compGroups.cgrp_ab = legacyCompGroup(['seg_a', 'seg_b'])
    compGroups.compGroupOrder.push('cgrp_ab')
    const group = objectTree.node('node:group:ab')
    if (group?.kind !== 'group') throw new Error('expected group')
    group.legacy = { compGroupId: 'cgrp_ab' }

    const result = objectTree.deleteNode('node:group:ab')

    expect(result.ok).toBe(true)
    expect(objectTree.node('node:group:ab')).toBeUndefined()
    expect(compGroups.compGroups.cgrp_ab).toBeUndefined()
    expect(compGroups.compGroupOrder).toEqual([])
  })

  it('syncs merged segments by replacing TrackObjects, sources, assets, and group references', () => {
    setActivePinia(createPinia())
    const objectTree = useObjectTreeStore()
    objectTree.loadObjectTree(treeWithTwoSegments())

    const merged = segment('seg_merged', 0, 3)
    const result = objectTree.syncMergedSegments([segment('seg_a', 0, 1), segment('seg_b', 2, 3)], merged)

    expect(result.ok).toBe(true)
    expect(objectTree.node('node:trackObject:seg_a')).toBeUndefined()
    expect(objectTree.node('node:trackObject:seg_b')).toBeUndefined()
    expect(objectTree.node('node:trackObject:seg_merged')?.kind).toBe('trackObject')
    expect(objectTree.node('node:trackSource:audio:seg_merged')?.kind).toBe('audio')
    expect(objectTree.tree.assets.asset_seg_a).toBeUndefined()
    expect(objectTree.tree.assets.asset_seg_b).toBeUndefined()
    expect(objectTree.tree.assets['asset:trackSource:seg_merged']?.blobKey).toBe('old.wav')
    const group = objectTree.node('node:group:ab')
    expect(group?.kind).toBe('group')
    if (group?.kind !== 'group') throw new Error('expected group')
    expect(group.group.trackObjectIds).toEqual(['node:trackObject:seg_merged'])
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

function trackFolderWith(id: string, trackId: string, children: TrackFolderNode['children']): TrackFolderNode {
  return {
    id,
    kind: 'trackFolder',
    name: trackId,
    trackFolder: { trackType: 'audio' },
    children,
    legacy: { trackId },
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

function trackObject(segmentId: string, sourceObjectId: string, timelineStart: number, timelineEnd: number) {
  return {
    id: `node:trackObject:${segmentId}`,
    kind: 'trackObject' as const,
    name: segmentId,
    trackObject: { contentType: 'audio' as const, sourceObjectId, timelineStart, timelineEnd, ignored: false },
    legacy: { segmentId, trackId: 'trk_a' },
  }
}

function groupAb(): GroupObjectNode {
  return {
    id: 'node:group:ab',
    kind: 'group',
    name: 'AB',
    group: {
      mediaType: 'audio',
      trackObjectIds: ['node:trackObject:seg_a', 'node:trackObject:seg_b'],
    },
  }
}

function treeWithTwoSegments() {
  const tree = createEmptyProjectObjectTree()
  tree.assets.asset_seg_a = { id: 'asset_seg_a', storage: 'projectBlob', blobKey: 'a.wav', sampleRate: 48000, duration: 1, channels: 1 }
  tree.assets.asset_seg_b = { id: 'asset_seg_b', storage: 'projectBlob', blobKey: 'b.wav', sampleRate: 48000, duration: 1, channels: 1 }
  trackSourcesFolder(tree).children.push(
    audioSource('node:trackSource:audio:seg_a', 'asset_seg_a'),
    audioSource('node:trackSource:audio:seg_b', 'asset_seg_b'),
  )
  tracksFolder(tree).children.push(trackFolderWith('node:trackFolder:trk_a', 'trk_a', [
    trackObject('seg_a', 'node:trackSource:audio:seg_a', 0, 1),
    trackObject('seg_b', 'node:trackSource:audio:seg_b', 2, 3),
  ]))
  groupsFolder(tree).children.push(groupAb())
  return tree
}

function groupsFolder(tree: ReturnType<typeof createEmptyProjectObjectTree>) {
  const node = tree.root.children.find(child => child.id === TOP_LEVEL_IDS.groups)
  if (!node || node.kind !== 'folder') throw new Error('missing groups')
  return node
}

function legacyTrack(id: string, name: string, segments: string[]) {
  return {
    id,
    name,
    color: '#58a6ff',
    segments,
    sourceFile: 'old.wav',
    sampleRate: 48000,
    totalSamples: 96000,
    f0Cache: null,
    f0Pending: 0,
    f0Total: 0,
    collapsed: false,
    muted: false,
    solo: false,
    volume: 1,
    ignored: false,
    boundCompGroupId: null,
  }
}

function seedLegacyTimeline(tracks: ReturnType<typeof useTracksStore>) {
  tracks.tracks.trk_a = legacyTrack('trk_a', 'Track', ['seg_a', 'seg_b'])
  tracks.trackOrder.splice(0, tracks.trackOrder.length, 'trk_a')
  tracks.segmentsMap.seg_a = segment('seg_a', 0, 1)
  tracks.segmentsMap.seg_b = segment('seg_b', 2, 3)
}

function legacyCompGroup(segmentIds: string[], trackIds: string[] = []) {
  return {
    id: 'cgrp_ab',
    name: 'AB',
    elements: [
      ...segmentIds.map(id => ({ type: 'segment' as const, id, startTime: id === 'seg_a' ? 0 : 2, endTime: id === 'seg_a' ? 1 : 3 })),
      ...trackIds.map(id => ({ type: 'track' as const, id, startTime: 0, endTime: 3 })),
    ],
    combinedAudio: null,
    svcResult: null,
    collapsed: false,
    expanded: false,
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

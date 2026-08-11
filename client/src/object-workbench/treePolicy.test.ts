import { describe, expect, it } from 'vitest'
import {
  TOP_LEVEL_IDS,
  buildNodeIndex,
  canDragIntoTimeline,
  canDropIntoRenderSlot,
  canTransferTreeNode,
  createEmptySynthesisUnit,
  createEmptyProjectObjectTree,
  getProjectArea,
} from './index'
import type { AudioObjectNode, FolderNode, GroupObjectNode, TrackFolderNode, TrackObjectNode } from './types'

describe('object tree boundary policy', () => {
  it('detects project areas by stable uid ancestry', () => {
    const tree = fixtureTree()
    const index = buildNodeIndex(tree.root)

    expect(getProjectArea(index, 'node:workspace:audio')).toBe('workspace')
    expect(getProjectArea(index, 'node:trackSource:audio')).toBe('trackSources')
    expect(getProjectArea(index, 'node:group:a')).toBe('groups')
  })

  it('allows workspace/resource interchange but blocks manual trackSources access', () => {
    const tree = fixtureTree()
    const index = buildNodeIndex(tree.root)

    expect(canTransferTreeNode(index, index.nodes['node:workspace:audio'], index.nodes[TOP_LEVEL_IDS.resource], 'move').ok).toBe(true)
    expect(canTransferTreeNode(index, index.nodes['node:workspace:audio'], index.nodes[TOP_LEVEL_IDS.trackSources], 'copy')).toMatchObject({ ok: false })
    expect(canTransferTreeNode(index, index.nodes['node:trackSource:audio'], index.nodes[TOP_LEVEL_IDS.workspace], 'copy')).toMatchObject({ ok: false })
  })

  it('keeps GroupObject inside groups and out of the timeline', () => {
    const tree = fixtureTree()
    const index = buildNodeIndex(tree.root)
    const group = index.nodes['node:group:a']

    expect(canTransferTreeNode(index, group, index.nodes[TOP_LEVEL_IDS.workspace], 'move')).toMatchObject({ ok: false })
    expect(canTransferTreeNode(index, group, index.nodes[TOP_LEVEL_IDS.groups], 'move').ok).toBe(true)
    expect(canDragIntoTimeline(group, index)).toMatchObject({ ok: false })
    expect(canDropIntoRenderSlot(group).ok).toBe(true)
  })

  it('allows renders to workspace/resource but blocks manual insert into renders', () => {
    const tree = fixtureTree()
    const index = buildNodeIndex(tree.root)

    expect(canTransferTreeNode(index, index.nodes['node:render:audio'], index.nodes[TOP_LEVEL_IDS.workspace], 'copy').ok).toBe(true)
    expect(canTransferTreeNode(index, index.nodes['node:workspace:audio'], index.nodes[TOP_LEVEL_IDS.renders], 'move')).toMatchObject({ ok: false })
  })

  it('enforces TrackObject same-type TrackFolder moves', () => {
    const tree = fixtureTree()
    const index = buildNodeIndex(tree.root)

    expect(canTransferTreeNode(index, index.nodes['node:trackObject:audio'], index.nodes['node:trackFolder:audio'], 'move').ok).toBe(true)
    expect(canTransferTreeNode(index, index.nodes['node:trackObject:audio'], index.nodes['node:trackFolder:text'], 'move')).toMatchObject({ ok: false })
  })

  it('allows ordinary media plus workspace/resource synthesis units into the timeline', () => {
    const tree = fixtureTree()
    const index = buildNodeIndex(tree.root)

    expect(canDragIntoTimeline(index.nodes['node:workspace:audio'], index).ok).toBe(true)
    expect(canDragIntoTimeline(index.nodes['node:trackObject:audio'], index)).toMatchObject({ ok: false })
    expect(canDragIntoTimeline(index.nodes['node:synthesisUnit:a'], index).ok).toBe(true)
    expect(canDropIntoRenderSlot(index.nodes['node:workspace:audio'])).toMatchObject({ ok: false })
  })
})

function fixtureTree() {
  const tree = createEmptyProjectObjectTree()
  folder(TOP_LEVEL_IDS.workspace).children.push(audio('node:workspace:audio', 'asset:workspace'))
  folder(TOP_LEVEL_IDS.workspace).children.push(createEmptySynthesisUnit({
    id: 'node:synthesisUnit:a',
    name: 'Unit A',
    defaultTimelineStart: null,
    guide: {
      assetId: 'asset:guide:a', audioSHA256: 'a'.repeat(64), sampleRate: 44100,
      channels: 1, sampleCount: 2048, duration: 2048 / 44100,
      source: {
        sourceAudioObjectId: 'node:workspace:audio', sourceAssetId: 'asset:workspace',
        effectiveStartSample: 0, effectiveEndSampleExclusive: 2048,
        sourceTimelineStart: null, resolverManifest: 'fixture',
      },
    },
  }))
  folder(TOP_LEVEL_IDS.resource).children.push(audio('node:resource:audio', 'asset:resource'))
  folder(TOP_LEVEL_IDS.trackSources).children.push(audio('node:trackSource:audio', 'asset:trackSource'))
  folder(TOP_LEVEL_IDS.renders).children.push(audio('node:render:audio', 'asset:render'))
  folder(TOP_LEVEL_IDS.groups).children.push(group('node:group:a'))

  const audioTrack = trackFolder('node:trackFolder:audio', 'audio')
  audioTrack.children.push(trackObject('node:trackObject:audio', 'audio'))
  folder(TOP_LEVEL_IDS.tracks).children.push(audioTrack)
  folder(TOP_LEVEL_IDS.tracks).children.push(trackFolder('node:trackFolder:text', 'text'))

  function folder(id: string): FolderNode {
    const node = tree.root.children.find(child => child.id === id)
    if (!node || node.kind !== 'folder') throw new Error(`missing folder ${id}`)
    return node
  }

  return tree
}

function audio(id: string, assetId: string): AudioObjectNode {
  return {
    id,
    kind: 'audio',
    name: id,
    audio: { assetId, midiObjectId: null, textObjectId: null },
  }
}

function group(id: string): GroupObjectNode {
  return {
    id,
    kind: 'group',
    name: id,
    group: { mediaType: 'audio', trackObjectIds: ['node:trackObject:audio'] },
  }
}

function trackFolder(id: string, trackType: 'audio' | 'text'): TrackFolderNode {
  return {
    id,
    kind: 'trackFolder',
    name: id,
    trackFolder: { trackType },
    children: [],
  }
}

function trackObject(id: string, contentType: 'audio' | 'text'): TrackObjectNode {
  return {
    id,
    kind: 'trackObject',
    name: id,
    trackObject: {
      contentType,
      sourceObjectId: 'node:trackSource:audio',
      timelineStart: 0,
      timelineEnd: 1,
      ignored: false,
    },
  }
}

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createEmptyProjectObjectTree, TOP_LEVEL_IDS } from '@/object-workbench'
import { useGlobalResourcesStore } from './globalResources'
import { useObjectTreeStore } from './objectTree'
import { useTracksStore } from './tracks'

describe('global Resource client store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('publishes Resource audio with a collision-safe global blob key', async () => {
    const objectTree = useObjectTreeStore()
    const tracks = useTracksStore()
    const tree = createEmptyProjectObjectTree()
    const resource = tree.root.children.find(node => node.id === TOP_LEVEL_IDS.resource)
    if (!resource || resource.kind !== 'folder') throw new Error('missing Resource folder')
    resource.children.push({
      id: 'node:audio:resource-a', kind: 'audio', name: 'A.wav',
      audio: { assetId: 'asset:resource-a', midiObjectId: null, textObjectId: null },
    })
    tree.assets['asset:resource-a'] = {
      id: 'asset:resource-a', storage: 'projectBlob', blobKey: 'A.wav',
      sampleRate: 44100, duration: 1, channels: 2,
    }
    objectTree.loadObjectTree(tree)
    tracks.sourceBlobs.set('A.wav', new Blob(['audio']))

    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    try {
      const store = useGlobalResourcesStore()
      await store.publish('node:audio:resource-a')
      expect(store.isGlobal('node:audio:resource-a')).toBe(true)
      expect(calls).toHaveLength(2)
      const blobKey = decodeURIComponent(new Headers(calls[0].init?.headers).get('x-blob-key') || '')
      expect(blobKey).toContain('global-resource:node:audio:resource-a:asset:resource-a:A.wav')
      const payload = JSON.parse(String(calls[1].init?.body))
      expect(payload.assets['asset:resource-a'].blobKey).toBe(blobKey)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('publishes a deeply nested audio with its Resource ancestor path', async () => {
    const objectTree = useObjectTreeStore()
    const tracks = useTracksStore()
    const tree = createEmptyProjectObjectTree()
    const resource = tree.root.children.find(node => node.id === TOP_LEVEL_IDS.resource)
    if (!resource || resource.kind !== 'folder') throw new Error('missing Resource folder')
    resource.children.push({
      id: 'node:folder:album', kind: 'folder', name: 'Album', children: [{
        id: 'node:folder:stems', kind: 'folder', name: 'Stems', children: [{
          id: 'node:audio:vocal', kind: 'audio', name: 'Vocal.wav',
          audio: { assetId: 'asset:vocal', midiObjectId: null, textObjectId: null },
        }],
      }],
    })
    resource.children.push({ id: 'node:folder:collection', kind: 'folder', name: 'Collection', children: [] })
    tree.assets['asset:vocal'] = {
      id: 'asset:vocal', storage: 'projectBlob', blobKey: 'Vocal.wav',
      sampleRate: 44100, duration: 1, channels: 2,
    }
    objectTree.loadObjectTree(tree)
    tracks.sourceBlobs.set('Vocal.wav', new Blob(['audio']))

    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    try {
      const store = useGlobalResourcesStore()
      await store.publish('node:audio:vocal')
      expect(calls).toHaveLength(2)
      const payload = JSON.parse(String(calls[1].init?.body))
      expect(payload.node.id).toBe('node:audio:vocal')
      expect(payload.ancestors.map((node: { id: string }) => node.id)).toEqual(['node:folder:album', 'node:folder:stems'])
      expect(payload.assets['asset:vocal'].blobKey).toContain('global-resource:node:audio:vocal:asset:vocal:Vocal.wav')

      expect(objectTree.moveNode('node:folder:album', 'node:folder:collection').ok).toBe(true)
      await store.updatePathsForSubtree('node:folder:album')
      expect(calls).toHaveLength(3)
      expect(calls[2].init?.method).toBe('PATCH')
      const pathPayload = JSON.parse(String(calls[2].init?.body))
      expect(pathPayload.ancestors.map((node: { id: string }) => node.id)).toEqual([
        'node:folder:collection', 'node:folder:album', 'node:folder:stems',
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

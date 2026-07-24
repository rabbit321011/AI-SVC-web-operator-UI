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

  it('publishes audio nested in multiple Resource folders', async () => {
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
      await useGlobalResourcesStore().publish('node:folder:album')
      expect(calls).toHaveLength(2)
      const payload = JSON.parse(String(calls[1].init?.body))
      expect(payload.node.children[0].children[0].id).toBe('node:audio:vocal')
      expect(payload.assets['asset:vocal'].blobKey).toContain('global-resource:node:folder:album:asset:vocal:Vocal.wav')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

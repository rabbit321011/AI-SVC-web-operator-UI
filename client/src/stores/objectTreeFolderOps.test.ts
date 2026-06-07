import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { TOP_LEVEL_IDS, createEmptyProjectObjectTree } from '@/object-workbench'
import { useObjectTreeStore } from './objectTree'
import { useTracksStore } from './tracks'

describe('object tree folder operations and file import', () => {
  it('creates, renames, and deletes folders in workspace', () => {
    setActivePinia(createPinia())
    const store = useObjectTreeStore()
    store.loadObjectTree(createEmptyProjectObjectTree())

    const created = store.createFolder(TOP_LEVEL_IDS.workspace, 'Vocals')
    expect(created.ok).toBe(true)
    expect(store.node(created.id!)?.name).toBe('Vocals')

    expect(store.renameNode(created.id!, 'Refs').ok).toBe(true)
    expect(store.node(created.id!)?.name).toBe('Refs')

    expect(store.deleteNode(created.id!).ok).toBe(true)
    expect(store.node(created.id!)).toBeUndefined()
  })

  it('blocks deleting fixed top-level folders', () => {
    setActivePinia(createPinia())
    const store = useObjectTreeStore()
    store.loadObjectTree(createEmptyProjectObjectTree())

    expect(store.deleteNode(TOP_LEVEL_IDS.workspace)).toMatchObject({ ok: false })
    expect(store.renameNode(TOP_LEVEL_IDS.workspace, 'x')).toMatchObject({ ok: false })
  })

  it('imports browser files into workspace/resource but not renders', async () => {
    setActivePinia(createPinia())
    const store = useObjectTreeStore()
    const tracks = useTracksStore()
    store.loadObjectTree(createEmptyProjectObjectTree())

    const file = new File(['RIFF'], 'voice.wav', { type: 'audio/wav' })
    const result = await store.importFilesToFolder(TOP_LEVEL_IDS.workspace, [file])

    expect(result.ok).toBe(true)
    expect(result.ids).toHaveLength(1)
    expect(store.node(result.ids![0])?.kind).toBe('audio')
    expect(tracks.sourceBlobs.get('voice.wav')).toBe(file)

    const blocked = await store.importFilesToFolder(TOP_LEVEL_IDS.renders, [file])
    expect(blocked).toMatchObject({ ok: false })
  })

  it('deletes imported audio with its asset and blob', async () => {
    setActivePinia(createPinia())
    const store = useObjectTreeStore()
    const tracks = useTracksStore()
    store.loadObjectTree(createEmptyProjectObjectTree())

    const file = new File(['RIFF'], 'delete-me.wav', { type: 'audio/wav' })
    const imported = await store.importFilesToFolder(TOP_LEVEL_IDS.workspace, [file])
    const nodeId = imported.ids![0]
    const node = store.node(nodeId)
    if (node?.kind !== 'audio') throw new Error('expected audio')
    const assetId = node.audio.assetId

    expect(store.deleteNode(nodeId).ok).toBe(true)
    expect(store.node(nodeId)).toBeUndefined()
    expect(store.tree.assets[assetId]).toBeUndefined()
    expect(tracks.sourceBlobs.has('delete-me.wav')).toBe(false)
  })
})

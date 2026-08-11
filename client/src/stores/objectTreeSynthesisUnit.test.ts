import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { TOP_LEVEL_IDS, createEmptyProjectObjectTree, createEmptySynthesisUnit } from '@/object-workbench'
import type { NodeId, SynthesisUnitObjectNode } from '@/object-workbench'
import { useObjectTreeStore } from './objectTree'
import { useTracksStore } from './tracks'
import { useHistoryStore } from './history'

describe('SynthesisUnit object-tree integration', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('copies an AudioObject into an independent Guide-only unit', async () => {
    const objectTree = useObjectTreeStore()
    const tracks = useTracksStore()
    const tree = createEmptyProjectObjectTree()
    const workspace = tree.root.children.find(node => node.id === TOP_LEVEL_IDS.workspace)
    if (!workspace || workspace.kind !== 'folder') throw new Error('missing workspace')
    workspace.children.push({
      id: 'node:audio:guide',
      kind: 'audio',
      name: 'guide.wav',
      audio: { assetId: 'asset:audio:guide', midiObjectId: null, textObjectId: null },
    })
    tree.assets['asset:audio:guide'] = {
      id: 'asset:audio:guide',
      storage: 'projectBlob',
      blobKey: 'guide.wav',
      sampleRate: 44100,
      duration: 3,
      channels: 1,
    }
    objectTree.loadObjectTree(tree)
    tracks.sourceBlobs.set('guide.wav', new Blob(['source']))
    const output = new Blob(['owned-guide'], { type: 'audio/wav' })

    const result = await objectTree.createSynthesisUnitFromAudioObject('node:audio:guide', {
      renderGuide: async () => output,
      hashBlob: async () => 'a'.repeat(64),
      now: '2026-08-10T00:00:00.000Z',
    })

    expect(result.ok).toBe(true)
    const unit = result.unitId ? objectTree.node(result.unitId) : undefined
    expect(unit?.kind).toBe('synthesisUnit')
    if (unit?.kind !== 'synthesisUnit') throw new Error('missing synthesis unit')
    expect(unit.synthesisUnit.frameContract.frameCount).toBe(Math.floor(3 * 44100 / 2048))
    expect(unit.synthesisUnit.segmentTrack.status).toBe('empty')
    expect(unit.synthesisUnit.midiPTokenTrack.status).toBe('empty')
    expect(tracks.sourceBlobs.get(result.guideBlobKey ?? '')).toBe(output)

    expect(objectTree.deleteNode('node:audio:guide')).toEqual({ ok: true })
    expect(objectTree.node(unit.id)?.kind).toBe('synthesisUnit')
    expect(tracks.sourceBlobs.get(result.guideBlobKey ?? '')).toBe(output)
  })

  it('binds a full-Guide follow-latest reference with undo and redo', () => {
    const objectTree = useObjectTreeStore()
    const history = useHistoryStore()
    const tree = createEmptyProjectObjectTree()
    const workspace = tree.root.children.find(node => node.id === TOP_LEVEL_IDS.workspace)
    if (!workspace || workspace.kind !== 'folder') throw new Error('missing workspace')
    workspace.children.push(makeUnit('node:synthesisUnit:a', 'Reference A'))
    workspace.children.push(makeUnit('node:synthesisUnit:b', 'Target B'))
    objectTree.loadObjectTree(tree)

    const before = objectTree.snapshotTree()
    expect(objectTree.bindSynthesisReferenceUnit(
      'node:synthesisUnit:b',
      'node:synthesisUnit:a',
      '2026-08-10T01:00:00.000Z',
    )).toEqual({ ok: true })
    const target = objectTree.node('node:synthesisUnit:b')
    expect(target?.kind).toBe('synthesisUnit')
    if (target?.kind !== 'synthesisUnit') throw new Error('missing target unit')
    expect(target.synthesisUnit.reference).toEqual({
      unitId: 'node:synthesisUnit:a',
      audioSource: 'guide',
      range: 'full-guide',
      revisionPolicy: 'follow-latest',
      boundAt: '2026-08-10T01:00:00.000Z',
    })
    expect(target.synthesisUnit.unitRevision).toBe(1)

    history.push({
      description: '绑定 A 区参考',
      patches: [],
      inversePatches: [],
      objectTree: { kind: 'snapshot', before, after: objectTree.snapshotTree() },
    })
    history.undo()
    const undone = objectTree.node('node:synthesisUnit:b')
    expect(undone?.kind === 'synthesisUnit' ? undone.synthesisUnit.reference : undefined).toBeNull()
    expect(undone?.kind === 'synthesisUnit' ? undone.synthesisUnit.unitRevision : undefined).toBe(0)

    history.redo()
    const redone = objectTree.node('node:synthesisUnit:b')
    expect(redone?.kind === 'synthesisUnit' ? redone.synthesisUnit.reference?.unitId : undefined)
      .toBe('node:synthesisUnit:a')
    expect(objectTree.deleteNode('node:synthesisUnit:a')).toEqual({
      ok: false,
      reason: '该合成单元仍被 1 个 A 区参考绑定',
    })

    expect(objectTree.unbindSynthesisReferenceUnit(
      'node:synthesisUnit:b',
      '2026-08-10T02:00:00.000Z',
    )).toEqual({ ok: true })
    const unbound = objectTree.node('node:synthesisUnit:b')
    expect(unbound?.kind === 'synthesisUnit' ? unbound.synthesisUnit.reference : undefined).toBeNull()
    expect(unbound?.kind === 'synthesisUnit' ? unbound.synthesisUnit.unitRevision : undefined).toBe(2)
  })

  it('rejects self references and transitive cycles', () => {
    const objectTree = useObjectTreeStore()
    const tree = createEmptyProjectObjectTree()
    const workspace = tree.root.children.find(node => node.id === TOP_LEVEL_IDS.workspace)
    if (!workspace || workspace.kind !== 'folder') throw new Error('missing workspace')
    workspace.children.push(makeUnit('node:synthesisUnit:a', 'Unit A'))
    workspace.children.push(makeUnit('node:synthesisUnit:b', 'Unit B'))
    workspace.children.push(makeUnit('node:synthesisUnit:c', 'Unit C'))
    objectTree.loadObjectTree(tree)

    expect(objectTree.bindSynthesisReferenceUnit('node:synthesisUnit:a', 'node:synthesisUnit:a')).toEqual({
      ok: false,
      reason: '合成单元不能绑定自身作为 A 区参考',
    })
    expect(objectTree.bindSynthesisReferenceUnit('node:synthesisUnit:a', 'node:synthesisUnit:b')).toEqual({ ok: true })
    expect(objectTree.bindSynthesisReferenceUnit('node:synthesisUnit:b', 'node:synthesisUnit:c')).toEqual({ ok: true })
    expect(objectTree.canBindSynthesisReferenceUnit('node:synthesisUnit:c', 'node:synthesisUnit:a')).toEqual({
      ok: false,
      reason: '该绑定会形成合成单元循环引用',
    })
    expect(objectTree.bindSynthesisReferenceUnit('node:synthesisUnit:c', 'node:synthesisUnit:a')).toEqual({
      ok: false,
      reason: '该绑定会形成合成单元循环引用',
    })
  })

  it('keeps completed Takes immutable from later unit revisions', async () => {
    const objectTree = useObjectTreeStore()
    const tracks = useTracksStore()
    const tree = createEmptyProjectObjectTree()
    const workspace = tree.root.children.find(node => node.id === TOP_LEVEL_IDS.workspace)
    if (!workspace || workspace.kind !== 'folder') throw new Error('missing workspace')
    workspace.children.push(makeUnit('node:synthesisUnit:a', 'Unit A'))
    workspace.children.push(makeUnit('node:synthesisUnit:b', 'Unit B'))
    objectTree.loadObjectTree(tree)

    expect(objectTree.queueSynthesisTake('node:synthesisUnit:b', {
      id: 'take:test', name: 'Take 1', status: 'running',
      targetUnitRevision: 2, referenceUnitId: 'node:synthesisUnit:a', referenceUnitRevision: 3,
      presetId: 'V5P_40K_EMA', checkpointSHA256: 'a'.repeat(64), vaeSHA256: 'b'.repeat(64),
      adapterSHA256: 'c'.repeat(64), seed: 42, createdAt: '2026-08-11T00:00:00.000Z',
    })).toEqual({ ok: true })
    const blob = monoPcm16Wav(2048)
    expect(await objectTree.completeSynthesisTake('node:synthesisUnit:b', 'take:test', blob, {
      outputSHA256: 'd'.repeat(64), snapshotSHA256: 'e'.repeat(64), sampleRate: 44100,
      sampleCount: 2048, duration: 2048 / 44100, checkpointSHA256: 'a'.repeat(64),
      vaeSHA256: 'b'.repeat(64), adapterSHA256: 'c'.repeat(64), seed: 42,
    }, '2026-08-11T00:01:00.000Z')).toEqual({ ok: true })

    const unit = objectTree.node('node:synthesisUnit:b')
    if (!unit || unit.kind !== 'synthesisUnit') throw new Error('missing unit')
    const take = unit.synthesisUnit.takes[0]
    expect(take.status).toBe('ready')
    expect(take.targetUnitRevision).toBe(2)
    expect(take.referenceUnitRevision).toBe(3)
    expect(take.snapshotSHA256).toBe('e'.repeat(64))
    expect(take.outputAssetId && objectTree.tree.assets[take.outputAssetId]?.sha256).toBe('d'.repeat(64))
    expect(take.outputAssetId && tracks.sourceBlobs.get(objectTree.tree.assets[take.outputAssetId].blobKey ?? '')).toBe(blob)
    expect(await objectTree.completeSynthesisTake('node:synthesisUnit:b', 'take:test', blob, {
      outputSHA256: 'f'.repeat(64), snapshotSHA256: 'e'.repeat(64), sampleRate: 44100,
      sampleCount: 2048, duration: 2048 / 44100, checkpointSHA256: 'a'.repeat(64),
      vaeSHA256: 'b'.repeat(64), adapterSHA256: 'c'.repeat(64), seed: 42,
    })).toEqual({ ok: false, reason: '已完成 Take 不可覆盖' })
  })
})

function makeUnit(id: NodeId, name: string): SynthesisUnitObjectNode {
  return createEmptySynthesisUnit({
    id,
    name,
    now: '2026-08-10T00:00:00.000Z',
    defaultTimelineStart: null,
    guide: {
      assetId: `asset:${id}`,
      audioSHA256: id.padEnd(64, '0').slice(0, 64),
      sampleRate: 44100,
      channels: 1,
      sampleCount: 4096,
      duration: 4096 / 44100,
      source: {
        sourceAudioObjectId: 'node:audio:source',
        sourceAssetId: 'asset:audio:source',
        effectiveStartSample: 0,
        effectiveEndSampleExclusive: 4096,
        sourceTimelineStart: null,
        resolverManifest: 'test',
      },
    },
  })
}

function monoPcm16Wav(sampleCount: number): Blob {
  const buffer = new ArrayBuffer(44 + sampleCount * 2)
  const view = new DataView(buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + sampleCount * 2, true)
  writeAscii(view, 8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 44100, true)
  view.setUint32(28, 88200, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, sampleCount * 2, true)
  return new Blob([buffer], { type: 'audio/wav' })
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index))
}

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { GlobalResourceRepository } from './global-resource.service'

test('global resources copy into projects and survive global removal', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aisvc-global-resource-'))
  try {
    const projectDir = path.join(root, 'projects', 'demo')
    fs.mkdirSync(path.join(projectDir, 'blobs'), { recursive: true })
    fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify(projectFixture(), null, 2))
    const repo = new GlobalResourceRepository(root)
    repo.writeStagedBlob('node:resource:a', 'resource-a.wav', Buffer.from('audio-data'))
    repo.publish({
      id: 'node:resource:a',
      name: 'Resource A',
      node: { id: 'node:resource:a', kind: 'audio', name: 'Resource A', audio: { assetId: 'asset:resource:a', midiObjectId: null, textObjectId: null } },
      assets: { 'asset:resource:a': { id: 'asset:resource:a', storage: 'projectBlob', blobKey: 'resource-a.wav', sampleRate: 44100, duration: 1, channels: 2 } },
      blobKeys: ['resource-a.wav'],
    })

    assert.deepEqual(repo.syncProject('demo').added, ['node:resource:a'])
    assert.deepEqual(repo.syncProject('demo').added, [])
    const synced = JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf-8'))
    assert.equal(synced.objectTree.root.children[0].children[0].id, 'node:resource:a')
    const manifest = JSON.parse(fs.readFileSync(path.join(projectDir, 'blobs', 'manifest.json'), 'utf-8'))
    const copiedFile = Object.keys(manifest)[0]
    assert.equal(fs.readFileSync(path.join(projectDir, 'blobs', copiedFile), 'utf-8'), 'audio-data')

    assert.equal(repo.remove('node:resource:a'), true)
    assert.equal(repo.list().length, 0)
    assert.equal(fs.existsSync(path.join(projectDir, 'blobs', copiedFile)), true)
    assert.equal(JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf-8')).objectTree.root.children[0].children[0].id, 'node:resource:a')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('legacy projects without an object tree still open before migration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aisvc-global-resource-legacy-'))
  try {
    const projectDir = path.join(root, 'projects', 'legacy')
    fs.mkdirSync(projectDir, { recursive: true })
    fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({ id: 'legacy', name: 'legacy' }))
    const repo = new GlobalResourceRepository(root)
    assert.deepEqual(repo.syncProject('legacy'), { added: [], globalIds: [] })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('sync refreshes an existing leaf and restores its missing project blob', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aisvc-global-resource-refresh-'))
  try {
    const project: any = projectFixture()
    project.objectTree.root.children[0].children.push({
      id: 'node:resource:a',
      kind: 'audio',
      name: 'Old Resource',
      audio: { assetId: 'asset:resource:a', midiObjectId: null, textObjectId: null },
    })
    project.objectTree.assets['asset:resource:a'] = {
      id: 'asset:resource:a', storage: 'projectBlob', blobKey: 'resource-a.wav',
    }
    const projectDir = path.join(root, 'projects', 'refresh')
    fs.mkdirSync(projectDir, { recursive: true })
    fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify(project, null, 2))

    const repo = new GlobalResourceRepository(root)
    repo.writeStagedBlob('node:resource:a', 'resource-a.wav', Buffer.from('fresh-audio'))
    repo.publish({
      id: 'node:resource:a',
      name: 'New Resource',
      node: { id: 'node:resource:a', kind: 'audio', name: 'New Resource', audio: { assetId: 'asset:resource:a', midiObjectId: null, textObjectId: null } },
      assets: { 'asset:resource:a': { id: 'asset:resource:a', storage: 'projectBlob', blobKey: 'resource-a.wav' } },
      blobKeys: ['resource-a.wav'],
    })

    assert.deepEqual(repo.syncProject('refresh').added, ['node:resource:a'])
    const synced = JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf-8'))
    assert.equal(synced.objectTree.root.children[0].children[0].name, 'New Resource')
    const manifest = JSON.parse(fs.readFileSync(path.join(projectDir, 'blobs', 'manifest.json'), 'utf-8'))
    const blobFile = Object.keys(manifest).find(file => manifest[file] === 'resource-a.wav')
    assert.ok(blobFile)
    assert.equal(fs.readFileSync(path.join(projectDir, 'blobs', blobFile), 'utf-8'), 'fresh-audio')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('nested global Resource folders keep their full directory tree when synced', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aisvc-global-resource-nested-'))
  try {
    const projectDir = path.join(root, 'projects', 'nested')
    fs.mkdirSync(projectDir, { recursive: true })
    fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify(projectFixture(), null, 2))
    const repo = new GlobalResourceRepository(root)
    repo.writeStagedBlob('node:folder:album', 'nested-vocal.wav', Buffer.from('nested-audio'))
    repo.publish({
      id: 'node:folder:album',
      name: 'Album',
      node: {
        id: 'node:folder:album', kind: 'folder', name: 'Album', children: [{
          id: 'node:folder:stems', kind: 'folder', name: 'Stems', children: [{
            id: 'node:audio:vocal', kind: 'audio', name: 'Vocal.wav',
            audio: { assetId: 'asset:vocal', midiObjectId: null, textObjectId: null },
          }],
        }],
      },
      assets: { 'asset:vocal': { id: 'asset:vocal', storage: 'projectBlob', blobKey: 'nested-vocal.wav' } },
      blobKeys: ['nested-vocal.wav'],
    })

    assert.deepEqual(repo.syncProject('nested').added, ['node:folder:album'])
    const synced = JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf-8'))
    const album = synced.objectTree.root.children[0].children[0]
    assert.equal(album.children[0].children[0].id, 'node:audio:vocal')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('individually published audio keeps and reuses its ancestor folder path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aisvc-global-resource-path-'))
  try {
    const projectDir = path.join(root, 'projects', 'paths')
    fs.mkdirSync(projectDir, { recursive: true })
    fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify(projectFixture(), null, 2))
    const repo = new GlobalResourceRepository(root)
    const ancestors = [
      { id: 'node:folder:album', kind: 'folder', name: 'Album', children: [] },
      { id: 'node:folder:stems', kind: 'folder', name: 'Stems', children: [] },
    ]
    for (const [id, name] of [['node:audio:vocal', 'Vocal.wav'], ['node:audio:instrumental', 'Instrumental.wav']]) {
      const key = `${id}.wav`
      const assetId = `asset:${id}`
      repo.writeStagedBlob(id, key, Buffer.from(name))
      repo.publish({
        id,
        name,
        ancestors,
        node: { id, kind: 'audio', name, audio: { assetId, midiObjectId: null, textObjectId: null } },
        assets: { [assetId]: { id: assetId, storage: 'projectBlob', blobKey: key } },
        blobKeys: [key],
      })
    }
    repo.publish({
      id: 'node:folder:album',
      name: 'Album',
      node: { id: 'node:folder:album', kind: 'folder', name: 'Album', children: [{ id: 'node:folder:notes', kind: 'folder', name: 'Notes', children: [] }] },
      assets: {},
      blobKeys: [],
    })

    assert.deepEqual(repo.syncProject('paths').added, ['node:audio:vocal', 'node:audio:instrumental', 'node:folder:album'])
    assert.deepEqual(repo.syncProject('paths').added, [])
    const synced = JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf-8'))
    const album = synced.objectTree.root.children[0].children[0]
    assert.equal(album.id, 'node:folder:album')
    assert.deepEqual(album.children.map((node: any) => node.id), ['node:folder:stems', 'node:folder:notes'])
    assert.deepEqual(album.children[0].children.map((node: any) => node.id), ['node:audio:vocal', 'node:audio:instrumental'])
    const resourceBeforeMove = synced.objectTree.root.children[0]
    resourceBeforeMove.children.push(structuredClone(album.children[0].children[0]))
    fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify(synced, null, 2))
    assert.equal(repo.updateAncestors('node:audio:vocal', [{ id: 'node:folder:moved', kind: 'folder', name: 'Moved', children: [] }]), true)
    assert.deepEqual(repo.list().find(entry => entry.id === 'node:audio:vocal')?.ancestors?.map(node => node.id), ['node:folder:moved'])
    assert.deepEqual(repo.syncProject('paths').added, ['node:audio:vocal'])
    const resynced = JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf-8'))
    const resource = resynced.objectTree.root.children[0]
    const moved = resource.children.find((node: any) => node.id === 'node:folder:moved')
    assert.equal(moved.children[0].id, 'node:audio:vocal')
    assert.equal(resource.children.some((node: any) => node.id === 'node:audio:vocal'), false)
    assert.equal(countNodeId(resource, 'node:audio:vocal'), 1)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('legacy global audio infers its missing path from an existing project tree', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aisvc-global-resource-migrate-'))
  try {
    const origin = projectFixture()
    const originResource = origin.objectTree.root.children[0]
    const originChildren = originResource.children as any[]
    originChildren.push({
      id: 'node:folder:album', kind: 'folder', name: 'Album', children: [{
        id: 'node:folder:stems', kind: 'folder', name: 'Stems', children: [{
          id: 'node:audio:legacy', kind: 'audio', name: 'Legacy.wav',
          audio: { assetId: 'asset:legacy', midiObjectId: null, textObjectId: null },
        }],
      }],
    })
    for (const [name, project] of [['origin', origin], ['target', projectFixture()]] as const) {
      const dir = path.join(root, 'projects', name)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(project, null, 2))
    }
    const repo = new GlobalResourceRepository(root)
    repo.writeStagedBlob('node:audio:legacy', 'legacy.wav', Buffer.from('legacy'))
    repo.publish({
      id: 'node:audio:legacy',
      name: 'Legacy.wav',
      node: { id: 'node:audio:legacy', kind: 'audio', name: 'Legacy.wav', audio: { assetId: 'asset:legacy', midiObjectId: null, textObjectId: null } },
      assets: { 'asset:legacy': { id: 'asset:legacy', storage: 'projectBlob', blobKey: 'legacy.wav' } },
      blobKeys: ['legacy.wav'],
    })

    assert.deepEqual(repo.syncProject('target').added, ['node:audio:legacy'])
    const synced = JSON.parse(fs.readFileSync(path.join(root, 'projects', 'target', 'project.json'), 'utf-8'))
    assert.equal(synced.objectTree.root.children[0].children[0].children[0].children[0].id, 'node:audio:legacy')
    assert.deepEqual(repo.list()[0].ancestors?.map(node => node.id), ['node:folder:album', 'node:folder:stems'])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

function projectFixture() {
  return {
    id: 'project:a', name: 'demo', version: '1.0.0', modifiedAt: '',
    objectTree: {
      schemaVersion: 'object-workbench.v1',
      root: { id: 'project:/', kind: 'folder', name: 'project', children: [{ id: 'project:/resource', kind: 'folder', name: 'resource', children: [] }] },
      assets: {},
    },
  }
}

function countNodeId(node: any, id: string): number {
  return (node?.id === id ? 1 : 0) + (Array.isArray(node?.children) ? node.children.reduce((sum: number, child: any) => sum + countNodeId(child, id), 0) : 0)
}

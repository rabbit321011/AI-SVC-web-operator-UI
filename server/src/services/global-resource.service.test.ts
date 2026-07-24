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

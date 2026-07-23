import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { resolveSofaRuntime } from './whisper.service'

test('Japanese SOFA runtime rejects explicit paths that do not contain the exact resources', () => {
  assert.throws(
    () => resolveSofaRuntime({
      AISVC_SOFA_PYTHON: 'Z:/missing/sofa/python.exe',
      AISVC_SOFA_REPO: 'Z:/missing/Voicebank2DiffSinger-main',
      AISVC_SOFA_JPN_TEST2_PLUS_CKPT: 'Z:/missing/JPN_Test2_Plus.ckpt',
    }),
    /SOFA Python not found/,
  )
})

test('Japanese SOFA runtime accepts the Voicebank2DiffSinger JPN_Test2_Plus layout', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aisvc-sofa-runtime-'))
  try {
    const python = path.join(tempDir, 'python.exe')
    const repo = path.join(tempDir, 'Voicebank2DiffSinger-main')
    const checkpoint = path.join(tempDir, 'JPN_Test2_Plus.ckpt')
    fs.mkdirSync(path.join(repo, 'src', 'SOFA'), { recursive: true })
    fs.writeFileSync(python, '')
    fs.writeFileSync(checkpoint, '')

    assert.deepEqual(resolveSofaRuntime({
      AISVC_SOFA_PYTHON: python,
      AISVC_SOFA_REPO: repo,
      AISVC_SOFA_JPN_TEST2_PLUS_CKPT: checkpoint,
    }), { python, repo, checkpoint })
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

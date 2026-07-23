import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildSvsArgs, type SvsRequest } from './svs.service'

test('buildSvsArgs writes the AB timed phrase manifest and passes the VAE explicitly', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aisvc-svs-t1-'))
  try {
    const request = fixture(path.join(tempDir, 'out.wav'))
    const args = buildSvsArgs(request)
    const manifestPath = args[args.indexOf('--t1_manifest') + 1]

    assert.equal(args[args.indexOf('--model_id') + 1], 'plus_ja_sft_v4c step24k')
    assert.equal(args[args.indexOf('--vae_ckpt') + 1], request.vaeCheckpoint)
    assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath, 'utf-8')), {
      schema: 'yingmusic.svs-t1.v1',
      refPhrases: request.refPhrases,
      targetPhrases: request.targetPhrases,
    })
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('V4fg never falls back to an unbound VAE', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aisvc-svs-t1-'))
  try {
    const output = path.join(tempDir, 'out.wav')
    assert.throws(
      () => buildSvsArgs({
        ...fixture(output),
        checkpoint: 'E:/MyProject/重要模型保存/V4fg_10k/step_010000.pt',
        vaeCheckpoint: 'ckpts/stable_audio_2_0_vae_20hz_official.ckpt',
      }),
      /requires the 285k online VAE/,
    )
    assert.equal(fs.existsSync(path.join(tempDir, 'out.t1.json')), false)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('explicit checkpoints cannot bypass preset binding by changing their path', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aisvc-svs-t1-'))
  try {
    assert.throws(
      () => buildSvsArgs({
        ...fixture(path.join(tempDir, 'out.wav')),
        checkpoint: 'models/renamed-step_010000.pt',
      }),
      /must match a configured model preset/,
    )
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('dry-run args validate T1 input without writing a manifest', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aisvc-svs-t1-'))
  try {
    const output = path.join(tempDir, 'out.wav')
    const args = buildSvsArgs(fixture(output), { writeManifest: false })
    const manifestPath = args[args.indexOf('--t1_manifest') + 1]

    assert.equal(manifestPath, path.join(tempDir, 'out.t1.json'))
    assert.equal(fs.existsSync(manifestPath), false)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

function fixture(output: string): SvsRequest {
  return {
    refAudio: 'ref.wav',
    melodyAudio: 'melody.wav',
    refPhrases: [{ start: 0, end: 0.5, text: 'あ' }],
    targetPhrases: [{ start: 0.25, end: 0.75, text: 'い' }],
    output,
    checkpoint: 'ckpts/plus_ja_sft_v4c/step_024000.pt',
    vaeCheckpoint: 'ckpts/stable_audio_2_0_vae_20hz_official.ckpt',
  }
}

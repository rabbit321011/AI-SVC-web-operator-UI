import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildSvsArgs, resolveSvsEngine, type SvsRequest } from './svs.service'
import { verifyV4hResources, type V4hRequest } from './v4h.service'

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

test('V4vfg presets inherit the same 285k VAE binding', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aisvc-svs-t1-'))
  try {
    assert.throws(
      () => buildSvsArgs({
        ...fixture(path.join(tempDir, 'out.wav')),
        checkpoint: 'E:/MyProject/重要模型保存/V4vfg/step_010000.pt',
        vaeCheckpoint: 'ckpts/stable_audio_2_0_vae_20hz_official.ckpt',
      }),
      /V4vfg_10k requires the 285k online VAE/,
    )
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

test('all V4H presets are bound to the phone/PUL engine and their training VAE', () => {
  const requests = [
    v4hFixture(),
    v4hFixture({
      modelId: 'V4H_30k',
      checkpoint: 'E:/MyProject/重要模型保存/V4H_30k/step_030000_ema_inference.pt',
    }),
    v4hFixture({
      modelId: 'V4Hg_10k',
      checkpoint: 'E:/MyProject/重要模型保存/V4Hg_10k/step_010000_ema_inference.pt',
      vaeCheckpoint: 'E:/AIscene/YingMusic_Singer_Plus/ckpts/autoencoder_285k.ckpt',
    }),
  ]
  for (const request of requests) {
    assert.equal(resolveSvsEngine(request), 'v4h_phone_pul')
    assert.throws(() => buildSvsArgs(request), /phone\/PUL inference engine/)
    assert.doesNotThrow(() => verifyV4hResources(request))
  }
  assert.throws(
    () => verifyV4hResources(v4hFixture({
      modelId: 'V4Hg_10k',
      checkpoint: 'E:/MyProject/重要模型保存/V4Hg_10k/step_010000_ema_inference.pt',
    })),
    /training-bound VAE/,
  )
})

test('V4H requires bounded non-overlapping phrases and a 0s to 2s SOFA escape', () => {
  assert.throws(
    () => verifyV4hResources({ ...v4hFixture(), sofaEscapeSeconds: 2.01 }),
    /0s 到 2s/,
  )
  assert.throws(
    () => verifyV4hResources({
      ...v4hFixture(),
      targetPhrases: [{ start: 0, text: 'あ' }],
    }),
    /缺少有效且不重叠的起止边界/,
  )
  assert.throws(
    () => verifyV4hResources({
      ...v4hFixture(),
      targetPhrases: [
        { start: 0, end: 1, text: 'あ' },
        { start: 0.9, end: 1.5, text: 'い' },
      ],
    }),
    /缺少有效且不重叠的起止边界/,
  )
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

function v4hFixture(overrides: Partial<V4hRequest> = {}): V4hRequest {
  return {
    refAudio: 'ref.wav',
    melodyAudio: 'melody.wav',
    refPhrases: [{ start: 0, end: 0.5, text: 'あ' }],
    targetPhrases: [{ start: 0.25, end: 0.75, text: 'い' }],
    output: 'out.wav',
    modelId: 'V4H_24k',
    checkpoint: 'E:/MyProject/重要模型保存/V4H_24k/step_024000_ema_inference.pt',
    vaeCheckpoint: 'E:/AIscene/YingMusic_Singer_Plus/ckpts/stable_audio_2_0_vae_20hz_official.ckpt',
    steps: 32,
    cfg: 3,
    seed: 42,
    device: 'cuda:0',
    sofaEscapeSeconds: 0.25,
    ...overrides,
  }
}

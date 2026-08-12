import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const [refAudio, melodyAudio] = process.argv.slice(2)
if (!refAudio) throw new Error('usage: node smoke_svs_v4h.mjs <ref.wav> [melody.wav]')

const jobId = `svs-v4h-smoke-${Date.now().toString(36)}`
const output = path.join(repoRoot, 'data', `${jobId}.wav`)
const request = {
  jobId,
  refAudio: path.resolve(refAudio),
  melodyAudio: path.resolve(melodyAudio || refAudio),
  refPhrases: [{ start: 0, end: 0.4, text: 'きぼう' }],
  targetPhrases: [{ start: 0.5, end: 1.2, text: 'ものがたり' }],
  output,
  modelId: 'V4Hg_10k',
  checkpoint: 'E:/MyProject/重要模型保存/V4Hg_10k/step_010000_ema_inference.pt',
  vaeCheckpoint: 'E:/AIscene/YingMusic_Singer_Plus/ckpts/autoencoder_285k.ckpt',
  steps: Number(process.env.SVS_SMOKE_STEPS || 1),
  cfg: 3,
  seed: 42,
  device: 'cuda:0',
  sofaEscapeSeconds: Number(process.env.SVS_SMOKE_SOFA_ESCAPE || 0.1),
}

const ws = new WebSocket('ws://127.0.0.1:8101/ws/svc')
await new Promise((resolve, reject) => {
  ws.once('open', resolve)
  ws.once('error', reject)
})
ws.send(JSON.stringify({ type: 'register', jobId }))
await new Promise(resolve => setTimeout(resolve, 100))

const done = new Promise((resolve, reject) => {
  ws.on('message', raw => {
    const message = JSON.parse(raw.toString())
    if (message.type === 'error') reject(new Error(message.message || 'V4Hg failed'))
    if (message.type === 'done') resolve(message)
  })
  ws.once('close', () => reject(new Error('V4Hg WebSocket closed')))
})

const response = await fetch('http://127.0.0.1:8101/api/svs/run', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(request),
})
if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`)
const completed = await done
if (!fs.existsSync(completed.outputFile)) throw new Error(`V4Hg output is missing: ${completed.outputFile}`)
console.log(JSON.stringify({ ok: true, jobId, outputFile: completed.outputFile }, null, 2))
ws.close()

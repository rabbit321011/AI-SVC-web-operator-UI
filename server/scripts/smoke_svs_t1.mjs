import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const inspectWavOnly = args.includes('--inspect-wav')
const inputs = args.filter(arg => arg !== '--dry-run' && arg !== '--inspect-wav')
const refAudio = inputs[0]
const melodyAudio = inputs[1] || refAudio

if (!refAudio) {
  throw new Error('usage: node smoke_svs_t1.mjs <ref.wav> [melody.wav] [--dry-run|--inspect-wav]')
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
if (inspectWavOnly) {
  const wavPath = path.resolve(refAudio)
  const wavInfo = inspectWav(fs.readFileSync(wavPath))
  if (wavInfo.sampleRate !== 44_100 || wavInfo.durationSeconds <= 0.1
    || wavInfo.peak <= 1e-5 || wavInfo.rms <= 1e-6) {
    throw new Error(`SVS WAV failed audio checks: ${JSON.stringify(wavInfo)}`)
  }
  console.log(JSON.stringify({ ok: true, wavPath, wav: wavInfo }, null, 2))
  process.exit(0)
}

const jobId = `svs-t1-smoke-${Date.now().toString(36)}`
const timeoutMs = Number(process.env.SVS_SMOKE_TIMEOUT_MS || 1_800_000)
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  throw new Error('SVS_SMOKE_TIMEOUT_MS must be a positive number')
}
const output = path.join(repoRoot, 'data', `${jobId}.wav`)
const manifest = output.replace(/\.wav$/i, '.t1.json')
const request = {
  jobId,
  refAudio: path.resolve(refAudio),
  melodyAudio: path.resolve(melodyAudio),
  refPhrases: [{ start: 0, end: 0.4, text: 'きぼう' }],
  targetPhrases: [{ start: 0.5, end: 1.2, text: 'ものがたり' }],
  output,
  checkpoint: process.env.SVS_SMOKE_CHECKPOINT
    || 'E:/MyProject/重要模型保存/V4fg_10k/step_010000.pt',
  vaeCheckpoint: process.env.SVS_SMOKE_VAE
    || 'E:/AIscene/YingMusic_Singer_Plus/ckpts/autoencoder_285k.ckpt',
  steps: Number(process.env.SVS_SMOKE_STEPS || 1),
  cfg: 3,
  seed: 42,
  device: 'cuda:0',
  dryRun,
}

if (dryRun) {
  const result = await postSvs(request)
  if (fs.existsSync(output) || fs.existsSync(manifest)) {
    throw new Error('SVS dry-run created an output or T1 manifest')
  }
  console.log(JSON.stringify({
    ok: true,
    jobId,
    dryRun: true,
    sideEffects: false,
    resources: result.resources,
    args: result.args,
  }, null, 2))
  process.exit(0)
}

const ws = new WebSocket('ws://127.0.0.1:8101/ws/svc')
let logBuffer = ''

const done = new Promise((resolve, reject) => {
  const timeout = setTimeout(
    () => reject(new Error(`SVS T1 smoke timed out after ${timeoutMs} ms (${jobId})`)),
    timeoutMs,
  )

  ws.on('message', raw => {
    const message = JSON.parse(raw.toString())
    if (message.type === 'log') {
      const log = String(message.message || '')
      logBuffer += log
      console.log(log.trim())
    }
    if (message.type === 'error') {
      clearTimeout(timeout)
      reject(new Error(message.message || 'SVS failed'))
    }
    if (message.type === 'done') {
      clearTimeout(timeout)
      resolve(message)
    }
  })
  ws.on('error', error => {
    clearTimeout(timeout)
    reject(error)
  })
})

await new Promise((resolve, reject) => {
  ws.once('open', resolve)
  ws.once('error', reject)
})
ws.send(JSON.stringify({ type: 'register', jobId }))
await new Promise(resolve => setTimeout(resolve, 100))

try {
  const started = await postSvs(request)
  if (started.jobId !== jobId || started.status !== 'started') {
    throw new Error(`unexpected start response: ${JSON.stringify(started)}`)
  }

  const completed = await done
  const auditLine = logBuffer.split(/\r?\n/).find(line => line.startsWith('[t1] '))
  if (!auditLine) throw new Error('SVS output did not contain a T1 placement audit')
  const audit = JSON.parse(auditLine.slice('[t1] '.length))
  const placements = Array.isArray(audit.placements) ? audit.placements : []
  const refPlacements = placements.filter(item => item.region === 'A')
  const targetPlacements = placements.filter(item => item.region === 'B')
  if (audit.mode !== 't1_full_phrases'
    || refPlacements.length !== request.refPhrases.length
    || targetPlacements.length !== request.targetPhrases.length) {
    throw new Error(`unexpected T1 placement audit: ${JSON.stringify(audit)}`)
  }
  for (const placement of placements) {
    if (!Number.isInteger(placement.requested_frame)
      || !Number.isInteger(placement.actual_frame)
      || placement.actual_frame !== placement.requested_frame
      || placement.placed_token_count !== placement.token_count
      || placement.sep_placed !== true
      || placement.truncated_at_a_boundary) {
      throw new Error(`invalid T1 phrase placement: ${JSON.stringify(placement)}`)
    }
  }
  if (refPlacements[0].actual_frame !== 0
    || refPlacements.some(item => item.actual_frame >= audit.ref_content_frames)
    || targetPlacements.some(item => item.actual_frame < audit.encoded_ref_frames)) {
    throw new Error(`T1 phrases crossed the A/B boundary: ${JSON.stringify(audit)}`)
  }
  if (!fs.existsSync(completed.outputFile)) {
    throw new Error(`SVS output is missing: ${completed.outputFile}`)
  }

  const wav = fs.readFileSync(completed.outputFile)
  const wavInfo = inspectWav(wav)
  if (wavInfo.sampleRate !== 44_100 || wavInfo.durationSeconds <= 0.1
    || wavInfo.peak <= 1e-5 || wavInfo.rms <= 1e-6) {
    throw new Error(`SVS WAV failed audio checks: ${JSON.stringify(wavInfo)}`)
  }

  console.log(JSON.stringify({
    ok: true,
    jobId,
    outputFile: completed.outputFile,
    outputBytes: wav.length,
    wav: wavInfo,
    t1Mode: audit.mode,
    placements,
  }, null, 2))
} finally {
  ws.close()
}

async function postSvs(body) {
  const response = await fetch('http://127.0.0.1:8101/api/svs/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  }
  return response.json()
}

function inspectWav(wav) {
  if (wav.length <= 44 || wav.toString('ascii', 0, 4) !== 'RIFF'
    || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('SVS output is not a valid WAV file')
  }

  let format = null
  let dataOffset = -1
  let dataSize = 0
  for (let offset = 12; offset + 8 <= wav.length;) {
    const id = wav.toString('ascii', offset, offset + 4)
    const size = wav.readUInt32LE(offset + 4)
    const bodyOffset = offset + 8
    if (bodyOffset + size > wav.length) throw new Error(`invalid WAV chunk: ${id}`)
    if (id === 'fmt ' && size >= 16) {
      format = {
        encoding: wav.readUInt16LE(bodyOffset),
        channels: wav.readUInt16LE(bodyOffset + 2),
        sampleRate: wav.readUInt32LE(bodyOffset + 4),
        bitsPerSample: wav.readUInt16LE(bodyOffset + 14),
      }
    }
    if (id === 'data') {
      dataOffset = bodyOffset
      dataSize = size
    }
    offset = bodyOffset + size + (size % 2)
  }
  if (!format || dataOffset < 0 || dataSize === 0) throw new Error('WAV is missing fmt or data')
  if (![1, 3].includes(format.encoding)) throw new Error(`unsupported WAV encoding: ${format.encoding}`)

  const bytesPerSample = format.bitsPerSample / 8
  if (!Number.isInteger(bytesPerSample) || bytesPerSample <= 0) {
    throw new Error(`invalid WAV bit depth: ${format.bitsPerSample}`)
  }
  const sampleCount = Math.floor(dataSize / bytesPerSample)
  const frameCount = Math.floor(sampleCount / format.channels)
  let peak = 0
  let sumSquares = 0
  for (let index = 0; index < sampleCount; index++) {
    const sample = readWavSample(wav, dataOffset + index * bytesPerSample, format)
    peak = Math.max(peak, Math.abs(sample))
    sumSquares += sample * sample
  }
  return {
    ...format,
    frameCount,
    durationSeconds: frameCount / format.sampleRate,
    peak,
    rms: Math.sqrt(sumSquares / sampleCount),
  }
}

function readWavSample(wav, offset, format) {
  if (format.encoding === 3 && format.bitsPerSample === 32) return wav.readFloatLE(offset)
  if (format.encoding === 3 && format.bitsPerSample === 64) return wav.readDoubleLE(offset)
  if (format.encoding !== 1) throw new Error(`unsupported float WAV depth: ${format.bitsPerSample}`)
  if (format.bitsPerSample === 8) return (wav.readUInt8(offset) - 128) / 128
  if (format.bitsPerSample === 16) return wav.readInt16LE(offset) / 32_768
  if (format.bitsPerSample === 24) {
    let value = wav.readUIntLE(offset, 3)
    if (value & 0x80_0000) value -= 0x100_0000
    return value / 0x80_0000
  }
  if (format.bitsPerSample === 32) return wav.readInt32LE(offset) / 2_147_483_648
  throw new Error(`unsupported PCM WAV depth: ${format.bitsPerSample}`)
}

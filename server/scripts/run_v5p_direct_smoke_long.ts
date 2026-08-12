import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import {
  buildV5PServerFrameMap,
  buildV5PServerHTransport,
  buildV5PServerMidiTransport,
  runSynthesisDirectControl,
  type SynthesisDirectControlRequest,
} from '../src/services/synthesis-direct-control.service.js'

const inputWav = path.resolve(process.argv[2] || '')
const jobId = process.argv[3] || 'v5p-long-smoke-1step'
const steps = Number(process.argv[4] || 1)

if (!inputWav || !fs.existsSync(inputWav)) {
  throw new Error(`input WAV not found: ${inputWav}`)
}
const meta = readWavMeta(inputWav)
if (meta.sampleRate !== 44_100) throw new Error('input must be 44100 Hz')

const sourceSHA256 = sha256File(inputWav)
const frameCount = Math.floor(meta.totalSamples / 2048)
if (frameCount < 1) throw new Error('input is shorter than one V5-P frame')

const denseHTokens = Array(frameCount).fill(0)
denseHTokens[0] = 211
denseHTokens[frameCount - 1] = 365
const hEvents = [
  { id: `h:0:211`, frame: 0, tokenId: 211, symbol: 'a', origin: 'user' },
  { id: `h:${frameCount - 1}:365`, frame: frameCount - 1, tokenId: 365, symbol: 'SEP', origin: 'user' },
]
const frameMap = buildV5PServerFrameMap(meta.totalSamples, meta.totalSamples)
const guide = {
  assetId: 'asset:long-smoke-guide',
  audioSHA256: sourceSHA256,
  sampleRate: 44_100,
  sampleCount: meta.totalSamples,
  frameCount,
}
const text = {
  segmentRevision: 1,
  kanaRevision: 1,
  hRevision: 1,
  hEvents,
  denseHTokens,
  placementRanges: [{
    phraseId: 's1',
    startFrame: 0,
    endFrameExclusive: frameCount,
    placementMode: 'phone',
  }],
}
const classes = Array(frameCount).fill(255)
const snapshot = {
  schema: 'aisvc.v5p-material-snapshot.v1',
  createdAt: new Date().toISOString(),
  reference: { unitId: 'node:long-reference', unitRevision: 1, guide, text },
  target: {
    unitId: 'node:long-target',
    unitRevision: 1,
    guide,
    text,
    midiP: { revision: 1, classes, manualFrames: [] },
  },
  frameMap,
  hTransport: buildV5PServerHTransport(frameMap, denseHTokens, denseHTokens, {
    referenceTerminalPlacementMode: 'phone',
    targetTerminalPlacementMode: 'phone',
  }),
  midiPTransport: buildV5PServerMidiTransport(frameMap, classes),
}
const request: SynthesisDirectControlRequest = {
  jobId,
  presetId: 'V5P_40K_EMA',
  referenceWav: inputWav,
  targetWav: inputWav,
  snapshot,
  steps,
  cfg: 1,
  seed: 42,
  device: 'cuda:0',
}

const result = await runSynthesisDirectControl(request)
console.log(JSON.stringify(result, null, 2))

function readWavMeta(filePath: string): { sampleRate: number; numChannels: number; bitsPerSample: number; totalSamples: number } {
  const buf = fs.readFileSync(filePath)
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF WAVE file')
  }
  let offset = 12
  let numChannels = 1
  let sampleRate = 44_100
  let bitsPerSample = 16
  while (offset < buf.length - 8) {
    const chunkId = buf.toString('ascii', offset, offset + 4)
    const chunkSize = buf.readUInt32LE(offset + 4)
    const dataStart = offset + 8
    if (chunkId === 'fmt ') {
      numChannels = buf.readUInt16LE(dataStart + 2)
      sampleRate = buf.readUInt32LE(dataStart + 4)
      bitsPerSample = buf.readUInt16LE(dataStart + 14)
      if (chunkSize >= 40) bitsPerSample = buf.readUInt16LE(dataStart + 18)
    } else if (chunkId === 'data') {
      const bytesPerSample = Math.max(1, numChannels * bitsPerSample / 8)
      return {
        sampleRate,
        numChannels,
        bitsPerSample,
        totalSamples: Math.floor(chunkSize / bytesPerSample),
      }
    }
    offset += 8 + chunkSize + (chunkSize % 2)
  }
  throw new Error('no data chunk')
}

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

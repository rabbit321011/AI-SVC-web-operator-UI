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

const root = 'E:/AIscene/AISVC-midi-web'
const fixtureRoot = path.join(root, 'exports', 'v5p-token-editor-generated')
const fixtureWav = path.join(fixtureRoot, '鹿乃-温柔.frames-000-063.wav')
const textFixture = JSON.parse(fs.readFileSync(
  path.join(fixtureRoot, '鹿乃-温柔.frames-000-063.text-tracks.json'),
  'utf-8',
))
const midiFixture = JSON.parse(fs.readFileSync(
  path.join(fixtureRoot, '鹿乃-温柔.frames-000-063.game-midi-p.json'),
  'utf-8',
))

const jobId = process.argv[2] || 'v5p-smoke-1step'
const steps = Number(process.argv[3] || 1)
const sourceSHA256 = sha256File(fixtureWav)
if (sourceSHA256 !== midiFixture.sourceSHA256) {
  console.warn('MIDI-P fixture source hash is stale; binding smoke to the current Owned Guide bytes')
}

const referenceWav = copyGuide(`${jobId}-a`)
const targetWav = copyGuide(`${jobId}-b`)
const sampleCount = Number(midiFixture.sourceSamples)
const frameCount = Number(midiFixture.frameCount)
const frameMap = buildV5PServerFrameMap(sampleCount, sampleCount)
const denseHTokens = Array(frameCount).fill(0)
for (const event of textFixture.h) denseHTokens[event.frame] = event.id
const text = {
  segmentRevision: 1,
  kanaRevision: 1,
  hRevision: 1,
  hEvents: textFixture.h.map((event: any) => ({
    id: `h:${event.frame}:${event.id}`,
    frame: event.frame,
    tokenId: event.id,
    symbol: event.symbol,
    origin: event.origin,
  })),
  denseHTokens,
  placementRanges: [{
    phraseId: 's1',
    startFrame: 8,
    endFrameExclusive: 64,
    placementMode: 'phone',
  }],
}
const guide = {
  assetId: 'asset:smoke-guide',
  audioSHA256: sourceSHA256,
  sampleRate: 44_100,
  sampleCount,
  frameCount,
}
const classes = midiFixture.classes.map(Number)
const snapshot = {
  schema: 'aisvc.v5p-material-snapshot.v1',
  createdAt: new Date().toISOString(),
  reference: {
    unitId: 'node:smoke-reference',
    unitRevision: 1,
    guide,
    text,
  },
  target: {
    unitId: 'node:smoke-target',
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
  referenceWav,
  targetWav,
  snapshot,
  steps,
  cfg: 1,
  seed: 42,
  device: 'cuda:0',
}

const result = await runSynthesisDirectControl(request)
console.log(JSON.stringify(result, null, 2))

function copyGuide(suffix: string): string {
  const dir = path.join(root, 'data', `render_${suffix}`)
  fs.mkdirSync(dir, { recursive: true })
  const destination = path.join(dir, 'combined.wav')
  fs.copyFileSync(fixtureWav, destination)
  return destination
}

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

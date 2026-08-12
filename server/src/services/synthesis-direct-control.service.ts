import crypto from 'crypto'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import type { WebSocket } from 'ws'
import { verifyOwnedGuideWav } from './owned-guide-runtime.js'
import { GPU_PROCESS_CANCELLED_MESSAGE, registerGpuProcess, wasGpuProcessReleased } from './gpu-runtime.service.js'
import { isV5PRuntimeReady, runV5PResidentInfer } from './model-runtime.service.js'

const PROJECT_ROOT = 'E:/AIscene/AISVC-midi-web'
const DATA_ROOT = path.resolve(PROJECT_ROOT, 'data')
import { V5P_DIRECT_PRESET, SINGER_ROOT } from './v5p-preset.js'

export { V5P_DIRECT_PRESET } from './v5p-preset.js'

export interface SynthesisDirectControlRequest {
  jobId: string
  presetId: string
  referenceWav: string
  targetWav: string
  snapshot: unknown
  steps?: number
  cfg?: number
  seed?: number
  device?: string
}

export interface SynthesisDirectControlPreflight {
  schema: 'aisvc.v5p-direct-preflight.v1'
  jobId: string
  presetId: 'V5P_40K_EMA'
  snapshotSHA256: string
  frameMap: Record<string, any>
  referenceWav: string
  targetWav: string
  render: {
    steps: number
    cfg: number
    seed: number
    device: string
  }
}

export interface SynthesisDirectControlResult {
  schema: 'aisvc.v5p-direct-result.v1'
  jobId: string
  snapshotSHA256: string
  outputWav: string
  outputSHA256: string
  sampleRate: 44100
  sampleCount: number
  duration: number
  auditFile: string
  presetId: 'V5P_40K_EMA'
  checkpointSHA256: string
  vaeSHA256: string
  adapterSHA256: string
  seed: number
}

interface DirectProcessEvent {
  type?: string
  message?: string
  resultFile?: string
  totalFrames?: number
}

const hashCache = new Map<string, { size: number; mtimeMs: number; sha256: string }>()

export function validateSynthesisDirectControlRequest(
  req: SynthesisDirectControlRequest,
): SynthesisDirectControlPreflight {
  if (!/^[a-zA-Z0-9_-]{4,64}$/.test(req.jobId || '')) throw new Error('V5-P jobId 无效')
  if (req.presetId !== V5P_DIRECT_PRESET.id) throw new Error('V5-P preset 无效')
  const referenceWav = validateJobWavPath(req.referenceWav, 'A')
  const targetWav = validateJobWavPath(req.targetWav, 'B')
  const snapshot = record(req.snapshot, 'material snapshot')
  if (snapshot.schema !== 'aisvc.v5p-material-snapshot.v1') throw new Error('material snapshot schema 无效')
  if (!Number.isFinite(Date.parse(nonempty(snapshot.createdAt, 'snapshot createdAt')))) {
    throw new Error('snapshot createdAt 无效')
  }
  const reference = record(snapshot.reference, 'A snapshot')
  const target = record(snapshot.target, 'B snapshot')
  const referenceUnitId = nonempty(reference.unitId, 'A unitId')
  const targetUnitId = nonempty(target.unitId, 'B unitId')
  if (referenceUnitId === targetUnitId) throw new Error('A/B 不能是同一个合成单元')
  integer(reference.unitRevision, 'A unitRevision', 0)
  integer(target.unitRevision, 'B unitRevision', 0)
  const referenceGuide = validateGuide(record(reference.guide, 'A Guide'), 'A')
  const targetGuide = validateGuide(record(target.guide, 'B Guide'), 'B')
  const referenceText = validateTextSnapshot(record(reference.text, 'A Text'), referenceGuide.frameCount, 'A')
  const targetText = validateTextSnapshot(record(target.text, 'B Text'), targetGuide.frameCount, 'B')
  const targetMidi = validateMidiSnapshot(record(target.midiP, 'B MIDI-P'), targetGuide.frameCount)

  const expectedFrameMap = buildV5PServerFrameMap(referenceGuide.sampleCount, targetGuide.sampleCount)
  if (canonicalJSON(snapshot.frameMap) !== canonicalJSON(expectedFrameMap)) {
    throw new Error('前端 ABFrameMap 与服务端权威计算不一致')
  }
  const expectedHTransport = buildV5PServerHTransport(
    expectedFrameMap,
    referenceText.dense,
    targetText.dense,
    {
      referenceTerminalPlacementMode: referenceText.terminalMode,
      targetTerminalPlacementMode: targetText.terminalMode,
    },
  )
  if (canonicalJSON(snapshot.hTransport) !== canonicalJSON(expectedHTransport)) {
    throw new Error('前端 joint H transport 与服务端权威计算不一致')
  }
  const expectedTransport = buildV5PServerMidiTransport(expectedFrameMap, targetMidi.classes)
  if (canonicalJSON(snapshot.midiPTransport) !== canonicalJSON(expectedTransport)) {
    throw new Error('前端 MIDI-P transport 与服务端权威计算不一致')
  }

  const steps = integer(req.steps ?? 32, 'steps', 1, 256)
  const cfg = finite(req.cfg ?? 1, 'cfg', 0, 10)
  const seed = integer(req.seed ?? 42, 'seed', 0, 0xffffffff)
  const device = req.device == null ? 'cuda:0' : nonempty(req.device, 'device')
  if (!/^cuda:\d+$/.test(device) && device !== 'cpu') throw new Error('device 无效')
  return {
    schema: 'aisvc.v5p-direct-preflight.v1',
    jobId: req.jobId,
    presetId: 'V5P_40K_EMA',
    snapshotSHA256: sha256Text(canonicalJSON(snapshot)),
    frameMap: expectedFrameMap,
    referenceWav,
    targetWav,
    render: { steps, cfg, seed, device },
  }
}

export async function verifySynthesisDirectControlResources(
  req: SynthesisDirectControlRequest,
): Promise<SynthesisDirectControlPreflight & { resourceSHA256: Record<string, string> }> {
  const preflight = validateSynthesisDirectControlRequest(req)
  const snapshot = req.snapshot as Record<string, any>
  const referenceGuide = snapshot.reference.guide
  const targetGuide = snapshot.target.guide
  const referenceWav = verifyOwnedGuideWav(
    preflight.referenceWav,
    referenceGuide.audioSHA256,
    referenceGuide.frameCount,
  )
  const targetWav = verifyOwnedGuideWav(
    preflight.targetWav,
    targetGuide.audioSHA256,
    targetGuide.frameCount,
  )
  if (referenceWav.sampleCount !== referenceGuide.sampleCount) throw new Error('A Guide sampleCount 与 snapshot 不一致')
  if (targetWav.sampleCount !== targetGuide.sampleCount) throw new Error('B Guide sampleCount 与 snapshot 不一致')

  const resources: Array<[string, string, string]> = [
    ['checkpoint', V5P_DIRECT_PRESET.checkpoint, V5P_DIRECT_PRESET.checkpointSHA256],
    ['modelConfig', V5P_DIRECT_PRESET.modelConfig, V5P_DIRECT_PRESET.modelConfigSHA256],
    ['vaeConfig', V5P_DIRECT_PRESET.vaeConfig, V5P_DIRECT_PRESET.vaeConfigSHA256],
    ['vaeCheckpoint', V5P_DIRECT_PRESET.vaeCheckpoint, V5P_DIRECT_PRESET.vaeCheckpointSHA256],
    ['placement', V5P_DIRECT_PRESET.placement, V5P_DIRECT_PRESET.placementSHA256],
  ]
  for (const [name, expected] of Object.entries(V5P_DIRECT_PRESET.melodyHashes)) {
    resources.push([name, `${SINGER_ROOT}/src/YingMusicSinger/melody/${name}`, expected])
  }
  if (!fs.existsSync(V5P_DIRECT_PRESET.directControlAdapter)) {
    throw new Error(`V5-P direct-control adapter 缺失: ${V5P_DIRECT_PRESET.directControlAdapter}`)
  }
  if (!fs.existsSync(V5P_DIRECT_PRESET.directRunner)) {
    throw new Error(`V5-P direct runner 缺失: ${V5P_DIRECT_PRESET.directRunner}`)
  }
  if (!fs.existsSync(V5P_DIRECT_PRESET.python)) {
    throw new Error(`V5-P CUDA Python 缺失: ${V5P_DIRECT_PRESET.python}`)
  }
  const resourceSHA256: Record<string, string> = {}
  for (const [name, filePath, expected] of resources) {
    const actual = await sha256FileCached(filePath)
    if (actual !== expected) throw new Error(`V5-P ${name} SHA256 不一致：${actual} != ${expected}`)
    resourceSHA256[name] = actual
  }
  resourceSHA256.directControlAdapter = await sha256FileCached(V5P_DIRECT_PRESET.directControlAdapter)
  resourceSHA256.runner = await sha256FileCached(V5P_DIRECT_PRESET.directRunner)
  return { ...preflight, resourceSHA256 }
}

export function buildV5PDirectJobManifest(
  req: SynthesisDirectControlRequest,
  verified: SynthesisDirectControlPreflight & { resourceSHA256: Record<string, string> },
) {
  const snapshotCanonical = canonicalJSON(req.snapshot)
  if (sha256Text(snapshotCanonical) !== verified.snapshotSHA256) {
    throw new Error('V5-P snapshot 在 preflight 后发生变化')
  }
  const resource = (resourcePath: string, hashKey: string) => ({
    path: resourcePath,
    sha256: nonempty(verified.resourceSHA256[hashKey], `${hashKey} SHA256`),
  })
  return {
    schema: 'aisvc.v5p-direct-job.v1',
    jobId: verified.jobId,
    createdAt: new Date().toISOString(),
    preset: {
      id: V5P_DIRECT_PRESET.id,
      checkpointSchema: V5P_DIRECT_PRESET.checkpointSchema,
      checkpointStep: V5P_DIRECT_PRESET.checkpointStep,
      weightSource: V5P_DIRECT_PRESET.weightSource,
      trainingCodeSHA256: V5P_DIRECT_PRESET.trainingCodeSHA256,
    },
    inputs: {
      referenceWav: verified.referenceWav,
      targetWav: verified.targetWav,
    },
    render: verified.render,
    snapshotCanonical,
    snapshotSHA256: verified.snapshotSHA256,
    resources: {
      checkpoint: resource(V5P_DIRECT_PRESET.checkpoint, 'checkpoint'),
      modelConfig: resource(V5P_DIRECT_PRESET.modelConfig, 'modelConfig'),
      vaeConfig: resource(V5P_DIRECT_PRESET.vaeConfig, 'vaeConfig'),
      vaeCheckpoint: resource(V5P_DIRECT_PRESET.vaeCheckpoint, 'vaeCheckpoint'),
      placement: resource(V5P_DIRECT_PRESET.placement, 'placement'),
      directControlAdapter: resource(V5P_DIRECT_PRESET.directControlAdapter, 'directControlAdapter'),
      runner: resource(V5P_DIRECT_PRESET.directRunner, 'runner'),
      midiPModule: resource(
        `${SINGER_ROOT}/src/YingMusicSinger/melody/midi_p_v4ph.py`,
        'midi_p_v4ph.py',
      ),
      singerRoot: { path: SINGER_ROOT },
    },
  }
}

export async function runSynthesisDirectControl(
  req: SynthesisDirectControlRequest,
  ws?: WebSocket,
  preverified?: SynthesisDirectControlPreflight & { resourceSHA256: Record<string, string> },
): Promise<SynthesisDirectControlResult | null> {
  try {
    const verified = preverified ?? await verifySynthesisDirectControlResources(req)
    const outputDir = path.resolve(PROJECT_ROOT, 'data', `render_${req.jobId}_v5p`)
    if (fs.existsSync(outputDir)) throw new Error(`V5-P jobId 已存在且不可覆盖: ${req.jobId}`)
    fs.mkdirSync(outputDir, { recursive: false })
    const jobFile = path.join(outputDir, 'job.json')
    const manifest = buildV5PDirectJobManifest(req, verified)
    fs.writeFileSync(jobFile, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf-8', flag: 'wx' })
    const jobSHA256 = await sha256FileCached(jobFile)

    send(ws, { type: 'progress', progress: 4, message: '冻结 V5-P 合成材料' })
    let resultFile = path.join(outputDir, 'result.json')
    const onDirectEvent = (event: DirectProcessEvent) => {
      if (event.type === 'validated_job') {
        send(ws, { type: 'progress', progress: 10, message: `控制材料已锁定 · ${event.totalFrames} frames` })
      }
      if (event.type === 'loading_checkpoint') send(ws, { type: 'progress', progress: 16, message: '加载 V5-P 40K EMA' })
      if (event.type === 'loaded_checkpoint') send(ws, { type: 'progress', progress: 35, message: 'V5-P 40K EMA 已加载' })
      if (event.type === 'loading_vae') send(ws, { type: 'progress', progress: 40, message: '加载官方 20 Hz VAE' })
      if (event.type === 'loaded_vae') send(ws, { type: 'progress', progress: 53, message: '官方 VAE 已加载' })
      if (event.type === 'encoding_reference') send(ws, { type: 'progress', progress: 60, message: '编码 A/B Guide' })
      if (event.type === 'sampling') send(ws, { type: 'progress', progress: 68, message: 'V5-P 采样' })
      if (event.type === 'decoding') send(ws, { type: 'progress', progress: 92, message: '解码 B 区 Take' })
      if (event.type === 'complete' && event.resultFile) resultFile = event.resultFile
    }
    if (isV5PRuntimeReady()) {
      await runV5PResidentInfer(jobFile, jobSHA256, outputDir, onDirectEvent)
    } else {
      await runJsonProcess(V5P_DIRECT_PRESET.python, [
        V5P_DIRECT_PRESET.directRunner,
        '--job', jobFile,
        '--expected-job-sha256', jobSHA256,
        '--output-dir', outputDir,
      ], onDirectEvent, { id: `v5p:${req.jobId}`, kind: 'svs', modelId: V5P_DIRECT_PRESET.id, device: verified.render.device })
    }
    const result = JSON.parse(fs.readFileSync(resultFile, 'utf-8')) as SynthesisDirectControlResult
    if (
      result.schema !== 'aisvc.v5p-direct-result.v1'
      || result.jobId !== req.jobId
      || result.snapshotSHA256 !== verified.snapshotSHA256
      || result.sampleRate !== 44100
      || !fs.existsSync(result.outputWav)
    ) {
      throw new Error('V5-P runner 返回了不兼容的 Take')
    }
    send(ws, { type: 'v5p-result', result })
    send(ws, { type: 'done', resultFile, outputWav: result.outputWav })
    return result
  } catch (error: any) {
    send(ws, { type: 'error', message: error?.message || String(error) })
    if (!ws) throw error
    return null
  }
}

export function buildV5PServerFrameMap(referenceSamples: number, targetSamples: number): Record<string, any> {
  positiveSafeInteger(referenceSamples, 'A sampleCount')
  positiveSafeInteger(targetSamples, 'B sampleCount')
  const referenceOwnedFrames = Math.floor(referenceSamples / 2048)
  const targetOwnedFrames = Math.floor(targetSamples / 2048)
  if (referenceOwnedFrames < 1 || targetOwnedFrames < 1) throw new Error('A/B Guide 短于一个 V5-P frame')
  const bOffsetFrame = Math.floor((referenceSamples + 22_050 + 1_024) / 2_048)
  const referencePaddedSamples = bOffsetFrame * 2_048
  const gapSamples = referencePaddedSamples - referenceSamples
  const targetPaddedSamples = targetSamples + 44_100
  const targetPaddedFrames = Math.floor(targetPaddedSamples / 2_048)
  const totalFrameCount = bOffsetFrame + targetPaddedFrames
  const cropEnd = totalFrameCount - 21
  const decodedFrames = cropEnd - bOffsetFrame
  return {
    schema: 'aisvc.v5p-ab-frame-map.v1',
    sampleRate: 44100,
    hopSamples: 2048,
    reference: {
      ownedSampleCount: referenceSamples,
      ownedFrameCount: referenceOwnedFrames,
      nominalPaddingSampleCount: 22_050,
      paddingSampleCount: gapSamples,
      paddingAdjustmentSampleCount: gapSamples - 22_050,
      paddedSampleCount: referencePaddedSamples,
      paddedFrameCount: bOffsetFrame,
      paddingFrameCount: bOffsetFrame - referenceOwnedFrames,
      trailingSampleCount: referenceSamples % 2_048,
      paddedTrailingSampleCount: 0,
      paddingKind: 'ab-gap',
    },
    target: {
      ownedSampleCount: targetSamples,
      ownedFrameCount: targetOwnedFrames,
      nominalPaddingSampleCount: 44_100,
      paddingSampleCount: 44_100,
      paddingAdjustmentSampleCount: 0,
      paddedSampleCount: targetPaddedSamples,
      paddedFrameCount: targetPaddedFrames,
      paddingFrameCount: targetPaddedFrames - targetOwnedFrames,
      trailingSampleCount: targetSamples % 2_048,
      paddedTrailingSampleCount: targetPaddedSamples % 2_048,
      paddingKind: 'decode-rear',
    },
    bOffsetFrame,
    totalFrameCount,
    crop: {
      startFrame: bOffsetFrame,
      endFrameExclusive: cropEnd,
      evaluatorRearFrameCount: 21,
      decodedFrameCountBeforeSampleTrim: decodedFrames,
      decodedFrameDelta: decodedFrames - targetOwnedFrames,
      finalSampleCount: targetOwnedFrames * 2_048,
    },
  }
}

export function buildV5PServerMidiTransport(frameMap: Record<string, any>, targetClasses: number[]): Record<string, any> {
  const start = integer(frameMap.bOffsetFrame, 'B offset', 1)
  const targetFrames = integer(frameMap.target?.ownedFrameCount, 'B frameCount', 1)
  const total = integer(frameMap.totalFrameCount, 'totalFrameCount', start + targetFrames)
  if (targetClasses.length !== targetFrames) throw new Error('B MIDI-P class 数量与 frameCount 不一致')
  if (targetClasses.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new Error('B 有效 MIDI-P 只能包含 pitch 0..254 或 REST=255')
  }
  const end = start + targetFrames
  const classIds = Array(total).fill(255)
  classIds.splice(start, targetFrames, ...targetClasses)
  return {
    classIds,
    clearEmbeddingStartFrame: 0,
    clearEmbeddingEndFrameExclusive: start,
    targetStartFrame: start,
    targetEndFrameExclusive: end,
    rearStartFrame: end,
    rearEndFrameExclusive: total,
    rearClassId: 255,
  }
}

export function buildV5PServerHTransport(
  frameMap: Record<string, any>,
  referenceTokens: number[],
  targetTokens: number[],
  options: {
    referenceTerminalPlacementMode?: string
    targetTerminalPlacementMode?: string
  } = {},
): Record<string, any> {
  const referenceFrames = integer(frameMap.reference?.ownedFrameCount, 'A frameCount', 1)
  const targetFrames = integer(frameMap.target?.ownedFrameCount, 'B frameCount', 1)
  const bOffset = integer(frameMap.bOffsetFrame, 'B offset', referenceFrames)
  const total = integer(frameMap.totalFrameCount, 'totalFrameCount', bOffset + targetFrames)
  if (referenceTokens.length !== referenceFrames || targetTokens.length !== targetFrames) {
    throw new Error('A/B dense H 长度与 ABFrameMap 不一致')
  }
  const referenceTerminal = terminalHStructure(
    referenceTokens,
    'A',
    options.referenceTerminalPlacementMode ?? 'user',
  )
  const targetTerminal = terminalHStructure(
    targetTokens,
    'B',
    options.targetTerminalPlacementMode ?? 'user',
  )
  const firstLyricLocalFrame = targetTokens.findIndex(isHLikeLyric)
  if (firstLyricLocalFrame < 0) throw new Error('B dense H 没有发音 token')
  if (targetTokens.slice(0, firstLyricLocalFrame).some(token => token !== 0)) {
    throw new Error('B 第一枚发音 token 前存在无法归属的 SEP/PUL')
  }
  const referenceJointSep = bOffset + firstLyricLocalFrame - 1
  const targetJointSep = total - 1
  const tokens = Array(total).fill(0)
  copyHLayer(tokens, referenceTokens, 0, referenceTerminal.sepFrame, 'A')
  copyHLayer(tokens, targetTokens, bOffset, targetTerminal.sepFrame, 'B')
  const referencePulExtended = extendJointPul(
    tokens,
    referenceTerminal.extendPul,
    referenceTerminal.sepFrame,
    referenceJointSep,
    'A',
  )
  const targetPulExtended = extendJointPul(
    tokens,
    targetTerminal.extendPul,
    bOffset + targetTerminal.sepFrame,
    targetJointSep,
    'B',
  )
  placeHToken(tokens, referenceJointSep, 365, 'A terminal SEP')
  placeHToken(tokens, targetJointSep, 365, 'B terminal SEP')
  if (countToken(tokens, 365) !== countToken(referenceTokens, 365) + countToken(targetTokens, 365)) {
    throw new Error('joint H 改变了 SEP 数量')
  }
  const inputLyrics = [...referenceTokens, ...targetTokens].filter(isHLikeLyric)
  const outputLyrics = tokens.filter(isHLikeLyric)
  if (canonicalJSON(inputLyrics) !== canonicalJSON(outputLyrics)) throw new Error('joint H 改变了用户发音 token 序列')
  return {
    schema: 'aisvc.v5p-joint-h.v1',
    tokens,
    policy: 'training-context-terminal-sep.v1',
    reference: {
      terminalPlacementMode: referenceTerminal.placementMode,
      sourceTerminalSepFrame: referenceTerminal.sepFrame,
      jointTerminalSepFrame: referenceJointSep,
      terminalPulExtendedFrames: referencePulExtended,
    },
    target: {
      terminalPlacementMode: targetTerminal.placementMode,
      firstLyricLocalFrame,
      sourceTerminalSepFrame: targetTerminal.sepFrame,
      jointTerminalSepFrame: targetJointSep,
      terminalPulExtendedFrames: targetPulExtended,
    },
  }
}

function validateGuide(value: Record<string, any>, label: 'A' | 'B') {
  nonempty(value.assetId, `${label} assetId`)
  const audioSHA256 = nonempty(value.audioSHA256, `${label} audioSHA256`)
  if (!/^[a-f0-9]{64}$/i.test(audioSHA256)) throw new Error(`${label} Guide SHA256 无效`)
  if (value.sampleRate !== 44100) throw new Error(`${label} Guide 必须为 44100 Hz`)
  const sampleCount = integer(value.sampleCount, `${label} sampleCount`, 1)
  const frameCount = integer(value.frameCount, `${label} frameCount`, 1)
  if (frameCount !== Math.floor(sampleCount / 2048)) throw new Error(`${label} Guide frameCount 与 sampleCount 不一致`)
  return { sampleCount, frameCount }
}

function validateTextSnapshot(
  value: Record<string, any>,
  frameCount: number,
  label: 'A' | 'B',
): { dense: number[]; terminalMode: string } {
  integer(value.segmentRevision, `${label} Segment revision`, 0)
  integer(value.kanaRevision, `${label} Kana revision`, 0)
  integer(value.hRevision, `${label} H revision`, 1)
  if (!Array.isArray(value.denseHTokens) || value.denseHTokens.length !== frameCount) {
    throw new Error(`${label} dense H 长度与 frameCount 不一致`)
  }
  const dense = value.denseHTokens.map((token: unknown) => integer(token, `${label} H token`, 0, 366))
  if (dense.some((token: number) => token === 364)) throw new Error(`${label} dense H 含禁用 PUNCT=364`)
  if (!dense.some((token: number) => token > 0 && token !== 365 && token !== 366)) {
    throw new Error(`${label} dense H 没有发音 token`)
  }
  if (!Array.isArray(value.hEvents)) throw new Error(`${label} H events 无效`)
  const seen = new Set<number>()
  for (const [index, raw] of value.hEvents.entries()) {
    const event = record(raw, `${label} H event ${index}`)
    const frame = integer(event.frame, `${label} H frame`, 0, frameCount - 1)
    const token = integer(event.tokenId, `${label} H tokenId`, 1, 366)
    if (token === 364 || seen.has(frame) || dense[frame] !== token) throw new Error(`${label} H events 与 dense layer 不一致`)
    seen.add(frame)
  }
  if (dense.filter((token: number) => token !== 0).length !== seen.size) {
    throw new Error(`${label} dense H 含无 provenance 的事件`)
  }
  const rawRanges = value.placementRanges ?? []
  if (!Array.isArray(rawRanges)) throw new Error(`${label} H placementRanges 无效`)
  const placementRanges = rawRanges.map((raw: unknown, index: number) => {
    const range = record(raw, `${label} H placement ${index}`)
    const startFrame = integer(range.startFrame, `${label} placement start`, 0, frameCount - 1)
    const endFrameExclusive = integer(range.endFrameExclusive, `${label} placement end`, startFrame + 1, frameCount)
    const placementMode = nonempty(range.placementMode, `${label} placementMode`)
    if (!['phone', 'pul', 'sentence', 'unknown'].includes(placementMode)) throw new Error(`${label} placementMode 无效`)
    nonempty(range.phraseId, `${label} placement phraseId`)
    return { startFrame, endFrameExclusive, placementMode }
  })
  const terminalSepFrame = dense.lastIndexOf(365)
  const terminalRanges = placementRanges.filter(range => (
    range.startFrame <= terminalSepFrame && terminalSepFrame < range.endFrameExclusive
  ))
  if (terminalRanges.length > 1) throw new Error(`${label} terminal SEP 有重复 placement provenance`)
  return { dense, terminalMode: terminalRanges[0]?.placementMode ?? 'user' }
}

function validateMidiSnapshot(value: Record<string, any>, frameCount: number): { classes: number[] } {
  integer(value.revision, 'B MIDI-P revision', 1)
  if (!Array.isArray(value.classes) || value.classes.length !== frameCount) throw new Error('B MIDI-P 长度与 frameCount 不一致')
  const classes = value.classes.map((item: unknown) => integer(item, 'B MIDI-P class', 0, 255))
  if (!Array.isArray(value.manualFrames)) throw new Error('B MIDI-P manualFrames 无效')
  const manualFrames = value.manualFrames.map((item: unknown) => integer(item, 'B MIDI-P manual frame', 0, frameCount - 1))
  if (new Set(manualFrames).size !== manualFrames.length) throw new Error('B MIDI-P manualFrames 重复')
  return { classes }
}

function validateJobWavPath(value: unknown, label: 'A' | 'B'): string {
  const resolved = path.resolve(nonempty(value, `${label} WAV`))
  const relative = path.relative(DATA_ROOT, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${label} WAV 必须位于项目 data 作业目录`)
  return resolved
}

function terminalHStructure(tokens: number[], label: 'A' | 'B', placementMode: string) {
  if (placementMode === 'sentence' || placementMode === 'unknown') {
    throw new Error(`${label} terminal H 是 ${placementMode} placement，不能按 phone/PUL 规则重定位`)
  }
  if (!['phone', 'pul', 'user'].includes(placementMode)) throw new Error(`${label} terminal placementMode 无效`)
  const sepFrame = tokens.lastIndexOf(365)
  if (sepFrame < 0) throw new Error(`${label} dense H 缺少 terminal SEP`)
  let lastEvent = -1
  for (let frame = tokens.length - 1; frame >= 0; frame--) {
    if (tokens[frame] !== 0) {
      lastEvent = frame
      break
    }
  }
  if (lastEvent !== sepFrame) throw new Error(`${label} terminal SEP 后仍有 H event`)
  return {
    sepFrame,
    extendPul: sepFrame > 0 && tokens[sepFrame - 1] === 366,
    placementMode,
  }
}

function copyHLayer(joint: number[], local: number[], offset: number, skippedFrame: number, label: 'A' | 'B'): void {
  for (let frame = 0; frame < local.length; frame++) {
    if (frame === skippedFrame || local[frame] === 0) continue
    placeHToken(joint, offset + frame, local[frame], `${label} H`)
  }
}

function extendJointPul(
  tokens: number[],
  enabled: boolean,
  sourceSepFrame: number,
  targetSepFrame: number,
  label: 'A' | 'B',
): number {
  if (!enabled) return 0
  if (targetSepFrame < sourceSepFrame) throw new Error(`${label} terminal SEP 无法向前重定位`)
  for (let frame = sourceSepFrame; frame < targetSepFrame; frame++) {
    placeHToken(tokens, frame, 366, `${label} terminal PUL`)
  }
  return targetSepFrame - sourceSepFrame
}

function placeHToken(tokens: number[], frame: number, token: number, label: string): void {
  if (!Number.isInteger(frame) || frame < 0 || frame >= tokens.length) throw new Error(`${label} 越过 joint frame contract`)
  if (tokens[frame] !== 0) throw new Error(`${label} 与已有 H token 冲突`)
  tokens[frame] = token
}

function isHLikeLyric(token: number): boolean {
  return token > 0 && token !== 365 && token !== 366
}

function countToken(tokens: number[], token: number): number {
  return tokens.reduce((total, value) => total + Number(value === token), 0)
}

function canonicalJSON(value: unknown): string {
  return JSON.stringify(sortJSON(value))
}

function sortJSON(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJSON)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJSON(item)]),
  )
}

function record(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象`)
  return value as Record<string, any>
}

function nonempty(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 必须是非空字符串`)
  return value.trim()
}

function integer(value: unknown, label: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`${label} 必须是 ${min}..${max} 的整数`)
  return Number(value)
}

function finite(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isFinite(value) || Number(value) < min || Number(value) > max) throw new Error(`${label} 必须在 ${min}..${max}`)
  return Number(value)
}

function positiveSafeInteger(value: unknown, label: string): number {
  return integer(value, label, 1)
}

function sha256Text(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

async function sha256FileCached(filePath: string): Promise<string> {
  if (!fs.existsSync(filePath)) throw new Error(`V5-P resource 缺失: ${filePath}`)
  const stat = fs.statSync(filePath)
  const cached = hashCache.get(filePath)
  if (cached?.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.sha256
  const sha256 = await new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
  hashCache.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs, sha256 })
  return sha256
}

function runJsonProcess(
  command: string,
  args: string[],
  onEvent: (event: DirectProcessEvent) => void,
  runtime: { id: string; kind: string; modelId?: string; device?: string },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: SINGER_ROOT,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        HF_HUB_OFFLINE: process.env.HF_HUB_OFFLINE ?? '1',
        TRANSFORMERS_OFFLINE: process.env.TRANSFORMERS_OFFLINE ?? '1',
        HF_DATASETS_OFFLINE: process.env.HF_DATASETS_OFFLINE ?? '1',
      },
    })
    registerGpuProcess(child, runtime)
    let stdout = ''
    let stderr = ''
    let reportedError = ''
    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
      const lines = stdout.split(/\r?\n/)
      stdout = lines.pop() ?? ''
      for (const line of lines) {
        const event = parseEvent(line)
        if (!event) continue
        if (event.type === 'error' && event.message) reportedError = event.message
        onEvent(event)
      }
    })
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString() })
    child.on('error', reject)
    child.on('close', code => {
      const finalEvent = parseEvent(stdout)
      if (finalEvent) {
        if (finalEvent.type === 'error' && finalEvent.message) reportedError = finalEvent.message
        onEvent(finalEvent)
      }
      if (wasGpuProcessReleased(child)) reject(new Error(GPU_PROCESS_CANCELLED_MESSAGE))
      else if (code === 0) resolve()
      else reject(new Error(
        reportedError
        || conciseProcessError(stderr)
        || `V5-P direct runner exited with code ${code}`,
      ))
    })
  })
}

function parseEvent(line: string): DirectProcessEvent | null {
  try { return JSON.parse(line.trim()) as DirectProcessEvent } catch { return null }
}

function conciseProcessError(stderr: string): string {
  return stderr.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(-5).join(' | ')
}

function send(ws: WebSocket | undefined, message: Record<string, unknown>) {
  if (!ws || ws.readyState !== 1) return
  try { ws.send(JSON.stringify(message)) } catch {}
}

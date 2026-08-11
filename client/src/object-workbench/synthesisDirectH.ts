import type { V5PABFrameMap } from './synthesisABFrameMap'

const SEP = 365
const PUL = 366

export interface V5PJointHTransport {
  schema: 'aisvc.v5p-joint-h.v1'
  tokens: number[]
  policy: 'training-context-terminal-sep.v1'
  reference: {
    terminalPlacementMode: 'phone' | 'pul' | 'user'
    sourceTerminalSepFrame: number
    jointTerminalSepFrame: number
    terminalPulExtendedFrames: number
  }
  target: {
    terminalPlacementMode: 'phone' | 'pul' | 'user'
    firstLyricLocalFrame: number
    sourceTerminalSepFrame: number
    jointTerminalSepFrame: number
    terminalPulExtendedFrames: number
  }
}

export interface V5PJointHOptions {
  referenceTerminalPlacementMode?: 'phone' | 'pul' | 'sentence' | 'unknown' | 'user'
  targetTerminalPlacementMode?: 'phone' | 'pul' | 'sentence' | 'unknown' | 'user'
}

export function compileV5PJointHTransport(
  referenceTokens: number[],
  targetTokens: number[],
  frameMap: V5PABFrameMap,
  options: V5PJointHOptions = {},
): V5PJointHTransport {
  validateDense(referenceTokens, frameMap.reference.ownedFrameCount, 'A')
  validateDense(targetTokens, frameMap.target.ownedFrameCount, 'B')
  const referenceTerminal = terminalStructure(
    referenceTokens,
    'A',
    options.referenceTerminalPlacementMode ?? 'user',
  )
  const targetTerminal = terminalStructure(
    targetTokens,
    'B',
    options.targetTerminalPlacementMode ?? 'user',
  )
  const firstLyricLocalFrame = targetTokens.findIndex(isLyricToken)
  if (firstLyricLocalFrame < 0) throw new Error('B dense H 没有发音 token')
  if (targetTokens.slice(0, firstLyricLocalFrame).some(token => token !== 0)) {
    throw new Error('B 第一枚发音 token 前存在无法归属的 SEP/PUL')
  }

  const referenceJointSep = frameMap.bOffsetFrame + firstLyricLocalFrame - 1
  const targetJointSep = frameMap.totalFrameCount - 1
  const tokens = Array(frameMap.totalFrameCount).fill(0)
  copyLocal(tokens, referenceTokens, 0, referenceTerminal.sepFrame, 'A')
  copyLocal(tokens, targetTokens, frameMap.bOffsetFrame, targetTerminal.sepFrame, 'B')
  const referencePulExtension = extendTerminalPul(
    tokens,
    referenceTerminal,
    referenceTerminal.sepFrame,
    referenceJointSep,
    'A',
  )
  const targetSourceSepJoint = frameMap.bOffsetFrame + targetTerminal.sepFrame
  const targetPulExtension = extendTerminalPul(
    tokens,
    targetTerminal,
    targetSourceSepJoint,
    targetJointSep,
    'B',
  )
  place(tokens, referenceJointSep, SEP, 'A terminal SEP')
  place(tokens, targetJointSep, SEP, 'B terminal SEP')

  const expectedStructuralCount = count(referenceTokens, SEP) + count(targetTokens, SEP)
  if (count(tokens, SEP) !== expectedStructuralCount) throw new Error('joint H 改变了 SEP 数量')
  const inputLyrics = [...referenceTokens, ...targetTokens].filter(isLyricToken)
  const jointLyrics = tokens.filter(isLyricToken)
  if (inputLyrics.length !== jointLyrics.length || inputLyrics.some((token, index) => token !== jointLyrics[index])) {
    throw new Error('joint H 改变了用户发音 token 序列')
  }
  return {
    schema: 'aisvc.v5p-joint-h.v1',
    tokens,
    policy: 'training-context-terminal-sep.v1',
    reference: {
      terminalPlacementMode: referenceTerminal.placementMode,
      sourceTerminalSepFrame: referenceTerminal.sepFrame,
      jointTerminalSepFrame: referenceJointSep,
      terminalPulExtendedFrames: referencePulExtension,
    },
    target: {
      terminalPlacementMode: targetTerminal.placementMode,
      firstLyricLocalFrame,
      sourceTerminalSepFrame: targetTerminal.sepFrame,
      jointTerminalSepFrame: targetJointSep,
      terminalPulExtendedFrames: targetPulExtension,
    },
  }
}

function validateDense(tokens: number[], expectedLength: number, label: 'A' | 'B'): void {
  if (!Array.isArray(tokens) || tokens.length !== expectedLength) {
    throw new Error(`${label} dense H 长度与 frame contract 不一致`)
  }
  if (tokens.some(token => !Number.isInteger(token) || token < 0 || token > PUL || token === 364)) {
    throw new Error(`${label} dense H 含非法 token`)
  }
}

function terminalStructure(
  tokens: number[],
  label: 'A' | 'B',
  placementMode: V5PJointHOptions['referenceTerminalPlacementMode'],
) {
  if (placementMode === 'sentence' || placementMode === 'unknown') {
    throw new Error(`${label} terminal H 是 ${placementMode} placement，不能按 phone/PUL 规则重定位`)
  }
  const sepFrame = tokens.lastIndexOf(SEP)
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
    extendPul: sepFrame > 0 && tokens[sepFrame - 1] === PUL,
    placementMode: placementMode ?? 'user',
  }
}

function copyLocal(
  joint: number[],
  local: number[],
  offset: number,
  skippedFrame: number,
  label: 'A' | 'B',
): void {
  for (let frame = 0; frame < local.length; frame++) {
    const token = local[frame]
    if (token === 0 || frame === skippedFrame) continue
    place(joint, offset + frame, token, `${label} H`)
  }
}

function extendTerminalPul(
  tokens: number[],
  terminal: { extendPul: boolean },
  sourceSepFrame: number,
  targetSepFrame: number,
  label: 'A' | 'B',
): number {
  if (!terminal.extendPul) return 0
  if (targetSepFrame < sourceSepFrame) throw new Error(`${label} terminal SEP 无法向前重定位`)
  for (let frame = sourceSepFrame; frame < targetSepFrame; frame++) {
    place(tokens, frame, PUL, `${label} terminal PUL`)
  }
  return targetSepFrame - sourceSepFrame
}

function place(tokens: number[], frame: number, token: number, label: string): void {
  if (!Number.isInteger(frame) || frame < 0 || frame >= tokens.length) throw new Error(`${label} 越过 joint frame contract`)
  if (tokens[frame] !== 0) throw new Error(`${label} 与已有 H token 冲突`)
  tokens[frame] = token
}

function isLyricToken(token: number): boolean {
  return token > 0 && token !== SEP && token !== PUL
}

function count(tokens: number[], token: number): number {
  return tokens.reduce((total, value) => total + Number(value === token), 0)
}

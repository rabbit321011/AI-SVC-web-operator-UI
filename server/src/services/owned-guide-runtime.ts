import crypto from 'crypto'
import fs from 'fs'

export interface OwnedGuideWavContract {
  sampleRate: number
  sampleCount: number
  frameCount: number
  sha256: string
}

export function verifyOwnedGuideWav(
  filePath: string,
  expectedSHA256: string,
  expectedFrameCount: number,
): OwnedGuideWavContract {
  if (!fs.existsSync(filePath)) throw new Error(`Owned Guide WAV 不存在: ${filePath}`)
  const buffer = fs.readFileSync(filePath)
  const { sampleRate, sampleCount } = readWavContract(buffer)
  if (sampleRate !== 44100) throw new Error(`Owned Guide 必须是 44100 Hz，实际为 ${sampleRate}`)
  const frameCount = Math.floor(sampleCount / 2048)
  if (frameCount !== expectedFrameCount) {
    throw new Error(`Owned Guide frameCount 不一致：${frameCount} != ${expectedFrameCount}`)
  }
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')
  if (sha256 !== expectedSHA256.toLowerCase()) {
    throw new Error(`Owned Guide SHA256 不一致：${sha256} != ${expectedSHA256.toLowerCase()}`)
  }
  return { sampleRate, sampleCount, frameCount, sha256 }
}

function readWavContract(buffer: Buffer): Pick<OwnedGuideWavContract, 'sampleRate' | 'sampleCount'> {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Owned Guide 不是有效 WAV')
  }
  let offset = 12
  let sampleRate = 0
  let channels = 0
  let bitsPerSample = 0
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4)
    const chunkSize = buffer.readUInt32LE(offset + 4)
    const body = offset + 8
    if (chunkId === 'fmt ' && chunkSize >= 16) {
      channels = buffer.readUInt16LE(body + 2)
      sampleRate = buffer.readUInt32LE(body + 4)
      bitsPerSample = buffer.readUInt16LE(body + 14)
    }
    if (chunkId === 'data') {
      const bytesPerFrame = channels * bitsPerSample / 8
      if (!sampleRate || !Number.isInteger(bytesPerFrame) || bytesPerFrame < 1) throw new Error('Owned Guide WAV fmt 无效')
      return { sampleRate, sampleCount: Math.floor(chunkSize / bytesPerFrame) }
    }
    offset = body + chunkSize + (chunkSize % 2)
  }
  throw new Error('Owned Guide WAV 缺少 data chunk')
}

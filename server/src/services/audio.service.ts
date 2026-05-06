import fs from 'fs'
import path from 'path'

interface CombineRequest {
  segments: Array<{
    sourceFile: string
    srcStartSample: number
    srcEndSample: number
    timelineStart: number
  }>
  sampleRate: number
  outputPath: string
  totalDuration: number
}

export function combineSegments(req: CombineRequest): string {
  const dir = path.dirname(req.outputPath)
  fs.mkdirSync(dir, { recursive: true })

  // Build a raw PCM buffer for the combined audio
  const bytesPerSample = 2 // 16-bit
  const totalSamples = Math.round(req.totalDuration * req.sampleRate)
  const totalBytes = totalSamples * bytesPerSample
  const output = Buffer.alloc(totalBytes)

  // Cache: sourceFile → raw PCM buffer
  const pcmCache = new Map<string, Buffer>()

  for (const seg of req.segments) {
    if (!pcmCache.has(seg.sourceFile)) {
      pcmCache.set(seg.sourceFile, fs.readFileSync(seg.sourceFile))
    }
    const pcm = pcmCache.get(seg.sourceFile)!
    const dataOffset = findDataOffset(pcm)
    const srcStart = dataOffset + seg.srcStartSample * bytesPerSample
    const srcEnd = dataOffset + seg.srcEndSample * bytesPerSample
    const segSamples = seg.srcEndSample - seg.srcStartSample
    const segBytes = segSamples * bytesPerSample

    const targetStart = Math.round(seg.timelineStart * req.sampleRate) * bytesPerSample

    if (targetStart + segBytes <= totalBytes) {
      pcm.copy(output, targetStart, srcStart, srcEnd)
    }
  }

  // Write WAV header
  const wavPath = req.outputPath
  const fd = fs.openSync(wavPath, 'w')
  writeWav(fd, output, req.sampleRate, 1, 16)
  fs.closeSync(fd)

  return wavPath
}

function findDataOffset(buf: Buffer): number {
  let offset = 36
  while (offset < buf.length - 8) {
    const chunkId = buf.toString('ascii', offset, offset + 4)
    const chunkSize = buf.readUInt32LE(offset + 4)
    if (chunkId === 'data') return offset + 8
    offset += 8 + chunkSize
  }
  return 44 // fallback: assume standard header
}

function writeWav(fd: number, pcmData: Buffer, sampleRate: number, numChannels: number, bitsPerSample: number) {
  const byteRate = sampleRate * numChannels * bitsPerSample / 8
  const blockAlign = numChannels * bitsPerSample / 8
  const dataSize = pcmData.length

  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataSize, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM format
  header.writeUInt16LE(numChannels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36)
  header.writeUInt32LE(dataSize, 40)

  fs.writeSync(fd, header)
  fs.writeSync(fd, pcmData)
}

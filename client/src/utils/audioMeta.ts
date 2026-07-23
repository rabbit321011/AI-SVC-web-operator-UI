export interface AudioBlobMeta {
  sampleRate: number
  totalSamples: number
  duration: number
  channels: number
}

const cache = new WeakMap<Blob, Promise<AudioBlobMeta>>()

export function getAudioBlobMeta(blob: Blob): Promise<AudioBlobMeta> {
  const cached = cache.get(blob)
  if (cached) return cached
  const pending = readAudioBlobMeta(blob)
  cache.set(blob, pending)
  return pending
}

async function readAudioBlobMeta(blob: Blob): Promise<AudioBlobMeta> {
  const header = await blob.slice(0, Math.min(blob.size, 1024 * 1024)).arrayBuffer()
  const wav = parseWavMeta(header)
  if (wav) return wav

  const root = globalThis as typeof globalThis & { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
  const AudioContextCtor = root.AudioContext || root.webkitAudioContext
  if (AudioContextCtor) {
    const audioCtx = new AudioContextCtor()
    try {
      const audioBuf = await audioCtx.decodeAudioData(await blob.arrayBuffer())
      return {
        sampleRate: audioBuf.sampleRate,
        totalSamples: Math.round(audioBuf.duration * audioBuf.sampleRate),
        duration: audioBuf.duration,
        channels: audioBuf.numberOfChannels,
      }
    } finally {
      audioCtx.close()
    }
  }

  return { sampleRate: 44100, totalSamples: Math.max(1, Math.round(blob.size / 2)), duration: Math.max(0.001, blob.size / 88200), channels: 1 }
}

function parseWavMeta(buffer: ArrayBuffer): AudioBlobMeta | null {
  const view = new DataView(buffer)
  if (view.byteLength < 44 || readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') return null

  let offset = 12
  let sampleRate = 0
  let channels = 0
  let bitsPerSample = 16
  let dataBytes = 0

  while (offset + 8 <= view.byteLength) {
    const id = readAscii(view, offset, 4)
    const size = view.getUint32(offset + 4, true)
    const dataOffset = offset + 8
    if (id === 'fmt ' && dataOffset + 16 <= view.byteLength) {
      channels = view.getUint16(dataOffset + 2, true)
      sampleRate = view.getUint32(dataOffset + 4, true)
      bitsPerSample = view.getUint16(dataOffset + 14, true)
    } else if (id === 'data') {
      dataBytes = size
      break
    }
    offset = dataOffset + size + (size % 2)
  }

  if (!sampleRate || !channels || !dataBytes || !bitsPerSample) return null
  const bytesPerFrame = channels * bitsPerSample / 8
  const totalSamples = Math.max(1, Math.floor(dataBytes / Math.max(1, bytesPerFrame)))
  return { sampleRate, totalSamples, duration: totalSamples / sampleRate, channels }
}

function readAscii(view: DataView, offset: number, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(offset + i))
  return out
}

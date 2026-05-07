export function float32ToWavBlob(samples: Float32Array, sampleRate: number): Blob {
  const numChannels = 1
  const bitsPerSample = 16
  const byteRate = sampleRate * numChannels * bitsPerSample / 8
  const blockAlign = numChannels * bitsPerSample / 8
  const dataSize = samples.length * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
    offset += 2
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i))
  }
}

export async function combineSegmentsToBlob(
  segments: Array<{ blob: Blob; startSample: number; endSample: number; timelineStart: number; sampleRate: number; volume?: number }>,
  totalDuration: number,
  outputSampleRate: number,
  minTimelineStart: number = 0,
): Promise<Blob> {
  const totalSamples = Math.round(totalDuration * outputSampleRate)
  const combined = new Float32Array(totalSamples)

  for (const seg of segments) {
    const audioCtx = new AudioContext()
    try {
      const buf = await seg.blob.arrayBuffer()
      const audioBuf = await audioCtx.decodeAudioData(buf)
      const channel = audioBuf.getChannelData(0)
      const actualSr = audioBuf.sampleRate
      const vol = seg.volume ?? 1

      const startActual = seg.startSample * (actualSr / seg.sampleRate)
      const srcLenActual = (seg.endSample - seg.startSample) * (actualSr / seg.sampleRate)
      const segDurationSec = srcLenActual / actualSr
      const segLenOut = Math.round(segDurationSec * outputSampleRate)
      const targetStart = Math.round((seg.timelineStart - minTimelineStart) * outputSampleRate)

      for (let i = 0; i < segLenOut && (targetStart + i) < totalSamples; i++) {
        const t = i / Math.max(1, segLenOut - 1)
        const srcIdx = Math.round(startActual + t * srcLenActual)
        if (srcIdx >= 0 && srcIdx < channel.length) {
          combined[targetStart + i] += channel[srcIdx] * vol
        }
      }
    } finally {
      audioCtx.close()
    }
  }

  return float32ToWavBlob(combined, outputSampleRate)
}

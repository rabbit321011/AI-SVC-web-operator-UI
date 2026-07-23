import fs from 'node:fs'
import process from 'node:process'
import WebSocket from 'ws'

const inputWav = process.argv[2]
if (!inputWav) {
  throw new Error('usage: node smoke_whisper_sofa.mjs <input.wav>')
}

const jobId = `sofa-smoke-${Date.now().toString(36)}`
const ws = new WebSocket('ws://127.0.0.1:8101/ws/svc')
let alignedResult = null

const done = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Whisper -> SOFA smoke timed out')), 300_000)

  ws.on('message', raw => {
    const message = JSON.parse(raw.toString())
    if (message.type === 'log') {
      console.log(`[${message.stage || 'pipeline'}] ${String(message.message || '').trim()}`)
    }
    if (message.type === 'progress') {
      console.log(`[progress] ${message.stage}: ${Number(message.progress).toFixed(1)}%`)
    }
    if (message.type === 'result') {
      if (message.alignmentMethod !== 'SOFA_JPN_Test2_Plus_full_segment') {
        reject(new Error(`unexpected alignment method: ${message.alignmentMethod}`))
        return
      }
      const segments = message.textObject?.text?.segments
      if (!Array.isArray(segments) || segments.length === 0) {
        reject(new Error('SOFA result has no TextObject segments'))
        return
      }
      if (!segments.every(segment => segment.alignmentMethod === message.alignmentMethod)) {
        reject(new Error('TextObject contains a non-SOFA segment'))
        return
      }
      if (!Array.isArray(message.words) || message.words.length !== segments.length
        || !Array.isArray(message.phones) || message.phones.length === 0) {
        reject(new Error('SOFA result is missing words or phones'))
        return
      }
      if (!intervalsAreValid(message.words) || !intervalsAreValid(message.phones)) {
        reject(new Error('SOFA result contains invalid or overlapping intervals'))
        return
      }
      if (!segments.every((segment, index) => (
        segment.start === message.words[index].start && segment.end === message.words[index].end
      ))) {
        reject(new Error('TextObject phrase intervals do not match SOFA words'))
        return
      }
      if (typeof message.outputFile !== 'string' || !fs.existsSync(message.outputFile)) {
        reject(new Error('SOFA result JSON file is missing'))
        return
      }
      alignedResult = message
    }
    if (message.type === 'error') reject(new Error(message.message || 'pipeline failed'))
    if (message.type === 'done') {
      if (!alignedResult) {
        reject(new Error('pipeline completed without an aligned SOFA result'))
        return
      }
      clearTimeout(timeout)
      resolve(alignedResult)
    }
  })
  ws.on('error', reject)
})

await new Promise((resolve, reject) => {
  ws.once('open', resolve)
  ws.once('error', reject)
})
ws.send(JSON.stringify({ type: 'register', jobId }))
await new Promise(resolve => setTimeout(resolve, 100))

const response = await fetch('http://127.0.0.1:8101/api/whisper/run', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jobId,
    inputWav,
    outputName: 'whisper_sofa_e2e',
    language: 'ja',
    vad: true,
    device: 'cuda',
    computeType: 'float16',
  }),
})
if (!response.ok) {
  throw new Error(`HTTP ${response.status}: ${await response.text()}`)
}

try {
  const result = await done
  console.log(JSON.stringify({
    ok: true,
    jobId,
    alignmentMethod: result.alignmentMethod,
    confidence: result.confidence,
    phrases: result.textObject.text.segments.length,
    words: result.words.length,
    phones: result.phones.length,
    outputFile: result.outputFile,
  }, null, 2))
} finally {
  ws.close()
}

function intervalsAreValid(intervals) {
  let previousEnd = -1
  return intervals.every(interval => {
    const start = Number(interval?.start)
    const end = Number(interval?.end)
    if (!Number.isFinite(start) || !Number.isFinite(end)
      || start < 0 || end <= start || start < previousEnd - 1e-3) return false
    previousEnd = end
    return true
  })
}

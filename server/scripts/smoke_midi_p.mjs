import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import WebSocket from 'ws'

const inputWav = path.resolve(process.argv[2] || '')
const frameCount = Number(process.argv[3] || 64)
const guideSHA256 = process.argv[4] || sha256File(inputWav)
const jobId = `midi-p-smoke-${Date.now().toString(36)}`
const ws = new WebSocket('ws://127.0.0.1:8101/ws/svc')
await new Promise((resolve, reject) => {
  ws.once('open', resolve)
  ws.once('error', reject)
})
ws.send(JSON.stringify({ type: 'register', jobId }))
await new Promise(resolve => setTimeout(resolve, 100))

const done = new Promise((resolve, reject) => {
  ws.on('message', raw => {
    const message = JSON.parse(raw.toString())
    if (message.type === 'error') reject(new Error(message.message || 'MIDI-P failed'))
    if (message.type === 'done') resolve(message)
  })
  ws.once('close', () => reject(new Error('MIDI-P WebSocket closed')))
})

const response = await fetch('http://127.0.0.1:8101/api/synthesis/midi-p/run', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jobId,
    inputWav,
    guideSHA256,
    frameCount,
    midiPRevision: 0,
    device: 'cuda:0',
  }),
})
if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`)
const completed = await done
console.log(JSON.stringify({ ok: true, jobId, ...completed }, null, 2))
ws.close()

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

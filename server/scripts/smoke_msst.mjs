import fs from 'node:fs'
import path from 'node:path'
import WebSocket from 'ws'

const inputWav = path.resolve(process.argv[2] || '')
const model = process.argv[3] || 'duality'
const jobId = `msst-smoke-${Date.now().toString(36)}`
const outputDir = path.join(path.dirname(inputWav), `msst-resident-${jobId}`)
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
    if (message.type === 'error') reject(new Error(message.message || 'MSST failed'))
    if (message.type === 'done') resolve(message)
  })
  ws.once('close', () => reject(new Error('MSST WebSocket closed')))
})

const response = await fetch('http://127.0.0.1:8101/api/msst/run', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jobId, inputWav, model, device: 'cuda' }),
})
if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`)
const completed = await done
console.log(JSON.stringify({ ok: true, jobId, outputs: completed.outputs, outputDir }, null, 2))
ws.close()

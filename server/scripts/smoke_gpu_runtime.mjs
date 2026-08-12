import fs from 'node:fs'
import path from 'node:path'
import WebSocket from 'ws'

const root = 'E:/AIscene/AISVC-midi-web'
const api = process.env.AISVC_API || 'http://127.0.0.1:8101'
const wsUrl = process.env.AISVC_WS || 'ws://127.0.0.1:8101/ws/svc'
const fixture = findCompletedV5pJob()
const manifest = JSON.parse(fs.readFileSync(fixture, 'utf8'))
const jobId = process.argv[2] || `gpu-runtime-smoke-${Date.now().toString(36)}`
const request = {
  jobId,
  presetId: manifest.preset.id,
  referenceWav: manifest.inputs.referenceWav,
  targetWav: manifest.inputs.targetWav,
  snapshot: JSON.parse(manifest.snapshotCanonical),
  steps: Number(process.argv[3] || 1),
  cfg: manifest.render.cfg,
  seed: manifest.render.seed,
  device: manifest.render.device,
}

const socket = new WebSocket(wsUrl)
await new Promise((resolve, reject) => {
  socket.once('open', resolve)
  socket.once('error', reject)
})
socket.send(JSON.stringify({ type: 'register', jobId }))
const response = await fetch(`${api}/api/synthesis/v5p/run`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(request),
})
if (!response.ok) throw new Error(await response.text())
console.log(JSON.stringify({ type: 'started', jobId, fixture }))

await new Promise((resolve, reject) => {
  socket.on('message', data => {
    const message = JSON.parse(data.toString())
    console.log(JSON.stringify(message))
    if (message.type === 'done') resolve()
    if (message.type === 'error') reject(new Error(message.message || 'GPU runtime smoke failed'))
  })
  socket.once('close', () => reject(new Error('GPU runtime smoke socket closed')))
})
socket.close()

function findCompletedV5pJob() {
  const candidates = fs.readdirSync(path.join(root, 'data'), { withFileTypes: true })
    .filter(item => item.isDirectory() && /^render_.+_v5p$/.test(item.name))
    .map(item => path.join(root, 'data', item.name, 'job.json'))
    .filter(file => fs.existsSync(file) && fs.existsSync(path.join(path.dirname(file), 'result.json')))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)
  if (!candidates[0]) throw new Error('No completed V5-P job fixture found under data/')
  return candidates[0]
}

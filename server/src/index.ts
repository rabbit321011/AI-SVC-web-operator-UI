import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
import http from 'http'
import { spawn } from 'child_process'
import { WebSocketServer, WebSocket } from 'ws'
import { runSvc } from './services/svc.service.js'

const app = express()
app.use(cors())
app.use(express.json({ limit: '500mb' }))

const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws/svc' })

// Store active SVC jobs
const svcJobs = new Map<string, WebSocket>()

wss.on('connection', (ws: WebSocket) => {
  console.log('[WS] client connected')
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString())
      console.log('[WS] message:', msg)
      if (msg.type === 'register' && msg.jobId) {
        svcJobs.set(msg.jobId, ws)
        console.log(`[WS] registered job ${msg.jobId}`)
      }
    } catch {}
  })
})

function readWavMeta(filePath: string) {
  const buf = fs.readFileSync(filePath)
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error('Not a valid WAV file')
  }
  const format = buf.toString('ascii', 8, 12)
  if (format !== 'WAVE') throw new Error('Not WAVE format')

  // Parse fmt chunk properly
  let fmtOffset = 12
  let numChannels = 1, sampleRate = 44100, bitsPerSample = 16, byteRate = 0

  while (fmtOffset < buf.length - 8) {
    const chunkId = buf.toString('ascii', fmtOffset, fmtOffset + 4)
    const chunkSize = buf.readUInt32LE(fmtOffset + 4)

    if (chunkId === 'fmt ') {
      const fmtDataStart = fmtOffset + 8
      const audioFormat = buf.readUInt16LE(fmtDataStart)
      numChannels = buf.readUInt16LE(fmtDataStart + 2)
      sampleRate = buf.readUInt32LE(fmtDataStart + 4)
      byteRate = buf.readUInt32LE(fmtDataStart + 8)

      if (chunkSize >= 16) {
        bitsPerSample = buf.readUInt16LE(fmtDataStart + 14)
      }

      // For extended fmt (size >= 18), bitsPerSample is at offset + 16
      if (chunkSize >= 18) {
        const cbSize = buf.readUInt16LE(fmtDataStart + 16)
        if (cbSize === 22 && chunkSize >= 40) {
          // WAVE_FORMAT_EXTENSIBLE, bitsPerSample at offset + 18
          bitsPerSample = buf.readUInt16LE(fmtDataStart + 18)
        }
      }
    } else if (chunkId === 'data') {
      const dataBytes = chunkSize
      const bytesPerSample = numChannels * bitsPerSample / 8
      const totalSamples = Math.floor(dataBytes / bytesPerSample)
      const duration = totalSamples / sampleRate
      return {
        sampleRate, numChannels, bitsPerSample, totalSamples, duration,
        byteRate, dataOffset: fmtOffset + 8, dataBytes,
        path: filePath,
      }
    }

    fmtOffset += 8 + chunkSize
    if (chunkSize % 2 !== 0) fmtOffset++ // pad byte
  }

  throw new Error('No data chunk found')
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() })
})

// Demo audio endpoints
const DEMO_WAV = path.resolve('E:/AIscene/RIPX-OUT/BV1SBk7BBESE_Vocals_dry_dry.wav')

app.get('/api/demo/info', (_req, res) => {
  try {
    const meta = readWavMeta(DEMO_WAV)
    res.json(meta)
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/demo/audio', (_req, res) => {
  if (!fs.existsSync(DEMO_WAV)) {
    res.status(404).json({ error: 'demo wav not found' })
    return
  }
  res.setHeader('Content-Type', 'audio/wav')
  fs.createReadStream(DEMO_WAV).pipe(res)
})

// Demo F0 data (extracted on first request, cached to disk)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const PROJECTS_DIR = path.join(PROJECT_ROOT, 'projects')
const DEMO_F0_CACHE = path.join(PROJECT_ROOT, 'data', 'demo_f0.json')
const PYTHON_EXE = 'E:/AIscene/AISVCs/.venv/Scripts/python.exe'
const F0_SCRIPT = path.join(PROJECT_ROOT, 'server', 'scripts', 'f0_extract.py')

app.get('/api/demo/f0', (_req, res) => {
  if (fs.existsSync(DEMO_F0_CACHE)) {
    const cached = fs.readFileSync(DEMO_F0_CACHE, 'utf-8')
    res.setHeader('Content-Type', 'application/json')
    res.send(cached)
    return
  }

  // Extract F0 on-the-fly
  const child = spawn(PYTHON_EXE, [F0_SCRIPT, DEMO_WAV], { cwd: path.resolve('server/scripts') })

  let stdout = ''
  let stderr = ''

  child.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
  child.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

  child.on('close', (code: number) => {
    if (code !== 0) {
      res.status(500).json({ error: `F0 extraction failed: ${stderr}` })
      return
    }
    try {
      const parsed = JSON.parse(stdout)
      fs.mkdirSync(path.dirname(DEMO_F0_CACHE), { recursive: true })
      fs.writeFileSync(DEMO_F0_CACHE, JSON.stringify(parsed))
      res.json(parsed)
    } catch (e: any) {
      res.status(500).json({ error: e.message })
    }
  })
})

// Generic F0 extraction (used for SVC result tracks)
app.get('/api/f0', (req, res) => {
  const wavPath = req.query.path as string
  if (!wavPath || !fs.existsSync(wavPath)) {
    res.status(400).json({ error: 'missing or invalid path' })
    return
  }

  const cachePath = wavPath.replace(/\.wav$/i, '_f0.json')
  if (fs.existsSync(cachePath)) {
    const cached = fs.readFileSync(cachePath, 'utf-8')
    res.setHeader('Content-Type', 'application/json')
    res.send(cached)
    return
  }

  const child = spawn(PYTHON_EXE, [F0_SCRIPT, wavPath], { cwd: path.dirname(F0_SCRIPT) })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
  child.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
  child.on('close', (code: number) => {
    if (code !== 0) {
      res.status(500).json({ error: `F0 extraction failed: ${stderr}` })
      return
    }
    try {
      const parsed = JSON.parse(stdout)
      fs.writeFileSync(cachePath, JSON.stringify(parsed))
      res.json(parsed)
    } catch (e: any) {
      res.status(500).json({ error: e.message })
    }
  })
})

// F0 extraction from uploaded WAV (base64)
app.post('/api/f0/extract', (req, res) => {
  const { wavBase64, sourceFile, sampleRate } = req.body
  if (!wavBase64) {
    res.status(400).json({ error: 'missing wavBase64' })
    return
  }
  try {
    const dataDir = path.join(PROJECT_ROOT, 'data', 'f0_temp')
    fs.mkdirSync(dataDir, { recursive: true })
    const tempWav = path.join(dataDir, `upload_${Date.now()}.wav`)
    fs.writeFileSync(tempWav, Buffer.from(wavBase64, 'base64'))

    const child = spawn(PYTHON_EXE, [F0_SCRIPT, tempWav], { cwd: path.dirname(F0_SCRIPT) })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    child.on('close', (code: number) => {
      try { fs.unlinkSync(tempWav) } catch {}
      if (code !== 0) {
        res.status(500).json({ error: `F0 extraction failed: ${stderr}` })
        return
      }
      try {
        res.json(JSON.parse(stdout))
      } catch (e: any) {
        res.status(500).json({ error: e.message })
      }
    })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// F0 extraction for overlap region
app.post('/api/f0/extract-overlap', (req, res) => {
  const { wavBase64, startSec, endSec } = req.body
  if (!wavBase64 || startSec == null || endSec == null) {
    res.status(400).json({ error: 'missing wavBase64, startSec, or endSec' })
    return
  }
  try {
    const dataDir = path.join(PROJECT_ROOT, 'data', 'f0_temp')
    fs.mkdirSync(dataDir, { recursive: true })
    const tempWav = path.join(dataDir, `overlap_${Date.now()}.wav`)
    fs.writeFileSync(tempWav, Buffer.from(wavBase64, 'base64'))

    const child = spawn(PYTHON_EXE, [
      F0_SCRIPT, tempWav,
      '--start', String(startSec),
      '--end', String(endSec),
    ], { cwd: path.dirname(F0_SCRIPT) })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    child.on('close', (code: number) => {
      try { fs.unlinkSync(tempWav) } catch {}
      if (code !== 0) {
        res.status(500).json({ error: `F0 overlap extraction failed: ${stderr}` })
        return
      }
      try {
        res.json(JSON.parse(stdout))
      } catch (e: any) {
        res.status(500).json({ error: e.message })
      }
    })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/audio/info', (req, res) => {
  const filePath = req.query.path as string
  if (!filePath) {
    res.status(400).json({ error: 'missing path parameter' })
    return
  }
  try {
    const meta = readWavMeta(filePath)
    res.json(meta)
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

app.post('/api/combine', (req, res) => {
  const { groupId, wavBase64, sampleRate } = req.body
  console.log(`[API] /combine groupId=${groupId} wavBase64.len=${wavBase64?.length ?? 0}`)
  if (!groupId || !wavBase64) {
    res.status(400).json({ error: 'missing groupId or wavBase64' })
    return
  }
  try {
    const dataDir = path.resolve(PROJECT_ROOT, 'data', groupId)
    fs.mkdirSync(dataDir, { recursive: true })
    const outPath = path.join(dataDir, 'combined.wav')
    const buf = Buffer.from(wavBase64, 'base64')
    fs.writeFileSync(outPath, buf)
    console.log(`[API] /combine written ${buf.length} bytes to ${outPath}`)
    res.json({ path: outPath, sampleRate: sampleRate || 44100 })
  } catch (e: any) {
    console.error(`[API] /combine error:`, e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/svc/run', (req, res) => {
  const { jobId: clientJobId, combinedWav, targetWav, checkpoint, configYml, diffusionSteps, inferenceCfgRate, f0Condition, semiToneShift, device, fp16, compGroupId } = req.body

  console.log(`[API] /svc/run jobId=${clientJobId} combinedWav=${combinedWav} target=${targetWav} checkpoint=${checkpoint}`)

  if (!combinedWav || !checkpoint || !configYml) {
    res.status(400).json({ error: 'missing required fields' })
    return
  }

  const jobId = clientJobId || crypto.randomUUID().slice(0, 8)
  const expname = `svc_${jobId}`

  // Send immediate response
  res.json({ jobId, status: 'started' })

  // Frontend registers WS before sending this request, so jobId should be found.
  // If not found (race/edge case), schedule with the jobId as key and wait briefly.
  function tryRun() {
    const ws = svcJobs.get(jobId)
    if (ws) {
      console.log(`[SVC] job ${jobId} started, WS found`)
      runSvc({
        sourceWav: combinedWav,
        targetWav: targetWav || '',
        checkpoint,
        configYml,
        diffusionSteps: diffusionSteps || 100,
        inferenceCfgRate: inferenceCfgRate || 0.7,
        f0Condition: f0Condition ?? true,
        semiToneShift: semiToneShift ?? null,
        device: device || '0',
        fp16: fp16 ?? true,
        expname,
        outputDir: '',
      }, ws)
      return true
    }
    return false
  }

  if (!tryRun()) {
    console.log(`[SVC] job ${jobId} waiting for WS registration...`)
    setTimeout(() => {
      if (!tryRun()) {
        console.error(`[SVC] job ${jobId} WS never connected`)
      }
    }, 2000)
  }
})

app.get('/api/svc/result/:jobId.wav', (req, res) => {
  const expname = `svc_${req.params.jobId}`
  const outDir = path.resolve('E:/AIscene/AISVCs/YingMusic-SVC/outputs', expname)
  if (!fs.existsSync(outDir)) {
    res.status(404).json({ error: 'output not found' })
    return
  }
  const files = fs.readdirSync(outDir).filter(f => f.endsWith('.wav'))
  if (files.length === 0) {
    res.status(404).json({ error: 'no wav output' })
    return
  }
  const filePath = path.join(outDir, files[0])
  res.setHeader('Content-Type', 'audio/wav')
  fs.createReadStream(filePath).pipe(res)
})

const PORT = 8101

// ── P10: Project management APIs ──

function projectDir(name: string) { return path.join(PROJECTS_DIR, sanitizeName(name)) }
function sanitizeName(name: string) { return name.replace(/[<>:"/\\|?*]/g, '_').slice(0, 60) }
function projectJsonPath(name: string) { return path.join(projectDir(name), 'project.json') }
function blobsDir(name: string) { return path.join(projectDir(name), 'blobs') }

app.get('/api/projects', (_req, res) => {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true })
  const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
  const projects = entries
    .filter(e => e.isDirectory() && fs.existsSync(path.join(PROJECTS_DIR, e.name, 'project.json')))
    .map(e => {
      const stat = fs.statSync(path.join(PROJECTS_DIR, e.name, 'project.json'))
      return { name: e.name, modifiedAt: stat.mtime.toISOString() }
    })
    .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())
  res.json(projects)
})

app.post('/api/projects', (req, res) => {
  const { name } = req.body
  if (!name?.trim()) { res.status(400).json({ error: 'name required' }); return }
  const safe = sanitizeName(name.trim())
  const dir = projectDir(safe)
  if (fs.existsSync(dir)) { res.status(409).json({ error: 'project exists' }); return }
  fs.mkdirSync(dir, { recursive: true })
  fs.mkdirSync(blobsDir(safe), { recursive: true })
  const project = {
    id: crypto.randomUUID(),
    name: safe,
    version: '1.0.0',
    tracks: {}, trackOrder: [], segments: {},
    compGroups: {}, compGroupOrder: [],
    timelineOffset: 0, pxPerSec: 60,
    f0Settings: { fmin: 65.4, fmax: 2093, algorithm: 'pyin', hopMs: 16 },
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  }
  fs.writeFileSync(projectJsonPath(safe), JSON.stringify(project, null, 2))
  res.json(project)
})

app.get('/api/projects/:name', (req, res) => {
  const p = projectJsonPath(req.params.name)
  if (!fs.existsSync(p)) { res.status(404).json({ error: 'not found' }); return }
  try {
    const json = JSON.parse(fs.readFileSync(p, 'utf-8'))
    const bDir = blobsDir(req.params.name)
    const blobs: Record<string, string> = {}
    if (fs.existsSync(bDir)) {
      for (const f of fs.readdirSync(bDir)) {
        if (f.endsWith('.blob')) {
          const raw = f.replace(/\.blob$/, '')
          const originalKey = decodeURIComponent(raw)
          blobs[originalKey] = fs.readFileSync(path.join(bDir, f), 'base64')
        }
      }
    }
    json._sourceBlobsBase64 = blobs
    res.json(json)
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

app.put('/api/projects/:name', (req, res) => {
  const { _sourceBlobsBase64, ...project } = req.body
  if (!project.name) { res.status(400).json({ error: 'invalid' }); return }
  const dir = projectDir(req.params.name)
  fs.mkdirSync(dir, { recursive: true })
  const bDir = blobsDir(req.params.name)
  if (_sourceBlobsBase64) {
    fs.mkdirSync(bDir, { recursive: true })
    // Clean old blobs
    for (const f of fs.readdirSync(bDir)) fs.unlinkSync(path.join(bDir, f))
    for (const [k, b64] of Object.entries<string>(_sourceBlobsBase64)) {
      const safeK = encodeURIComponent(k)
      fs.writeFileSync(path.join(bDir, safeK + '.blob'), Buffer.from(b64, 'base64'))
    }
  }
  project.modifiedAt = new Date().toISOString()
  fs.writeFileSync(projectJsonPath(req.params.name), JSON.stringify(project, null, 2))
  res.json({ ok: true })
})

app.post('/api/projects/import', (req, res) => {
  const data = req.body
  if (!data?.name) { res.status(400).json({ error: 'invalid project' }); return }
  const safeName = sanitizeName(data.name)
  let dir = projectDir(safeName)
  let finalName = safeName
  let n = 1
  while (fs.existsSync(dir)) {
    n++
    finalName = `${safeName} (${n})`
    dir = projectDir(finalName)
  }
  fs.mkdirSync(dir, { recursive: true })
  const bDir = blobsDir(finalName)
  const { _sourceBlobsBase64, ...project } = data
  if (_sourceBlobsBase64) {
    fs.mkdirSync(bDir, { recursive: true })
    for (const [k, b64] of Object.entries<string>(_sourceBlobsBase64)) {
      const safeK = encodeURIComponent(k)
      fs.writeFileSync(path.join(bDir, safeK + '.blob'), Buffer.from(b64, 'base64'))
    }
  }
  project.name = finalName
  project.modifiedAt = new Date().toISOString()
  fs.writeFileSync(projectJsonPath(finalName), JSON.stringify(project, null, 2))
  res.json({ name: finalName })
})

app.delete('/api/projects/:name', (req, res) => {
  const dir = projectDir(req.params.name)
  if (!fs.existsSync(dir)) { res.status(404).json({ error: 'not found' }); return }
  fs.rmSync(dir, { recursive: true, force: true })
  res.json({ ok: true })
})

// ── End P10 ──

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log(`WebSocket at ws://localhost:${PORT}/ws/svc`)
})

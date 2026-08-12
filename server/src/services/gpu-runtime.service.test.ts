import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import test from 'node:test'
import { readGpuStatus, registerGpuProcess, releaseGpuProcess } from './gpu-runtime.service.js'

test('CPU processes are not reported as GPU runtimes', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { windowsHide: true })
  registerGpuProcess(child, { id: 'test:cpu', kind: 'test', device: 'cpu' })
  const status = await readGpuStatus()
  assert.equal(status.processes.some(item => item.id === 'test:cpu'), false)
  child.kill()
})

test('registered GPU process can be explicitly released', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { windowsHide: true })
  const id = `test:gpu:${child.pid}`
  registerGpuProcess(child, { id, kind: 'test', modelId: 'fixture', device: 'cuda:0' })
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()))
  const result = await releaseGpuProcess(id)
  assert.equal(result.ok, true)
  await closed
})

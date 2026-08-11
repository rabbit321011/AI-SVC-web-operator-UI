export interface SynthesisV5PResult {
  schema: 'aisvc.v5p-direct-result.v1'
  jobId: string
  snapshotSHA256: string
  outputWav: string
  outputSHA256: string
  sampleRate: 44100
  sampleCount: number
  duration: number
  auditFile: string
  presetId: 'V5P_40K_EMA'
  checkpointSHA256: string
  vaeSHA256: string
  adapterSHA256: string
  seed: number
}

export function readSynthesisV5PResult(message: unknown, expectedJobId: string): SynthesisV5PResult | null {
  if (!isRecord(message) || message.type !== 'v5p-result' || !isRecord(message.result)) return null
  const result = message.result
  if (
    result.schema !== 'aisvc.v5p-direct-result.v1'
    || result.jobId !== expectedJobId
    || result.presetId !== 'V5P_40K_EMA'
    || result.sampleRate !== 44100
  ) return null
  const hashes = ['snapshotSHA256', 'outputSHA256', 'checkpointSHA256', 'vaeSHA256', 'adapterSHA256'] as const
  for (const key of hashes) {
    if (typeof result[key] !== 'string' || !/^[a-f0-9]{64}$/i.test(result[key])) return null
  }
  if (!Number.isSafeInteger(result.sampleCount) || result.sampleCount < 1) return null
  if (!Number.isFinite(result.duration) || result.duration <= 0) return null
  if (!Number.isSafeInteger(result.seed) || result.seed < 0) return null
  if (typeof result.outputWav !== 'string' || typeof result.auditFile !== 'string') return null
  return result as SynthesisV5PResult
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

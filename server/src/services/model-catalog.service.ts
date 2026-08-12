import fs from 'node:fs'
import path from 'node:path'

const PROJECT_ROOT = 'E:/AIscene/AISVC-midi-web'
const SINGER_ROOT = 'E:/AIscene/YingMusic_Singer_Plus'
const SVS_MODELS_PATH = path.join(PROJECT_ROOT, 'server', 'models', 'svs_models.json')
const VRAM_PROFILE_DIR = path.join(PROJECT_ROOT, 'data', 'vram-profile')
const V5P_CHECKPOINT = 'E:/MyProject/重要模型保存/V5P_40K_EMA/step_040000_final.pt'
const MANAGED_SVS_IDS = new Set(['V4Hg_10k', 'V4fg_10k'])

export type CatalogFamily = 'svs' | 'analysis' | 'svc' | 'msst'
export type CatalogEngine = 't1' | 'v4h_phone_pul' | 'v5p_direct' | 'game' | 'whisper' | 'sofa' | 'svc' | 'msst'

export interface ModelCatalogEntry {
  id: string
  family: CatalogFamily
  engine: CatalogEngine
  checkpoint?: string
  vaeCheckpoint?: string
  runtimeState: 'configured' | 'unavailable'
  capabilities: string[]
  vramProfile?: {
    device?: string
    steps?: number
    residentMiB?: number
    peakUsedMiB?: number
    peakDeltaMiB?: number
    sampleSeconds?: number
    measuredAt?: string
    samples?: Array<{
      seconds: number
      peakUsedMiB?: number
      peakDeltaMiB?: number
    }>
  }
}

export function getModelCatalog(): ModelCatalogEntry[] {
  const entries: ModelCatalogEntry[] = []
  try {
    const raw = JSON.parse(fs.readFileSync(SVS_MODELS_PATH, 'utf8')) as Record<string, unknown>
    for (const [id, value] of Object.entries(raw)) {
      if (!MANAGED_SVS_IDS.has(id)) continue
      const preset = typeof value === 'string' ? { checkpoint: value } : value as Record<string, unknown> | null
      if (!preset?.checkpoint) continue
      const engine = preset.engine === 'v4h_phone_pul' ? 'v4h_phone_pul' : 't1'
      const checkpoint = String(preset.checkpoint)
      const vaeCheckpoint = preset.vaeCheckpoint ? String(preset.vaeCheckpoint) : undefined
      entries.push({
        id,
        family: 'svs',
        engine,
        checkpoint,
        vaeCheckpoint,
        runtimeState: fs.existsSync(resolveRuntimePath(checkpoint)) && (!vaeCheckpoint || fs.existsSync(resolveRuntimePath(vaeCheckpoint)))
          ? 'configured'
          : 'unavailable',
        capabilities: engine === 'v4h_phone_pul' ? ['audio-melody', 'phone-pul'] : ['audio-melody', 'midi-melody'],
        vramProfile: readVramProfile(id),
      })
    }
  } catch {
    // The existing SVS endpoint reports the detailed file error. The catalog stays usable for GPU status.
  }
  entries.push({
    id: 'V5P_40K_EMA',
    family: 'svs',
    engine: 'v5p_direct',
    checkpoint: V5P_CHECKPOINT,
    runtimeState: fs.existsSync(V5P_CHECKPOINT) ? 'configured' : 'unavailable',
    capabilities: ['synthesis-unit', 'direct-control', 'midi-p', 'h-token'],
    vramProfile: readVramProfile('V5P_40K_EMA'),
  })
  entries.push(
    { id: 'GAME-1.0-medium', family: 'analysis', engine: 'game', runtimeState: 'configured', capabilities: ['midi-p'], vramProfile: readVramProfile('GAME-1.0-medium') },
    { id: 'Whisper large-v3', family: 'analysis', engine: 'whisper', runtimeState: 'configured', capabilities: ['segment'], vramProfile: readVramProfile('Whisper large-v3') },
    { id: 'SOFA Japanese', family: 'analysis', engine: 'sofa', runtimeState: 'configured', capabilities: ['kana', 'h-token'], vramProfile: readVramProfile('SOFA Japanese') },
    { id: 'MSST_duality', family: 'analysis', engine: 'msst', runtimeState: 'configured', capabilities: ['vocals', 'instrumental'], vramProfile: readVramProfile('MSST_duality') },
    { id: 'MSST_dereverb', family: 'analysis', engine: 'msst', runtimeState: 'configured', capabilities: ['dry', 'other'], vramProfile: readVramProfile('MSST_dereverb') },
    { id: 'MSST_denoise', family: 'analysis', engine: 'msst', runtimeState: 'configured', capabilities: ['dry', 'other'], vramProfile: readVramProfile('MSST_denoise') },
  )
  return entries
}

function resolveRuntimePath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(SINGER_ROOT, value)
}

function readVramProfile(modelId: string): ModelCatalogEntry['vramProfile'] {
  const file = path.join(VRAM_PROFILE_DIR, `${modelId}.json`)
  try {
    const payload = JSON.parse(fs.readFileSync(file, 'utf8')) as any
    const sample = Array.isArray(payload.samples)
      ? payload.samples.reduce((best: any, item: any) => !best || Number(item?.peak?.usedMiB) > Number(best?.peak?.usedMiB) ? item : best, null)
      : null
    const peakUsedMiB = Number(sample?.peak?.usedMiB)
    const baselineUsedMiB = Number(sample?.before?.usedMiB)
    if (!Number.isFinite(peakUsedMiB)) return undefined
    const samples = Array.isArray(payload.samples)
      ? payload.samples
        .map((item: any) => ({
          seconds: Number(item.seconds),
          peakUsedMiB: Number(item.peak?.usedMiB),
          peakDeltaMiB: Number.isFinite(Number(item.before?.usedMiB))
            ? Math.max(0, Number(item.peak?.usedMiB) - Number(item.before?.usedMiB))
            : undefined,
        }))
        .filter((item: { seconds: number; peakUsedMiB: number; peakDeltaMiB?: number }) => Number.isFinite(item.peakUsedMiB))
        .sort((left: any, right: any) => left.seconds - right.seconds)
      : undefined
    let residentMiB: number | undefined
    const residentFile = path.join(VRAM_PROFILE_DIR, `${modelId}.resident.json`)
    try {
      residentMiB = Number(JSON.parse(fs.readFileSync(residentFile, 'utf8')).residentMiB)
    } catch {
      residentMiB = undefined
    }
    return {
      device: String(payload.device || ''),
      steps: Number.isInteger(Number(payload.steps)) ? Number(payload.steps) : undefined,
      residentMiB: Number.isFinite(residentMiB) ? residentMiB : undefined,
      peakUsedMiB,
      peakDeltaMiB: Number.isFinite(baselineUsedMiB) ? Math.max(0, peakUsedMiB - baselineUsedMiB) : undefined,
      sampleSeconds: Number(sample.seconds),
      measuredAt: String(payload.measuredAt || ''),
      samples,
    }
  } catch {
    return undefined
  }
}

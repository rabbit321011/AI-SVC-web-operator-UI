import { useRenderPanelStore } from '@/stores/renderPanel'
import { useGpuRuntimeStore } from '@/stores/gpuRuntime'

export async function ensureRenderCapacity(
  modelIds: string[],
  durationSeconds: number,
): Promise<boolean> {
  const renderPanel = useRenderPanelStore()
  const gpuRuntime = useGpuRuntimeStore()
  const prepared = await gpuRuntime.prepareCompositeTask(modelIds, durationSeconds) as any
  if (prepared.ok) {
    gpuRuntime.setActiveStageReleases(prepared.stageReleases ?? [])
    return true
  }
  if (prepared.busy) {
    if (modelIds[0].includes('MSST')) renderPanel.setMsstFailed(prepared.reason || '模型正在运行其他任务')
    else renderPanel.setWhisperFailed(prepared.reason || '模型正在运行其他任务')
    return false
  }
  if (prepared.insufficient) {
    const action = await renderPanel.requestCapacity({
      requiredMiB: prepared.required,
      freeMiB: prepared.freeMiB,
      insufficient: true,
      evictions: [],
      modelIds,
    })
    return action === 'force'
  }
  const action = await renderPanel.requestCapacity({
    requiredMiB: prepared.required,
    freeMiB: prepared.freeMiB,
    insufficient: false,
    evictions: prepared.evictions ?? [],
    modelIds,
  })
  if (action === 'cancel') return false
  if (action === 'force') return true
  if (prepared.evictions?.length) {
    const evicted = await gpuRuntime.evictUntilFit(modelIds[0], prepared.required, prepared.evictions)
    if (!evicted) {
      const retry = await renderPanel.requestCapacity({
        requiredMiB: prepared.required,
        freeMiB: prepared.freeMiB,
        insufficient: true,
        evictions: [],
        modelIds,
      })
      return retry === 'force'
    }
    gpuRuntime.setActiveStageReleases(prepared.stageReleases ?? [])
  }
  return true
}

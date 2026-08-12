export const GPU_CANCEL_MESSAGE = '用户已取消 GPU 任务并释放显存'

export function isGpuCancellation(error: unknown): boolean {
  return String((error as any)?.message || error || '').includes('用户已取消 GPU 任务')
}

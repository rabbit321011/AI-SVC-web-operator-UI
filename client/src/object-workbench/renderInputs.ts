import type { NodeId, ProjectObjectTree, RuntimeTreeIndex, TrackObjectContentType } from './types'
import { buildNodeIndex } from './objectTree'

export type RenderInputKind = 'trackObject' | 'group'
export type RenderPanelMode = 'svc' | 'svs'
export type RenderSlotId =
  | 'svc.condAudio'
  | 'svc.sourceAudio'
  | 'svs.timbreAudio'
  | 'svs.melody'
  | 'svs.text'

export interface RenderInputRef {
  kind: RenderInputKind
  id: NodeId
  displayName: string
  displayPathAtPick?: string
}

export interface RenderSlotValidation {
  ok: boolean
  reason?: string
  mediaType?: TrackObjectContentType
}

export function makeRenderInputRef(tree: ProjectObjectTree, kind: RenderInputKind, id: NodeId): RenderInputRef {
  const index = buildNodeIndex(tree.root)
  const node = index.nodes[id]
  if (!node) throw new Error(`Render input target does not exist: ${id}`)
  if (kind === 'trackObject' && node.kind !== 'trackObject') {
    throw new Error(`Expected TrackObject input: ${id}`)
  }
  if (kind === 'group' && node.kind !== 'group') {
    throw new Error(`Expected GroupObject input: ${id}`)
  }
  return {
    kind,
    id,
    displayName: node.name,
    displayPathAtPick: index.pathById[id],
  }
}

export function validateRenderSlot(tree: ProjectObjectTree, slotId: RenderSlotId, input: RenderInputRef | null): RenderSlotValidation {
  if (!input) return { ok: false, reason: '槽位为空' }
  const index = buildNodeIndex(tree.root)
  const mediaType = getRenderInputMediaType(index, input)
  if (!mediaType) return { ok: false, reason: '原对象不存在' }

  if (slotId === 'svc.condAudio' || slotId === 'svc.sourceAudio' || slotId === 'svs.timbreAudio') {
    return mediaType === 'audio'
      ? { ok: true, mediaType }
      : { ok: false, mediaType, reason: '该槽位只接受 audio TrackObject/GroupObject' }
  }

  if (slotId === 'svs.melody') {
    return mediaType === 'audio' || mediaType === 'midi'
      ? { ok: true, mediaType }
      : { ok: false, mediaType, reason: '旋律槽只接受 audio 或 midi TrackObject/GroupObject' }
  }

  if (slotId === 'svs.text') {
    return mediaType === 'text'
      ? { ok: true, mediaType }
      : { ok: false, mediaType, reason: '文本槽只接受 text TrackObject/GroupObject' }
  }

  return { ok: false, mediaType, reason: '未知槽位' }
}

export function getRenderInputMediaType(index: RuntimeTreeIndex, input: RenderInputRef): TrackObjectContentType | null {
  const node = index.nodes[input.id]
  if (!node) return null
  if (input.kind === 'trackObject' && node.kind === 'trackObject') return node.trackObject.contentType
  if (input.kind === 'group' && node.kind === 'group') return node.group.mediaType
  return null
}

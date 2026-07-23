import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createEmptyProjectObjectTree, TOP_LEVEL_IDS } from '@/object-workbench'
import type { AudioObjectNode, FolderNode, TextObjectNode, TrackFolderNode, TrackObjectNode } from '@/object-workbench'
import { useObjectTreeStore } from './objectTree'
import { useRenderPanelStore } from './renderPanel'

describe('right tool panel store', () => {
  it('supports built-in tool modes without plugin registration', () => {
    setActivePinia(createPinia())
    const renderPanel = useRenderPanelStore()

    renderPanel.setMode('whisper')
    expect(renderPanel.mode).toBe('whisper')
    renderPanel.setMode('msst')
    expect(renderPanel.mode).toBe('msst')
    renderPanel.setMode('chat')
    expect(renderPanel.mode).toBe('chat')
  })

  it('uses one local processing lock for asset-producing tools but releases it on completion', () => {
    setActivePinia(createPinia())
    const renderPanel = useRenderPanelStore()

    expect(renderPanel.setSvcRunning('job-a')).toBe(true)
    expect(renderPanel.localProcessingTool).toBe('svc')
    expect(renderPanel.setSvsRunning('job-b')).toBe(false)
    expect(renderPanel.setWhisperRunning()).toBe(false)
    expect(renderPanel.setMsstRunning()).toBe(false)

    renderPanel.setSvcDone()
    expect(renderPanel.localProcessingTool).toBeNull()
    expect(renderPanel.setMsstRunning()).toBe(true)
    expect(renderPanel.localProcessingTool).toBe('msst')
    renderPanel.setMsstFailed('MSST failed')
    expect(renderPanel.localProcessingTool).toBeNull()
  })

  it('accepts ordinary AudioObject references for Whisper and MSST audio slots', () => {
    setActivePinia(createPinia())
    const objectTree = useObjectTreeStore()
    const renderPanel = useRenderPanelStore()
    const tree = createEmptyProjectObjectTree()
    workspace(tree).children.push(audio('node:workspace:audio'))
    objectTree.loadObjectTree(tree)

    expect(renderPanel.setSlotFromNode('whisper.audio', 'node:workspace:audio')).toMatchObject({ ok: true })
    expect(renderPanel.whisper.audio).toMatchObject({ kind: 'audioObject', id: 'node:workspace:audio' })
    expect(renderPanel.setSlotFromNode('msst.audio', 'node:workspace:audio')).toMatchObject({ ok: true })
    expect(renderPanel.msst.audio).toMatchObject({ kind: 'audioObject', id: 'node:workspace:audio' })
  })

  it('enables Whisper and MSST only when no local processing task is running', () => {
    setActivePinia(createPinia())
    const objectTree = useObjectTreeStore()
    const renderPanel = useRenderPanelStore()
    const tree = createEmptyProjectObjectTree()
    const source = audio('node:audio')
    const trackObject = trackObjectNode('node:trackObject:audio', source.id)
    trackSources(tree).children.push(source)
    tracksRoot(tree).children.push(trackFolder('node:trackFolder:audio', trackObject))
    objectTree.loadObjectTree(tree)

    expect(renderPanel.setSlotFromNode('whisper.audio', trackObject.id)).toMatchObject({ ok: true })
    expect(renderPanel.setSlotFromNode('msst.audio', trackObject.id)).toMatchObject({ ok: true })
    expect(renderPanel.canRunWhisper).toBe(true)
    expect(renderPanel.canRunMsst).toBe(true)

    expect(renderPanel.setSvcRunning('job-a')).toBe(true)
    expect(renderPanel.canRunWhisper).toBe(false)
    expect(renderPanel.canRunMsst).toBe(false)
  })

  it('requires separate timed A and B TextObject slots for SVS', () => {
    setActivePinia(createPinia())
    const objectTree = useObjectTreeStore()
    const renderPanel = useRenderPanelStore()
    const tree = createEmptyProjectObjectTree()
    const source = audio('node:audio')
    const melody = trackObjectNode('node:trackObject:melody', source.id)
    const refText = text('node:text:ref')
    const targetText = text('node:text:target')
    const refTrackObject = textTrackObject('node:trackObject:refText', refText.id)
    const targetTrackObject = textTrackObject('node:trackObject:targetText', targetText.id)
    trackSources(tree).children.push(source, refText, targetText)
    tracksRoot(tree).children.push(
      trackFolder('node:trackFolder:audio', melody),
      textTrackFolder('node:trackFolder:refText', refTrackObject),
      textTrackFolder('node:trackFolder:targetText', targetTrackObject),
    )
    objectTree.loadObjectTree(tree)

    expect(renderPanel.setSlotFromNode('svs.timbreAudio', source.id).ok).toBe(true)
    expect(renderPanel.setSlotFromNode('svs.melody', melody.id).ok).toBe(true)
    expect(renderPanel.setSlotFromNode('svs.refText', refTrackObject.id).ok).toBe(true)
    expect(renderPanel.canRunSvs).toBe(false)
    expect(renderPanel.setSlotFromNode('svs.targetText', targetTrackObject.id).ok).toBe(true)
    expect(renderPanel.canRunSvs).toBe(true)
  })

})

function workspace(tree: ReturnType<typeof createEmptyProjectObjectTree>): FolderNode {
  return folder(tree.root.children.find(child => child.id === TOP_LEVEL_IDS.workspace))
}

function trackSources(tree: ReturnType<typeof createEmptyProjectObjectTree>): FolderNode {
  return folder(tree.root.children.find(child => child.id === TOP_LEVEL_IDS.trackSources))
}

function tracksRoot(tree: ReturnType<typeof createEmptyProjectObjectTree>): FolderNode {
  return folder(tree.root.children.find(child => child.id === TOP_LEVEL_IDS.tracks))
}

function folder(node: unknown): FolderNode {
  if (!node || typeof node !== 'object' || (node as any).kind !== 'folder') throw new Error('expected folder')
  return node as FolderNode
}

function audio(id: string): AudioObjectNode {
  return {
    id,
    kind: 'audio',
    name: 'voice.wav',
    audio: {
      assetId: 'asset:audio',
      midiObjectId: null,
      textObjectId: null,
    },
  }
}

function trackFolder(id: string, child: TrackObjectNode): TrackFolderNode {
  return {
    id,
    kind: 'trackFolder',
    name: 'Audio Track',
    trackFolder: { trackType: 'audio' },
    children: [child],
  }
}

function textTrackFolder(id: string, child: TrackObjectNode): TrackFolderNode {
  return {
    id,
    kind: 'trackFolder',
    name: 'Text Track',
    trackFolder: { trackType: 'text' },
    children: [child],
  }
}

function text(id: string): TextObjectNode {
  return {
    id,
    kind: 'text',
    name: 'Timed text',
    text: {
      sourceAudioObjectId: null,
      segments: [{ start: 0, end: 1, kana: 'きみ', romaji: 'ki mi' }],
    },
  }
}

function textTrackObject(id: string, sourceObjectId: string): TrackObjectNode {
  return {
    ...trackObjectNode(id, sourceObjectId),
    trackObject: {
      ...trackObjectNode(id, sourceObjectId).trackObject,
      contentType: 'text',
    },
  }
}

function trackObjectNode(id: string, sourceObjectId: string): TrackObjectNode {
  return {
    id,
    kind: 'trackObject',
    name: 'Clip',
    trackObject: {
      contentType: 'audio',
      sourceObjectId,
      timelineStart: 0,
      timelineEnd: 2,
      ignored: false,
    },
  }
}

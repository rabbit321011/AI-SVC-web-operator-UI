import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Project } from '@/types'
import { TOP_LEVEL_IDS, createEmptyProjectObjectTree } from '@/object-workbench'
import { useObjectTreeStore } from './objectTree'
import { useProjectStore } from './project'

describe('project object tree persistence', () => {
  it('derives an object tree when loading a legacy project without objectTree', () => {
    setActivePinia(createPinia())
    const project = useProjectStore()
    const objectTree = useObjectTreeStore()

    project.load(makeLegacyProject())

    expect(objectTree.node(TOP_LEVEL_IDS.tracks)?.kind).toBe('folder')
    expect(objectTree.legacyMaps?.trackObjectIdBySegmentId.seg_a).toBe('node:trackObject:seg_a')
    expect(project.toJSON().objectTree?.schemaVersion).toBe('object-workbench.v1')
  })

  it('loads and saves an explicit objectTree without regenerating legacy maps', () => {
    setActivePinia(createPinia())
    const project = useProjectStore()
    const objectTree = createEmptyProjectObjectTree()
    objectTree.root.children.push({ id: 'project:/custom', kind: 'folder', name: 'custom', children: [] })

    project.load({ ...makeLegacyProject(), objectTree })

    const store = useObjectTreeStore()
    expect(store.node('project:/custom')?.kind).toBe('folder')
    expect(store.legacyMaps).toBeNull()
    expect(project.toJSON().objectTree?.root.children.some(child => child.id === 'project:/custom')).toBe(true)
  })
})

function makeLegacyProject(): Project {
  return {
    id: 'project_a',
    name: 'Fixture',
    version: '1.0.0',
    tracks: {
      trk_a: {
        id: 'trk_a',
        name: 'Voice',
        color: '#58a6ff',
        segments: ['seg_a'],
        sourceFile: 'voice.wav',
        sampleRate: 48000,
        totalSamples: 96000,
        f0Cache: null,
        f0Pending: 0,
        f0Total: 0,
        collapsed: false,
        muted: false,
        solo: false,
        volume: 1,
        ignored: false,
        boundCompGroupId: null,
      },
    },
    trackOrder: ['trk_a'],
    segments: {
      seg_a: {
        id: 'seg_a',
        trackId: 'trk_a',
        sourceFile: 'voice.wav',
        srcStartSample: 0,
        srcEndSample: 96000,
        timelineStart: 0,
        timelineEnd: 2,
        f0Data: null,
        f0Extracted: false,
        color: '#58a6ff',
        ignored: false,
      },
    },
    compGroups: {},
    compGroupOrder: [],
    timelineOffset: 0,
    pxPerSec: 60,
    f0Settings: { fmin: 65.4, fmax: 2093, algorithm: 'pyin', hopMs: 16 },
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-01-01T00:00:00.000Z',
  }
}

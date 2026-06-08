import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useObjectTreeUiStore } from './objectTreeUi'
import { useSelectionStore } from './selection'

describe('timeline and object tree selection exclusivity', () => {
  it('clears object tree selection when selecting timeline items', () => {
    setActivePinia(createPinia())
    const objectTreeUi = useObjectTreeUiStore()
    const selection = useSelectionStore()

    objectTreeUi.selectById('node:trackObject:seg_a')
    selection.select('seg_b')

    expect(objectTreeUi.selectedIds).toEqual([])
    expect(selection.ids).toEqual(['seg_b'])
  })

  it('clears object tree selection when marquee-selecting timeline segments', () => {
    setActivePinia(createPinia())
    const objectTreeUi = useObjectTreeUiStore()
    const selection = useSelectionStore()

    objectTreeUi.selectById('node:trackObject:seg_a')
    selection.selectAll(['seg_b', 'seg_c'], 'segments')

    expect(objectTreeUi.selectedIds).toEqual([])
    expect(selection.ids).toEqual(['seg_b', 'seg_c'])
  })
})

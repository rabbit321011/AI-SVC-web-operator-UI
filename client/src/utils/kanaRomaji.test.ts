import { describe, expect, it } from 'vitest'
import { kanaToRomaji, romajiToKana } from './kanaRomaji'

describe('kana romaji sync helpers', () => {
  it('converts kana to spaced romaji', () => {
    expect(kanaToRomaji('きみのこえ')).toBe('ki mi no ko e')
  })

  it('converts romaji tokens to kana', () => {
    expect(romajiToKana('ki mi no ko e')).toBe('きみのこえ')
  })

  it('keeps phrase separators usable for SVS text entry', () => {
    expect(romajiToKana('ki mi|no ko e')).toBe('きみ|のこえ')
  })
})

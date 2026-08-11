import { describe, expect, it } from 'vitest'
import { V5P_H_TOKEN_BY_ID, V5P_H_TOKEN_CATALOG } from './v5pHTokenCatalog'

describe('generated V5-P H Token catalog', () => {
  it('preserves the complete dense runtime ID space and training evidence', () => {
    expect(V5P_H_TOKEN_CATALOG).toHaveLength(367)
    expect(V5P_H_TOKEN_CATALOG.map(entry => entry.id)).toEqual(Array.from({ length: 367 }, (_, id) => id))
    expect(V5P_H_TOKEN_CATALOG.filter(entry => entry.v5p40kSeen)).toHaveLength(45)
    expect(V5P_H_TOKEN_BY_ID.get(365)?.token).toBe('<SEP>')
    expect(V5P_H_TOKEN_BY_ID.get(366)?.token).toBe('<PUL>')
    expect(V5P_H_TOKEN_BY_ID.get(364)?.v5p40kSeen).toBe(false)
  })
})

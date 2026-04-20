import { describe, it, expect } from 'vitest'
import { newId } from '../../src/ids.js'

describe('newId', () => {
  it('returns a UUID-format string', () => {
    const id = newId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('generates unique IDs', () => {
    expect(newId()).not.toBe(newId())
  })
})

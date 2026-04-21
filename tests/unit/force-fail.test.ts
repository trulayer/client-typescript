// THROWAWAY FILE — intentionally fails to verify the hardened `ci` aggregate
// reports failure (not `skipping`) so branch protection actually blocks merges
// with failing tests. This file MUST be deleted with the verification branch.

import { describe, it, expect } from 'vitest'

describe('ci aggregate verification', () => {
  it('intentionally fails to verify the hardened ci aggregate reports failure', () => {
    expect(true).toBe(false)
  })
})
